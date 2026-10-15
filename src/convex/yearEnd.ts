import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  isSoftwareAdmin,
  requireSociety,
  requireSocietyWrite,
  requireUserId,
  societyAccess,
} from "./lib";
import {
  computeAccountLedger,
  computeMemberBalances,
  loadSocietyData,
} from "./reports";

/* ------------------------------------------------------------------ */
/* Rights helpers                                                     */
/* ------------------------------------------------------------------ */

export type YearEndRights = {
  /** Society creator. */
  owner: boolean;
  /** Software-level admin. */
  admin: boolean;
  /** Effective book access level of the caller. */
  access: "owner" | "editor" | "viewer" | "member" | "none";
  /** Granted menus of the caller's grant row; null = every non-admin menu. */
  menus: string[] | null;
  /** True when the caller may run the year-end process. */
  canManage: boolean;
  /** True when the caller may post entries into a CLOSED year. */
  mayPostClosed: boolean;
  /** True when the caller may view/print reports for ANY period. */
  mayCrossReports: boolean;
};

/**
 * The caller's year-end rights over a society. Everything privileged is
 * keyed on ONE shareable right — the "Year-End Process" menu key
 * (`yearend`) in membersAccess.menus — so the admin can delegate the full
 * year-end process (view, create year, transfer balance, post into a
 * closed year, unlimited-period reports) with a single checkbox, exactly
 * as the user asked. Owner and software admin always hold it.
 */
export async function yearEndRights(
  ctx: QueryCtx,
  societyId: Id<"societies">,
  userId: Id<"users">,
): Promise<YearEndRights> {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  const access = await societyAccess(ctx, society, userId);
  const owner = society.createdBy === userId;
  const admin = await isSoftwareAdmin(ctx, userId);
  const menus = await grantedMenusFor(ctx, society, userId);
  // The "Year-End Process" right is granted EXPLICITLY — the admin ticks
  // it in Users & Rights. A grant with no menu list ("all menus") does NOT
  // silently include it, so default invites are never unexpectedly able to
  // close a year or post into a closed one.
  const holdsRight = owner || admin || (menus !== null && menus.includes("yearend"));
  return {
    owner,
    admin,
    access: owner ? "owner" : admin ? "editor" : access,
    menus,
    canManage: holdsRight,
    mayPostClosed: holdsRight,
    mayCrossReports: holdsRight,
  };
}

/** Granted menus of the caller's membersAccess row (null = everything). */
async function grantedMenusFor(
  ctx: QueryCtx,
  society: Doc<"societies">,
  userId: Id<"users">,
): Promise<string[] | null> {
  if (society.createdBy === userId) return null;
  const user = await ctx.db.get(userId);
  const email = user?.email?.toLowerCase().trim() ?? null;
  if (!email) return null;
  const grants = await ctx.db
    .query("membersAccess")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const grant = grants.find((g) => g.userId === userId || g.email === email);
  if (!grant) return null;
  if (grant.role === "member") return ["portal"];
  // A grant with no menu list means "all non-admin menus" — but the Year-End
  // right is still NOT included: it must be ticked explicitly.
  return grant.menus && grant.menus.length > 0 ? grant.menus : null;
}

/* ------------------------------------------------------------------ */
/* Entry gate — replaces plain assertInFy on entry mutations.         */
/* ------------------------------------------------------------------ */

/**
 * Entry gate for dated transactions:
 *  • inside the current books period → allowed;
 *  • in a registered OPEN year → allowed (books prepared ahead);
 *  • in a registered CLOSED year → allowed ONLY for year-end privileged
 *    logins (owner / software admin / granted "yearend" right);
 *  • anywhere else → the legacy "outside the current financial year" error.
 */
export async function assertEntryAllowed(
  db: MutationCtx["db"],
  society: Doc<"societies">,
  date: string,
  label: string,
  callerRights: YearEndRights | null,
): Promise<void> {
  const d = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new Error(`${label} date is invalid — enter a valid YYYY-MM-DD date.`);
  const { from, to } = societyFyPeriod(society);
  if (d >= from && d <= to) return;
  const years = await db
    .query("accountingYears")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const y = years.find((row) => d >= row.start && d <= row.end);
  if (y) {
    if (y.status === "open") return;
    if (callerRights?.mayPostClosed) return;
    throw new Error(
      `${label} dated ${d} falls in the CLOSED accounting year ${y.label}. Entry declined — only the admin or users granted Year-End Process rights may post into a closed year.`,
    );
  }
  const fyLabel =
    society.fyYear ?? `${from.slice(0, 4)}-${to.slice(2, 4)}`;
  throw new Error(
    `${label} dated ${d} is outside the current financial year (${fyLabel}: ${from} to ${to}). Entry declined — not saved.`,
  );
}

/**
 * ctx-based entry gate — the drop-in replacement for lib.assertInFy on the
 * entry mutations. Resolves the caller's year-end rights (null when the
 * caller is not a signed-in book user, e.g. a UPI webhook posting a
 * receipt) and enforces:
 *  • current books period → allowed;
 *  • registered OPEN year → allowed;
 *  • registered CLOSED year → allowed only with the Year-End right;
 *  • otherwise → the legacy "outside the current financial year" decline.
 */
export async function gatedEntry(
  ctx: MutationCtx,
  society: Doc<"societies">,
  date: string,
  label: string,
): Promise<void> {
  const callerId = await getAuthUserId(ctx);
  const rights = callerId
    ? await yearEndRights(ctx, society._id, callerId)
    : null;
  await assertEntryAllowed(ctx.db, society, date, label, rights);
}

/** Society books period start/end (UTC ISO), mirroring lib.societyFyPeriod. */
function societyFyPeriod(society: Doc<"societies">): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const from =
    society.fyStartDate?.slice(0, 10) ??
    fyStartString(society.fyStartMonth, today);
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, to: end.toISOString().slice(0, 10) };
}

function fyStartString(fyStartMonth: number, onOrBefore: string): string {
  const [y, m] = onOrBefore.slice(0, 10).split("-").map(Number);
  const year = (m ?? 1) >= fyStartMonth ? y : y - 1;
  return `${year}-${String(fyStartMonth).padStart(2, "0")}-01`;
}

/* ------------------------------------------------------------------ */
/* Queries for the Year-End screen                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolution rights the caller holds over the society. This query throws
 * for book-outsiders exactly like every other requireSociety query.
 */
export const overview = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await getAuthUserId(ctx);
    const rights = callerId
      ? await yearEndRights(ctx, societyId, callerId)
      : null;
    const years = (
      await ctx.db
        .query("accountingYears")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect()
    )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((y) => ({
        label: y.label,
        start: y.start,
        end: y.end,
        status: y.status,
        closedAt: y.closedAt ?? null,
        closedByName: y.closedByName ?? null,
        carriedTotals: y.carriedTotals ?? null,
      }));
    return {
      current: {
        label: society.fyYear ?? null,
        start: society.fyStartDate ?? null,
        fyStartMonth: society.fyStartMonth,
      },
      years,
      rights: {
        canManage: rights?.canManage ?? false,
        mayPostClosed: rights?.mayPostClosed ?? false,
        mayCrossReports: rights?.mayCrossReports ?? false,
      },
    };
  },
});

/**
 * The exact account + member balances a Transfer Balance would carry down
 * for one registered year — the preview the office signs off on.
 * Year-end privileged logins only.
 */
export const closingBalances = query({
  args: { societyId: v.id("societies"), label: v.string() },
  handler: async (ctx, { societyId, label }) => {
    const society = await requireSociety(ctx, societyId);
    const callerId = await requireUserId(ctx);
    const rights = await yearEndRights(ctx, societyId, callerId);
    if (!rights.canManage) {
      throw new Error(
        "Only the society owner, a software admin, or a user granted Year-End Process rights can view year-end closing balances.",
      );
    }
    const years = await ctx.db
      .query("accountingYears")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const year = years.find((y) => y.label === label);
    if (!year) throw new Error(`Accounting year ${label} is not registered.`);
    const data = await loadSocietyData(ctx, societyId);
    return {
      accounts: computeCarriedAccounts(data, year.end),
      members: computeCarriedMembers(data, year.end),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Mutations — create year, transfer balance, re-open                  */
/* ------------------------------------------------------------------ */

async function yearsFor(
  db: MutationCtx["db"],
  societyId: Id<"societies">,
) {
  return db
    .query("accountingYears")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

async function requireYearEndManager(
  ctx: MutationCtx,
  societyId: Id<"societies">,
) {
  const callerId = await requireUserId(ctx);
  const rights = await yearEndRights(ctx, societyId, callerId);
  if (!rights.canManage) {
    throw new Error(
      "Only the society owner, a software admin, or a user granted Year-End Process rights can run the year-end process.",
    );
  }
  return { callerId, rights };
}

/** Register a new accounting year (label + From/To dates). */
export const createYear = mutation({
  args: {
    societyId: v.id("societies"),
    label: v.string(),
    start: v.string(),
    end: v.string(),
  },
  handler: async (ctx, { societyId, label, start, end }) => {
    const society = await requireSocietyWrite(ctx, societyId);
    await requireSociety(ctx, societyId); // ensures caller has book access
    const { callerId } = await requireYearEndManager(ctx, societyId);
    const lbl = label.trim();
    if (!lbl)
      throw new Error("Enter the accounting year label (e.g. 2027-28).");
    const s = start.slice(0, 10);
    const e = end.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
      throw new Error("Enter both the From and To dates (YYYY-MM-DD).");
    }
    if (e < s) {
      throw new Error("The To date must not be before the From date.");
    }
    const years = await yearsFor(ctx.db, societyId);
    if (years.some((y) => y.label === lbl)) {
      throw new Error(`Accounting year ${lbl} is already registered.`);
    }
    for (const y of years) {
      if (s <= y.end && e >= y.start) {
        throw new Error(
          `Year ${lbl} overlaps the registered year ${y.label} (${y.start} to ${y.end}) — adjust the dates.`,
        );
      }
    }
    const me = await ctx.db.get(callerId);
    await ctx.db.insert("accountingYears", {
      societyId,
      label: lbl,
      start: s,
      end: e,
      status: "open",
      createdById: callerId,
      createdByName: me?.name ?? me?.email ?? "Unknown",
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Transfer Balance — the year-end close. Closes the year, snapshots the
 * carried-down account + member balances into the row (audited), and moves
 * the society's current books period to the next registered year. Any
 * re-close of a re-opened year refreshes the snapshot.
 */
export const transferBalance = mutation({
  args: {
    societyId: v.id("societies"),
    label: v.string(),
    nextLabel: v.string(),
  },
  handler: async (ctx, { societyId, label, nextLabel }) => {
    await requireSocietyWrite(ctx, societyId);
    const { callerId } = await requireYearEndManager(ctx, societyId);
    const society = await ctx.db.get(societyId);
    if (!society) throw new Error("Society not found.");
    const years = await yearsFor(ctx.db, societyId);
    const year = years.find((y) => y.label === label);
    if (!year) throw new Error(`Accounting year ${label} is not registered.`);
    if (year.status === "closed")
      throw new Error(`Accounting year ${label} is already closed.`);
    const next = years.find((y) => y.label === nextLabel);
    if (!next)
      throw new Error(
        `Accounting year ${nextLabel} is not registered — create it first.`,
      );
    if (next.start !== dayAfter(year.end))
      throw new Error(
        `${nextLabel} must start the day after ${label} ends (${year.end}) — adjust its From date.`,
      );

    const data = await loadSocietyData(ctx, societyId);
    const accounts = computeCarriedAccounts(data, year.end);
    const members = computeCarriedMembers(data, year.end);
    const nonZeroAccounts = accounts.filter((a) => a.amount !== 0);
    const memberDues = members
      .filter((m) => m.amount > 0)
      .reduce((s, m) => s + m.amount, 0);
    const memberAdvance = members
      .filter((m) => m.amount < 0)
      .reduce((s, m) => s - m.amount, 0);

    const me = await ctx.db.get(callerId);
    await ctx.db.patch(year._id, {
      status: "closed",
      closedAt: Date.now(),
      closedById: callerId,
      closedByName: me?.name ?? me?.email ?? "Unknown",
      carriedAccounts: nonZeroAccounts.map((a) => ({
        accountId: a.accountId as Id<"accounts">,
        amount: a.amount,
      })),
      carriedMembers: members
        .filter((m) => m.amount !== 0)
        .map((m) => ({
          memberId: m.memberId as Id<"members">,
          amount: m.amount,
        })),
      carriedTotals: {
        accounts: nonZeroAccounts.length,
        members: members.filter((m) => m.amount !== 0).length,
        memberDues,
        memberAdvance,
      },
    });

    // The society's current books period moves to the next year, so every
    // entry gate, dashboard and report default now lives there. Pre-period
    // postings still compute correct openings from the full books.
    await ctx.db.patch(societyId, {
      fyStartDate: next.start,
      fyYear: next.label,
    });

    return {
      ok: true as const,
      carriedAccounts: nonZeroAccounts.length,
      carriedMembers: members.filter((m) => m.amount !== 0).length,
      memberDues,
      memberAdvance,
    };
  },
});

/**
 * Re-open a closed accounting year — year-end privileged logins only.
 * The carried snapshot is cleared; a later re-close refreshes it.
 */
export const reopenYear = mutation({
  args: { societyId: v.id("societies"), label: v.string() },
  handler: async (ctx, { societyId, label }) => {
    await requireSocietyWrite(ctx, societyId);
    await requireYearEndManager(ctx, societyId);
    const year = (await yearsFor(ctx.db, societyId)).find(
      (y) => y.label === label,
    );
    if (!year) throw new Error(`Accounting year ${label} is not registered.`);
    if (year.status !== "closed")
      throw new Error(`Accounting year ${label} is not closed.`);
    await ctx.db.patch(year._id, {
      status: "open",
      closedAt: undefined,
      closedById: undefined,
      closedByName: undefined,
      carriedAccounts: undefined,
      carriedMembers: undefined,
      carriedTotals: undefined,
    });
    return { ok: true as const };
  },
});

/**
 * Switch the society's CURRENT books year (Profile → Financial Period →
 * Books year). Repoints the single books-period pointer — society.fyYear /
 * fyStartDate — onto another REGISTERED year: the same two fields Transfer
 * Balance moves, and the same ones every entry gate, dashboard and report
 * default read through the period helpers.
 *
 * Safe by construction: all balances are computed from the FULL continuous
 * ledger ("0000-01-01" → asOf), so only the pointer moves — nothing is
 * re-carried or re-stated, and the books stay one unbroken history.
 *
 * Guardrails: requires the Year-End Process right. Because the current books
 * year is by definition open for posting, switching INTO a closed year
 * re-opens it (clearing that year's carried snapshot) so a closed year can
 * never silently become the active posting target — the invariant
 * assertEntryAllowed relies on.
 */
export const setCurrentYear = mutation({
  args: { societyId: v.id("societies"), label: v.string() },
  handler: async (ctx, { societyId, label }) => {
    const society = await requireSocietyWrite(ctx, societyId);
    await requireYearEndManager(ctx, societyId);
    const years = await yearsFor(ctx.db, societyId);
    const year = years.find((y) => y.label === label);
    if (!year) throw new Error(`Accounting year ${label} is not registered.`);
    // Already the current year — nothing to do.
    if (year.label === society.fyYear)
      return { ok: true as const, reopened: false, label: year.label, start: year.start };
    // The current books year must always be postable; re-open a closed
    // target (mirroring reopenYear) rather than pointing at a locked year.
    let reopened = false;
    if (year.status === "closed") {
      await ctx.db.patch(year._id, {
        status: "open",
        closedAt: undefined,
        closedById: undefined,
        closedByName: undefined,
        carriedAccounts: undefined,
        carriedMembers: undefined,
        carriedTotals: undefined,
      });
      reopened = true;
    }
    await ctx.db.patch(societyId, {
      fyStartDate: year.start,
      fyYear: year.label,
    });
    return { ok: true as const, reopened, label: year.label, start: year.start };
  },
});

/* ------------------------------------------------------------------ */
/* Carry-forward computations (pure — shared with the tests)          */
/* ------------------------------------------------------------------ */

/**
 * Signed closing balance per ledger account at a date (debit-positive) —
 * account opening balance plus every posting up to and including `asOf`,
 * the same arithmetic the General Ledger prints. Non-zero rows only.
 */
export function computeCarriedAccounts(
  data: Parameters<typeof computeAccountLedger>[0],
  asOf: string,
): { accountId: string; code: string; name: string; amount: number }[] {
  return data.accounts
    .map((a) => {
      const debitNature = a.type === "asset" || a.type === "expense";
      let amount = debitNature ? a.openingBalance : -a.openingBalance;
      const rows = computeAccountLedger(data, a._id, "0000-01-01", asOf)
        .filter((r) => r.voucherNo !== "OPENING");
      for (const r of rows) amount += r.debit - r.credit;
      return {
        accountId: a._id as string,
        code: a.code,
        name: a.name,
        amount: Math.round(amount * 100) / 100,
      };
    })
    .filter((a) => a.amount !== 0);
}

/**
 * Carried-down member balances at a close date (dues positive, negative =
 * advance held) — computeMemberBalances' closing over the whole books, so
 * the carried dues mirror the Member Dues list exactly. Non-zero rows only.
 */
export function computeCarriedMembers(
  data: Parameters<typeof computeAccountLedger>[0],
  asOf: string,
): {
  memberId: string;
  code: string;
  name: string;
  flatNo: string;
  amount: number;
}[] {
  const rows = computeMemberBalances(
    data as never,
    "0000-01-01",
    asOf,
  );
  return rows
    .filter((r) => r.closing !== 0)
    .map((r) => ({
      memberId: r.memberId as string,
      code: r.code,
      name: r.name,
      flatNo: r.flatNo,
      amount: Math.round(r.closing * 100) / 100,
    }));
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
