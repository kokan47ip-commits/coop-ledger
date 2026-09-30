import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { downloadTemplate, parseExcelFile } from "@/lib/excel";
import { fyStartISO } from "@/lib/format";
import { CheckCircle2, Download, FileCheck2, Upload, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Result = { inserted: number; updated: number; skipped: number; errors: string[] };
type UploadKind = "members" | "tariffs" | "receipts" | "payments";

/** Normalises an Excel header to a stable comparison key. */
const normKey = (h: string) => h.replace(/[^a-z0-9]/gi, "").toLowerCase();

const REQUIRED: Record<UploadKind, { keys: string[]; label: string }[]> = {
  members: [
    { keys: ["code", "membercode", "memberid", "memberno"], label: "Member code" },
    { keys: ["name", "membername", "nameofmember"], label: "Name" },
    { keys: ["openingbalance", "opening", "opbal", "balance", "outstanding", "arrears"], label: "Opening balance" },
  ],
  tariffs: [
    { keys: ["name", "tariff", "tariffname", "charge", "head", "type"], label: "Tariff name" },
    { keys: ["amount", "rate"], label: "Amount" },
  ],
  receipts: [
    { keys: ["date"], label: "Date" },
    { keys: ["membercode", "code", "member"], label: "Member code" },
    { keys: ["amount", "received", "paid"], label: "Amount" },
  ],
  payments: [
    { keys: ["date"], label: "Date" },
    { keys: ["account", "ledger", "expense", "paidto", "particulars"], label: "Account" },
    { keys: ["amount", "paid"], label: "Amount" },
  ],
};

/** Expected display columns per kind, used to build the preview table header. */
const PREVIEW_COLUMNS: Record<UploadKind, string[]> = {
  members: ["Code", "Name", "Flat No", "Wing", "Phone", "Opening", "Opening date"],
  tariffs: ["Name", "Amount", "Account", "Unit"],
  receipts: ["Date", "Member", "Amount", "Mode", "Reference", "Narration"],
  payments: ["Date", "Account", "Amount", "Bank", "Reference", "Narration"],
};

/** Alternate header spellings accepted for each preview column. */
const COLUMN_KEYS: Record<UploadKind, Record<string, string[]>> = {
  members: {
    Code: ["code", "membercode", "memberid", "memberno", "membernumber"],
    Name: ["name", "membername", "nameofmember", "member", "ownername"],
    "Flat No": ["flatno", "flat", "flatnumber", "unit", "house", "shop", "premises"],
    Wing: ["wing", "building", "block"],
    Phone: ["phone", "mobile", "contact"],
    Opening: [
      "openingbalance",
      "opening",
      "openingbal",
      "opbalance",
      "opbal",
      "opgbalance",
      "opgbal",
      "ob",
      "balance",
      "outstanding",
      "amountdue",
      "arrears",
      "oldbalance",
      "previousbalance",
      "prevbalance",
      "broughtforward",
      "oparrears",
    ],
    "Opening date": ["openingdate", "asof", "ason"],
  },
  tariffs: {
    Name: ["name", "tariff", "tariffname", "charge", "head", "type"],
    Amount: ["amount", "rate"],
    Account: ["account", "accountcode", "accountname", "ledger", "incomeaccount"],
    Unit: ["unit", "basis"],
  },
  receipts: {
    Date: ["date", "receiptdate", "receiveddate"],
    Member: ["membercode", "code", "member", "memberid"],
    Amount: ["amount", "received", "paid"],
    Mode: ["mode", "paymentmode", "bank"],
    Reference: ["reference", "ref", "receiptno", "utr", "utrn", "txn"],
    Narration: ["narration", "remarks", "note"],
  },
  payments: {
    Date: ["date", "paymentdate"],
    Account: ["account", "ledger", "expense", "paidto", "particulars"],
    Amount: ["amount", "paid", "payment"],
    Bank: ["bank", "mode", "paidfrom", "bankaccount"],
    Reference: ["reference", "ref", "chequeno", "utr", "utrn"],
    Narration: ["narration", "remarks", "note"],
  },
};

function fmtAmount(v: string): string {
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isNaN(n) ? v : n.toLocaleString("en-IN");
}

function fmtDate(v: string): string {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v;
}

/** Resolves which raw sheet header feeds each preview column (case/punct-insensitive). */
function resolveKeys(
  headers: string[],
  kind: UploadKind,
): Record<string, string | undefined> {
  const normalized = headers.map((h) => ({ raw: h, key: normKey(h) }));
  const out: Record<string, string | undefined> = {};
  for (const [col, keys] of Object.entries(COLUMN_KEYS[kind])) {
    out[col] = normalized.find((h) => keys.includes(h.key))?.raw;
  }
  return out;
}

type PreviewRow = {
  index: number;
  cells: string[]; // display values per PREVIEW_COLUMNS
  problems: string[];
};

function UploadCard({
  kind,
  title,
  description,
  columns,
  onDone,
}: {
  kind: UploadKind;
  title: string;
  description: string;
  columns: string;
  onDone: (r: Result) => void;
}) {
  const { societyId, canEdit } = useSociety();
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"accounts">[] | undefined;
  const doMembers = useMutation(api.uploads.uploadMembers);
  const doTariffs = useMutation(api.uploads.uploadTariffs);
  const doReceipts = useMutation(api.uploads.uploadReceipts);
  const doPayments = useMutation(api.uploads.uploadPayments);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [last, setLast] = useState<Result | null>(null);

  // Preview state: file parsed but NOT yet uploaded.
  const [preview, setPreview] = useState<{
    file: File;
    headers: string[];
    rows: Record<string, unknown>[];
    resolved: Record<string, string | undefined>;
    rowsOut: PreviewRow[];
    missing: string[];
  } | null>(null);

  const openPicker = () => inputRef.current?.click();

  const run = async (rows: Record<string, unknown>[]): Promise<Result> => {
    if (!societyId) throw new Error("No society selected.");
    if (kind === "members") {
      return doMembers({ societyId, rows, defaultOpeningDate: fyStartISO() });
    }
    if (kind === "tariffs") {
      return doTariffs({ societyId, rows });
    }
    const bank = accounts?.find((a) => a.kind === "bank_cash");
    if (!bank) throw new Error("Create a bank/cash account first (Chart of Accounts).");
    if (kind === "receipts") {
      return doReceipts({ societyId, rows, defaultAccountId: bank._id });
    }
    return doPayments({ societyId, rows, defaultBankCashAccountId: bank._id });
  };

  const confirmUpload = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await run(preview.rows);
      setLast(res);
      onDone(res);
      setPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  // Parse the file and build the review grid. Nothing is saved yet.
  const handleFile = async (file: File) => {
    setChecking(true);
    try {
      const { rows, headers } = await parseExcelFile(file);
      if (rows.length === 0) {
        toast.error("No rows found in the first sheet.");
        return;
      }
      const resolved = resolveKeys(headers, kind);
      const missing = REQUIRED[kind]
        .filter((f) => !headers.some((h) => f.keys.includes(normKey(h))))
        .map((f) => f.label);

      const rowsOut: PreviewRow[] = rows.map((row, i) => {
        const cells = PREVIEW_COLUMNS[kind].map((col) => {
          const key = resolved[col];
          if (!key) return "";
          const raw = row[key];
          if (raw === undefined || raw === null) return "";
          const s = String(raw).trim();
          if (s === "") return "";
          if (["Amount", "Opening"].includes(col)) return fmtAmount(s);
          if (["Date", "Opening date"].includes(col)) return fmtDate(s);
          return s;
        });
        const problems: string[] = [];
        for (const f of REQUIRED[kind]) {
          const idx = PREVIEW_COLUMNS[kind].findIndex((c) =>
            f.keys.some((k) => (COLUMN_KEYS[kind][c] ?? []).includes(k)),
          );
          const val = idx >= 0 ? cells[idx] : "";
          if (!val) problems.push(`${f.label} missing`);
        }
        return { index: i + 2, cells, problems };
      });

      setPreview({ file, headers, rows, resolved, rowsOut, missing });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file.");
    } finally {
      setChecking(false);
    }
  };

  const okCount = preview ? preview.rowsOut.filter((r) => r.problems.length === 0).length : 0;
  const badCount = preview ? preview.rowsOut.length - okCount : 0;

  return (
    <Card className="p-5 shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="pt-1 font-mono text-[11px] text-muted-foreground">{columns}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => downloadTemplate(kind)} title="Download template">
          <Download className="size-4" /> Template
        </Button>
      </div>
      <div className="mt-4 flex items-center gap-3">
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
        <Button disabled={!canEdit || busy || checking} onClick={openPicker} className="rounded-lg">
          <Upload className="size-4" />
          {checking ? "Reading file…" : busy ? "Uploading…" : "Upload Excel"}
        </Button>
        {last && !preview && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-foreground" />
            {last.inserted} added · {last.updated} updated
            {last.errors.length > 0 && ` · ${last.errors.length} row errors`}
          </span>
        )}
      </div>
      {last && last.errors.length > 0 && !preview && (
        <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-md bg-accent/50 p-3 text-xs text-muted-foreground">
          {last.errors.slice(0, 20).map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {/* ---- Preview & confirm dialog ---- */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview before upload — {title}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {preview?.file.name} · {preview?.rowsOut.length ?? 0} rows found. Nothing is saved
              until you confirm below.
            </p>
          </DialogHeader>

          {preview && (
            <>
              {preview.missing.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Required column{preview.missing.length > 1 ? "s" : ""} not found in the sheet:{" "}
                  <strong>{preview.missing.join(", ")}</strong>. Add{" "}
                  {preview.missing.length > 1 ? "them" : "it"} to the file and re-select it.
                </div>
              )}
              <div className="panel max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">Row</TableHead>
                      {PREVIEW_COLUMNS[kind].map((c) => (
                        <TableHead key={c}>{c}</TableHead>
                      ))}
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rowsOut.map((r) => (
                      <TableRow key={r.index} className={r.problems.length > 0 ? "bg-destructive/[0.06]" : undefined}>
                        <TableCell className="text-muted-foreground">{r.index}</TableCell>
                        {r.cells.map((c, j) => (
                          <TableCell key={j} className="whitespace-nowrap">
                            {c || <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                        ))}
                        <TableCell className="text-right">
                          {r.problems.length === 0 ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="size-3" /> Ready
                            </Badge>
                            ) : (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="size-3" /> {r.problems.join(", ")}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <DialogFooter className="items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{okCount}</span> ready ·{" "}
                  <span className={badCount > 0 ? "font-medium text-destructive" : ""}>
                    {badCount} need attention
                  </span>{" "}
                  — problem rows are skipped on upload.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button onClick={confirmUpload} disabled={!canEdit || busy || okCount === 0}>
                    <FileCheck2 className="size-4" />
                    {busy ? "Uploading…" : `Upload ${okCount} row${okCount === 1 ? "" : "s"}`}
                  </Button>
                  </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function Uploads() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Excel Uploads"
        description="Bring client records across from spreadsheets in bulk. Pick a file, review exactly what will be created, then confirm — nothing is written until you approve the preview. Headers are matched flexibly, so order and capitalisation don't matter."
      />
      <div className="space-y-4">
        {KINDS.map((k) => (
          <UploadCard
            key={k.kind}
            kind={k.kind}
            title={k.title}
            description={k.description}
            columns={k.columns}
            onDone={(r) =>
              toast.success(
                `Upload complete: ${r.inserted} added, ${r.updated} updated` +
                  (r.errors.length ? `, ${r.errors.length} rows skipped` : ""),
              )
            }
          />
        ))}
      </div>
      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Dates accept <span className="font-mono">YYYY-MM-DD</span> or <span className="font-mono">DD/MM/YYYY</span>.
        Amounts may include commas and the ₹ symbol. Member codes in receipt uploads must already exist —
        import members first. Zero-amount rows are ignored.
      </p>
    </div>
  );
}

const KINDS: {
  kind: UploadKind;
  title: string;
  description: string;
  columns: string;
}[] = [
  {
    kind: "members",
    title: "Member register & openings",
    description:
      "Import the client's member register with opening receivable balances. Wing is optional — leave it out for single-building societies.",
    columns: "Code, Name, FlatNo, Wing (optional), Phone, Email, OwnershipType, JoinDate, OpeningBalance, OpeningDate",
  },
  {
    kind: "tariffs",
    title: "Tariff schedule",
    description: "Import recurring charges. The Account column accepts either the account code or its name.",
    columns: "Name, Amount, Account, Unit",
  },
  {
    kind: "receipts",
    title: "Member & other receipts",
    description: "Import collection scrolls. Each row becomes a receipt voucher, settled against outstanding bills oldest-first.",
    columns: "Date, MemberCode, Amount, Mode, Reference, Narration",
  },
  {
    kind: "payments",
    title: "Payment register",
    description: "Import expense payments. The Account column must match an existing ledger name or code.",
    columns: "Date, Account, Amount, Bank, Reference, Narration",
  },
];
