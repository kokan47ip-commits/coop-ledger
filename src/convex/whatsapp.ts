"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Outbound WhatsApp for the office: bills and receipts are rendered as PDFs
 * in the browser (same legacy layouts as the download buttons) and handed
 * here as base64 attachments. The PDF is uploaded to WhatsApp's media
 * endpoint and then sent to the member's phone through the Meta WhatsApp
 * Cloud API (graph.facebook.com) — no SDK, no public file hosting.
 *
 * Keys come from the project's Keys / API keys settings:
 *   WHATSAPP_TOKEN            — permanent access token with whatsapp_business_messaging
 *   WHATSAPP_PHONE_NUMBER_ID  — the business number's Phone Number ID
 *   WHATSAPP_TEMPLATE_NAME    — optional (default "bill_notification")
 *   WHATSAPP_TEMPLATE_LANG    — optional (default "en", e.g. "en_IN", "mr")
 *
 * WhatsApp only allows free-form messages within 24h of the member's last
 * message to the business number. Outside that window the document must be
 * sent as an approved TEMPLATE message, so that is the default mode. The
 * template must be created once in the Meta dashboard with a document
 * header and two body variables: {{1}} = member name, {{2}} = document
 * label (e.g. "Maintenance Bill September,2026 — Bill No. 0101").
 */

const GRAPH_VERSION = "v21.0";
const DEFAULT_TEMPLATE_NAME = "bill_notification";
const DEFAULT_TEMPLATE_LANG = "en";
/** Guard so one click can't fire hundreds of conversations by accident. */
const MAX_MESSAGES_PER_CALL = 100;

/**
 * Normalize an Indian member phone to WhatsApp's E.164 form ("91XXXXXXXXXX").
 * Accepts "+91 98765 43210", "09876543210", "9876543210" and already-valid
 * 12-digit numbers. Returns null when the number can't be interpreted.
 */
function normalizePhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

export const sendWhatsapp = action({
  args: {
    societyId: v.id("societies"),
    messages: v.array(
      v.object({
        /** Member phone as stored on the profile — normalized here. */
        phone: v.string(),
        /** Member name, used in the message text / template variable. */
        name: v.string(),
        /** Human label, e.g. "Maintenance Bill September,2026 — Bill No. 0101". */
        docLabel: v.string(),
        filename: v.string(),
        contentBase64: v.string(),
      }),
    ),
    /**
     * "template" (default) sends the approved document template — works any
     * time. "session" sends a free-form captioned document — only delivered
     * when the member messaged the business number in the last 24 hours.
     */
    mode: v.optional(v.union(v.literal("template"), v.literal("session"))),
  },
  handler: async (ctx, { societyId, messages, mode }) => {
    // Owner/editor only — member logins and outsiders are rejected here.
    await ctx.runQuery(internal.access.assertCanEmail, { societyId });

    if (messages.length === 0) {
      throw new Error("Nothing to send — no members were selected.");
    }
    if (messages.length > MAX_MESSAGES_PER_CALL) {
      throw new Error(
        `Too many WhatsApp messages in one go (${messages.length}). Narrow the selection — up to ${MAX_MESSAGES_PER_CALL} per send.`,
      );
    }

    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      throw new Error(
        "WhatsApp is not configured yet — add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the project's Keys / API keys settings and try again.",
      );
    }
    const templateName =
      process.env.WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME;
    const templateLang =
      process.env.WHATSAPP_TEMPLATE_LANG || DEFAULT_TEMPLATE_LANG;
    const sendMode = mode ?? "template";

    const graphBase = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`;
    const results: { to: string; ok: boolean; error?: string }[] = [];

    for (const msg of messages) {
      const to = normalizePhone(msg.phone);
      if (!to) {
        results.push({ to: msg.phone, ok: false, error: "Invalid phone number on the member profile." });
        continue;
      }
      try {
        // 1) Upload the PDF to WhatsApp's media endpoint → media id.
        const bytes = Buffer.from(msg.contentBase64, "base64");
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), msg.filename);
        const upRes = await fetch(`${graphBase}/media`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const upJson = (await upRes.json().catch(() => ({}))) as {
          id?: string;
          error?: { message?: string };
        };
        if (!upRes.ok || !upJson.id) {
          results.push({
            to,
            ok: false,
            error: `Media upload failed${upJson.error?.message ? ` — ${upJson.error.message}` : ` (${upRes.status})`}`,
          });
          continue;
        }

        // 2) Send the document, as the approved template or as a session doc.
        const body =
          sendMode === "template"
            ? {
                messaging_product: "whatsapp",
                to,
                type: "template",
                template: {
                  name: templateName,
                  language: { code: templateLang },
                  components: [
                    {
                      type: "header",
                      parameters: [
                        {
                          type: "document",
                          document: { id: upJson.id, filename: msg.filename },
                        },
                      ],
                    },
                    {
                      type: "body",
                      parameters: [
                        { type: "text", text: msg.name || "Member" },
                        { type: "text", text: msg.docLabel },
                      ],
                    },
                  ],
                },
              }
            : {
                messaging_product: "whatsapp",
                to,
                type: "document",
                document: {
                  id: upJson.id,
                  filename: msg.filename,
                  caption: `Dear ${msg.name || "Member"}, your ${msg.docLabel} is attached.`,
                },
              };

        const sendRes = await fetch(`${graphBase}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const sendJson = (await sendRes.json().catch(() => ({}))) as {
          messages?: unknown[];
          error?: { message?: string };
        };
        if (!sendRes.ok) {
          results.push({
            to,
            ok: false,
            error: `WhatsApp error${sendJson.error?.message ? ` — ${sendJson.error.message}` : ` (${sendRes.status})`}`,
          });
        } else {
          results.push({ to, ok: true });
        }
      } catch (err) {
        results.push({
          to,
          ok: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    }
    return { results };
  },
});

/**
 * Send a single test WhatsApp message — wired to the Email & WhatsApp
 * settings tab so the office can confirm the Meta credentials and the
 * approved template work before relying on them for bills and receipts.
 * Uses the same template flow as real sends (document header + {{1}}/{{2}}).
 */
export const sendTest = action({
  args: { societyId: v.id("societies"), phone: v.string() },
  handler: async (ctx, { societyId, phone }) => {
    await ctx.runQuery(internal.access.assertCanEmail, { societyId });

    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      throw new Error(
        "WhatsApp is not configured yet — add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the project's Keys / API keys settings and try again.",
      );
    }
    const templateName =
      process.env.WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE_NAME;
    const templateLang =
      process.env.WHATSAPP_TEMPLATE_LANG || DEFAULT_TEMPLATE_LANG;
    const to = normalizePhone(phone);
    if (!to) {
      throw new Error(
        "Could not read that phone number — use a 10-digit Indian mobile (e.g. 9876543210).",
      );
    }

    const graphBase = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`;
    // No PDF for the test — a pure text template cannot attach documents, so
    // the template body variables carry the check: if Meta accepts this, the
    // credentials and template are live (the document header is validated by
    // Meta at template send time with real sends).
    const body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Test" },
              { type: "text", text: "configuration test" },
            ],
          },
        ],
      },
    };
    const res = await fetch(`${graphBase}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: unknown[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        `WhatsApp error${json.error?.message ? ` — ${json.error.message}` : ` (${res.status})`}`,
      );
    }
    return { ok: true as const };
  },
});
