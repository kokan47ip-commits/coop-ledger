/**
 * Bill income reaches every statement (bun:test).
 *
 * Guards the report-path resolution of the receivable control and bill
 * postings:
 *  - a profile setting mis-pointed at a bank/cash account must not swallow
 *    the bills (reports read the same ledger the POSTING path writes to),
 *  - a chart with no receivable ledger still shows bill income — the Dr side
 *    lands on a labelled Suspense row so every column foots,
 *  - a charge line whose account was deleted still keeps the member's
 *    receivable charge visible, with the unpostable part on Suspense.
 *
 * Run with `bun test tests/`.
 */
import { describe, expect, test } from "bun:test";
import {
  computeBalanceSheet,
  computeIncomeExpenditure,
  computeTrialBalance,
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

const FROM = "2026-04-01";
const TO = "2026-06-30";

/** A society with two generated bills totalling 800 of Maintenance income. */
const societyWithBills = () =>
  ({
    accounts: [
      acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
      acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
      acct("susp", "liability", { name: "Opening Balance Suspense", openingBalance: 1000 }),
      acct("maint", "income", { name: "Maintenance Contributions" }),
      acct("ioe", "liability", { name: "Income over Expenses" }),
    ],
    accountGroups: [],
    members: [
      { _id: "m1", _creationTime: 0, societyId: "s1", code: "01", name: "M1", isActive: true, openingBalance: 0 },
    ],
    vouchers: [],
    bills: [
      // Normal generated monthly bill.
      {
        _id: "b1", _creationTime: 0, societyId: "s1", memberId: "m1", billNo: "BILL-1",
        period: "2026-04", issueDate: "2026-04-01", dueDate: "2026-04-10",
        total: 500, paidAmount: 0, status: "unpaid",
        lines: [{ name: "Maintenance", tariffId: "t1", accountId: "maint", amount: 500 }],
      },
      // Supplementary bill (SB series).
      {
        _id: "b2", _creationTime: 0, societyId: "s1", memberId: "m1", billNo: "SB-1",
        period: "2026-04", issueDate: "2026-04-15", dueDate: "2026-04-20",
        total: 300, paidAmount: 0, status: "unpaid", billKind: "supplementary",
        lines: [{ name: "Corpus Fund", accountId: "maint", amount: 300 }],
      },
    ],
    society: {
      _id: "s1",
      fyStartMonth: 4,
      fyStartDate: "2026-04-01",
      receivableAccountId: undefined as string | undefined,
    },
    tariffs: [],
  });

function expectColumnsFoot(tb: Awaited<ReturnType<typeof computeTrialBalance>>) {
  const sum = (k: "openingDr" | "openingCr" | "periodDr" | "periodCr" | "closingDr" | "closingCr") =>
    tb.reduce((s, r) => s + r[k], 0);
  expect(sum("openingDr")).toBe(sum("openingCr"));
  expect(sum("periodDr")).toBe(sum("periodCr"));
  expect(sum("closingDr")).toBe(sum("closingCr"));
}

describe("Generated bills reach I&E, Trial Balance and the Balance Sheet", () => {
  test("normal configuration: bill income flows into all three statements", async () => {
    const data = societyWithBills() as unknown as SocietyData;

    const ie = computeIncomeExpenditure(data, FROM, TO);
    expect(ie.totalIncome).toBe(800); // both bills, monthly + supplementary

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
    const maint = tb.find((r) => r.accountId === "maint")!;
    expect(maint.periodCr).toBe(800);

    const bs = computeBalanceSheet(data, TO);
    const pl = bs.liabilities.find((r) => r.name === "Income over Expenses");
    expect(pl?.amount).toBe(800); // surplus carries the billed income
  });

  test("profile receivableAccountId mis-pointed at the BANK: bills still show, cash untouched", async () => {
    const base = societyWithBills();
    base.society.receivableAccountId = "bank";
    const data = base as unknown as SocietyData;

    // Reports must read the same ledger the POSTING path writes to (the
    // proper receivable), so bill income cannot vanish from any statement.
    const ie = computeIncomeExpenditure(data, FROM, TO);
    expect(ie.totalIncome).toBe(800);

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
    // The charges land on the real receivable ledger — never on the bank.
    expect(tb.find((r) => r.accountId === "recv")!.periodDr).toBe(800);
    expect(tb.find((r) => r.accountId === "bank")!.periodDr).toBe(0);
    expect(tb.find((r) => r.accountId === "bank")!.periodCr).toBe(0);

    const bs = computeBalanceSheet(data, TO);
    expect(bs.liabilities.find((r) => r.name === "Income over Expenses")?.amount).toBe(800);
  });

  test("chart with NO receivable ledger: income still shows, Suspense carries the debits", async () => {
    const base = societyWithBills();
    base.accounts = base.accounts.filter((a) => a._id !== "recv");
    const data = base as unknown as SocietyData;

    const ie = computeIncomeExpenditure(data, FROM, TO);
    expect(ie.totalIncome).toBe(800); // the bug: bills were invisible here

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb); // the labelled Suspense row completes every column
    const suspense = tb.find(
      (r) => r.system === true && r.name.includes("no ledger posting"),
    );
    expect(suspense?.periodDr).toBe(800);

    const bs = computeBalanceSheet(data, TO);
    expect(bs.liabilities.find((r) => r.name === "Income over Expenses")?.amount).toBe(800);
  });

  test("charge line whose account was deleted: valid income shows, receivable charge survives on Suspense", async () => {
    const base = societyWithBills();
    base.bills[0]!.lines[0]!.accountId = "ghost"; // account no longer in the chart
    const data = base as unknown as SocietyData;

    // Only the surviving bill's head can be named — but nothing may be lost
    // silently: the receivable keeps the member's full charge.
    const ie = computeIncomeExpenditure(data, FROM, TO);
    expect(ie.totalIncome).toBe(300);

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
    expect(tb.find((r) => r.accountId === "recv")!.periodDr).toBe(800); // 500 + 300
    const suspense = tb.find((r) => r.system === true && r.name.includes("Suspense"));
    expect(suspense?.periodCr).toBe(500); // the unpostable 500

    const bs = computeBalanceSheet(data, TO);
    expect(bs.liabilities.find((r) => r.name === "Income over Expenses")?.amount).toBe(300);
  });
});
