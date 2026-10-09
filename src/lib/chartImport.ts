/**
 * Import-back parser for the Chart of Accounts round-trip.
 *
 * The Chart of Accounts page exports `chart-of-accounts.xlsx`
 * (ChartOfAccounts.exportChart): a "Chart of Accounts" sheet — letterhead
 * band above a 7-column table (Code, Account, Section, Group, Role, Opening,
 * Print No.), then a "Groups" sheet with 4 columns (Code, Group, Section,
 * Accounts). The office may edit that workbook and upload it back — renaming
 * ledgers, re-filing accounts under groups, changing opening balances,
 * print numbers, roles, or adding rows.
 *
 * Pure model: matrix in → typed change set out. No DOM, no server.
 */
import type { Id } from "@/convex/_generated/dataModel";
import * as XLSX from "xlsx";

/** Section labels exactly as the export prints them. */
export const SECTION_BY_LABEL: Record<string, "asset" | "liability" | "income" | "expense"> = {
  Assets: "asset",
  "Liabilities & Funds": "liability",
  Income: "income",
  Expenses: "expense",
};

export type ChartSection = "asset" | "liability" | "income" | "expense";

export function sectionFromLabel(raw: unknown): ChartSection | null {
  return SECTION_BY_LABEL[String(raw ?? "").trim()] ?? null;
}

/** Role wording exactly as the export prints it; also tolerate blank = none. */
const ROLE_BY_LABEL: Record<string, "bank_cash" | "receivable"> = {
  "Bank / Cash": "bank_cash",
  "Receivable control": "receivable",
};

export type ChartAccount = {
  code: string;
  name: string;
  section: ChartSection;
  /** Export's "CODE — Name" label, or "" when ungrouped. */
  group: string;
  kind: "bank_cash" | "receivable" | undefined;
  openingBalance: number;
  printNo: string;
};

export type ChartGroup = {
  code: string;
  name: string;
  section: ChartSection;
};

export type SheetMatrix = (string | number)[][];

const cell = (r: SheetMatrix[number] | undefined, i: number) =>
  String(r?.[i] ?? "").trim();

const cellNum = (r: SheetMatrix[number] | undefined, i: number) => {
  const v = r?.[i];
  if (typeof v === "number") return v;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  // Indian accounting writes credit balances in parentheses: (500.00) → −500.
  const negative = /^\(.*\)$/.test(raw);
  const digits = raw.replace(/[^0-9.-]/g, "");
  const n = Number(negative ? digits.replace(/-/g, "") : digits);
  const value = Number.isFinite(n) ? n : 0;
  return negative ? -value : value;
};

/** Footer / signature rows the export appends below the tables. */
const isSkippedRow = (r: SheetMatrix[number] | undefined) => {
  if (!r) return true;
  const c0 = cell(r, 0);
  const c1 = cell(r, 1);
  return (
    /^total/i.test(c1) || /^total/i.test(c0) || /^chairman$/i.test(c0) ||
    /^secretary$/i.test(c0) || /^treasurer$/i.test(c0) ||
    (c0 !== "" && c1 === "" && !c0.startsWith("Code"))
  );
};

/**
 * The header row is the first row whose first cell is "Code" — the export
 * always places the tables after the letterhead band, and "Code" appears
 * nowhere in the banner.
 */
function headerIndexOf(matrix: SheetMatrix): number {
  return matrix.findIndex((r) => String(r?.[0] ?? "").trim() === "Code");
}

function parseSheet<T>(
  matrix: SheetMatrix,
  mapRow: (r: SheetMatrix[number] | undefined, cols: Record<string, number>) => T | null,
): { rows: T[]; skipped: number; error?: string } {
  const h = headerIndexOf(matrix);
  if (h === -1)
    return {
      rows: [],
      skipped: 0,
      error: "Table not found — upload the chart-of-accounts.xlsx exported by this page.",
    };
  const cols: Record<string, number> = {};
  (matrix[h] ?? []).forEach((c, i) => {
    cols[String(c ?? "").trim()] = i;
  });
  const rows: T[] = [];
  let skipped = 0;
  for (const r of matrix.slice(h + 1)) {
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
    if (isSkippedRow(r)) continue;
    const row = mapRow(r, cols);
    if (row) rows.push(row);
    else skipped++;
  }
  // Skipped = non-blank, non-footer rows the parser could not read — every
  // one is a ledger the office meant to import but the model dropped.
  return { rows, skipped };
}

export function parseChartWorkbook(wb: XLSX.WorkBook): {
  accountsSheet: ReturnType<typeof parseAccountsWorkbook>;
  groupsSheet: ReturnType<typeof parseGroupsWorkbook>;
} {
  // The export names its sheets by sectionTitle: "Accounts" and "Groups".
  // Tolerate case and stray edits while preferring the exact names.
  const accountsName =
    wb.SheetNames.find((n) => /^accounts$/i.test(n.trim())) ??
    wb.SheetNames[0] ??
    "";
  const groupsName =
    wb.SheetNames.find((n) => /^groups$/i.test(n.trim())) ??
    wb.SheetNames[1] ??
    "";
  const read = (name: string): SheetMatrix =>
    name && wb.Sheets[name]
      ? XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: true, defval: "" })
      : [];
  return {
    accountsSheet: parseAccountsWorkbook(read(accountsName)),
    groupsSheet: parseGroupsWorkbook(read(groupsName)),
  };
}

export type AccountsSheetParse = {
  accounts: ChartAccount[];
  /** Non-blank rows below the header that could not be read (bad section label, etc.). */
  skipped: number;
  error?: string;
};

function parseAccountsWorkbook(matrix: SheetMatrix): AccountsSheetParse {
  const res = parseSheet<ChartAccount>(matrix, (row, cols) => {
    const r = row ?? [];
    const code = cell(r, cols["Code"] ?? 0);
    if (!code) return null;
    const section = sectionFromLabel(r[cols["Section"] ?? -1]);
    if (!section) return null; // edited/garbled section label
    return {
      code,
      name: cell(r, cols["Account"] ?? 1),
      section,
      group: cell(r, cols["Group"] ?? 3),
      kind: ROLE_BY_LABEL[cell(r, cols["Role"] ?? 4)] ?? undefined,
      openingBalance: cellNum(r, cols["Opening (₹)"] ?? 5),
      printNo: cell(r, cols["Print No."] ?? 6),
    };
  });
  return { accounts: res.rows, skipped: res.skipped, error: res.error };
}

export type GroupsSheetParse = {
  groups: ChartGroup[];
  skipped: number;
  error?: string;
};

function parseGroupsWorkbook(matrix: SheetMatrix): GroupsSheetParse {
  const res = parseSheet<ChartGroup>(matrix, (row, cols) => {
    const r = row ?? [];
    const code = cell(r, cols["Code"] ?? 0);
    if (!code) return null;
    const section = sectionFromLabel(r[cols["Section"] ?? -1]);
    if (!section) return null;
    return {
      code,
      name: cell(r, cols["Group"] ?? 1),
      section,
    };
  });
  return { groups: res.rows, skipped: res.skipped, error: res.error };
}

/** Everything needed to apply one change. */
export type AccountChange =
  | { kind: "add"; account: ChartAccount }
  | { kind: "update"; account: ChartAccount; id: Id<"accounts"> };

export type GroupChange = { kind: "add"; group: ChartGroup };

export type ChartDiff = {
  accounts: AccountChange[];
  groups: GroupChange[];
  /** Rows the office deleted from the sheet — removed from the book on Apply. */
  deletions: {
    accounts: { id: Id<"accounts">; code: string; name: string }[];
    groups: { id: Id<"accountGroups">; code: string; name: string }[];
  };
  /** "CODE — Name" labels referenced by imported accounts but resolvable nowhere. */
  unknownGroupLabels: string[];
  warnings: string[];
};

const normCode = (s: string) => s.trim().toLowerCase();

/**
 * The export joins group labels as "CODE — Name" with an em-dash, but the
 * office may re-type the label with Excel's autocorrected hyphen-minus.
 * Split on either, so the leading code survives both.
 */
const GROUP_LABEL_SPLIT = /\s*[—-]\s*/;

/** Leading group code from an export-style label: "CA — X", "CA - X", "CA". */
export function groupCodeFromLabel(label: string): string {
  const head = label.split(GROUP_LABEL_SPLIT)[0]?.trim() ?? "";
  return head;
}

/**
 * Diff the parsed sheets against the live chart. Accounts match by code:
 * existing → update (sheet is truth), unknown → add. Only NEW group codes
 * from the Groups sheet are change rows (updates to existing groups are no-ops
 * by design — a group rename here would re-label statement printouts based on
 * a spreadsheet, which the office can do on the page itself).
 */
export function diffChart(
  accounts: ChartAccount[],
  groups: ChartGroup[],
  current: {
    accounts: { _id: Id<"accounts">; code: string; name: string }[];
    groups: { _id: Id<"accountGroups">; code: string; name: string }[];
  },
): ChartDiff {
  const warnings: string[] = [];
  const currentAccountsByCode = new Map(
    current.accounts.map((a) => [normCode(a.code), a._id] as const),
  );
  const currentGroupCodes = new Set(current.groups.map((g) => normCode(g.code)));

  const groupAdds = groups.filter((g) => !currentGroupCodes.has(normCode(g.code)));

  // Duplicate account codes in one sheet are contradictory rows; keep the
  // first, warn about the rest instead of applying last-write-wins silently.
  const dedupedAccounts: ChartAccount[] = [];
  const seenCodes = new Set<string>();
  let duplicateRows = 0;
  for (const a of accounts) {
    const key = normCode(a.code);
    if (seenCodes.has(key)) {
      duplicateRows++;
      continue;
    }
    seenCodes.add(key);
    dedupedAccounts.push(a);
  }
  if (duplicateRows > 0) {
    warnings.push(
      `${duplicateRows} duplicate account code${duplicateRows > 1 ? "s" : ""} in the sheet were ignored — only the first row of each code applies.`,
    );
  }

  const unknownGroupLabels = new Set<string>();
  const accountChanges: AccountChange[] = dedupedAccounts.map((a) => {
    const existingId = currentAccountsByCode.get(normCode(a.code));
    if (existingId) return { kind: "update", account: a, id: existingId };
    return { kind: "add", account: a };
  });

  // Account → group mapping is resolved at apply-time from (a) an exact code
  // match, (b) a Groups-sheet add. Anything else flags for the preview.
  for (const a of dedupedAccounts) {
    const label = a.group.trim();
    if (!label || label === "—") continue;
    const code = groupCodeFromLabel(label);
    if (!code) {
      unknownGroupLabels.add(label);
      continue;
    }
    if (!currentGroupCodes.has(normCode(code)) && !groupAdds.some((g) => normCode(g.code) === normCode(code))) {
      unknownGroupLabels.add(label);
    }
  }
  if (unknownGroupLabels.size > 0) {
    warnings.push(
      `${unknownGroupLabels.size} group${unknownGroupLabels.size > 1 ? "s" : ""} referenced in the sheet are neither in the book nor in the Groups sheet — those accounts will import without a group.`,
    );
  }
  // Deleted rows: everything in the book the sheet no longer carries. Groups
  // a sheet account still references are preserved even when their own Groups
  // row was dropped — deleting them would orphan those accounts.
  const sheetAccountCodes = new Set(dedupedAccounts.map((a) => normCode(a.code)));
  const deletions = {
    accounts: current.accounts
      .filter((a) => !sheetAccountCodes.has(normCode(a.code)))
      .map((a) => ({ id: a._id, code: a.code, name: a.name })),
    groups: current.groups
      .filter(
        (g) =>
          !groups.some((s) => normCode(s.code) === normCode(g.code)) &&
          !dedupedAccounts.some(
            (a) =>
              !!a.group.trim() &&
              normCode(groupCodeFromLabel(a.group)) === normCode(g.code),
          ),
      )
      .map((g) => ({ id: g._id, code: g.code, name: g.name })),
  };

  return {
    accounts: accountChanges,
    groups: groupAdds.map((g) => ({ kind: "add" as const, group: g })),
    deletions,
    unknownGroupLabels: [...unknownGroupLabels],
    warnings,
  };
}
