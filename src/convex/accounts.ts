import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";
import type { MutationCtx } from "./_generated/server";

/**
 * System ledgers the Form N statements post to. Created once per society
 * (idempotent) from the Chart of Accounts, and seeded automatically for new
 * societies alongside the default accounts.
 */
export const FORM_N_LEDGERS = [
  {
    code: "1090",
    name: "Dues from Members",
    type: "asset" as const,
    kind: "receivable" as const,
  },
  {
    code: "2990",
    name: "Advance from Members",
    type: "liability" as const,
  },
  {
    code: "2991",
    name: "Income over Expenses",
    type: "liability" as const,
  },
];

/**
 * Create any of the system Form N ledgers the society is missing: "Dues from
 * Members" (the member-outstanding control, asset), "Advance from Members"
 * (money members paid ahead of billing, liability) and "Income over Expenses"
 * (the surplus the Balance Sheet carries, liability). Existing ledgers — by
 * exact name — are left untouched, so this can be run repeatedly.
 */
export async function ensureFormNLedgers(ctx: MutationCtx, societyId: Id<"societies">) {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const names = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  for (const l of FORM_N_LEDGERS) {
    if (names.has(l.name.toLowerCase())) continue;
    await ctx.db.insert("accounts", {
      societyId,
      code: l.code,
      name: l.name,
      type: l.type,
      kind: l.kind,
      openingBalance: 0,
    });
  }
}

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("accounts")),
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("income"),
      v.literal("expense"),
    ),
    kind: v.optional(v.union(v.literal("bank_cash"), v.literal("receivable"))),
    openingBalance: v.number(),
    groupId: v.optional(v.id("accountGroups")),
    /** Printing serial no. for the order of this ledger on printed statements. */
    printNo: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, id, ...data }) => {
    await requireSocietyWrite(ctx, societyId);
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("accounts", { societyId, ...data });
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("accounts") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const used =
      vouchers.some(
        (v) =>
          v.bankCashAccountId === id ||
          v.lines.some((l) => l.accountId === id),
      ) ||
      (await ctx.db
        .query("tariffs")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()).some((t) => t.accountId === id) ||
      (await ctx.db
        .query("bills")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()).some((b) => b.lines.some((l) => l.accountId === id));
    if (used)
      throw new Error("Account is used by vouchers, tariffs or bills.");
    await ctx.db.delete(id);
  },
});

/**
 * Bulk-update many accounts in one transaction (the Chart of Accounts
 * "Edit all" mode). One mutation instead of a client loop so either all rows
 * apply or none do.
 *
 * Guarded:
 * - System ledgers (Form N, matched by name) can't be renamed/re-coded — the
 *   statement engine resolves them by exact name.
 * - Codes must stay unique within the society (case-insensitive, trimmed).
 * - Group assignment must be empty or a group of the SAME section as the
 *   account's type.
 */
export const bulkUpdate = mutation({
  args: {
    societyId: v.id("societies"),
    updates: v.array(
      v.object({
        id: v.id("accounts"),
        code: v.string(),
        name: v.string(),
        openingBalance: v.number(),
        groupId: v.optional(v.id("accountGroups")),
        kind: v.optional(v.union(v.literal("bank_cash"), v.literal("receivable"))),
        printNo: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { societyId, updates }) => {
    await requireSocietyWrite(ctx, societyId);
    if (updates.length === 0) return { updated: 0 };

    // Fresh read of the rows being edited (authority check + original values).
    const rows = await Promise.all(updates.map((u) => ctx.db.get(u.id)));
    if (rows.some((r) => !r || r.societyId !== societyId)) {
      throw new Error("Some accounts don't belong to this society — reload the page and try again.");
    }

    const systemNames = new Set(FORM_N_LEDGERS.map((l) => l.name.toLowerCase()));
    const forSystem = rows.some((r) => r && systemNames.has(r.name.toLowerCase()));
    if (forSystem) {
      throw new Error(
        "System ledgers (Dues from Members, Advance from Members, Income over Expenses) cannot be renamed or re-coded — they're used by the statement engine. Edit other accounts, or create a new ledger.",
      );
    }

    // Duplicate-code guard: compare each edited code against the full society
    // chart, excluding the row it belongs to.
    const seen = new Map<string, string>(); // normCode → code
    for (const u of updates) {
      const code = u.code.trim();
      if (!code) throw new Error("Every account needs a code.");
      if (!u.name.trim()) throw new Error("Every account needs a name.");
      const key = code.toLowerCase();
      const other = seen.get(key);
      if (other && other !== u.id) {
        throw new Error(`Duplicate code "${code}" — two rows would share the same ledger code.`);
      }
      seen.set(key, u.id);
    }
    if (rows.length > 0) {
      const otherAccounts = await ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
      const editedIds = new Set(updates.map((u) => u.id));
      const editedKeys = new Set(updates.map((u) => u.code.trim().toLowerCase()));
      for (const a of otherAccounts) {
        if (editedIds.has(a._id)) continue;
        const key = a.code.trim().toLowerCase();
        if (editedKeys.has(key)) {
          throw new Error(
            `Code "${a.code}" is already used by another ledger (${a.name}). Codes must be unique across the whole chart.`,
          );
        }
      }
    }

    // Groups — section consistency: only assign a group whose type matches
    // the account's existing type.
    const groupIds = [...new Set(updates.map((u) => u.groupId).filter((g): g is Id<"accountGroups"> => !!g))];
    const groupTypes: Map<Id<"accountGroups">, string> = new Map();
    for (const gid of groupIds) {
      const g = await ctx.db.get(gid);
      if (!g || g.societyId !== societyId) {
        throw new Error("A referenced group doesn't exist in this society.");
      }
      groupTypes.set(gid, g.type);
    }
    for (let i = 0; i < updates.length; i++) {
      const row = rows[i];
      const u = updates[i];
      if (!row || !u) continue;
      if (u.groupId) {
        const gt = groupTypes.get(u.groupId);
        if (gt && gt !== row.type) {
          throw new Error(
            `"${u.name.trim()}" is a ${row.type} account — "${gt}" groups can't hold it.`,
          );
        }
      }
    }

    let updated = 0;
    for (let i = 0; i < updates.length; i++) {
      const row = rows[i];
      const u = updates[i];
      if (!row || !u) continue;
      const next = {
        code: u.code.trim(),
        name: u.name.trim(),
        openingBalance: Number.isFinite(u.openingBalance) ? u.openingBalance : 0,
        groupId: u.groupId,
        kind: u.kind,
        printNo: u.printNo?.trim() || undefined,
      };
      if (
        row.code !== next.code ||
        row.name !== next.name ||
        row.openingBalance !== next.openingBalance ||
        row.groupId !== next.groupId ||
        row.kind !== next.kind ||
        row.printNo !== next.printNo
      ) {
        await ctx.db.patch(u.id, next);
        updated++;
      }
    }
    return { updated };
  },
});

/** Create the system Form N ledgers this society is missing. Idempotent. */
export const ensureSystem = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSocietyWrite(ctx, societyId);
    await ensureFormNLedgers(ctx, societyId);
    const created = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return FORM_N_LEDGERS.map((l) =>
      created.find((a) => a.name === l.name)?._id,
    ).filter((id): id is Id<"accounts"> => !!id);
  },
});
