import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import { gatedEntry } from "./yearEnd";
import {
  applyAllocationToBill,
  assertVoucherNoFree,
  claimVoucherNo,
  requireSociety,
  requireSocietyWrite,
  resolveReceivableAccount,
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

/** Fetch vouchers by id for the edit flow (ownership-checked). */
export const getMany = query({
  args: { societyId: v.id("societies"), ids: v.array(v.id("vouchers")) },
  handler: async (ctx, { societyId, ids }) => {
    await requireSociety(ctx, societyId);
    const out = [];
    for (const id of ids.slice(0, 100)) {
      const v = await ctx.db.get(id);
      if (v && v.societyId === societyId) out.push(v);
    }
    return out;
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

/** Live duplicate check for the voucher forms' Voucher No. field. */
export const voucherNoTaken = query({
  args: {
    societyId: v.id("societies"),
    voucherNo: v.string(),
    excludeId: v.optional(v.id("vouchers")),
  },
  handler: async (ctx, { societyId, voucherNo, excludeId }) => {
    await requireSociety(ctx, societyId);
    const no = voucherNo.trim();
    if (!no) return false;
    const dupe = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .filter((q) => q.eq(q.field("voucherNo"), no))
      .first();
    return !!dupe && dupe._id !== excludeId;
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
    /** Office-typed voucher number; empty/absent = automatic numbering. */
    voucherNo?: string;
  },
) {
  const society = await ctx.db.get(societyId);
  const allAccounts = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  // Resolves the Members Receivable account and SELF-REPAIRS a mis-set
  // profile: if Society Profile → Accounting points at a bank/cash ledger
  // (the old nullified-bank-book bug), the society's proper receivable
  // ledger is used instead of refusing the save — the office sees a warning
  // on screen and the entry still posts Dr bank / Cr receivable correctly.
  const resolvedReceivable = resolveReceivableAccount(
    society?.receivableAccountId
      ? allAccounts.find((a) => a._id === society.receivableAccountId)
      : undefined,
    allAccounts,
  );
  const receivableId = resolvedReceivable.receivable._id;
  // A number typed in the form is duplicate-checked and refused with
  // "Duplicate Voucher No."; an empty field self-heals past counter drift —
  // so a duplicate voucher number can never be saved either way.
  const voucherNo =
    p.voucherNo?.trim() ?? (await claimVoucherNo(ctx, societyId, "member_receipt"));
  if (p.voucherNo?.trim()) await assertVoucherNoFree(ctx, societyId, voucherNo);
  const voucherId = await ctx.db.insert("vouchers", {
    societyId,
    type: "member_receipt" as const,
    voucherNo,
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
    /** Office-typed voucher number; empty/absent = automatic numbering. */
    voucherNo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { societyId, type, lines, allocations } = args;
    const society = await requireSocietyWrite(ctx, societyId);
    // Decline transactions dated outside the current accounting year.
    // FY gate with the closed-year override: privileged logins may correct
    // entries in a closed accounting year (bills stay out of reach below).
    await gatedEntry(ctx, society, args.date, "Voucher");

    const activeLines = lines.filter((l) => l.debit !== 0 || l.credit !== 0);

    // Member receipts auto-post Dr Bank/Cash, Cr Receivable; the amount comes
    // from the bill allocations when no manual lines are provided. An amount
    // ABOVE the allocations (or no allocations at all) is kept as an advance —
    // the full receipt is always credited to the member's ledger.
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
        voucherNo: args.voucherNo,
      });
    }

    if (activeLines.length < 2)
      throw new Error("A voucher needs at least two entry lines.");
    const debit = activeLines.reduce((s, l) => s + l.debit, 0);
    const credit = activeLines.reduce((s, l) => s + l.credit, 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100))
      throw new Error("Debits and credits must balance.");

    if (type === "member_receipt" && args.memberId) {
      // The receipt's total is what was received (the debit side); only the
      // allocated part settles bills — the remainder is an advance credit.
      return await insertMemberReceipt(ctx, societyId, {
        date: args.date,
        memberId: args.memberId,
        mode: args.mode,
        bankCashAccountId: args.bankCashAccountId,
        reference: args.reference,
        narration: args.narration,
        total: debit,
        allocations,
        voucherNo: args.voucherNo,
      });
    }

    // Office-typed voucher numbers are duplicate-checked ("Duplicate
    // Voucher No."); the automatic series self-heals past counter drift.
    const voucherNo =
      args.voucherNo?.trim() ?? (await claimVoucherNo(ctx, societyId, type));
    if (args.voucherNo?.trim()) await assertVoucherNoFree(ctx, societyId, voucherNo);
    const voucherId = await ctx.db.insert("vouchers", {
      societyId,
      type,
      voucherNo,
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

/**
 * Edit an existing voucher: replaces its entry lines, header fields and
 * (for payment/other-receipt) the cash/bank side. Member receipts keep their
 * original auto-posted structure — only date, mode, reference, narration and
 * bank/cash account are editable (total stays, allocations stay).
 */
export const update = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("vouchers"),
    date: v.string(),
    narration: v.optional(v.string()),
    mode: v.optional(v.string()),
    bankCashAccountId: v.optional(v.id("accounts")),
    reference: v.optional(v.string()),
    lines: v.array(
      v.object({
        accountId: v.id("accounts"),
        debit: v.number(),
        credit: v.number(),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { societyId, id, date, narration, mode, bankCashAccountId, reference, lines }) => {
    const society = await requireSocietyWrite(ctx, societyId);
    // Decline edits that would move a voucher outside the current year.
    await gatedEntry(ctx, society, date, "Voucher");
    const voucher = await ctx.db.get(id);
    if (!voucher || voucher.societyId !== societyId)
      throw new Error("Voucher not found.");

    const activeLines = lines.filter((l) => l.debit !== 0 || l.credit !== 0);
    if (activeLines.length < 2)
      throw new Error("A voucher needs at least two entry lines.");
    const debit = activeLines.reduce((s, l) => s + l.debit, 0);
    const credit = activeLines.reduce((s, l) => s + l.credit, 0);
    if (Math.round(debit * 100) !== Math.round(credit * 100))
      throw new Error("Debits and credits must balance.");

    if (voucher.type === "member_receipt") {
      // The amount and bill allocations are settled already, so they stay
      // fixed — only header fields (and the receiving cash/bank account) edit.
      const newBank = bankCashAccountId ?? voucher.bankCashAccountId;
      const lines2 = newBank
        ? voucher.lines.map((l) =>
            l.debit > 0 && l.accountId !== newBank
              ? { ...l, accountId: newBank }
              : l,
          )
        : voucher.lines;
      await ctx.db.patch(id, {
        date,
        narration,
        mode,
        bankCashAccountId: newBank,
        reference,
        lines: lines2,
      });
      return id;
    }

    // Cash/Bank change on a payment / other receipt: move the voucher's cash
    // leg onto the newly chosen account, so the header and the posted lines
    // can never disagree (the member-receipt branch remaps its bank line the
    // same way above).
    const newBank = bankCashAccountId ?? voucher.bankCashAccountId;
    const remapCash =
      newBank !== undefined &&
      voucher.bankCashAccountId !== undefined &&
      newBank !== voucher.bankCashAccountId;
    const nextLines = remapCash
      ? activeLines.map((l) =>
          l.accountId === voucher.bankCashAccountId
            ? { ...l, accountId: newBank }
            : l,
        )
      : activeLines;
    await ctx.db.patch(id, {
      date,
      narration,
      mode,
      bankCashAccountId: newBank,
      reference,
      total: debit,
      lines: nextLines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        note: l.note,
      })),
    });
    return id;
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("vouchers") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
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
