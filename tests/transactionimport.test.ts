/**
 * Transaction Import preview-model tests (bun:test, run with `bun test tests/`).
 *
 * Pins the grid's display contract against the save rules in
 * uploads.uploadTransactions:
 *  • Cash/Bank shows the resolved society account NAME (bank or "Cash"),
 *    never the sheet's code; a blank cell shows the default bank/cash
 *    account the row will save to; an unmatched code keeps the raw text and
 *    flags the row.
 *  • Bank Name shows the member's bank exactly as uploaded, blank when the
 *    sheet has none — the system never overwrites it.
 *  • Ledger Name still resolves from the system for member receipts.
 *
 * Not part of the vite build (tsconfig.app includes only src/); run via bun.
 */
import { describe, expect, test } from "bun:test";
import { buildRowsOut, resolveKeys, validateRows } from "../src/lib/transactionImport";

type Acct = {
  _id: string;
  _creationTime: number;
  societyId: string;
  kind: string;
  code: string;
  name: string;
};
type Mem = {
  _id: string;
  _creationTime: number;
  societyId: string;
  name: string;
  code: string;
  wing?: string;
  flatNo?: string;
  isActive: boolean;
};

// List order matters: the first bank_cash account is the save-time default.
const accounts: Acct[] = [
  { _id: "a_cash", _creationTime: 1, societyId: "s1", kind: "bank_cash", code: "C1", name: "Cash" },
  { _id: "a_bank", _creationTime: 2, societyId: "s1", kind: "bank_cash", code: "B1", name: "HDFC Current" },
  { _id: "a_rec", _creationTime: 3, societyId: "s1", kind: "receivable", code: "R1", name: "Members Receivable" },
];
const members: Mem[] = [
  { _id: "m1", _creationTime: 1, societyId: "s1", name: "Ravi Kumar", code: "A-101", wing: "A", flatNo: "101", isActive: true },
];

const HEADERS = [
  "Date",
  "Voucher Type",
  "Ledger Code",
  "Ledger Name",
  "Amount",
  "Cash/Bank",
  "Bank Name",
];
const resolved = resolveKeys(HEADERS);

const row = (over: Record<string, unknown>) => ({
  Date: "01/04/2026",
  "Voucher Type": "Receipt",
  "Ledger Code": "A-101",
  "Ledger Name": "whatever the sheet says",
  Amount: 1000,
  ...over,
});

const cellsFor = (over: Record<string, unknown>) =>
  buildRowsOut([row(over)], resolved, accounts as never, members as never, "receipt")[0];

describe("Transaction Import — Cash/Bank column shows the account name", () => {
  test("a bank code resolves to the society bank's NAME, not the code", () => {
    const r = cellsFor({ "Cash/Bank": "b1" });
    expect(r.cells[6]).toBe("HDFC Current");
    expect(r.problems).toEqual([]);
  });

  test("the cash account code shows as Cash", () => {
    const r = cellsFor({ "Cash/Bank": "C1" });
    expect(r.cells[6]).toBe("Cash");
    expect(r.problems).toEqual([]);
  });

  test("a blank Cash/Bank cell shows the default (first) bank/cash account", () => {
    const r = cellsFor({});
    expect(r.cells[6]).toBe("Cash");
    expect(r.problems).toEqual([]);
  });

  test("an unmatched code keeps the raw text and flags the row", () => {
    const r = cellsFor({ "Cash/Bank": "ZZ9" });
    expect(r.cells[6]).toBe("ZZ9");
    expect(r.problems).toContain("Bank");
  });

  test("a full account name in the Cash/Bank cell also resolves (legacy sheets)", () => {
    const r = cellsFor({ "Cash/Bank": "HDFC Current" });
    expect(r.cells[6]).toBe("HDFC Current");
    expect(r.problems).toEqual([]);
  });
});

describe("Transaction Import — Bank Name column is the member's bank, as uploaded", () => {
  test("the member's bank text is shown untouched, not the society account", () => {
    const r = cellsFor({ "Cash/Bank": "B1", "Bank Name": "State Bank of India" });
    expect(r.cells[10]).toBe("State Bank of India");
    expect(r.cells[6]).toBe("HDFC Current"); // society account stays in Cash/Bank
  });

  test("blank in the sheet stays blank in the grid", () => {
    const r = cellsFor({ "Cash/Bank": "B1" });
    expect(r.cells[10]).toBe("");
  });

  test("the Bank Name text never leaks into Cash/Bank and vice versa", () => {
    const r = cellsFor({ "Cash/Bank": "", "Bank Name": "ICICI" });
    // Blank Cash/Bank saves against the default account; the member's bank
    // stays in its own column.
    expect(r.cells[6]).toBe("Cash");
    expect(r.cells[10]).toBe("ICICI");
  });
});

describe("Transaction Import — ledger resolution is unchanged", () => {
  test("receipts show the system member name for the flat code", () => {
    const r = cellsFor({ "Cash/Bank": "B1" });
    expect(r.cells[4]).toBe("Ravi Kumar");
    expect(r.cells[3]).toBe("A-101");
  });

  test("resolveKeys maps the Cash/Bank and Bank Name headers independently", () => {
    expect(resolved["Cash/Bank"]).toBe("Cash/Bank");
    expect(resolved["Bank Name"]).toBe("Bank Name");
  });
});

describe("Transaction Import — financial-year gate (FY flag + validateRows)", () => {
  const fy = { from: "2026-04-01", to: "2027-03-31" };

  test("a date outside the financial year flags the row (FY)", () => {
    const r = buildRowsOut(
      [row({ Date: "05/04/2025", "Cash/Bank": "B1" })],
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    )[0];
    expect(r.problems).toContain("FY");
  });

  test("dates inside the financial year pass", () => {
    const r = buildRowsOut(
      [row({ Date: "05/04/2026", "Cash/Bank": "B1" })],
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    )[0];
    expect(r.problems).not.toContain("FY");
  });

  test("validateRows is silent for a fully valid sheet", () => {
    const rows = buildRowsOut(
      [row({ "Cash/Bank": "B1" })],
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    );
    expect(validateRows(rows, fy)).toEqual([]);
  });

  test("validateRows reports one readable message per bad row", () => {
    const rows = buildRowsOut(
      [
        row({ Date: "05/04/2025", "Cash/Bank": "B1" }),
        row({ Date: "not-a-date", "Cash/Bank": "B1" }),
      ],
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    );
    const errs = validateRows(rows, fy);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain(
      "Row 2: date 05/04/2025 is outside the financial year (2026-04-01 to 2027-03-31)",
    );
    expect(errs[1]).toContain("Row 3: date missing or unreadable");
  });

  test("validateRows flags unknown members, ledgers and bank codes", () => {
    const rows = buildRowsOut(
      [
        row({ "Ledger Code": "ZZ-999", "Cash/Bank": "B1" }),
        row({ "Ledger Code": "A-101", "Cash/Bank": "BAD", Amount: 500 }),
      ],
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    );
    const errs = validateRows(rows, fy);
    expect(errs.length).toBe(2);
    expect(errs[0]).toContain("no member matches flat no/code");
    expect(errs[1]).toContain('no bank/cash account matches "BAD"');
  });

  test("zero and negative amounts are flagged", () => {
    const r = buildRowsOut(
      [row({ Amount: 0, "Cash/Bank": "B1" })],
      resolved,
      accounts as never,
      members as never,
      "receipt",
    )[0];
    expect(r.problems).toContain("Amount");
  });
});

describe("Transaction Import — journal contra gate (mirrors the backend refusal)", () => {
  const fy = { from: "2026-04-01", to: "2027-03-31" };
  const journalRows = (over: Record<string, unknown>[]) =>
    buildRowsOut(
      over.map((o) =>
        row({ "Voucher Type": "Journal", "Ledger Code": "R1", "Ledger Name": "Members Receivable", ...o }),
      ),
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    );

  test("a journal with a bank/cash code in Cash/Bank resolves the contra and is valid", () => {
    const [r] = journalRows([{ "Cash/Bank": "B1" }]);
    expect(r.problems).toEqual([]);
    expect(r.cells[6]).toBe("HDFC Current");
    expect(validateRows([r], fy)).toEqual([]);
  });

  test("a journal with only a Bank Name still finds the contra ledger", () => {
    const [r] = journalRows([{ "Cash/Bank": "", "Bank Name": "HDFC Current" }]);
    expect(r.problems).toEqual([]);
    expect(r.cells[6]).toBe("HDFC Current");
  });

  test("a journal with any non-bank ledger in Cash/Bank resolves it as contra", () => {
    const [r] = journalRows([{ "Cash/Bank": "R1" }]);
    expect(r.problems).toEqual([]);
    expect(r.cells[6]).toBe("Members Receivable");
  });

  test("a journal with no contra anywhere is blocked with the backend's message", () => {
    const [r] = journalRows([{ "Cash/Bank": "", "Bank Name": "" }]);
    expect(r.problems).toContain("ContraLedger");
    const errs = validateRows([r], fy);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(
      "journal needs a contra ledger in the Cash/Bank or Bank Name column",
    );
  });

  test("contra rows are blocked with the backend's exact refusal", () => {
    const [r] = buildRowsOut(
      [row({ "Voucher Type": "Contra", "Ledger Code": "B1", "Cash/Bank": "B1" })],
      resolved,
      accounts as never,
      members as never,
      "receipt",
      fy,
    );
    expect(r.problems).toContain("Contra");
    const errs = validateRows([r], fy);
    expect(errs[0]).toContain(
      "contra entries are not supported — record them as Journal",
    );
  });
});
