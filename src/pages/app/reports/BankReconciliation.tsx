import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { EmptyHint, PageHeader } from "@/components/PageParts";
import {
  exportExcel,
  exportPDF,
  exportWord,
  printTables,
  type ExportMeta,
  type TableSpec,
} from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatMoney } from "@/lib/format";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Printer,
  Save,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Account = Doc<"accounts">;

type Workspace = {
  accountId: Id<"accounts">;
  code: string;
  name: string;
  bookOpening: number;
  bookClosing: number;
  entries: {
    date: string;
    voucherNo: string;
    narration: string[];
    deposit: number;
    withdrawal: number;
    cleared: boolean;
  }[];
  unclearedDeposits: number;
  unclearedWithdrawals: number;
  expectedBankBalance: number;
  actualBalance: number;
  stated: boolean;
  difference: number | null;
  savedAt: number | null;
  savedByName: string | null;
};

export default function BankReconciliation() {
  const { societyId, society, canEdit } = useSociety();
  const signatures = useCommitteeSignatures();
  const save = useMutation(api.bankRecon.save);

  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as Account[] | undefined;
  // Banks only (the codebase's bank-vs-cash convention: name says "bank"),
  // falling back to every cash & bank ledger when none was named that way.
  const kindAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const namedBanks = kindAccounts.filter((a) => /bank/i.test(a.name));
  const bankAccounts = namedBanks.length > 0 ? namedBanks : kindAccounts;

  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [accountId, setAccountId] = useState<string>("");
  const activeAccountId = accountId || bankAccounts[0]?._id || "";

  // Ticks the office makes on this visit — undefined = follow the saved data.
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [actualInput, setActualInput] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const workspace = useQuery(
    api.bankRecon.workspace,
    societyId && activeAccountId
      ? {
          societyId,
          accountId: activeAccountId as Id<"accounts">,
          fromDate: from,
          toDate: to,
        }
      : "skip",
  ) as Workspace | undefined;

  // Reset the manual ticks / stated balance whenever the workspace identity
  // changes (account, statement dates, or a fresh save).
  const sessionKey = `${activeAccountId}|${from}|${to}|${workspace?.savedAt ?? 0}`;
  useEffect(() => {
    setTicked(null);
    setActualInput(workspace?.stated ? String(workspace.actualBalance) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const rows = workspace?.entries ?? [];
  const tickSet =
    ticked ?? new Set(rows.filter((r) => r.cleared).map((r) => r.voucherNo));

  const toggle = (voucherNo: string) => {
    const next = new Set(tickSet);
    if (next.has(voucherNo)) next.delete(voucherNo);
    else next.add(voucherNo);
    setTicked(next);
  };

  // Live reconciliation from the current ticks and the stated balance.
  const round = (n: number) => Math.round(n * 100) / 100;
  const pendingDeposit = round(
    rows
      .filter((r) => !tickSet.has(r.voucherNo))
      .reduce((s, r) => s + r.deposit, 0),
  );
  const pendingWithdrawal = round(
    rows
      .filter((r) => !tickSet.has(r.voucherNo))
      .reduce((s, r) => s + r.withdrawal, 0),
  );
  const bookClosing = round(workspace?.bookClosing ?? 0);
  const expected = round(bookClosing - pendingDeposit + pendingWithdrawal);
  const actual = actualInput.trim() === "" ? null : Number(actualInput);
  const difference =
    actual === null ? null : round(actual - expected);
  const reconciled = difference !== null && Math.abs(difference) < 0.005;

  const doSave = async () => {
    if (!societyId || !activeAccountId || actual === null || Number.isNaN(actual)) {
      toast.error(
        "Enter the balance as per the bank statement (pass book) before saving.",
      );
      return;
    }
    setSaving(true);
    try {
      await save({
        societyId,
        accountId: activeAccountId as Id<"accounts">,
        toDate: to,
        bookBalance: bookClosing,
        actualBalance: actual,
        clearedVoucherNos: rows
          .filter((r) => tickSet.has(r.voucherNo))
          .map((r) => r.voucherNo),
        note: undefined,
      });
      setTicked(null);
      toast.success(
        reconciled
          ? "Reconciliation saved — books and bank tally."
          : "Reconciliation saved — the difference is on record.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const statementTitle = "BANK RECONCILIATION STATEMENT";
  const subtitle = `${workspace ? `${workspace.code} — ${workspace.name}` : "Bank"} · as on ${formatDate(to)}`;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: statementTitle,
        subtitle,
        signatures,
      }
    : null;

  const buildTables = (): TableSpec[] => {
    const pending = rows.filter((r) => !tickSet.has(r.voucherNo));
    const summary: [string, string | number][] = [
      [formatDate(from), ""],
      ["Balance as per Books (Dr)", bookClosing],
      [
        "Less: deposits recorded in the books but not yet credited by the bank",
        pendingDeposit ? pendingDeposit : "",
      ],
      [
        "Add: withdrawals recorded in the books (cheques) not yet presented",
        pendingWithdrawal ? pendingWithdrawal : "",
      ],
      ["Balance as per Bank Pass Book (expected)", expected],
      [
        "Balance as per Bank Statement (as entered)",
        actual === null ? "—" : actual,
      ],
      [
        difference === null
          ? "Difference"
          : difference === 0
            ? "Difference — TALLIED"
            : "Difference (to be investigated)",
        difference === null ? "—" : difference,
      ],
    ];
    return [
      {
        sectionTitle: `${workspace?.code ?? ""}  ${workspace?.name ?? ""}`.toUpperCase(),
        head: [
          "Detailed entries (deposit = bank Dr, withdrawal = bank Cr)",
          "Date",
          "Deposit",
          "Withdrawal",
          "Status",
        ],
        body: rows.map((r) => [
          `${r.voucherNo} — ${r.narration.join(" / ")}`,
          formatDate(r.date),
          r.deposit || "",
          r.withdrawal || "",
          tickSet.has(r.voucherNo) ? "Cleared / Present" : "PENDING",
        ]),
        foot: [
          [
            "PENDING WITH THE BANK",
            "",
            pendingDeposit,
            pendingWithdrawal,
            "",
          ],
        ],
        columnStyles: {
          2: { halign: "right" },
          3: { halign: "right" },
        },
      } as unknown as TableSpec,
      {
        sectionTitle: "RECONCILIATION",
        head: ["Particulars", "Amount"],
        body: summary.map(([a, b]) => [a, b]),
        foot: [],
        columnStyles: { 1: { halign: "right" } },
      } as unknown as TableSpec,
    ];
  };

  const doExport = (kind: "pdf" | "word" | "excel" | "print") => {
    if (!meta) return;
    if (kind === "pdf") exportPDF(meta, buildTables(), "bank-reconciliation.pdf");
    else if (kind === "word") exportWord(meta, buildTables(), "bank-reconciliation.doc");
    else if (kind === "excel") exportExcel(meta, buildTables(), "bank-reconciliation.xlsx");
    else printTables(meta, buildTables());
  };

  if (accounts !== undefined && bankAccounts.length === 0) {
    return (
      <div>
        <PageHeader
          title="Bank Reconciliation"
          description="Tally each bank account against the bank statement (pass book): tick the entries the bank has already honoured, enter the actual balance, and the statement shows the difference."
        />
        <EmptyHint>
          No bank accounts found — add one under Chart of Accounts (kind: Cash
          &amp; Bank).
        </EmptyHint>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        description="Tally each bank account against the bank statement (pass book): tick the entries the bank has already honoured, enter the actual balance, and the statement shows the difference. Ticks of earlier statements carry forward automatically."
      />

      <div className="panel mb-6 grid gap-4 p-5 sm:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="br-from">From</Label>
          <Input id="br-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="br-to">Statement date</Label>
          <Input id="br-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Bank account</Label>
          <Select
            value={activeAccountId}
            onValueChange={(v) => setAccountId(v)}
          >
            <SelectTrigger><SelectValue placeholder="Select a bank account" /></SelectTrigger>
            <SelectContent>
              {bankAccounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.code} — {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {workspace === undefined ? (
        <EmptyHint>Loading the bank book…</EmptyHint>
      ) : (
        <>
          {/* Statement summary */}
          <div className="panel mb-6 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Landmark className="size-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">
                  {statementTitle}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <div className="grid gap-8 lg:grid-cols-2">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
                  <dt className="text-muted-foreground">Balance as per Books (Dr) on {formatDate(to)}</dt>
                  <dd className="font-semibold tabular-nums">{formatMoney(bookClosing)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
                  <dt className="text-muted-foreground">Less: uncredited deposits in the books</dt>
                  <dd className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    − {formatMoney(pendingDeposit)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
                  <dt className="text-muted-foreground">Add: un-presented withdrawals (cheques)</dt>
                  <dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    + {formatMoney(pendingWithdrawal)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 pb-1">
                  <dt className="font-semibold">Balance as per Pass Book (expected)</dt>
                  <dd className="font-bold tabular-nums">{formatMoney(expected)}</dd>
                </div>
              </dl>
              <dl className="space-y-2 text-sm">
                {workspace.savedAt !== null && (
                  <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                    <dt>Last saved</dt>
                    <dd>
                      {new Date(workspace.savedAt).toLocaleString()} by{" "}
                      {workspace.savedByName}
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
                  <dt className="text-muted-foreground">Balance as per Bank Statement (actual)</dt>
                  <dd>
                    <Input
                      className="w-40 text-right tabular-nums"
                      type="number"
                      step="0.01"
                      placeholder="enter actual"
                      value={actualInput}
                      onChange={(e) => setActualInput(e.target.value)}
                      disabled={!canEdit}
                    />
                  </dd>
                </div>
                <div className={`flex items-center justify-between gap-4 ${difference === null ? "" : reconciled ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  <dt className="font-semibold">
                    {difference === null ? "Enter the pass-book balance to reconcile" : reconciled ? "Tallied — no difference" : "Difference"}
                  </dt>
                  <dd className="flex items-center gap-2 font-bold tabular-nums">
                    {reconciled ? (
                      <CheckCircle2 className="size-5" />
                    ) : difference !== null ? (
                      <XCircle className="size-5" />
                    ) : null}
                    {difference === null ? "—" : formatMoney(difference)}
                  </dd>
                </div>
                <div className="pt-2">
                  <Button
                    size="sm"
                    disabled={!canEdit || saving || actual === null || Number.isNaN(actual)}
                    onClick={doSave}
                  >
                    <Save className="size-4" /> {saving ? "Saving…" : "Save reconciliation"}
                  </Button>
                </div>
              </dl>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {rows.length} entr{rows.length === 1 ? "y" : "ies"} between{" "}
              {formatDate(from)} and {formatDate(to)} · uncredited deposits{" "}
              {formatMoney(pendingDeposit)} · un-presented withdrawals{" "}
              {formatMoney(pendingWithdrawal)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => doExport("pdf")}
                className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <Download className="size-4" /> PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => doExport("word")}
                className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
              >
                <FileText className="size-4" /> Word
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => doExport("excel")}
                className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <FileSpreadsheet className="size-4" /> Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => doExport("print")}
                className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
              >
                <Printer className="size-4" /> Print
              </Button>
            </div>
          </div>

          <div className="panel">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-24">Date</TableHead>
                  <TableHead className="w-24">Voucher</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="w-28 text-right">Deposit</TableHead>
                  <TableHead className="w-28 text-right">Withdrawal</TableHead>
                  <TableHead className="w-28 text-center">
                    {canEdit ? "Seen on bank statement" : "Status"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No entries in this range for the selected bank account.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => {
                  const isTicked = tickSet.has(r.voucherNo);
                  return (
                    <TableRow key={r.voucherNo}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.voucherNo}</TableCell>
                      <TableCell>
                        <span className="font-medium">{r.narration[0]}</span>
                        {r.narration.slice(1).map((line, j) => (
                          <span key={j} className="block text-xs text-muted-foreground">{line}</span>
                        ))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.deposit ? formatMoney(r.deposit) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.withdrawal ? formatMoney(r.withdrawal) : ""}
                      </TableCell>
                      <TableCell className="text-center">
                        {canEdit ? (
                          <label className="inline-flex cursor-pointer items-center gap-2">
                            <Checkbox
                              checked={isTicked}
                              onCheckedChange={() => toggle(r.voucherNo)}
                            />
                            <span className={`text-xs ${isTicked ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                              {isTicked ? "Cleared" : "Pending"}
                            </span>
                          </label>
                        ) : (
                          <span className={`text-xs ${isTicked ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                            {isTicked ? "Cleared" : "Pending"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
