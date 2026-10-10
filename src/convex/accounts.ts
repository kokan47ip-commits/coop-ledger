import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";
import type { AccountType } from "../lib/bulkUpdateRules";
import { propagateAccountEdit, propagateNewAccount } from "./chartSync";
import {
  batchDuplicateProblem,
  blankFieldProblem,
  crossChartDuplicateProblem,
  groupMismatchProblem,
  systemRenameProblem,
} from "../lib/bulkUpdateRules";
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
    const society = await requireSocietyWrite(ctx, societyId);
    if (id) {
      const before = await ctx.db.get(id);
      if (!before || before.societyId !== societyId) {
        throw new Error("Account not found in this society.");
      }
      await ctx.db.patch(id, data);
      // Master chart sharing: identity edits on a master ledger flow to every
      // linked society — structure only, never balances (and never for rows
      // the sync itself created).
      if (!society.masterSocietyId && before.origin !== "master" && (before.code !== data.code || before.name !== data.name || before.kind !== data.kind || before.printNo !== data.printNo || before.groupId !== data.groupId)) {
        await propagateAccountEdit(ctx, societyId, {
          _id: id,
          code: data.code,
          name: data.name,
          type: data.type,
          kind: data.kind,
          printNo: data.printNo,
          groupId: data.groupId,
        });
      }
      return id;
    }
    const newId = await ctx.db.insert("accounts", { societyId, ...data });
    // Master chart sharing: a ledger added to a master society flows to every
    // linked (child) society — structure only, never balances. Rows inserted
    // by the sync itself carry origin "master" and skip re-propagation.
    const row = await ctx.db.get(newId);
    if (!society.masterSocietyId && row?.origin !== "master") {
      await propagateNewAccount(ctx, societyId, { _id: newId, ...data });
    }
    return newId;
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
        type: v.optional(v.union(
          v.literal("asset"),
          v.literal("liability"),
          v.literal("income"),
          v.literal("expense"),
        )),
        openingBalance: v.number(),
        groupId: v.optional(v.id("accountGroups")),
        kind: v.optional(v.union(v.literal("bank_cash"), v.literal("receivable"))),
        printNo: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { societyId, updates }) => {
    // Every rejection names the offending row — an opaque "Call by client"
    // server error leaves the office unable to fix anything.
    const reject = (rowIndex: number, msg: string): never => {
      const u = updates[rowIndex];
      throw new Error(u ? `Row "${u.code} — ${u.name}": ${msg}` : msg);
    };
    const society = await requireSocietyWrite(ctx, societyId);
    if (updates.length === 0) return { updated: 0 };

    // Fresh read of the rows being edited (authority check + original values).
    const rows = await Promise.all(updates.map((u) => ctx.db.get(u.id)));
    const orphan = rows.findIndex((r) => !r || r.societyId !== societyId);
    if (orphan !== -1) {
      reject(orphan, "this ledger can no longer be found in this society — reload the page and try again.");
    }

    // A stale browser tab can still hold a draft under a ledger whose
    // statement section changed in the meantime (or the sheet import moved
    // it). A silent type flip corrupts the Balance Sheet vs I&E split, so it
    // is refused with a row-named message instead of slipping through.
    for (let i = 0; i < updates.length; i++) {
      const row = rows[i];
      const u = updates[i];
      if (!row || !u) continue;
      if (u.type && u.type !== row.type) {
        reject(i, `this ledger now sits under "${row.type}" — change its section by editing the ledger (not bulk edit), or reload the page.`);
      }
    }

    // System ledgers are reserved for the Form N statement engine, which
    // resolves them by exact name/code — their IDENTITY must survive this
    // mutation. Balances, print order and grouping may still be edited.
    for (let i = 0; i < updates.length; i++) {
      const row = rows[i];
      const u = updates[i];
      if (!row || !u) continue;
      const renameProblem = systemRenameProblem(row, u);
      if (renameProblem) reject(i, renameProblem);
    }

    for (let i = 0; i < updates.length; i++) {
      const blank = blankFieldProblem(updates[i]!);
      if (blank) reject(i, blank);
    }
    const batchDup = batchDuplicateProblem(updates);
    if (batchDup) {
      throw new Error(`Duplicate code "${batchDup}" — two rows in this save would share the same ledger code.`);
    }
    {
      const chart = await ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
      const cross = crossChartDuplicateProblem(
        updates,
        chart.map((a) => ({ id: a._id, code: a.code, name: a.name })),
      );
      if (cross) {
        const other = chart.find((a) => a.code.trim().toLowerCase() === cross.toLowerCase());
        const i = updates.findIndex((u) => u.code.trim().toLowerCase() === cross.toLowerCase());
        reject(i, `code "${cross}" is already used by another ledger (${other?.name ?? "unknown"}). Codes must be unique across the whole chart.`);
      }
    }

    // Groups — section consistency: only assign a group whose type matches
    // the account's existing type.
    const groupIds = [...new Set(updates.map((u) => u.groupId).filter((g): g is Id<"accountGroups"> => !!g))];
    const groupTypes: Map<Id<"accountGroups">, AccountType> = new Map();
    for (const gid of groupIds) {
      const g = await ctx.db.get(gid);
      if (!g || g.societyId !== societyId) {
        const i = updates.findIndex((u) => u.groupId === gid);
        reject(i, "its group no longer exists in this society — pick another group or save without one.");
      }
      groupTypes.set(gid, g!.type);
    }
    for (let i = 0; i < updates.length; i++) {
      const row = rows[i];
      const u = updates[i];
      if (!row || !u) continue;
      const mismatch = groupMismatchProblem(row, u, (gid) => groupTypes.get(gid as Id<"accountGroups">));
      if (mismatch) reject(i, mismatch);
    }

    let updated = 0;
    const editedMasterAccounts: {
      _id: Id<"accounts">;
      code: string;
      name: string;
      type: AccountType;
      kind?: "bank_cash" | "receivable";
      printNo?: string;
      groupId?: Id<"accountGroups">;
    }[] = [];
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
        // Master chart sharing: an IDENTITY edit (code/name/printNo/kind/
        // group) flows to every linked society — structure only, never a
        // balance. Rows the sync itself created skip (origin "master").
        if (!society.masterSocietyId && row.origin !== "master") {
          editedMasterAccounts.push({
            _id: u.id,
            code: next.code,
            name: next.name,
            type: row.type,
            kind: next.kind,
            printNo: next.printNo,
            groupId: next.groupId,
          });
        }
      }
    }
    for (const a of editedMasterAccounts) await propagateAccountEdit(ctx, societyId, a);
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
