import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";
import { normalizeVpa } from "../lib/bulkUpdateRules";

/**
 * Office-facing configuration screen for outbound messaging (Email + WhatsApp).
 *
 * The API keys themselves are NEVER stored in the database — they live in the
 * deployment's environment (RESEND_API_KEY, WHATSAPP_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, optionally WHATSAPP_TEMPLATE_NAME /
 * WHATSAPP_TEMPLATE_LANG) managed through the project's Keys / API keys
 * settings. This module reports whether they are configured (server-side
 * booleans, no secret material ever leaves the server), persists per-society
 * messaging preferences, and drives the live "send test" through the same
 * senders the documents use.
 */

/** Per-society messaging preferences (stored on the societies row). */
export const getMessagingSettings = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const society = await requireSociety(ctx, societyId);
    return {
      replyTo: society.messagingReplyTo ?? "",
      whatsappMode: society.messagingWhatsappMode ?? ("template" as const),
      senderName: society.messagingSenderName ?? "",
    };
  },
});

/** Save messaging preferences. Owner/editor only. */
export const saveMessagingSettings = mutation({
  args: {
    societyId: v.id("societies"),
    replyTo: v.optional(v.string()),
    whatsappMode: v.optional(
      v.union(v.literal("template"), v.literal("session")),
    ),
    senderName: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, replyTo, whatsappMode, senderName }) => {
    await requireSocietyWrite(ctx, societyId);
    const patch: Record<string, unknown> = {};
    if (replyTo !== undefined)
      patch.messagingReplyTo = replyTo.trim() || undefined;
    if (senderName !== undefined)
      patch.messagingSenderName = senderName.trim() || undefined;
    if (whatsappMode !== undefined) patch.messagingWhatsappMode = whatsappMode;
    await ctx.db.patch(societyId, patch);
    return true;
  },
});

/**
 * Which outbound channels are configured on this deployment. Returns plain
 * booleans only — key values never leave the server. Env vars set through the
 * Keys / API keys tab are readable via process.env in any Convex function.
 */
export const getChannelStatus = query({
  args: {},
  handler: async () => {
    return {
      email: !!process.env.RESEND_API_KEY,
      whatsapp: !!(
        process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
      ),
      whatsappTemplate: process.env.WHATSAPP_TEMPLATE_NAME || "bill_notification",
      whatsappTemplateLang: process.env.WHATSAPP_TEMPLATE_LANG || "en",
    };
  },
});

/**
 * Office-facing configuration for online (UPI) member payments. Keys live in
 * the deployment environment (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
 * RAZORPAY_WEBHOOK_SECRET); only the public key id, booleans and the society's
 * settlement preference are returned here.
 */
export const getUpiSettings = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const society = await requireSociety(ctx, societyId);
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const settlement = society.upiSettlementAccountId
      ? accounts.find((a) => a._id === society.upiSettlementAccountId)
      : undefined;
    return {
      settlementAccountId: society.upiSettlementAccountId ?? null,
      settlementAccountName: settlement
        ? `${settlement.code} — ${settlement.name}`
        : null,
      /** Society UPI ID (VPA) — payee for the dynamic QRs on member bills. */
      upiVpa: society.upiVpa ?? null,
      upiPayeeName: society.name,
      bankCashAccounts: accounts
        .filter((a) => a.kind === "bank_cash")
        .map((a) => ({ _id: a._id, label: `${a.code} — ${a.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      // Built-in: the public base URL HTTP actions are served from.
      webhookUrl: `${process.env.CONVEX_SITE_URL ?? ""}/upi_webhook`,
      keyId: process.env.RAZORPAY_KEY_ID ?? null,
      ready: !!(
        process.env.RAZORPAY_KEY_ID &&
        process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_WEBHOOK_SECRET
      ),
    };
  },
});

/** Save the UPI settlement account (null = back to the default). Owner/editor only. */
export const saveUpiSettings = mutation({
  args: {
    societyId: v.id("societies"),
    settlementAccountId: v.optional(v.union(v.id("accounts"), v.null())),
    /** Society's UPI ID (VPA) — QRs on bills pay into it. null clears it. */
    upiVpa: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { societyId, settlementAccountId, upiVpa }) => {
    await requireSocietyWrite(ctx, societyId);
    if (settlementAccountId !== undefined) {
      if (settlementAccountId) {
        const acc = await ctx.db.get(settlementAccountId);
        if (!acc || acc.societyId !== societyId || acc.kind !== "bank_cash") {
          throw new ConvexError(
            "Choose a cash/bank account of this society as the settlement account.",
          );
        }
      }
      await ctx.db.patch(societyId, {
        upiSettlementAccountId: settlementAccountId ?? undefined,
      });
    }
    if (upiVpa !== undefined) {
      const n = normalizeVpa(upiVpa);
      if (!n.ok) throw new ConvexError(n.problem);
      await ctx.db.patch(societyId, { upiVpa: n.vpa });
    }
    return true;
  },
});
