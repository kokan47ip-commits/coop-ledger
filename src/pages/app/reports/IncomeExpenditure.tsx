import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader, ReportLetterhead } from "@/components/PageParts";
import { exportExcel, exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate } from "@/lib/format";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Fragment, useState } from "react";
import { useQuery } from "convex/react";

type IERow = {
  code: string;
  name: string;
  credit: number;
  debit: number;
  printNo?: string;
  /** Form N section heading this ledger files under. */
  group?: string;
  /** Previous-year comparative figure (same side as credit/debit). */
  prev?: number;
  /** System-generated balancing account ("Income over Expenses" when the
   *  society is in surplus, "Expenses over Income" when in deficit) — no
   *  ledger behind it, printed last without a serial or heading. */
  system?: boolean;
};

type IEResult = {
  income: IERow[];
  expenditure: IERow[];
  totalIncome: number;
  totalExpenditure: number;
  surplus: number;
  /** Previous-year period totals for the comparative column. */
  prevTotalIncome: number;
  prevTotalExpenditure: number;
};

/** Group-band trigger: first row of a Form N heading — never on the system
 *  balancing account row, which carries no heading of its own. */
function bandHead(rows: IERow[], i: number): boolean {
  const r = rows[i];
  if (!r || r.system) return false;
  return i === 0 || rows[i - 1]!.group !== r.group;
}

/** Per-group subtotal of current-year figures (the statement TOTAL column);
 *  the system balancing row belongs to no group. */
function groupTotals(rows: IERow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.system) continue;
    const g = r.group ?? "";
    m.set(g, (m.get(g) ?? 0) + (r.credit || r.debit));
  }
  return m;
}

/** True when row i is the last ledger of its group — where the group's TOTAL
 *  prints. The system row has no group and bounds the last real group. */
function groupLast(rows: IERow[], i: number): boolean {
  const r = rows[i];
  if (!r || r.system) return false;
  const next = rows[i + 1];
  return !next || !!next.system || next.group !== r.group;
}

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n);

export default function IncomeExpenditure() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const period = effectiveFyPeriod(society);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  const ie = useQuery(
    api.api.incomeExpenditure,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as IEResult | undefined;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Income & Expenditure Statement",
        subtitle: `For the period ${formatDate(from)} to ${formatDate(to)}`,
        signatures,
      }
    : null;

  /** Form N table: Expenditure on the left, Income on the right. Columns per
   *  side run Previous Year | Particulars | Current Year | Total, with the
   *  prescribed headings as band rows and each group's TOTAL against its last
   *  ledger. The system account row ("Income over Expenses" / "Expenses over
   *  Income") balances the two sides, so the totals foot to the same figure. */
  const buildTable = (): TableSpec => {
    const exp = ie?.expenditure ?? [];
    const inc = ie?.income ?? [];
    const eTotals = groupTotals(exp);
    const cTotals = groupTotals(inc);
    const rows: (string | number)[][] = [];
    rows.push(["", "", "EXPENDITURE", "", "", "", "", "INCOME", "", ""]);
    const maxLen = Math.max(exp.length, inc.length);
    for (let i = 0; i < maxLen; i++) {
      const e = exp[i];
      const c = inc[i];
      const eHead = bandHead(exp, i);
      const cHead = bandHead(inc, i);
      if (eHead || cHead) {
        rows.push([
          "",
          "",
          eHead ? (e!.group ?? "").toUpperCase() : "",
          "",
          "",
          "",
          "",
          cHead ? (c!.group ?? "").toUpperCase() : "",
          "",
          "",
        ]);
      }
      rows.push([
        "",
        e ? (e.prev ?? 0) : "",
        e ? (e.system ? e.name : `    ${e.name}`) : "",
        e ? e.debit : "",
        e && groupLast(exp, i) ? (eTotals.get(e.group ?? "") ?? 0) : "",
        "",
        c ? (c.prev ?? 0) : "",
        c ? (c.system ? c.name : `    ${c.name}`) : "",
        c ? c.credit : "",
        c && groupLast(inc, i) ? (cTotals.get(c.group ?? "") ?? 0) : "",
      ]);
    }
    // The two sides foot to the same total — the balancing system account is
    // already part of the columns above. The same holds for the comparative
    // (previous-year) column.
    const foot = Math.max(ie?.totalIncome ?? 0, ie?.totalExpenditure ?? 0);
    const footPrev = Math.max(ie?.prevTotalIncome ?? 0, ie?.prevTotalExpenditure ?? 0);
    rows.push(["", footPrev, "Total", foot, "", "", footPrev, "Total", foot, ""]);
    return {
      head: [
        "",
        "Previous Year (₹)",
        "Expenditure",
        "Current Year (₹)",
        "Total",
        "",
        "Previous Year (₹)",
        "Income",
        "Current Year (₹)",
        "Total",
      ],
      body: rows,
      columnStyles: {
        1: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        6: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
      },
    };
  };

  const doExport = (kind: "pdf" | "word" | "excel" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "income-expenditure.pdf");
    else if (kind === "word") exportWord(meta, [table], "income-expenditure.doc");
    else if (kind === "excel") exportExcel(meta, [table], "income-expenditure.xlsx");
    else printTables(meta, [table]);
  };

  const eTotals = ie ? groupTotals(ie.expenditure) : new Map<string, number>();
  const cTotals = ie ? groupTotals(ie.income) : new Map<string, number>();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Income & Expenditure"
        description="Form N statement — expenditure and income on opposite sides, columns running Previous Year | Particulars | Current Year | Total. Every Chart of Accounts ledger is printed (0.00 when nil), group totals foot the Total column, and the resulting surplus or deficit balances the sides."
      />

      <div className="panel mb-8 grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="ie-from">From</Label>
          <Input id="ie-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ie-to">To</Label>
          <Input id="ie-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex items-end gap-2">
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

      {!ie ? null : (
        <div className="panel">
          <ReportLetterhead
            className="mx-0 mt-0"
            name={society?.name ?? ""}
            address={
              [society?.address, society?.city, society?.state, society?.pincode]
                .filter(Boolean)
                .join(", ") || undefined
            }
            registrationNo={society?.registrationNo}
            title="Income & Expenditure"
            subtitle={`For the period ${formatDate(from)} to ${formatDate(to)}`}
          />
          {/* Scroll frame: the report slides horizontally when wider than the
              screen, headings stay frozen, vertical bar stays in view. */}
          <div className="report-scroll">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="bg-[#312e81] text-xs font-semibold uppercase tracking-[0.14em] text-white">
                  <td className="w-32 px-3 py-2.5 text-right">Previous Year (₹)</td>
                  <td className="px-5 py-2.5">Expenditure</td>
                  <td className="w-36 px-5 py-2.5 text-right">Current Year (₹)</td>
                  <td className="w-28 px-5 py-2.5 text-right">Total</td>
                  <td className="w-32 border-l px-3 py-2.5 text-right">Previous Year (₹)</td>
                  <td className="border-l px-5 py-2.5">Income</td>
                  <td className="w-36 border-l px-5 py-2.5 text-right">Current Year (₹)</td>
                  <td className="w-28 border-l px-5 py-2.5 text-right">Total</td>
                </tr>
              </thead>
              <tbody>
                {Array.from({
                  length: Math.max(ie.expenditure.length, ie.income.length, 1),
                }).map((_, i) => {
                  const e = ie.expenditure[i];
                  const c = ie.income[i];
                  const eHead = bandHead(ie.expenditure, i);
                  const cHead = bandHead(ie.income, i);
                  return (
                    <Fragment key={i}>
                      {(eHead || cHead) && (
                        <tr className="border-y bg-indigo-50/60 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#312e81]/80">
                          <td />
                          <td className="px-5 py-1.5">{eHead ? (e!.group ?? "").toUpperCase() : ""}</td>
                          <td />
                          <td />
                          <td className="border-l" />
                          <td className="border-l px-5 py-1.5">{cHead ? (c!.group ?? "").toUpperCase() : ""}</td>
                          <td className="border-l" />
                          <td className="border-l" />
                        </tr>
                      )}
                      <tr
                        className={
                          e?.system || c?.system
                            ? "border-t-2 border-indigo-300 font-semibold text-[#312e81]"
                            : "border-b last:border-0"
                        }
                      >
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {e ? money(e.prev ?? 0) : ""}
                        </td>
                        <td className="px-5 py-2.5">{e?.name ?? ""}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{e ? money(e.debit) : ""}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {e && groupLast(ie.expenditure, i) ? money(eTotals.get(e.group ?? "") ?? 0) : ""}
                        </td>
                        <td className="border-l px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {c ? money(c.prev ?? 0) : ""}
                        </td>
                        <td className="border-l px-5 py-2.5">{c?.name ?? ""}</td>
                        <td className="border-l px-5 py-2.5 text-right tabular-nums">{c ? money(c.credit) : ""}</td>
                        <td className="border-l px-5 py-2.5 text-right tabular-nums">
                          {c && groupLast(ie.income, i) ? money(cTotals.get(c.group ?? "") ?? 0) : ""}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="border-t bg-indigo-50/70 font-semibold text-[#312e81]">
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {money(Math.max(ie.prevTotalIncome, ie.prevTotalExpenditure))}
                  </td>
                  <td className="px-5 py-2.5">Total</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {money(Math.max(ie.totalIncome, ie.totalExpenditure))}
                  </td>
                  <td />
                  <td className="border-l px-3 py-2.5 text-right tabular-nums">
                    {money(Math.max(ie.prevTotalIncome, ie.prevTotalExpenditure))}
                  </td>
                  <td className="border-l px-5 py-2.5">Total</td>
                  <td className="border-l px-5 py-2.5 text-right tabular-nums">
                    {money(Math.max(ie.totalIncome, ie.totalExpenditure))}
                  </td>
                  <td className="border-l" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
