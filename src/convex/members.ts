import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSociety } from "./lib";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const get = query({
  args: { societyId: v.id("societies"), id: v.id("members") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db.get(id);
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("members")),
    code: v.string(),
    name: v.string(),
    flatNo: v.optional(v.string()),
    wing: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    ownershipType: v.optional(v.union(v.literal("owner"), v.literal("tenant"))),
    joinDate: v.optional(v.string()),
    openingBalance: v.number(),
    openingDate: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, { societyId, id, ...data }) => {
    await requireSociety(ctx, societyId);
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("members", { societyId, ...data });
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("members") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", id),
      )
      .collect();
    if (bills.length > 0)
      throw new Error("Member has bills; remove bills first.");
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", id),
      )
      .collect();
    if (vouchers.length > 0)
      throw new Error("Member has vouchers; remove them first.");
    const memberTariffs = await ctx.db
      .query("memberTariffs")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", id),
      )
      .collect();
    for (const mt of memberTariffs) await ctx.db.delete(mt._id);
    await ctx.db.delete(id);
  },
});
