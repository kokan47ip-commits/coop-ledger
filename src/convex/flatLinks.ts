import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isSoftwareAdmin, requireSociety, requireUserId } from "./lib";
import { logOwnership, userNameFor } from "./ownership";

/**
 * Multiple flats under ONE member login. The login's primary flat stays on
 * its membersAccess "member" grant (nothing changes for existing accounts);
 * additional flats of the SAME account are rows here, keyed by the grant's
 * lower-cased email and healed to the user id once the account signs in.
 *
 * Admin functions (list / link / unlink) are owner or software-admin only.
 * The portal reads these rows through authorizedFlats() in memberPortal.ts —
 * a login sees exactly its primary flat plus every flat linked here, and
 * never another login's flats.
 */

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Owner or software admin — the roles allowed to manage login-flat links. */
async function requireLinkManager(
  ctx: QueryCtx,
  societyId: Id<"societies">,
): Promise<{ callerId: Id<"users"> }> {
  const callerId = await requireUserId(ctx);
  const society = await requireSociety(ctx, societyId);
  if (society.createdBy !== callerId && !(await isSoftwareAdmin(ctx, callerId))) {
    throw new ConvexError(
      "Only the society owner or a software admin can link flats to member logins.",
    );
  }
  return { callerId };
}

async function healUserId(ctx: MutationCtx, email: string) {
  const rows = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .collect();
  return rows[0]?._id;
}

/**
 * All flat links of a society with member details — admin panel "View all
 * flats linked to a member" list. Sorted by login email, then flat code.
 */
export const listForSociety = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (society.createdBy !== callerId && !(await isSoftwareAdmin(ctx, callerId))) {
      return []; // editors/viewers do not manage login linkages
    }
    const links = await ctx.db
      .query("flatLinks")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return await Promise.all(
      links.map(async (l) => {
        const member = l.memberId ? ((await ctx.db.get(l.memberId)) as Doc<"members"> | null) : null;
        return {
          _id: l._id,
          email: l.email,
          memberId: l.memberId,
          memberName: member?.name ?? null,
          memberCode: member?.code ?? null,
          flatLabel:
            [member?.wing, member?.flatNo].filter(Boolean).join("-") ||
            member?.code ||
            "",
          isActive: member?.isActive ?? false,
          grantedByName: l.grantedByName ?? null,
          createdAt: l.createdAt,
        };
      }),
    );
  },
});

/**
 * Link one more flat to an existing member login. Rules:
 *  • the email must already hold a "member" portal grant in this society
 *    (create that first in Users & Rights — the grant is the login itself),
 *  • the flat must be an existing, active member row of this society,
 *  • the primary bound flat and any existing link cannot be duplicated,
 *  • the login must not already own that flat via its own member row.
 */
export const linkFlat = mutation({
  args: {
    societyId: v.id("societies"),
    email: v.string(),
    memberId: v.id("members"),
  },
  handler: async (ctx, { societyId, email, memberId }) => {
    const { callerId } = await requireLinkManager(ctx, societyId);
    const normalized = email.toLowerCase().trim();
    if (!emailPattern.test(normalized)) {
      throw new ConvexError("Enter the login's email address.");
    }
    const member = await ctx.db.get(memberId);
    if (!member || member.societyId !== societyId) {
      throw new ConvexError("Flat not found in this society.");
    }
    if (!member.isActive) {
      throw new ConvexError(
        `${member.name}'s row is inactive — only active member records can be linked to a login.`,
      );
    }

    // The grant defines the login — and identifies which flat is "primary".
    const grants = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const grant = grants.find((g) => g.email === normalized);
    if (!grant) {
      throw new ConvexError(
        `No portal login exists for ${normalized} yet — create one in Users & Rights (role Member) first, then link the extra flats here.`,
      );
    }
    if (grant.role !== "member") {
      throw new ConvexError(
        `${normalized}'s access is role "${grant.role}", not Member — switch it to Member in Users & Rights so the login is flat-bound, then link extra flats here.`,
      );
    }
    if (grant.memberId === memberId) {
      throw new ConvexError(
        "That flat is already this login's primary (bound) flat.",
      );
    }

    const links = await ctx.db
      .query("flatLinks")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    if (links.some((l) => l.email === normalized && l.memberId === memberId)) {
      throw new ConvexError("This flat is already linked to that login.");
    }

    const id = await ctx.db.insert("flatLinks", {
      societyId,
      email: normalized,
      memberId,
      userId: (await healUserId(ctx, normalized)) ?? undefined,
      grantedById: callerId,
      grantedByName: await userNameFor(ctx, callerId),
      createdAt: Date.now(),
    });
    await logOwnership(ctx, {
      societyId,
      action: "flat_link.added",
      memberId,
      email: normalized,
      details: `Flat ${[member.wing, member.flatNo].filter(Boolean).join("-") || member.code} (${member.name}) linked to login ${normalized}.`,
      byUserId: callerId,
      byName: await userNameFor(ctx, callerId),
    });
    return { id };
  },
});

/** Remove a flat from a login (the member row itself is untouched). */
export const unlinkFlat = mutation({
  args: { societyId: v.id("societies"), id: v.id("flatLinks") },
  handler: async (ctx, { societyId, id }) => {
    const { callerId } = await requireLinkManager(ctx, societyId);
    const link = await ctx.db.get(id);
    if (!link || link.societyId !== societyId) {
      throw new ConvexError("Flat link not found.");
    }
    const member = await ctx.db.get(link.memberId);
    await ctx.db.delete(id);
    await logOwnership(ctx, {
      societyId,
      action: "flat_link.removed",
      memberId: link.memberId,
      email: link.email,
      details: `Flat ${[member?.wing, member?.flatNo].filter(Boolean).join("-") || member?.code || ""} unlinked from login ${link.email}.`,
      byUserId: callerId,
      byName: await userNameFor(ctx, callerId),
    });
    return { ok: true };
  },
});

/**
 * Heal every link row of a login email to the signed-in user id — done in
 * access.bindPendingGrants on sign-in, so right checks resolve on the user
 * id as well as the email.
 */
