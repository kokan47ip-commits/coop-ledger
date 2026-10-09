/**
 * Trial Balance footing regression tests.
 *
 * The statement promises Dr = Cr under EVERY column group — Opening, Current
 * Period and Closing. Earlier fixtures only proved this for plain vouchers;
 * real societies also have:
 *  - bills carrying a "carried arrears" line (restating the member's opening),
 *  - pre-period journals touching the Income over Expenses result ledger.
 * These used to leave the Current Period and Closing columns out of foot.
 */
import { describe, expect, test } from "bun:test";
import { computeTrialBalance, type SocietyData } from "../src/convex/reports";

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

const member = (id: string, extra: { openingBalance?: number } = {}) => ({
  _id: id,
  _creationTime: 0,
  societyId: "s1",
  code: "01",
  name: "Member One",
  isActive: true,
  openingBalance: extra.openingBalance ?? 0,
});

const society = { _id: "s1", fyStartMonth: 4 };

const FROM = "2026-04-01";
const TO = "2026-06-30";

/** Assert every column group foots: total Dr equals total Cr. */
function expectColumnsFoot(tb: Awaited<ReturnType<typeof computeTrialBalance>>) {
  const sum = (k: "openingDr" | "openingCr" | "periodDr" | "periodCr" | "closingDr" | "closingCr") =>
    Math.round(tb.reduce((s, r) => s + r[k], 0) * 100) / 100;
  expect(sum("openingDr")).toBe(sum("openingCr"));
  expect(sum("periodDr")).toBe(sum("periodCr"));
  expect(sum("closingDr")).toBe(sum("closingCr"));
}

describe("Trial Balance footing with real-world data", () => {
  test("GL-basis control + a bill carrying an arrears line still foots every column", async () => {
    // The society imported its opening onto the Members Receivable control
    // (GL carries the opening), and the May bill re-states 200 of arrears the
    // member already owes — the bill's receivable debit must be the CHARGE
    // only, or the Current Period column runs 200 short on credits.
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 500 }),
        acct("capital", "liability", { name: "Share Capital", openingBalance: 1500 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
        acct("ioe", "liability", { name: "Income over Expenses" }),
      ],
      accountGroups: [],
      members: [member("m1")],
      vouchers: [
        // Dr bank 100 / Cr recv 100
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
        {
          _id: "b1", _creationTime: 0, societyId: "s1", memberId: "m1", billNo: "BILL-1",
          period: "2026-05", issueDate: "2026-05-01", dueDate: "2026-05-10",
          total: 500, paidAmount: 100, status: "partial",
          lines: [
            { name: "Arrears — opening balance", accountId: "recv", amount: 200 },
            { name: "Maintenance", tariffId: "t1", accountId: "maint", amount: 300 },
          ],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
    // The receivable row charges only what the bill actually debits now.
    const recv = tb.find((r) => r.accountId === "recv")!;
    // Bill posts Dr receivable 300 (the CHARGE — the 200 arrears restates
    // the opening the control already carries) / Cr income 300.
    expect(recv.periodDr).toBe(300);
    expect(recv.periodCr).toBe(100);
  });

  test("member-basis control + arrears bill foots every column", async () => {
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
        acct("susp", "liability", { name: "Opening Balance Suspense", openingBalance: 1500 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
        acct("ioe", "liability", { name: "Income over Expenses" }),
      ],
      accountGroups: [],
      members: [member("m1", { openingBalance: 500 })],
      vouchers: [
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
        {
          _id: "b1", _creationTime: 0, societyId: "s1", memberId: "m1", billNo: "BILL-1",
          period: "2026-05", issueDate: "2026-05-01", dueDate: "2026-05-10",
          total: 500, paidAmount: 0, status: "unpaid",
          lines: [
            { name: "Arrears — opening balance", accountId: "recv", amount: 200 },
            { name: "Maintenance", tariffId: "t1", accountId: "maint", amount: 300 },
          ],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
  });

  test("a mis-mapped bill head posts nowhere: receivable keeps the charge, Suspense foots the rest", async () => {
    // Tariff head mapped straight onto the bank ledger. The bill entry must
    // stay balanced (nothing touches cash), the receivable row still shows
    // what the member owes, and a labelled SYSTEM row carries the unmatched
    // credit so Current Period and Closing stay in foot — while the office
    // can SEE the mapping error on the statement.
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("recv", "asset", { kind: "receivable", name: "Members Receivable", openingBalance: 2000 }),
        acct("capital", "liability", { name: "Share Capital", openingBalance: 3000 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
      ],
      accountGroups: [],
      members: [member("m1")],
      vouchers: [],
      bills: [
        {
          _id: "b1", _creationTime: 0, societyId: "s1", memberId: "m1", billNo: "BILL-1",
          period: "2026-05", issueDate: "2026-05-01", dueDate: "2026-05-10",
          total: 500, paidAmount: 0, status: "unpaid",
          lines: [{ name: "Maintenance", tariffId: "t1", accountId: "bank", amount: 500 }],
        },
      ],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
    const recv = tb.find((r) => r.accountId === "recv")!;
    expect(recv.periodDr).toBe(500); // the member's charge is still owed
    const susp = tb.find((r) => r.system === true)!;
    expect(susp.name).toContain("Suspense");
    expect(susp.periodCr).toBe(500);
    // Cash never moved: the bank ledger is untouched by the bill.
    expect(tb.find((r) => r.accountId === "bank")!.periodDr).toBe(0);
  });

  test("pre-period journal on the result ledger: closing still foots", async () => {
    // The office posted closing journals into Income over Expenses BEFORE the
    // period. The row's closing must be built from its true OPENING (typed
    // balance + pre-period postings), not the typed balance alone — otherwise
    // the Closing column ends up out by the pre-period movement.
    const data = {
      accounts: [
        acct("bank", "asset", { kind: "bank_cash", name: "Bank of India", openingBalance: 1000 }),
        acct("ioe", "liability", { name: "Income over Expenses", openingBalance: 40 }),
        acct("capital", "liability", { name: "Share Capital", openingBalance: 960 }),
        acct("maint", "income", { name: "Maintenance Contributions" }),
        acct("repair", "expense", { name: "Repairs and Maintenance" }),
      ],
      accountGroups: [],
      members: [member("m1")],
      vouchers: [
        // Pre-period closing journal: Dr repair 50 / Cr ioe 50.
        {
          _id: "v0", _creationTime: 0, societyId: "s1", date: "2026-03-15", voucherNo: "J0",
          type: "journal", total: 50,
          lines: [
            { accountId: "repair", debit: 50, credit: 0 },
            { accountId: "ioe", debit: 0, credit: 50 },
          ],
        },
        // In-period: income 100.
        {
          _id: "v1", _creationTime: 0, societyId: "s1", date: "2026-05-10", voucherNo: "R1",
          type: "other_receipt", total: 100,
          lines: [
            { accountId: "bank", debit: 100, credit: 0 },
            { accountId: "maint", debit: 0, credit: 100 },
          ],
        },
        // In-period: expense 30.
        {
          _id: "v2", _creationTime: 0, societyId: "s1", date: "2026-05-20", voucherNo: "P1",
          type: "payment", total: 30,
          lines: [
            { accountId: "repair", debit: 30, credit: 0 },
            { accountId: "bank", debit: 0, credit: 30 },
          ],
        },
      ],
      bills: [],
      society,
      tariffs: [],
    } as unknown as SocietyData;

    const tb = await computeTrialBalance(data, FROM, TO);
    expectColumnsFoot(tb);
    // The result ledger's closing carries typed 40 + pre-period 50 + period
    // result 70 = 160 Cr.
    const ioe = tb.find((r) => r.name === "Income over Expenses")!;
    expect(ioe.openingCr).toBe(90);
    expect(ioe.closingCr).toBe(160);
  });
});
