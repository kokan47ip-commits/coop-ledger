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
    // Clean up this tariff's per-member overrides.
    const overrides = await ctx.db
      .query("memberTariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const o of overrides.filter((o) => o.tariffId === id)) {
      await ctx.db.delete(o._id);
    }
    await ctx.db.delete(id);
  },
});

/** Every per-member override, for the editable member × tariff matrix. */
export const listOverrides = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("memberTariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

/**
 * Set (or clear) one member's amount for one tariff from the matrix.
 * amount 0 exempts the member from that charge; null clears the override so
 * the schedule amount applies again.
 */
export const setMemberOverride = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    tariffId: v.id("tariffs"),
    amount: v.optional(v.number()), // undefined = clear override
  },
  handler: async (ctx, { societyId, memberId, tariffId, amount }) => {
    await requireSociety(ctx, societyId);
    const existing = await ctx.db
      .query("memberTariffs")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", memberId),
      )
      .collect();
    const row = existing.find((o) => o.tariffId === tariffId);
    if (amount === undefined) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    if (row) {
      await ctx.db.patch(row._id, { amount });
    } else {
      await ctx.db.insert("memberTariffs", { societyId, memberId, tariffId, amount });
    }
  },
});
