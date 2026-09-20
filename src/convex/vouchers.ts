import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import {
  applyAllocationToBill,
  nextNumber,
  pad,
  requireSociety,
  VOUCHER_PREFIX,
} from "./lib";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const listByMember = query({
  args: { societyId: v.id("societies"), memberId: v.id("members") },
  handler: async (ctx, { societyId, memberId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("vouchers")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", memberId),
      )
      .collect();
  },
});

const voucherType = v.union(
  v.literal("member_receipt"),
  v.literal("other_receipt"),
  v.literal("payment"),
  v.literal("journal"),
);

/** Last issued voucher number for a book (e.g. "PY-0021"), for the voucher form header. */
export const lastNo = query({
  args: { societyId: v.id("societies"), type: voucherType },
  handler: async (ctx, { societyId, type }) => {
    await requireSociety(ctx, societyId);
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    let max = 0;
    let lastVoucherNo: string | null = null;
    for (const v of vouchers) {
      if (v.type !== type) continue;
      const m = v.voucherNo.match(/(\d+)$/);
      const n = m ? Number(m[1]) : 0;
      if (n >= max) {
        max = n;
        lastVoucherNo = v.voucherNo;
      }
    }
    return { last: max, lastVoucherNo, prefix: VOUCHER_PREFIX[type] };
  },
});

/**
 * Auto-posts a member receipt: Dr Bank/Cash, Cr Members Receivable, then
 * applies any bill allocations. Shared by the manual form (amount derived
 * from lines) and the quick-pay dialog (amount derived from allocations).
 */
async function insertMemberReceipt(
  ctx: MutationCtx,
  societyId: Id<"societies">,
  p: {
    date: string;
    memberId: Id<"members">;
    mode?: string;
    bankCashAccountId?: Id<"accounts">;
    reference?: string;
    narration?: string;
    total: number;
    allocations?: { billId: Id<"bills">; amount: number }[];
  },
) {
  const society = await ctx.db.get(societyId);
  const allAccounts = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const receivableId =
    society?.receivableAccountId ??
    allAccounts.find((a) => a.kind === "receivable")?._id;
  if (!receivableId)
    throw new Error(
      "No Members Receivable account found — add one in Chart of Accounts with the 'Members Receivable' role.",
    );
  const n = await nextNumber(ctx, `${societyId}:voucher:member_receipt`);
  const voucherId = await ctx.db.insert("vouchers", {
    societyId,
    type: "member_receipt" as const,
    voucherNo: `${VOUCHER_PREFIX.member_receipt}-${pad(n)}`,
    date: p.date,
    memberId: p.memberId,
    mode: p.mode,
    bankCashAccountId: p.bankCashAccountId,
    reference: p.reference,
    narration: p.narration,
    total: p.total,
    lines: [
      {
        accountId: p.bankCashAccountId ?? receivableId,
        debit: p.total,
        credit: 0,
      },
      {
        accountId: receivableId,
        debit: 0,
        credit: p.total,
        note: p.mode,
      },
    ],
    allocations: p.allocations,
  });
  if (p.allocations && p.allocations.length > 0) {
    const memberBills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", p.memberId),
      )
      .collect();
    for (const a of p.allocations) {
      const bill = memberBills.find((b) => b._id === a.billId);
      if (bill) await applyAllocationToBill(ctx, bill, a.amount);
    }
  }
  return voucherId;
}

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    type: v.union(
      v.literal("member_receipt"),
      v.literal("other_receipt"),
      v.literal("payment"),
      v.literal("journal"),
    ),
    date: v.string(),
    memberId: v.optional(v.id("members")),
    mode: v.optional(v.string()),
    bankCashAccountId: v.optional(v.id("accounts")),
    reference: v.optional(v.string()),
    narration: v.optional(v.string()),
    lines: v.array(
      v.object({
        accountId: v.id("accounts"),
        debit: v.number(),
        credit: v.number(),
        note: v.optional(v.string()),
      }),
    ),
    allocations: v.optional(
      v.array(v.object({ billId: v.id("bills"), amount: v.number() })),
    ),
  },
  handler: async (ctx, args) => {
    const { societyId, type, lines, allocations } = args;
    await requireSociety(ctx, societyId);

    const activeLines = lines.filter((l) => l.debit !== 0 || l.credit !== 0);

    // Member receipts auto-post Dr Bank/Cash, Cr Receivable; the amount comes
    // from the bill allocations when no manual lines are provided.
    if (type === "member_receipt" && activeLines.length === 0) {
      const allocTotal = (allocations ?? []).reduce((s, a) => s + a.amount, 0);
      if (allocTotal <= 0)
        throw new Error(
          "Provide bill allocations or entry lines for the receipt.",
        );
      return await insertMemberReceipt(ctx, societyId, {
        date: args.date,
        memberId: args.memberId!,
        mode: args.mode,
        bankCashAccountId: args.bankCashAccountId,
        reference: args.reference,
        narration: args.narration,
        total: allocTotal,
        allocations,
      });
    }

    if (activeLines.length < 2)
      throw new Error("A voucher needs at least two entry lines.");
    const debit = activeLines.reduce((s, l) => s + l.debit, 0);
    const credit = activeLines.reduce((s, l) => s + l.credit, 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100))
      throw new Error("Debits and credits must balance.");

    if (type === "member_receipt" && args.memberId) {
      return await insertMemberReceipt(ctx, societyId, {
        date: args.date,
        memberId: args.memberId,
        mode: args.mode,
        bankCashAccountId: args.bankCashAccountId,
        reference: args.reference,
        narration: args.narration,
        total: debit,
        allocations,
      });
    }

    const n = await nextNumber(ctx, `${societyId}:voucher:${type}`);
    const voucherId = await ctx.db.insert("vouchers", {
      societyId,
      type,
      voucherNo: `${VOUCHER_PREFIX[type]}-${pad(n)}`,
      date: args.date,
      memberId: args.memberId,
      mode: args.mode,
      bankCashAccountId: args.bankCashAccountId,
      reference: args.reference,
      narration: args.narration,
      total: debit,
      lines: activeLines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        note: l.note,
      })),
      allocations: undefined,
    });
    return voucherId;
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("vouchers") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
    const voucher = await ctx.db.get(id);
    if (!voucher || voucher.societyId !== societyId)
      throw new Error("Voucher not found.");
    for (const a of voucher.allocations ?? []) {
      const bill = await ctx.db.get(a.billId);
      if (bill) {
        const paidAmount = Math.max(0, bill.paidAmount - a.amount);
        await ctx.db.patch(bill._id, {
          paidAmount,
          status:
            paidAmount <= 0
              ? "unpaid"
              : paidAmount >= bill.total
                ? "paid"
                : "partial",
        });
      }
    }
    await ctx.db.delete(id);
  },
});
