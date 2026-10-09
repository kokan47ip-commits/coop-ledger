/**
 * Chart of Accounts import-back regression tests (bun:test).
 *
 * Round-trip guarantees: export the chart with buildExcelWorkbook (the real
 * builder the page uses), read it back with parseChartWorkbook, and prove
 * that (a) an untouched export round-trips to a no-change diff and (b) office
 * edits (rename, re-balance, new account row, new group) survive as add /
 * update change sets, with footers and signature rows skipped.
 */
import { describe, expect, test } from "bun:test";
import { buildExcelWorkbook, type ExportMeta, type TableSpec } from "../src/lib/export";
import { parseChartWorkbook, diffChart } from "../src/lib/chartImport";
import * as XLSX from "xlsx";

const meta: ExportMeta = {
  societyName: "Karan Kunj CHS Ltd",
  societyAddress: "Mumbai",
  registrationNo: "MH/1234",
  title: "Chart of Accounts",
  signatures: [{ label: "Chairman", name: "A. Shah" }],
};

/** The page's export shape (must match ChartOfAccounts.exportChart). */
const ACCOUNT_HEAD = ["Code", "Account", "Section", "Group", "Role", "Opening (₹)", "Print No."];
const GROUP_HEAD = ["Code", "Group", "Section", "Accounts"];

function exportWorkbook(
  accounts: (string | number)[][],
  groups: (string | number)[][],
): XLSX.WorkBook {
  const accountsTable: TableSpec = { sectionTitle: "Accounts", head: ACCOUNT_HEAD, body: accounts };
  const groupsTable: TableSpec = { sectionTitle: "Groups", head: GROUP_HEAD, body: groups };
  return buildExcelWorkbook(meta, [accountsTable, groupsTable]);
}

const current = {
  accounts: [
    { _id: "a-bank", code: "1020", name: "Bank of India" },
    { _id: "a-maint", code: "3010", name: "Maintenance Charges" },
  ],
  groups: [
    { _id: "g-ca", code: "CA", name: "Current Assets" },
    { _id: "g-inc", code: "INC", name: "Operating Income" },
  ],
};

const BASE_ACCOUNTS: (string | number)[][] = [
  ["1020", "Bank of India", "Assets", "CA — Current Assets", "Bank / Cash", 1000, "1"],
  ["3010", "Maintenance Charges", "Income", "INC — Operating Income", "", 0, "2"],
];
const BASE_GROUPS: (string | number)[][] = [
  ["CA", "Current Assets", "Assets", 1],
  ["INC", "Operating Income", "Income", 1],
];

function parseBase(overrides: {
  accounts?: (string | number)[][];
  groups?: (string | number)[][];
} = {}) {
  const accounts = overrides.accounts ?? BASE_ACCOUNTS;
  const groups = overrides.groups ?? BASE_GROUPS;
  return parseChartWorkbook(exportWorkbook(accounts, groups));
}

describe("chartImport round-trip", () => {
  test("the builder carries both sheets with the exact header labels", () => {
    const wb = exportWorkbook([BASE_ACCOUNTS[0]!], [BASE_GROUPS[0]!]);
    expect(wb.SheetNames).toContain("Accounts");
    expect(wb.SheetNames).toContain("Groups");
    const accountsMatrix = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets["Accounts"]!,
      { header: 1, raw: true, defval: "" },
    );
    expect(accountsMatrix.some((r) => (r ?? []).join("\u0000") === ACCOUNT_HEAD.join("\u0000"))).toBe(true);
  });

  test("untouched export parses to the same chart — accounts and groups", () => {
    const parsed = parseBase();
    expect(parsed.accountsSheet.error).toBeUndefined();
    expect(parsed.groupsSheet.error).toBeUndefined();
    expect(parsed.accountsSheet.accounts).toEqual([
      {
        code: "1020",
        name: "Bank of India",
        section: "asset",
        group: "CA — Current Assets",
        kind: "bank_cash",
        openingBalance: 1000,
        printNo: "1",
      },
      {
        code: "3010",
        name: "Maintenance Charges",
        section: "income",
        group: "INC — Operating Income",
        kind: undefined,
        openingBalance: 0,
        printNo: "2",
      },
    ]);
    expect(parsed.groupsSheet.groups.map((g) => g.code)).toEqual(["CA", "INC"]);
  });

  test("untouched export diffs to zero adds (all updates, no group adds)", () => {
    const parsed = parseBase();
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.accounts).toHaveLength(2);
    expect(diff.accounts.every((a) => a.kind === "update")).toBe(true);
    expect(diff.groups).toHaveLength(0);
    expect(diff.warnings).toHaveLength(0);
  });

  test("untouched export proposes ZERO deletions — the round trip is inert", () => {
    const parsed = parseBase();
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.deletions.accounts).toHaveLength(0);
    expect(diff.deletions.groups).toHaveLength(0);
  });

  test("edits survive: rename + balance, new account row, new group row", () => {
    const parsed = parseBase({
      accounts: [
        ["1020", "HDFC Bank Current A/c", "Assets", "CA — Current Assets", "Bank / Cash", 1500, "1"],
        ["3010", "Maintenance Charges", "Income", "INC — Operating Income", "", 0, "2"],
        ["3050", "Interest on Savings", "Income", "", "", 0, ""],
      ],
      groups: [...BASE_GROUPS, ["EXP", "Indirect Expenses", "Expenses", 0]],
    });
    expect(parsed.accountsSheet.accounts).toHaveLength(3);
    expect(parsed.groupsSheet.groups).toHaveLength(3);
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);

    const added = diff.accounts.filter((a) => a.kind === "add");
    const updated = diff.accounts.filter((a) => a.kind === "update");
    expect(added).toHaveLength(1);
    expect(added[0]!.account.code).toBe("3050");
    expect(added[0]!.account.name).toBe("Interest on Savings");
    expect(added[0]!.account.group).toBe("");

    expect(updated).toHaveLength(2);
    const renamed = updated.find((u) => u.kind === "update" && u.account.code === "1020")!;
    expect(renamed.kind === "update" && renamed.account.name).toBe("HDFC Bank Current A/c");
    expect(renamed.kind === "update" && renamed.account.openingBalance).toBe(1500);

    const groupAdds = diff.groups.filter((g) => g.kind === "add");
    expect(groupAdds).toHaveLength(1);
    expect(groupAdds[0]!.group.code).toBe("EXP");
    expect(groupAdds[0]!.group.name).toBe("Indirect Expenses");
    expect(groupAdds[0]!.group.section).toBe("expense");
  });

  test("TOTAL footer and the signature block are skipped", () => {
    // hand-built matrix that includes foot + separator + signatures.
    const matrix: (string | number)[][] = [
      ["KARAN KUNJ CHS LTD"],
      ["MUMBAI"],
      ["Reg. No: MH/1234"],
      ["CHART OF ACCOUNTS"],
      [],
      ACCOUNT_HEAD,
      ["1020", "Bank of India", "Assets", "CA — Current Assets", "Bank / Cash", 1000, "1"],
      ["", "TOTAL — 1 accounts", "", "", "", 1000, ""],
      [],
      ["A. Shah", "", "", "", "", "", ""],
      ["Chairman", "", "", "", "", "", ""],
    ];
    const accounts = parseChartWorkbook({
      SheetNames: ["Chart of Accounts", "Groups"],
      Sheets: {
        "Chart of Accounts": XLSX.utils.aoa_to_sheet(matrix),
        Groups: XLSX.utils.aoa_to_sheet([GROUP_HEAD]),
      },
    } as unknown as XLSX.WorkBook);
    expect(accounts.accountsSheet.accounts).toHaveLength(1);
    expect(accounts.accountsSheet.accounts[0]!.code).toBe("1020");
  });

  test("a group label with no match anywhere warns and imports groupless", () => {
    const parsed = parseBase({
      accounts: [["1020", "Bank of India", "Assets", "ZZ — Not Anywhere", "Bank / Cash", 1000, "1"]],
      groups: [],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.unknownGroupLabels).toHaveLength(1);
    expect(diff.unknownGroupLabels[0]).toContain("ZZ");
    expect(diff.warnings).toHaveLength(1);
  });

  test("group code match is case-insensitive", () => {
    const parsed = parseBase({
      accounts: [["1020", "Bank of India", "Assets", "ca — current assets", "Bank / Cash", 1000, "1"]],
      groups: [],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.unknownGroupLabels).toHaveLength(0);
  });
});

describe("chartImport hardening (review fixes)", () => {
  test("hyphen-minus separator still resolves the group code (Excel autocorrect)", () => {
    const parsed = parseBase({
      accounts: [["1020", "Bank of India", "Assets", "CA - Current Assets", "Bank / Cash", 1000, "1"]],
      groups: [],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.unknownGroupLabels).toHaveLength(0);
    expect(diff.warnings).toHaveLength(0);
  });

  test("garbled section label is counted in skipped, not dropped silently", () => {
    const parsed = parseBase({
      accounts: [
        ["1020", "Bank of India", "Assets", "CA — Current Assets", "Bank / Cash", 1000, "1"],
        ["3010", "Maintenance Charges", "Liability & Funds", "", "", 0, ""],
      ],
      groups: [],
    });
    expect(parsed.accountsSheet.accounts).toHaveLength(1); // only the healthy row
    expect(parsed.accountsSheet.skipped).toBe(1);
  });

  test("missing Section column: every body row lands in skipped with an empty result", () => {
    const wb = buildExcelWorkbook(meta, [
      {
        sectionTitle: "Accounts",
        head: ["Code", "Account", "Group", "Role", "Opening (₹)", "Print No."],
        body: [["1020", "Bank of India", "CA — Current Assets", "Bank / Cash", 1000, "1"]],
      },
    ]);
    const parsed = parseChartWorkbook(wb);
    expect(parsed.accountsSheet.accounts).toHaveLength(0);
    expect(parsed.accountsSheet.error).toBeUndefined();
    expect(parsed.accountsSheet.skipped).toBe(1);
  });

  test("parenthesized opening balance imports as a NEGATIVE (credit) figure", () => {
    const parsed = parseBase({
      accounts: [["2990", "Advance from Members", "Liabilities & Funds", "", "", "(500.00)", ""]],
      groups: [],
    });
    expect(parsed.accountsSheet.accounts[0]!.openingBalance).toBe(-500);
  });

  test("duplicate code rows: first wins, later rows counted as a warning", () => {
    const parsed = parseBase({
      accounts: [
        ["1020", "Bank A", "Assets", "", "", 100, ""],
        ["1020", "Bank B — should be ignored", "Assets", "", "", 200, ""],
      ],
      groups: [],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.accounts).toHaveLength(1); // second row dropped by the diff
    const updated = diff.accounts[0];
    expect(updated?.kind).toBe("update");
    expect(updated?.kind === "update" && updated.account.name).toBe("Bank A"); // first row
    expect(diff.warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });
});

describe("chartImport deletions", () => {
  test("accounts present in the book but absent from the sheet are deletes with ids", () => {
    // Sheet drops a-maint; keeps a-bank and adds one new code.
    const parsed = parseBase({
      accounts: [
        ["1020", "Bank of India", "Assets", "CA — Current Assets", "Bank / Cash", 1000, "1"],
        ["3050", "Interest on Savings", "Income", "", "", 0, ""],
      ],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.deletions.accounts).toEqual([
      { id: "a-maint", code: "3010", name: "Maintenance Charges" },
    ]);
  });

  test("a group still referenced by a sheet account is NEVER a delete, even when its Groups row is gone", () => {
    const parsed = parseBase({
      accounts: [["1020", "Bank of India", "Assets", "CA — Current Assets", "Bank / Cash", 1000, "1"]],
      groups: [], // office dropped the Groups sheet rows entirely
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.deletions.groups).toHaveLength(1);
    expect(diff.deletions.groups[0]).toEqual({
      id: "g-inc",
      code: "INC",
      name: "Operating Income",
    });
    expect(diff.deletions.groups.some((g) => g.code === "CA")).toBe(false);
  });

  test("a group referenced by NO sheet account (label gone) is a delete", () => {
    const parsed = parseBase({
      accounts: [["1020", "Bank of India", "Assets", "", "", 1000, "1"]],
      groups: [],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    const codes = diff.deletions.groups.map((g) => g.code);
    expect(codes).toContain("CA");
    expect(codes).toContain("INC");
  });

  test("deletions exclude accounts added in this import (new code never in the book)", () => {
    const parsed = parseBase({
      accounts: [["9999", "Brand New Ledger", "Assets", "", "", 0, ""]],
      groups: [],
    });
    const diff = diffChart(parsed.accountsSheet.accounts, parsed.groupsSheet.groups, current);
    expect(diff.accounts.some((c) => c.kind === "add" && c.account.code === "9999")).toBe(true);
    expect(
      diff.deletions.accounts.every((d) => d.code !== "9999"),
    ).toBe(true);
  });
});
