import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { nextNumber, pad, requireSociety } from "./lib";

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
    await requireSociety(ctx, societyId);
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
      const total = lines.reduce((s, l) => s + l.amount, 0);
      const n = await nextNumber(ctx, `${societyId}:bill`);
      await ctx.db.insert("bills", {
        societyId,
        billNo: `BILL-${pad(n)}`,
        memberId,
        period,
        issueDate,
        dueDate,
        arrearsDate,
        lines,
        total,
        paidAmount: 0,
        status: "unpaid",
      });
      created++;
    }
    return { created, skipped };
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("bills") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
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
