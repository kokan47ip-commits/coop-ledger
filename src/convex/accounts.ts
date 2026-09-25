import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";

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
