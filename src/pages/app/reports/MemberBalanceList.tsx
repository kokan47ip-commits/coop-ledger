import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { exportExcel, exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatMoney } from "@/lib/format";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type BalanceRow = {
  memberId: string;
  code: string;
  flatNo: string;
  name: string;
  isActive: boolean;
  opening: number;
  billed: number;
  received: number;
  closing: number;
  lastEntryDate: string | null;
};

/**
 * Date-wise member position lists, both driven by the same member-ledger
 * arithmetic (opening + bills − receipts):
 *  - "dues":    members with money OWED to the society  → Sundry Debtors (asset),
 *  - "advance": members who paid ahead of billing        → Advance from Members
 *    (liability) — received with nothing due, so it is money held, never income.
 * The two lists never net against each other, and their totals tie to the
 * Balance Sheet rows of the same names.
 */
export function MemberBalanceList({ kind }: { kind: "dues" | "advance" }) {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);

  const isDues = kind === "dues";
  const all = useQuery(
    api.api.memberBalances,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as BalanceRow[] | undefined;

  const rows = (all ?? [])
    .filter((r) => (isDues ? r.closing > 0.005 : r.closing < -0.005))
    .sort((a, b) => a.flatNo.localeCompare(b.flatNo, undefined, { numeric: true }) || a.name.localeCompare(b.name));

  const totals = rows.reduce(
    (t, r) => ({
      opening: t.opening + r.opening,
      billed: t.billed + r.billed,
      received: t.received + r.received,
      closing: t.closing + (isDues ? r.closing : -r.closing),
    }),
    { opening: 0, billed: 0, received: 0, closing: 0 },
  );

  const title = isDues ? "Member Dues" : "Member Advance";
  const subtitle = `For the period ${formatDate(from)} to ${formatDate(to)} — position as on ${formatDate(to)}`;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: isDues ? "Member Dues List" : "Member Advance List",
        subtitle,
        signatures,
      }
    : null;

  const buildTable = (): TableSpec => ({
    head: ["Flat No.", "Member", "Opening (₹)", "Billed (₹)", "Received (₹)", isDues ? "Due (₹)" : "Advance (₹)", "Last Entry"],
    body: rows.map((r) => [
      r.flatNo,
      r.name,
      r.opening,
      r.billed,
      r.received,
      isDues ? r.closing : -r.closing,
      r.lastEntryDate ? formatDate(r.lastEntryDate) : "—",
    ]),
    foot: [["", "TOTAL", totals.opening, totals.billed, totals.received, totals.closing, ""]],
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
  });

  const doExport = (k: "pdf" | "word" | "excel" | "print") => {
    if (!meta) return;
    const name = isDues ? "member-dues" : "member-advance";
    if (k === "pdf") exportPDF(meta, [buildTable()], `${name}.pdf`);
    else if (k === "word") exportWord(meta, [buildTable()], `${name}.doc`);
    else if (k === "excel") exportExcel(meta, [buildTable()], `${name}.xlsx`);
    else printTables(meta, [buildTable()]);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={title}
        description={
          isDues
            ? "Members with money owed to the society, date-wise — opening dues, bills raised and receipts received in the period, with the closing due as on the To date. This total appears as Sundry Debtors on the Balance Sheet."
            : "Members who have paid ahead of billing — money received while nothing (or less than the payment) was due, so it is held as a liability, not income. Date-wise, with the closing advance as on the To date. This total appears as Advance from Members under Current Liabilities on the Balance Sheet."
        }
      />

      <div className="panel mb-6 grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${kind}-from`}>From</Label>
          <Input id={`${kind}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${kind}-to`}>To</Label>
          <Input id={`${kind}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {all === undefined
            ? "Loading…"
            : `${rows.length} ${rows.length === 1 ? "member" : "members"} · ${isDues ? "total due" : "total advance"} ${formatMoney(totals.closing)}`}
        </p>
        {all !== undefined && rows.length > 0 && (
          <p className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            ✓ Ties to the Balance Sheet {isDues ? "(Sundry Debtors)" : "(Advance from Members)"}
          </p>
        )}
      </div>

      {all !== undefined && rows.length === 0 ? (
        <EmptyHint>
          {isDues
            ? "No member has dues outstanding as on this date."
            : "No member holds an advance as on this date."}
        </EmptyHint>
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-24">Flat No.</TableHead>
                <TableHead>Member</TableHead>
                <TableHead className="w-28 text-right">Opening (₹)</TableHead>
                <TableHead className="w-28 text-right">Billed (₹)</TableHead>
                <TableHead className="w-28 text-right">Received (₹)</TableHead>
                <TableHead className="w-28 text-right">{isDues ? "Due (₹)" : "Advance (₹)"}</TableHead>
                <TableHead className="w-28 text-right">Last Entry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.memberId}>
                  <TableCell className="font-mono text-xs">{r.flatNo}</TableCell>
                  <TableCell>
                    <span className="font-medium">{r.name}</span>
                    {!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.opening ? formatMoney(r.opening) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.billed ? formatMoney(r.billed) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.received ? formatMoney(r.received) : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(isDues ? r.closing : -r.closing)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.lastEntryDate ? formatDate(r.lastEntryDate) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 hover:bg-transparent">
                <TableCell colSpan={2} className="font-semibold">Total of all heads</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totals.opening)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totals.billed)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totals.received)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totals.closing)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
