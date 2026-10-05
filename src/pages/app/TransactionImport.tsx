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
  type Row,
} from "@/lib/transactionImport";

import { useSociety } from "@/components/SocietyContext";
import { downloadTemplate, parseExcelFile } from "@/lib/excel";
import { CheckCircle2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

type Result = { inserted: number; updated: number; skipped: number; errors: string[] };

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
  const [parsed, setParsed] = useState<{
    rows: Row[];
    resolved: Record<string, string | undefined>;
    missing: string[];
  } | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  // The preview grid is derived: recomputed whenever the parsed file, the
  // masters (members/accounts) or the fallback type change — no state
  // synchronization needed.
  const rowsOut = useMemo(
    () =>
      parsed
        ? buildRowsOut(parsed.rows, parsed.resolved, accounts, members, defaultType)
        : [],
    [parsed, accounts, members, defaultType],
  );

  const okCount = rowsOut.filter((r) => r.problems.length === 0).length;

  const status = busy
    ? "Importing…"
    : !fileName
      ? "Select an Excel file to preview transactions."
      : !parsed
        ? "Reading file…"
        : `${okCount} of ${rowsOut.length} rows ready to import` +
          (parsed.missing.length ? ` — missing columns: ${parsed.missing.join(", ")}` : "") +
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
        setParsed(null);
        return;
      }
      const resolved = resolveKeys(headers);
      const have = new Set(headers.map(normKey));
      const missing = COLS.filter(
        (c) => !c.keys.some((k) => have.has(k)) && REQUIRED_LABELS.includes(c.label),
      ).map((c) => c.label);
      setParsed({ rows, resolved, missing });
      setSelected(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file.");
    }
  };

  const importNow = async () => {
    if (!parsed || !societyId) return;
    const bank = accounts?.find((a) => a.kind === "bank_cash");
    if (!bank) {
      toast.error("Create a bank/cash account first (Chart of Accounts).");
      return;
    }
    setBusy(true);
    try {
      const res = await doImport({
        societyId,
        rows: parsed.rows,
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
          <Button size="sm" className="h-8" disabled={!canEdit || !parsed || busy || okCount === 0} onClick={importNow}>
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
              {!parsed || rowsOut.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                    {fileName
                      ? "No rows found in the first sheet."
                      : "Pick an Excel file with the … button — rows appear here before anything is saved."}
                  </td>
                </tr>
              ) : (
                rowsOut.map((r, idx) => (
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
        from Chart of Accounts. <strong>Cash/Bank</strong> accepts the bank/cash <strong>account code</strong>
        and shows the account's name — the bank, or <strong>Cash</strong> — as it will be saved; leave it
        blank to use the society's first bank/cash account. <strong>Bank Name</strong> is the member's bank
        — shown exactly as uploaded, blank when the sheet has none. The Ledger Name is fetched automatically
        from the system; the sheet's name text is ignored. Dates accept DD/MM/YYYY; amounts may include ₹
        and commas. Entries dated outside the financial year are declined row-wise.
      </p>
    </div>
  );
}
