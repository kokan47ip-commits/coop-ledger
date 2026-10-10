/**
 * Pure validation rules for the Chart of Accounts bulk "Edit all" save.
 *
 * Extracted from the Convex mutation so the guards are unit-testable (the
 * mutation itself needs a DB). Each helper returns a machine-checkable
 * problem or null; the mutation turns problems into thrown errors.
 */

export type BulkRow = {
  id: string;
  code: string;
  name: string;
};

/** A natural (ledger) account type — mirrors the accounts table. */
export type AccountType = "asset" | "liability" | "income" | "expense";

export type GroupTypeOf = (groupId: string) => AccountType | undefined;

/**
 * System Form N ledger names — the statement engine resolves these by exact
 * name, so their identity (code + name) must never change. Everything else
 * about them (opening balance, print order, group) may be edited freely.
 */
export const SYSTEM_LEDGER_NAMES = [
  "dues from members",
  "advance from members",
  "income over expenses",
] as const;

const norm = (s: string) => s.trim().toLowerCase();

export function isSystemLedgerName(name: string): boolean {
  const n = norm(name);
  return (SYSTEM_LEDGER_NAMES as readonly string[]).some((s) => s === n);
}

/**
 * A system ledger whose incoming code or name differs from its stored
 * identity (case-insensitive) is an attempted rename — rejected.
 */
export function systemRenameProblem(
  row: { name: string; code: string },
  update: { code: string; name: string },
): string | null {
  if (!isSystemLedgerName(row.name)) return null;
  if (
    norm(update.code) !== norm(row.code) ||
    norm(update.name) !== norm(row.name)
  ) {
    return profile(row);
  }
  return null;
}

/** Statement-engine ledgers keep their identity; message names the row. */
function profile(row: { name: string; code: string }): string {
  return `"${row.name}" is a system ledger (used by the Form N statements) and cannot be renamed or re-coded. Edit other accounts, or create a new ledger.`;
}

/** Code and name are both mandatory on every row. */
export function blankFieldProblem(
  u: Pick<BulkRow, "code" | "name">,
): string | null {
  if (!u.code.trim()) return "Every account needs a code.";
  if (!u.name.trim()) return "Every account needs a name.";
  return null;
}

/**
 * Society UPI ID (VPA) validation — shared by BOTH save paths
 * (Messaging & Payments → settings.saveUpiSettings, and Society Profile →
 * societies.update) so an invalid payee can never reach a printed bill QR.
 * Returns the trimmed VPA, or null to clear, or the problem message.
 */
export function normalizeVpa(raw: string | null | undefined):
  | { ok: true; vpa: string | undefined }
  | { ok: false; problem: string } {
  const vpa = raw?.trim() || undefined;
  if (!vpa) return { ok: true, vpa: undefined };
  if (!vpa.includes("@")) {
    return {
      ok: false,
      problem:
        "That doesn't look like a UPI ID — it needs the bank part after the @ (e.g. societynme@hdfcbank).",
    };
  }
  return { ok: true, vpa };
}

/**
 * Within the batch, two rows may not end up with the same (case-insensitive)
 * code. Returns the first colliding code.
 */
export function batchDuplicateProblem(rows: BulkRow[]): string | null {
  const seen = new Map<string, string>();
  for (const u of rows) {
    const key = norm(u.code);
    const other = seen.get(key);
    if (other && other !== u.id) return u.code.trim();
    seen.set(key, u.id);
  }
  return null;
}

/**
 * A row's code may not collide with an UNEDITED row of the same society.
 * `chart` is the full book; rows carrying a batch id are skipped.
 */
export function crossChartDuplicateProblem(
  rows: BulkRow[],
  chart: { id: string; code: string; name: string }[],
): string | null {
  const editedIds = new Set(rows.map((r) => r.id));
  const editedKeys = new Set(rows.map((r) => norm(r.code)));
  for (const a of chart) {
    if (editedIds.has(a.id)) continue;
    if (editedKeys.has(norm(a.code))) return a.code;
  }
  return null;
}

/**
 * A group may only be assigned when its section matches the account's type.
 * `groupType` looks up the group's section, returning undefined for
 * unknown/deleted groups (the mutation rejects those separately).
 */
export function groupMismatchProblem(
  row: { type: AccountType },
  update: { name: string; groupId?: string },
  groupType: GroupTypeOf,
): string | null {
  if (!update.groupId) return null;
  const gt = groupType(update.groupId);
  if (!gt || gt === row.type) return null;
  return `"${update.name.trim()}" is a ${row.type} account — "${gt}" groups can't hold it.`;
}
