import { describe, expect, test } from "bun:test";
import {
  BILL_DOC_FORMATS,
  buildMemberLedgerRows,
  footerNotesFor,
} from "../src/lib/billDoc";

describe("footerNotesFor — printed payment notes beside the bill QR", () => {
  test("custom note lines replace the standard wording, trimmed, blanks dropped", () => {
    const notes = footerNotesFor({
      qrNote: "  PLEASE PAY BY UPI  \n\nCHEQUES IN FAVOUR OF ABC CHS\n",
      lateFeePercent: 1.5,
    });
    expect(notes).toEqual(["PLEASE PAY BY UPI", "CHEQUES IN FAVOUR OF ABC CHS"]);
  });

  test("no custom note falls back to the standard wording incl. the saved late-fee rate", () => {
    const notes = footerNotesFor({ lateFeePercent: 1.5 });
    expect(notes[0]).toContain("CHEQUE");
    expect(notes[2]).toContain("1.5% P.M.");
  });

  test("whitespace-only note still falls back to the standard wording", () => {
    expect(footerNotesFor({ qrNote: "   \n \n" })).toEqual(footerNotesFor({}));
  });

  test("undefined qrNote behaves identically to a blank one", () => {
    expect(footerNotesFor({ qrNote: undefined, lateFeePercent: 1 })).toEqual(
      footerNotesFor({ lateFeePercent: 1 }),
    );
  });
});

describe("BILL_DOC_FORMATS — society-profile format picker contract", () => {
  test("exposes exactly the five supported format keys", () => {
    expect(BILL_DOC_FORMATS.map((f) => f.key).sort()).toEqual(
      ["classic", "ledger", "ledgercol", "modern", "slip"].sort(),
    );
  });

  test("every entry carries a label and a non-empty description", () => {
    for (const f of BILL_DOC_FORMATS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
    }
  });
});

describe("buildMemberLedgerRows — side-ledger running column", () => {
  test("bills debit, receipts credit, balance runs; an opening row leads when set", () => {
    const rows = buildMemberLedgerRows(
      [
        { kind: "bill", date: "2026-07-01", ref: "BILL-0002", amount: 2000 },
        { kind: "receipt", date: "2026-04-10", ref: "MR-0001", amount: 5000 },
        { kind: "bill", date: "2026-04-01", ref: "BILL-0001", amount: 5000 },
      ],
      100,
    );
    expect(rows[0]).toMatchObject({ ref: "OPENING", debit: 100, balance: 100 });
    // Sorted by date with bills before receipts on the same day
    expect(rows[1]).toMatchObject({ ref: "BILL-0001", debit: 5000, credit: 0, balance: 5100 });
    expect(rows[2]).toMatchObject({ ref: "MR-0001", credit: 5000, debit: 0, balance: 100 });
    expect(rows[3]).toMatchObject({ ref: "BILL-0002", debit: 2000, balance: 2100 });
  });

  test("ledger closes at Total Due when the bill itself is the last entry (upTo)", () => {
    const rows = buildMemberLedgerRows(
      [
        { kind: "bill", date: "2026-04-01", ref: "BILL-0001", amount: 3000 },
        { kind: "receipt", date: "2026-04-20", ref: "MR-0001", amount: 3000 },
        { kind: "bill", date: "2026-05-01", ref: "BILL-0002", amount: 3200 },
      ],
      0,
      "2026-05-01",
    );
    // The April receipt (2026-04-20) falls inside the window, settles the
    // April bill, and the May bill closes the column at its own due.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ ref: "MR-0001", credit: 3000, balance: 0 });
    expect(rows[2]).toMatchObject({ ref: "BILL-0002", debit: 3200, balance: 3200 });
  });

  test("no opening balance and no entries yields an empty column (empty-state)", () => {
    expect(buildMemberLedgerRows([], 0)).toEqual([]);
  });

  test("zero-amount entries are dropped and do not disturb the balance", () => {
    const rows = buildMemberLedgerRows(
      [
        { kind: "bill", date: "2026-04-01", ref: "BILL-0001", amount: 1000 },
        { kind: "bill", date: "2026-05-01", ref: "BILL-0002", amount: 0 },
      ],
      0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.balance).toBe(1000);
  });
});
