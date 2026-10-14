import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { nextNumber, pad, requireSociety, requireSocietyWrite } from "./lib";
import { gatedEntry } from "./yearEnd";

const CATEGORIES = [
  "Special Repair",
  "Emergency Fund",
  "Event Contribution",
  "Penalty",
  "Other",
] as const;

/**
 * Supplementary bills: charges billed outside the regular maintenance cycle
 * (special repairs, emergency funds, event contributions, penalties).
 *
 * They are stored as ordinary `bills` rows carrying `billKind:
 * "supplementary"` so every existing consumer — member ledger, member dues,
 * receipt allocation, bill register, statements — keeps working unchanged
 * with no special casing. Numbering runs on its own series (SB-0001…) so the
 * regular BILL-xxxx series is untouched.
 */

export const categories = query({
  args: {},
  handler: async () => CATEGORIES,
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    /** Charge description printed on the bill and shown on the ledger. */
    description: v.string(),
    category: v.union(...CATEGORIES.map((c) => v.literal(c))),
    amount: v.number(),
    issueDate: v.string(), // "YYYY-MM-DD"
    dueDate: v.string(),
    /** Income account the charge posts to (Other Income when not given). */
    accountId: v.optional(v.id("accounts")),
    memberIds: v.array(v.id("members")),
  },
  handler: async (
    ctx,
    { societyId, description, category, amount, issueDate, dueDate, accountId, memberIds },
  ) => {
    const society = await requireSocietyWrite(ctx, societyId);
    if (!description.trim())
      throw new Error("Enter a charge description for the supplementary bill.");
    if (!(amount > 0)) throw new Error("Amount must be a positive number.");
    if (memberIds.length === 0)
      throw new Error("Select at least one member to bill.");
    // Supplementary bills post income to the books — same FY rule as regular
    // bills, with the closed-year override for privileged logins.
    await gatedEntry(ctx, society, issueDate, "Supplementary bill");

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const incomeAccount = accountId
      ? accounts.find((a) => a._id === accountId && a.societyId === societyId)
      : undefined;
    if (accountId && !incomeAccount)
      throw new Error("Selected income account not found in this society's Chart of Accounts.");
    const chosen =
      incomeAccount ??
      accounts.find((a) => a.type === "income" && a.name.toLowerCase().includes("other income")) ??
      accounts.filter((a) => a.type === "income").sort((a, b) => a.code.localeCompare(b.code))[0];
    if (!chosen)
      throw new Error(
        "No income account found to post the supplementary charge to — add one in Chart of Accounts first.",
      );

    const period = issueDate.slice(0, 7);
    let created = 0;
    let skipped = 0;
    for (const memberId of memberIds) {
      const member = await ctx.db.get(memberId);
      if (!member || member.societyId !== societyId || !member.isActive) {
        skipped++;
        continue;
      }
      const n = await nextNumber(ctx, `${societyId}:supp`);
      await ctx.db.insert("bills", {
        societyId,
        billNo: `SB-${pad(n)}`,
        memberId,
        period,
        issueDate,
        dueDate,
        billKind: "supplementary",
        category,
        lines: [
          {
            tariffId: undefined,
            accountId: chosen._id,
            name: `${category} — ${description.trim()}`,
            amount: Math.round(amount * 100) / 100,
            printNo: undefined,
          },
        ],
        total: Math.round(amount * 100) / 100,
        paidAmount: 0,
        status: "unpaid",
      });
      created++;
    }
    return { created, skipped };
  },
});

/** Supplementary-bill register rows for one society. */
export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("bills")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .filter((q) => q.eq(q.field("billKind"), "supplementary"))
      .collect();
  },
});

/** All supplementary bills of one member — portal / statement needs. */
export const listByMember = query({
  args: { societyId: v.id("societies"), memberId: v.id("members") },
  handler: async (ctx, { societyId, memberId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", memberId),
      )
      .filter((q) => q.eq(q.field("billKind"), "supplementary"))
      .collect();
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("bills") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
    const bill = await ctx.db.get(id);
    if (!bill || bill.societyId !== societyId || bill.billKind !== "supplementary")
      throw new Error("Supplementary bill not found.");
    // Same policy as regular bills: receipts stay as ledger credits,
    // allocations are detached.
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const vch of vouchers) {
      const allocs = (vch.allocations ?? []).filter((a) => a.billId !== id);
      if (allocs.length !== (vch.allocations ?? []).length) {
        await ctx.db.patch(vch._id, {
          allocations: allocs.length > 0 ? allocs : undefined,
        });
      }
    }
    await ctx.db.delete(id);
  },
});
