import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader, ReportLetterhead } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type RPResult = {
  openingCash: number;
  inflows: { name: string; amount: number; printNo?: string }[];
  outflows: { name: string; amount: number; printNo?: string }[];
  totalIn: number;
  totalOut: number;
  closingCash: number;
};

/** Statement serial: the user-defined Print No., else the running position. */
function serialOf(printNo: string | undefined, position: number): string {
  return printNo ?? String(position);
}

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n);

export default function ReceiptPayment() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
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
        signatures,
      }
    : null;

  const buildTable = (): TableSpec => {
    const rows: (string | number)[][] = [];
    rows.push(["", "", "RECEIPTS", "", "", "PAYMENTS", ""]);
    rows.push(["", "", "Opening cash & bank balance", rp?.openingCash ?? 0, "", "", ""]);
    (rp?.inflows ?? []).forEach((r, i) =>
      rows.push(["", serialOf(r.printNo, i + 1), `    ${r.name}`, r.amount, "", "", ""]),
    );
    rows.push(["", "", "Total receipts", rp?.totalIn ?? 0, "", "", ""]);
    (rp?.outflows ?? []).forEach((r, i) =>
      rows.push(["", "", "", "", serialOf(r.printNo, i + 1), `    ${r.name}`, r.amount]),
    );
    rows.push(["", "", "", "", "", "Total payments", rp?.totalOut ?? 0]);
    rows.push(["", "", "", "", "", "Closing cash & bank balance", rp?.closingCash ?? 0]);
    return {
      head: ["", "S.No.", "Receipts", "Amount (₹)", "S.No.", "Payments", "Amount (₹)"],
      body: rows,
      columnStyles: { 3: { halign: "right" }, 6: { halign: "right" } },
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

      <div className="panel mb-8 grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="rp-from">From</Label>
          <Input id="rp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rp-to">To</Label>
          <Input id="rp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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

      {!rp ? null : (
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
            title="Receipt & Payment"
            subtitle={`For the period ${formatDate(from)} to ${formatDate(to)}`}
          />
          {/* Scroll frame: slides horizontally when wider than the screen;
              column headings stay frozen while rows scroll. */}
          <div className="report-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#312e81] text-xs font-semibold uppercase tracking-[0.14em] text-white">
                <td className="px-5 py-2.5">Receipts</td>
                <td className="w-12 px-2 py-2.5 text-center">S.No.</td>
                <td className="w-48 px-5 py-2.5 text-right">Amount (₹)</td>
                <td className="border-l px-5 py-2.5">Payments</td>
                <td className="w-12 px-2 py-2.5 text-center">S.No.</td>
                <td className="w-48 border-l px-5 py-2.5 text-right">Amount (₹)</td>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-slate-50">
                <td className="px-5 py-2.5 font-medium">Opening cash & bank balance</td>
                <td />
                <td className="px-5 py-2.5 text-right tabular-nums">{money(rp.openingCash)}</td>
                <td className="border-l" />
                <td />
                <td className="border-l" />
              </tr>
              {rp.inflows.map((r, i) => (
                <tr key={"in" + r.name} className="border-b last:border-0">
                  <td className="px-5 py-2.5 pl-8 text-muted-foreground">{r.name}</td>
                  <td className="w-12 px-2 py-2.5 text-center font-mono text-xs">{serialOf(r.printNo, i + 1)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="border-l" />
                  <td />
                  <td className="border-l" />
                </tr>
              ))}
              <tr className="bg-indigo-50/70 font-semibold text-[#312e81]">
                <td className="px-5 py-2.5">Total receipts</td>
                <td />
                <td className="px-5 py-2.5 text-right tabular-nums">{money(rp.totalIn)}</td>
                <td className="border-l" />
                <td />
                <td className="border-l" />
              </tr>
              {rp.outflows.map((r, i) => (
                <tr key={"out" + r.name} className="border-b last:border-0">
                  <td />
                  <td />
                  <td />
                  <td className="border-l px-5 py-2.5 pl-8 text-muted-foreground">{r.name}</td>
                  <td className="w-12 px-2 py-2.5 text-center font-mono text-xs">{serialOf(r.printNo, i + 1)}</td>
                  <td className="border-l px-5 py-2.5 text-right tabular-nums">{money(r.amount)}</td>
                </tr>
              ))}
              <tr className="bg-indigo-50/70 font-semibold text-[#312e81]">
                <td />
                <td />
                <td />
                <td className="border-l px-5 py-2.5 font-medium">Total payments</td>
                <td />
                <td className="border-l px-5 py-2.5 text-right tabular-nums">{money(rp.totalOut)}</td>
              </tr>
              <tr className="bg-[#312e81] text-base font-semibold text-white">
                <td className="px-5 py-4">Closing cash & bank balance</td>
                <td />
                <td className="px-5 py-4 text-right tabular-nums">{money(rp.closingCash)}</td>
                <td className="border-l" />
                <td />
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
