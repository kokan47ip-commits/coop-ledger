import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { clampAllocations, postMemberReceipt, requireSociety, requireSocietyWrite } from "./lib";
import { gatedEntry } from "./yearEnd";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Office approval queue for member-portal payment entries. A member's cash,
 * cheque or bank-transfer submission never posts by itself — an authorised
 * office login (society owner or an invited editor: the secretary, treasurer,
 * chairman or accountant) must pass it. Approval creates the member-receipt
 * voucher (Dr Bank/Cash, Cr Members Receivable) and applies the bill
 * allocations, exactly like the society's own Member Receipt screen.
 *
 * Editors can approve but not delete (the paper trail is protected), and
 * everyone approving is recorded so the audit trail shows who passed it.
 */

/** Pending entries for this society, oldest first (FIFO passing). */
export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const rows = await ctx.db
      .query("paymentSubmissions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("asc")
      .collect();

    const pending = rows.filter((r) => r.status === "pending");
    const recentDecided = rows
      .filter((r) => r.status !== "pending")
      .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))
      .slice(0, 8);

    const decorate = async (r: Doc<"paymentSubmissions">) => {
      const [member, account] = await Promise.all([
        ctx.db.get(r.memberId),
        ctx.db.get(r.bankCashAccountId),
      ]);
      return {
        _id: r._id,
        memberId: r.memberId,
        memberName: member?.name ?? "Member",
        flatLabel:
          [member?.wing, member?.flatNo].filter(Boolean).join("-") ||
          member?.code ||
          "",
        amount: r.amount,
        advanceAmount: r.advanceAmount,
        date: r.date,
        mode: r.mode,
        reference: r.reference ?? null,
        memberNote: r.memberNote ?? null,
        accountName: account ? `${account.code} — ${account.name}` : "Account removed",
        billCount: r.allocations.length,
        allocations: r.allocations,
        status: r.status,
        voucherNo: r.voucherNo ?? null,
        reviewNote: r.reviewNote ?? null,
        reviewedAt: r.reviewedAt ?? null,
        createdAt: r.createdAt,
      };
    };

    return {
      pending: await Promise.all(pending.map(decorate)),
      recent: await Promise.all(recentDecided.map(decorate)),
    };
  },
});

/** One submission with bill numbers for the office's allocation review. */
export const getWithBills = query({
  args: { societyId: v.id("societies"), id: v.id("paymentSubmissions") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
    const r = await ctx.db.get(id);
    if (!r || r.societyId !== societyId) return null;
    const member = await ctx.db.get(r.memberId);
    const bills = await Promise.all(
      r.allocations.map(async (a) => {
        const b = await ctx.db.get(a.billId);
        return {
          billId: a.billId,
          amount: a.amount,
          billNo: b?.billNo ?? "?",
          period: b?.period ?? "?",
        };
      }),
    );
    return {
      _id: r._id,
      memberId: r.memberId,
      memberName: member?.name ?? "Member",
      flatLabel:
        [member?.wing, member?.flatNo].filter(Boolean).join("-") ||
        member?.code ||
        "",
      amount: r.amount,
      advanceAmount: r.advanceAmount,
      date: r.date,
      mode: r.mode,
      reference: r.reference ?? null,
      memberNote: r.memberNote ?? null,
      status: r.status,
      bills,
    };
  },
});

/**
 * Approve (pass) a pending entry: creates the member-receipt voucher and
 * applies the allocations. Allocations are re-clamped to each bill's current
 * balance at posting time — amounts that no longer fit fall back to advance
 * on the member's ledger, so approval can never over-allocate a bill.
 */
export const approve = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("paymentSubmissions"),
    /** Optional office override of the posting date (must be in the FY). */
    date: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, id, date }) => {
    const society = await requireSocietyWrite(ctx, societyId);
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to approve entries.");

    const sub = await ctx.db.get(id);
    if (!sub || sub.societyId !== societyId) {
      throw new ConvexError("Payment entry not found.");
    }
    if (sub.status !== "pending") {
      throw new ConvexError(
        `This entry was already ${sub.status === "posted" ? "passed" : "rejected"}.`,
      );
    }

    const member = await ctx.db.get(sub.memberId);
    if (!member) {
      throw new ConvexError("The member row for this entry no longer exists.");
    }

    // The account the member paid into must still exist and be a bank/cash.
    const account = await ctx.db.get(sub.bankCashAccountId);
    if (!account || account.kind !== "bank_cash") {
      throw new ConvexError(
        "The cash/bank account for this entry no longer exists — edit the account setup or reject the entry.",
      );
    }

    const postDate = date ?? sub.date;
    await gatedEntry(ctx, society, postDate, "Approved member payment");

    // Re-clamp allocations against current bill balances; the rest is advance.
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", sub.memberId),
      )
      .collect();
    const balanceOf = (billId: Id<"bills">) => {
      const bill = bills.find((b) => b._id === billId);
      return bill && bill.societyId === societyId
        ? bill.total - bill.paidAmount
        : undefined;
    };
    const applied = clampAllocations(sub.allocations, balanceOf);
    const appliedTotal =
      Math.round(applied.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    // The member's amount always lands in the books: what no longer fits
    // against bills stays as advance credit on their ledger.
    const total = Math.max(sub.amount, appliedTotal);

    const flatLabel =
      [member.wing, member.flatNo].filter(Boolean).join("-") || member.code;
    const { voucherId, voucherNo } = await postMemberReceipt(ctx, {
      society,
      memberId: sub.memberId,
      date: postDate,
      bankCashAccountId: sub.bankCashAccountId,
      mode: sub.mode,
      reference: sub.reference,
      narration:
        sub.memberNote?.trim() ||
        `Portal payment entry by ${member.name} (flat ${flatLabel})${sub.reference ? `, ref ${sub.reference}` : ""}`,
      allocations: applied,
      total,
    });

    await ctx.db.patch(id, {
      status: "posted" as const,
      voucherId,
      voucherNo,
      reviewedById: userId,
      reviewedAt: Date.now(),
    });
    return { voucherNo, total };
  },
});

/**
 * Reject a pending entry with a short reason. The row is kept (never deleted)
 * so the member sees the decision and the audit trail stays complete.
 * Editors may reject but not delete; only the owner can delete.
 */
export const reject = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("paymentSubmissions"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, id, note }) => {
    await requireSocietyWrite(ctx, societyId);
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to review entries.");

    const sub = await ctx.db.get(id);
    if (!sub || sub.societyId !== societyId) {
      throw new ConvexError("Payment entry not found.");
    }
    if (sub.status !== "pending") {
      throw new ConvexError(
        `This entry was already ${sub.status === "posted" ? "passed" : "rejected"}.`,
      );
    }

    await ctx.db.patch(id, {
      status: "rejected" as const,
      reviewNote: note?.trim() || undefined,
      reviewedById: userId,
      reviewedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Remove a decided (posted/rejected) entry from the queue view. Owner-only —
 * posted rows carry the voucher link, so only the owner may clear those.
 */
export const removeDecided = mutation({
  args: { societyId: v.id("societies"), id: v.id("paymentSubmissions") },
  handler: async (ctx, { societyId, id }) => {
    const society = await requireSociety(ctx, societyId);
    const userId = await getAuthUserId(ctx);
    if (!userId || society.createdBy !== userId) {
      throw new ConvexError(
        "Only the society owner can remove decided entries from the list.",
      );
    }
    const sub = await ctx.db.get(id);
    if (!sub || sub.societyId !== societyId) {
      throw new ConvexError("Payment entry not found.");
    }
    if (sub.status === "pending") {
      throw new ConvexError(
        "This entry is still pending — pass or reject it instead of removing it.",
      );
    }
    await ctx.db.delete(id);
    return { ok: true };
  },
});

/** Internal: count of pending entries (used by dashboards/tests). */
export const internalPendingCount = internalQuery({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("paymentSubmissions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.filter((r) => r.status === "pending").length;
  },
});
