import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Master-society chart sharing.
 *
 * A society may be onboarded with a "master society": its groups and ledger
 * heads are cloned into the new society *once* (codes/names/print nos. only —
 * never balances, never transactions), and afterwards any ledger or group
 * added to the master flows into every linked society automatically.
 *
 * Core rules:
 * - The graph is a tree: a master society is itself never linked to another
 *   master (cycle prevention by construction).
 * - Matching between master and linked societies is by (masterKey) — the
 *   source row's _id — so renames on either side never duplicate rows.
 * - Deleting on the master does NOT delete in linked societies: the office
 *   may already have posted against a ledger.
 * - The three Form N system ledgers are ALWAYS created per society by name
 *   (they are engine requirements, not chart copies).
 */

/** Clone (groups + accounts, structure only) from master into societyId. */
export async function cloneMasterChart(
  ctx: MutationCtx,
  masterId: Id<"societies">,
  societyId: Id<"societies">,
): Promise<{ groupsAdded: number; accountsAdded: number }> {
  if (masterId === societyId) {
    throw new Error("A master society cannot be linked to itself.");
  }
  // Cycle prevention: the master must not itself be somebody's linked child.
  const master = await ctx.db.get(masterId);
  if (!master) throw new Error("Master society not found.");
  if (master.masterSocietyId) {
    throw new Error(
      "The master society is itself linked to another master — a society cannot chain masters.",
    );
  }

  let groupsAdded = 0;
  let accountsAdded = 0;

  const masterGroups = await ctx.db
    .query("accountGroups")
    .withIndex("by_society", (q) => q.eq("societyId", masterId))
    .collect();

  // Map master group _id → cloned child group _id (accounts reference them).
  const groupMap = new Map<string, Id<"accountGroups">>();
  for (const g of masterGroups) {
    const dup = await ctx.db
      .query("accountGroups")
      .withIndex("by_master_key", (q) =>
        q.eq("masterSocietyId", masterId).eq("masterKey", g._id),
      )
      .first();
    if (dup) {
      groupMap.set(g._id, dup._id);
      continue;
    }
    const childId = await ctx.db.insert("accountGroups", {
      societyId,
      code: g.code,
      name: g.name,
      type: g.type,
      sequence: g.sequence,
      // Master-side provenance: origin of this row in the child society.
      masterSocietyId: masterId,
      masterKey: g._id,
      origin: "master",
    });
    groupMap.set(g._id, childId);
    groupsAdded++;
  }

  const masterAccounts = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", masterId))
    .collect();

  for (const a of masterAccounts) {
    const dup = await ctx.db
      .query("accounts")
      .withIndex("by_master_key", (q) =>
        q.eq("masterSocietyId", masterId).eq("masterKey", a._id),
      )
      .first();
    if (dup) continue;
    await ctx.db.insert("accounts", {
      societyId,
      code: a.code,
      name: a.name,
      type: a.type,
      kind: a.kind,
      printNo: a.printNo,
      // NO openingBalance copy — cloned ledgers start at 0.
      openingBalance: 0,
      groupId: a.groupId ? groupMap.get(a.groupId) : undefined,
      masterSocietyId: masterId,
      masterKey: a._id,
      origin: "master",
    });
    accountsAdded++;
  }

  return { groupsAdded, accountsAdded };
}

/**
 * Propagate an EDIT of a master ledger to its cloned row in every linked
 * society — identity fields only (code, name, printNo, kind, group). Never
 * touches balances, and never fires when the master row was itself inserted
 * by the sync (origin "master"). Skips silently when the linked society has
 * no clone (e.g. it was deleted locally) or when an edited code collides
 * with a locally-created ledger in the child.
 */
export async function propagateAccountEdit(
  ctx: MutationCtx,
  masterId: Id<"societies">,
  account: {
    _id: Id<"accounts">;
    code: string;
    name: string;
    type: "asset" | "liability" | "income" | "expense";
    kind?: "bank_cash" | "receivable";
    printNo?: string;
    groupId?: Id<"accountGroups">;
  },
): Promise<number> {
  const children = await ctx.db
    .query("societies")
    .withIndex("by_master", (q) => q.eq("masterSocietyId", masterId))
    .collect();
  let updated = 0;
  for (const child of children) {
    const clone = await ctx.db
      .query("accounts")
      .withIndex("by_master_key", (q) =>
        q.eq("masterSocietyId", masterId).eq("masterKey", account._id),
      )
      .first();
    if (!clone) continue;
    // Skip when another (locally created) ledger in the child already holds
    // the new code — propagate everything EXCEPT the colliding identity.
    const allChild = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", child._id))
      .collect();
    const codeTaken = allChild.some(
      (c) => c._id !== clone._id && c.code.trim().toLowerCase() === account.code.trim().toLowerCase(),
    );
    let childGroupId: Id<"accountGroups"> | undefined;
    if (account.groupId) {
      const childGroup = await ctx.db
        .query("accountGroups")
        .withIndex("by_master_key", (q) =>
          q.eq("masterSocietyId", masterId).eq("masterKey", account.groupId),
        )
        .first();
      childGroupId = childGroup?._id;
    }
    await ctx.db.patch(clone._id, {
      code: codeTaken ? clone.code : account.code,
      name: account.name,
      type: account.type,
      kind: account.kind,
      printNo: account.printNo,
      groupId: childGroupId === undefined ? undefined : childGroupId,
    });
    updated++;
  }
  return updated;
}

/**
 * Propagate an EDIT of a master group (code, name, sequence) to its clones.
 */
export async function propagateGroupEdit(
  ctx: MutationCtx,
  masterId: Id<"societies">,
  group: { _id: Id<"accountGroups">; code: string; name: string; type: "asset" | "liability" | "income" | "expense"; sequence: number },
): Promise<number> {
  const children = await ctx.db
    .query("societies")
    .withIndex("by_master", (q) => q.eq("masterSocietyId", masterId))
    .collect();
  let updated = 0;
  for (const child of children) {
    const clone = await ctx.db
      .query("accountGroups")
      .withIndex("by_master_key", (q) =>
        q.eq("masterSocietyId", masterId).eq("masterKey", group._id),
      )
      .first();
    if (!clone) continue;
    const allChild = await ctx.db
      .query("accountGroups")
      .withIndex("by_society", (q) => q.eq("societyId", child._id))
      .collect();
    const codeTaken = allChild.some(
      (c) => c._id !== clone._id && c.code.trim().toLowerCase() === group.code.trim().toLowerCase(),
    );
    await ctx.db.patch(clone._id, {
      code: codeTaken ? clone.code : group.code,
      name: group.name,
      type: group.type,
      sequence: group.sequence,
    });
    updated++;
  }
  return updated;
}

/**
 * Propagate a single NEW group from the master to every society linked to it.
 * Idempotent: a linked society that already carries masterKey (or an
 * identical code) is skipped.
 */
export async function propagateNewGroup(
  ctx: MutationCtx,
  masterId: Id<"societies">,
  group: { _id: Id<"accountGroups">; code: string; name: string; type: "asset" | "liability" | "income" | "expense"; sequence: number },
): Promise<number> {
  const children = await ctx.db
    .query("societies")
    .withIndex("by_master", (q) => q.eq("masterSocietyId", masterId))
    .collect();
  let propagated = 0;
  for (const child of children) {
    const dup = await ctx.db
      .query("accountGroups")
      .withIndex("by_master_key", (q) =>
        q.eq("masterSocietyId", masterId).eq("masterKey", group._id),
      )
      .first();
    if (dup) continue;
    // Also skip when an identical code already exists locally (a locally
    // created group with the same code would collide visually).
    const allChild = await ctx.db
      .query("accountGroups")
      .withIndex("by_society", (q) => q.eq("societyId", child._id))
      .collect();
    if (allChild.some((c) => c.code.trim().toLowerCase() === group.code.trim().toLowerCase())) continue;
    await ctx.db.insert("accountGroups", {
      societyId: child._id,
      code: group.code,
      name: group.name,
      type: group.type,
      sequence: group.sequence,
      masterSocietyId: masterId,
      masterKey: group._id,
      origin: "master",
    });
    propagated++;
  }
  return propagated;
}

/**
 * Propagate a single NEW account from the master to every linked society.
 * Idempotent on masterKey and on code. The account's group maps via the
 * child society's cloned group (masterKey same as master's groupId).
 */
export async function propagateNewAccount(
  ctx: MutationCtx,
  masterId: Id<"societies">,
  account: {
    _id: Id<"accounts">;
    code: string;
    name: string;
    type: "asset" | "liability" | "income" | "expense";
    kind?: "bank_cash" | "receivable";
    printNo?: string;
    groupId?: Id<"accountGroups">;
  },
): Promise<number> {
  const children = await ctx.db
    .query("societies")
    .withIndex("by_master", (q) => q.eq("masterSocietyId", masterId))
    .collect();
  let propagated = 0;
  for (const child of children) {
    const dup = await ctx.db
      .query("accounts")
      .withIndex("by_master_key", (q) =>
        q.eq("masterSocietyId", masterId).eq("masterKey", account._id),
      )
      .first();
    if (dup) continue;
    const allChild = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", child._id))
      .collect();
    if (allChild.some((c) => c.code.trim().toLowerCase() === account.code.trim().toLowerCase())) continue;
    let childGroupId: Id<"accountGroups"> | undefined;
    if (account.groupId) {
      const childGroup = await ctx.db
        .query("accountGroups")
        .withIndex("by_master_key", (q) =>
          q.eq("masterSocietyId", masterId).eq("masterKey", account.groupId),
        )
        .first();
      childGroupId = childGroup?._id;
    }
    await ctx.db.insert("accounts", {
      societyId: child._id,
      code: account.code,
      name: account.name,
      type: account.type,
      kind: account.kind,
      printNo: account.printNo,
      openingBalance: 0,
      groupId: childGroupId,
      masterSocietyId: masterId,
      masterKey: account._id,
      origin: "master",
    });
    propagated++;
  }
  return propagated;
}

