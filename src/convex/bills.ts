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
            name: t.name,
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
      // earlier bills) at generation time. A percent rate is per month —
      // bills are monthly, so 1.5% ≈ 18% per annum. Charged only when the
      // member is actually in arrears; 0 outstanding → no charge.
      const outstandingBefore = existing
        .filter((b) => b.period < period)
        .reduce((s, b) => s + (b.total - b.paidAmount), 0);
      const interestAmount =
        outstandingBefore > 0 && interestAccount
          ? interestMode === "percent" && interestRate > 0
            ? Math.round(outstandingBefore * (interestRate / 100) * 100) / 100
            : interestMode === "fixed"
              ? interestFixed
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
      // Opening receivable carried as a separate arrears line on the member's
      // first bill — it appears on the printed bill and flows into the books
      // (Dr receivable), while charge-head income stays untouched.
      const hasEarlierBills = existing.some(
        (b) => b.period < period || (b.period === period && b.issueDate <= issueDate),
      );
      const openingCarried =
        member.openingBalance > 0 && !hasEarlierBills && receivableId
          ? member.openingBalance
          : 0;
      const total = allLines.reduce((s, l) => s + l.amount, 0) + openingCarried;
      const insertLines =
        openingCarried > 0 && receivableId
          ? [
              {
                tariffId: undefined,
                accountId: receivableId,
                name: "Arrears — opening balance",
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
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const allocated = new Set<Id<"bills">>();
    for (const vch of vouchers) {
      for (const a of vch.allocations ?? []) allocated.add(a.billId);
    }
    let deleted = 0;
    let blocked = 0;
    for (const b of inPeriod) {
      if (allocated.has(b._id) || b.paidAmount > 0) {
        blocked++;
        continue;
      }
      await ctx.db.delete(b._id);
      deleted++;
    }
    return { deleted, blocked };
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
    // Arrears is computed from earlier bills at print/report time; the grid
    // only edits current-period charge heads, so keep any arrears line as-is.
    const isArrearsLine = (name: string) => name.toLowerCase().startsWith("arrears");
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
      return t ? { ...l, printNo: t.printNo } : l;
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
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (vouchers.some((v) => (v.allocations ?? []).some((a) => a.billId === id)))
      throw new Error("Bill has receipts allocated; remove them first.");
    await ctx.db.delete(id);
  },
});
