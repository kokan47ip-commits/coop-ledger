import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";
import { fyStartDateString, isCarriedOpeningLine, requireSociety } from "./lib";

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
  return (
    data.society?.receivableAccountId ??
    data.accounts.find((a) => a.kind === "receivable")?._id
  );
}

/**
 * All postings in one list: manual vouchers plus generated bills.
 * Each bill posts Dr Members Receivable (total) / Cr the bill's income heads.
 */
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
  if (receivableId) {
    // A generated bill is an accrual — Dr Members Receivable / Cr income
    // heads — and is never a cash movement. The Bank Book therefore never
    // shows bill rows; the Trial Balance, Balance Sheet and General Ledger
    // read the same postings and must agree with it, so a bill line may not
    // post to a bank-cash ledger either. A line can only sit on one through a
    // tariff head mis-mapped in the Tariff Schedule, and letting it through
    // made the bank balance in the TB/BS drift away from the Bank Book. The
    // same guard covers the receivable total line itself, should the
    // receivable account ever be (mis)set to a bank-cash ledger.
    const isBankCash = (id: Id<"accounts">) =>
      data.accounts.find((a) => a._id === id)?.kind === "bank_cash";
    for (const b of data.bills) {
      entries.push({
        date: b.issueDate,
        voucherNo: b.billNo,
        type: "bill",
        memberId: b.memberId,
        narration: `Bill ${b.period}`,
        lines: [
          ...(isBankCash(receivableId)
            ? []
            : [
                {
                  accountId: receivableId,
                  debit: b.total,
                  credit: 0,
                  note: `Period ${b.period}`,
                },
              ]),
          // The carried opening-balance line is part of the receivable debit
          // itself (it predates the system), so it is not credited anywhere.
          ...b.lines
            .filter(
              (l) =>
                l.accountId !== receivableId && !isBankCash(l.accountId),
            )
            .map((l) => ({
              accountId: l.accountId,
              debit: 0,
              credit: l.amount,
            })),
        ],
      });
    }
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
  // ledgers do not mirror (bills and member receipts ARE the mirror).
  const controlGlOnly = { pre: 0, dr: 0, cr: 0 };
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
      if (
        receivableId &&
        l.accountId === receivableId &&
        e.type !== "bill" &&
        e.type !== "member_receipt"
      ) {
        if (prePeriod) controlGlOnly.pre += l.debit - l.credit;
        else {
          controlGlOnly.dr += l.debit;
          controlGlOnly.cr += l.credit;
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
        // or pre-period postings) — the row is its plain GL movement.
        opening = debitAdjusted + m.pre;
        dr = m.dr;
        cr = m.cr;
      } else {
        // Member basis: the GL knows nothing of the opening, so the row
        // presents the member ledgers (openings per member, bills, receipts)
        // plus the GL-only adjustments (journals) they cannot mirror.
        opening = memberOpening;
        dr = memberBilled + controlGlOnly.dr;
        cr = memberReceived + controlGlOnly.cr;
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
        // Recompute the IoE closing from its credit-positive opening plus
        // the (possibly updated) period columns.
        const open = -ioe.openingBalance;
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

/** Single-account ledger with running balance from the opening balance. */
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
  const rows: LedgerRow[] = [];
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

/** Member receivable ledger: opening + bills + receipts, running balance. */
export function computeMemberLedger(
  data: SocietyData,
  memberId: Id<"members">,
  fromDate: string,
  toDate: string,
): LedgerRow[] {
  const { members, vouchers, bills } = data;
  const member = members.find((m) => m._id === memberId);
  if (!member) return [];
  let balance = member.openingBalance;
  const rows: LedgerRow[] = [];
  const addRow = (r: Omit<LedgerRow, "balance">) => {
    balance += r.debit - r.credit;
    rows.push({ ...r, balance });
  };

  const openingDate = member.openingDate ?? fromDate;
  if (member.openingBalance !== 0 && openingDate <= toDate) {
    addRow({
      date: openingDate < fromDate ? fromDate : openingDate,
      voucherNo: "OPENING",
      voucherType: "journal",
      particulars: "Opening Balance",
      accountId: null,
      debit: member.openingBalance > 0 ? member.openingBalance : 0,
      credit: member.openingBalance < 0 ? -member.openingBalance : 0,
      note: "As on " + openingDate,
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
  const receivableId = receivableIdOf(data);
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
  // The running balance already starts from the member's opening balance, so
  // the OPENING row itself must not add its amount a second time.
  let running = member.openingBalance;
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
