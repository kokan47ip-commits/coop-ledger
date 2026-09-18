import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSociety } from "./lib";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("tariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("tariffs")),
    name: v.string(),
    accountId: v.id("accounts"),
    amount: v.number(),
    unit: v.optional(v.union(v.literal("flat"), v.literal("member"))),
    isActive: v.boolean(),
  },
  handler: async (ctx, { societyId, id, ...data }) => {
    await requireSociety(ctx, societyId);
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("tariffs", { societyId, ...data });
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("tariffs") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (bills.some((b) => b.lines.some((l) => l.tariffId === id)))
      throw new Error("Tariff is used in generated bills.");
    await ctx.db.delete(id);
  },
});
