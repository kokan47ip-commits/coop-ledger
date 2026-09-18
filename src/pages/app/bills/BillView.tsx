import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { exportPDF, exportWord, printTables, type TableSpec } from "@/lib/export";
import { formatDate, formatPeriod } from "@/lib/format";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";

export default function BillView() {
  const { billId } = useParams();
  const { societyId, society } = useSociety();
  const bill = useQuery(
    api.bills.list,
    societyId ? { societyId } : "skip",
  )?.find((b) => b._id === billId);
  const member = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  )?.find((m) => m._id === bill?.memberId);
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  );
  const accountName = (id: string) => {
    const a = accounts?.find((x) => x._id === id);
    return a ? `${a.code} — ${a.name}` : "—";
  };

  if (!societyId || !bill) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const m = member;
  const meta = {
    societyName: society?.name ?? "Society",
    societyAddress: [society?.address, society?.city, society?.state, society?.pincode]
      .filter(Boolean)
      .join(", "),
    registrationNo: society?.registrationNo,
    title: `Maintenance Bill — ${formatPeriod(bill.period)}`,
    subtitle: `Bill No: ${bill.billNo} · Issue: ${formatDate(bill.issueDate)} · Due: ${formatDate(bill.dueDate)}`,
  };

  const table: TableSpec = {
    head: ["#", "Charge head", "Income account", "Amount"],
    body: bill.lines.map((l, i) => [String(i + 1), l.name, accountName(l.accountId), l.amount]),
    foot: [["", "", "TOTAL", bill.total]],
    columnStyles: { 3: { halign: "right" } },
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (kind === "pdf") exportPDF(meta, [table], `${bill.billNo}.pdf`);
    else if (kind === "word") exportWord(meta, [table], `${bill.billNo}.doc`);
    else printTables(meta, [table]);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app/bills">
            <ArrowLeft className="size-4" /> Bill Register
          </Link>
        </Button>
        <div className="flex gap-2">
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

      <div className="rounded-lg border p-8">
        <div className="text-center">
          <h2 className="text-lg font-semibold tracking-tight">{society?.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {[society?.address, society?.city, society?.state, society?.pincode].filter(Boolean).join(", ")}
          </p>
          {society?.registrationNo && (
            <p className="text-xs text-muted-foreground">Reg. No: {society.registrationNo}</p>
          )}
        </div>
        <Separator className="my-6" />
        <div className="flex items-start justify-between gap-6">
          <div className="text-sm">
            <p className="font-medium">{m?.name ?? "Member"}</p>
            <p className="text-muted-foreground">
              {[m?.wing, m?.flatNo].filter(Boolean).join("-") || "—"}
            </p>
            <p className="text-muted-foreground">Code: {m?.code ?? "—"}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-mono text-xs text-muted-foreground">{bill.billNo}</p>
            <p className="text-muted-foreground">Period: {formatPeriod(bill.period)}</p>
            <p className="text-muted-foreground">Due: {formatDate(bill.dueDate)}</p>
            <p className="mt-1 inline-block rounded-none border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
              {bill.status}
            </p>
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 font-medium">Charge head</th>
              <th className="pb-2 text-right font-medium">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2.5">{l.name}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-foreground/70">
              <td className="pt-3 font-semibold">Total</td>
              <td className="pt-3 text-right font-semibold tabular-nums">
                {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(bill.total)}
              </td>
            </tr>
            <tr>
              <td className="pt-1 text-xs text-muted-foreground">Paid</td>
              <td className="pt-1 text-right text-xs tabular-nums text-muted-foreground">
                {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(bill.paidAmount)}
              </td>
            </tr>
            <tr>
              <td className="pt-1 font-medium">Balance due</td>
              <td className="pt-1 text-right font-medium tabular-nums">
                {new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(bill.total - bill.paidAmount)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Please pay before the due date to avoid late fees. This is a computer-generated bill.
        </p>
      </div>
    </div>
  );
}
