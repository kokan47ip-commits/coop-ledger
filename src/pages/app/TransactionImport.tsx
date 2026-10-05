import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  buildRowsOut,
  COLS,
  normKey,
  REQUIRED_LABELS,
  resolveKeys,
  type PreviewRow,
  type Row,
} from "@/lib/transactionImport";

const rowKind = (typeText: string, fallback: "receipt" | "payment" | "journal") => {
  const t = (typeText ?? "").toLowerCase();
  if (t.startsWith("receipt")) return "receipt" as const;
  if (t.startsWith("payment") || t.startsWith("pay")) return "payment" as const;
  if (t.startsWith("journal") || t.startsWith("jv")) return "journal" as const;
  return fallback;
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

/** Builds the preview grid rows, substituting the system-fetched ledger name. */
const buildRowsOut = (
  rows: Row[],
  resolved: Record<string, string | undefined>,
  accounts: Doc<"accounts">[] | undefined,
  members: Doc<"members">[] | undefined,
  defaultType: "receipt" | "payment" | "journal",
): PreviewRow[] =>
  rows.map((row, i) => {
    const cells = COLS.map((c) => {
      const key = resolved[c.label];
      if (!key) return "";
      const raw = row[key];
      if (raw === undefined || raw === null) return "";
      const s = String(raw).trim();
      if (s === "") return "";
      return c.label === "Amount" ? displayAmount(s) : displayDate(s);
    });
    // Replace the sheet's Ledger Name with the system-fetched name and the
    // Cash/Bank column with the account's system name: both columns carry
    // CODES (member flat no / ledger code, bank-cash code) and the names come
    // from the system. The sheet's Bank Name text is display-only.
    const resolution = resolveLedger(cells[2], cells[3], cells[4], accounts, members, defaultType);
    if (resolution.kind !== "none") cells[4] = resolution.name;
    const bank = resolveBank(cells[6], accounts);
    if (bank && bank !== "none") cells[10] = bank.name;
    const problems: string[] = [];
    if (resolution.kind === "none")
      problems.push(rowKind(cells[2], defaultType) === "payment" ? "Ledger" : "Member");
    if (cells[6] && (bank === undefined || bank === "none")) problems.push("Bank");
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
import { useSociety } from "@/components/SocietyContext";
import { downloadTemplate, parseExcelFile } from "@/lib/excel";
import { CheckCircle2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

type Result = { inserted: number; updated: number; skipped: number; errors: string[] };
type Row = Record<string, unknown>;

const normKey = (h: string) => h.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** Grid columns in the legacy order, with the header aliases each accepts. */
const COLS: { label: string; keys: string[]; align?: "right" }[] = [
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

/**
 * Resolves which raw sheet header feeds each grid column. Aliases are tried
 * in order and a header, once claimed by a column, is not reused — so
 * "Voucher No." never steals the "Voucher…" type column and vice versa.
 */
function resolveKeys(headers: string[]): Record<string, string | undefined> {
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

const toNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isNaN(n) ? undefined : n;
};

/** Legacy display: dd/mm/yyyy, accepting ISO or dd/mm/yyyy input. */
function displayDate(v: unknown): string {
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

function displayAmount(v: unknown): string {
  const n = toNum(v);
  if (n === undefined) return String(v ?? "").trim();
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

type PreviewRow = { index: number; cells: string[]; problems: string[] };

/** Column labels whose absence blocks Import entirely. */
const REQUIRED_LABELS = ["Date", "Ledger Code", "Ledger Name", "Amount"];

export default function TransactionImport() {
  const { societyId, canEdit } = useSociety();
  const navigate = useNavigate();
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"accounts">[] | undefined;
  const members = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"members">[] | undefined;
  const doImport = useMutation(api.uploads.uploadTransactions);

  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [defaultType, setDefaultType] = useState<"receipt" | "payment" | "journal">("receipt");
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<{
    rows: Row[];
    resolved: Record<string, string | undefined>;
    rowsOut: PreviewRow[];
    missing: string[];
  } | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  const okCount = preview ? preview.rowsOut.filter((r) => r.problems.length === 0).length : 0;

  // Masters (members/accounts) can arrive after the file is parsed — re-resolve
  // the ledger names once they load. The fallback-type dropdown re-resolves too.
  useEffect(() => {
    if (!preview) return;
    setPreview((p) =>
      p
        ? { ...p, rowsOut: buildRowsOut(p.rows, p.resolved, accounts, members, defaultType) }
        : p,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, members, defaultType]);

  const status = busy
    ? "Importing…"
    : !fileName
      ? "Select an Excel file to preview transactions."
      : !preview
        ? "Reading file…"
        : `${okCount} of ${preview.rowsOut.length} rows ready to import` +
          (preview.missing.length ? ` — missing columns: ${preview.missing.join(", ")}` : "") +
          (done
            ? ` · last import: ${done.inserted} added, ${done.skipped} skipped, ${done.errors.length} errors`
            : "");

  const handleFile = async (file: File) => {
    setDone(null);
    setFileName(file.name);
    try {
      const { rows, headers } = await parseExcelFile(file);
      if (rows.length === 0) {
        toast.error("No rows found in the first sheet.");
        setPreview(null);
        return;
      }
      const resolved = resolveKeys(headers);
      const have = new Set(headers.map(normKey));
      const missing = COLS.filter(
        (c) => !c.keys.some((k) => have.has(k)) && REQUIRED_LABELS.includes(c.label),
      ).map((c) => c.label);
      const rowsOut = buildRowsOut(rows, resolved, accounts, members, defaultType);
      setPreview({ rows, resolved, rowsOut, missing });
      setSelected(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file.");
    }
  };

  const importNow = async () => {
    if (!preview || !societyId) return;
    const bank = accounts?.find((a) => a.kind === "bank_cash");
    if (!bank) {
      toast.error("Create a bank/cash account first (Chart of Accounts).");
      return;
    }
    setBusy(true);
    try {
      const res = await doImport({
        societyId,
        rows: preview.rows,
        defaultType,
        defaultBankCashAccountId: bank._id,
      });
      setDone(res);
      if (res.errors.length > 0) toast.warning(`Imported with ${res.errors.length} row error(s)`);
      else toast.success(`Imported ${res.inserted} voucher(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-lg border bg-card shadow-lg shadow-indigo-950/10">
        {/* Title bar */}
        <div className="flex items-center justify-between border-b bg-primary/[0.07] px-3 py-1.5">
          <span className="text-sm font-semibold tracking-tight">TransactionImport</span>
          <button
            type="button"
            title="Exit"
            onClick={() => navigate("/app/uploads")}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* File row */}
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <span className="text-sm text-muted-foreground">Excel file</span>
          <div className="min-w-0 flex-1 truncate rounded border border-input bg-yellow-100/70 px-2 py-1 font-mono text-xs text-foreground dark:bg-yellow-200/20">
            {fileName || "\u00A0"}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="h-8 w-10 px-2" onClick={() => inputRef.current?.click()}>
            …
          </Button>
          <Button size="sm" className="h-8" disabled={!canEdit || !preview || busy || okCount === 0} onClick={importNow}>
            Import
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => downloadTemplate("transactions")}>
            Template
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => navigate("/app/uploads")}>
            Exit
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rows without a type are</span>
            <Select value={defaultType} onValueChange={(v) => setDefaultType(v as typeof defaultType)}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="receipt">Receipts</SelectItem>
                <SelectItem value="payment">Payments</SelectItem>
                <SelectItem value="journal">Journal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Preview grid */}
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="w-6 border-b border-r px-1 py-1.5" />
                {COLS.map((c) => (
                  <th
                    key={c.label}
                    className={`border-b border-r px-2 py-1.5 font-semibold last:border-r-0 ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!preview || preview.rowsOut.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                    {fileName
                      ? "No rows found in the first sheet."
                      : "Pick an Excel file with the … button — rows appear here before anything is saved."}
                  </td>
                </tr>
              ) : (
                preview.rowsOut.map((r, idx) => (
                  <tr
                    key={r.index}
                    onClick={() => setSelected(idx)}
                    className={`cursor-default ${r.problems.length > 0 ? "bg-destructive/[0.08]" : idx === selected ? "bg-primary/[0.07]" : "hover:bg-muted/60"}`}
                  >
                    <td className="border-b border-r px-1 text-center text-[10px] text-primary">
                      {idx === selected ? "▶" : ""}
                    </td>
                    {r.cells.map((c, j) => (
                      <td
                        key={j}
                        className={`max-w-48 truncate whitespace-nowrap border-b border-r px-2 py-1 last:border-r-0 ${COLS[j].align === "right" ? "text-right tabular-nums" : ""}`}
                        title={c}
                      >
                        {c || "\u00A0"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Status strip */}
        <div className="flex items-center gap-2 border-t bg-yellow-100/80 px-3 py-1.5 text-xs font-medium text-foreground dark:bg-yellow-200/15">
          {done && done.errors.length === 0 && <CheckCircle2 className="size-3.5 text-emerald-600" />}
          {status}
        </div>
      </div>

      {/* Row errors from the last import */}
      {done && done.errors.length > 0 && (
        <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/[0.06] p-3 text-xs text-destructive">
          {done.errors.slice(0, 30).map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Expected columns: Voucher No., Date, Vouchers (Receipts / Payments / Journal), Ledger Code, Ledger
        Name, Amount, Cash/Bank, Narration, Cheque No., Chq. Date, Bank Name, ChqClearDate. For
        <strong> Receipts</strong> the Ledger Code is the member's <strong>flat no</strong>; for
        <strong> Payments</strong> and <strong>Other Receipts</strong> it is the <strong>ledger code</strong>
        from Chart of Accounts. <strong>Cash/Bank</strong> carries the bank/cash <strong>account code</strong>.
        The Ledger Name and Bank Name are fetched automatically from the system; the sheet's name text is
        ignored. Dates accept DD/MM/YYYY; amounts may include ₹ and commas. Entries dated outside the
        financial year are declined row-wise.
      </p>
    </div>
  );
}
