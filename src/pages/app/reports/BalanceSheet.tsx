import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { formatDate, fyEndISO } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type Row = { code: string; name: string; amount: number };
type BSResult = {
  assets: Row[];
  liabilities: Row[];
  totalAssets: number;
  totalLiabilities: number;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n);

export default function BalanceSheet() {
  const { societyId, society } = useSociety();
  const [to, setTo] = useState(fyEndISO());

  const bs = useQuery(
    api.api.balanceSheet,
    societyId ? { societyId, toDate: to } : "skip",
  ) as BSResult | undefined;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Balance Sheet",
        subtitle: `As at ${formatDate(to)}`,
      }
    : null;

  const buildTable = (): TableSpec => {
    const rows: (string | number)[][] = [];
    const maxLen = Math.max(bs?.assets.length ?? 0, bs?.liabilities.length ?? 0);
    rows.push(["", "LIABILITIES & FUNDS", "Amount (₹)", "ASSETS", "Amount (₹)"]);
    for (let i = 0; i < maxLen; i++) {
      const li = bs?.liabilities[i];
      const a = bs?.assets[i];
      rows.push([
        "",
        li ? `    ${li.name}` : "",
        li ? li.amount : "",
        a ? `    ${a.name}` : "",
        a ? a.amount : "",
      ]);
    }
    rows.push(["", "Total", bs?.totalLiabilities ?? 0, "", bs?.totalAssets ?? 0]);
    return {
      head: ["", "Liabilities & Funds", "Amount (₹)", "Assets", "Amount (₹)"],
      body: rows,
      columnStyles: { 2: { halign: "right" }, 4: { halign: "right" } },
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "balance-sheet.pdf");
    else if (kind === "word") exportWord(meta, [table], "balance-sheet.doc");
    else printTables(meta, [table]);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Balance Sheet"
        description="Position of funds and assets as on the selected date, including the year's surplus carried to funds."
      />

      <div className="mb-8 grid gap-4 rounded-lg border p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="bs-to">As on</Label>
          <Input id="bs-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex items-end justify-end gap-2">
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

      {!bs ? null : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-accent/40 text-xs font-semibold uppercase tracking-[0.14em]">
                <td className="px-5 py-2.5">Liabilities & Funds</td>
                <td className="w-48 px-5 py-2.5 text-right">Amount (₹)</td>
                <td className="border-l px-5 py-2.5">Assets</td>
                <td className="w-48 border-l px-5 py-2.5 text-right">Amount (₹)</td>
              </tr>
            </thead>
            <tbody>
              {Array.from({
                length: Math.max(bs.assets.length, bs.liabilities.length, 1),
              }).map((_, i) => {
                const li = bs.liabilities[i];
                const a = bs.assets[i];
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-5 py-2.5">{li?.name ?? ""}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{li ? money(li.amount) : ""}</td>
                    <td className="border-l px-5 py-2.5">{a?.name ?? ""}</td>
                    <td className="border-l px-5 py-2.5 text-right tabular-nums">{a ? money(a.amount) : ""}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-foreground/50 text-base font-semibold">
                <td className="px-5 py-4">Total</td>
                <td className="px-5 py-4 text-right tabular-nums">{money(bs.totalLiabilities)}</td>
                <td className="border-l px-5 py-4">Total</td>
                <td className="border-l px-5 py-4 text-right tabular-nums">{money(bs.totalAssets)}</td>
              </tr>
            </tbody>
          </table>
          {Math.abs(bs.totalAssets - bs.totalLiabilities) > 0.01 && (
            <p className="border-t bg-destructive/5 px-5 py-3 text-xs text-destructive">
              Difference of {money(Math.abs(bs.totalAssets - bs.totalLiabilities))} — check opening balances
              and the receivable account configuration.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
