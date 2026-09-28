"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Outbound email for the office: bills and receipts are rendered as PDFs in
 * the browser (same legacy layouts as the download buttons) and handed here
 * as base64 attachments; this action posts them to Resend
 * (https://resend.com) — no SDK, just the REST endpoint.
 *
 * The sender key comes from the RESEND_API_KEY environment variable, set
 * through the project's Keys / API keys settings. Until the society's own
 * domain is verified in Resend, mail is sent from the shared onboarding
 * address with the society's name as the display name.
 */

/**
 * Authorization: only the society owner or an invited editor may email
 * documents — checked in access.assertCanEmail (a regular internal query,
 * since only actions may live in this Node.js file).
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Guard so one click can't build a giant request (PDFs are ~30-80 KB each). */
const MAX_MESSAGES_PER_CALL = 100;

export const sendDocs = action({
  args: {
    societyId: v.id("societies"),
    messages: v.array(
      v.object({
        to: v.string(),
        subject: v.string(),
        html: v.string(),
        attachments: v.array(
          v.object({
            filename: v.string(),
            contentBase64: v.string(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, { societyId, messages }) => {
    // Owner/editor only — member logins and outsiders are rejected here.
    const society = await ctx.runQuery(internal.access.assertCanEmail, {
      societyId,
    });

    if (messages.length === 0) {
      throw new Error("Nothing to send — no recipients were selected.");
    }
    if (messages.length > MAX_MESSAGES_PER_CALL) {
      throw new Error(
        `Too many emails in one go (${messages.length}). Narrow the selection — up to ${MAX_MESSAGES_PER_CALL} per send.`,
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Email is not configured yet — add the RESEND_API_KEY in the project's Keys / API keys settings and try again.",
      );
    }

    const from = `${society.name} <onboarding@resend.dev>`;

    const results: { to: string; ok: boolean; error?: string }[] = [];
    for (const msg of messages) {
      try {
        const res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [msg.to],
            subject: msg.subject,
            html: msg.html,
            attachments: msg.attachments.map((a) => ({
              filename: a.filename,
              // Resend accepts the base64 payload directly as `content`.
              content: a.contentBase64,
            })),
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          results.push({
            to: msg.to,
            ok: false,
            error: `Resend error ${res.status}${text ? ` — ${text.slice(0, 160)}` : ""}`,
          });
        } else {
          results.push({ to: msg.to, ok: true });
        }
      } catch (err) {
        results.push({
          to: msg.to,
          ok: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    }
    return { results };
  },
});
