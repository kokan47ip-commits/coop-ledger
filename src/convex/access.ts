import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import {
  isSoftwareAdmin,
  requireSociety,
  requireUserId,
  societyAccess,
  type SocietyAccess,
} from "./lib";

const emailField = v.string();
const menuKeysField = v.optional(v.array(v.string()));

/**
 * Owner or software admin — the two roles allowed to manage a society's user
 * rights. Returns the caller's user id.
 */
async function requireRightsManager(
  ctx: QueryCtx,
  society: Awaited<ReturnType<typeof requireSociety>>,
): Promise<Id<"users">> {
  const callerId = await requireUserId(ctx);
  const isOwner = society.createdBy === callerId;
  if (!isOwner && !(await isSoftwareAdmin(ctx, callerId))) {
    throw new Error(
      "Only the society owner or a software admin can manage user rights.",
    );
  }
  return callerId;
}

/** All grants for a society — owner/software-admin only. */
export const listForSociety = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const society = await ctx.db.get(societyId);
    if (!society) return [];
    const callerId = await requireUserId(ctx);
    const canManage =
      society.createdBy === callerId || (await isSoftwareAdmin(ctx, callerId));
    if (!canManage) return []; // editors/viewers never see the roster
    const grants = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    // Attach display names for users who have already signed up.
    const withNames = await Promise.all(
      grants.map(async (g) => {
        const user = g.userId ? await ctx.db.get(g.userId) : null;
        return {
          _id: g._id,
          email: g.email,
          role: g.role,
          menus: g.menus ?? null,
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

/** The caller's allowed menus over a society (null = everything). */
export const myMenus = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { menus: [] as string[] | null, admin: false };
    const society = await ctx.db.get(societyId);
    if (!society) return { menus: [] as string[] | null, admin: false };
    const access = await societyAccess(ctx, society, userId);
    if (access === "none") return { menus: [] as string[] | null, admin: false };
    const menus = await allowedMenusHelper(ctx, society, userId, access);
    return { menus, admin: await isSoftwareAdmin(ctx, userId) };
  },
});

async function allowedMenusHelper(
  ctx: QueryCtx,
  society: NonNullable<Awaited<ReturnType<typeof ctx.db.get<"societies">>>>,
  userId: Id<"users">,
  access: SocietyAccess,
): Promise<string[] | null> {
  if (access === "owner" || (await isSoftwareAdmin(ctx, userId))) return null;
  const user = await ctx.db.get(userId);
  const email = user?.email?.toLowerCase().trim() ?? null;
  if (!email) return [];
  const grants = await ctx.db
    .query("membersAccess")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const grant = grants.find((g) => g.userId === userId || g.email === email);
  if (!grant) return [];
  return grant.menus && grant.menus.length > 0 ? grant.menus : null;
}

/** Create/update a grant by email, with explicit menu rights. */
export const grant = mutation({
  args: {
    societyId: v.id("societies"),
    email: emailField,
    role: v.union(v.literal("editor"), v.literal("viewer")),
    menus: menuKeysField,
  },
  handler: async (ctx, { societyId, email, role, menus }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireRightsManager(ctx, society);
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
      await ctx.db.patch(existing._id, { role, menus });
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
      menus,
      userId: targetUser?._id,
      grantedBy: callerId,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/** Grant access to one of the society's registered members, with menus. */
export const grantFromMember = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    email: emailField,
    role: v.union(v.literal("editor"), v.literal("viewer")),
    menus: menuKeysField,
  },
  handler: async (ctx, { societyId, memberId, email, role, menus }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireRightsManager(ctx, society);
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
      await ctx.db.patch(existing._id, { role, menus });
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
      menus,
      userId: targetUser?._id,
      grantedBy: callerId,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/** Change an existing grant's role. */
export const setRole = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("membersAccess"),
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, { societyId, id, role }) => {
    const society = await requireSociety(ctx, societyId);
    await requireRightsManager(ctx, society);
    const grantRow = await ctx.db.get(id);
    if (!grantRow || grantRow.societyId !== societyId) {
      throw new Error("Grant not found.");
    }
    await ctx.db.patch(id, { role });
  },
});

/** Change which menus a granted user can open. */
export const setMenus = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("membersAccess"),
    menus: v.array(v.string()),
  },
  handler: async (ctx, { societyId, id, menus }) => {
    const society = await requireSociety(ctx, societyId);
    await requireRightsManager(ctx, society);
    const grantRow = await ctx.db.get(id);
    if (!grantRow || grantRow.societyId !== societyId) {
      throw new Error("Grant not found.");
    }
    // Empty list = all non-admin menus (server default), so store undefined.
    await ctx.db.patch(id, { menus: menus.length > 0 ? menus : undefined });
  },
});

/** Remove a user's access. */
export const revoke = mutation({
  args: { societyId: v.id("societies"), id: v.id("membersAccess") },
  handler: async (ctx, { societyId, id }) => {
    const society = await requireSociety(ctx, societyId);
    await requireRightsManager(ctx, society);
    const grantRow = await ctx.db.get(id);
    if (!grantRow || grantRow.societyId !== societyId) {
      throw new Error("Grant not found.");
    }
    await ctx.db.delete(id);
  },
});

/* ------------------------- Software administrators ----------------------- */

/** List software admins — software-admin-only. */
export const listSoftwareAdmins = query({
  args: {},
  handler: async (ctx) => {
    const callerId = await requireUserId(ctx);
    if (!(await isSoftwareAdmin(ctx, callerId))) return [];
    const admins = await ctx.db.query("users").collect();
    return admins
      .filter((u) => u.softwareAdmin === true && !u.isAnonymous)
      .map((u) => ({
        _id: u._id,
        email: u.email ?? "",
        name: u.name ?? null,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  },
});

/**
 * Promote/demote a user to software admin by email. If no account exists yet
 * the flag lands on the account created when they sign up with that email —
 * handled by bindSoftwareAdminFlag on sign-in.
 */
export const setSoftwareAdmin = mutation({
  args: { email: emailField, admin: v.boolean() },
  handler: async (ctx, { email, admin }) => {
    const callerId = await requireUserId(ctx);
    if (!(await isSoftwareAdmin(ctx, callerId))) {
      throw new Error("Only a software admin can grant admin rights.");
    }
    const normalized = email.toLowerCase().trim();
    const target = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();
    if (!target) {
      throw new Error(
        "No account exists for that email yet — ask them to sign in once, then promote them.",
      );
    }
    await ctx.db.patch(target._id, { softwareAdmin: admin });
  },
});

/**
 * Called on society open: any pending email grants for the signed-in user are
 * bound to their account, so an invitation issued before sign-up activates
 * on first login. Also bootstraps the very first software admin: if no admin
 * exists yet, the first real (non-anonymous, email-backed) account is
 * promoted automatically so administration is never locked out.
 */
export const bindPendingGrants = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    const email = user?.email?.toLowerCase().trim();
    if (!email || user?.isAnonymous) return 0;

    // Bootstrap: the first real account becomes the software admin.
    const existingAdmins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("softwareAdmin"), true))
      .collect();
    if (existingAdmins.length === 0) {
      await ctx.db.patch(userId, { softwareAdmin: true });
    }

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
