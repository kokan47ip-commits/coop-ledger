import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { isSoftwareAdmin } from "./lib";
import { hashPassword } from "./passwordHash";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

/**
 * Admin override: set (or reset) the password of any account by email,
 * without knowing the current one. Only a software admin may call this.
 * Use for lockouts where "Forgot password?" is not enough.
 */
export const adminSetPassword = mutation({
  args: {
    email: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, { email, newPassword }) => {
    const callerId = await getAuthUserId(ctx);
    if (!callerId) throw new ConvexError("Not signed in.");
    if (!(await isSoftwareAdmin(ctx, callerId))) {
      throw new ConvexError("Only a software admin can reset passwords.");
    }
    if (newPassword.length < 8 || !/\d/.test(newPassword)) {
      throw new ConvexError(
        "New password must be at least 8 characters and contain a number.",
      );
    }
    const normalized = email.toLowerCase().trim();
    const target = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();
    if (!target) {
      throw new ConvexError(
        "No account exists for that email — they must sign in once first.",
      );
    }
    const secret = await hashPassword(newPassword);
    // The Password provider signs in by providerAccountId (the email) with a
    // .unique() lookup — duplicates there break sign-in irrecoverably. So the
    // canonical check is by EMAIL first: any password credential row for this
    // email that points at a DIFFERENT user row is stale and must go.
    const byEmail = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", normalized),
      )
      .collect();
    for (const stale of byEmail) {
      if (stale.userId !== target._id) await ctx.db.delete(stale._id);
    }
    // Then dedupe rows owned by the target user itself (keep the newest).
    const rows = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", target._id).eq("provider", "password"),
      )
      .collect();
    if (rows.length > 0) {
      const newest = rows.reduce((a, b) =>
        a._creationTime >= b._creationTime ? a : b,
      );
      for (const row of rows) {
        if (row._id !== newest._id) await ctx.db.delete(row._id);
      }
      await ctx.db.patch(newest._id, { secret });
      // Clear any sign-in lockout so the fresh password works immediately.
      const limits = await ctx.db
        .query("authRateLimits")
        .withIndex("identifier", (q) => q.eq("identifier", newest._id))
        .collect();
      for (const l of limits) await ctx.db.delete(l._id);
    } else {
      const accountId = await ctx.db.insert("authAccounts", {
        userId: target._id,
        provider: "password",
        providerAccountId: normalized,
        secret,
      });
      const limits = await ctx.db
        .query("authRateLimits")
        .withIndex("identifier", (q) => q.eq("identifier", accountId))
        .collect();
      for (const l of limits) await ctx.db.delete(l._id);
    }
    return true;
  },
});
