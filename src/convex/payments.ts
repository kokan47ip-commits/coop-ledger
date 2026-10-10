import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertInFy, clampAllocations, postMemberReceipt, requireSociety, requireUserId, societyMemberBinding } from "./lib";
import { portalBinding, validateMemberAllocations } from "./memberPortal";

/**
 * Online (UPI) payments for the member portal.
 *
 * A member picks bills (or an advance) on the portal and taps "Pay via UPI".
 * The flow is powered by Razorpay, whose checkout on a mobile browser shows
 * exactly the UPI apps installed on the member's phone (GPay, PhonePe, Paytm,
 * BHIM…) and on desktop offers a QR code.
 *
 * Money confirms server-side, never from the browser:
 *   1. `createUpiOrder` — validates the payment and stores it (status
 *      "created").
 *   2. `initRazorpayOrder` — creates the matching gateway order with the
 *      Razorpay API and attaches its id to the row.
 *   3. The member pays in their UPI app.
 *   4a. Razorpay calls the webhook (`razorpayWebhook`, routed in http.ts) —
 *       the signature is verified with RAZORPAY_WEBHOOK_SECRET.
 *   4b. The checkout success handler also calls `verifyUpiPayment`, which
 *       verifies the checkout signature with RAZORPAY_KEY_SECRET. Whichever
 *       arrives first posts the receipt; the other becomes a no-op.
 *   5. `postUpiPayment` debits the society's UPI settlement bank/cash account,
 *      credits the member's receivable ledger, settles the chosen bills and
 *      links the receipt voucher to the payment — the same books entry the
 *      office's Member Receipt voucher produces.
 *
 * Gateway keys never reach the browser: only the public key id is returned,
 * and all secret material is read from the deployment environment (set via
 * the project's Keys / API keys tab).
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";

/** HMAC-SHA256 → lowercase hex, via Web Crypto (available in every runtime). */
async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string compare so signatures cannot be probed byte-by-byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether the deployment has the gateway keys configured (booleans only). */
export const gatewayStatus = query({
  args: {},
  handler: async () => {
    return {
      ready: !!(
        process.env.RAZORPAY_KEY_ID &&
        process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_WEBHOOK_SECRET
      ),
      keyIdSet: !!process.env.RAZORPAY_KEY_ID,
      secretSet: !!process.env.RAZORPAY_KEY_SECRET,
      webhookSet: !!process.env.RAZORPAY_WEBHOOK_SECRET,
    };
  },
});

/**
 * Member creates a payment: validates the allocations exactly like the manual
 * portal payment, then stores the payment for gateway initialisation.
 */
export const createUpiOrder = mutation({
  args: {
    societyId: v.id("societies"),
    allocations: v.array(v.object({ billId: v.id("bills"), amount: v.number() })),
    /** Advance: pay without selecting bills — credited to the ledger. */
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, allocations, amount }) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new ConvexError(
        "Online UPI payments are not enabled yet — the society office has not finished the payment setup.",
      );
    }
    const bind = await portalBinding(ctx, societyId);
    if (!bind) {
      throw new ConvexError(
        "Your login is not linked to a flat in this society — payment declined.",
      );
    }
    const society = await ctx.db.get(societyId);
    if (!society) throw new ConvexError("Society not found.");
    const userId = await requireUserId(ctx);

    // Today must sit inside the current books period, like manual payments.
    assertInFy(society, new Date().toISOString().slice(0, 10), "Online payment");

    const { total } = await validateMemberAllocations(ctx, bind, allocations);
    let finalTotal = total;
    if (amount !== undefined && amount > 0) {
      if (amount + 0.005 < total) {
        throw new ConvexError(
          "The allocated bill amounts exceed the payment amount — reduce the allocations.",
        );
      }
      finalTotal = Math.round(amount * 100) / 100;
    }
    if (finalTotal <= 0) {
      throw new ConvexError(
        "Enter an amount to pay — with no bills selected the payment is kept as an advance.",
      );
    }
    if (finalTotal < 1) {
      throw new ConvexError("Online payments must be at least ₹1 — reduce and retry or pay at the office.");
    }

    const paymentId = await ctx.db.insert("upiPayments", {
      societyId,
      memberId: bind.memberId,
      createdById: userId,
      amount: finalTotal,
      status: "created",
      provider: "razorpay" as const,
      allocations,
      advanceAmount: Math.round((finalTotal - total) * 100) / 100,
      createdAt: Date.now(),
    });
    return { paymentId, total: finalTotal };
  },
});

/** Snapshot an internal mutation needs to place the gateway order. */
type OrderInfo = {
  alreadyInit: boolean;
  providerOrderId?: string;
  amount: number;
  societyName: string;
  memberName: string;
};

export const internalPrepareOrder = internalMutation({
  args: { paymentId: v.id("upiPayments"), expectedUserId: v.id("users") },
  handler: async (ctx, { paymentId, expectedUserId }): Promise<OrderInfo> => {
    const p = await ctx.db.get(paymentId);
    if (!p) throw new ConvexError("Payment not found.");
    if (p.createdById !== expectedUserId) {
      throw new ConvexError("This payment was started from another login.");
    }
    if (p.status !== "created") {
      throw new ConvexError(`This payment is already ${p.status}.`);
    }
    const society = await ctx.db.get(p.societyId);
    const member = await ctx.db.get(p.memberId);
    const [societyName, memberName] = [society?.name ?? "Society", member?.name ?? "Member"];
    if (p.providerOrderId) {
      return { alreadyInit: true, providerOrderId: p.providerOrderId, amount: p.amount, societyName, memberName };
    }
    return { alreadyInit: false, amount: p.amount, societyName, memberName };
  },
});

export const internalAttachProviderOrder = internalMutation({
  args: {
    paymentId: v.id("upiPayments"),
    expectedUserId: v.id("users"),
    providerOrderId: v.string(),
  },
  handler: async (ctx, { paymentId, expectedUserId, providerOrderId }) => {
    const p = await ctx.db.get(paymentId);
    if (!p) throw new ConvexError("Payment not found.");
    if (p.createdById !== expectedUserId) {
      throw new ConvexError("This payment was started from another login.");
    }
    if (p.status !== "created") {
      throw new ConvexError(`This payment is already ${p.status}.`);
    }
    if (p.providerOrderId && p.providerOrderId !== providerOrderId) {
      throw new ConvexError("Payment already has a gateway order.");
    }
    await ctx.db.patch(paymentId, { providerOrderId });
  },
});

/** Snapshot the checkout on the browser needs, in paise. */
type InitOrderResult = {
  paymentId: Id<"upiPayments">;
  providerOrderId: string;
  amountPaise: number;
  keyId: string;
  societyName: string;
  memberName: string;
};

/**
 * Create the Razorpay order for a member payment. Runs as an action because
 * it calls the gateway API; the gateway's key secret stays on the server and
 * only the public key id is returned for checkout.
 */
export const initRazorpayOrder = action({
  args: { paymentId: v.id("upiPayments") },
  handler: async (ctx, { paymentId }): Promise<InitOrderResult> => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error(
        "Online UPI payments are not configured — add the gateway keys in the project's API keys settings.",
      );
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");

    const info = await ctx.runMutation(internal.payments.internalPrepareOrder, {
      paymentId,
      expectedUserId: userId,
    });
    if (info.alreadyInit && info.providerOrderId) {
      return {
        paymentId,
        providerOrderId: info.providerOrderId,
        amountPaise: Math.round(info.amount * 100),
        keyId,
        societyName: info.societyName,
        memberName: info.memberName,
      };
    }

    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount: Math.round(info.amount * 100),
        currency: "INR",
        receipt: paymentId.slice(0, 40),
        notes: { paymentId },
      }),
    });
    const data: { id?: string; amount?: number; error?: { description?: string } } =
      await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(
        data.error?.description ??
          `The payment gateway declined the order (HTTP ${res.status}).`,
      );
    }
    await ctx.runMutation(internal.payments.internalAttachProviderOrder, {
      paymentId,
      expectedUserId: userId,
      providerOrderId: data.id,
    });
    return {
      paymentId,
      providerOrderId: data.id,
      amountPaise: data.amount ?? Math.round(info.amount * 100),
      keyId,
      societyName: info.societyName,
      memberName: info.memberName,
    };
  },
});

/**
 * Member-side confirmation: the checkout success handler posts the gateway's
 * response here, where the signature (HMAC of order_id|payment_id with the key
 * secret) is verified server-side before anything touches the books.
 */
export const verifyUpiPayment = mutation({
  args: {
    paymentId: v.id("upiPayments"),
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    razorpaySignature: v.string(),
  },
  handler: async (ctx, { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
    const userId = await requireUserId(ctx);
    const p = await ctx.db.get(paymentId);
    if (!p) throw new ConvexError("Payment not found.");
    if (p.createdById !== userId) {
      throw new ConvexError("This payment was started from another login.");
    }
    if (p.providerOrderId && p.providerOrderId !== razorpayOrderId) {
      throw new ConvexError("Payment reference mismatch.");
    }
    if (p.status === "posted") {
      return { posted: true, alreadyPosted: true, voucherNo: p.voucherNo ?? null };
    }
    if (p.status !== "created") {
      throw new ConvexError(`This payment is already ${p.status}.`);
    }
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new ConvexError("Online payments are not configured yet.");
    }
    const expected = await hmacSha256Hex(keySecret, `${razorpayOrderId}|${razorpayPaymentId}`);
    if (!safeEqual(expected, razorpaySignature.toLowerCase())) {
      throw new ConvexError(
        "Payment verification failed — if money was deducted it will reflect in the books shortly.",
      );
    }
    return await postUpiPayment(ctx, {
      paymentId,
      providerPaymentId: razorpayPaymentId,
      providerMethod: "upi",
    });
  },
});

/** Look a payment up by its gateway order id (webhook path). */
export const internalByProviderOrder = internalQuery({
  args: { providerOrderId: v.string() },
  handler: async (ctx, { providerOrderId }) => {
    return await ctx.db
      .query("upiPayments")
      .withIndex("by_provider_order", (q) => q.eq("providerOrderId", providerOrderId))
      .unique();
  },
});

export const internalMarkFailed = internalMutation({
  args: { paymentId: v.id("upiPayments"), reason: v.string() },
  handler: async (ctx, { paymentId, reason }) => {
    const p = await ctx.db.get(paymentId);
    if (!p || p.status !== "created") return;
    await ctx.db.patch(paymentId, { status: "cancelled", failureReason: reason });
  },
});

type PostResult = {
  posted: boolean;
  alreadyPosted?: boolean;
  voucherNo?: string | null;
  reason?: string;
};

/**
 * Post a captured UPI payment into the books: Dr the settlement bank/cash
 * account, Cr the member's receivable ledger, settle the chosen bills.
 *
 * Idempotent and defensive: a payment is posted at most once (status guard),
 * allocations are re-clamped to whatever the bills still owe, and if the
 * posting is impossible (books period moved on, accounts not configured) the
 * payment is kept as "captured" for the office instead of being lost.
 */
async function postUpiPayment(
  ctx: MutationCtx,
  {
    paymentId,
    providerPaymentId,
    providerMethod,
  }: { paymentId: Id<"upiPayments">; providerPaymentId?: string; providerMethod?: string },
): Promise<PostResult> {
  const p = await ctx.db.get(paymentId);
  if (!p) return { posted: false, reason: "Payment not found." };
  if (p.status === "posted") {
    return { posted: true, alreadyPosted: true, voucherNo: p.voucherNo ?? null };
  }
  if (p.status !== "created") {
    return { posted: false, reason: `Payment is ${p.status}.` };
  }

  const society = await ctx.db.get(p.societyId);
  const member = await ctx.db.get(p.memberId);
  if (!society || !member) {
    await ctx.db.patch(paymentId, {
      status: "captured",
      providerPaymentId,
      providerMethod,
      failureReason: "Society or member record missing — post this receipt from the office.",
    });
    return { posted: false, reason: "Society or member record missing." };
  }

  const date = new Date().toISOString().slice(0, 10);
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const settlementId =
    (society.upiSettlementAccountId &&
      accounts.find((a) => a._id === society.upiSettlementAccountId && a.kind === "bank_cash")
        ?._id) ||
    accounts.find((a) => a.kind === "bank_cash")?._id;
  const receivableId =
    society.receivableAccountId ?? accounts.find((a) => a.kind === "receivable")?._id;
  if (!settlementId || !receivableId) {
    await ctx.db.patch(paymentId, {
      status: "captured",
      providerPaymentId,
      providerMethod,
      failureReason:
        "No cash/bank or Members Receivable account configured — post this receipt from the office.",
    });
    return { posted: false, reason: "Accounts not configured." };
  }

  // Allocations are re-checked at posting time: balances may have moved since
  // the order was created. Each allocation is clamped to the bill's remaining
  // balance; whatever does not fit stays an advance on the ledger.
  const bills = await ctx.db
    .query("bills")
    .withIndex("by_society_member", (q) =>
      q.eq("societyId", p.societyId).eq("memberId", p.memberId),
    )
    .collect();
  const balanceOf = (billId: Id<"bills">) => {
    const bill = bills.find((b) => b._id === billId);
    return bill && bill.societyId === p.societyId
      ? bill.total - bill.paidAmount
      : undefined;
  };
  const applied = clampAllocations(p.allocations, balanceOf);

  // Books guard: money is real, so a posting that would fall outside the
  // current books period is parked as "captured" for the office — never lost.
  try {
    assertInFy(society, date, "UPI payment receipt");
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Outside the current books period.";
    await ctx.db.patch(paymentId, {
      status: "captured",
      providerPaymentId,
      providerMethod,
      failureReason: reason,
    });
    return { posted: false, reason };
  }

  try {
    const flatLabel =
      [member.wing, member.flatNo].filter(Boolean).join("-") || member.code;
    const { voucherId, voucherNo } = await postMemberReceipt(ctx, {
      society,
      memberId: p.memberId,
      date,
      bankCashAccountId: settlementId,
      mode: "upi",
      reference: providerPaymentId,
      narration: `Online UPI payment (order ${p.providerOrderId ?? "-"}) — flat ${flatLabel}`,
      allocations: applied,
      total: p.amount,
      upiPaymentId: paymentId,
    });
    await ctx.db.patch(paymentId, {
      status: "posted",
      voucherId,
      voucherNo,
      providerPaymentId,
      providerMethod,
      postedAt: Date.now(),
      failureReason: undefined,
    });
    return { posted: true, voucherNo };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Could not post the receipt.";
    await ctx.db.patch(paymentId, {
      status: "captured",
      providerPaymentId,
      providerMethod,
      failureReason: reason,
    });
    return { posted: false, reason };
  }
}

/** Internal wrapper so the webhook (an HTTP action) can post too. */
export const internalPostUpiPayment = internalMutation({
  args: {
    paymentId: v.id("upiPayments"),
    providerPaymentId: v.optional(v.string()),
    providerMethod: v.optional(v.string()),
  },
  handler: (ctx, args) => postUpiPayment(ctx, args),
});

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Razorpay webhook: payment.captured / payment.failed. The raw body is
 * verified against X-Razorpay-Signature with RAZORPAY_WEBHOOK_SECRET before
 * anything is read. Unknown order ids are acknowledged (200) so the gateway
 * does not retry forever; only "created" payments are posted, so replayed
 * webhooks and the member-side verification can never double-post.
 */
export const razorpayWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return jsonResponse({ ok: false, error: "webhook not configured" }, 500);
  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const expected = await hmacSha256Hex(secret, body);
  if (!safeEqual(expected, signature.toLowerCase())) {
    return jsonResponse({ ok: false, error: "invalid signature" }, 400);
  }

  let event: {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; method?: string; error_description?: string } } };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return jsonResponse({ ok: false, error: "invalid body" }, 400);
  }

  const entity = event.payload?.payment?.entity;
  if (entity?.order_id) {
    const p = await ctx.runQuery(internal.payments.internalByProviderOrder, {
      providerOrderId: entity.order_id,
    });
    if (p) {
      if (event.event === "payment.captured") {
        await ctx.runMutation(internal.payments.internalPostUpiPayment, {
          paymentId: p._id,
          providerPaymentId: entity.id,
          providerMethod: entity.method,
        });
      } else if (event.event === "payment.failed") {
        await ctx.runMutation(internal.payments.internalMarkFailed, {
          paymentId: p._id,
          reason: entity.error_description ?? "Payment failed at the gateway.",
        });
      }
    }
  }
  return jsonResponse({ ok: true }, 200);
});

/**
 * Office view: the society's most recent online payments. The Payments tab
 * uses this to surface anything that needs a human — typically money captured
 * while the books were closed or an account was missing.
 */
export const listOfficeUpiPayments = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const rows = await ctx.db
      .query("upiPayments")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(12);
    return await Promise.all(
      rows.map(async (r) => {
        const m = await ctx.db.get(r.memberId);
        return {
          _id: r._id,
          status: r.status,
          amount: r.amount,
          voucherNo: r.voucherNo ?? null,
          failureReason: r.failureReason ?? null,
          createdAt: r.createdAt,
          memberName: m?.name ?? "Member",
          flatLabel:
            [m?.wing, m?.flatNo].filter(Boolean).join("-") || m?.code || "",
        };
      }),
    );
  },
});

/** The member's recent online payments, newest first (portal status list). */
export const myUpiPayments = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const rows = await ctx.db
      .query("upiPayments")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
      )
      .order("desc")
      .take(8);
    return rows.map((r) => ({
      _id: r._id,
      amount: r.amount,
      status: r.status,
      voucherNo: r.voucherNo ?? null,
      createdAt: r.createdAt,
      postedAt: r.postedAt ?? null,
      failureReason: r.failureReason ?? null,
    }));
  },
});

/** Everything the receipt email needs, after authorisation. */
type ReceiptEmailContext = {
  to: string;
  voucherNo: string;
  amount: number;
  date: string;
  narration: string | null;
  societyName: string;
  senderName: string | null;
  replyTo: string | null;
};

/** Validate + gather everything the receipt email needs (server-side only). */
export const internalReceiptEmailContext = internalQuery({
  args: {
    societyId: v.id("societies"),
    voucherId: v.id("vouchers"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    { societyId, voucherId, userId },
  ): Promise<ReceiptEmailContext> => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher || voucher.societyId !== societyId || voucher.type !== "member_receipt") {
      throw new ConvexError("Receipt not found.");
    }
    const society = await ctx.db.get(societyId);
    if (!society) throw new ConvexError("Society not found.");
    // The caller must be the portal login bound to the flat this receipt is
    // for — members can only email their own receipts.
    const memberId = await societyMemberBinding(ctx, society, userId);
    if (!memberId || voucher.memberId !== memberId) {
      throw new ConvexError("This receipt belongs to another flat.");
    }
    const member = await ctx.db.get(voucher.memberId);
    if (!member?.email) {
      throw new ConvexError(
        "Your profile has no email address — ask the office to add one so receipts can be emailed.",
      );
    }
    return {
      to: member.email,
      voucherNo: voucher.voucherNo,
      amount: voucher.total,
      date: voucher.date,
      narration: voucher.narration ?? null,
      societyName: society.name,
      senderName: society.messagingSenderName ?? null,
      replyTo: society.messagingReplyTo ?? null,
    };
  },
});

/**
 * Email a member their own receipt PDF (base64 of the same legacy layout the
 * download buttons render in the browser). Used automatically after a UPI
 * payment posts and from the My Receipts page. The PDF bytes come from the
 * caller because the receipt renderer lives in browser code; the action only
 * forwards them after authorising the caller against the flat binding.
 */
export const emailMemberReceipt = action({
  args: {
    societyId: v.id("societies"),
    voucherId: v.id("vouchers"),
    pdfBase64: v.string(),
    filename: v.string(),
  },
  handler: async (
    ctx,
    { societyId, voucherId, pdfBase64, filename },
  ): Promise<{ ok: true; to: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const info: ReceiptEmailContext = await ctx.runQuery(
      internal.payments.internalReceiptEmailContext,
      {
        societyId,
        voucherId,
        userId,
      },
    );
    if (pdfBase64.length > 6_000_000) {
      throw new Error("The receipt PDF is too large to email.");
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Email is not configured yet — the society office has not added RESEND_API_KEY, so the receipt could not be emailed. It is still available in My Receipts.",
      );
    }
    const money = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(info.amount);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${info.senderName?.trim() || info.societyName} <onboarding@resend.dev>`,
        ...(info.replyTo?.trim() ? { reply_to: info.replyTo.trim() } : {}),
        to: [info.to],
        subject: `Receipt ${info.voucherNo} — ${info.societyName}`,
        html: `<p>Dear Member,</p><p>Thank you — your payment of <strong>₹${money}</strong> received on <strong>${info.date}</strong> has been recorded in the society books.</p><p>Receipt <strong>${info.voucherNo}</strong> is attached as a PDF and also available in your member portal under <em>My Receipts</em>.</p><p style="color:#64748b;font-size:12px">Automated message from ${info.societyName} · Imamm Chsl Accounting Solutions</p>`,
        attachments: [
          { filename, content: pdfBase64 },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Resend error ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }
    return { ok: true as const, to: info.to };
  },
});
