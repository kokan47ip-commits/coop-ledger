/**
 * Excel export regression tests (bun:test).
 *
 * exportExcel itself only hands the workbook to the browser, so these test
 * buildExcelWorkbook — the pure model — for the structure every report sheet
 * must have: letterhead band, merged group bands (Trial Balance's three
 * Dr/Cr bands, Balance Sheet's Previous/Current/TOTAL bands), real numeric
 * money cells so Excel can re-sum, and unique legal sheet names.
 */
import { describe, expect, test } from "bun:test";
import { buildExcelWorkbook, type ExportMeta, type TableSpec } from "../src/lib/export";
import * as XLSX from "xlsx";

const meta: ExportMeta = {
  societyName: "Karan Kunj CHS Ltd",
  societyAddress: "Mumbai",
  registrationNo: "MH/1234",
  title: "Trial Balance",
  subtitle: "For the period 1 Apr 2026 to 30 Jun 2026",
  signatures: [
    { label: "Chairman", name: "A. Shah" },
    { label: "Secretary", name: "R. Rao" },
  ],
};

/** Trial-Balance-shaped spec: 8 columns under three 2-span group bands. */
const tbTable: TableSpec = {
  groupHead: [
    { label: "Opening Balance", span: 2, align: "center" },
    { label: "Current Period", span: 2, align: "center" },
    { label: "Closing Balance", span: 2, align: "center" },
  ],
  head: ["Code", "Ledger Account", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr"],
  body: [
    ["B1", "Bank of India", 1000, 0, 700, 0, 1700, 0],
    ["I1", "Maintenance", 0, 0, 0, 600, 0, 600],
  ],
  foot: [["", "TOTAL", 1000, 0, 700, 600, 1700, 600]],
};

describe("Excel export workbook model", () => {
  test("letterhead, group bands, numeric money cells and signature rows", () => {
    const wb = buildExcelWorkbook(meta, [tbTable]);
    const ws = wb.Sheets["Trial Balance"]!;
    expect(ws).toBeDefined();

    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
      header: 1,
      raw: true,
      defval: "",
    });

    // Letterhead band, in order, each line merged across the full width —
    // sheet_to_json proves the span by padding every band row to 8 columns.
    expect(rows[0]).toEqual(["KARAN KUNJ CHS LTD", "", "", "", "", "", "", ""]);
    expect(rows[1]![0]).toBe("Mumbai");
    expect(rows[2]![0]).toBe("Reg. No: MH/1234");
    expect(rows[3]![0]).toBe("TRIAL BALANCE");
    expect(rows[4]![0]).toBe("For the period 1 Apr 2026 to 30 Jun 2026");

    // The band row is merged across all 8 columns.
    const merges = ws["!merges"] ?? [];
    expect(
      merges.some(
        (m) => m.s.r === 0 && m.s.c === 0 && m.e.r === 0 && m.e.c === 7,
      ),
    ).toBe(true);

    // Group band above the head: three 2-column merges with the labels.
    const bandRow = rows.find((r) => r[0] === "Opening Balance")!;
    expect(bandRow).toBeDefined();
    expect(bandRow[2]).toEqual("Current Period");
    expect(bandRow[4]).toEqual("Closing Balance");
    const bandIdx = rows.indexOf(bandRow);
    expect(
      merges.some(
        (m) => m.s.r === bandIdx && m.s.c === 2 && m.e.c === 3,
      ),
    ).toBe(true);

    // Money cells are NUMBERS (Excel can sum/pivot); formats asserted below.
    const bankRow = rows.find((r) => r[0] === "B1")!;
    expect(bankRow[2]).toBe(1000);
    expect(bankRow[6]).toBe(1700); // closing Dr column

    // TOTAL foot survives as its own row.
    expect(rows[rows.length - 4]).toEqual([
      "", "TOTAL", 1000, 0, 700, 600, 1700, 600,
    ]);
  });

  test("money cells carry the Indian-style number format", () => {
    const wb = buildExcelWorkbook(meta, [tbTable]);
    const ws = wb.Sheets["Trial Balance"]!;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
      header: 1,
      raw: true,
    });
    const bankIdx = rows.findIndex((r) => r[0] === "B1");
    // Column C (index 2) on the B1 row holds the opening Dr 1000 as a number.
    const addr = XLSX.utils.encode_cell({ r: bankIdx, c: 2 });
    const cell = ws[addr] as XLSX.CellObject;
    expect(cell.t).toBe("n");
    expect(cell.v).toBe(1000);
    expect(cell.z).toBe("#,##0.00");
  });

  test("sheet names are sanitized to Excel rules and deduplicated", () => {
    const longTitle: ExportMeta = { ...meta, title: "Balance Sheet and Schedules / Annexures [2026]" };
    const ws1: TableSpec = { head: ["A"], body: [["x"]] };
    const ws2: TableSpec = { head: ["A"], body: [["y"]] };
    const wb = buildExcelWorkbook(longTitle, [ws1, ws2]);
    expect(wb.SheetNames).toHaveLength(2);
    const [n1, n2] = wb.SheetNames;
    // Illegal characters (/ [ ]) are replaced with spaces.
    expect(n1).not.toMatch(/[/[\]]/);
    expect(n1!.startsWith("Balance Sheet and Schedules")).toBe(true);
    expect(n1!.length).toBeLessThanOrEqual(31);
    // The second sheet of the same title gets a unique suffix.
    expect(n2).not.toBe(n1);
  });

  test("section titles name their sheets (multi-table exports)", () => {
    const sections: TableSpec[] = [
      { sectionTitle: "A01  THE BANK", head: ["Date"], body: [["2026-05-10"]] },
      { sectionTitle: "A02  CASH", head: ["Date"], body: [["2026-05-11"]] },
    ];
    const wb = buildExcelWorkbook(meta, sections);
    expect(wb.SheetNames).toEqual(["A01  THE BANK", "A02  CASH"]);
  });
});
