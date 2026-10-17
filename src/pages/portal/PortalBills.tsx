import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import PortalFlatSelect, {
  usePortalFlatId,
  usePortalFlatIdentity,
} from "@/components/PortalFlatSelect";
import { IconTile, PageHeader } from "@/components/PageParts";
import {
  billPdf,
  billPrint,
  billWord,
  periodLabelLong,
  type LegacyBillData,
} from "@/lib/billDoc";
import { amountUpiUri, memberUpiUri, preloadQrImage } from "@/lib/upiQr";
import { formatDate, formatMoney } from "@/lib/format";
import {
  CalendarRange,
  Download,
  FileText,
  Printer,
  TriangleAlert,
} from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type Bill = Doc<"bills">;

export default function PortalBills() {
  const { societyId, society } = useSociety();
  // Multi-flat logins choose the flat in the portal selector (?flat=…); the
  // identity below follows that choice, so bills and headers name the flat
  // being viewed.
  const memberBinding = usePortalFlatIdentity();
  const flat = usePortalFlatId();
  const bills = useQuery(
    api.memberPortal.myBills,
    societyId ? { societyId, memberId: flat } : "skip",
  ) as Bill[] | null | undefined;
  // Self-diagnosis when the list is empty OR the login has no flat binding —
  // shows what the login is actually bound to and where the bills are.
  const debug = useQuery(
    api.memberPortal.debugMyBinding,
    societyId && (bills === null || (bills ?? []).length === 0) ? { societyId } : "skip",
  );
  // Side-ledger source ("Bill + Member Ledger" format): the member's own
  // running ledger for the current financial year — the authoritative source
  // the portal ledger page uses.
  const today = new Date().toISOString().slice(0, 10);
  const ledger = useQuery(
    api.memberPortal.myLedger,
    societyId
      ? {
          societyId,
          memberId: flat,
          fromDate: society?.fyStartDate ?? `${today.slice(0, 4)}-01-01`,
          toDate: today,
        }
      : "skip",
  );
  const debugText = debug
    ? [
        debug.email ? `Signed in as ${debug.email}.` : "Not signed in with an email.",
        debug.bound
          ? `This login is linked to flat ${debug.bound.flat ?? "?"} (${debug.bound.isActive ? "active" : "inactive member row"}) which has ${debug.bound.bills} bill(s).`
          : "No flat is linked to this login (no member-portal grant, or its flat no longer matches any member).",
        debug.resolved
          ? `This session currently resolves to ${debug.resolved.name} (flat ${debug.resolved.flat}) — ${debug.resolved.bills} bill(s). ${debug.resolvedBy ?? ""}`
          : "This session does not resolve to any flat right now.",
        debug.emailMatch
          ? `A member row carrying this email (${debug.emailMatch.flat}) holds ${debug.emailMatch.bills} bill(s).`
          : "",
        debug.billsOnActiveMembers > 0
          ? `${debug.billsOnActiveMembers} bill(s) exist across ${debug.activeMembers} active member(s) — the office should re-grant the portal login and pick the flat that has bills.`
          : `No bills exist on any of the ${debug.activeMembers} active member(s) — bills were not generated yet (or every member is exempt).`,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const buildData = (bill: Bill): LegacyBillData => {
    // Non-charge lines: carried opening balance (arrears or credit/advance).
    const isArrearsLine = (name: string) => {
      const n = name.toLowerCase();
      return n.startsWith("arrears") || n.startsWith("credit balance");
    };
    const arrears =
      (bills ?? [])
        .filter((b) => b.period < bill.period)
        .reduce((s, b) => s + (b.total - b.paidAmount), 0) +
      (bill.lines ?? [])
        .filter((l) => isArrearsLine(l.name))
        .reduce((s, l) => s + l.amount, 0);
    const currentCharges = (bill.lines ?? [])
      .filter((l) => !isArrearsLine(l.name))
      .reduce((s, l) => s + l.amount, 0);
    const flatLabel =
      [memberBinding?.wing, memberBinding?.flatNo].filter(Boolean).join("-") ||
      memberBinding?.code;
    return {
      society: {
        name: society?.name ?? "",
        address: [
          society?.address,
          society?.city,
          society?.state,
          society?.pincode,
        ]
          .filter(Boolean)
          .join(", "),
        registrationNo: society?.registrationNo,
      },
      billNo: bill.billNo.replace(/^BILL-/, ""),
      period: bill.period,
      fyStartMonth: society?.fyStartMonth,
      // The portal binding row carries only name/flat fields; unit type
      // comes from the members table, which the portal doesn't subscribe to.
      unitType: undefined,
      // Snapshot "Received" / receipt strip feed from the same myLedger rows
      // the side column already displays: the member's latest credit entry
      // dated on/before this bill's issue (within the current FY window).
      billDate: bill.issueDate,
      dueDate: bill.dueDate,
      periodLabel: periodLabelLong(bill.period),
      memberName: memberBinding?.name ?? "Member",
      flatNo: flatLabel,
      lines: (bill.lines ?? [])
        .filter((l) => !isArrearsLine(l.name))
        .map((l) => ({ name: l.name, amount: l.amount, serial: l.printNo })),
      total: currentCharges,
      arrears,
      totalDue: currentCharges + arrears,
      paidAmount: bill.paidAmount,
      // Printed late-fee note follows the society's stable rate setting.
      lateFeePercent: society?.lateFeePercent,
      // Society-wide printing format + editable QR-side payment notes.
      format: society?.billDocFormat,
      qrNote: society?.billQrNote,
      // Side-ledger column: the portal's own running ledger rows, mapped
      // straight into the document's ledger shape.
      ledgerRows: (ledger ?? []).map((r) => ({
        date: r.date,
        ref: r.voucherNo,
        detail: r.particulars,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
      })),
      lastReceipt: (ledger ?? [])
        .filter(
          (r) =>
            r.credit > 0 &&
            r.voucherNo !== "OPENING" &&
            (!bill.issueDate || r.date <= bill.issueDate),
        )
        .slice(-1)
        .map((r) => ({
          no: r.voucherNo,
          date: r.date,
          amount: r.credit,
        }))[0],
      // Bill QR: pays this bill's exact due amount into the society's UPI ID.
      upi:
        society?.upiVpa && memberBinding
          ? {
              uri: memberUpiUri({
                payeeName: society.name,
                vpa: society.upiVpa,
                flat: flatLabel ?? undefined,
                code: memberBinding.code,
              }),
              amount: currentCharges + arrears,
            }
          : undefined,
    };
  };

  const doExport = async (
    bill: Bill,
    kind: "pdf" | "word" | "print",
  ) => {
    try {
      const data = buildData(bill);
      // Word/print embed the QR as an image — cache it before rendering.
      if (data.upi) {
        await preloadQrImage(amountUpiUri(data.upi.uri, data.upi.amount));
      }
      if (kind === "pdf") billPdf(data, `${bill.billNo}.pdf`);
      else if (kind === "word") billWord(data, `${bill.billNo}.doc`);
      else billPrint(data);
      toast.success(
        kind === "pdf"
          ? "Bill PDF downloaded"
          : kind === "word"
            ? "Bill Word file downloaded"
            : "Sent to printer",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  if (bills === null) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-sm text-amber-800 shadow-sm dark:border-amber-500/30 dark:from-amber-950/40 dark:to-orange-950/30 dark:text-amber-300">
        <IconTile tone="amber">
          <TriangleAlert />
        </IconTile>
        <div className="space-y-1">
        <p className="font-medium">Your login is not linked to a flat in this society.</p>
        {debugText && <p className="text-xs leading-5">{debugText}</p>}
        </div>
      </div>
    );
  }
  if (!bills || !society) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (bills.length === 0) {
    // The binding works but resolved to a member row with no bills — surface
    // what the live session resolved to (and where the bills actually sit)
    // so the office can fix the grant without guesswork.
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-sm text-amber-800 shadow-sm dark:border-amber-500/30 dark:from-amber-950/40 dark:to-orange-950/30 dark:text-amber-300">
        <IconTile tone="amber">
          <TriangleAlert />
        </IconTile>
        <div className="space-y-1">
        <p className="font-medium">No bills are showing for this login.</p>
        {debugText && <p className="text-xs leading-5">{debugText}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Bills"
        description="All maintenance bills raised for your flat. Download any bill as PDF or Word, or print it directly."
      />
      <PortalFlatSelect />
      <Card className="py-0 shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
        <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Bill No.</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Download</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => (
              <TableRow key={b._id} className="group">
                <TableCell className="pl-4 font-medium">
                  <span className="flex items-center gap-2">
                    <IconTile tone="violet" size="sm">
                      <FileText />
                    </IconTile>
                    {b.billNo}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <CalendarRange className="size-3.5" />
                    {periodLabelLong(b.period)}
                  </span>
                </TableCell>
                <TableCell>{formatDate(b.issueDate)}</TableCell>
                <TableCell>{formatDate(b.dueDate)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(b.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(b.paidAmount)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      b.status === "paid"
                        ? "outline"
                        : b.status === "partial"
                          ? "secondary"
                          : "destructive"
                    }
                    className={
                      b.status === "paid"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : b.status === "partial"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300"
                          : ""
                    }
                  >
                    {b.status === "paid"
                      ? "Paid"
                      : b.status === "partial"
                        ? "Partial"
                        : "Unpaid"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Download PDF"
                      onClick={() => doExport(b, "pdf")}
                    >
                      <FileText className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Download Word"
                      onClick={() => doExport(b, "word")}
                    >
                      <Download className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Print"
                      onClick={() => doExport(b, "print")}
                    >
                      <Printer className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {bills.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  <div className="space-y-1">
                    <p>No bills have been raised for your flat yet.</p>
                    {debugText && <p className="text-xs leading-5">{debugText}</p>}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </CardContent>
      </Card>
    </div>
  );
}
