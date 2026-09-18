import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { effectiveFyPeriod, formatDate } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type RPResult = {
  openingCash: number;
  inflows: { name: string; amount: number }[];
  outflows: { name: string; amount: number }[];
  totalIn: number;
  totalOut: number;
  closingCash: number;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n);

export default function ReceiptPayment() {
  const { societyId, society } = useSociety();
  const period = effectiveFyPeriod(society);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  const rp = useQuery(
    api.api.receiptPayment,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as RPResult | undefined;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Receipt & Payment Account",
        subtitle: `For the period ${formatDate(from)} to ${formatDate(to)}`,
      }
    : null;

  const buildTable = (): TableSpec => {
    const rows: (string | number)[][] = [];
    rows.push(["", "RECEIPTS", "", "PAYMENTS", ""]);
    rows.push(["", "Opening cash & bank balance", rp?.openingCash ?? 0, "", ""]);
    for (const r of rp?.inflows ?? []) rows.push(["", `    ${r.name}`, r.amount, "", ""]);
    rows.push(["", "Total receipts", rp?.totalIn ?? 0, "", ""]);
    for (const r of rp?.outflows ?? []) rows.push(["", "", "", `    ${r.name}`, r.amount]);
    rows.push(["", "", "", "Total payments", rp?.totalOut ?? 0]);
    rows.push(["", "", "", "Closing cash & bank balance", rp?.closingCash ?? 0]);
    return {
      head: ["", "Receipts", "Amount (₹)", "Payments", "Amount (₹)"],
      body: rows,
      columnStyles: { 2: { halign: "right" }, 4: { halign: "right" } },
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "receipt-payment.pdf");
    else if (kind === "word") exportWord(meta, [table], "receipt-payment.doc");
    else printTables(meta, [table]);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Receipt & Payment"
        description="Cash-basis summary of money in and money out through bank and cash accounts, including opening and closing balances."
      />

      <div className="mb-8 grid gap-4 rounded-lg border p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="rp-from">From</Label>
          <Input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rp-to">To</Label>
          <Input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex items-end justify-end gap-2">
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

      {!rp ? null : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-accent/40 text-xs font-semibold uppercase tracking-[0.14em]">
                <td className="px-5 py-2.5">Receipts</td>
                <td className="w-48 px-5 py-2.5 text-right">Amount (₹)</td>
                <td className="border-l px-5 py-2.5">Payments</td>
                <td className="w-48 border-l px-5 py-2.5 text-right">Amount (₹)</td>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-accent/30">
                <td className="px-5 py-2.5 font-medium">Opening cash & bank balance</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{money(rp.openingCash)}</td>
                <td className="border-l" />
                <td className="border-l" />
              </tr>
              {rp.inflows.map((r) => (
                <tr key={"in" + r.name} className="border-b last:border-0">
                  <td className="px-5 py-2.5 pl-8 text-muted-foreground">{r.name}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="border-l" />
                  <td className="border-l" />
                </tr>
              ))}
              <tr className="border-b-2 border-foreground/40 font-medium">
                <td className="px-5 py-2.5">Total receipts</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{money(rp.totalIn)}</td>
                <td className="border-l" />
                <td className="border-l" />
              </tr>
              {rp.outflows.map((r) => (
                <tr key={"out" + r.name} className="border-b last:border-0">
                  <td />
                  <td />
                  <td className="border-l px-5 py-2.5 pl-8 text-muted-foreground">{r.name}</td>
                  <td className="border-l px-5 py-2.5 text-right tabular-nums">{money(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-b-2 border-foreground/40 font-medium">
                <td />
                <td />
                <td className="border-l px-5 py-2.5 font-medium">Total payments</td>
                <td className="border-l px-5 py-2.5 text-right tabular-nums">{money(rp.totalOut)}</td>
              </tr>
              <tr className="border-t bg-accent/30 text-base font-semibold">
                <td className="px-5 py-4">Closing cash & bank balance</td>
                <td className="px-5 py-4 text-right tabular-nums">{money(rp.closingCash)}</td>
                <td className="border-l" />
                <td className="border-l" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
