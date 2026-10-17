import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";
import { duplicateMemberError } from "./ownership";

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
    building: v.optional(v.string()),
    unitType: v.optional(v.string()),
    floor: v.optional(v.string()),
    buildupArea: v.optional(v.number()),
    carpetArea: v.optional(v.number()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    ownershipType: v.optional(v.union(v.literal("owner"), v.literal("tenant"))),
    joinDate: v.optional(v.string()),
    openingBalance: v.number(),
    openingDate: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, { societyId, id, ...data }) => {
    await requireSocietyWrite(ctx, societyId);
    // Duplicate-record guard: a member CODE may be used once per society, and
    // an ACTIVE flat cannot get a second active member row — additional
    // owners of the same flat are joint owners on the ONE row, never a
    // duplicate record (duplicate rows would double-bill the flat and split
    // its ledger balance across two accounts).
    const existing = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const dupe = duplicateMemberError(
      existing.map((m) => ({
        id: m._id,
        code: m.code,
        name: m.name,
        wing: m.wing,
        building: m.building,
        flatNo: m.flatNo,
        isActive: m.isActive,
      })),
      {
        id: id ?? undefined,
        code: data.code,
        name: data.name,
        wing: data.wing,
        building: data.building,
        flatNo: data.flatNo,
        isActive: data.isActive,
      },
    );
    if (dupe) throw new ConvexError(dupe);
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
    await requireSocietyWrite(ctx, societyId);
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
    // Ownership helpers hang off this member row — remove them with it so no
    // joint owner or flat link is left pointing at a deleted member.
    const owners = await ctx.db
      .query("memberOwners")
      .withIndex("by_member", (q) => q.eq("memberId", id))
      .collect();
    for (const o of owners) await ctx.db.delete(o._id);
    const links = await ctx.db
      .query("flatLinks")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", id),
      )
      .collect();
    for (const l of links) await ctx.db.delete(l._id);
    await ctx.db.delete(id);
  },
});
