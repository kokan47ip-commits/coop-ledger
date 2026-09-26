import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Effective access level a user holds over a society. "owner" is the creator;
 * "editor" (entry rights) and "viewer" (read-only) come from explicit grants
 * in the membersAccess table, matched by user id or email. "member" is a
 * flat-bound portal login — it does not open the society's books, only the
 * member self-service portal.
 */
export type SocietyAccess = "owner" | "editor" | "viewer" | "member" | "none";

export async function requireUserId(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in.");
  return userId;
}

/** True when the signed-in user is a software-level administrator. */
export async function isSoftwareAdmin(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user?.softwareAdmin === true;
}

/**
 * Resolve the caller's access level over a society. Software admins bypass
 * grant checks. Non-owners get access through an explicit grant row (by user
 * id, falling back to their verified email). Guests never inherit grants.
 */
export async function societyAccess(
  ctx: QueryCtx,
  society: Doc<"societies">,
  userId: Id<"users">,
): Promise<SocietyAccess> {
  if (society.createdBy === userId) return "owner";
  if (await isSoftwareAdmin(ctx, userId)) return "editor";
  const user = await ctx.db.get(userId);
  const email = user?.email?.toLowerCase().trim() ?? null;
  if (!email) return "none";
  const grants = await ctx.db
    .query("membersAccess")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const grant = grants.find(
    (g) => g.userId === userId || g.email === email,
  );
  return grant?.role ?? "none";
}

/**
 * The flat a "member"-role grant binds this user to in a society, if any.
 * Resolved from the same grant row used by societyAccess.
 */
export async function societyMemberBinding(
  ctx: QueryCtx,
  society: Doc<"societies">,
  userId: Id<"users">,
): Promise<Id<"members"> | null> {
  const user = await ctx.db.get(userId);
  const email = user?.email?.toLowerCase().trim() ?? null;
  if (!email) return null;
  const grants = await ctx.db
    .query("membersAccess")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const grant = grants.find(
    (g) =>
      (g.userId === userId || g.email === email) &&
      g.role === "member" &&
      g.memberId !== undefined,
  );
  const boundId = grant?.memberId;
  if (boundId) {
    const bound = await ctx.db.get(boundId);
    // Row still exists → bind as before (an office deactivation must not
    // silently re-point the login somewhere else). Self-heal only when the
    // bound row is gone, e.g. members were re-imported and bills now live on
    // a new row while the grant still pointed at the deleted one.
    if (bound && bound.societyId === society._id) return bound._id;
  }
  const members = await ctx.db
    .query("members")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const norm = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const old = boundId ? await ctx.db.get(boundId) : undefined;
  const oldCode = norm(old?.code);
  const oldFlat = norm(old?.flatNo);
  const oldWing = norm(old?.wing);
  const oldName = norm(old?.name);
  const byIdentity = old
    ? members.find((m) => oldCode !== "" && norm(m.code) === oldCode) ??
      members.find(
        (m) => oldFlat !== "" && norm(m.flatNo) === oldFlat && norm(m.wing) === oldWing,
      ) ??
      members.find((m) => oldName !== "" && norm(m.name) === oldName)
    : undefined;
  const byEmail = members.find((m) => norm(m.email) === email);
  return byIdentity?._id ?? byEmail?._id ?? null;
}

/** True when the signed-in user is a software-level administrator. */

/**
 * Read access: owner, an invited user, or (legacy) any user able to pass the
 * old creator check. Throws "Society not found" for outsiders so unrelated
 * users get no information about the society's existence.
 */
export async function requireSociety(
  ctx: QueryCtx,
  societyId: Id<"societies">,
): Promise<Doc<"societies">> {
  const userId = await requireUserId(ctx);
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const access = await societyAccess(ctx, society, userId);
  // "member" logins have no book access — every societies query/mutation is
  // out of bounds; they use the dedicated portal functions instead.
  if (access === "none" || access === "member")
    throw new Error("Society not found.");
  return society;
}

/**
 * Write access: only the owner or an invited "editor". Viewers and outsiders
 * are declined with a clear message — used by every entry/master mutation.
 */
export async function requireSocietyWrite(
  ctx: MutationCtx,
  societyId: Id<"societies">,
): Promise<Doc<"societies">> {
  const userId = await requireUserId(ctx);
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const access = await societyAccess(ctx, society, userId);
  if (access === "none" || access === "member")
    throw new Error("Society not found.");
  if (access === "viewer") {
    throw new Error(
      "You have view-only rights for this society — changes are not allowed. Ask the society owner for entry access.",
    );
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

export type GroupSeed = {
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  sequence: number;
};

export const DEFAULT_GROUPS: GroupSeed[] = [
  { code: "GA", name: "Current Assets", type: "asset", sequence: 1 },
  { code: "GA", name: "Fixed Assets", type: "asset", sequence: 2 },
  { code: "GL", name: "Capital Account", type: "liability", sequence: 1 },
  { code: "GL", name: "Reserve & Surplus", type: "liability", sequence: 2 },
  { code: "GL", name: "Loans (Liability)", type: "liability", sequence: 3 },
  { code: "GI", name: "Direct Income", type: "income", sequence: 1 },
  { code: "GI", name: "Indirect Incomes", type: "income", sequence: 2 },
  { code: "GE", name: "Direct Expenses", type: "expense", sequence: 1 },
  { code: "GE", name: "Indirect Expenses", type: "expense", sequence: 2 },
];

export const DEFAULT_ACCOUNTS: {
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  kind?: "bank_cash" | "receivable";
  /** Group name from DEFAULT_GROUPS that this account is filed under. */
  group?: string;
}[] = [
  { code: "1000", name: "Members Receivable", type: "asset", kind: "receivable", group: "Current Assets" },
  { code: "1010", name: "Cash in Hand", type: "asset", kind: "bank_cash", group: "Current Assets" },
  { code: "1020", name: "Bank Account", type: "asset", kind: "bank_cash", group: "Current Assets" },
  { code: "2000", name: "Corpus Fund", type: "liability", group: "Reserve & Surplus" },
  { code: "2010", name: "Sinking Fund", type: "liability", group: "Reserve & Surplus" },
  { code: "2020", name: "Repair & Renovation Fund", type: "liability", group: "Reserve & Surplus" },
  { code: "3000", name: "Maintenance Charges", type: "income", group: "Direct Income" },
  { code: "3010", name: "Sinking Fund Contribution", type: "income", group: "Direct Income" },
  { code: "3020", name: "Parking Charges", type: "income", group: "Direct Income" },
  { code: "3030", name: "Interest Income", type: "income", group: "Indirect Incomes" },
  { code: "3040", name: "Other Income", type: "income", group: "Indirect Incomes" },
  { code: "4000", name: "Electricity Charges", type: "expense", group: "Indirect Expenses" },
  { code: "4010", name: "Water Charges", type: "expense", group: "Indirect Expenses" },
  { code: "4020", name: "Repairs & Maintenance", type: "expense", group: "Indirect Expenses" },
  { code: "4030", name: "Salaries & Wages", type: "expense", group: "Indirect Expenses" },
  { code: "4040", name: "Security Charges", type: "expense", group: "Indirect Expenses" },
  { code: "4050", name: "Housekeeping Charges", type: "expense", group: "Indirect Expenses" },
  { code: "4060", name: "Audit & Accounting Fees", type: "expense", group: "Indirect Expenses" },
  { code: "4070", name: "Office Expenses", type: "expense", group: "Indirect Expenses" },
  { code: "4080", name: "Bank Charges", type: "expense", group: "Indirect Expenses" },
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

/**
 * ISO from/to of the society's current books period — anchored on the explicit
 * fyStartDate when set, otherwise the financial year containing today (mirrors
 * effectiveFyPeriod on the client).
 */
export function societyFyPeriod(society: Doc<"societies">): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const from =
    society.fyStartDate?.slice(0, 10) ?? fyStartDateString(society.fyStartMonth, today);
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, to: end.toISOString().slice(0, 10) };
}

/**
 * Guard: a dated transaction must fall inside the current financial year.
 * Anything outside is declined with a clear message so books never pick up
 * entries from another accounting year.
 */
export function assertInFy(society: Doc<"societies">, date: string, label: string) {
  const d = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new Error(`${label} date is invalid — enter a valid YYYY-MM-DD date.`);
  const { from, to } = societyFyPeriod(society);
  if (d < from || d > to) {
    const fyLabel = society.fyYear ?? `${from.slice(0, 4)}-${to.slice(2, 4)}`;
    throw new Error(
      `${label} dated ${d} is outside the current financial year (${fyLabel}: ${from} to ${to}). Entry declined — not saved.`,
    );
  }
}
