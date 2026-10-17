import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSociety, requireSocietyWrite, requireUserId } from "./lib";

/**
 * Joint ownership of a flat. The flat's member row is the FIRST/PRIMARY
 * owner (its name leads the register, ledgers and bills — accounting never
 * changes); rows here are the additional joint owners the admin records.
 * Every change appends to the ownershipAudit trail.
 *
 * Pure helpers (organisation key normalisation, duplicate detection, the
 * multi-flat payment grouping validator) are exported for unit tests.
 */

export const MAX_JOINT_OWNERS_PER_FLAT = 4;

/** Case/space-insensitive identity key for names, emails, codes and flats. */
export function normalizeKey(s?: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The comparable identity of a flat: wing + building + flat/unit no. */
export function flatIdentity(m: {
  wing?: string | null;
  building?: string | null;
  flatNo?: string | null;
}): string {
  return [normalizeKey(m.wing), normalizeKey(m.building), normalizeKey(m.flatNo)].join("/");
}

/**
 * Duplicate-member guard for the register (member upsert). Returns the error
 * message when the incoming record duplicates an existing one:
 *  • the member CODE is already used (codes are the register's identity), or
 *  • the same ACTIVE flat (wing/building/flatNo) already has an ACTIVE member.
 * Inactive/archive members never block a flat — that is how a sold flat is
 * re-admitted to a new owner. Returns null when the record is acceptable.
 */
export function duplicateMemberError<
  M extends {
    id?: string;
    code: string;
    name: string;
    wing?: string | null;
    building?: string | null;
    flatNo?: string | null;
    isActive: boolean;
  },
>(existing: M[], incoming: M): string | null {
  const incomingCode = normalizeKey(incoming.code);
  if (incomingCode) {
    const clash = existing.find(
      (m) => m.id !== incoming.id && normalizeKey(m.code) === incomingCode,
    );
    if (clash) {
      return `Member code ${incoming.code} is already used by ${clash.name}${clash.flatNo ? ` (${clash.flatNo})` : ""} — codes must be unique.`;
    }
  }
  if (incoming.isActive) {
    const incomingFlat = flatIdentity(incoming);
    if (incomingFlat !== "//") {
      const clash = existing.find(
        (m) =>
          m.id !== incoming.id &&
          m.isActive &&
          incomingFlat === flatIdentity(m),
      );
      if (clash) {
        const flatLabel = [incoming.wing, incoming.flatNo].filter(Boolean).join("-");
        return `${flatLabel || "This flat"} already has an active member record: ${clash.name}${clash.code ? ` (${clash.code})` : ""}. Add joint owners from that flat's record instead — one member row per flat keeps the ledgers and bills unique.`;
      }
    }
  }
  return null;
}

/**
 * Duplicate-joint-owner guard for one flat: the same normalised name, or the
 * same email, must not appear twice on the same member row.
 */
export function duplicateJointOwnerError(
  existing: { name: string; email?: string | null }[],
  incoming: { name: string; email?: string | null },
): string | null {
  const incomingName = normalizeKey(incoming.name);
  const incomingEmail = normalizeKey(incoming.email);
  for (const o of existing) {
    if (incomingName && normalizeKey(o.name) === incomingName) {
      return `${incoming.name} is already recorded as an owner of this flat.`;
    }
    if (incomingEmail && incomingEmail === normalizeKey(o.email)) {
      return `The email ${incoming.email} is already recorded for another owner of this flat.`;
    }
  }
  return null;
}

export type FlatPaymentGroupInput = {
  memberId: string;
  allocations: { billId: string; amount: number }[];
  amount?: number;
};

/**
 * Validate a combined multi-flat payment before it touches the database:
 *  • every group must name a flat the login is authorised for,
 *  • no flat twice, no more than 5 flats in one submission,
 *  • each flat's part must carry allocations or an explicit advance amount,
 *  • the grand total must be positive.
 * Returns the error message, or null when the grouping is acceptable.
 */
export function multiFlatGroupsError(
  authorizedIds: string[],
  groups: FlatPaymentGroupInput[],
): string | null {
  if (groups.length === 0) {
    return "Select at least one flat's dues to pay.";
  }
  if (groups.length > 5) {
    return "A combined payment covers at most 5 flats — pay the rest separately.";
  }
  const seen = new Set<string>();
  let total = 0;
  for (const g of groups) {
    if (!authorizedIds.includes(g.memberId)) {
      return "One of the selected flats is not linked to your login — payment declined.";
    }
    if (seen.has(g.memberId)) {
      return "Each flat may appear only once in a combined payment.";
    }
    seen.add(g.memberId);
    if (!g.amount && (!g.allocations || g.allocations.length === 0)) {
      return "Every selected flat needs at least one bill amount to pay.";
    }
    total += (g.amount ?? 0) + (g.allocations ?? []).reduce((s, a) => s + a.amount, 0);
  }
  if (total <= 0) {
    return "Enter the amounts to pay for the selected flats.";
  }
  return null;
}

/** Compact audit log entry for ownership / account-linking changes. */
export async function logOwnership(
  ctx: MutationCtx,
  entry: {
    societyId: Id<"societies">;
    action: string;
    memberId?: Id<"members">;
    email?: string;
    details: string;
    byUserId: Id<"users">;
    byName: string;
  },
) {
  await ctx.db.insert("ownershipAudit", {
    societyId: entry.societyId,
    action: entry.action,
    memberId: entry.memberId,
    email: entry.email,
    details: entry.details,
    byUserId: entry.byUserId,
    byName: entry.byName,
    at: Date.now(),
  });
}

/** Name for the audit trail: account display name, else its email. */
export async function userNameFor(ctx: MutationCtx, userId: Id<"users">) {
  const user = (await ctx.db.get(userId)) as Doc<"users"> | null;
  return user?.name?.trim() || user?.email?.trim() || "Admin";
}

/* ------------------------------ queries --------------------------------- */

/**
 * Joint owners for a set of flats in one call — the member register groups
 * these by memberId to show every owner's name alongside the primary owner.
 */
export const flatJointOwners = query({
  args: {
    societyId: v.id("societies"),
    memberIds: v.optional(v.array(v.id("members"))),
  },
  handler: async (ctx, { societyId, memberIds }) => {
    await requireSociety(ctx, societyId);
    const rows = await ctx.db
      .query("memberOwners")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const wanted = memberIds ? new Set(memberIds) : null;
    return rows
      .filter((r) => !wanted || wanted.has(r.memberId))
      .sort(
        (a, b) =>
          a.memberId.localeCompare(b.memberId) ||
          a.createdAt - b.createdAt ||
          a.name.localeCompare(b.name),
      );
  },
});

/** Recent ownership / account-linking change history (newest first). */
export const auditTrail = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const rows = await ctx.db
      .query("ownershipAudit")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, 100)
      .map((r) => ({
        _id: r._id,
        action: r.action,
        memberId: r.memberId ?? null,
        email: r.email ?? null,
        details: r.details,
        byName: r.byName,
        at: r.at,
      }));
  },
});

/* ----------------------------- mutations -------------------------------- */

/**
 * Add a joint owner to a flat. The flat keeps ONE member row (bills, ledger
 * and opening balance stay there) — joint owners are people recorded on that
 * row, displayed everywhere the flat's owner names are shown.
 */
export const addJointOwner = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    name: v.string(),
    relation: v.optional(v.string()),
    sharePercent: v.optional(v.number()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, memberId, name, relation, sharePercent, phone, email }) => {
    const society = await requireSocietyWrite(ctx, societyId);
    const callerId = await requireUserId(ctx);
    const member = await ctx.db.get(memberId);
    if (!member || member.societyId !== societyId) {
      throw new ConvexError("Member not found in this society.");
    }
    const cleanName = name.trim();
    if (!cleanName) throw new ConvexError("Enter the joint owner's name.");
    if (cleanName.length > 120) {
      throw new ConvexError("Name is too long (120 characters max).");
    }
    const cleanEmail = email?.trim() || undefined;
    if (cleanEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      throw new ConvexError("Enter a valid email address (or leave it blank).");
    }
    if (sharePercent !== undefined && (sharePercent < 0 || sharePercent > 100)) {
      throw new ConvexError("Share must be between 0 and 100 percent.");
    }
    const existing = await ctx.db
      .query("memberOwners")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect();
    if (existing.length >= MAX_JOINT_OWNERS_PER_FLAT) {
      throw new ConvexError(
        `This flat already has ${MAX_JOINT_OWNERS_PER_FLAT} joint owners — remove one before adding another.`,
      );
    }
    const dupe = duplicateJointOwnerError(existing, { name: cleanName, email: cleanEmail });
    if (dupe) throw new ConvexError(dupe);
    const insertId = await ctx.db.insert("memberOwners", {
      societyId,
      memberId,
      name: cleanName,
      relation: relation?.trim() || undefined,
      sharePercent,
      phone: phone?.trim() || undefined,
      email: cleanEmail?.toLowerCase(),
      addedById: callerId,
      addedByName: await userNameFor(ctx, callerId),
      createdAt: Date.now(),
    });
    await logOwnership(ctx, {
      societyId,
      action: "joint_owner.added",
      memberId,
      details: `${cleanName}${relation ? ` (${relation.trim()})` : ""}${sharePercent !== undefined ? ` · share ${sharePercent}%` : ""} added to ${member.name}'s record.`,
      byUserId: callerId,
      byName: await userNameFor(ctx, callerId),
    });
    return { id: insertId };
  },
});

/** Remove a joint owner from a flat (the flat's member row is untouched). */
export const removeJointOwner = mutation({
  args: { societyId: v.id("societies"), id: v.id("memberOwners") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
    const callerId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.societyId !== societyId) {
      throw new ConvexError("Joint owner not found.");
    }
    const member = await ctx.db.get(row.memberId);
    await ctx.db.delete(id);
    await logOwnership(ctx, {
      societyId,
      action: "joint_owner.removed",
      memberId: row.memberId,
      details: `${row.name} removed from ${member?.name ?? "flat"}'s record.`,
      byUserId: callerId,
      byName: await userNameFor(ctx, callerId),
    });
    return { ok: true };
  },
});
