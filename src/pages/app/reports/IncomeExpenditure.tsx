import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type IEResult = {
  income: { code: string; name: string; credit: number; printNo?: string }[];
  expenditure: { code: string; name: string; debit: number; printNo?: string }[];
  totalIncome: number;
  totalExpenditure: number;
  surplus: number;
};

/** Statement serial: the user-defined Print No., else the running position. */
function serialOf(printNo: string | undefined, position: number): string {
  return printNo ?? String(position);
}

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

  const buildTable = (): TableSpec => {
    const rows: (string | number)[][] = [];
    rows.push(["", "", "INCOME", "", ""]);
    (ie?.income ?? []).forEach((r, i) =>
      rows.push(["", serialOf(r.printNo, i + 1), `    ${r.name}`, "", r.credit]),
    );
    rows.push(["", "", "Total Income", "", ie?.totalIncome ?? 0]);
    rows.push(["", "", "", "", ""]);
    rows.push(["", "", "EXPENDITURE", "", ""]);
    (ie?.expenditure ?? []).forEach((r, i) =>
      rows.push(["", serialOf(r.printNo, i + 1), `    ${r.name}`, r.debit, ""]),
    );
    rows.push(["", "", "Total Expenditure", ie?.totalExpenditure ?? 0, ""]);
    rows.push(["", "", "", "", ""]);
    rows.push(["", "", ie && ie.surplus >= 0 ? "Surplus for the period" : "Deficit for the period", "", Math.abs(ie?.surplus ?? 0)]);
    return {
      head: ["", "S.No.", "Particulars", "Amount (₹)", "Amount (₹)"],
      body: rows,
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "income-expenditure.pdf");
    else if (kind === "word") exportWord(meta, [table], "income-expenditure.doc");
    else printTables(meta, [table]);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Income & Expenditure"
        description="Revenue and operating expenses for the selected period with the resulting surplus or deficit."
      />

      <div className="mb-8 grid gap-4 rounded-lg border p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="ie-from">From</Label>
          <Input id="ie-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ie-to">To</Label>
          <Input id="ie-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" onClick={() => doExport("pdf")}>
            <Download className="size-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("word")}>
            <FileText className="size-4" /> Word
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("print")}>
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      {!ie ? null : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b bg-accent/40">
                <td colSpan={2} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]">Income</td>
                <td />
                <td className="w-44" />
              </tr>
              {ie.income.length === 0 && (
                <tr><td className="px-5 py-2 text-muted-foreground" colSpan={3}>No income recorded</td><td className="text-right px-5">—</td></tr>
              )}
              {ie.income.map((r, i) => (
                <tr key={r.code + r.name} className="border-b last:border-0">
                  <td className="w-16 px-5 py-2.5 font-mono text-xs text-muted-foreground">{r.code}</td>
                  <td className="w-14 px-2 py-2.5 text-center font-mono text-xs">{serialOf(r.printNo, i + 1)}</td>
                  <td className="px-0 py-2.5">{r.name}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(r.credit)}
                  </td>
                </tr>
              ))}
              <tr className="border-b-2 border-foreground/50 font-medium">
                <td />
                <td />
                <td className="px-0 py-2.5">Total Income</td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(ie.totalIncome)}
                </td>
              </tr>

              <tr className="border-b bg-accent/40">
                <td colSpan={2} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]">Expenditure</td>
                <td />
                <td />
              </tr>
              {ie.expenditure.length === 0 && (
                <tr><td className="px-5 py-2 text-muted-foreground" colSpan={3}>No expenditure recorded</td><td className="text-right px-5">—</td></tr>
              )}
              {ie.expenditure.map((r, i) => (
                <tr key={r.code + r.name} className="border-b last:border-0">
                  <td className="w-16 px-5 py-2.5 font-mono text-xs text-muted-foreground">{r.code}</td>
                  <td className="w-14 px-2 py-2.5 text-center font-mono text-xs">{serialOf(r.printNo, i + 1)}</td>
                  <td className="px-0 py-2.5">{r.name}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(r.debit)}
                  </td>
                </tr>
              ))}
              <tr className="border-b-2 border-foreground/50 font-medium">
                <td />
                <td />
                <td className="px-0 py-2.5">Total Expenditure</td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(ie.totalExpenditure)}
                </td>
              </tr>

              <tr className="bg-accent/30 text-base font-semibold">
                <td />
                <td />
                <td className="px-0 py-4">
                  {ie.surplus >= 0 ? "Surplus for the period" : "Deficit for the period"}
                </td>
                <td className="px-5 py-4 text-right tabular-nums">
                  {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(Math.abs(ie.surplus))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
