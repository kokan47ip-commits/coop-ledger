import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatMoney } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type TBRow = {
  accountId: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  debit: number;
  credit: number;
};

const TYPE_LABEL: Record<TBRow["type"], string> = {
  asset: "Asset",
  liability: "Liability",
  income: "Income",
  expense: "Expenditure",
};

export default function TrialBalance() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);

  const rows = useQuery(
    api.api.trialBalance,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as TBRow[] | undefined;

  const totalDebit = (rows ?? []).reduce((s, r) => s + r.debit, 0);
  const totalCredit = (rows ?? []).reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.5;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Trial Balance",
        subtitle: `For the period ${formatDate(from)} to ${formatDate(to)}`,
        signatures,
      }
    : null;

  const buildTable = (): TableSpec => ({
    head: ["Code", "Ledger Account", "Debit (₹)", "Credit (₹)"],
    body: (rows ?? []).map((r) => [r.code, `${r.name}  (${TYPE_LABEL[r.type]})`, r.debit, r.credit]),
    foot: [["", "TOTAL", totalDebit, totalCredit]],
    columnStyles: {
      0: { cellWidth: 58 },
      2: { halign: "right" },
      3: { halign: "right" },
    },
  });

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    if (kind === "pdf") exportPDF(meta, [buildTable()], "trial-balance.pdf");
    else if (kind === "word") exportWord(meta, [buildTable()], "trial-balance.doc");
    else printTables(meta, [buildTable()]);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Trial Balance"
        description="Closing Dr/Cr balance of every ledger account for the selected period — the check that total debits equal total credits before the books are finalised."
      />

      <div className="panel mb-6 grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="tb-from">From</Label>
          <Input id="tb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tb-to">To</Label>
          <Input id="tb-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex items-end justify-end gap-2">
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
            onClick={() => doExport("print")}
            className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
          >
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows === undefined
            ? "Loading…"
            : `${rows.length} ${rows.length === 1 ? "account" : "accounts"} · debits ${formatMoney(totalDebit)} · credits ${formatMoney(totalCredit)}`}
        </p>
        {rows !== undefined && rows.length > 0 && (
          <p
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              balanced
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}
          >
            {balanced ? "✓ Books balanced — debits equal credits" : `Out of balance by ${formatMoney(Math.abs(totalDebit - totalCredit))}`}
          </p>
        )}
      </div>

      {rows !== undefined && rows.length === 0 ? (
        <EmptyHint>No account activity in this period — enter vouchers or bills to build the trial balance.</EmptyHint>
      ) : (
        <div className="panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Ledger Account</TableHead>
                <TableHead className="w-32 text-right">Debit (₹)</TableHead>
                <TableHead className="w-32 text-right">Credit (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.accountId}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{TYPE_LABEL[r.type]}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.debit ? formatMoney(r.debit) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.credit ? formatMoney(r.credit) : "—"}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 hover:bg-transparent">
                <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totalDebit)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
