import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";
import {
  fyStartDateString,
  isBankCashAccount,
  isCarriedOpeningLine,
  requireSociety,
} from "./lib";

export type LedgerRow = {
  date: string;
  voucherNo: string;
  voucherType: Doc<"vouchers">["type"] | "bill";
  particulars: string;
  accountId: Id<"accounts"> | null;
  debit: number;
  credit: number;
  balance: number;
  note?: string;
  /** Bill line breakdown (member-ledger detail view): tariff head + amount. */
  heads?: { name: string; amount: number }[];
};

export type CashBookRow = {
  date: string;
  voucherNo: string;
  /** Narration lines, Crystal-style: party line, detail line, cheque line. */
  narration: string[];
  debit: number;
  credit: number;
  balance: number;
};

export type CashBookSection = {
  accountId: Id<"accounts">;
  code: string;
  name: string;
  /** Opening balance carried down (debit-positive). */
  opening: number;
  rows: CashBookRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
};

/**
 * One Trial Balance row in the three-column format: Opening balance (as at the
 * day before the period), Current-period movement (gross Dr/Cr postings inside
 * the range) and Closing balance (as at the end date), each shown on its Dr or
 * Cr side.
 */
export type TrialBalanceColumnRow = {
  accountId: Id<"accounts"> | null;
  /** User-defined printing serial no. for statement order. */
  printNo?: string;
  code: string;
  name: string;
  type: Doc<"accounts">["type"];
  openingDr: number;
  openingCr: number;
  periodDr: number;
  periodCr: number;
  closingDr: number;
  closingCr: number;
  /**
   * System-presentational row with no ledger behind it: the balancing
   * adjustment that carries the current year's result into the "Income over
   * Expenses" row's Current / Closing columns.
   */
  system?: boolean;
};

export type TrialBalanceRow = {
  accountId: Id<"accounts">;
  /** User-defined printing serial no. for statement order. */
  printNo?: string;
  code: string;
  name: string;
  type: Doc<"accounts">["type"];
  debit: number;
  credit: number;
  /** Form N section heading (I&E statements only). */
  group?: string;
  /** System-generated balancing account row ("Income over Expenses" /
   *  "Expenses over Income") — presentational, no ledger behind it. */
  system?: boolean;
};

const TYPE_LABEL: Record<Doc<"vouchers">["type"] | "bill", string> = {
  member_receipt: "Member Receipt",
  other_receipt: "Other Receipt",
  payment: "Payment",
  journal: "Journal",
  bill: "Maintenance Bill",
};

export type SocietyData = Awaited<ReturnType<typeof loadSocietyData>>;

type GenericLine = { accountId: Id<"accounts">; debit: number; credit: number; note?: string };

type GenericEntry = {
  date: string;
  voucherNo: string;
  type: Doc<"vouchers">["type"] | "bill";
  memberId?: Id<"members"> | null;
  bankCashAccountId?: Id<"accounts"> | null;
  narration?: string;
  reference?: string;
  mode?: string;
  lines: GenericLine[];
};

export async function loadSocietyData(ctx: QueryCtx, societyId: Id<"societies">) {
  await requireSociety(ctx, societyId);
  const [accounts, accountGroups, members, vouchers, bills, society, tariffs] =
    await Promise.all([
      ctx.db
        .query("accounts")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("accountGroups")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("members")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("vouchers")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("bills")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db.get(societyId),
      ctx.db
        .query("tariffs")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    ]);
  return { accounts, accountGroups, members, vouchers, bills, society, tariffs };
}

function receivableIdOf(data: SocietyData): Id<"accounts"> | undefined {
  const configuredId = data.society?.receivableAccountId;
  const configured = configuredId
    ? data.accounts.find((a) => a._id === configuredId)
    : undefined;
  // Mirror resolveReceivableAccount on the POSTING path: receipts post to
  // the proper receivable ledger even when the profile setting is
  // mis-pointed at a bank/cash (or since-deleted) account — the statements
  // must read that same ledger, or every bill's postings land on the wrong
  // row or, when guarded against bank drift, vanish from the Trial Balance,
  // Income & Expenditure and the Balance Sheet's Income over Expenses head.
  if (configured && !isBankCashAccount(configured)) return configured._id;
  const fallback = data.accounts.find((a) => a.kind === "receivable");
  if (fallback) return fallback._id;
  return configured?._id; // degenerate chart: the mis-set ledger is all there is
}

/**
 * All postings in one list: manual vouchers plus generated bills.
 * Each bill posts Dr Members Receivable (total) / Cr the bill's income heads.
 */
/**
 * The credit lines a bill actually posts: charge heads that still exist in
 * the chart, are not the receivable control itself, are not carried
 * opening-balance restatements, and never touch a bank-cash ledger. Shared
 * by unifiedEntries (the postings) and computeTrialBalance (the unposted
 * gap the Suspense row carries) so the two can never disagree.
 */
function billPostingCredits(
  b: Doc<"bills">,
  receivableId: Id<"accounts"> | undefined,
  accounts: Doc<"accounts">[],
): Doc<"bills">["lines"] {
  const known = new Set(accounts.map((a) => a._id));
  const bankCash = new Set(
    accounts.filter((a) => a.kind === "bank_cash").map((a) => a._id),
  );
  return b.lines.filter(
    (l) =>
      (receivableId === undefined || l.accountId !== receivableId) &&
      !isCarriedOpeningLine(l, receivableId) &&
      known.has(l.accountId) &&
      !bankCash.has(l.accountId),
  );
}

export function unifiedEntries(data: SocietyData): GenericEntry[] {
  const entries: GenericEntry[] = data.vouchers.map((v) => ({
    date: v.date,
    voucherNo: v.voucherNo,
    type: v.type,
    memberId: v.memberId,
    bankCashAccountId: v.bankCashAccountId,
    narration: v.narration,
    reference: v.reference,
    mode: v.mode,
    lines: v.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      note: l.note,
    })),
  }));
  const receivableId = receivableIdOf(data);
  const control = receivableId !== undefined
    ? data.accounts.find((a) => a._id === receivableId)
    : undefined;
  // The receivable side of a bill can only post while the chart HAS a
  // proper control ledger; the income credits must reach the statements
  // regardless — a missing (or bank-mis-set) control used to make every bill
  // vanish from the Trial Balance, Income & Expenditure and the Balance
  // Sheet's Income over Expenses head. A generated bill is an accrual — Dr
  // Members Receivable / Cr income heads — and is never a cash movement, so
  // a bill line may not post to a bank-cash ledger either (mis-mapped tariff
  // heads previously let the TB/BS bank balance drift from the Bank Book).
  //
  // Every bill entry must BALANCE: the receivable debit is the sum of the
  // credit lines actually emitted — never the stored total. A carried
  // opening-balance line restates dues the books already carry (it is not
  // credited anywhere), and a mis-mapped or deleted-account line posts
  // nowhere; debiting the full total used to leave the Trial Balance's
  // Current Period and Closing columns short on credits by exactly those
  // amounts. When no control can post, the credits-only entry is completed
  // by the labelled bill-debit Suspense row in computeTrialBalance.
  const controlPosts = control !== undefined && !isBankCashAccount(control);
  for (const b of data.bills) {
    const credits = billPostingCredits(b, receivableId, data.accounts);
    if (credits.length === 0) continue; // carried-only / line-less bill: it restates dues, it posts nothing
    const charged = credits.reduce((s, l) => s + l.amount, 0);
    entries.push({
      date: b.issueDate,
      voucherNo: b.billNo,
      type: "bill",
      memberId: b.memberId,
      narration: `Bill ${b.period}`,
      lines: [
        ...(controlPosts && receivableId
          ? [
              {
                accountId: receivableId,
                debit: charged,
                credit: 0,
                note: `Period ${b.period}`,
              },
            ]
          : []),
        ...credits.map((l) => ({
          accountId: l.accountId,
          debit: 0,
          credit: l.amount,
        })),
      ],
    });
  }
  return entries;
}

/**
 * Display flat number for a member — "Wing-FlatNo", falling back to the
 * member code. Ledgers and statements identify members by FLAT, not by the
 * internal member no.
 */
export function memberFlatNo(m: Doc<"members">): string {
  return [m.wing, m.flatNo].filter(Boolean).join("-") || m.code;
}

function memberLabel(data: SocietyData, memberId: Id<"members"> | null | undefined) {
  if (!memberId) return null;
  const m = data.members.find((x) => x._id === memberId);
  return m ? `${m.name} (${memberFlatNo(m)})` : null;
}

/**
 * Trial balance in the three-column format. For every ledger account:
 * Opening — the balance as at the day before `fromDate` (account opening
 * balance plus all postings before the period); Current — the GROSS debits
 * and credits posted inside the period; Closing — opening plus the period's
 * net movement, as at `toDate`. Each of the three is shown on its Dr or Cr
 * side, so the column totals below every Dr and every Cr total can be footed
 * (and closing Dr vs closing Cr re-checked) on the printed statement.
 *
 * The member receivable control follows ONE basis at a time — the same
 * opening must never be counted twice: when the control ledger itself
 * carries the opening balance (or pre-period postings), the row is the
 * plain GL movement (member openings already reached the books through the
 * carried bill line); only when the GL control knows nothing of the opening
 * does the row present the MEMBER ledgers (openings typed per member, bills,
 * receipts) — the same arithmetic as the Balance Sheet's Dues/Advance split
 * — with GL-only adjustments (journals) folded in.
 */
export async function computeTrialBalance(
  data: SocietyData,
  fromDate: string,
  toDate: string,
): Promise<TrialBalanceColumnRow[]> {
  const { accounts } = data;
  const receivableId = receivableIdOf(data);
  const movement = new Map<
    Id<"accounts">,
    { pre: number; dr: number; cr: number }
  >();
  for (const a of accounts) movement.set(a._id, { pre: 0, dr: 0, cr: 0 });
  // GL-only movements on the member receivable control: entries the member
  // ledgers do not mirror (bills and member receipts ARE the mirror — while
  // their member still exists).
  const controlGlOnly = { pre: 0, dr: 0, cr: 0 };
  // Control movements from bills/receipts whose member is gone (deleted or
  // never bound): the member ledgers present no figure for them, so the
  // receivable row must show their GL leg instead of losing them.
  const unmirrored = { pre: 0, dr: 0, cr: 0 };
  for (const e of unifiedEntries(data)) {
    if (e.date > toDate) continue;
    const prePeriod = e.date < fromDate;
    for (const l of e.lines) {
      const m = movement.get(l.accountId);
      if (m) {
        if (prePeriod) m.pre += l.debit - l.credit;
        else {
          m.dr += l.debit;
          m.cr += l.credit;
        }
      }
      if (receivableId && l.accountId === receivableId) {
        const memberWorld = e.type === "bill" || e.type === "member_receipt";
        const mirrored =
          memberWorld &&
          e.memberId !== undefined &&
          e.memberId !== null &&
          data.members.some((mm) => mm._id === e.memberId);
        if (memberWorld && !mirrored) {
          if (prePeriod) unmirrored.pre += l.debit - l.credit;
          else {
            unmirrored.dr += l.debit;
            unmirrored.cr += l.credit;
          }
        } else if (!memberWorld) {
          if (prePeriod) controlGlOnly.pre += l.debit - l.credit;
          else {
            controlGlOnly.dr += l.debit;
            controlGlOnly.cr += l.credit;
          }
        }
      }
    }
  }
  // Member-ledger position, in the computeMemberBalances arithmetic: opening
  // as at the day before `fromDate`, plus the period's bill charges and
  // receipts. Carried opening-balance lines on bills restate the opening, so
  // they are never counted twice.
  let memberOpening = 0;
  let memberBilled = 0;
  let memberReceived = 0;
  if (receivableId) {
    for (const r of computeMemberBalances(data, fromDate, toDate)) {
      memberOpening += r.opening;
      memberBilled += r.billed;
      memberReceived += r.received;
    }
  }
  // Bill charges that never reach a credit ledger (a line mis-mapped onto
  // the control itself, onto a bank-cash ledger, or pointing at a
  // since-deleted account) post NOWHERE — the bill's receivable debit is the
  // sum of the emitted credits. The books still owe the member that charge,
  // so the receivable row keeps it and a labelled SYSTEM suspense row
  // carries the unmatched credit — without it the Current Period and
  // Closing columns would run short by exactly the unpostable amounts.
  // `gap*` covers every bill; the `unmirrored*` split supplements only bills
  // whose member is gone (their member figures do not exist, so their
  // posted leg already showed the charge minus gap). Only meaningful while
  // the control IS a receivable ledger — the receivable row that carries the
  // charge exists only then; a bank-mis-set or missing control presents
  // bills through the credit-only postings plus the bill-debit Suspense row.
  const controlIsReceivableLedger =
    receivableId !== undefined &&
    data.accounts.some(
      (a) => a._id === receivableId && a.kind === "receivable",
    );
  let gapPre = 0;
  let gapPeriod = 0;
  let gapUnmirroredPre = 0;
  let gapUnmirroredPeriod = 0;
  if (controlIsReceivableLedger) {
    for (const b of data.bills) {
      if (b.issueDate > toDate) continue;
      const posted = billPostingCredits(b, receivableId, data.accounts).reduce(
        (s, l) => s + l.amount,
        0,
      );
      const delta = billChargeAmount(b, receivableId) - posted;
      if (delta === 0) continue;
      const mirrored =
        !!b.memberId && data.members.some((mm) => mm._id === b.memberId);
      if (b.issueDate < fromDate) {
        gapPre += delta;
        if (!mirrored) gapUnmirroredPre += delta;
      } else {
        gapPeriod += delta;
        if (!mirrored) gapUnmirroredPeriod += delta;
      }
    }
  }
  const rows: TrialBalanceColumnRow[] = [];
  for (const a of accounts) {
    const m = movement.get(a._id)!;
    const debitPositive = a.type === "asset" || a.type === "expense";
    const isMemberControl =
      receivableId !== undefined && a._id === receivableId && a.kind === "receivable";
    const debitAdjusted = debitPositive ? a.openingBalance : -a.openingBalance;
    let opening: number;
    let dr: number;
    let cr: number;
    if (isMemberControl) {
      // ONE basis at a time — mixing them counted the same opening twice
      // whenever openings sat on the control ledger AND on the member records
      // (or reached it through an opening journal).
      const glCarriesOpening = debitAdjusted !== 0 || controlGlOnly.pre !== 0;
      if (glCarriesOpening) {
        // GL basis: the control ledger carries the opening (its own balance
        // or pre-period postings) — the row is its plain GL movement, plus
        // the unposted bill charges it never received a leg for.
        opening = debitAdjusted + m.pre + gapPre;
        dr = m.dr + gapPeriod;
        cr = m.cr;
      } else {
        // Member basis: the GL knows nothing of the opening, so the row
        // presents the member ledgers (openings per member, bills, receipts)
        // plus the GL-only adjustments (journals) they cannot mirror. The
        // member figures already carry every mirrored bill's full charge
        // (posted or not); bills whose member is gone need their posted leg
        // plus that member-less charge's unposted part added back.
        opening = memberOpening + unmirrored.pre + gapUnmirroredPre;
        dr =
          memberBilled +
          controlGlOnly.dr +
          unmirrored.dr +
          gapUnmirroredPeriod;
        cr = memberReceived + controlGlOnly.cr + unmirrored.cr;
      }
    } else {
      opening = debitAdjusted + m.pre;
      dr = m.dr;
      cr = m.cr;
    }
    const closing = opening + dr - cr;
    const openingDr = opening > 0 ? opening : 0;
    const openingCr = opening < 0 ? -opening : 0;
    const closingDr = closing > 0 ? closing : 0;
    const closingCr = closing < 0 ? -closing : 0;
    if (openingDr === 0 && openingCr === 0 && dr === 0 && cr === 0) continue;
    rows.push({
      accountId: a._id,
      code: a.code,
      name: a.name,
      type: a.type,
      openingDr,
      openingCr,
      periodDr: dr,
      periodCr: cr,
      closingDr,
      closingCr,
      printNo: a.printNo,
    });
  }
  // Bill debits that have nowhere to land: with no receivable ledger in
  // the chart (or the control mis-set to a bank/cash account), the Dr side
  // of every bill cannot post — while its income credits still MUST reach
  // the Trial Balance, Income & Expenditure and the Balance Sheet. This
  // SYSTEM row carries that debit the way a suspense account would, so all
  // three column groups still foot and the missing ledger stays visible.
  // Zero in the normal case: the real receivable row carries the charges.
  let billDebitPre = 0;
  let billDebitPeriod = 0;
  if (!controlIsReceivableLedger) {
    for (const e of unifiedEntries(data)) {
      if (e.type !== "bill" || e.date > toDate) continue;
      let debit = 0;
      let credit = 0;
      for (const l of e.lines) {
        debit += l.debit;
        credit += l.credit;
      }
      const missing = credit - debit; // credits-only entry → the whole charge
      if (missing === 0) continue;
      if (e.date < fromDate) billDebitPre += missing;
      else billDebitPeriod += missing;
    }
  }
  if (billDebitPre !== 0 || billDebitPeriod !== 0) {
    const billDebitTotal = billDebitPre + billDebitPeriod;
    rows.push({
      accountId: null,
      code: "",
      name: "Members Receivable — no ledger posting (Suspense)",
      type: "asset",
      openingDr: billDebitPre > 0 ? billDebitPre : 0,
      openingCr: billDebitPre < 0 ? -billDebitPre : 0,
      periodDr: billDebitPeriod > 0 ? billDebitPeriod : 0,
      periodCr: billDebitPeriod < 0 ? -billDebitPeriod : 0,
      closingDr: billDebitTotal > 0 ? billDebitTotal : 0,
      closingCr: billDebitTotal < 0 ? -billDebitTotal : 0,
      system: true,
    });
  }
  // The unmatched credit of bill charges that could not post (mis-mapped
  // tariff heads): the receivable row above keeps the member's charge — the
  // member really owes it — so this SYSTEM row carries the other side, the
  // way a suspense account would, keeping every column in foot while making
  // the mapping error visible on the printed statement.
  const gapClosing = gapPre + gapPeriod;
  if (controlIsReceivableLedger && (gapPre !== 0 || gapPeriod !== 0)) {
    rows.push({
      accountId: null,
      code: "",
      name: "Unposted bill charges — mis-mapped heads (Suspense)",
      type: "asset",
      // Credit side by construction: the receivable row above keeps the
      // debit (the member owes the charge), this row is its unmatched twin.
      openingDr: gapPre < 0 ? -gapPre : 0,
      openingCr: gapPre > 0 ? gapPre : 0,
      periodDr: gapPeriod < 0 ? -gapPeriod : 0,
      periodCr: gapPeriod > 0 ? gapPeriod : 0,
      closingDr: gapClosing < 0 ? -gapClosing : 0,
      closingCr: gapClosing > 0 ? gapClosing : 0,
      system: true,
    });
  }
  // The system "Income over Expenses" ledger, as the user asked for it: its
  // CLOSING balance must carry the current year's result — opening brought
  // forward ± the period's income over expenses — instead of repeating the
  // opening unchanged (no GL posting ever touches that ledger). The current
  // result therefore also appears in the row's CURRENT PERIOD columns, on the
  // side the result belongs to. To keep the three columns footing, the same
  // amount posts to a labelled SYSTEM row on the opposite side — the drafted
  // closing journal the office would otherwise have to make by hand (Dr/Cr
  // every income and expense ledger against Income over Expenses).
  const surplus = computeIncomeExpenditure(data, fromDate, toDate).surplus;
  const ioe = accounts.find(
    (a) => a.type === "liability" && a.name.trim().toLowerCase() === "income over expenses",
  );
  if (ioe && surplus !== 0) {
    const ioeRow = rows.find((r) => r.accountId === ioe._id);
    if (ioeRow) {
      // Credit-positive surplus convention for this liability ledger. Any
      // closing-journal postings already in the row's period columns keep
      // counting: opening + those + this result = the true closing figure.
      if (surplus > 0) ioeRow.periodCr += surplus;
      else ioeRow.periodDr += -surplus;
    } else {
      // The ledger has no opening and no postings — present the row anyway
      // so the result is visible in the TB.
      rows.push({
        accountId: ioe._id,
        code: ioe.code,
        name: ioe.name,
        type: ioe.type,
        openingDr: 0,
        openingCr: 0,
        periodDr: surplus < 0 ? -surplus : 0,
        periodCr: surplus > 0 ? surplus : 0,
        closingDr: 0,
        closingCr: 0,
        printNo: ioe.printNo,
      });
    }
    // The adjustment is the drafted closing journal's net effect: its own
    // movement IS its balance, so its closing columns repeat the period
    // columns — that keeps every Dr/Cr column footing even though the
    // income/expense ledgers still show their (unclosed) balances.
    rows.push({
      accountId: null,
      code: "",
      name: surplus > 0
        ? "Current Year's Result — Adjustment (Dr)"
        : "Current Year's Result — Adjustment (Cr)",
      type: surplus > 0 ? "expense" : "income",
      openingDr: 0,
      openingCr: 0,
      periodDr: surplus > 0 ? surplus : 0,
      periodCr: surplus < 0 ? -surplus : 0,
      closingDr: surplus > 0 ? surplus : 0,
      closingCr: surplus < 0 ? -surplus : 0,
      system: true,
    });
    for (const r of rows) {
      if (r.accountId === ioe._id) {
        // Recompute the IoE closing from the row's OWN opening (typed
        // balance plus pre-period postings) plus the updated period columns.
        // Reading the typed balance alone dropped any pre-period closing
        // journal from the Closing column and left it out of foot.
        const open = r.openingDr - r.openingCr;
        const net = open + (r.periodDr - r.periodCr);
        r.closingDr = net > 0 ? net : 0;
        r.closingCr = net < 0 ? -net : 0;
      }
    }
  }
  rows.sort(byPrintOrder);
  return rows;
}

/**
 * Printing order for statement rows: rows with a user-defined serial no.
 * come first in numeric serial order, then the rest by account code.
 */
export function byPrintOrder(
  a: { printNo?: string; code: string },
  b: { printNo?: string; code: string },
) {
  return (
    (a.printNo ?? "").localeCompare(b.printNo ?? "", undefined, {
      numeric: true,
    }) || a.code.localeCompare(b.code)
  );
}

/**
 * Single-account ledger with a running balance. Opens on the account's
 * opening balance plus every posting dated BEFORE the period — the
 * brought-forward way the reference-format books print a ledger for any
 * chosen period. Cross-year reporting needs this: when the books have
 * moved into FY 2027-28 and the office prints a ledger for a 2026-27
 * period, the account's accumulated balance (not just the original
 * opening) must open the statement.
 */
export function computeAccountLedger(
  data: SocietyData,
  accountId: Id<"accounts">,
  fromDate: string,
  toDate: string,
): LedgerRow[] {
  const { accounts } = data;
  const account = accounts.find((a) => a._id === accountId);
  if (!account) return [];
  const debitNature = account.type === "asset" || account.type === "expense";
  let balance = debitNature ? account.openingBalance : -account.openingBalance;
  // Brought-forward: pre-period postings fold into the opening balance so
  // any period (past or spanning multiple years) opens at its true balance.
  for (const e of unifiedEntries(data)) {
    if (e.date < fromDate) {
      for (const l of e.lines) {
        if (l.accountId === accountId) balance += l.debit - l.credit;
      }
    }
  }
  const bfOpening = balance;
  const rows: LedgerRow[] = [];
  // When earlier years' postings exist before the chosen period (cross-year
  // reporting after a year-end close), the brought-forward position is
  // printed as an explicit OPENING row so the statement opens at its true
  // balance, like the reference books do. Without pre-period movement the
  // account's recorded opening is still printed by the statement itself.
  if (bfOpening !== 0 && Math.abs(bfOpening - (debitNature ? account.openingBalance : -account.openingBalance)) > 0.004) {
    rows.push({
      date: fromDate,
      voucherNo: "OPENING",
      voucherType: "journal",
      particulars: "Opening Balance",
      accountId: accountId,
      debit: bfOpening > 0 ? bfOpening : 0,
      credit: bfOpening < 0 ? -bfOpening : 0,
      balance: bfOpening,
      note: `Brought forward (from entries before ${fromDate})`,
    });
  }
  const inRange = unifiedEntries(data)
    .filter((e) => e.date >= fromDate && e.date <= toDate)
    .sort((a, b) =>
      a.date === b.date
        ? a.voucherNo.localeCompare(b.voucherNo)
        : a.date.localeCompare(b.date),
    );
  for (const e of inRange) {
    for (const l of e.lines) {
      if (l.accountId !== accountId) continue;
      const contra = accounts.find(
        (a) => a._id === (e.bankCashAccountId ?? null) && a._id !== accountId,
      );
      let particulars = TYPE_LABEL[e.type];
      const member = memberLabel(data, e.memberId);
      if (member) {
        particulars += ` — ${member}`;
      } else if (e.type !== "journal" && e.type !== "bill" && contra) {
        particulars += ` — ${contra.name}`;
      } else if (e.type === "other_receipt" || e.type === "payment") {
        particulars += "";
      }
      balance += l.debit - l.credit;
      rows.push({
        date: e.date,
        voucherNo: e.voucherNo,
        voucherType: e.type,
        particulars,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        balance,
        note: l.note ?? e.narration,
      });
    }
  }
  return rows;
}

/**
 * The receivable debit a bill represents on the member ledger: the charge
 * lines only. A carried opening-balance line restates the member's OPENING
 * balance (already shown as the ledger's OPENING row), so it is excluded;
 * pathological line-less bills fall back to the stored total. Shared by the
 * member ledger and the member dues/advance lists so both always agree.
 */
export function billChargeAmount(
  b: Doc<"bills">,
  receivableId?: Id<"accounts">,
): number {
  if (b.lines.length === 0) return b.total;
  return b.lines
    .filter((l) => !isCarriedOpeningLine(l, receivableId))
    .reduce((s, l) => s + l.amount, 0);
}

/**
 * Member receivable ledger: brought-forward opening + bills + receipts,
 * running balance. The opening is the member's recorded opening balance
 * PLUS every pre-period bill charge and receipt — so a ledger printed for
 * any chosen period (current, a past closed year, or spanning several)
 * opens at its true brought-down balance the way the reference books do.
 */
export function computeMemberLedger(
  data: SocietyData,
  memberId: Id<"members">,
  fromDate: string,
  toDate: string,
): LedgerRow[] {
  const { members, vouchers, bills } = data;
  const member = members.find((m) => m._id === memberId);
  if (!member) return [];
  const receivableId = receivableIdOf(data);
  let balance = member.openingBalance;
  // Brought-forward: pre-period bills (charge lines only — carried
  // opening-balance lines restate the recorded opening) and receipts fold
  // into the opening balance, so any period opens at its true position.
  for (const b of bills) {
    if (b.memberId === memberId && b.issueDate < fromDate) {
      balance += billChargeAmount(b, receivableId);
    }
  }
  for (const v of vouchers) {
    if (v.type === "member_receipt" && v.memberId === memberId && v.date < fromDate) {
      balance -= v.total;
    }
  }
  // Brought-forward opening as at `fromDate` — what any period of the books
  // opens at, not just the raw recorded opening.
  const bfOpening = balance;
  const rows: LedgerRow[] = [];
  const addRow = (r: Omit<LedgerRow, "balance">) => {
    balance += r.debit - r.credit;
    rows.push({ ...r, balance });
  };

  if (bfOpening !== 0) {
    const openingDate = member.openingDate ?? fromDate;
    const carriedForward = bfOpening !== member.openingBalance;
    addRow({
      date: !carriedForward && openingDate < fromDate ? fromDate : fromDate,
      voucherNo: "OPENING",
      voucherType: "journal",
      particulars: "Opening Balance",
      accountId: null,
      debit: bfOpening > 0 ? bfOpening : 0,
      credit: bfOpening < 0 ? -bfOpening : 0,
      note: carriedForward
        ? `Brought forward (from entries before ${fromDate})`
        : "As on " + openingDate,
    });
  }

  const relevantBills = bills
    .filter(
      (b) =>
        b.memberId === memberId &&
        b.issueDate >= fromDate &&
        b.issueDate <= toDate,
    )
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  for (const b of relevantBills) {
    // A carried opening-balance line on the bill restates the member's opening
    // receivable — the OPENING row above already accounts for it, so it must
    // not be debited twice. Recognised by NAME (with the receivable-account
    // check as fallback) so changing the receivable account after bills were
    // generated can never double-count the opening balance here.
    const chargeLines = b.lines.filter((l) => !isCarriedOpeningLine(l, receivableId));
    const carried = b.lines
      .filter((l) => isCarriedOpeningLine(l, receivableId))
      .reduce((s, l) => s + l.amount, 0);
    addRow({
      date: b.issueDate,
      voucherNo: b.billNo,
      voucherType: "bill",
      particulars: `Maintenance Bill ${b.period} — ${chargeLines
        .map((l) => l.name)
        .join(", ")}`,
      accountId: null,
      // Debit only the charge lines: the opening balance is already the
      // OPENING row, and generated bills always sum their lines to the total.
      // (Falls back to the stored total for pathological line-less bills.)
      debit: billChargeAmount(b, receivableId),
      credit: 0,
      note: carried
        ? `Due ${b.dueDate} · includes arrears of ${carried.toFixed(2)} carried from opening`
        : `Due ${b.dueDate}`,
      heads: chargeLines.map((l) => ({ name: l.name, amount: l.amount })),
    });
  }

  const receipts = vouchers
    .filter(
      (v) =>
        v.type === "member_receipt" &&
        v.memberId === memberId &&
        v.date >= fromDate &&
        v.date <= toDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const r of receipts) {
    addRow({
      date: r.date,
      voucherNo: r.voucherNo,
      voucherType: r.type,
      particulars: `Receipt${r.reference ? ` — Ref ${r.reference}` : ""}`,
      accountId: r.bankCashAccountId ?? null,
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
  // The running balance starts from the brought-forward opening, so the
  // OPENING row itself must not add its amount a second time.
  let running = bfOpening;
  const reweighted = ordered.map((r) => {
    if (r.voucherNo === "OPENING") return { ...r, balance: running };
    running += r.debit - r.credit;
    return { ...r, balance: running };
  });
  return reweighted;
}

export type MemberBalanceRow = {
  memberId: Id<"members">;
  code: string;
  /** Display flat number (wing-flat, falling back to the code). */
  flatNo: string;
  name: string;
  isActive: boolean;
  /** Dues as at the day before `fromDate` (debit-positive; negative = advance). */
  opening: number;
  /** Bills raised inside the period (charge lines, as on the member ledger). */
  billed: number;
  /** Member receipts inside the period. */
  received: number;
  /** Dues as at `toDate` (debit-positive; negative = advance held). */
  closing: number;
  /** Date of the member's latest bill/receipt up to `toDate` (date-wise display). */
  lastEntryDate: string | null;
};

/**
 * Per-member dues position, in exactly the member-ledger arithmetic: opening
 * balance, plus bill charge amounts (carried opening lines excluded — they
 * restate the opening), minus receipts. One source of truth for the Member
 * Dues list, the Member Advance list and the Balance Sheet's member-level
 * "Dues from Members" / "Advance from Members" split, so they always agree.
 */
export function computeMemberBalances(
  data: SocietyData,
  fromDate: string,
  toDate: string,
): MemberBalanceRow[] {
  const receivableId = receivableIdOf(data);
  const billsByMember = new Map<Id<"members">, Doc<"bills">[]>();
  for (const b of data.bills) {
    if (b.issueDate > toDate) continue;
    const list = billsByMember.get(b.memberId);
    if (list) list.push(b);
    else billsByMember.set(b.memberId, [b]);
  }
  const receiptsByMember = new Map<Id<"members">, Doc<"vouchers">[]>();
  for (const v of data.vouchers) {
    if (v.type !== "member_receipt" || !v.memberId || v.date > toDate) continue;
    const list = receiptsByMember.get(v.memberId);
    if (list) list.push(v);
    else receiptsByMember.set(v.memberId, [v]);
  }
  return data.members.map((m) => {
    let opening = m.openingBalance;
    let billed = 0;
    let received = 0;
    let lastEntryDate: string | null = null;
    for (const b of billsByMember.get(m._id) ?? []) {
      const charge = billChargeAmount(b, receivableId);
      if (b.issueDate < fromDate) opening += charge;
      else billed += charge;
      if (!lastEntryDate || b.issueDate > lastEntryDate) lastEntryDate = b.issueDate;
    }
    for (const v of receiptsByMember.get(m._id) ?? []) {
      if (v.date < fromDate) opening -= v.total;
      else received += v.total;
      if (!lastEntryDate || v.date > lastEntryDate) lastEntryDate = v.date;
    }
    return {
      memberId: m._id,
      code: m.code,
      flatNo: memberFlatNo(m),
      name: m.name,
      isActive: m.isActive,
      opening,
      billed,
      received,
      closing: opening + billed - received,
      lastEntryDate,
    };
  });
}

/** Form N heading an income/expenditure ledger files under. */
function ieGroupOf(a: Doc<"accounts">): string {
  const n = a.name.toLowerCase();
  if (a.type === "income") {
    if (n.includes("interest")) return "Interest and Other Income";
    return "Contributions and Other Receipts";
  }
  if (
    n.includes("sinking") ||
    n.includes("repair") ||
    n.includes("repairs") ||
    n.includes("salaries") ||
    n.includes("salary") ||
    n.includes("electricity") ||
    n.includes("water") ||
    n.includes("lift") ||
    n.includes("insurance") ||
    n.includes("audit") ||
    n.includes("municipal") ||
    n.includes("tax") ||
    n.includes("printing") ||
    n.includes("stationery") ||
    n.includes("sundry")
  )
    return "Repairs, Maintenance and Establishment Expenses";
  return "Other Operating Expenses";
}

/** Form N I&E headings in statement order (income sorts after all of these). */
const IE_EXPENSE_ORDER = [
  "Repairs, Maintenance and Establishment Expenses",
  "Other Operating Expenses",
  "Depreciation and Provisions",
];
const IE_INCOME_ORDER = ["Contributions and Other Receipts", "Interest and Other Income"];

/**
 * Net movement per income/expenditure ledger over [fromDate, toDate]. Every
 * ledger is returned — nil ones included — so the statements can print the
 * full Chart of Accounts (opening balance plus the period's postings), the
 * way the reference format prints. Net is credit-positive for income,
 * debit-positive for expense.
 */
function ieNetsForPeriod(data: SocietyData, fromDate: string, toDate: string) {
  const nets = new Map<Id<"accounts">, number>();
  const entries = unifiedEntries(data).filter(
    (e) => e.date >= fromDate && e.date <= toDate,
  );
  for (const a of data.accounts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    let net = a.openingBalance;
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.accountId !== a._id) continue;
        const delta = l.credit - l.debit;
        net += a.type === "income" ? delta : -delta;
      }
    }
    nets.set(a._id, net);
  }
  return { nets };
}

/** Form N print order: prescribed headings first, then serial / code order. */
function ieOrderRows(rows: TrialBalanceRow[], groups: string[]) {
  const idx = (r: TrialBalanceRow) => {
    const i = groups.indexOf(r.group ?? "");
    return i === -1 ? groups.length : i;
  };
  rows.sort((a, b) => idx(a) - idx(b) || byPrintOrder(a, b));
}

export function computeIncomeExpenditure(
  data: SocietyData,
  fromDate: string,
  toDate: string,
) {
  const { nets } = ieNetsForPeriod(data, fromDate, toDate);
  const income: TrialBalanceRow[] = [];
  const expenditure: TrialBalanceRow[] = [];
  let totalIncome = 0;
  let totalExpenditure = 0;
  for (const a of data.accounts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    const isIncome = a.type === "income";
    const net = nets.get(a._id) ?? 0;
    // Zero-value ledgers do not print (Crystal reference format).
    if (net === 0) continue;
    if (isIncome) {
      income.push({
        accountId: a._id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: 0,
        credit: net,
        printNo: a.printNo,
        group: ieGroupOf(a),
      });
      totalIncome += net;
    } else {
      expenditure.push({
        accountId: a._id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: net,
        credit: 0,
        printNo: a.printNo,
        group: ieGroupOf(a),
      });
      totalExpenditure += net;
    }
  }
  ieOrderRows(expenditure, IE_EXPENSE_ORDER);
  ieOrderRows(income, IE_INCOME_ORDER);
  // The period result is presented as its own SYSTEM-GENERATED account so the
  // two sides foot to the same total: a surplus appears on the expenditure
  // side as "Income over Expenses", a deficit on the income side as "Expenses
  // over Income" — the same account the Balance Sheet carries. Appended AFTER
  // the group sorting: the row has no ledger, hence no group or serial, and
  // always prints last. totalIncome/totalExpenditure stay the pure ledger
  // totals; the printed statement footing adds this row on top.
  const surplus = totalIncome - totalExpenditure;
  if (surplus > 0) {
    expenditure.push({
      accountId: "" as Id<"accounts">,
      code: "",
      name: "Income over Expenses",
      type: "expense",
      debit: surplus,
      credit: 0,
      system: true,
    });
  } else if (surplus < 0) {
    income.push({
      accountId: "" as Id<"accounts">,
      code: "",
      name: "Expenses over Income",
      type: "income",
      debit: 0,
      credit: -surplus,
      system: true,
    });
  }
  return { income, expenditure, totalIncome, totalExpenditure, surplus };
}

/** Shift an ISO date by whole years (UTC, stable across leap days). */
function shiftYear(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + delta);
  return d.toISOString().slice(0, 10);
}

/** An Income & Expenditure row carrying its previous-year comparative. */
export type IeComparativeRow = TrialBalanceRow & {
  /** Previous-year figure, same side/sign convention as debit or credit. */
  prev: number;
};

/**
 * Income & Expenditure with the previous-year comparative column. The prior
 * period is the same span shifted back one year, so an April–March financial
 * year is compared against the preceding April–March. Ledgers with nothing
 * to show in either year do not print; the balancing system account carries
 * the previous period's result on the side it belongs to, so both columns
 * foot together.
 */
export function computeIncomeExpenditureComparative(
  data: SocietyData,
  fromDate: string,
  toDate: string,
) {
  const cur = ieNetsForPeriod(data, fromDate, toDate);
  const prev = ieNetsForPeriod(data, shiftYear(fromDate, -1), shiftYear(toDate, -1));
  const income: IeComparativeRow[] = [];
  const expenditure: IeComparativeRow[] = [];
  let totalIncome = 0;
  let totalExpenditure = 0;
  let prevTotalIncome = 0;
  let prevTotalExpenditure = 0;
  for (const a of data.accounts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    const isIncome = a.type === "income";
    const net = cur.nets.get(a._id) ?? 0;
    const prior = prev.nets.get(a._id) ?? 0;
    // Zero-value ledgers do not print (Crystal reference format) — but a
    // ledger with a prior-year figure always does, comparative or not.
    if (net === 0 && prior === 0) continue;
    const row: IeComparativeRow = {
      accountId: a._id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: isIncome ? 0 : net,
      credit: isIncome ? net : 0,
      printNo: a.printNo,
      group: ieGroupOf(a),
      prev: prior,
    };
    if (isIncome) {
      income.push(row);
      totalIncome += net;
      prevTotalIncome += prior;
    } else {
      expenditure.push(row);
      totalExpenditure += net;
      prevTotalExpenditure += prior;
    }
  }
  ieOrderRows(expenditure, IE_EXPENSE_ORDER);
  ieOrderRows(income, IE_INCOME_ORDER);
  const surplus = totalIncome - totalExpenditure;
  const prevSurplus = prevTotalIncome - prevTotalExpenditure;
  // Show the balancing account whenever either year has a result. The current
  // year picks the side; the prior-year figure is signed so it correctly reads
  // as the opposite side when the result flipped between the two years.
  if (surplus !== 0 || prevSurplus !== 0) {
    const side = surplus !== 0 ? Math.sign(surplus) : Math.sign(prevSurplus);
    const curAmount = Math.abs(surplus);
    const prevAmount =
      prevSurplus === 0 || Math.sign(prevSurplus) === side
        ? Math.abs(prevSurplus)
        : -Math.abs(prevSurplus);
    if (side > 0) {
      expenditure.push({
        accountId: "" as Id<"accounts">,
        code: "",
        name: "Income over Expenses",
        type: "expense",
        debit: curAmount,
        credit: 0,
        prev: prevAmount,
        system: true,
      });
    } else if (side < 0) {
      income.push({
        accountId: "" as Id<"accounts">,
        code: "",
        name: "Expenses over Income",
        type: "income",
        debit: 0,
        credit: curAmount,
        prev: prevAmount,
        system: true,
      });
    }
  }
  return {
    income,
    expenditure,
    totalIncome,
    totalExpenditure,
    surplus,
    prevTotalIncome,
    prevTotalExpenditure,
    prevSurplus,
  };
}

/**
 * Form N (MCS Rules 1961, Rule 4(1)1) LIABILITY headings, in statute order.
 * The Balance Sheet is laid out under these Roman-numbered heads.
 */
export const FORM_N_LIABILITY_ORDER = [
  "I. Share Capital",
  "II. Reserve Funds and Other Funds",
  "III. Staff Provident Fund",
  "IV. Secured Loans",
  "V. Unsecured Loans",
  "VI. Deposits",
  "VII. Current Liabilities and Provisions",
  "VIII. Unpaid Dividends",
  "IX. Interest Accrued but Not Paid",
  "X. Other Liabilities",
  "XI. Profit and Loss Account",
];

/**
 * Form N ASSET headings, in statute order. Head X is the Profit and Loss
 * Account — a loss not written off sits here, so both sides of the sheet
 * still foot to the same total.
 */
export const FORM_N_ASSET_ORDER = [
  "I. Cash and Bank Balances",
  "II. Investments",
  "III. Staff Provident Fund",
  "IV. Loans and Advances",
  "V. Sundry Debtors",
  "VI. Current Assets",
  "VII. Fixed Assets",
  "VIII. Miscellaneous Expenses and Losses",
  "IX. Other Items",
  "X. Profit and Loss Account",
  "XI. Current Losses",
];

/** The Form N liability head a ledger files under (Roman-numbered). */
function fundGroupOf(data: SocietyData, a: Doc<"accounts">): string {
  const g = a.groupId
    ? data.accountGroups?.find((x) => x._id === a.groupId)
    : undefined;
  if (g) return g.name;
  const n = a.name.toLowerCase();
  if (n.includes("share") && n.includes("capital")) return "I. Share Capital";
  if (n.includes("provident")) return "III. Staff Provident Fund";
  if (
    n.includes("reserve") ||
    n.includes("sinking") ||
    n.includes("building fund") ||
    n.includes("development") ||
    n.includes("depreciation") ||
    n.includes("equalisation") ||
    n.includes("equalization")
  )
    return "II. Reserve Funds and Other Funds";
  // "unsecured" contains "secured" — test it first.
  if (n.includes("unsecured")) return "V. Unsecured Loans";
  if (n.includes("secured") || n.includes("debenture")) return "IV. Secured Loans";
  if (n.includes("deposit")) return "VI. Deposits";
  if (n.includes("dividend")) return "VIII. Unpaid Dividends";
  if (
    n.includes("interest") &&
    (n.includes("accrued") || n.includes("outstanding") || n.includes("payable"))
  )
    return "IX. Interest Accrued but Not Paid";
  if (
    n.includes("advance") ||
    n.includes("provision") ||
    n.includes("payable") ||
    n.includes("creditor") ||
    n.includes("outstanding")
  )
    return "VII. Current Liabilities and Provisions";
  return "X. Other Liabilities";
}

/** The Form N asset head a ledger files under (Roman-numbered). */
function assetGroupOf(a: Doc<"accounts">): string {
  if (a.kind === "bank_cash") return "I. Cash and Bank Balances";
  if (a.kind === "receivable") return "V. Sundry Debtors";
  const n = a.name.toLowerCase();
  if (n.includes("provident")) return "III. Staff Provident Fund";
  if (
    n.includes("investment") ||
    n.includes("deposit") ||
    n.includes("securities") ||
    n.includes("shares") ||
    n.includes("debenture")
  )
    return "II. Investments";
  if (
    n.includes("loan") ||
    n.includes("advance") ||
    n.includes("overdraft") ||
    n.includes("hypothecation") ||
    n.includes("pledge")
  )
    return "IV. Loans and Advances";
  if (n.includes("debtor") || n.includes("receivable") || n.includes("due"))
    return "V. Sundry Debtors";
  if (n.includes("cash") || n.includes("bank")) return "I. Cash and Bank Balances";
  if (
    n.includes("stock") ||
    n.includes("store") ||
    n.includes("spare") ||
    n.includes("work in progress")
  )
    return "VI. Current Assets";
  if (
    n.includes("land") ||
    n.includes("building") ||
    n.includes("furniture") ||
    n.includes("fixture") ||
    n.includes("machinery") ||
    n.includes("vehicle") ||
    n.includes("equipment") ||
    n.includes("deadstock") ||
    n.includes("computer") ||
    n.includes("fixed asset")
  )
    return "VII. Fixed Assets";
  if (
    n.includes("goodwill") ||
    n.includes("preliminary") ||
    n.includes("deferred")
  )
    return "VIII. Miscellaneous Expenses and Losses";
  return "IX. Other Items";
}

/**
 * Balance sheet in the Form N (MCS Rules) shape: liabilities and funds under
 * their Roman-numbered headings, assets on the other side, and each row
 * carrying the previous-year closing figure next to the current one.
 *
 * Member money is presented PER MEMBER, never netted: a member with dues
 * outstanding is an asset ("Dues from Members"); a member who has paid ahead of
 * billing — nothing due — has lent the society money, a liability ("Advance
 * from Members" under Current Liabilities). The figures come from the same
 * member-ledger arithmetic as the Member Dues / Member Advance lists, so the
 * statements and those lists always agree.
 */
export function computeBalanceSheet(data: SocietyData, toDate: string) {
  type Side = {
    code: string;
    name: string;
    amount: number;
    type: Doc<"accounts">["type"];
    /** User-defined printing serial no. for statement order. */
    printNo?: string;
    /** Form N section heading this row is grouped under. */
    group: string;
    /** Previous-year figure for comparative display (negative = opposite side). */
    prev: number;
  };

  // Debit-positive for assets, credit-positive for liabilities, as at `upto`.
  const entries = unifiedEntries(data);
  const netOf = (a: Doc<"accounts">, upto: string): number => {
    let net = a.openingBalance;
    for (const e of entries) {
      if (e.date > upto) continue;
      for (const l of e.lines) {
        if (l.accountId !== a._id) continue;
        net += a.type === "asset" ? l.debit - l.credit : l.credit - l.debit;
      }
    }
    return net;
  };

  // Previous-year cut-off: the day before this financial year opened.
  const fyStart = fyStartDateString(data.society?.fyStartMonth ?? 4, toDate);
  const dayBefore = new Date(`${fyStart}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const prevToDate = dayBefore.toISOString().slice(0, 10);
  const prevFyStart = new Date(`${fyStart}T00:00:00Z`);
  prevFyStart.setUTCFullYear(prevFyStart.getUTCFullYear() - 1);

  const assets: Side[] = [];
  const liabilities: Side[] = [];
  // Serial for the system "Dues from Members" row: reuse the receivable
  // control account's printing serial so the row prints where the member
  // position always sat.
  const receivablePrintNo = data.accounts.find(
    (a) => a.kind === "receivable",
  )?.printNo;

  // The Profit and Loss head (Form N heads XI / X): the system "Income over
  // Expenses" ledger. When the society carries this ledger with a
  // brought-forward balance (the accumulated result of years already closed
  // into it), that balance must reach the sheet ON TOP of the current year's
  // computed result — a sheet that shows only the current year's surplus
  // silently drops the brought-forward figure the books carry.
  const ioeLedger = data.accounts.find(
    (a) =>
      a.type === "liability" &&
      a.name.trim().toLowerCase() === "income over expenses",
  );

  for (const a of data.accounts) {
    if (a.type !== "asset" && a.type !== "liability") continue;
    // Member outstanding is presented ONLY through the system row "Dues from
    // Members" below — receivable control accounts are excluded so member
    // dues can never appear twice (nor as an "unadjusted" residual).
    if (a.kind === "receivable") continue;
    const n = a.name.trim().toLowerCase();
    // Presented from the member ledgers, not the GL control ledger.
    if (a.type === "liability" && n === "advance from members") continue;
    // Presented as the Profit and Loss Account head below — its own ledger
    // balance (brought forward) combines with the current year's result
    // there, so it must not also print as a generic liability row.
    if (ioeLedger && a._id === ioeLedger._id) continue;
    const net = netOf(a, toDate);
    const prev = netOf(a, prevToDate);
    // Zero-value ledgers do not print (Crystal reference format): a ledger
    // whose balance AND prior-year figure are both nil has nothing to show.
    // One-sided-zero rows (e.g. repaid-to-zero with a prior figure) still
    // print — the comparative is the point of the column.
    if (net === 0 && prev === 0) continue;
    const row: Side = {
      code: a.code,
      name: a.name,
      amount: Math.abs(net),
      type: a.type,
      printNo: a.printNo,
      group: a.type === "liability" ? fundGroupOf(data, a) : assetGroupOf(a),
      // Prior-year figure keeps its natural sign: a row always prints on its
      // own asset/liability side, so a positive prior balance belongs on this
      // side and a negative one sat on the opposite side last year. (The old
      // sign-flip here negated the figure whenever the ledger had emptied to
      // zero this year — a repaid loan showed last year's balance backwards.)
      prev,
    };
    if (a.type === "asset") assets.push(row);
    else liabilities.push(row);
  }

  const memberGross = (upto: string) => {
    let dues = 0;
    let advance = 0;
    for (const r of computeMemberBalances(data, "0000-01-01", upto)) {
      if (r.closing > 0) dues += r.closing;
      else if (r.closing < 0) advance += -r.closing;
    }
    return { dues, advance };
  };
  const membersNow = memberGross(toDate);
  const membersPrev = memberGross(prevToDate);

  if (membersNow.dues !== 0 || membersPrev.dues !== 0) {
    assets.push({
      code: "",
      // Presented from the member ledgers — and, when the society has the
      // "Dues from Members" ledger (Chart of Accounts), from its postings
      // instead of the member arithmetic alone.
      name: "Dues from Members",
      amount: membersNow.dues,
      type: "asset",
      printNo: receivablePrintNo,
      group: "V. Sundry Debtors",
      prev: membersPrev.dues,
    });
  }
  if (membersNow.advance !== 0 || membersPrev.advance !== 0) {
    liabilities.push({
      code: "",
      // System-generated account (reference format 2): member opening CREDIT
      // balances — money members paid ahead of billing.
      name: "Advance from Members",
      amount: membersNow.advance,
      type: "liability",
      group: "VII. Current Liabilities and Provisions",
      prev: membersPrev.advance,
    });
  }
  const ie = computeIncomeExpenditure(
    data,
    fyStartDateString(data.society?.fyStartMonth ?? 4, toDate),
    toDate,
  );
  const iePrev = computeIncomeExpenditure(
    data,
    prevFyStart.toISOString().slice(0, 10),
    prevToDate,
  );
  // The Profit and Loss Account head: the ledger's brought-forward balance
  // (credit positive) PLUS the current year's computed result. A closing
  // journal that already folded the year's result into the ledger (Dr/Cr
  // every income and expense ledger against "Income over Expenses") is
  // recognised, so the computed result is not added a second time — the
  // ledger balance alone is then the true figure.
  const closingFolded =
    ioeLedger !== undefined &&
    unifiedEntries(data).some(
      (e) =>
        e.date >= fyStartDateString(data.society?.fyStartMonth ?? 4, toDate) &&
        e.date <= toDate &&
        e.type === "journal" &&
        e.lines.some((l) => l.accountId === ioeLedger._id) &&
        e.lines.length > 1,
    );
  const plHead =
    ioeLedger !== undefined && closingFolded
      ? netOf(ioeLedger, toDate)
      : (ioeLedger !== undefined ? netOf(ioeLedger, toDate) : 0) + ie.surplus;
  const plHeadPrev =
    ioeLedger !== undefined
      ? netOf(ioeLedger, prevToDate) + (closingFolded ? 0 : iePrev.surplus)
      : iePrev.surplus;
  if (plHead !== 0 || plHeadPrev !== 0) {
    if (plHead >= 0) {
      // Surplus funds the society: a Form N fund on the liabilities side
      // (head XI — Profit and Loss Account).
      liabilities.push({
        code: "",
        name: "Income over Expenses",
        amount: plHead,
        type: "liability",
        group: "XI. Profit and Loss Account",
        prev: plHeadPrev,
      });
    } else {
      // Deficit is a loss not written off: on the ASSETS side (Form N asset
      // head X — Profit and Loss Account) so the two sides still tie.
      assets.push({
        code: "",
        name: "Expenses over Income",
        amount: -plHead,
        type: "asset",
        group: "X. Profit and Loss Account",
        prev: -plHeadPrev,
      });
    }
  }

  const groupOrder = (g: string) => {
    const i = FORM_N_LIABILITY_ORDER.indexOf(g);
    return i === -1 ? FORM_N_LIABILITY_ORDER.length : i;
  };
  // Assets sort by Form N asset heading (the loss head X prints last, before
  // Current Losses), then serial / code order within each heading.
  const assetOrder = (g: string) => {
    const i = FORM_N_ASSET_ORDER.indexOf(g);
    return i === -1 ? FORM_N_ASSET_ORDER.length : i;
  };
  assets.sort((a, b) => assetOrder(a.group) - assetOrder(b.group) || byPrintOrder(a, b));
  liabilities.sort(
    (a, b) => groupOrder(a.group) - groupOrder(b.group) || byPrintOrder(a, b),
  );
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalAssetsPrev = assets.reduce((s, r) => s + r.prev, 0);
  const totalLiabilitiesPrev = liabilities.reduce((s, r) => s + r.prev, 0);
  return {
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    totalAssetsPrev,
    totalLiabilitiesPrev,
  };
}

export function computeReceiptPayment(
  data: SocietyData,
  fromDate: string,
  toDate: string,
) {
  const { accounts } = data;
  const openingByAccount = new Map<Id<"accounts">, number>();
  let openingCash = 0;
  for (const a of accounts) {
    if (a.kind !== "bank_cash") continue;
    openingByAccount.set(a._id, a.openingBalance);
    openingCash += a.openingBalance;
  }
  for (const v of data.vouchers) {
    if (v.date >= fromDate) continue;
    for (const l of v.lines) {
      const acc = accounts.find((a) => a._id === l.accountId);
      if (acc?.kind === "bank_cash") {
        openingByAccount.set(
          acc._id,
          (openingByAccount.get(acc._id) ?? 0) + l.debit - l.credit,
        );
        openingCash += l.debit - l.credit;
      }
    }
  }
  const inflow = new Map<
    Id<"accounts">,
    { name: string; amount: number; code: string; printNo?: string }
  >();
  const outflow = new Map<
    Id<"accounts">,
    { name: string; amount: number; code: string; printNo?: string }
  >();
  let totalIn = 0;
  let totalOut = 0;
  for (const v of data.vouchers) {
    if (v.date < fromDate || v.date > toDate) continue;
    const isReceipt = v.type === "member_receipt" || v.type === "other_receipt";
    for (const l of v.lines) {
      const acc = accounts.find((a) => a._id === l.accountId);
      if (!acc || acc.kind === "bank_cash") continue; // skip the cash side
      const map = isReceipt ? inflow : outflow;
      const entry =
        map.get(l.accountId) ??
        { name: acc.name, amount: 0, code: acc.code, printNo: acc.printNo };
      const amt = isReceipt ? l.credit : l.debit;
      if (amt === 0) continue;
      entry.amount += amt;
      map.set(l.accountId, entry);
      if (isReceipt) totalIn += amt;
      else totalOut += amt;
    }
  }
  // Print order: serial-numbered ledgers first (numeric), then by code.
  const inflows = Array.from(inflow.values()).sort(byPrintOrder);
  const outflows = Array.from(outflow.values()).sort(byPrintOrder);
  const closingCash = openingCash + totalIn - totalOut;
  return { openingCash, inflows, outflows, totalIn, totalOut, closingCash };
}

/**
 * Cash/Bank Book: per bank-cash account, the classic register with opening
 * balance carried down, To/By party narrations, and running Dr/Cr balance.
 *
 * Only MANUAL cash movements become register rows. Generated bills never
 * touch a bank-cash ledger (they post Dr Receivable / Cr income); a bill line
 * can only reach a bank-cash account through user misconfiguration, and
 * showing those synthetic "movements" inflated deposits and the closing
 * balance. The pre-period accrual is still carried into OPENING either way;
 * bill rows inside the window are simply never rendered.
 */
export function computeCashBook(
  data: SocietyData,
  fromDate: string,
  toDate: string,
  accountId?: Id<"accounts">,
): CashBookSection[] {
  const bankAccounts = data.accounts.filter(
    (a) => a.kind === "bank_cash" && (!accountId || a._id === accountId),
  );
  const entries = unifiedEntries(data)
    .filter((e) => e.date <= toDate)
    .sort((a, b) =>
      a.date === b.date
        ? a.voucherNo.localeCompare(b.voucherNo)
        : a.date.localeCompare(b.date),
    );

  const sections = bankAccounts.map((bank) => {
    let opening = bank.openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    let balance = bank.openingBalance;
    const rows: CashBookRow[] = [];

    for (const e of entries) {
      // Generated bills are accruals, not cash movements — never a register
      // row (their receivable/income postings belong to the General Ledger).
      if (e.type === "bill") continue;
      const bankLines = e.lines.filter((l) => l.accountId === bank._id);
      if (bankLines.length === 0) continue;

      if (e.date < fromDate) {
        for (const l of bankLines) opening += l.debit - l.credit;
        continue;
      }

      // Contra party: the member for member receipts, otherwise the accounts
      // on the other side of the voucher (e.g. the expense paid for).
      const member = e.memberId
        ? data.members.find((m) => m._id === e.memberId)
        : undefined;
      const party = member
        ? `${member.code}/${member.name}`
        : Array.from(
            new Set(
              e.lines
                .filter((l) => l.accountId !== bank._id)
                .map(
                  (l) =>
                    data.accounts.find((a) => a._id === l.accountId)?.name ?? "",
                )
                .filter(Boolean),
            ),
          ).join(", ");

      for (const l of bankLines) {
        const isDebit = l.debit > 0;
        const narration = [`${isDebit ? "To " : "By "}${party || e.type}`];
        if (e.narration) narration.push(e.narration);
        else if (e.mode && e.type === "payment") narration.push(e.mode);
        if (e.reference) narration.push(`Cheque No: ${e.reference}`);
        balance += l.debit - l.credit;
        totalDebit += l.debit;
        totalCredit += l.credit;
        rows.push({
          date: e.date,
          voucherNo: e.voucherNo,
          narration,
          debit: l.debit,
          credit: l.credit,
          balance,
        });
      }
    }

    return {
      accountId: bank._id,
      code: bank.code,
      name: bank.name,
      opening,
      rows,
      totalDebit,
      totalCredit,
      closing: opening + totalDebit - totalCredit,
    };
  });
  // A bank-cash ledger with no opening balance and no movements prints as an
  // empty section — suppress it (the reference format prints active books).
  return sections.filter((s) => s.opening !== 0 || s.rows.length > 0);
}
