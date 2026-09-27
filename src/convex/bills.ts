import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertInFy, nextNumber, pad, requireSociety, requireSocietyWrite } from "./lib";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("bills")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const listByPeriod = query({
  args: { societyId: v.id("societies"), period: v.string() },
  handler: async (ctx, { societyId, period }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("bills")
      .withIndex("by_society_period", (q) =>
        q.eq("societyId", societyId).eq("period", period),
      )
      .collect();
  },
});

export const listByMember = query({
  args: { societyId: v.id("societies"), memberId: v.id("members") },
  handler: async (ctx, { societyId, memberId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", memberId),
      )
      .collect();
  },
});

export const generate = mutation({
  args: {
    societyId: v.id("societies"),
    period: v.string(),
    issueDate: v.string(),
    dueDate: v.string(),
    /** As-on date for computing the arrears carried into these bills. */
    arrearsDate: v.optional(v.string()),
    memberIds: v.array(v.id("members")),
    /** Interest / late fee on the outstanding balance at generation. */
    interestMode: v.optional(
      v.union(v.literal("none"), v.literal("percent"), v.literal("fixed")),
    ),
    /** Percent mode: rate per month applied to the outstanding balance. */
    interestRate: v.optional(v.number()),
    /** Fixed mode: flat amount charged per bill cycle when in arrears. */
    interestFixed: v.optional(v.number()),
    /** Income account the interest posts to (default: Interest Income). */
    interestAccountId: v.optional(v.id("accounts")),
    /** Replace-mode: recreate this period's bills (applies new rates/amounts).
     * Bills with receipts recorded against them are kept and NOT recreated. */
    replace: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      societyId,
      period,
      issueDate,
      dueDate,
      arrearsDate,
      memberIds,
      interestMode = "none",
      interestRate = 0,
      interestFixed = 0,
      interestAccountId,
      replace = false,
    },
  ) => {
    const society = await requireSocietyWrite(ctx, societyId);
    // Bills post income to the books — decline bills issued outside the year.
    assertInFy(society, issueDate, "Bill");
    const receivableId =
      society.receivableAccountId ??
      (await ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect())
        .find((a) => a.kind === "receivable")?._id;
    // Interest / late fee: resolve the income account once, up front.
    const wantsInterest =
      (interestMode === "percent" && interestRate > 0) ||
      (interestMode === "fixed" && interestFixed > 0);
    let interestAccount: Doc<"accounts"> | undefined;
    if (wantsInterest) {
      const accounts = await ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
      interestAccount = interestAccountId
        ? accounts.find(
            (a) => a._id === interestAccountId && a.societyId === societyId,
          )
        : accounts.find(
            (a) =>
              a.type === "income" &&
              a.name.toLowerCase().includes("interest"),
          ) ??
          accounts
            .filter((a) => a.type === "income")
            .sort((a, b) => a.code.localeCompare(b.code))[0];
      if (!interestAccount)
        throw new Error(
          "No income account found to post interest to — add one in Chart of Accounts (e.g. Interest Income).",
        );
    }
    // Replace-mode: drop the period's bills that carry no receipts so new
    // rates/interest take effect, keeping at most one receipted bill per
    // member (payments stay pointed at a live bill of the same member+period).
    if (replace) {
      const vouchers = await ctx.db
        .query("vouchers")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
      const allocated = new Set<Id<"bills">>();
      for (const vch of vouchers) {
        for (const a of vch.allocations ?? []) allocated.add(a.billId);
      }
      const allBills = await ctx.db
        .query("bills")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect();
      const byMember = new Map<string, Doc<"bills">[]>();
      for (const b of allBills.filter((x) => x.period === period)) {
        byMember.set(b.memberId, [...(byMember.get(b.memberId) ?? []), b]);
      }
      for (const [, list] of byMember) {
        const keep = list.filter((b) => allocated.has(b._id) || b.paidAmount > 0);
        for (const b of keep.slice(1)) await ctx.db.delete(b._id);
        for (const b of list.filter((x) => !keep.includes(x))) await ctx.db.delete(b._id);
      }
    }
    const allTariffs = await ctx.db
      .query("tariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    // Print order: heads with a serial no. come first in serial order, then
    // the rest alphabetically — so generated bills print in the chosen order.
    const printOrder = (
      a: { printNo?: string; name: string },
      b: { printNo?: string; name: string },
    ) =>
      (a.printNo ?? "").localeCompare(b.printNo ?? "", undefined, {
        numeric: true,
      }) || a.name.localeCompare(b.name);
    const tariffs = allTariffs.filter((t) => t.isActive).sort(printOrder);
    if (tariffs.length === 0)
      throw new Error("Add active tariffs before generating bills.");
    const overrides = await ctx.db
      .query("memberTariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    let created = 0;
    let skipped = 0;
    for (const memberId of memberIds) {
      const member = await ctx.db.get(memberId);
      if (!member || member.societyId !== societyId || !member.isActive) {
        skipped++;
        continue;
      }
      const existing = await ctx.db
        .query("bills")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", societyId).eq("memberId", memberId),
        )
        .collect();
      // Without replace-mode a second generation for the same period is a
      // no-op; with replace-mode unpaid bills were already deleted above.
      if (existing.some((b) => b.period === period)) {
        skipped++;
        continue;
      }
      // Per-member custom amounts from the tariff upload, falling back to the
      // schedule amount. An override of 0 exempts the member from the head.
      // Each line carries the tariff's printing serial no. so printed bills
      // keep the head order chosen on the Tariff Schedule.
      const memberOverrides = overrides.filter((o) => o.memberId === memberId);
      const lines = tariffs
        .map((t) => {
          const o = memberOverrides.find((x) => x.tariffId === t._id);
          const base = o ? o.amount : t.amount;
          if (base <= 0) return null;
          return {
            tariffId: t._id,
            accountId: t.accountId,
            // Print label: short name when set, else the full head name.
            name: t.shortName?.trim() || t.name,
            amount: base,
            printNo: t.printNo,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
      if (lines.length === 0) {
        skipped++;
        continue;
      }
      // Interest / late fee on the member's outstanding balance (unpaid
      // earlier bills, minus advance credits) at generation time. A percent
      // rate is per month — bills are monthly, so 1.5% ≈ 18% per annum.
      // Charged only when the member is actually in arrears; a net advance
      // (credit balance) is never charged interest.
      // Net outstanding = unpaid earlier bills + opening balance (a credit
      // opening REDUCES the dues; only a net positive balance is charged).
      const outstandingBefore =
        existing.filter((b) => b.period < period).reduce((s, b) => s + (b.total - b.paidAmount), 0) +
        member.openingBalance;
      // Interest is rounded to the nearest rupee in both modes — printed
      // bills never carry paise on the interest head.
      const interestAmount =
        outstandingBefore > 0 && interestAccount
          ? interestMode === "percent" && interestRate > 0
            ? Math.round(outstandingBefore * (interestRate / 100))
            : interestMode === "fixed"
              ? Math.round(interestFixed)
              : 0
          : 0;
      const allLines =
        interestAmount > 0 && interestAccount
          ? [
              ...lines,
              {
                tariffId: undefined,
                accountId: interestAccount._id,
                name:
                  interestMode === "percent"
                    ? `Interest on arrears @ ${interestRate}% p.m.`
                    : "Late fee on outstanding dues",
                amount: interestAmount,
                printNo: undefined,
              },
            ]
          : lines;
      // Opening balance carried as a separate arrears line on the member's
      // first bill — positive (dues) appears on the printed bill and flows
      // into the books (Dr receivable). A NEGATIVE opening (advance/credit)
      // is carried the same way: the printed bill shows it as a deducted
      // credit balance, and the books credit the receivable (advance) so the
      // receivable total stays equal to the sum of member ledgers.
      const hasEarlierBills = existing.some(
        (b) => b.period < period || (b.period === period && b.issueDate <= issueDate),
      );
      const openingCarried =
        member.openingBalance !== 0 && !hasEarlierBills && receivableId
          ? member.openingBalance
          : 0;
      const total = allLines.reduce((s, l) => s + l.amount, 0) + openingCarried;
      const insertLines =
        openingCarried !== 0 && receivableId
          ? [
              {
                tariffId: undefined,
                accountId: receivableId,
                name:
                  openingCarried > 0
                    ? "Arrears — opening balance"
                    : "Credit balance — advance adjusted",
                // Negative amount = deduction on the printed bill.
                amount: openingCarried,
              },
              ...allLines,
            ]
          : allLines;
      const n = await nextNumber(ctx, `${societyId}:bill`);
      await ctx.db.insert("bills", {
        societyId,
        billNo: `BILL-${pad(n)}`,
        memberId,
        period,
        issueDate,
        dueDate,
        arrearsDate,
        lines: insertLines,
        total,
        paidAmount: 0,
        status: "unpaid",
      });
      created++;
    }
    return { created, skipped };
  },
});

/**
 * Delete every bill of one billing period in one go (admin bulk action).
 * Bills with receipts recorded against them are kept — receipts must be
 * deleted first. Returns both counts so the UI can report what happened.
 */
export const removeByPeriod = mutation({
  args: { societyId: v.id("societies"), period: v.string() },
  handler: async (ctx, { societyId, period }) => {
    await requireSocietyWrite(ctx, societyId);
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const inPeriod = bills.filter((b) => b.period === period);
    if (inPeriod.length === 0) return { deleted: 0, blocked: 0 };
    const inPeriodIds = new Set(inPeriod.map((b) => b._id));
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const allocated = new Set<Id<"bills">>();
    for (const vch of vouchers) {
      for (const a of vch.allocations ?? []) allocated.add(a.billId);
    }
    // Detach allocations from receipts instead of refusing to delete: the
    // receipt remains as a credit (advance) on the member's ledger.
    let deleted = 0;
    for (const b of inPeriod) {
      await ctx.db.delete(b._id);
      deleted++;
    }
    for (const vch of vouchers) {
      const allocs = (vch.allocations ?? []).filter((a) => !inPeriodIds.has(a.billId));
      if (allocs.length !== (vch.allocations ?? []).length) {
        await ctx.db.patch(vch._id, { allocations: allocs.length > 0 ? allocs : undefined });
      }
    }
    // `blocked` stays 0 for the register UI: allocations are detached from
    // receipts instead of ever blocking the delete.
    return { deleted, blocked: 0 };
  },
});

/**
 * Editable bill grid: replace a bill's charge lines (excluding its arrears
 * line) with edited amounts and recompute the total. Receipts already
 * allocated to the bill are protected — paid amount cannot exceed the new
 * total.
 */
export const updateLines = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("bills"),
    lines: v.array(
      v.object({
        tariffId: v.optional(v.id("tariffs")),
        accountId: v.id("accounts"),
        name: v.string(),
        amount: v.number(),
        printNo: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { societyId, id, lines }) => {
    await requireSocietyWrite(ctx, societyId);
    const bill = await ctx.db.get(id);
    if (!bill || bill.societyId !== societyId)
      throw new Error("Bill not found.");
    // Arrears/credit-balance lines are computed at generation/print time; the
    // grid only edits current-period charge heads, so keep them as-is.
    const isArrearsLine = (name: string) => {
      const n = name.toLowerCase();
      return n.startsWith("arrears") || n.startsWith("credit balance");
    };
    const arrearsLines = (bill.lines ?? []).filter((l) => isArrearsLine(l.name));
    const chargeLines = lines.filter((l) => !isArrearsLine(l.name) && l.amount !== 0);
    const total =
      chargeLines.reduce((s, l) => s + l.amount, 0) +
      arrearsLines.reduce((s, l) => s + l.amount, 0);
    if (total < bill.paidAmount)
      throw new Error(
        `Total (${total}) cannot be less than already received (${bill.paidAmount}).`,
      );
    const status =
      bill.paidAmount <= 0 ? "unpaid" : bill.paidAmount >= total ? "paid" : "partial";
    // Re-stamp printing serials from the current tariff schedule so grid edits
    // never drop the print order chosen on the Tariff Schedule.
    const allTariffs = await ctx.db
      .query("tariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const stamped = chargeLines.map((l) => {
      const t = l.tariffId
        ? allTariffs.find((x) => x._id === l.tariffId)
        : undefined;
      // Re-stamp both print order and the short-name print label so grid edits
      // follow the tariff schedule, not the generation-time wording.
      return t
        ? { ...l, printNo: t.printNo, name: t.shortName?.trim() || t.name }
        : l;
    });
    await ctx.db.patch(id, { lines: [...arrearsLines, ...stamped], total, status });
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("bills") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
    const bill = await ctx.db.get(id);
    if (!bill || bill.societyId !== societyId)
      throw new Error("Bill not found.");
    // Bills and receipts are separate entities: the bill is the debit, the
    // receipt the credit on the member's ledger. Deleting a bill only removes
    // the debit — the receipt stays as a legitimate ledger credit (an advance
    // when nothing else is due). Paid/partial status is a settlement view,
    // not an accounting fact.
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const vch of vouchers) {
      const allocs = (vch.allocations ?? []).filter((a) => a.billId !== id);
      if (allocs.length !== (vch.allocations ?? []).length) {
        await ctx.db.patch(vch._id, {
          allocations: allocs.length > 0 ? allocs : undefined,
        });
      }
    }
    await ctx.db.delete(id);
  },
});
