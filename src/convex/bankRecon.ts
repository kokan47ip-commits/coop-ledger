import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite, requireUserId } from "./lib";
import { loadSocietyData, computeCashBook, type CashBookSection } from "./reports";

/**
 * BANK RECONCILIATION
 *
 * The office tallies a bank/cash ledger's book entries against the bank
 * statement (pass book) for a statement date, ticks the entries the bank has
 * already honoured, and states the actual pass-book balance. The statement
 * then reads exactly like the reference books:
 *
 *   Balance as per books (Dr)                    X
 *   Less: deposits recorded in books, not yet
 *         credited by the bank                    − D
 *   Add:  withdrawals recorded in books, cheques
 *         not yet presented                       + W
 *   ─────────────────────────────────────────────────────
 *   Balance as per bank pass book (expected)      A
 *   Balance as per bank statement (entered)       B
 *   Difference (B − A)                            Δ   ← 0 = fully reconciled
 *
 * `cleared` sets are stored per (account, statement date) and composed
 * cumulatively: a later statement inherits every earlier one's ticks.
 */

export type BankReconEntry = {
  date: string;
  voucherNo: string;
  /** Narration lines, Crystal-style, same as the Cash/Bank Book prints. */
  narration: string[];
  /** Book deposit into the bank ledger (Dr). */
  deposit: number;
  /** Book withdrawal from the bank ledger (Cr). */
  withdrawal: number;
  cleared: boolean;
};

export type BankReconStatement = {
  accountId: Id<"accounts">;
  code: string;
  name: string;
  /** Balance as per books at the range start (brought forward). */
  bookOpening: number;
  /** Balance as per books at the statement date. */
  bookClosing: number;
  entries: BankReconEntry[];
  unclearedDeposits: number;
  unclearedWithdrawals: number;
  /** What the pass book should read once the pending items clear. */
  expectedBankBalance: number;
  /** The stated pass-book balance (0 until the office states one). */
  actualBalance: number;
  /** True once the office has stated the actual balance for this date. */
  stated: boolean;
  /** actual − expected; NULL until the actual balance is stated. */
  difference: number | null;
  savedAt: number | null;
  savedByName: string | null;
};

/**
 * Pure statement builder — no DB access. `clearedList` is already the
 * cumulative tick set for the statement; `statedActual` is the saved pass-book
 * balance or null. Exported so the tests can run it without a Convex context.
 */
export function buildBankReconStatement(
  section: CashBookSection,
  clearedList: Set<string>,
  statedActual: number | null,
  savedMeta: { savedAt: number; savedByName: string } | null = null,
): BankReconStatement {
  const entries: BankReconEntry[] = section.rows.map((r) => ({
    date: r.date,
    voucherNo: r.voucherNo,
    narration: r.narration,
    deposit: r.debit,
    withdrawal: r.credit,
    cleared: clearedList.has(r.voucherNo),
  }));
  let unclearedDeposits = 0;
  let unclearedWithdrawals = 0;
  for (const e of entries) {
    if (e.cleared) continue;
    unclearedDeposits = Math.round((unclearedDeposits + e.deposit) * 100) / 100;
    unclearedWithdrawals =
      Math.round((unclearedWithdrawals + e.withdrawal) * 100) / 100;
  }
  const bookClosing = Math.round(section.closing * 100) / 100;
  const expectedBankBalance =
    Math.round(
      (bookClosing - unclearedDeposits + unclearedWithdrawals) * 100,
    ) / 100;
  const stated = statedActual !== null;
  return {
    accountId: section.accountId,
    code: section.code,
    name: section.name,
    bookOpening: Math.round(section.opening * 100) / 100,
    bookClosing,
    entries,
    unclearedDeposits,
    unclearedWithdrawals,
    expectedBankBalance,
    actualBalance: stated ? statedActual : 0,
    stated,
    difference: stated
      ? Math.round((statedActual - expectedBankBalance) * 100) / 100
      : null,
    savedAt: savedMeta?.savedAt ?? null,
    savedByName: savedMeta?.savedByName ?? null,
  };
}

/**
 * The reconciliation workspace for one bank ledger and statement date: the
 * bank-book rows for the range, the cumulative tick set (every saved
 * statement up to `toDate`), and the saved pass-book balance when this exact
 * date was saved before.
 */
export const workspace = query({
  args: {
    societyId: v.id("societies"),
    accountId: v.id("accounts"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSociety(ctx, args.societyId);
    const data = await loadSocietyData(ctx, args.societyId);
    const account = data.accounts.find((a) => a._id === args.accountId);
    if (!account) throw new ConvexError("Bank account not found.");
    if (account.kind !== "bank_cash")
      throw new ConvexError("Only bank / cash ledgers can be reconciled.");

    // Cumulative ticks: every saved reconciliation up to and including the
    // statement date for THIS ledger contributes its cleared voucher numbers.
    const savedRows = await ctx.db
      .query("bankReconciliations")
      .withIndex("by_society_account", (q) =>
        q.eq("societyId", args.societyId).eq("accountId", args.accountId),
      )
      .collect();
    const clearedList = new Set<string>();
    for (const r of savedRows) {
      if (r.toDate > args.toDate) continue;
      for (const n of r.clearedVoucherNos) clearedList.add(n);
    }
    // The exact statement date's row also states the actual balance.
    const exact = savedRows.find((r) => r.toDate === args.toDate) ?? null;

    const section =
      computeCashBook(data, args.fromDate, args.toDate, args.accountId).find(
        (s) => s.accountId === args.accountId,
      ) ??
      // A bank ledger with no opening and no movements is suppressed by the
      // cash-book — reconstruct the zero section so the statement still opens.
      {
        accountId: account._id,
        code: account.code,
        name: account.name,
        opening: account.openingBalance,
        rows: [],
        totalDebit: 0,
        totalCredit: 0,
        closing: account.openingBalance,
      };
    return buildBankReconStatement(
      section as CashBookSection,
      clearedList,
      exact ? exact.actualBalance : null,
      exact ? { savedAt: exact.savedAt, savedByName: exact.savedByName } : null,
    );
  },
});

/** Save / update the reconciliation for a bank ledger and statement date. */
export const save = mutation({
  args: {
    societyId: v.id("societies"),
    accountId: v.id("accounts"),
    toDate: v.string(),
    /** Balance as per the books at toDate — carried for the audit trail. */
    bookBalance: v.number(),
    actualBalance: v.number(),
    clearedVoucherNos: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSocietyWrite(ctx, args.societyId);
    const data = await loadSocietyData(ctx, args.societyId);
    const account = data.accounts.find((a) => a._id === args.accountId);
    if (!account) throw new ConvexError("Bank account not found.");
    if (account.kind !== "bank_cash")
      throw new ConvexError("Only bank / cash ledgers can be reconciled.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.toDate))
      throw new ConvexError("Statement date must be a YYYY-MM-DD date.");

    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    const savedByName = user?.name || user?.email || "Someone";

    // One row per (account, toDate) — re-saving replaces it.
    const exact = await ctx.db
      .query("bankReconciliations")
      .withIndex("by_society_account", (q) =>
        q.eq("societyId", args.societyId).eq("accountId", args.accountId),
      )
      .filter((q) => q.eq(q.field("toDate"), args.toDate))
      .first();

    const payload = {
      societyId: args.societyId,
      accountId: args.accountId,
      toDate: args.toDate,
      bookBalance: Math.round(args.bookBalance * 100) / 100,
      actualBalance: Math.round(args.actualBalance * 100) / 100,
      clearedVoucherNos: args.clearedVoucherNos.slice(0, 500),
      note: args.note,
      savedById: userId,
      savedByName,
      savedAt: Date.now(),
    };

    if (exact) await ctx.db.patch(exact._id, payload);
    else await ctx.db.insert("bankReconciliations", payload);
    return { ok: true as const };
  },
});
