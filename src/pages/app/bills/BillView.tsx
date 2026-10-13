import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { billPdf, billPrint, billWord, buildMemberLedgerRows, periodLabelLong, type LegacyBillData } from "@/lib/billDoc";
import { amountUpiUri, memberUpiUri, preloadQrImage } from "@/lib/upiQr";
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
  const vouchers = useQuery(api.vouchers.list, societyId ? { societyId } : "skip");

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

  // This member's most recent receipt issued on/before the bill's own date —
  // fills the snapshot's "Received" column and the printed receipt strip.
  const lastReceiptFor = (memberId: string, issueDate: string) => {
    const rcpt = (vouchers ?? [])
      .filter(
        (v) =>
          v.type === "member_receipt" &&
          v.memberId === memberId &&
          v.date <= issueDate,
      )
      .sort((x, y) => y.date.localeCompare(x.date))[0];
    return rcpt
      ? { no: rcpt.voucherNo, date: rcpt.date, amount: rcpt.total, mode: rcpt.mode }
      : undefined;
  };

  const data: LegacyBillData = {
    society: {
      name: society.name,
      address: [society.address, society.city, society.state, society.pincode]
        .filter(Boolean)
        .join(", "),
      registrationNo: society.registrationNo,
    },
    billNo: bill.billNo.replace(/^BILL-/, ""),
    period: bill.period,
    fyStartMonth: society.fyStartMonth,
    unitType: m?.unitType,
    lastReceipt: lastReceiptFor(bill.memberId, bill.issueDate),
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
    // Printed late-fee note follows the society's stable rate setting.
    lateFeePercent: society.lateFeePercent,
    // Society-wide printing format + editable QR-side payment notes.
    format: society.billDocFormat,
    qrNote: society.billQrNote,
    // Side-ledger column ("Bill + Member Ledger"): this member's running
    // ledger built from the register's bills + receipt vouchers.
    ledgerRows: buildMemberLedgerRows(
      [
        ...(bills ?? []).flatMap((x) =>
          x.memberId === bill.memberId
            ? [{
                kind: "bill" as const,
                date: x.issueDate,
                ref: x.billNo,
                amount: (x.lines ?? [])
                  .filter((l) => !isArrearsLine(l.name))
                  .reduce((s, l) => s + l.amount, 0),
              }]
            : [],
        ),
        ...(vouchers ?? [])
          .filter((v) => v.type === "member_receipt" && v.memberId === bill.memberId)
          .map((v) => ({
            kind: "receipt" as const,
            date: v.date,
            ref: v.voucherNo,
            amount: v.total,
          })),
      ],
      m?.openingBalance ?? 0,
      bill.issueDate,
    ),
    // Supplementary bills print with a "SUPPLEMENTARY BILL" title band
    // instead of the monthly period band.
    supplementary:
      (bill as { billKind?: string }).billKind === "supplementary"
        ? { category: (bill as { category?: string }).category }
        : undefined,
    // Bill QR: pays this bill's exact due amount into the society's UPI ID,
    // tagged with the flat so the office can match the payment.
    upi: society.upiVpa
      ? {
          uri: memberUpiUri({
            payeeName: society.name,
            vpa: society.upiVpa,
            flat: [m?.wing, m?.flatNo].filter(Boolean).join("-") || undefined,
            code: m?.code,
          }),
          amount: currentCharges + arrears,
        }
      : undefined,
  };

  const doExport = async (kind: "pdf" | "word" | "print") => {
    try {
      // Word/print embed the QR as an image — cache it before rendering.
      // (The PDF path draws the QR synchronously from the module matrix.)
      if (data.upi && kind !== "pdf") {
        await preloadQrImage(amountUpiUri(data.upi.uri, data.upi.amount));
      }
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

      {/* On-screen bill — mirrors the printed PDF layout */}
      <div className="doc-sheet">
        <div className="bg-[#312e81] px-6 py-5 text-center text-white">
          <h2 className="text-lg font-bold uppercase tracking-wide">{society.name}</h2>
          {society.registrationNo && (
            <p className="mt-1 text-xs text-indigo-200">{society.registrationNo}</p>
          )}
          <p className="mt-1 text-xs text-indigo-200">
            {[society.address, society.city, society.state, society.pincode]
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
        <div className="h-[3px] bg-[#b45309]" />

        <p className="bg-indigo-50 py-2.5 text-center text-sm font-bold tracking-[0.06em] text-[#312e81]">
          BILL FOR THE MONTH OF {periodLabelLong(bill.period).toUpperCase()}
        </p>

        <div className="grid grid-cols-2 gap-x-10 border-b border-slate-200 bg-slate-50 px-6 py-4 text-sm">
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

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#312e81] text-white">
              <th className="px-6 py-2 text-left font-bold tracking-[0.2em]">PARTICULARS</th>
              <th className="px-6 py-2 text-right font-bold tracking-[0.2em]">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i} className={i % 2 === 1 ? "bg-slate-50" : undefined}>
                <td className="border-b border-indigo-50 px-6 py-2">
                  {i + 1}. {l.name.toUpperCase()}
                </td>
                <td className="border-b border-indigo-50 px-6 py-2 text-right tabular-nums">
                  {fmt(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-[1fr_210px] border-t border-slate-300 text-sm">
          <div className="px-6 py-4 text-xs italic leading-5 text-slate-500">
            Rupees: {amountInWords(data.totalDue)} Only
          </div>
          <div className="border-l border-slate-200">
            <div className="flex justify-between border-b border-slate-200 px-4 py-2">
              <span className="text-slate-500">Total:</span>
              <span className="tabular-nums">{fmt(data.total)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200 px-4 py-2">
              <span className="text-slate-500">{data.arrears < 0 ? "Advance:" : "Arrears:"}</span>
              <span className="tabular-nums">{fmt(Math.abs(data.arrears))}</span>
            </div>
            <div className="flex justify-between bg-[#312e81] px-4 py-2.5 font-bold text-white">
              <span>Total Due:</span>
              <span className="tabular-nums">{fmt(data.totalDue)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-slate-300 bg-slate-50 text-[11px]">
          <div className="space-y-1.5 border-r border-slate-200 px-6 py-4 text-slate-500">
            <p>PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.</p>
            <p>THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH</p>
            <p>LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH</p>
          </div>
          <div className="px-6 py-4 text-right">
            <p className="text-xs font-bold text-[#312e81]">For {society.name}</p>
            <p className="mt-10 text-[11px] tracking-wide text-slate-500">SECRETARY</p>
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
