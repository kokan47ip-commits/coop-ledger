import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_GROUPS, requireSociety, requireSocietyWrite } from "./lib";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const groups = await ctx.db
      .query("accountGroups")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return groups.sort(
      (a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name),
    );
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("accountGroups")),
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("income"),
      v.literal("expense"),
    ),
    sequence: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, id, sequence, ...data }) => {
    await requireSocietyWrite(ctx, societyId);
    if (id) {
      await ctx.db.patch(id, { ...data, sequence: sequence ?? 99 });
      return id;
    }
    return await ctx.db.insert("accountGroups", {
      societyId,
      ...data,
      sequence: sequence ?? 99,
    });
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("accountGroups") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (accounts.some((a) => a.groupId === id))
      throw new Error("Group is assigned to accounts. Unassign it first.");
    await ctx.db.delete(id);
  },
});

export const seedDefaults = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSocietyWrite(ctx, societyId);
    await seedDefaultGroups(ctx, societyId);
  },
});

/** Creates the standard co-operative society groups for a society, once. */
export async function seedDefaultGroups(
  ctx: MutationCtx,
  societyId: Id<"societies">,
) {
  const existing = await ctx.db
    .query("accountGroups")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  if (existing.length > 0) return;
  for (const g of DEFAULT_GROUPS) {
    await ctx.db.insert("accountGroups", { societyId, ...g });
  }
}
