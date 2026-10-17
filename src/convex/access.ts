import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import {
  analyzePortalBinding,
  isSoftwareAdmin,
  requireSociety,
  requireUserId,
  societyAccess,
  societyMemberBinding,
  type SocietyAccess,
} from "./lib";
import { maybeClaimGuestSocieties } from "./societies";

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

/**
 * The account row for a login email, or undefined when that person has not
 * signed up yet. Grant rows are keyed by email, but they resolve faster and
 * more reliably once bound to a user id — call sites heal stale bindings.
 */
async function userByEmail(ctx: QueryCtx, email: string) {
  return ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
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
    // Attach display names (and the bound flat for member-portal grants).
    const withNames = await Promise.all(
      grants.map(async (g) => {
        const user = g.userId ? await ctx.db.get(g.userId) : null;
        const member = g.memberId ? await ctx.db.get(g.memberId) : null;
        return {
          _id: g._id,
          email: g.email,
          role: g.role,
          menus: g.menus ?? null,
          createdAt: g.createdAt,
          joined: !!g.userId,
          name: user?.name ?? null,
          memberId: g.memberId ?? null,
          memberName: member?.name ?? null,
          memberFlat: member
            ? [member.wing, member.flatNo].filter(Boolean).join("-") || member.code
            : null,
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
 * When the caller holds a "member" (flat-bound portal) grant, return the
 * bound flat so portal pages can confirm access without book queries.
 */
export const myMemberBinding = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const society = await ctx.db.get(societyId);
    if (!society) return null;
    // Shared resolution with the portal: validates the bound flat exists and
    // is active, and re-points logins whose member row was re-imported so
    // their bills/receipts show up again.
    const memberId = await societyMemberBinding(ctx, society, userId);
    if (!memberId) return null;
    const member = await ctx.db.get(memberId);
    if (!member) return null;
    return {
      memberId: member._id,
      name: member.name,
      flatNo: member.flatNo,
      wing: member.wing,
      code: member.code,
    };
  },
});

/**
 * Office-side portal diagnosis: for one login email, show which member row
 * the portal resolves it to, where the bills actually sit, and a concrete fix
 * suggestion. Owner/software-admin only. Returns counts and flat labels only
 * — never the society's book data.
 */
export const debugPortalBinding = query({
  args: { societyId: v.id("societies"), email: emailField },
  handler: async (ctx, { societyId, email }) => {
    const society = await requireSociety(ctx, societyId);
    await requireRightsManager(ctx, society);
    const normalized = email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new Error("Enter a valid email address.");
    }

    // The account row, if the member has signed in (or the office created it
    // by setting a password). Its id is what real grant rows match on.
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();
    const analysis = await analyzePortalBinding(ctx, society, normalized, user?._id);
    if (!analysis.email) {
      return {
        ...analysis,
        accountExists: false,
        allEmailGrants: [] as { role: string; memberId: Id<"members"> | null }[],
        verdict: ["This login has no email on its account — the portal cannot be linked."],
      };
    }

    const grantRows = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const allEmailGrants = grantRows
      .filter((g) => g.email === normalized)
      .map((g) => ({ role: g.role, memberId: g.memberId ?? null }));

    // Verdict lines — concrete, office-readable fixes.
    const verdict: string[] = [];
    if (!analysis.grant) {
      verdict.push(
        allEmailGrants.length > 0
          ? `A grant exists for this email but with role "${allEmailGrants[0].role}" (not "member"), so the portal is off. Edit that user here and switch the role to Member — picking the flat that has the bills.`
          : "No portal grant exists for this email. In Members, open this member's row, use the portal-login action and choose role Member with their flat — the grant is created with it.",
      );
    } else if (!analysis.grant.memberId) {
      verdict.push(
        "The member-role grant has no flat linked to it. Edit the user here, set role Member and pick the flat.",
      );
    }
    if (!user) {
      verdict.push(
        `No account exists for ${normalized} yet. The member must sign in once (with a password or an emailed code) before anything can appear — or the office can create the account by setting their password in Members.`,
      );
    }
    if (analysis.totalBillsOnActiveMembers === 0) {
      verdict.push(
        "No bills exist on any active member of this society yet — generate bills first (Bill Register → Generate).",
      );
    } else if (analysis.resolved && analysis.resolved.bills === 0) {
      verdict.push(
        `Bills exist (${analysis.totalBillsOnActiveMembers} across ${analysis.activeMembersWithBills} active member(s)) but none sit on the row this login resolves to (${analysis.resolved.name}). Re-grant the email as Member and pick the flat whose row holds the bills.`,
      );
    }
    if (analysis.resolved && analysis.resolved.bills > 0) {
      verdict.push(
        `Binding looks correct: the login resolves to ${analysis.resolved.name} (${[analysis.resolved.wing, analysis.resolved.flatNo].filter(Boolean).join("-") || analysis.resolved.code}) which holds ${analysis.resolved.bills} bill(s). If the member portal still shows nothing, have them log out and sign in again so the session picks up the grant.`,
      );
    }

    return {
      ...analysis,
      accountExists: !!user,
      allEmailGrants,
      verdict,
    };
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
  // "member" logins are portal-bound, not book users — no book menus.
  if (grant.role === "member") return ["portal"];
  return grant.menus && grant.menus.length > 0 ? grant.menus : null;
}

/** Create/update a grant by email, with explicit menu rights. */
export const grant = mutation({
  args: {
    societyId: v.id("societies"),
    email: emailField,
    role: v.union(v.literal("editor"), v.literal("viewer"), v.literal("member")),
    menus: menuKeysField,
    /** Required when role is "member": the flat the login is bound to. */
    memberId: v.optional(v.id("members")),
  },
  handler: async (
    ctx,
    { societyId, email, role, menus, memberId },
  ) => {
    if (role === "member" && !memberId) {
      throw new Error(
        "A member portal login must be linked to a flat — pick the member to bind.",
      );
    }
    if (memberId) {
      const boundMember = await ctx.db.get(memberId);
      if (!boundMember || boundMember.societyId !== societyId) {
        throw new Error("Member not found in this society.");
      }
    }
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
      // Update path — this is how an admin edits an existing user's rights.
      // One grant per email per society: role, menus and flat binding are
      // replaced wholesale (omitted menus = all menus).
      const healUserId = existing.userId
        ? undefined
        : (await userByEmail(ctx, normalized))?._id;
      await ctx.db.patch(existing._id, {
        role,
        menus,
        ...(healUserId ? { userId: healUserId } : {}),
        // Rebinding to a different flat on update; cleared for non-member roles.
        memberId: role === "member" ? memberId : undefined,
      });
      return { id: existing._id, updated: true };
    }

    const targetUser = await userByEmail(ctx, normalized);

    const id = await ctx.db.insert("membersAccess", {
      societyId,
      email: normalized,
      role,
      menus,
      memberId: role === "member" ? memberId : undefined,
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
    role: v.union(v.literal("editor"), v.literal("viewer"), v.literal("member")),
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
      // Update path — see the note on `grant`: one grant per email per
      // society, replaced wholesale. Stale user bindings are healed too.
      const healUserId = existing.userId
        ? undefined
        : (await userByEmail(ctx, normalized))?._id;
      await ctx.db.patch(existing._id, {
        role,
        menus,
        ...(healUserId ? { userId: healUserId } : {}),
        // Rebinds to a different flat on update; cleared for non-member roles.
        memberId: role === "member" ? memberId : undefined,
      });
      return { id: existing._id, updated: true };
    }

    const targetUser = await userByEmail(ctx, normalized);

    const id = await ctx.db.insert("membersAccess", {
      societyId,
      email: normalized,
      role,
      menus,
      memberId: role === "member" ? memberId : undefined,
      userId: targetUser?._id,
      grantedBy: callerId,
      createdAt: Date.now(),
    });
    return { id, updated: false };
  },
});

/**
 * Change an existing grant: role, menu rights and (for the member role) the
 * bound flat. The edit dialog calls this — everything an admin may adjust
 * about a granted user lives here. Omitting `menus` keeps the current menu
 * list; passing an empty list restores all menus.
 */
export const setRole = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("membersAccess"),
    role: v.union(v.literal("editor"), v.literal("viewer"), v.literal("member")),
    /** Required when role is "member" and the grant has no flat yet. */
    memberId: v.optional(v.id("members")),
    /** Replacement menu list; omit to keep the current menus untouched. */
    menus: menuKeysField,
  },
  handler: async (ctx, { societyId, id, role, memberId, menus }) => {
    const society = await requireSociety(ctx, societyId);
    await requireRightsManager(ctx, society);
    const grantRow = await ctx.db.get(id);
    if (!grantRow || grantRow.societyId !== societyId) {
      throw new Error("Grant not found.");
    }
    const patch: {
      role: "editor" | "viewer" | "member";
      memberId?: Id<"members"> | undefined;
      menus?: string[] | undefined;
      userId?: Id<"users"> | undefined;
    } = { role };
    if (role === "member") {
      const bound = memberId ?? grantRow.memberId;
      if (!bound) {
        throw new Error(
          "A member portal login must be linked to a flat — pick the member to bind.",
        );
      }
      const m = await ctx.db.get(bound);
      if (!m || m.societyId !== societyId) {
        throw new Error("Member not found in this society.");
      }
      patch.memberId = bound;
    } else {
      // Leaving the member role unbinds the flat.
      patch.memberId = undefined;
    }
    if (menus !== undefined) {
      // Empty list = all non-admin menus (server default), so store undefined.
      patch.menus = menus.length > 0 ? menus : undefined;
    }
    // Heal grants created before the invitee signed up: bind the account now
    // so rights resolve by user id as well as email on every later check.
    if (!grantRow.userId) {
      const u = await userByEmail(ctx, grantRow.email);
      if (u) patch.userId = u._id;
    }
    await ctx.db.patch(id, patch);
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
    const patch: { menus?: string[] | undefined; userId?: Id<"users"> | undefined } = {
      // Empty list = all non-admin menus (server default), so store undefined.
      menus: menus.length > 0 ? menus : undefined,
    };
    // Heal grants created before the invitee signed up (same as setRole).
    if (!grantRow.userId) {
      const u = await userByEmail(ctx, grantRow.email);
      if (u) patch.userId = u._id;
    }
    await ctx.db.patch(id, patch);
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
    // A guest session that was later given the owner's email (same user row,
    // isAnonymous stays true) counts as a real account: its email-keyed
    // recovery must run so its books follow that email to every device.
    if (!email) return 0;

    // Bootstrap: the first real account becomes the software admin.
    // Guests and converted guest accounts are never promoted by this — a
    // fresh device usually starts as a guest, so handing the system admin
    // flag to a guest/converted identity would lock the owner out.
    const existingAdmins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("softwareAdmin"), true))
      .collect();
    if (existingAdmins.length === 0 && !user?.isAnonymous) {
      await ctx.db.patch(userId, { softwareAdmin: true });
    }

    // Recovery guarantee. A society whose owner identity is unusable must
    // never strand its books, and a guest session's books must follow their
    // owner's email to every device:
    //  • the owner user row no longer exists (retired guest session), or
    //  • the owner is still an anonymous guest whose stamped email equals
    //    THIS account's email (guest sessions that were given an email keep
    //    their books under that email — a later password/OTP sign-in for the
    //    same email is the same person, on any device), or
    //  • the society was stamped with THIS email as its claim/handoff target
    //    (guest-created societies stamp the society profile email).
    //
    // Email-keyed handoff runs for EVERY email-backed account — it is tied
    // to the email itself, so it is safe on any device and needs no admin
    // rights. Pure anonymous guests (no email) returned above, keeping their
    // device-local data. Admins additionally adopt any other
    // orphaned/guest-owned society so nothing is ever stranded.
    {
      const isAdminNow =
        user?.softwareAdmin === true || existingAdmins.length === 0;
      const users = await ctx.db.query("users").collect();
      const userIds = new Set(users.map((u) => u._id));
      const adoptable = (await ctx.db.query("societies").collect()).filter(
        (s) => {
          if (s.createdBy === userId) return false;
          const owner = s.createdBy
            ? users.find((u) => u._id === s.createdBy)
            : undefined;
          const ownerDead =
            s.createdBy !== undefined && !userIds.has(s.createdBy);
          const ownerIsGuest = owner?.isAnonymous === true;
          const ownerIsMyGuest =
            ownerIsGuest &&
            owner?.email?.toLowerCase().trim() === email;
          // Email handoff: the guest stamped this account's email when the
          // society was created, or an adoption set it as the recovery target.
          const stampedForMe =
            (s.claimEmail?.toLowerCase().trim() ?? null) === email;
          if (
            (stampedForMe || ownerIsMyGuest) &&
            (ownerDead || ownerIsGuest || owner === undefined)
          )
            return true;
          return isAdminNow && (ownerDead || ownerIsGuest);
        },
      );
      for (const s of adoptable) {
        await ctx.db.patch(s._id, {
          createdBy: userId,
          claimCode: undefined,
          claimEmail: undefined,
        });
      }
    }

    // Cross-device data guarantee: any societies this user created while in
    // guest mode — on this or any other device — are handed over to the real
    // account here on the server, so nothing is ever stranded on one machine.
    const claimedSocieties = await maybeClaimGuestSocieties(ctx, userId, email);

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
    // Multi-flat links are keyed by email too — bind them to the account so
    // portal authorization resolves on the user id as well as the email.
    const links = await ctx.db
      .query("flatLinks")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    for (const l of links) {
      if (!l.userId) {
        await ctx.db.patch(l._id, { userId });
        bound++;
      }
    }
    return bound + claimedSocieties;
  },
});

/**
 * Authorization gate for the email-PDF action (actions run on Node and cannot
 * call query-only helpers directly): only the society owner or an invited
 * editor may email documents to members. Returns the society name so the
 * action can set a proper display name on the sender.
 */
export const assertCanEmail = internalQuery({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const society = await requireSociety(ctx, societyId);
    // Safe preference fields only — no secrets. The senders use these to
    // honour the society's Email & WhatsApp settings-tab choices.
    return {
      name: society.name,
      replyTo: society.messagingReplyTo,
      senderName: society.messagingSenderName,
      whatsappMode: society.messagingWhatsappMode,
    };
  },
});
