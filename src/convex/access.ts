import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireSociety,
  requireSocietyWrite,
  requireUserId,
  societyAccess,
  type SocietyAccess,
} from "./lib";

const emailField = v.string();

/**
 * All grants for a society. Readable by any member of the society, but the
 * user list itself is only meaningful to the owner — the UI hides it for
 * editors/viewers and write operations below stay owner-only.
 */
export const listForSociety = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const society = await ctx.db.get(societyId);
    if (!society) return [];
    const callerId = await requireUserId(ctx);
    const isOwner = society.createdBy === callerId;
    const grants = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (!isOwner) return []; // viewers/editors never see the roster
    // Attach display names for users who have already signed up.
    const withNames = await Promise.all(
      grants.map(async (g) => {
        const user = g.userId ? await ctx.db.get(g.userId) : null;
        return {
          _id: g._id,
          email: g.email,
          role: g.role,
          createdAt: g.createdAt,
          joined: !!g.userId,
          name: user?.name ?? null,
        };
      }),
    );
    return withNames.sort((a, b) => a.email.localeCompare(b.email));
  },
});

/** The caller's own access level over a society — powers UI gating. */
export const myAccess = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return "none" as SocietyAccess;
    const society = await ctx.db.get(societyId);
    if (!society) return "none" as SocietyAccess;
    return await societyAccess(ctx, society, userId);
  },
});

/**
 * Invite a user by email with a role. If the email belongs to an existing
 * user, the grant links to their account immediately; otherwise it links on
 * their first sign-in with that email.
 */
export const grant = mutation({
  args: {
    societyId: v.id("societies"),
    email: emailField,
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, { societyId, email, role }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (society.createdBy !== callerId) {
      throw new Error("Only the society owner can manage user rights.");
    }
    const normalized = email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new Error("Enter a valid email address.");
    }
    if (society.createdBy) {
      const owner = await ctx.db.get(society.createdBy);
      if (owner?.email?.toLowerCase() === normalized) {
        throw new Error(
          "This email already owns the society — no invitation needed.",
        );
      }
    }

    const grants = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const existing = grants.find((g) => g.email === normalized);
    if (existing) {
      await ctx.db.patch(existing._id, { role });
      return { id: existing._id, updated: true };
    }

    // Link to an existing account when we can find one by email.
    const targetUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();

    const id = await ctx.db.insert("membersAccess", {
      societyId,
      email: normalized,
      role,
      userId: targetUser?._id,
      grantedBy: callerId,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/**
 * Grant access to one of the society's registered members. The admin picks a
 * member from the register and the email they will sign in with; the email is
 * saved onto the member's profile when they don't have one yet, then the
 * grant is created exactly like an email invite.
 */
export const grantFromMember = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    email: emailField,
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, { societyId, memberId, email, role }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (society.createdBy !== callerId) {
      throw new Error("Only the society owner can manage user rights.");
    }
    const member = await ctx.db.get(memberId);
    if (!member || member.societyId !== societyId) {
      throw new Error("Member not found in this society.");
    }
    const normalized = email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new Error("Enter a valid email address for the member's login.");
    }
    const owner = society.createdBy ? await ctx.db.get(society.createdBy) : null;
    if (owner?.email?.toLowerCase() === normalized) {
      throw new Error(
        "This email already owns the society — no access grant needed.",
      );
    }

    // Keep the member's contact details in sync so the register shows the
    // login email that was assigned here.
    if (member.email?.toLowerCase().trim() !== normalized) {
      await ctx.db.patch(member._id, { email: normalized });
    }

    const grants = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const existing = grants.find((g) => g.email === normalized);
    if (existing) {
      await ctx.db.patch(existing._id, { role });
      return { id: existing._id, updated: true };
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();

    const id = await ctx.db.insert("membersAccess", {
      societyId,
      email: normalized,
      role,
      userId: targetUser?._id,
      grantedBy: callerId,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/** Change an existing grant's role (owner-only). */
export const setRole = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("membersAccess"),
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, { societyId, id, role }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (society.createdBy !== callerId) {
      throw new Error("Only the society owner can manage user rights.");
    }
    const grantRow = await ctx.db.get(id);
    if (!grantRow || grantRow.societyId !== societyId) {
      throw new Error("Grant not found.");
    }
    await ctx.db.patch(id, { role });
  },
});

/** Remove a user's access (owner-only). */
export const revoke = mutation({
  args: { societyId: v.id("societies"), id: v.id("membersAccess") },
  handler: async (ctx, { societyId, id }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (society.createdBy !== callerId) {
      throw new Error("Only the society owner can manage user rights.");
    }
    const grantRow = await ctx.db.get(id);
    if (!grantRow || grantRow.societyId !== societyId) {
      throw new Error("Grant not found.");
    }
    await ctx.db.delete(id);
  },
});

/**
 * Called on society open: any pending email grants for the signed-in user are
 * bound to their account, so an invitation issued before sign-up activates
 * on first login.
 */
export const bindPendingGrants = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    const email = user?.email?.toLowerCase().trim();
    if (!email) return 0;
    const pending = await ctx.db
      .query("membersAccess")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    let bound = 0;
    for (const g of pending) {
      if (!g.userId) {
        await ctx.db.patch(g._id, { userId });
        bound++;
      }
    }
    return bound;
  },
});
