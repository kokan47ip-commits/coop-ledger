import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  analyzePortalBinding,
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
    // A bill that restates the opening balance ("arrears carried") must not
    // be billed twice — the member's opening balance is already counted. This
    // mirrors computeMemberLedger / myLedger, so the dashboard's outstanding
    // always equals the ledger's closing balance.
    const receivableId =
      society.receivableAccountId ??
      (await ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", bind.societyId))
        .collect()
        .then((accs) => accs.find((a) => a.kind === "receivable")?._id));
    const totalBilled = bills.reduce(
      (s, b) =>
        s +
        b.lines
          .filter((l) => !(receivableId && !l.tariffId && l.accountId === receivableId))
          .reduce((t, l) => t + l.amount, 0),
      0,
    );
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
    const [bills, tariffs] = await Promise.all([
      ctx.db
        .query("bills")
        .withIndex("by_society_member", (q) =>
          q.eq("societyId", bind.societyId).eq("memberId", bind.memberId),
        )
        .collect(),
      ctx.db
        .query("tariffs")
        .withIndex("by_society", (q) => q.eq("societyId", bind.societyId))
        .collect(),
    ]);
    // Bills generated before full-name printing carry short head names —
    // resolve them to the tariff's full name for the portal and downloads.
    const fullName = new Map(tariffs.map((t) => [t._id, t.name] as const));
    return bills
      .map((b) => ({
        ...b,
        lines: b.lines.map((l) =>
          l.tariffId && fullName.has(l.tariffId)
            ? { ...l, name: fullName.get(l.tariffId) ?? l.name }
            : l,
        ),
      }))
      .sort((a, b) =>
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
    if (!userId)
      return { email: null as string | null, grants: [], bound: null, emailMatch: null, resolved: null, resolvedBy: null as string | null, activeMembers: 0, billsOnActiveMembers: 0 };
    const society = await ctx.db.get(societyId);
    if (!society)
      return { email: null as string | null, grants: [], bound: null, emailMatch: null, resolved: null, resolvedBy: null as string | null, activeMembers: 0, billsOnActiveMembers: 0 };
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
    // What the live session actually resolves to (bills decide between
    // candidates). The office-side diagnosis runs the same resolution from
    // the other direction, so comparing the two pinpoints any
    // session-vs-data mismatch.
    const analysis = await analyzePortalBinding(ctx, society, email, userId);
    return {
      email,
      grants: myGrants,
      bound,
      emailMatch,
      resolved: analysis.resolved
        ? {
            name: analysis.resolved.name,
            flat:
              [analysis.resolved.wing, analysis.resolved.flatNo]
                .filter(Boolean)
                .join("-") || analysis.resolved.code,
            bills: analysis.resolved.bills,
          }
        : null,
      resolvedBy: analysis.resolvedBy,
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

    // The opening balance is the ledger's starting point, so its row always
    // comes first — sorting by date alone would tie it with day-one bills and
    // lose the voucherNo tie-break to them ("101/04" sorts before "OPENING").
    const ordered = [
      ...rows.filter((r) => r.voucherNo === "OPENING"),
      ...rows
        .filter((r) => r.voucherNo !== "OPENING")
        .sort((a, b) =>
          a.date === b.date
            ? a.voucherNo.localeCompare(b.voucherNo)
            : a.date.localeCompare(b.date),
        ),
    ];
    // The running balance already starts from the member's opening balance,
    // so the OPENING row itself must not add its amount a second time.
    let running = member.openingBalance;
    const closing = ordered.map((r) => {
      if (r.voucherNo === "OPENING") return { ...r, balance: running };
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
      throw new ConvexError(
        "Your login is not linked to a flat in this society — payment declined.",
      );
    }
    const society = await ctx.db.get(societyId);
    if (!society) throw new ConvexError("Society not found.");

    // FY guard: outside-the-year entries are declined, not saved.
    assertInFy(society, date, "Payment");

    // Validate the bank/cash account belongs to this society.
    const account = await ctx.db.get(bankCashAccountId);
    if (!account || account.societyId !== societyId || account.kind !== "bank_cash") {
      throw new ConvexError("Choose a valid cash/bank account for the payment.");
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
        throw new ConvexError("A selected bill does not belong to your flat — payment declined.");
      }
      if (a.amount <= 0) throw new ConvexError("Allocation amounts must be positive.");
      const balance = bill.total - bill.paidAmount;
      if (a.amount > balance + 0.005) {
        throw new ConvexError(
          `Allocation to ${bill.billNo} exceeds its balance of ${balance.toFixed(2)}.`,
        );
      }
      if (seen.has(a.billId)) throw new ConvexError("Duplicate bill allocation.");
      seen.add(a.billId);
      total += a.amount;
    }
    // Advance payment: no bill selections needed — the full amount is
    // credited to the member's ledger (receivable) and settles future bills.
    if (amount !== undefined && amount > 0) {
      if (amount + 0.005 < total) {
        throw new ConvexError(
          "The allocated bill amounts exceed the payment amount — reduce the allocations.",
        );
      }
      total = Math.round(amount * 100) / 100;
    }
    if (total <= 0) {
      throw new ConvexError(
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
      throw new ConvexError("No Members Receivable account found — ask the society office to configure one.");
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
    if (!bind) throw new ConvexError("Your login is not linked to a flat in this society.");
    const trimmed = phone.trim();
    if (!/^[\d\s+\-()]{5,20}$/.test(trimmed)) {
      throw new ConvexError("Enter a valid phone number.");
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
      throw new ConvexError("Your account has no email — password change is not available.");
    }
    if (newPassword.length < 8 || !/\d/.test(newPassword)) {
      throw new ConvexError("New password must be at least 8 characters and contain a number.");
    }
    if (newPassword === currentPassword) {
      throw new ConvexError("New password must be different from the current password.");
    }

    // Password-provider credential rows for this user. Collect rather than
    // .unique(): duplicate rows can exist from historical auth migrations and
    // a hard unique() throw would surface as an opaque server error.
    const allRows = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", "password"),
      )
      .collect();
    // Keep the newest row — it is the one sign-in actually verifies against.
    const account =
      allRows.length > 0
        ? allRows.reduce((a, b) => (a._creationTime >= b._creationTime ? a : b))
        : null;
    if (allRows.length > 1) {
      // Remove stale duplicates so future lookups stay unambiguous.
      for (const row of allRows) {
        if (row._id !== account!._id) await ctx.db.delete(row._id);
      }
    }

    if (account?.secret) {
      // Existing password login: the current password must prove it's them.
      let ok = false;
      try {
        ok = await verifyPassword(currentPassword, account.secret);
      } catch {
        // Unreadable/stale hash format: cannot verify against it. Prove
        // identity via a fresh email sign-in instead.
        throw new ConvexError(
          "The saved password record is unreadable — sign in with a one-time emailed code (or use Forgot password?), then set your password leaving 'current password' blank.",
        );
      }
      if (!ok) throw new ConvexError("Current password is incorrect.");
      try {
        await ctx.db.patch(account._id, {
          secret: await hashPassword(newPassword),
        });
      } catch {
        throw new ConvexError(
          "Could not save the new password (hashing failed). Please try again.",
        );
      }
    } else if (account) {
      // Password-provider row without a secret (OTP-created): set the first
      // password — being signed in already proves the account is theirs.
      if (currentPassword) {
        throw new ConvexError(
          "This account has no password yet — leave the current password blank.",
        );
      }
      await ctx.db.patch(account._id, {
        secret: await hashPassword(newPassword),
      });
    } else {
      // No password credential at all (OTP-only or guest-converted user):
      // create one under the same account.
      if (currentPassword) {
        throw new ConvexError(
          "This account has no password yet — leave the current password blank.",
        );
      }
      try {
        await ctx.db.insert("authAccounts", {
          userId,
          provider: "password",
          providerAccountId: (user.email ?? "").toLowerCase().trim(),
          secret: await hashPassword(newPassword),
        });
      } catch (err) {
        console.error("changePassword: authAccounts insert failed", err);
        throw new ConvexError(
          "Could not create a password record for this account. Note the exact on-screen error and try again.",
        );
      }
    }
    return true;
  },
});

/* ------------------- Office-managed member login passwords ---------------- */

/** Validate the office-set password with the same rule as sign-up. */
function assertPasswordRules(password: string) {
  if (password.length < 8 || !/\d/.test(password)) {
    throw new ConvexError(
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
      throw new ConvexError(
        "Only the society owner or a software admin can set member passwords.",
      );
    }
    const member = await ctx.db.get(memberId);
    if (!member || member.societyId !== societyId) {
      throw new ConvexError("Member not found in this society.");
    }
    const email = (member.email ?? "").toLowerCase().trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError(
        "This member has no login email — enter their email in the profile first.",
      );
    }
    assertPasswordRules(password);

    const { userId: credUserId } = await upsertPasswordCredential(ctx, email, password);

    // Portal access: a password alone is not enough — the login must be
    // bound to this flat via a membersAccess "member" grant, or the portal
    // shows no bills/ledger. Create it here (or re-point it to this flat) so
    // setting the password makes the portal fully work in one step. Broader
    // grants (editor/viewer) are left untouched, and the owner's own email
    // never needs a grant.
    const owner = society.createdBy ? await ctx.db.get(society.createdBy) : null;
    if (owner?.email?.toLowerCase().trim() !== email) {
      await upsertPortalGrant(ctx, societyId, email, memberId, callerId, credUserId);
    }

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
    // collect() + first, not .unique(): a duplicate credential row must not
    // crash this query (it would break the member form's password dialog).
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .collect();
    return {
      hasPassword: accounts.some((a) => !!a.secret),
      hasEmail: true,
    };
  },
});

/**
 * Create or overwrite the password credential row for an email, mirroring
 * Convex Auth's own Password provider storage (provider "password",
 * providerAccountId = the lower-cased email, Scrypt-hashed secret), and
 * repair duplicate credential rows if any exist (a duplicate makes every
 * sign-in for that email fail with a Server Error). Any sign-in lockout is
 * cleared — saving a password here is the account's unlock mechanism.
 *
 * Deliberately does NOT delete active sessions: the member's browser keeps
 * exchanging its refresh token in the background, and killing their sessions
 * mid-flight wedges the auth client (repeated "auth:signIn" Server Errors)
 * instead of a clean re-login. The new password simply applies at next login.
 */
async function upsertPasswordCredential(
  ctx: MutationCtx,
  email: string,
  password: string,
): Promise<{ userId: Id<"users">; accountId: Id<"authAccounts"> }> {
  const secret = await hashPassword(password);
  const rows = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", "password").eq("providerAccountId", email),
    )
    .collect();
  const existing =
    rows.find((r) => r.secret) ?? rows[0] ?? null;
  // Duplicates break sign-in irrecoverably (.unique() throws) — drop extras.
  for (const extra of rows) {
    if (extra._id !== existing?._id) await ctx.db.delete(extra._id);
  }
  if (existing) {
    await ctx.db.patch(existing._id, { secret });
    // Clear any sign-in lockout (10 wrong attempts/hour) so the new password
    // works immediately — re-saving here is the office's unlock mechanism.
    const limits = await ctx.db
      .query("authRateLimits")
      .withIndex("identifier", (q) => q.eq("identifier", existing._id))
      .collect();
    for (const l of limits) await ctx.db.delete(l._id);
    return { userId: existing.userId, accountId: existing._id };
  }
  // No credential yet: reuse the existing user row when the email has signed
  // in some other way (OTP), otherwise create a fresh user + credential —
  // the same rows the Password provider's sign-up flow would have written.
  const userRows = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .collect();
  const user = userRows[0] ?? null;
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
  return { userId, accountId };
}

/**
 * Stores a fresh 6-digit code for the login page's "Set your password" flow
 * (called from emailOtpActions.sendPasswordSetupCode, which emails it).
 */
export const pwSetupPrepare = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const accountRows = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .collect();
    const account = accountRows[0] ?? null;
    // Replace any live setup code for this email with a fresh one.
    if (account) {
      const stale = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);
    }
    const code = await pwGenerateCode(ctx);
    const accountId =
      account?._id ??
      (await ctx.db.insert("authAccounts", {
        userId: await pwSetupUserFor(ctx, email),
        provider: "password",
        providerAccountId: email,
      }));
    await ctx.db.insert("authVerificationCodes", {
      accountId,
      provider: "password",
      code,
      expirationTime: Date.now() + 15 * 60 * 1000,
    });
    return { code };
  },
});

/** First user row for an email, reused across setups. */
async function pwSetupUserFor(ctx: MutationCtx, email: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  return user?._id ?? (await ctx.db.insert("users", { email, name: email }));
}

/** Collision-safe 6-digit code generator for the password-setup flow. */
async function pwGenerateCode(ctx: MutationCtx): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const clash = await ctx.db
      .query("authVerificationCodes")
      .withIndex("code", (q) => q.eq("code", code))
      .collect();
    if (clash.length === 0) return code;
  }
  return String(Date.now()).slice(-6);
}

/**
 * Self-service password set from the login page: the user proves they own
 * the email by entering the OTP code they were sent (the same code the
 * "Sign in with an emailed code" flow delivers), then chooses a new
 * password. Works for members who have never signed up (the credential is
 * created fresh) and doubles as an unlock — the saved credential clears any
 * sign-in lockout.
 */
export const setPasswordWithOtp = mutation({
  args: {
    email: v.string(),
    code: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, { email, code, newPassword }) => {
    const normalized = email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new ConvexError("Enter a valid email address.");
    }
    assertPasswordRules(newPassword);

    // Brute-force guard: 5 wrong codes per email; a success clears the guard.
    const guardId = `pwsetup:${normalized}`;
    const guard = await ctx.db
      .query("authRateLimits")
      .withIndex("identifier", (q) => q.eq("identifier", guardId))
      .unique();
    if (guard && guard.attemptsLeft < 1) {
      throw new ConvexError(
        "Too many wrong codes — request a new code in a few minutes.",
      );
    }

    // Match the code against any live verification code for this email
    // (OTP sign-in codes and password-reset codes both prove ownership).
    const rows = await ctx.db
      .query("authVerificationCodes")
      .withIndex("code", (q) => q.eq("code", code))
      .collect();
    const now = Date.now();
    let matched: Doc<"authVerificationCodes"> | null = null;
    for (const row of rows) {
      if (row.expirationTime < now) {
        await ctx.db.delete(row._id);
        continue;
      }
      const account = await ctx.db.get(row.accountId);
      if (account && account.providerAccountId === normalized) {
        matched = row;
        break;
      }
    }
    if (!matched) {
      if (guard) {
        await ctx.db.patch(guard._id, {
          attemptsLeft: guard.attemptsLeft - 1,
          lastAttemptTime: Date.now(),
        });
      } else {
        await ctx.db.insert("authRateLimits", {
          identifier: guardId,
          attemptsLeft: 4,
          lastAttemptTime: Date.now(),
        });
      }
      throw new ConvexError(
        "That code is incorrect or has expired. Request a new code and try again.",
      );
    }
    await ctx.db.delete(matched._id);
    if (guard) await ctx.db.delete(guard._id);

    await upsertPasswordCredential(ctx, normalized, newPassword);

    // Portal binding: mirror the office "set password" flow — any society
    // whose member row carries this email gets a member grant bound to that
    // flat, so bills/ledger/payments appear on first login. The email was
    // just proven via the OTP code, so this is safe to self-serve.
    await ensurePortalGrantsByEmail(ctx, normalized);

    return { email: normalized };
  },
});

/**
 * Create (or re-point) the flat-bound "member" portal grant for an email in
 * one society. Used by both the office-set-password flow and the member's
 * own OTP-verified password set. Owner emails never need a grant.
 */
async function upsertPortalGrant(
  ctx: MutationCtx,
  societyId: Id<"societies">,
  email: string,
  memberId: Id<"members">,
  grantedBy: Id<"users">,
  userId: Id<"users">,
) {
  const grants = await ctx.db
    .query("membersAccess")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const existing = grants.find((g) => g.email === email);
  if (!existing) {
    await ctx.db.insert("membersAccess", {
      societyId,
      email,
      role: "member",
      memberId,
      userId,
      grantedBy,
      createdAt: Date.now(),
    });
  } else if (existing.role === "member" && existing.memberId !== memberId) {
    await ctx.db.patch(existing._id, { memberId });
  }
}

/**
 * Ensure every society that has a member row with this email grants the
 * login portal access to that flat. Self-serve password setup has no society
 * context, so the (small) societies table is scanned; each society's members
 * are read through the by_society index.
 */
async function ensurePortalGrantsByEmail(ctx: MutationCtx, email: string) {
  const societies = await ctx.db.query("societies").collect();
  for (const society of societies) {
    if (society.createdBy) {
      const owner = await ctx.db.get(society.createdBy);
      if (owner?.email?.toLowerCase().trim() === email) continue;
    }
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", society._id))
      .collect();
    const match = members.find(
      (m) => (m.email ?? "").toLowerCase().trim() === email,
    );
    if (!match) continue;
    const userRows = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .collect();
    const user = userRows[0];
    if (!user) continue;
    await upsertPortalGrant(ctx, society._id, email, match._id, user._id, user._id);
  }
}
