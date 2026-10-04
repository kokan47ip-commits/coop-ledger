/**
 * Backend report regression tests (bun:test).
 *
 * Guards the Form N / register fixes:
 *  - generated bills (accruals) never appear as Cash/Bank Book rows,
 *  - a credit (negative) receivable is presented as "Advance from Members"
 *    under Current Liabilities instead of netting into the asset side,
 *  - Income & Expenditure rows carry Form N group headings,
 *  - the Balance Sheet exposes fund groups and previous-year comparatives,
 *  - every Chart of Accounts ledger prints on the statements (nil ledgers too),
 *  - member opening balances reach the Trial Balance: the member receivable
 *    control follows the member ledgers, so the TB ties with the Balance Sheet.
 *
 * The compute functions take the loadSocietyData shape; fixtures below use
 * `as any` for Convex document boilerplate that these pure functions never
 * touch. Run with `bun test tests/`.
 */
import { describe, expect, test } from "bun:test";
import {
  computeBalanceSheet,
  computeCashBook,
  computeIncomeExpenditure,
  computeIncomeExpenditureComparative,
  computeMemberBalances,
  computeTrialBalance,
  type SocietyData,
} from "../src/convex/reports";
import { FORM_N_LEDGERS } from "../src/convex/accounts";

const acct = (
  id: string,
  type: string,
  extra: { kind?: string; name?: string; openingBalance?: number } = {},
) => ({
  _id: id,
  _creationTime: 0,
  societyId: "s1",
  code: id.toUpperCase(),
  name: extra.name ?? id,
  type,
  kind: extra.kind,
  openingBalance: extra.openingBalance ?? 0,
});

const member = (id: string, extra: { code?: string; name?: string; wing?: string; flatNo?: string; openingBalance?: number } = {}) => ({
  _id: id,
  _creationTime: 0,
  societyId: "s1",
  code: extra.code ?? "01",
  name: extra.name ?? "Member One",
  wing: extra.wing,
  flatNo: extra.flatNo,
  isActive: true,
  openingBalance: extra.openingBalance ?? 0,
});

/** Legacy fixture shape (single member, code "01"). */
const m1 = member("m1");

const society = { _id: "s1", fyStartMonth: 4 };

describe("Cash/Bank Book register", () => {
  test("generated bills never become register rows", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("cash", "asset", { kind: "bank_cash", name: "Cash in Hand", openingBalance: 500 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 2000 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Dr bank 700 / Cr recv 700
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "m1", bankCashAccountId: "bank", total: 700,
          lines: [
            { accountId: "bank", debit: 700, credit: 0 },
            { accountId: "recv", debit: 0, credit: 700 },
          ],
        },
        // Dr expense 300 / Cr cash 300
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-12", voucherNo: "P1",
          type: "payment", total: 300,
          lines: [
            { accountId: "maint", debit: 300, credit: 0 },
            { accountId: "cash", debit: 0, credit: 300 },
          ],
        },
      ],
      bills: [
        // MISCONFIGURED bill: a charge line mapped straight onto the bank ledger
        // (pre-fix this minted a fake 500 deposit row in the register).
        {
          _id: "b1", _creationTime: 0, societyId: "s1", billNo: "BILL-1", memberId: "m1",
          period: "May,2026", issueDate: "2026-05-01", dueDate: "2026-05-10", total: 500,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "bank", name: "Maintenance", amount: 500 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const sections = computeCashBook(data, "2026-04-01", "2026-06-30");
    const bank = sections.find((s) => s.accountId === "bank")!;
    const cash = sections.find((s) => s.accountId === "cash")!;

    expect(sections.length).toBe(2);
    expect(bank.rows.map((r) => r.voucherNo)).toEqual(["R1"]); // BILL-1 absent
    expect(bank.opening).toBe(1000);
    expect(bank.closing).toBe(1700); // 1000 + 700 receipt only
    expect(cash.closing).toBe(200); // 500 - 300 payment
  });
});

describe("Form N: Income & Expenditure", () => {
  test("rows carry Form N group headings and the period result", () => {
    const data = {
      accounts: [
        acct("maint", "income", { name: "Maintenance Contributions" }),
        acct("interest", "income", { name: "Interest on Sinking Fund Investment" }),
        acct("repair", "expense", { name: "Repairs and Maintenance" }),
        acct("misc", "expense", { name: "Miscellaneous Fund Expense" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", total: 600,
          lines: [
            { accountId: "maint", debit: 0, credit: 600 },
            { accountId: "bank", debit: 600, credit: 0 },
          ],
        },
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-12", voucherNo: "R2",
          type: "other_receipt", total: 50,
          lines: [
            { accountId: "interest", debit: 0, credit: 50 },
            { accountId: "bank", debit: 50, credit: 0 },
          ],
        },
        {
          _id: "v3", _creationTime: 0, societyId: "s1", date: "2026-05-20", voucherNo: "P1",
          type: "payment", total: 200,
          lines: [
            { accountId: "repair", debit: 200, credit: 0 },
            { accountId: "bank", debit: 0, credit: 200 },
          ],
        },
        {
          _id: "v4", _creationTime: 0, societyId: "s1", date: "2026-05-21", voucherNo: "P2",
          type: "payment", total: 40,
          lines: [
            { accountId: "misc", debit: 40, credit: 0 },
            { accountId: "bank", debit: 0, credit: 40 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const ie = computeIncomeExpenditure(data, "2026-04-01", "2026-06-30");
    expect(ie.income.map((r) => r.group)).toEqual([
      "Contributions and Other Receipts",
      "Interest and Other Income",
    ]);
    // Ledger rows only — the system balancing account appended last carries
    // no group heading of its own.
    expect(ie.expenditure.filter((r) => !r.system).map((r) => r.group)).toEqual([
      "Repairs, Maintenance and Establishment Expenses",
      "Other Operating Expenses",
    ]);
    expect(ie.totalIncome).toBe(650);
    expect(ie.totalExpenditure).toBe(240);
    expect(ie.surplus).toBe(410);
    // Surplus: the SYSTEM account "Income over Expenses" balances the
    // expenditure side so both sides of the statement foot to the same total.
    const sys = ie.expenditure.find((r) => r.system)!;
    expect(sys.name).toBe("Income over Expenses");
    expect(sys.debit).toBe(410);
    expect(ie.income.some((r) => r.system)).toBe(false);
    expect(ie.totalExpenditure + sys.debit).toBe(ie.totalIncome);
  });

  test("deficit shows the system account on the income side", () => {
    const data = {
      accounts: [
        acct("interest", "income", { name: "Interest on Sinking Fund Investment" }),
        acct("repair", "expense", { name: "Repairs and Maintenance" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "other_receipt", total: 50,
          lines: [
            { accountId: "interest", debit: 0, credit: 50 },
            { accountId: "bank", debit: 50, credit: 0 },
          ],
        },
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-20", voucherNo: "P1",
          type: "payment", total: 200,
          lines: [
            { accountId: "repair", debit: 200, credit: 0 },
            { accountId: "bank", debit: 0, credit: 200 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const ie = computeIncomeExpenditure(data, "2026-04-01", "2026-06-30");
    expect(ie.surplus).toBe(-150);
    // Deficit: "Expenses over Income" sits on the income side and balances it.
    const sys = ie.income.find((r) => r.system)!;
    expect(sys.name).toBe("Expenses over Income");
    expect(sys.credit).toBe(150);
    expect(ie.expenditure.some((r) => r.system)).toBe(false);
    expect(ie.totalIncome + sys.credit).toBe(ie.totalExpenditure);
    expect(ie.income.filter((r) => !r.system).map((r) => r.name)).toEqual([
      "Interest on Sinking Fund Investment",
    ]);
  });
});

describe("Form N: Income & Expenditure — previous-year comparative", () => {
  test("rows carry the prior-year figure; both columns foot like-for-like", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India" }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
        acct("interest", "income", { name: "Interest on Sinking Fund Investment" }),
        acct("repair", "expense", { name: "Repairs and Maintenance" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Prior FY: maintenance 500, interest 50 (interest only exists last
        // year), repairs 100.
        {
          _id: "p1", _creationTime: 0, societyId: "s1", date: "2025-05-10", voucherNo: "R0",
          type: "other_receipt", total: 500,
          lines: [
            { accountId: "maint", debit: 0, credit: 500 },
            { accountId: "bank", debit: 500, credit: 0 },
          ],
        },
        {
          _id: "p2", _creationTime: 0, societyId: "s1", date: "2025-06-01", voucherNo: "R0B",
          type: "other_receipt", total: 50,
          lines: [
            { accountId: "interest", debit: 0, credit: 50 },
            { accountId: "bank", debit: 50, credit: 0 },
          ],
        },
        {
          _id: "p3", _creationTime: 0, societyId: "s1", date: "2025-05-20", voucherNo: "P0",
          type: "payment", total: 100,
          lines: [
            { accountId: "repair", debit: 100, credit: 0 },
            { accountId: "bank", debit: 0, credit: 100 },
          ],
        },
        // Current FY: maintenance 600, repairs 200.
        {
          _id: "c1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "other_receipt", total: 600,
          lines: [
            { accountId: "maint", debit: 0, credit: 600 },
            { accountId: "bank", debit: 600, credit: 0 },
          ],
        },
        {
          _id: "c2", _creationTime: 0, societyId: "s1", date: "2026-05-20", voucherNo: "P1",
          type: "payment", total: 200,
          lines: [
            { accountId: "repair", debit: 200, credit: 0 },
            { accountId: "bank", debit: 0, credit: 200 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const ie = computeIncomeExpenditureComparative(data, "2026-04-01", "2026-06-30");
    const maint = ie.income.find((r) => r.name === "Maintenance Contributions")!;
    const interest = ie.income.find((r) => r.name === "Interest on Sinking Fund Investment")!;
    const repair = ie.expenditure.find((r) => r.name === "Repairs and Maintenance")!;

    // Each ledger pairs this year's figure with last year's on the same side.
    expect(maint).toMatchObject({ credit: 600, prev: 500 });
    expect(repair).toMatchObject({ debit: 200, prev: 100 });
    // A ledger active only last year still shows, with a nil current figure.
    expect(interest).toMatchObject({ credit: 0, prev: 50 });
    // Headings keep statute order for the comparative too.
    expect(ie.income.filter((r) => !r.system).map((r) => r.name)).toEqual([
      "Maintenance Contributions",
      "Interest on Sinking Fund Investment",
    ]);

    expect(ie.totalIncome).toBe(600);
    expect(ie.prevTotalIncome).toBe(550);
    expect(ie.totalExpenditure).toBe(200);
    expect(ie.prevTotalExpenditure).toBe(100);
    expect(ie.surplus).toBe(400);
    expect(ie.prevSurplus).toBe(450);

    // The balancing row carries the prior-year result too, so both columns
    // foot to the same total: 600 = 200 + 400 and 550 = 100 + 450.
    const sys = ie.expenditure.find((r) => r.system)!;
    expect(sys.name).toBe("Income over Expenses");
    expect(sys.debit).toBe(400);
    expect(sys.prev).toBe(450);
    expect(ie.totalExpenditure + sys.debit).toBe(ie.totalIncome);
    expect(ie.prevTotalExpenditure + sys.prev).toBe(ie.prevTotalIncome);
  });
});

describe("Form N: Balance Sheet", () => {
  test("credit receivable is presented as Advance from Members (liability)", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 0 }),
      ],
      accountGroups: [],
      members: [{ ...m1, openingBalance: -800 }], // member paid 800 ahead before the system
      vouchers: [
        // Dr bank 500 / Cr recv 500 — the 800 credit carried line plus the
        // 500 receipt leaves the member 1300 in advance.
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "m1", bankCashAccountId: "bank", total: 500,
          lines: [
            { accountId: "bank", debit: 500, credit: 0 },
            { accountId: "recv", debit: 0, credit: 500 },
          ],
        },
      ],
      bills: [
        {
          _id: "b1", _creationTime: 0, societyId: "s1", billNo: "BILL-1", memberId: "m1",
          period: "May,2026", issueDate: "2026-05-01", dueDate: "2026-05-10", total: -800,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "recv", name: "Credit balance — advance adjusted", amount: -800 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");

    // The receivable itself must NOT appear on the asset side (member dues
    // are zero), and the GL/member figures reconcile with no unadjusted row.
    expect(bs.assets.map((r) => r.name)).toEqual(["Bank of India"]);
    expect(bs.assets[0]!.amount).toBe(1500);

    const advance = bs.liabilities.find((r) => r.name === "Advance from Members");
    expect(advance).toBeDefined();
    // Member-level: opening −800 (paid ahead), no charge lines, 500 received
    // → 1300 advance. Same figure the GL receivable nets to, so no
    // "Members Receivable (unadjusted)" row appears.
    // Member advances are presented per member, not through the GL control
    // ledger, and there is no "unadjusted" residual row.
    expect(advance!.amount).toBe(1300);
    expect(advance!.group).toBe("VII. Current Liabilities and Provisions");
    expect(bs.liabilities.find((r) => r.name === "Members Receivable (unadjusted)")).toBeUndefined();
    expect(bs.assets.find((r) => r.name === "Members Receivable (unadjusted)")).toBeUndefined();
    expect(bs.totalAssets).toBe(1500);
    expect(bs.totalLiabilities).toBe(1300);

    // Comparative column: every posting is inside the current FY, so the
    // previous-year cut-off (day before FY start) sees the bank opening and
    // the member's carried advance opening (800 held last year).
    expect(bs.totalAssetsPrev).toBe(1000);
    expect(bs.totalLiabilitiesPrev).toBe(800);
  });

  test("surplus lands under its own Form N heading with fund ordering", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 500 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 0 }),
        acct("sink", "liability", { name: "Sinking Fund", openingBalance: 500 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Dr bank 100 / Cr recv 100 — collected from the member.
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "m1", bankCashAccountId: "bank", total: 100,
          lines: [
            { accountId: "bank", debit: 100, credit: 0 },
            { accountId: "recv", debit: 0, credit: 100 },
          ],
        },
      ],
      bills: [
        // Dr recv 100 / Cr maintenance income 100 — the bill that earned it.
        // (Posting receipts straight to income would leave the member ledger
        // and the GL receivable telling different stories; books stay
        // consistent only when income accrues through the bill.)
        {
          _id: "b1", _creationTime: 0, societyId: "s1", billNo: "BILL-1", memberId: "m1",
          period: "May,2026", issueDate: "2026-05-01", dueDate: "2026-05-10", total: 100,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "maint", name: "Maintenance", amount: 100 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    // The member was billed 100 and paid 100 — nothing due, no Dues row; the
    // income stays in the books as "Income over Expenses" (surplus) and bank
    // holds the cash.
    expect(bs.assets.map((r) => r.name)).toEqual(["Bank of India"]);
    expect(bs.assets[0]!.amount).toBe(600); // 500 opening + 100 receipt

    expect(bs.liabilities.map((r) => r.name)).toEqual(["Sinking Fund", "Income over Expenses"]);
    expect(bs.liabilities[0]!.group).toBe("II. Reserve Funds and Other Funds");
    expect(bs.liabilities[1]!.group).toBe("XI. Profit and Loss Account");
    expect(bs.liabilities[1]!.amount).toBe(100); // bill income minus no expenditure
    // Balanced books: 500 openings + 100 surplus on both sides.
    expect(bs.totalLiabilities).toBe(600);
    expect(bs.totalAssets).toBe(600);
  });

  test("deficit lands on the ASSETS side so the sheet still ties", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("sink", "liability", { name: "Sinking Fund", openingBalance: 1000 }),
        acct("interest", "income", { name: "Interest on Sinking Fund Investment" }),
        acct("repair", "expense", { name: "Repairs and Maintenance" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Dr bank 50 / Cr interest 50 — small income.
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "other_receipt", total: 50,
          lines: [
            { accountId: "bank", debit: 50, credit: 0 },
            { accountId: "interest", debit: 0, credit: 50 },
          ],
        },
        // Dr repair 200 / Cr bank 200 — larger expense → 150 deficit.
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-20", voucherNo: "P1",
          type: "payment", total: 200,
          lines: [
            { accountId: "repair", debit: 200, credit: 0 },
            { accountId: "bank", debit: 0, credit: 200 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    // Bank 1000 − 200 + 50 = 850, plus the 150 loss carried as an asset row.
    expect(bs.assets.map((r) => r.name)).toEqual(["Bank of India", "Expenses over Income"]);
    expect(bs.assets[0]!.amount).toBe(850);
    expect(bs.assets[1]!.amount).toBe(150);
    // Form N asset head X — Profit and Loss Account (the loss).
    expect(bs.assets[1]!.group).toBe("X. Profit and Loss Account");
    // It must NOT appear as a liability.
    expect(bs.liabilities.some((r) => r.name === "Expenses over Income")).toBe(false);
    expect(bs.liabilities.map((r) => r.name)).toEqual(["Sinking Fund"]);
    // Both sides tie: 850 + 150 = 1000.
    expect(bs.totalAssets).toBe(1000);
    expect(bs.totalLiabilities).toBe(1000);
  });

  test("member dues and advances are shown GROSS, never netted", () => {
    // Member A owes 500 (billed 800, received 300); member B paid 400 with
    // nothing due. Netting would show a single 100 debtor and hide both the
    // 500 dues and the 400 advance — the books must show each separately.
    const mA = member("mA", { code: "02", name: "Member A", wing: "A", flatNo: "101" });
    const mB = member("mB", { code: "03", name: "Member B", wing: "B", flatNo: "102" });
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India" }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [mA, mB],
      vouchers: [
        // Dr bank 300 / Cr recv 300 (member A)
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "mA", bankCashAccountId: "bank", total: 300,
          lines: [
            { accountId: "bank", debit: 300, credit: 0 },
            { accountId: "recv", debit: 0, credit: 300 },
          ],
        },
        // Dr bank 400 / Cr recv 400 (member B, nothing due → advance)
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-12", voucherNo: "R2",
          type: "member_receipt", memberId: "mB", bankCashAccountId: "bank", total: 400,
          lines: [
            { accountId: "bank", debit: 400, credit: 0 },
            { accountId: "recv", debit: 0, credit: 400 },
          ],
        },
      ],
      bills: [
        // Dr recv 800 / Cr maintenance income 800 (member A)
        {
          _id: "b1", _creationTime: 0, societyId: "s1", billNo: "BILL-1", memberId: "mA",
          period: "2026-05", issueDate: "2026-05-01", dueDate: "2026-05-10", total: 800,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "maint", name: "Maintenance", amount: 800 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    const debtors = bs.assets.find((r) => r.name === "Dues from Members");
    const advance = bs.liabilities.find((r) => r.name === "Advance from Members");

    // Gross on both sides — NOT the netted 100.
    expect(debtors!.amount).toBe(500);
    expect(advance!.amount).toBe(400);
    expect(advance!.group).toBe("VII. Current Liabilities and Provisions");
    // GL receivable (800 billed − 700 received = 100) exactly explains the
    // member split (500 − 400), so no unadjusted reconciliation row appears.
    expect(bs.liabilities.find((r) => r.name === "Members Receivable (unadjusted)")).toBeUndefined();
    expect(bs.assets.find((r) => r.name === "Members Receivable (unadjusted)")).toBeUndefined();

    // The principle keeps the sheet balanced: bank 700 + dues 500 = advance
    // 400 + bill income surplus 800.
    expect(bs.totalAssets).toBe(1200);
    expect(bs.totalLiabilities).toBe(1200);
  });

  test("accounts file under the Roman-numbered statutory Form N heads, in order", () => {
    const data = {
      accounts: [
        acct("share", "liability", { name: "Share Capital", openingBalance: 1000 }),
        acct("reserve", "liability", { name: "Statutory Reserve Fund", openingBalance: 500 }),
        acct("pf", "liability", { name: "Staff Provident Fund", openingBalance: 200 }),
        acct("secured", "liability", { name: "Secured Loan from Bank", openingBalance: 300 }),
        acct("unsecured", "liability", { name: "Unsecured Loan from Members", openingBalance: 400 }),
        acct("deposit", "liability", { name: "Fixed Deposit from Members", openingBalance: 150 }),
        acct("creditor", "liability", { name: "Sundry Creditors", openingBalance: 250 }),
        acct("intacc", "liability", { name: "Interest Accrued but Not Paid", openingBalance: 50 }),
        acct("other", "liability", { name: "Miscellaneous Liability", openingBalance: 100 }),
        acct("cash", "asset", { kind: "bank_cash", name: "Cash in Hand", openingBalance: 500 }),
        acct("inv", "asset", { name: "Sinking Fund Investment", openingBalance: 800 }),
        acct("pfinv", "asset", { name: "Staff Provident Fund Investment", openingBalance: 200 }),
        acct("loan", "asset", { name: "Loan to Member", openingBalance: 300 }),
        acct("furn", "asset", { name: "Furniture and Fixtures", openingBalance: 150 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    const liGroups = [...new Set(bs.liabilities.map((r) => r.group))];
    const aGroups = [...new Set(bs.assets.map((r) => r.group))];

    // Liabilities print under the prescribed heads, in statute order. Head
    // VIII (Unpaid Dividends) simply has no balance here and is skipped.
    expect(liGroups).toEqual([
      "I. Share Capital",
      "II. Reserve Funds and Other Funds",
      "III. Staff Provident Fund",
      "IV. Secured Loans",
      "V. Unsecured Loans",
      "VI. Deposits",
      "VII. Current Liabilities and Provisions",
      "IX. Interest Accrued but Not Paid",
      "X. Other Liabilities",
    ]);
    // Assets print under the prescribed heads, in statute order.
    expect(aGroups).toEqual([
      "I. Cash and Bank Balances",
      "II. Investments",
      "III. Staff Provident Fund",
      "IV. Loans and Advances",
      "VII. Fixed Assets",
    ]);
    // No stray free-form "Assets" bucket remains.
    expect(bs.assets.some((r) => r.group === "Assets")).toBe(false);

    // Opening/closing comparative: each row carries its previous-year figure
    // (the day before the FY opened — i.e. last year's closing = this year's
    // opening) alongside the current one. With no entries, prev = opening.
    expect(bs.liabilities.find((r) => r.group === "I. Share Capital")!.prev).toBe(1000);
    expect(
      bs.liabilities.find((r) => r.group === "VII. Current Liabilities and Provisions")!.prev,
    ).toBe(250);
    expect(bs.assets.find((r) => r.group === "II. Investments")!.prev).toBe(800);
    expect(bs.assets.find((r) => r.group === "I. Cash and Bank Balances")!.prev).toBe(500);
  });

  test("GL controls for Dues / Advance / Income-over-Expenses are excluded from the sheet", () => {
    // A society that created the system ledgers (Chart of Accounts) and posted
    // to them: the statements still derive those figures from the member
    // ledgers / I&E, so the GL control balances must NOT print again.
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 350 }),
        acct("dues", "asset", { kind: "receivable", name: "Dues from Members", openingBalance: 200 }),
        acct("adv", "liability", { name: "Advance from Members", openingBalance: 75 }),
        acct("ioe", "liability", { name: "Income over Expenses", openingBalance: 40 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    // Receivable-kind controls (Members Receivable AND the Dues ledger) never
    // print as asset rows; the member arithmetic (0 dues here) decides.
    expect(bs.assets.map((r) => r.name)).toEqual(["Bank of India"]);
    expect(bs.assets.find((r) => r.name === "Dues from Members")).toBeUndefined();
    // GL Advance / Income-over-Expenses balances are excluded as well.
    expect(bs.liabilities.map((r) => r.name)).toEqual([]);
    expect(bs.totalAssets).toBe(1000);
    expect(bs.totalLiabilities).toBe(0);
    // The seed definitions used by the Chart of Accounts stay in sync.
    expect(FORM_N_LEDGERS.map((l) => l.name)).toEqual([
      "Dues from Members",
      "Advance from Members",
      "Income over Expenses",
    ]);
  });
});

describe("Trial Balance (three columns)", () => {
  test("opening / current / closing with Dr and Cr, and bank excludes generated bills", async () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("cash", "asset", { kind: "bank_cash", name: "Cash in Hand", openingBalance: 500 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 2000 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Dr bank 700 / Cr recv 700
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "m1", bankCashAccountId: "bank", total: 700,
          lines: [
            { accountId: "bank", debit: 700, credit: 0 },
            { accountId: "recv", debit: 0, credit: 700 },
          ],
        },
        // Dr maint (mis-mapped head) 300 / Cr cash 300
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-12", voucherNo: "P1",
          type: "payment", total: 300,
          lines: [
            { accountId: "maint", debit: 300, credit: 0 },
            { accountId: "cash", debit: 0, credit: 300 },
          ],
        },
      ],
      bills: [
        // MISCONFIGURED bill: charge line mapped straight onto the bank ledger.
        {
          _id: "b1", _creationTime: 0, societyId: "s1", billNo: "BILL-1", memberId: "m1",
          period: "May,2026", issueDate: "2026-05-01", dueDate: "2026-05-10", total: 500,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "bank", name: "Maintenance", amount: 500 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, "2026-04-01", "2026-06-30");
    const row = (id: string) => tb.find((r) => r.accountId === id)!;

    // Bank: the mis-mapped bill line never touches the ledger — the TB closing
    // (1700) now agrees with the Bank Book (opening 1000 + 700 receipt).
    expect(row("bank")).toMatchObject({
      openingDr: 1000, openingCr: 0,
      periodDr: 700, periodCr: 0,
      closingDr: 1700, closingCr: 0,
    });
    // Receivable: opening 2000, bill total 500 Dr, receipt 700 Cr → 1800 Dr.
    expect(row("recv")).toMatchObject({
      openingDr: 2000, openingCr: 0,
      periodDr: 500, periodCr: 700,
      closingDr: 1800, closingCr: 0,
    });
    // Cash: 500 opening − 300 payment = 200 Dr.
    expect(row("cash")!.closingDr).toBe(200);
    // Income head debited by the payment shows on the Dr side.
    expect(row("maint")).toMatchObject({
      openingDr: 0, openingCr: 0,
      periodDr: 300, periodCr: 0,
      closingDr: 300, closingCr: 0,
    });

    // The Balance Sheet bank figure agrees with the TB and the Bank Book.
    const bs = computeBalanceSheet(data, "2026-06-30");
    expect(bs.assets.find((r) => r.name === "Bank of India")!.amount).toBe(1700);
  });
});

describe("Member dues & advance lists", () => {
  test("date-wise per-member position: dues, advance and neither", () => {
    const mA = member("mA", { code: "02", name: "Member A", wing: "A", flatNo: "101", openingBalance: 200 });
    const mB = member("mB", { code: "03", name: "Member B", wing: "B", flatNo: "102", openingBalance: 100 });
    const mC = member("mC", { code: "04", name: "Member C", wing: "C", flatNo: "103" });
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India" }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [mA, mB, mC],
      vouchers: [
        // Member A receives 300 against 800 billed → 700 due (incl. 200 opening).
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "mA", bankCashAccountId: "bank", total: 300,
          lines: [
            { accountId: "bank", debit: 300, credit: 0 },
            { accountId: "recv", debit: 0, credit: 300 },
          ],
        },
        // Member B (100 due from opening) receives 400 → 300 in ADVANCE.
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-12", voucherNo: "R2",
          type: "member_receipt", memberId: "mB", bankCashAccountId: "bank", total: 400,
          lines: [
            { accountId: "bank", debit: 400, credit: 0 },
            { accountId: "recv", debit: 0, credit: 400 },
          ],
        },
      ],
      bills: [
        // Pre-period bill for A (belongs in the OPENING column).
        {
          _id: "b0", _creationTime: 0, societyId: "s1", billNo: "BILL-0", memberId: "mA",
          period: "2026-03", issueDate: "2026-03-15", dueDate: "2026-03-25", total: 200,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "recv", name: "Arrears — opening balance", amount: 200 }],
        },
        // In-period bill for A.
        {
          _id: "b1", _creationTime: 0, societyId: "s1", billNo: "BILL-1", memberId: "mA",
          period: "2026-05", issueDate: "2026-05-01", dueDate: "2026-05-10", total: 800,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "maint", name: "Maintenance", amount: 800 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const rows = computeMemberBalances(data, "2026-04-01", "2026-06-30");
    const a = rows.find((r) => r.memberId === "mA")!;
    const b = rows.find((r) => r.memberId === "mB")!;
    const c = rows.find((r) => r.memberId === "mC")!;

    // A: pre-period bill (charge lines only — the carried line restates the
    // opening, it is not debited twice) → opening 200, billed 800, received
    // 300, closing 700 due, last entry 2026-05-10. Flat No., not member no.
    expect(a).toMatchObject({
      flatNo: "A-101", opening: 200, billed: 800, received: 300,
      closing: 700, lastEntryDate: "2026-05-10",
    });
    // B: 100 opening dues, paid 400 → 300 advance held.
    expect(b).toMatchObject({
      flatNo: "B-102", opening: 100, billed: 0, received: 400,
      closing: -300, lastEntryDate: "2026-05-12",
    });
    // C: no movement → in neither list.
    expect(c.closing).toBe(0);

    // The two lists split on the sign of closing and never overlap.
    const dues = rows.filter((r) => r.closing > 0);
    const advances = rows.filter((r) => r.closing < 0);
    expect(dues.map((r) => r.flatNo)).toEqual(["A-101"]);
    expect(advances.map((r) => r.flatNo)).toEqual(["B-102"]);
    expect(dues.reduce((s, r) => s + r.closing, 0)).toBe(700);
    expect(advances.reduce((s, r) => s - r.closing, 0)).toBe(300);
  });
});

describe("Form N: every Chart of Accounts ledger prints (nil ledgers included)", () => {
  test("nil income/expense ledgers print 0.00; totals keep pure ledger sums", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India" }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
        acct("prof", "income", { name: "Professional Fees" }),
        acct("repair", "expense", { name: "Repairs and Maintenance" }),
        acct("audit", "expense", { name: "Audit Fees" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "other_receipt", total: 600,
          lines: [
            { accountId: "maint", debit: 0, credit: 600 },
            { accountId: "bank", debit: 600, credit: 0 },
          ],
        },
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-20", voucherNo: "P1",
          type: "payment", total: 200,
          lines: [
            { accountId: "repair", debit: 200, credit: 0 },
            { accountId: "bank", debit: 0, credit: 200 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const ie = computeIncomeExpenditure(data, "2026-04-01", "2026-06-30");
    const prof = ie.income.find((r) => r.name === "Professional Fees")!;
    const audit = ie.expenditure.find((r) => r.name === "Audit Fees")!;
    // Nil ledgers still print — with 0.00, never dropped from the statement.
    expect(prof).toMatchObject({ credit: 0, debit: 0 });
    expect(audit).toMatchObject({ debit: 0, credit: 0 });
    // Totals remain the pure ledger sums; the system row balances the sides.
    expect(ie.totalIncome).toBe(600);
    expect(ie.totalExpenditure).toBe(200);
    expect(ie.surplus).toBe(400);
    const sys = ie.expenditure.find((r) => r.system)!;
    expect(sys.debit).toBe(400);

    // The comparative prints every ledger too, with the prior-year figure.
    const cmp = computeIncomeExpenditureComparative(data, "2026-04-01", "2026-06-30");
    expect(cmp.income.find((r) => r.name === "Professional Fees")!.prev).toBe(0);
    expect(cmp.expenditure.find((r) => r.name === "Audit Fees")!.prev).toBe(0);
  });

  test("nil asset/liability ledgers still print on the Balance Sheet", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("stock", "asset", { name: "Dead Stock" }),
        acct("sink", "liability", { name: "Sinking Fund", openingBalance: 500 }),
        acct("water", "liability", { name: "Water Charges Payable" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    const stock = bs.assets.find((r) => r.name === "Dead Stock")!;
    const water = bs.liabilities.find((r) => r.name === "Water Charges Payable")!;
    expect(stock).toMatchObject({ amount: 0, prev: 0, group: "VI. Current Assets" });
    expect(water).toMatchObject({
      amount: 0,
      prev: 0,
      group: "VII. Current Liabilities and Provisions",
    });
    // Nil ledgers do not disturb the totals.
    expect(bs.totalAssets).toBe(1000);
    expect(bs.totalLiabilities).toBe(500);
  });

  test("a ledger emptied to zero keeps its prior-year figure on its side", () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 500 }),
        acct("loan", "liability", { name: "Loan from Member", openingBalance: 500 }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Repaid in-period: Dr loan 500 / Cr bank 500.
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "P1",
          type: "payment", total: 500,
          lines: [
            { accountId: "loan", debit: 500, credit: 0 },
            { accountId: "bank", debit: 0, credit: 500 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    const loan = bs.liabilities.find((r) => r.name === "Loan from Member")!;
    const bank = bs.assets.find((r) => r.name === "Bank of India")!;
    // Both emptied to zero this year, yet both still print — and last year's
    // figure stays on its own side (the old sign-flip negated it).
    expect(loan).toMatchObject({ amount: 0, prev: 500 });
    expect(bank).toMatchObject({ amount: 0, prev: 500 });
    expect(bs.totalLiabilitiesPrev).toBe(500);
    expect(bs.totalAssetsPrev).toBe(500);
  });
});

describe("Trial Balance — member opening balances", () => {
  test("member openings reach the opening column and tie with the Balance Sheet", async () => {
    const mA = member("mA", { code: "02", name: "Member A", wing: "A", flatNo: "101", openingBalance: 300 });
    const mB = member("mB", { code: "03", name: "Member B", wing: "B", flatNo: "102", openingBalance: -150 });
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India" }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
        acct("susp", "liability", { name: "Opening Balance Suspense", openingBalance: 150 }),
      ],
      accountGroups: [],
      members: [mA, mB],
      vouchers: [
        // Member A pays 100 against his 300 opening due.
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "mA", bankCashAccountId: "bank", total: 100,
          lines: [
            { accountId: "bank", debit: 100, credit: 0 },
            { accountId: "recv", debit: 0, credit: 100 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, "2026-04-01", "2026-06-30");
    const recv = tb.find((r) => r.accountId === "recv")!;
    // Opening column: 300 due (A) less 150 advance (B) = 150 Dr — the member
    // openings are IN the TB even though no bill has carried them into the
    // GL receivable yet. Period: A's 100 receipt credits the control.
    expect(recv).toMatchObject({
      openingDr: 150, openingCr: 0,
      periodDr: 0, periodCr: 100,
      closingDr: 50, closingCr: 0,
    });
    // The suspense opening keeps the opening column footing Dr = Cr.
    expect(tb.reduce((s, r) => s + r.openingDr, 0)).toBe(150);
    expect(tb.reduce((s, r) => s + r.openingCr, 0)).toBe(150);

    // The TB closing agrees with the Balance Sheet: A owes 200, B holds 150
    // advance — net 50, exactly the receivable control's closing balance.
    const bs = computeBalanceSheet(data, "2026-06-30");
    const dues = bs.assets.find((r) => r.name === "Dues from Members")!.amount;
    const advance = bs.liabilities.find((r) => r.name === "Advance from Members")!.amount;
    expect(dues).toBe(200);
    expect(advance).toBe(150);
    expect(dues - advance).toBe(recv.closingDr - recv.closingCr);
  });

  test("a carried opening bill restates — never doubles — the member opening", async () => {
    const mA = member("mA", { code: "02", name: "Member A", wing: "A", flatNo: "101", openingBalance: 300 });
    const data = {
      accounts: [
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [mA],
      vouchers: [],
      bills: [
        // Pre-period carried bill (the flow bills.ts uses): its receivable
        // line restates the member's opening, it is not a second 300.
        {
          _id: "b0", _creationTime: 0, societyId: "s1", billNo: "BILL-0", memberId: "mA",
          period: "2026-03", issueDate: "2026-03-15", dueDate: "2026-03-25", total: 300,
          paidAmount: 0, status: "unpaid",
          lines: [{ accountId: "recv", name: "Arrears — opening balance", amount: 300 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, "2026-04-01", "2026-06-30");
    const recv = tb.find((r) => r.accountId === "recv")!;
    expect(recv).toMatchObject({
      openingDr: 300, openingCr: 0,
      periodDr: 0, periodCr: 0,
      closingDr: 300, closingCr: 0,
    });
  });

  test("GL-only movements on the control (journals) fold into the member columns", async () => {
    const data = {
      accounts: [
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 50 }),
        acct("susp", "liability", { name: "Opening Balance Suspense", openingBalance: 50 }),
        acct("misc", "income", { name: "Miscellaneous Income" }),
      ],
      accountGroups: [],
      members: [m1],
      vouchers: [
        // Pre-period journal: Dr receivable 10 / Cr misc 10.
        {
          _id: "j0", _creationTime: 0, societyId: "s1", date: "2026-03-20", voucherNo: "J0",
          type: "journal", total: 10,
          lines: [
            { accountId: "recv", debit: 10, credit: 0 },
            { accountId: "misc", debit: 0, credit: 10 },
          ],
        },
        // In-period journal: Dr receivable 200 / Cr misc 200.
        {
          _id: "j1", _creationTime: 0, societyId: "s1", date: "2026-05-05", voucherNo: "J1",
          type: "journal", total: 200,
          lines: [
            { accountId: "recv", debit: 200, credit: 0 },
            { accountId: "misc", debit: 0, credit: 200 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, "2026-04-01", "2026-06-30");
    const recv = tb.find((r) => r.accountId === "recv")!;
    // The control's own opening 50 and the pre-period journal 10 fold into
    // the member column (no member openings here), then the in-period
    // journal debits it — no GL posting on the control may vanish.
    expect(recv).toMatchObject({
      openingDr: 60, openingCr: 0,
      periodDr: 200, periodCr: 0,
      closingDr: 260, closingCr: 0,
    });
    // The statement keeps footing: opening Dr = opening Cr and closing
    // Dr = closing Cr across all rows.
    expect(tb.reduce((s, r) => s + r.openingDr, 0)).toBe(
      tb.reduce((s, r) => s + r.openingCr, 0),
    );
    expect(tb.reduce((s, r) => s + r.closingDr, 0)).toBe(
      tb.reduce((s, r) => s + r.closingCr, 0),
    );
  });
});
