import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertInFy,
  isSoftwareAdmin,
  nextNumber,
  pad,
  requireSociety,
  requireUserId,
  societyMemberBinding,
  VOUCHER_PREFIX,
} from "./lib";
import { applyAllocationToBill } from "./lib";
import { verifyPassword, hashPassword } from "./passwordHash";

/**
 * Member self-service portal. Every function here is scoped to the flat the
 * signed-in user is bound to via their "member" access grant — no society
 * book access, no other members' data. Queries return null when the caller
 * is not a portal member of that society so the UI can bounce them.
 */

type PortalCtx = { societyId: Id<"societies">; memberId: Id<"members"> };

/** Resolve the caller's flat binding, or null when they are not a portal member. */
async function portalBinding(
  ctx: Parameters<typeof requireUserId>[0],
  societyId: Id<"societies">,
): Promise<PortalCtx | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const society = await ctx.db.get(societyId);
  if (!society) return null;
  const memberId = await societyMemberBinding(ctx, society, userId);
  if (!memberId) return null;
  return { societyId, memberId };
}

/** The member's profile, flat, society summary and account balance. */
export const myInfo = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const [member, society] = await Promise.all([
      ctx.db.get(bind.memberId),
      ctx.db.get(societyId),
    ]);
    if (!member || !society) return null;

    // Outstanding = opening + all bills - all receipts (mirrors the ledger).
    const [bills, receipts] = await Promise.all([
      ctx.db
        .query("bills")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
        )
        .collect(),
      ctx.db
        .query("vouchers")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
        )
        .collect(),
    ]);
    const totalBilled = bills.reduce((s, b) => s + b.total, 0);
    const totalPaid = receipts
      .filter((r) => r.type === "member_receipt")
      .reduce((s, r) => s + r.total, 0);
    const outstanding = member.openingBalance + totalBilled - totalPaid;

    return {
      society: {
        _id: society._id,
        name: society.name,
        address: society.address,
        city: society.city,
        state: society.state,
        pincode: society.pincode,
        email: society.email,
        phone: society.phone,
        registrationNo: society.registrationNo,
        fyYear: society.fyYear,
      },
      member: {
        _id: member._id,
        code: member.code,
        name: member.name,
        flatNo: member.flatNo,
        wing: member.wing,
        building: member.building,
        unitType: member.unitType,
        floor: member.floor,
        buildupArea: member.buildupArea,
        carpetArea: member.carpetArea,
        phone: member.phone,
        email: member.email,
        ownershipType: member.ownershipType,
        joinDate: member.joinDate,
        isActive: member.isActive,
      },
      totals: { totalBilled, totalPaid, outstanding },
    };
  },
});

/** My bills — newest first, with a download-ready shape. */
export const myBills = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
      )
      .collect();
    return bills.sort((a, b) =>
      a.period === b.period
        ? b.billNo.localeCompare(a.billNo)
        : b.period.localeCompare(a.period),
    );
  },
});

/** My receipts — member_receipt vouchers for my flat only, newest first. */
export const myReceipts = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const rows = await ctx.db
      .query("vouchers")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
      )
      .collect();
    return rows
      .filter((r) => r.type === "member_receipt")
      .sort((a, b) => b.date.localeCompare(a.date));
  },
});

/**
 * Read-only diagnosis for an empty portal: what the login is bound to, how
 * many members are active, and where this login's bills would live. Shown on
 * the portal Bills page when the list is empty so the office can fix the
 * grant/binding without guesswork.
 */
export const debugMyBinding = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { email: null as string | null, grants: [], bound: null, emailMatch: null, activeMembers: 0, billsOnActiveMembers: 0 };
    const society = await ctx.db.get(societyId);
    if (!society) return { email: null as string | null, grants: [], bound: null, emailMatch: null, activeMembers: 0, billsOnActiveMembers: 0 };
    const user = await ctx.db.get(userId);
    const email = user?.email?.toLowerCase().trim() ?? null;
    const grants = await ctx.db
      .query("membersAccess")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const myGrants = grants
      .filter((g) => (email && g.email === email) || g.userId === userId)
      .map((g) => ({ role: g.role, memberId: g.memberId ?? null, grantEmail: g.email }));
    const memberGrant = myGrants.find((g) => g.role === "member" && g.memberId);
    const boundId = memberGrant?.memberId ?? null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const active = members.filter((m) => m.isActive);
    const countBills = async (memberId: Id<"members">) =>
      (
        await ctx.db
          .query("bills")
          .withIndex("by_society_member", (q) =>
            q.eq("societyId", societyId).eq("memberId", memberId),
          )
          .collect()
      ).length;
    const boundRow = boundId ? (members.find((m) => m._id === boundId) ?? null) : null;
    const bound = boundRow
      ? {
          name: boundRow.name,
          flat: [boundRow.wing, boundRow.flatNo].filter(Boolean).join("-") || boundRow.code,
          isActive: boundRow.isActive,
          bills: await countBills(boundRow._id),
        }
      : boundId
        ? { name: null, flat: null, isActive: false, bills: 0 }
        : null;
    const emailMatchRow = email
      ? (active.find((m) => (m.email ?? "").toLowerCase().trim() === email) ?? null)
      : null;
    const emailMatch = emailMatchRow
      ? {
          name: emailMatchRow.name,
          flat: [emailMatchRow.wing, emailMatchRow.flatNo].filter(Boolean).join("-") || emailMatchRow.code,
          bills: await countBills(emailMatchRow._id),
        }
      : null;
    let billsOnActiveMembers = 0;
    for (const m of active) billsOnActiveMembers += await countBills(m._id);
    return {
      email,
      grants: myGrants,
      bound,
      emailMatch,
      activeMembers: active.length,
      billsOnActiveMembers,
    };
  },
});

/** My ledger — same rows the society's Member Ledger shows, but only mine. */
export const myLedger = query({
  args: {
    societyId: v.id("societies"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, fromDate, toDate }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const [member, bills, vouchers, society, accounts] = await Promise.all([
      ctx.db.get(bind.memberId),
      ctx.db
        .query("bills")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
        )
        .collect(),
      ctx.db
        .query("vouchers")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
        )
        .collect(),
      ctx.db.get(societyId),
      ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    ]);
    if (!member) return null;
    const receivableId =
      society?.receivableAccountId ??
      accounts.find((a) => a.kind === "receivable")?._id;

    type Row = {
      date: string;
      voucherNo: string;
      voucherType: Doc<"vouchers">["type"] | "bill";
      particulars: string;
      debit: number;
      credit: number;
      balance: number;
      note?: string;
      heads?: { name: string; amount: number }[];
    };
    let balance = member.openingBalance;
    const rows: Row[] = [];
    const addRow = (r: Omit<Row, "balance">) => {
      balance += r.debit - r.credit;
      rows.push({ ...r, balance });
    };

    // Opening balance row (same convention as the society ledger).
    const openingDate = member.openingDate ?? fromDate;
    if (member.openingBalance !== 0 && openingDate <= toDate) {
      addRow({
        date: openingDate < fromDate ? fromDate : openingDate,
        voucherNo: "OPENING",
        voucherType: "journal",
        particulars: "Opening Balance",
        debit: member.openingBalance > 0 ? member.openingBalance : 0,
        credit: member.openingBalance < 0 ? -member.openingBalance : 0,
        note: "As on " + openingDate,
      });
    }

    // Bills in range — a carried-arrears line restates the opening, skip it.
    const relevantBills = bills
      .filter(
        (b) => b.issueDate >= fromDate && b.issueDate <= toDate,
      )
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
    for (const b of relevantBills) {
      const carried = receivableId
        ? b.lines
            .filter((l) => !l.tariffId && l.accountId === receivableId)
            .reduce((s, l) => s + l.amount, 0)
        : 0;
      addRow({
        date: b.issueDate,
        voucherNo: b.billNo,
        voucherType: "bill",
        particulars: `Maintenance Bill ${b.period} — ${b.lines
          .filter((l) => !(receivableId && !l.tariffId && l.accountId === receivableId))
          .map((l) => l.name)
          .join(", ")}`,
        debit: b.total - carried,
        credit: 0,
        note: carried
          ? `Due ${b.dueDate} · includes arrears of ${carried.toFixed(2)} carried from opening`
          : `Due ${b.dueDate}`,
        heads: b.lines
          .filter((l) => !(receivableId && !l.tariffId && l.accountId === receivableId))
          .map((l) => ({ name: l.name, amount: l.amount })),
      });
    }

    // Member receipts in range.
    const receipts = vouchers
      .filter(
        (r) =>
          r.type === "member_receipt" &&
          r.date >= fromDate &&
          r.date <= toDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const r of receipts) {
      addRow({
        date: r.date,
        voucherNo: r.voucherNo,
        voucherType: r.type,
        particulars: `Receipt${r.reference ? ` — Ref ${r.reference}` : ""}`,
        debit: 0,
        credit: r.total,
        note: r.narration ?? r.mode,
      });
    }

    rows.sort((a, b) =>
      a.date === b.date
        ? a.voucherNo.localeCompare(b.voucherNo)
        : a.date.localeCompare(b.date),
    );
    let running = member.openingBalance;
    const closing = rows.map((r) => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });
    return closing;
  },
});

/** Unpaid/partially-paid bills I can allocate a payment against. */
export const myOpenBills = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
      )
      .collect();
    return bills
      .filter((b) => b.status !== "paid")
      .map((b) => ({
        _id: b._id,
        billNo: b.billNo,
        period: b.period,
        issueDate: b.issueDate,
        dueDate: b.dueDate,
        total: b.total,
        paidAmount: b.paidAmount,
        balance: b.total - b.paidAmount,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  },
});

/** Bank/cash accounts I may show as a payment mode on my receipt. */
export const myPayAccounts = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) return null;
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", bind.societyId))
      .collect();
    return accounts
      .filter((a) => a.kind === "bank_cash")
      .map((a) => ({ _id: a._id, code: a.code, name: a.name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  },
});

/**
 * Submit a payment against my flat: records a member receipt (dated today,
 * inside the FY) and allocates it across the chosen bills. The allocation
 * total is the amount charged.
 */
export const submitPayment = mutation({
  args: {
    societyId: v.id("societies"),
    date: v.string(),
    bankCashAccountId: v.id("accounts"),
    mode: v.optional(v.string()),
    reference: v.optional(v.string()),
    narration: v.optional(v.string()),
    allocations: v.array(v.object({ billId: v.id("bills"), amount: v.number() })),
    /** Advance: pay without selecting bills — credited to the member's ledger. */
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { societyId, date, bankCashAccountId, mode, reference, narration, allocations, amount }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) {
      throw new Error(
        "Your login is not linked to a flat in this society — payment declined.",
      );
    }
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");

    // FY guard: outside-the-year entries are declined, not saved.
    assertInFy(society, date, "Payment");

    // Validate the bank/cash account belongs to this society.
    const account = await ctx.db.get(bankCashAccountId);
    if (!account || account.societyId !== societyId || account.kind !== "bank_cash") {
      throw new Error("Choose a valid cash/bank account for the payment.");
    }

    // Validate every allocated bill belongs to MY flat and the amounts are
    // positive and do not exceed the bill balance.
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
      )
      .collect();
    const mine = new Map(bills.map((b) => [b._id, b]));
    const seen = new Set<Id<"bills">>();
    let total = 0;
    for (const a of allocations) {
      const bill = mine.get(a.billId);
      if (!bill) {
        throw new Error("A selected bill does not belong to your flat — payment declined.");
      }
      if (a.amount <= 0) throw new Error("Allocation amounts must be positive.");
      const balance = bill.total - bill.paidAmount;
      if (a.amount > balance + 0.005) {
        throw new Error(
          `Allocation to ${bill.billNo} exceeds its balance of ${balance.toFixed(2)}.`,
        );
      }
      if (seen.has(a.billId)) throw new Error("Duplicate bill allocation.");
      seen.add(a.billId);
      total += a.amount;
    }
    // Advance payment: no bill selections needed — the full amount is
    // credited to the member's ledger (receivable) and settles future bills.
    if (amount !== undefined && amount > 0) {
      if (amount + 0.005 < total) {
        throw new Error(
          "The allocated bill amounts exceed the payment amount — reduce the allocations.",
        );
      }
      total = Math.round(amount * 100) / 100;
    }
    if (total <= 0) {
      throw new Error(
        "Enter an amount to pay — with no bills selected the payment is kept as an advance.",
      );
    }

    // Post the receipt: Dr Bank/Cash, Cr Members Receivable (same posting the
    // society's Member Receipt voucher produces), then apply allocations.
    const receivableId =
      society.receivableAccountId ??
      (await ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()
        .then((accs) => accs.find((a) => a.kind === "receivable")?._id));
    if (!receivableId) {
      throw new Error("No Members Receivable account found — ask the society office to configure one.");
    }
    const n = await nextNumber(ctx, `${societyId}:voucher:member_receipt`);
    const voucherId = await ctx.db.insert("vouchers", {
      societyId,
      type: "member_receipt" as const,
      voucherNo: `${VOUCHER_PREFIX.member_receipt}-${pad(n)}`,
      date,
      memberId: bind.memberId,
      mode,
      bankCashAccountId,
      reference,
      narration:
        narration ??
        (allocations.length > 0
          ? `Online payment by member for ${allocations.length} bill(s)`
          : "Advance payment by member"),
      total,
      lines: [
        { accountId: bankCashAccountId, debit: total, credit: 0 },
        { accountId: receivableId, debit: 0, credit: total, note: mode },
      ],
      allocations,
    });
    for (const a of allocations) {
      const bill = mine.get(a.billId);
      if (bill) await applyAllocationToBill(ctx, bill, a.amount);
    }
    return { voucherId, voucherNo: `${VOUCHER_PREFIX.member_receipt}-${pad(n)}`, total };
  },
});

/** Update my contact details (phone). The register's master data stays with the office. */
export const updateMyContact = mutation({
  args: { societyId: v.id("societies"), phone: v.string() },
  handler: async (ctx, { societyId, phone }) => {
    const bind = await portalBinding(ctx, societyId);
    if (!bind) throw new Error("Your login is not linked to a flat in this society.");
    const trimmed = phone.trim();
    if (!/^[\d\s+\-()]{5,20}$/.test(trimmed)) {
      throw new Error("Enter a valid phone number.");
    }
    await ctx.db.patch(bind.memberId, { phone: trimmed });
  },
});

/**
 * Change my login password. Verifies the current password first — works for
 * password-provider logins; OTP-only accounts must set a password via
 * "Forgot password?" on the sign-in screen.
 */
export const changePassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user?.email) {
      throw new Error("Your account has no email — password change is not available.");
    }
    if (newPassword.length < 8 || !/\d/.test(newPassword)) {
      throw new Error("New password must be at least 8 characters and contain a number.");
    }
    if (newPassword === currentPassword) {
      throw new Error("New password must be different from the current password.");
    }

    // Find the password-provider credential row for this user.
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", "password"),
      )
      .unique();
    if (!account || !account.secret) {
      throw new Error(
        "Your account signs in with emailed codes. Use \"Forgot password?\" on the sign-in screen to set a password first.",
      );
    }
    const ok = await verifyPassword(currentPassword, account.secret);
    if (!ok) throw new Error("Current password is incorrect.");

    await ctx.db.patch(account._id, { secret: await hashPassword(newPassword) });
    return true;
  },
});

/* ------------------- Office-managed member login passwords ---------------- */

/** Validate the office-set password with the same rule as sign-up. */
function assertPasswordRules(password: string) {
  if (password.length < 8 || !/\d/.test(password)) {
    throw new Error(
      "Password must be at least 8 characters and contain a number.",
    );
  }
}

/**
 * Owner/admin: set (or reset) the login password of the account that belongs
 * to a member's email. Creates the email+password credential when the member
 * has never signed up — they can then sign in with that email and password
 * immediately. The password is returned only to the caller (the office keeps
 * it and shares it with the member privately); it is never stored in clear.
 */
export const adminSetMemberPassword = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    password: v.string(),
  },
  handler: async (ctx, { societyId, memberId, password }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (
      society.createdBy !== callerId &&
      !(await isSoftwareAdmin(ctx, callerId))
    ) {
      throw new Error(
        "Only the society owner or a software admin can set member passwords.",
      );
    }
    const member = await ctx.db.get(memberId);
    if (!member || member.societyId !== societyId) {
      throw new Error("Member not found in this society.");
    }
    const email = (member.email ?? "").toLowerCase().trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(
        "This member has no login email — enter their email in the profile first.",
      );
    }
    assertPasswordRules(password);

    await upsertPasswordCredential(ctx, email, password);
    return { email };
  },
});

/**
 * Owner/admin: read whether a password login exists for a member's email —
 * powers the "No password yet / Password set" state in the member profile.
 */
export const adminMemberPasswordStatus = query({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
  },
  handler: async (ctx, { societyId, memberId }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    if (
      society.createdBy !== callerId &&
      !(await isSoftwareAdmin(ctx, callerId))
    ) {
      return { hasPassword: false, hasEmail: false };
    }
    const member = await ctx.db.get(memberId);
    if (!member || member.societyId !== societyId) {
      return { hasPassword: false, hasEmail: false };
    }
    const email = (member.email ?? "").toLowerCase().trim();
    if (!email) return { hasPassword: false, hasEmail: false };
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .unique();
    return {
      hasPassword: !!account?.secret,
      hasEmail: true,
    };
  },
});

/**
 * Create or overwrite the password credential row for an email, mirroring
 * Convex Auth's own Password provider storage (provider "password",
 * providerAccountId = the lower-cased email, Scrypt-hashed secret). When the
 * credential already exists its old sessions are invalidated so a reset
 * password takes effect immediately.
 */
async function upsertPasswordCredential(
  ctx: MutationCtx,
  email: string,
  password: string,
) {
  const secret = await hashPassword(password);
  const existing = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", "password").eq("providerAccountId", email),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { secret });
    // Clear any sign-in lockout (10 wrong attempts/hour) so the new password
    // works immediately — re-saving here is the office's unlock mechanism.
    const limits = await ctx.db
      .query("authRateLimits")
      .withIndex("identifier", (q) => q.eq("identifier", existing._id))
      .collect();
    for (const l of limits) await ctx.db.delete(l._id);
    // Force re-login everywhere with the new password.
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", existing.userId))
      .collect();
    for (const s of sessions) await ctx.db.delete(s._id);
    return;
  }
  // No credential yet: reuse the existing user row when the email has signed
  // in some other way (OTP), otherwise create a fresh user + credential —
  // the same rows the Password provider's sign-up flow would have written.
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  const userId =
    user?._id ?? (await ctx.db.insert("users", { email, name: email }));
  const accountId = await ctx.db.insert("authAccounts", {
    userId,
    provider: "password",
    providerAccountId: email,
    secret,
  });
  // Defensive: clear stale lockout rows for this (possibly recreated) account.
  const staleLimits = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", accountId))
    .collect();
  for (const l of staleLimits) await ctx.db.delete(l._id);
}
