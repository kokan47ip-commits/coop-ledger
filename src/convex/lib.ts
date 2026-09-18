import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

export async function requireUserId(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in.");
  return userId;
}

export async function requireSociety(
  ctx: QueryCtx,
  societyId: Id<"societies">,
): Promise<Doc<"societies">> {
  const userId = await requireUserId(ctx);
  const society = await ctx.db.get(societyId);
  if (!society || society.createdBy !== userId) {
    throw new Error("Society not found.");
  }
  return society;
}

export async function nextNumber(ctx: MutationCtx, key: string) {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const value = (counter?.value ?? 0) + 1;
  if (counter) {
    await ctx.db.patch(counter._id, { value });
  } else {
    await ctx.db.insert("counters", { key, value });
  }
  return value;
}

export function pad(n: number) {
  return String(n).padStart(4, "0");
}

export const VOUCHER_PREFIX = {
  member_receipt: "MR",
  other_receipt: "OR",
  payment: "PY",
  journal: "JV",
} as const;

export const DEFAULT_ACCOUNTS: {
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  kind?: "bank_cash" | "receivable";
}[] = [
  { code: "1000", name: "Members Receivable", type: "asset", kind: "receivable" },
  { code: "1010", name: "Cash in Hand", type: "asset", kind: "bank_cash" },
  { code: "1020", name: "Bank Account", type: "asset", kind: "bank_cash" },
  { code: "2000", name: "Corpus Fund", type: "liability" },
  { code: "2010", name: "Sinking Fund", type: "liability" },
  { code: "2020", name: "Repair & Renovation Fund", type: "liability" },
  { code: "3000", name: "Maintenance Charges", type: "income" },
  { code: "3010", name: "Sinking Fund Contribution", type: "income" },
  { code: "3020", name: "Parking Charges", type: "income" },
  { code: "3030", name: "Interest Income", type: "income" },
  { code: "3040", name: "Other Income", type: "income" },
  { code: "4000", name: "Electricity Charges", type: "expense" },
  { code: "4010", name: "Water Charges", type: "expense" },
  { code: "4020", name: "Repairs & Maintenance", type: "expense" },
  { code: "4030", name: "Salaries & Wages", type: "expense" },
  { code: "4040", name: "Security Charges", type: "expense" },
  { code: "4050", name: "Housekeeping Charges", type: "expense" },
  { code: "4060", name: "Audit & Accounting Fees", type: "expense" },
  { code: "4070", name: "Office Expenses", type: "expense" },
  { code: "4080", name: "Bank Charges", type: "expense" },
];

export function recomputeBillStatus(total: number, paidAmount: number) {
  if (paidAmount <= 0) return "unpaid" as const;
  if (paidAmount >= total) return "paid" as const;
  return "partial" as const;
}

export async function applyAllocationToBill(
  ctx: MutationCtx,
  bill: Doc<"bills">,
  amount: number,
) {
  const paidAmount = Math.min(bill.total, bill.paidAmount + amount);
  await ctx.db.patch(bill._id, {
    paidAmount,
    status: recomputeBillStatus(bill.total, paidAmount),
  });
}

export function fyStartDateString(fyStartMonth: number, onOrBefore: string) {
  // Returns "YYYY-MM-01" of the financial-year start for the date given (ISO).
  const [y, m] = onOrBefore.split("-").map(Number);
  const year = m >= fyStartMonth ? y : y - 1;
  return `${year}-${String(fyStartMonth).padStart(2, "0")}-01`;
}
