import { v } from "convex/values";
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
  },
  handler: async (ctx, { societyId, period, issueDate, dueDate, arrearsDate, memberIds }) => {
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
    const allTariffs = await ctx.db
      .query("tariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const tariffs = allTariffs.filter((t) => t.isActive);
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
      const memberOverrides = overrides.filter((o) => o.memberId === memberId);
      const lines = tariffs
        .map((t) => {
          const o = memberOverrides.find((x) => x.tariffId === t._id);
          const base = o ? o.amount : t.amount;
          if (base <= 0) return null;
          return { tariffId: t._id, accountId: t.accountId, name: t.name, amount: base };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
      if (lines.length === 0) {
        skipped++;
        continue;
      }
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
      const total = lines.reduce((s, l) => s + l.amount, 0) + openingCarried;
      const insertLines =
        openingCarried > 0 && receivableId
          ? [
              {
                tariffId: undefined,
                accountId: receivableId,
                name: "Arrears — opening balance",
                amount: openingCarried,
              },
              ...lines,
            ]
          : lines;
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
    await ctx.db.patch(id, { lines: [...arrearsLines, ...chargeLines], total, status });
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
