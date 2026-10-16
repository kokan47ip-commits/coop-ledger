import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib";

/**
 * "CONTINUE WHERE YOU LEFT OFF"
 *
 * Every screen the office opens records one row here against the signed-in
 * user, newest first. The Dashboard card links straight back into the last
 * screens, so a re-visit — on any device — starts from where the session
 * ended. History is capped and same-screen revisits update the timestamp
 * instead of piling up duplicate rows.
 */
const CAP = 20;

export const record = mutation({
  args: {
    societyId: v.optional(v.id("societies")),
    path: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.path || args.path.length > 200) return;
    const userId = await requireUserId(ctx);
    const at = Date.now();
    const label = args.label.trim() || args.path;
    const rows = await ctx.db
      .query("userActivity")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    const last = rows[0];
    // Same screen as the previous record: refresh the timestamp, no new row.
    if (last && last.path === args.path && last.societyId === args.societyId) {
      await ctx.db.patch(last._id, { label, at });
      return;
    }
    for (const old of rows.slice(CAP - 1)) await ctx.db.delete(old._id);
    await ctx.db.insert("userActivity", {
      userId,
      societyId: args.societyId,
      path: args.path,
      label,
      at,
    });
  },
});

/** The signed-in user's latest screens, newest first (Dashboard card). */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("userActivity")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(6);
  },
});
