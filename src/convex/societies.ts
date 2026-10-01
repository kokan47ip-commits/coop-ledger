import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { seedDefaultGroups } from "./accountGroups";
import {
  DEFAULT_ACCOUNTS,
  isSoftwareAdmin,
  requireUserId,
  societyAccess,
} from "./lib";

/**
 * Societies the caller can open: ones they created, ones they were invited
 * to (editor/viewer rights), and — for software admins — every society in
 * the system. Powers the sidebar society switcher.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const created = await ctx.db
      .query("societies")
      .withIndex("by_creator", (q) => q.eq("createdBy", userId))
      .collect();

    if (await isSoftwareAdmin(ctx, userId)) {
      const all = await ctx.db.query("societies").collect();
      const seen = new Set(created.map((s) => s._id));
      type SocietyRow = (typeof created)[number] & { portalOnly?: boolean };
      const rows: SocietyRow[] = [
        ...created.map((s) => ({ ...s })),
        ...all.filter((s) => !seen.has(s._id)).map((s) => ({ ...s })),
      ];
      return rows;
    }

    const user = await ctx.db.get(userId);
    const email = user?.email?.toLowerCase().trim() ?? null;
    // Guest identities have no email — email-based invites cannot apply.
    const grants = email
      ? await ctx.db
          .query("membersAccess")
          .withIndex("by_email", (q) => q.eq("email", email))
          .collect()
      : [];
    type SocietyRow = (typeof created)[number] & { portalOnly?: boolean };
    const shared: SocietyRow[] = [];
    for (const g of grants) {
      const s = await ctx.db.get(g.societyId);
      if (s && !created.some((c) => c._id === s._id)) {
        // Never expose another society's guest claim code to a granted user —
        // it is an ownership-takeover secret. Portal (member-role) grants are
        // flagged so the client can route straight to /portal without firing
        // any society-books query first.
        shared.push({
          ...s,
          claimCode: undefined,
          portalOnly: g.role === "member",
        });
      }
    }
    const result: SocietyRow[] = [
      ...created.map((s) => ({ ...s })),
      ...shared,
    ];
    return result;
  },
});

export const get = query({
  args: { id: v.id("societies") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const s = await ctx.db.get(id);
    if (!s) return null;
    const access = await societyAccess(ctx, s, userId);
    // "member" logins may read the society header (for the portal) but never
    // receive the guest claim code — that would let them take ownership.
    if (access === "none") return null;
    if (s.claimCode && s.createdBy !== userId && !(await isSoftwareAdmin(ctx, userId))) {
      return { ...s, claimCode: undefined };
    }
    return s;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    registrationNo: v.optional(v.string()),
    registrationDate: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    fyStartMonth: v.number(),
    fyYear: v.optional(v.string()),
    fyStartDate: v.optional(v.string()),
    withSampleData: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    // Guest (anonymous) users get a per-society claim code. The client stores it
    // on this device so the society can be adopted by the real email account
    // later — guest identities do not survive between logins, books must.
    const isGuest = user?.isAnonymous === true;
    const claimCode = isGuest
      ? Math.random().toString(36).slice(2, 10).toUpperCase()
      : undefined;
    const societyId = await ctx.db.insert("societies", {
      name: args.name,
      registrationNo: args.registrationNo,
      registrationDate: args.registrationDate,
      address: args.address,
      city: args.city,
      state: args.state,
      pincode: args.pincode,
      email: args.email,
      phone: args.phone,
      fyStartMonth: args.fyStartMonth,
      fyYear: args.fyYear,
      fyStartDate: args.fyStartDate,
      // Guests stamp their profile email here so the society can be handed
      // over server-side when that email signs in from any device.
      claimEmail: isGuest ? (args.email?.toLowerCase().trim() || undefined) : undefined,
      createdBy: userId,
      claimCode,
    });
    await seedDefaultGroups(ctx, societyId);
    const groups = await ctx.db
      .query("accountGroups")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const a of DEFAULT_ACCOUNTS) {
      await ctx.db.insert("accounts", {
        societyId,
        code: a.code,
        name: a.name,
        type: a.type,
        kind: a.kind,
        openingBalance: 0,
        groupId: groups.find((g) => g.name === a.group)?._id,
      });
    }
    return { societyId, claimCode: claimCode ?? null };
  },
});

/**
 * Adopt a guest-created society into the signed-in account. The claim code is
 * issued to the device that created the society; once claimed, ownership moves
 * to the current user and the code is cleared so it cannot be reused.
 */
export const adoptByClaimCode = mutation({
  args: { claimCode: v.string() },
  handler: async (ctx, { claimCode }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.isAnonymous) {
      throw new Error("Sign in with email to claim this society.");
    }
    const society = await ctx.db
      .query("societies")
      .withIndex("by_claim_code", (q) => q.eq("claimCode", claimCode))
      .unique();
    if (!society) {
      throw new Error("This claim code is not valid or has already been used.");
    }
    await ctx.db.patch(society._id, { createdBy: userId, claimCode: undefined });
    return society._id;
  },
});

/** Returns the claim codes of every guest-created society owned by the caller. */
export const myClaimCodes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const societies = await ctx.db
      .query("societies")
      .withIndex("by_creator", (q) => q.eq("createdBy", userId))
      .collect();
    return societies
      .filter((s) => s.claimCode)
      .map((s) => ({ societyId: s._id, name: s.name, claimCode: s.claimCode! }));
  },
});

/**
 * Cross-device data guarantee: guest (anonymous) sessions stamp every society
 * they create with the email entered in the society profile. When that email
 * signs in — from any PC, phone or tablet — the societies are handed over to
 * the real account right here on the server, so nothing entered as a guest is
 * ever stranded on the device that created it. The localStorage claim-code
 * path stays as a fallback for guests who left the profile email blank.
 *
 * Returns the number of societies claimed.
 */
export async function maybeClaimGuestSocieties(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string,
): Promise<number> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return 0;
  const pending = await ctx.db
    .query("societies")
    .withIndex("by_claim_email", (q) => q.eq("claimEmail", normalized))
    .collect();
  let claimed = 0;
  for (const s of pending) {
    if (!s.claimCode) continue; // already owned by a real account
    await ctx.db.patch(s._id, { createdBy: userId, claimCode: undefined });
    claimed++;
  }
  return claimed;
}

/**
 * Society-profile edits are owner-only (they change the books' identity),
 * so unlike data mutations this keeps the creator check.
 */
export const update = mutation({
  args: {
    id: v.id("societies"),
    name: v.string(),
    registrationNo: v.optional(v.string()),
    registrationDate: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    fyStartMonth: v.number(),
    fyYear: v.optional(v.string()),
    fyStartDate: v.optional(v.string()),
    chairmanMemberId: v.optional(v.id("members")),
    secretaryMemberId: v.optional(v.id("members")),
    treasurerMemberId: v.optional(v.id("members")),
    receivableAccountId: v.optional(v.id("accounts")),
    /** Society's UPI ID (VPA) for member QR codes and bill printing. */
    upiVpa: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUserId(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.createdBy !== userId) throw new Error("Society not found.");
    await ctx.db.patch(id, patch);
  },
});

/** Deleting a whole society is owner-only. */
export const remove = mutation({
  args: { id: v.id("societies") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.createdBy !== userId) throw new Error("Society not found.");
    for (const table of [
      "vouchers",
      "bills",
      "tariffs",
      "members",
      "accounts",
      "accountGroups",
      "memberTariffs",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_society", (q) => q.eq("societyId", id))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(id);
  },
});
