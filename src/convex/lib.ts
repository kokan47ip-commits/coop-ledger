import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
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

/** One member row as the portal binding/diagnosis reports it. */
export type PortalMemberSummary = {
  memberId: Id<"members">;
  code?: string;
  name: string;
  flatNo?: string;
  wing?: string;
  isActive: boolean;
  bills: number;
};

/**
 * Everything the portal binding resolver looks at for one login. Powers both
 * the resolver itself (societyMemberBinding) and the office-side diagnosis
 * (access.debugPortalBinding), so the two can never drift apart.
 */
export type PortalBindingAnalysis = {
  email: string | null;
  grant: {
    id: Id<"membersAccess">;
    email: string;
    memberId: Id<"members"> | null;
  } | null;
  bound: PortalMemberSummary | null;
  emailMatch: PortalMemberSummary | null;
  flatMatch: PortalMemberSummary | null;
  resolved: PortalMemberSummary | null;
  resolvedBy: string | null;
  activeMemberCount: number;
  activeMembersWithBills: number;
  totalBillsOnActiveMembers: number;
};

/**
 * Resolve (and explain) which member row a login's "member"-role grant binds
 * it to. Same logic as before, but every intermediate is reported so the
 * office can see WHY a portal shows (or doesn't show) bills. Accepts the
 * login email and, when the account exists, its user id (grant rows match on
 * either).
 */
export async function analyzePortalBinding(
  ctx: QueryCtx,
  society: Doc<"societies">,
  email: string | null,
  userId?: Id<"users">,
): Promise<PortalBindingAnalysis> {
  if (!email) {
    return {
      email: null,
      grant: null,
      bound: null,
      emailMatch: null,
      flatMatch: null,
      resolved: null,
      resolvedBy: null,
      activeMemberCount: 0,
      activeMembersWithBills: 0,
      totalBillsOnActiveMembers: 0,
    };
  }
  const grants = await ctx.db
    .query("membersAccess")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const grant =
    grants.find(
      (g) =>
        (g.userId === userId || g.email === email) &&
        g.role === "member" &&
        g.memberId !== undefined,
    ) ?? null;
  const boundId = grant?.memberId;
  const members = await ctx.db
    .query("members")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const norm = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const active = members.filter((m) => m.isActive);
  const bound = boundId ? await ctx.db.get(boundId) : undefined;

  // Candidate rows in preference order: the bound row, the active member
  // carrying the login email, then identity matches (re-imported members).
  const oldCode = norm(bound?.code);
  const oldFlat = norm(bound?.flatNo);
  const oldWing = norm(bound?.wing);
  const oldName = norm(bound?.name);
  const candidates: { member: Doc<"members">; matchedBy: string }[] = [];
  const push = (m: Doc<"members"> | null | undefined, matchedBy: string) => {
    if (
      m &&
      m.societyId === society._id &&
      !candidates.some((c) => c.member._id === m._id)
    )
      candidates.push({ member: m, matchedBy });
  };
  push(bound, "the portal grant binding");
  push(
    active.find((m) => norm(m.email) === email),
    "the member row carrying the login email",
  );
  if (bound) {
    push(active.find((m) => oldCode !== "" && norm(m.code) === oldCode), "a matching member code");
    push(
      active.find(
        (m) => oldFlat !== "" && norm(m.flatNo) === oldFlat && norm(m.wing) === oldWing,
      ),
      "a matching flat/wing",
    );
    push(active.find((m) => oldName !== "" && norm(m.name) === oldName), "a matching member name");
  }

  // Bill census over active members (also decides between candidates).
  const countBills = async (m: Doc<"members">) =>
    (
      await ctx.db
        .query("bills")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", society._id).eq("memberId", m._id),
        )
        .collect()
    ).length;
  const billsByMember = new Map<Id<"members">, number>();
  let membersWithBills = 0;
  let totalBills = 0;
  for (const m of active) {
    const n = await countBills(m);
    if (n > 0) {
      membersWithBills++;
      totalBills += n;
      billsByMember.set(m._id, n);
    }
  }

  // Bills decide: the right row is the one the register actually billed.
  const summarize = (m: Doc<"members"> | null | undefined): PortalMemberSummary | null =>
    m && m.societyId === society._id
      ? {
          memberId: m._id,
          code: m.code,
          name: m.name,
          flatNo: m.flatNo,
          wing: m.wing,
          isActive: m.isActive,
          bills: billsByMember.get(m._id) ?? 0,
        }
      : null;

  let resolved: { member: Doc<"members">; matchedBy: string } | undefined;
  let resolvedBy: string | null = null;
  for (const c of candidates) {
    if (c.member.isActive && (billsByMember.get(c.member._id) ?? 0) > 0) {
      resolved = c;
      resolvedBy = `resolves through ${c.matchedBy} — that row holds the bills`;
      break;
    }
  }
  if (!resolved) {
    // No bills anywhere (or none generated yet): keep the bound row when it
    // is active, else the best active candidate, else the original binding.
    const boundActive = bound && bound.societyId === society._id && bound.isActive;
    const activeCandidate = candidates.find((c) => c.member.isActive);
    if (boundActive) {
      resolved = { member: bound!, matchedBy: "the active portal grant binding" };
      resolvedBy = "no bills exist on any active member — kept the grant binding";
    } else if (activeCandidate) {
      resolved = activeCandidate;
      resolvedBy = "no bills exist on any active member — kept the best active candidate";
    } else if (bound) {
      resolved = { member: bound, matchedBy: "the original portal grant binding" };
      resolvedBy = "grant binding row (inactive)";
    }
  }

  const emailMatchRow = members.find((m) => norm(m.email) === email) ?? null;
  const flatMatchRow = bound
    ? (active.find(
        (m) => oldFlat !== "" && norm(m.flatNo) === oldFlat && norm(m.wing) === oldWing,
      ) ?? null)
    : null;

  return {
    email,
    grant: grant
      ? { id: grant._id, email: grant.email, memberId: grant.memberId ?? null }
      : null,
    bound: summarize(bound),
    emailMatch: summarize(emailMatchRow),
    flatMatch: summarize(flatMatchRow),
    resolved: summarize(resolved?.member),
    resolvedBy,
    activeMemberCount: active.length,
    activeMembersWithBills: membersWithBills,
    totalBillsOnActiveMembers: totalBills,
  };
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
  return (await analyzePortalBinding(ctx, society, email, userId)).resolved?.memberId ?? null;
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

/**
 * Duplicate voucher numbers are not allowed inside a society's books.
 * Every voucher insert (member receipt, other receipt, payment, journal —
 * forms and Excel uploads alike) passes its assigned number through this
 * guard: if the number is already taken the entry is refused with the exact
 * message the office expects, so numbering can never silently repeat.
 */
export async function assertVoucherNoFree(
  ctx: MutationCtx,
  societyId: Id<"societies">,
  voucherNo: string,
  excludeId?: Id<"vouchers">,
) {
  const dupe = await ctx.db
    .query("vouchers")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .filter((q) => q.eq(q.field("voucherNo"), voucherNo))
    .first();
  if (dupe && dupe._id !== excludeId) {
    throw new Error(
      `Duplicate Voucher No. — ${voucherNo} is already used in the books. Choose another number, or clear the field for automatic numbering.`,
    );
  }
}

/**
 * Allocates the next voucher number for a book and guarantees it is unused:
 * if the counter has fallen behind the stored vouchers (imported/restored
 * data whose numbering restarted), it advances past the taken numbers
 * instead of re-issuing them — duplicates are impossible and entry never
 * gets stuck on a colliding counter.
 */
export async function claimVoucherNo(
  ctx: MutationCtx,
  societyId: Id<"societies">,
  type: keyof typeof VOUCHER_PREFIX,
): Promise<string> {
  for (let guard = 0; guard < 50; guard++) {
    const n = await nextNumber(ctx, `${societyId}:voucher:${type}`);
    const voucherNo = `${VOUCHER_PREFIX[type]}-${pad(n)}`;
    const dupe = await ctx.db
      .query("vouchers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .filter((q) => q.eq(q.field("voucherNo"), voucherNo))
      .first();
    if (!dupe) return voucherNo;
  }
  throw new Error(
    "Duplicate Voucher No. — could not allocate a free voucher number. Check the voucher register for numbering gaps.",
  );
}

/**
 * The Members Receivable account must be a receivable ledger, NEVER a
 * bank/cash one. Member receipts credit it while debiting the bank/cash
 * account — if the receivable is set to a bank account (Society Profile →
 * Accounting), both receipt lines land on the SAME bank ledger: the bank
 * book then shows the amount on the Dr AND the Cr side and nets to zero
 * ("nullified"), while the member ledger still looks correct. Every receipt
 * path (manual form, portal/UPI auto-posting, Excel uploads) calls this
 * guard before writing anything.
 */
export function assertReceivableAccount(
  account:
    | { kind?: "bank_cash" | "receivable"; name?: string; code?: string }
    | undefined,
): void {
  if (account?.kind === "bank_cash") {
    throw new Error(
      `Members Receivable account is set to the bank/cash ledger "${account.name ?? account.code ?? "?"}" — member receipts would cancel out in the bank ledger. Fix it in Society Profile → Accounting (pick a proper receivable ledger).`,
    );
  }
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

/**
 * A bill line that restates the member's carried opening balance —
 * "Arrears — opening balance" (dues) or "Credit balance — advance adjusted"
 * (advance). Recognised by NAME first (the stable wording bill generation
 * uses) so member ledgers and outstanding totals never double-count the
 * opening balance — even when the society's receivable account was changed
 * after the bills were generated, or older data stored the line against a
 * different account. The receivable-only check (no tariff, receivable
 * account) stays as a fallback for line shapes predating the naming.
 */
export function isCarriedOpeningLine(
  line: { name: string; tariffId?: Id<"tariffs">; accountId: Id<"accounts"> },
  receivableId?: Id<"accounts">,
): boolean {
  const n = (line.name ?? "").toLowerCase();
  return (
    n.startsWith("arrears") ||
    n.startsWith("credit balance") ||
    (!!receivableId && !line.tariffId && line.accountId === receivableId)
  );
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

/**
 * Clamp wanted bill allocations to each bill's remaining balance at posting
 * time. Balances may have moved since the amounts were entered; whatever no
 * longer fits is dropped here and stays as advance credit on the member's
 * ledger instead of over-settling a bill. Bills that no longer exist (or
 * whose balance callback returns undefined) are skipped. Amounts round to
 * two decimals. Shared by office approval of portal entries and UPI posting.
 */
export function clampAllocations(
  wanted: { billId: Id<"bills">; amount: number }[],
  balanceOf: (billId: Id<"bills">) => number | undefined,
): { billId: Id<"bills">; amount: number }[] {
  const applied: { billId: Id<"bills">; amount: number }[] = [];
  for (const a of wanted) {
    const balance = balanceOf(a.billId);
    if (balance === undefined) continue;
    const amt = Math.min(a.amount, Math.max(0, balance));
    if (amt > 0.005) {
      applied.push({ billId: a.billId, amount: Math.round(amt * 100) / 100 });
    }
  }
  return applied;
}

export type MemberReceiptInput = {
  society: Doc<"societies">;
  memberId: Id<"members">;
  date: string;
  bankCashAccountId: Id<"accounts">;
  mode?: string;
  reference?: string;
  narration: string;
  allocations: { billId: Id<"bills">; amount: number }[];
  total: number;
  /** Links an auto-posted online (UPI) payment to its receipt voucher. */
  upiPaymentId?: Id<"upiPayments">;
};

/**
 * Post a member receipt voucher: Dr Bank/Cash, Cr Members Receivable, then
 * settle the bill allocations. Shared by the office Member Receipt form, the
 * member portal's manual payment and the online (UPI) payment auto-posting so
 * all three paths produce identical books entries. Callers must validate the
 * member, the bank/cash account and the allocations first.
 */
export async function postMemberReceipt(
  ctx: MutationCtx,
  input: MemberReceiptInput,
) {
  const { society, total } = input;
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const receivable =
    (society.receivableAccountId
      ? accounts.find((a) => a._id === society.receivableAccountId)
      : undefined) ?? accounts.find((a) => a.kind === "receivable");
  if (!receivable) {
    throw new ConvexError(
      "No Members Receivable account found — ask the society office to configure one.",
    );
  }
  // Declines a mis-set receivable that points at a bank/cash ledger —
  // without this the receipt's Dr and Cr would land on one bank account
  // and nullify each other in the bank ledger.
  assertReceivableAccount(receivable);
  const receivableId = receivable._id;
  // Self-healing numbering: advances past counter drift, so auto-posted
  // receipts (portal / UPI / office approvals) can never duplicate a number
  // that already exists in the books.
  const voucherNo = await claimVoucherNo(ctx, society._id, "member_receipt");
  const voucherId = await ctx.db.insert("vouchers", {
    societyId: society._id,
    type: "member_receipt" as const,
    voucherNo,
    date: input.date,
    memberId: input.memberId,
    mode: input.mode,
    bankCashAccountId: input.bankCashAccountId,
    reference: input.reference,
    narration: input.narration,
    total,
    lines: [
      { accountId: input.bankCashAccountId, debit: total, credit: 0 },
      { accountId: receivableId, debit: 0, credit: total, note: input.mode },
    ],
    allocations: input.allocations,
    upiPaymentId: input.upiPaymentId,
  });
  for (const a of input.allocations) {
    const bill = await ctx.db.get(a.billId);
    if (bill) await applyAllocationToBill(ctx, bill, a.amount);
  }
  return { voucherId, voucherNo };
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
