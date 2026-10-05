/**
 * Pure preview model for the Transaction Import grid
 * (src/pages/app/TransactionImport.tsx). Mirrors the save rules in
 * uploads.uploadTransactions so the grid shows what will actually be stored:
 *
 *  • Ledger — receipts treat the code as the member's flat no (code/name
 *    fallbacks); payments treat it as a ledger code; journal tries member
 *    first. The grid shows the system-fetched name.
 *  • Cash/Bank — the cell carries a bank/cash ACCOUNT CODE (a full account
 *    name also matches, for legacy sheets); the sheet's Bank Name text is a
 *    last-resort name hint; an empty cell saves against the society's first
 *    bank/cash account. The grid shows the resolved account's NAME — the
 *    bank's name, or the cash account ("Cash") — never the sheet's code.
 *  • Bank Name — the member's bank, shown exactly as uploaded and blank when
 *    the sheet has none; the system never overwrites it.
 */
import type { Doc } from "@/convex/_generated/dataModel";

export type Row = Record<string, unknown>;

export type PreviewRow = { index: number; cells: string[]; problems: string[] };

/** Normalises a flat code ("B-104-A", "B703", "SHOP 05") for matching. */
export const normFlat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const normKey = (h: string) => h.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** Grid columns in the legacy order, with the header aliases each accepts. */
export const COLS: { label: string; keys: string[]; align?: "right" }[] = [
  { label: "Voucher No.", keys: ["voucherno", "vchno", "srno", "no"] },
  { label: "Date", keys: ["date", "voucherdate"] },
  { label: "Voucher…", keys: ["vouchertype", "vouchers", "voucher"] },
  { label: "Ledger Code", keys: ["ledgercode", "code", "acctcode", "accountcode"] },
  { label: "Ledger Name", keys: ["ledgername", "ledger", "name", "account", "particulars", "party"] },
  { label: "Amount", keys: ["amount", "amt", "value"], align: "right" },
  { label: "Cash/Bank", keys: ["cashbank", "bankcash", "mode", "paidfrom", "receivedin"] },
  { label: "Narration", keys: ["narration", "remarks", "note"] },
  { label: "Cheque No.", keys: ["chequeno", "chqno", "cheque", "reference", "ref"] },
  { label: "Chq. Date", keys: ["chqdate", "chequedate", "chqdt"] },
  { label: "Bank Name", keys: ["bankname", "bank"] },
  { label: "ChqClearDate", keys: ["chqcleardate", "chequecleardate", "cleardate", "chqclear"] },
];

/** Column labels whose absence blocks Import entirely. */
export const REQUIRED_LABELS = ["Date", "Ledger Code", "Ledger Name", "Amount"];

/**
 * Resolves which raw sheet header feeds each grid column. Aliases are tried
 * in order and a header, once claimed by a column, is not reused — so
 * "Voucher No." never steals the "Voucher…" type column and vice versa.
 */
export function resolveKeys(headers: string[]): Record<string, string | undefined> {
  const normalized = headers.map((h) => ({ raw: h, key: normKey(h) }));
  const claimed = new Set<string>();
  const out: Record<string, string | undefined> = {};
  for (const col of COLS) {
    const hit = normalized.find((h) => !claimed.has(h.raw) && col.keys.includes(h.key));
    out[col.label] = hit?.raw;
    if (hit) claimed.add(hit.raw);
  }
  return out;
}

export const toNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isNaN(n) ? undefined : n;
};

/** Legacy display: dd/mm/yyyy, accepting ISO or dd/mm/yyyy input. */
export function displayDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  return s;
}

export function displayAmount(v: unknown): string {
  const n = toNum(v);
  if (n === undefined) return String(v ?? "").trim();
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export const rowKind = (
  typeText: string,
  fallback: "receipt" | "payment" | "journal",
) => {
  const t = (typeText ?? "").toLowerCase();
  if (t.startsWith("receipt")) return "receipt" as const;
  if (t.startsWith("payment") || t.startsWith("pay")) return "payment" as const;
  if (t.startsWith("journal") || t.startsWith("jv")) return "journal" as const;
  return fallback;
};

/**
 * Legacy name-text tolerance: match a bank/cash account by NAME (either may
 * contain the other, so "HDFC" finds "HDFC Current" and vice versa).
 */
export const resolveBankByName = (
  text: string,
  accounts: Doc<"accounts">[] | undefined,
): Doc<"accounts"> | undefined => {
  if (!text || !accounts) return undefined;
  const t = text.toLowerCase();
  return accounts.find(
    (a) =>
      a.kind === "bank_cash" &&
      (a.name.toLowerCase().includes(t) || t.includes(a.name.toLowerCase())),
  );
};

/**
 * Resolves the bank/cash account from the Cash/Bank cell, which carries the
 * ACCOUNT CODE (a full account name also matches). Returns the account,
 * "none" when the cell is blank (the save falls back to the society's first
 * bank/cash account), or undefined when the code is present but matches
 * nothing (bad code — the row is flagged).
 */
export const resolveBank = (
  code: string,
  accounts: Doc<"accounts">[] | undefined,
): Doc<"accounts"> | undefined | "none" => {
  if (!code) return "none"; // no code in the sheet → default applies at save
  if (!accounts) return undefined; // masters not loaded yet
  const byCode = accounts.find(
    (a) => a.kind === "bank_cash" && a.code.toLowerCase() === code.toLowerCase(),
  );
  if (byCode) return byCode;
  return resolveBankByName(code, accounts);
};

/** How the row's ledger resolves, mirroring the backend rules. */
export type LedgerResolution =
  | { kind: "member"; name: string }
  | { kind: "account"; name: string }
  | { kind: "none" };

/**
 * Auto-fetches the ledger name from the system for a row. Receipts: Ledger
 * Code is the member's FLAT NO (wing+flat, member code or name). Payments:
 * Ledger Code is a ledger CODE from Chart of Accounts (member flat as refund
 * fallback). Journal: member first. The sheet's own name text is display-only.
 */
export const resolveLedger = (
  typeText: string,
  code: string,
  name: string,
  accounts: Doc<"accounts">[] | undefined,
  members: Doc<"members">[] | undefined,
  defaultType: "receipt" | "payment" | "journal",
): LedgerResolution => {
  const kind = rowKind(typeText, defaultType);
  const findMember = (): Doc<"members"> | undefined => {
    if (!members) return undefined;
    if (code) {
      const f = normFlat(code);
      const byFlat = members.find(
        (m) =>
          m.flatNo &&
          (normFlat(m.flatNo) === f || normFlat(`${m.wing ?? ""}${m.flatNo}`) === f),
      );
      if (byFlat) return byFlat;
      const byCode = members.find((m) => m.code.toLowerCase() === code.toLowerCase());
      if (byCode) return byCode;
    }
    if (name) return members.find((m) => m.name.toLowerCase() === name.toLowerCase());
    return undefined;
  };
  const findAccount = (): Doc<"accounts"> | undefined => {
    if (!accounts) return undefined;
    if (code) {
      const byCode = accounts.find((a) => a.code.toLowerCase() === code.toLowerCase());
      if (byCode) return byCode;
    }
    if (name) return accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
    return undefined;
  };
  if (kind === "payment") {
    const acct = findAccount();
    if (acct) return { kind: "account", name: acct.name };
    const mem = findMember();
    if (mem) return { kind: "member", name: `${mem.name} (refund)` };
    return { kind: "none" };
  }
  const mem = findMember();
  if (mem) return { kind: "member", name: mem.name };
  const acct = findAccount();
  if (acct) return { kind: "account", name: acct.name };
  return { kind: "none" };
};

/** Builds the preview grid rows, substituting the system-fetched names. */
export const buildRowsOut = (
  rows: Row[],
  resolved: Record<string, string | undefined>,
  accounts: Doc<"accounts">[] | undefined,
  members: Doc<"members">[] | undefined,
  defaultType: "receipt" | "payment" | "journal",
): PreviewRow[] => {
  // Save-time fallback (uploads.uploadTransactions): the society's first
  // bank/cash account, used when a row's Cash/Bank cell is blank.
  const defaultBank = accounts?.find((a) => a.kind === "bank_cash");
  return rows.map((row, i) => {
    const cells = COLS.map((c) => {
      const key = resolved[c.label];
      if (!key) return "";
      const raw = row[key];
      if (raw === undefined || raw === null) return "";
      const s = String(raw).trim();
      if (s === "") return "";
      return c.label === "Amount" ? displayAmount(s) : displayDate(s);
    });
    // Replace the sheet's Ledger Name with the system-fetched name (the code
    // columns carry codes; names come from the system)…
    const resolution = resolveLedger(cells[2], cells[3], cells[4], accounts, members, defaultType);
    if (resolution.kind !== "none") cells[4] = resolution.name;
    // …and the Cash/Bank column with the resolved society account's NAME —
    // the bank's name, or the cash account ("Cash") — never the sheet's code.
    // A blank cell shows the default bank/cash account the row will save to.
    const cashBankRaw = cells[6];
    const primary = resolveBank(cashBankRaw, accounts);
    const bank =
      primary && primary !== "none"
        ? primary
        : primary === "none"
          ? defaultBank
          : cashBankRaw && accounts
            ? resolveBankByName(cells[10], accounts)
            : undefined;
    if (bank) cells[6] = bank.name;
    // The Bank Name column keeps the member's bank text exactly as uploaded —
    // blank when the sheet has none. The system never overwrites it.
    const problems: string[] = [];
    if (resolution.kind === "none")
      problems.push(rowKind(cells[2], defaultType) === "payment" ? "Ledger" : "Member");
    if (cashBankRaw && !bank) problems.push("Bank");
    if (toNum(resolved["Amount"] ? row[resolved["Amount"]] : undefined) === undefined)
      problems.push("Amount");
    if (!cells[1]) problems.push("Date");
    const typeRaw = (cells[2] ?? "").toLowerCase();
    if (
      cells[2] &&
      !typeRaw.startsWith("receipt") &&
      !typeRaw.startsWith("payment") &&
      !typeRaw.startsWith("pay") &&
      !typeRaw.startsWith("journal") &&
      !typeRaw.startsWith("jv") &&
      !typeRaw.startsWith("contra")
    )
      problems.push("Type");
    return { index: i + 2, cells, problems };
  });
};
