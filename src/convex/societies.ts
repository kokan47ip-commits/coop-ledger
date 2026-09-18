import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_ACCOUNTS, requireUserId } from "./lib";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("societies")
      .withIndex("by_creator", (q) => q.eq("createdBy", userId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("societies") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.createdBy !== userId) return null;
    return s;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    registrationNo: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    fyStartMonth: v.number(),
    withSampleData: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const societyId = await ctx.db.insert("societies", {
      name: args.name,
      registrationNo: args.registrationNo,
      address: args.address,
      city: args.city,
      state: args.state,
      pincode: args.pincode,
      email: args.email,
      phone: args.phone,
      fyStartMonth: args.fyStartMonth,
      createdBy: userId,
    });
    for (const a of DEFAULT_ACCOUNTS) {
      await ctx.db.insert("accounts", {
        societyId,
        code: a.code,
        name: a.name,
        type: a.type,
        kind: a.kind,
        openingBalance: 0,
      });
    }
    return societyId;
  },
});

export const update = mutation({
  args: {
    id: v.id("societies"),
    name: v.string(),
    registrationNo: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    fyStartMonth: v.number(),
    receivableAccountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUserId(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.createdBy !== userId) throw new Error("Society not found.");
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("societies") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.createdBy !== userId) throw new Error("Society not found.");
    for (const table of [
      "vouchers",
      "bills",
      "tariffs",
      "members",
      "accounts",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_society", (q) => q.eq("societyId", id))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(id);
  },
});
