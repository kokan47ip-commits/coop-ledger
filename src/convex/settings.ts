import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";

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
