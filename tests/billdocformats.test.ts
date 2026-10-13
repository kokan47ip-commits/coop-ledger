import { describe, expect, test } from "bun:test";
import { BILL_DOC_FORMATS, footerNotesFor } from "../src/lib/billDoc";

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
  test("exposes exactly the four supported format keys", () => {
    expect(BILL_DOC_FORMATS.map((f) => f.key).sort()).toEqual(
      ["classic", "ledger", "modern", "slip"].sort(),
    );
  });

  test("every entry carries a label and a non-empty description", () => {
    for (const f of BILL_DOC_FORMATS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
    }
  });
});
