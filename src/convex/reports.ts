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

export type TrialBalanceRow = {
  accountId: Id<"accounts">;
  /** User-defined printing serial no. for statement order. */
  printNo?: string;
  code: string;
  name: string;
  type: Doc<"accounts">["type"];
  debit: number;
  credit: number;
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
  const [accounts, members, vouchers, bills, society, tariffs] =
    await Promise.all([
      ctx.db
        .query("accounts")
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
  return { accounts, members, vouchers, bills, society, tariffs };
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
    for (const b of data.bills) {
      entries.push({
        date: b.issueDate,
        voucherNo: b.billNo,
        type: "bill",
        memberId: b.memberId,
        narration: `Bill ${b.period}`,
        lines: [
          { accountId: receivableId, debit: b.total, credit: 0, note: `Period ${b.period}` },
          // The carried opening-balance line is part of the receivable debit
          // itself (it predates the system), so it is not credited anywhere.
          ...b.lines
            .filter((l) => l.accountId !== receivableId)
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

function memberLabel(data: SocietyData, memberId: Id<"members"> | null | undefined) {
  if (!memberId) return null;
  const m = data.members.find((x) => x._id === memberId);
  return m ? `${m.name} (${m.code})` : null;
}

/** Trial balance within a date range (account openings sit outside the range). */
export async function computeTrialBalance(
  data: SocietyData,
  fromDate: string,
  toDate: string,
) {
  const { accounts } = data;
  const movement = new Map<Id<"accounts">, { debit: number; credit: number }>();
  for (const a of accounts) movement.set(a._id, { debit: 0, credit: 0 });
  for (const e of unifiedEntries(data)) {
    if (e.date < fromDate || e.date > toDate) continue;
    for (const l of e.lines) {
      const m = movement.get(l.accountId);
      if (m) {
        m.debit += l.debit;
        m.credit += l.credit;
      }
    }
  }
  const rows: TrialBalanceRow[] = [];
  for (const a of accounts) {
    const m = movement.get(a._id)!;
    const openingNet =
      a.type === "asset" || a.type === "expense"
        ? a.openingBalance
        : -a.openingBalance;
    const net = openingNet + m.debit - m.credit;
    const hasActivity =
      m.debit !== 0 || m.credit !== 0 || a.openingBalance !== 0;
    if (!hasActivity) continue;
    rows.push({
      accountId: a._id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
      printNo: a.printNo,
    });
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
      debit:
        b.lines.length > 0
          ? chargeLines.reduce((s, l) => s + l.amount, 0)
          : b.total,
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

export function computeIncomeExpenditure(
  data: SocietyData,
  fromDate: string,
  toDate: string,
) {
  const { accounts } = data;
  const income: TrialBalanceRow[] = [];
  const expenditure: TrialBalanceRow[] = [];
  let totalIncome = 0;
  let totalExpenditure = 0;
  const entries = unifiedEntries(data).filter(
    (e) => e.date >= fromDate && e.date <= toDate,
  );
  for (const a of accounts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    const isIncome = a.type === "income";
    // net: credit-positive for income, debit-positive for expense
    let net = isIncome ? a.openingBalance : a.openingBalance;
    let activity = a.openingBalance !== 0;
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.accountId !== a._id) continue;
        const delta = l.credit - l.debit;
        net += isIncome ? delta : -delta;
        if (l.debit !== 0 || l.credit !== 0) activity = true;
      }
    }
    if (!activity) continue;
    if (isIncome) {
      income.push({
        accountId: a._id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: 0,
        credit: net,
        printNo: a.printNo,
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
      });
      totalExpenditure += net;
    }
  }
  // Print order: serial-numbered ledgers first (numeric), then by code.
  income.sort(byPrintOrder);
  expenditure.sort(byPrintOrder);
  const surplus = totalIncome - totalExpenditure;
  return { income, expenditure, totalIncome, totalExpenditure, surplus };
}

export function computeBalanceSheet(data: SocietyData, toDate: string) {
  const { accounts } = data;
  type Side = {
    code: string;
    name: string;
    amount: number;
    type: Doc<"accounts">["type"];
    /** User-defined printing serial no. for statement order. */
    printNo?: string;
  };
  const assets: Side[] = [];
  const liabilities: Side[] = [];
  const entries = unifiedEntries(data).filter((e) => e.date <= toDate);
  for (const a of accounts) {
    if (a.type !== "asset" && a.type !== "liability") continue;
    let net = a.openingBalance;
    let activity = a.openingBalance !== 0;
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.accountId !== a._id) continue;
        const delta = l.debit - l.credit;
        net += a.type === "asset" ? delta : -delta;
        if (l.debit !== 0 || l.credit !== 0) activity = true;
      }
    }
    if (!activity) continue;
    const row = {
      code: a.code,
      name: a.name,
      amount: Math.abs(net),
      type: a.type,
      printNo: a.printNo,
    };
    if (a.type === "asset") assets.push(row);
    else liabilities.push(row);
  }
  const ie = computeIncomeExpenditure(
    data,
    fyStartDateString(data.society?.fyStartMonth ?? 4, toDate),
    toDate,
  );
  if (ie.surplus !== 0) {
    liabilities.push({
      code: "",
      name: ie.surplus >= 0 ? "Surplus for the year" : "Deficit for the year",
      amount: Math.abs(ie.surplus),
      type: "liability",
    });
  }
  // Print order: serial-numbered ledgers first (numeric), then by code.
  assets.sort(byPrintOrder);
  liabilities.sort(byPrintOrder);
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  return { assets, liabilities, totalAssets, totalLiabilities };
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

  return bankAccounts.map((bank) => {
    let opening = bank.openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    let balance = bank.openingBalance;
    const rows: CashBookRow[] = [];

    for (const e of entries) {
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
}
