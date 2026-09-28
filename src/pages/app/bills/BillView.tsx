import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { billPdf, billPrint, billWord, periodLabelLong, type LegacyBillData } from "@/lib/billDoc";
import { amountInWords } from "@/lib/amountWords";
import { formatDate } from "@/lib/format";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { toast } from "sonner";

export default function BillView() {
  const { billId } = useParams();
  const { societyId, society } = useSociety();
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip");
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip");
  const tariffs = useQuery(api.tariffs.list, societyId ? { societyId } : "skip");

  const bill = bills?.find((b) => b._id === billId);
  const m = members?.find((x) => x._id === bill?.memberId);

  if (!societyId || !bill || !society) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Arrears: earlier-period unpaid balances plus any carried opening line on
  // this bill. Current charge lines are everything else.
  // Non-charge lines: carried opening balance (arrears or credit/advance).
  const isArrearsLine = (name: string) => {
    const n = name.toLowerCase();
    return n.startsWith("arrears") || n.startsWith("credit balance");
  };
  const arrears =
    (bills ?? [])
      .filter((b) => b.memberId === bill.memberId && b.period < bill.period)
      .reduce((s, b) => s + (b.total - b.paidAmount), 0) +
    (bill.lines ?? [])
      .filter((l) => isArrearsLine(l.name))
      .reduce((s, l) => s + l.amount, 0);
  const currentCharges = (bill.lines ?? [])
    .filter((l) => !isArrearsLine(l.name))
    .reduce((s, l) => s + l.amount, 0);

  const data: LegacyBillData = {
    society: {
      name: society.name,
      address: [society.address, society.city, society.state, society.pincode]
        .filter(Boolean)
        .join(", "),
      registrationNo: society.registrationNo,
    },
    billNo: bill.billNo.replace(/^BILL-/, ""),
    billDate: bill.issueDate,
    dueDate: bill.dueDate,
    periodLabel: periodLabelLong(bill.period),
    memberName: m?.name ?? "Member",
    flatNo: [m?.wing, m?.flatNo].filter(Boolean).join("-") || undefined,
    lines: (bill.lines ?? [])
      .filter((l) => !isArrearsLine(l.name))
      // Print the tariff's full head name — bills saved before full-name
      // printing carry the short name on the line itself.
      .map((l) => ({
        name: (l.tariffId && tariffs?.find((t) => t._id === l.tariffId)?.name) || l.name,
        amount: l.amount,
        serial: l.printNo,
      })),
    total: currentCharges,
    arrears,
    totalDue: currentCharges + arrears,
    paidAmount: bill.paidAmount,
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    try {
      if (kind === "pdf") billPdf(data, `${bill.billNo}.pdf`);
      else if (kind === "word") billWord(data, `${bill.billNo}.doc`);
      else billPrint(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const fmt = (n: number) => n.toFixed(2);

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

      {/* On-screen legacy bill */}
      <div className="rounded-lg border border-foreground/40">
        <div className="px-6 pt-6 pb-2 text-center">
          <h2 className="text-base font-bold uppercase tracking-tight">{society.name}</h2>
          {society.registrationNo && <p className="mt-1 text-xs">{society.registrationNo}</p>}
          <p className="mt-1 text-xs">
            {[society.address, society.city, society.state, society.pincode]
              .filter(Boolean)
              .join(", ")}
          </p>
          <p className="mt-2 border-y border-foreground/40 py-1.5 text-sm font-bold">
            Bill for the Month of {periodLabelLong(bill.period)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-10 px-6 py-3 text-sm">
          <div className="space-y-1.5">
            <p>
              <span className="text-muted-foreground">Bill No:</span>{" "}
              <span className="font-bold">{bill.billNo.replace(/^BILL-/, "")}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Name:</span>{" "}
              <span className="font-bold uppercase">{m?.name ?? "Member"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Flat</span>{" "}
              <span className="font-medium">
                {[m?.wing, m?.flatNo].filter(Boolean).join("-") || "—"}
              </span>
            </p>
          </div>
          <div className="space-y-1.5 text-right">
            <p>
              <span className="text-muted-foreground">Bill Date:</span>{" "}
              {formatDate(bill.issueDate)}
            </p>
            <p>
              <span className="text-muted-foreground">Due Date:</span> {formatDate(bill.dueDate)}
            </p>
            {bill.arrearsDate && (
              <p className="text-xs text-muted-foreground">
                Arrears as on: {formatDate(bill.arrearsDate)}
              </p>
            )}
          </div>
        </div>

        <table className="w-full border-t border-foreground/40 text-sm">
          <thead>
            <tr className="border-b border-foreground/40">
              <th className="px-6 py-1.5 text-left font-bold tracking-[0.2em]">PARTICULARS</th>
              <th className="px-4 py-1.5 text-right font-bold tracking-[0.2em]">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-6 py-1">
                  {i + 1}. {l.name.toUpperCase()}
                </td>
                <td className="px-4 py-1 text-right tabular-nums">{fmt(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-[1fr_190px] border-t border-foreground/40 text-sm">
          <div className="border-r border-foreground/40 px-6 py-3">
            Rupees: {amountInWords(data.totalDue)} Only
          </div>
          <div>
            <div className="flex justify-between px-4 py-1">
              <span className="text-muted-foreground">Total:</span>
              <span className="tabular-nums">{fmt(data.total)}</span>
            </div>
            <div className="flex justify-between px-4 py-1">
              <span className="text-muted-foreground">Arrears</span>
              <span className="tabular-nums">{fmt(data.arrears)}</span>
            </div>
            <div className="flex justify-between border-t border-foreground/40 px-4 py-1.5 font-bold">
              <span>Total Due:</span>
              <span className="tabular-nums">{fmt(data.totalDue)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-foreground/40 text-[11px]">
          <div className="space-y-1 border-r border-foreground/40 px-6 py-3 text-muted-foreground">
            <p>PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.</p>
            <p>THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH</p>
            <p>LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH</p>
          </div>
          <div className="px-6 py-3 text-right">
            <p className="text-xs font-bold">For {society.name}</p>
            <p className="mt-10 text-[11px] tracking-wide">SECRETARY</p>
          </div>
        </div>
      </div>

      <div className="mt-6 border-b-2 border-dashed border-muted-foreground/40" />
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        {bill.status === "paid"
          ? "Paid in full — thank you."
          : `Paid so far: ${fmt(bill.paidAmount)} · Balance against this bill: ${fmt(bill.total - bill.paidAmount)}`}
      </p>
    </div>
  );
}
