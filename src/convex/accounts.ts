import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireSociety, requireSocietyWrite } from "./lib";
import type { MutationCtx } from "./_generated/server";

/**
 * System ledgers the Form N statements post to. Created once per society
 * (idempotent) from the Chart of Accounts, and seeded automatically for new
 * societies alongside the default accounts.
 */
export const FORM_N_LEDGERS = [
  {
    code: "1090",
    name: "Dues from Members",
    type: "asset" as const,
    kind: "receivable" as const,
  },
  {
    code: "2990",
    name: "Advance from Members",
    type: "liability" as const,
  },
  {
    code: "2991",
    name: "Income over Expenses",
    type: "liability" as const,
  },
];

/**
 * Create any of the system Form N ledgers the society is missing: "Dues from
 * Members" (the member-outstanding control, asset), "Advance from Members"
 * (money members paid ahead of billing, liability) and "Income over Expenses"
 * (the surplus the Balance Sheet carries, liability). Existing ledgers — by
 * exact name — are left untouched, so this can be run repeatedly.
 */
export async function ensureFormNLedgers(ctx: MutationCtx, societyId: Id<"societies">) {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const names = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  for (const l of FORM_N_LEDGERS) {
    if (names.has(l.name.toLowerCase())) continue;
    await ctx.db.insert("accounts", {
      societyId,
      code: l.code,
      name: l.name,
      type: l.type,
      kind: l.kind,
      openingBalance: 0,
    });
  }
}

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    return await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("accounts")),
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("income"),
      v.literal("expense"),
    ),
    kind: v.optional(v.union(v.literal("bank_cash"), v.literal("receivable"))),
    openingBalance: v.number(),
    groupId: v.optional(v.id("accountGroups")),
    /** Printing serial no. for the order of this ledger on printed statements. */
    printNo: v.optional(v.string()),
  },
  handler: async (ctx, { societyId, id, ...data }) => {
    await requireSocietyWrite(ctx, societyId);
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("accounts", { societyId, ...data });
  },
});

export const remove = mutation({
  args: { societyId: v.id("societies"), id: v.id("accounts") },
  handler: async (ctx, { societyId, id }) => {
    await requireSocietyWrite(ctx, societyId);
    const vouchers = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const used =
      vouchers.some(
        (v) =>
          v.bankCashAccountId === id ||
          v.lines.some((l) => l.accountId === id),
      ) ||
      (await ctx.db
        .query("tariffs")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()).some((t) => t.accountId === id) ||
      (await ctx.db
        .query("bills")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()).some((b) => b.lines.some((l) => l.accountId === id));
    if (used)
      throw new Error("Account is used by vouchers, tariffs or bills.");
    await ctx.db.delete(id);
  },
});

/** Create the system Form N ledgers this society is missing. Idempotent. */
export const ensureSystem = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSocietyWrite(ctx, societyId);
    await ensureFormNLedgers(ctx, societyId);
    const created = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return FORM_N_LEDGERS.map((l) =>
      created.find((a) => a.name === l.name)?._id,
    ).filter((id): id is Id<"accounts"> => !!id);
  },
});
