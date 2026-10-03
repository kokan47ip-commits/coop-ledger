/**
 * Backend report regression tests (bun:test).
 *
 * Guards the four Form N / register fixes:
 *  - generated bills (accruals) never appear as Cash/Bank Book rows,
 *  - a credit (negative) receivable is presented as "Advance from Members"
 *    under Current Liabilities instead of netting into the asset side,
 *  - Income & Expenditure rows carry Form N group headings,
 *  - the Balance Sheet exposes fund groups and previous-year comparatives.
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
  type SocietyData,
} from "../src/convex/reports";

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

const member = {
  _id: "m1",
  _creationTime: 0,
  societyId: "s1",
  code: "01",
  name: "Member One",
  isActive: true,
  openingBalance: 0,
};

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
      members: [member],
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
      members: [member],
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
    expect(ie.expenditure.map((r) => r.group)).toEqual([
      "Repairs, Maintenance and Establishment Expenses",
      "Other Operating Expenses",
    ]);
    expect(ie.totalIncome).toBe(650);
    expect(ie.totalExpenditure).toBe(240);
    expect(ie.surplus).toBe(410);
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
      members: [member],
      vouchers: [
        // Dr bank 500 / Cr recv 500 — the 800 credit bill line over-takes it,
        // netting the receivable to a 300 credit (advance held from members).
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

    // The receivable itself must NOT appear on the asset side.
    expect(bs.assets.map((r) => r.name)).toEqual(["Bank of India"]);
    expect(bs.assets[0]!.amount).toBe(1500);

    const advance = bs.liabilities.find((r) => r.name === "Advance from Members");
    expect(advance).toBeDefined();
    // Bill total −800 posts a −800 (credit) to the receivable — the carried
    // credit line IS the total carrier — plus the 500 receipt credit → 1300.
    expect(advance!.amount).toBe(1300);
    expect(advance!.group).toBe("Current Liabilities and Provisions");

    // Comparative column: every posting is inside the current FY, so the
    // previous-year cut-off (day before FY start) sees only the bank opening.
    expect(bs.totalAssetsPrev).toBe(1000);
    expect(bs.totalLiabilitiesPrev).toBe(0);
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
      members: [member],
      vouchers: [
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "member_receipt", memberId: "m1", bankCashAccountId: "bank", total: 100,
          lines: [
            { accountId: "bank", debit: 100, credit: 0 },
            { accountId: "maint", debit: 0, credit: 100 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const bs = computeBalanceSheet(data, "2026-06-30");
    expect(bs.assets.map((r) => r.name)).toEqual(["Bank of India"]);
    expect(bs.assets[0]!.amount).toBe(600); // 500 opening + 100 receipt

    expect(bs.liabilities.map((r) => r.name)).toEqual(["Sinking Fund", "Surplus for the year"]);
    expect(bs.liabilities[0]!.group).toBe("Reserve Funds and Other Funds");
    expect(bs.liabilities[1]!.group).toBe("Surplus / (Deficit)");
    expect(bs.liabilities[1]!.amount).toBe(100); // income minus no expenditure
    // Balanced books: 500 openings + 100 surplus on both sides.
    expect(bs.totalLiabilities).toBe(600);
    expect(bs.totalAssets).toBe(600);
  });
});
