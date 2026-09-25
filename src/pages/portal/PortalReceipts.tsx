import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  receiptPdf,
  receiptPrint,
  receiptWord,
  type LegacyReceiptData,
} from "@/lib/billDoc";
import { formatDate, formatMoney } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type Voucher = Doc<"vouchers">;

export default function PortalReceipts() {
  const { societyId, society, memberBinding } = useSociety();
  const receipts = useQuery(
    api.memberPortal.myReceipts,
    societyId ? { societyId } : "skip",
  ) as Voucher[] | null | undefined;
  const bills = useQuery(
    api.memberPortal.myBills,
    societyId ? { societyId } : "skip",
  ) as Bill[] | null | undefined;

  type Bill = Doc<"bills">;

  const buildData = (v: Voucher): LegacyReceiptData => {
    const firstBill = (bills ?? [])
      .filter((b) => (v.allocations ?? []).some((a) => a.billId === b._id))
      .sort((a, b) => b.period.localeCompare(a.period))[0];
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
      receiptNo: v.voucherNo.replace(/^[A-Z]+-/, ""),
      receiptDate: v.date,
      memberName: memberBinding?.name ?? "Member",
      flatNo:
        [memberBinding?.wing, memberBinding?.flatNo].filter(Boolean).join("-") ||
        memberBinding?.code,
      amount: v.total,
      paymentKind: "part",
      purpose: firstBill
        ? `Maintenance for the Month ${firstBill.period}`
        : v.narration || "Maintenance dues",
      mode: v.mode,
      reference: v.reference,
    };
  };

  const doExport = (v: Voucher, kind: "pdf" | "word" | "print") => {
    try {
      const data = buildData(v);
      if (kind === "pdf") receiptPdf(data, `${v.voucherNo}.pdf`);
      else if (kind === "word") receiptWord(data, `${v.voucherNo}.doc`);
      else receiptPrint(data);
      toast.success(
        kind === "pdf"
          ? "Receipt PDF downloaded"
          : kind === "word"
            ? "Receipt Word file downloaded"
            : "Sent to printer",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  if (receipts === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Your login is not linked to a flat in this society.
      </p>
    );
  }
  if (!receipts || !society) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Receipts for payments received against your flat. Download any receipt
        as PDF or Word, or print it.
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Download</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((v) => (
              <TableRow key={v._id}>
                <TableCell className="font-medium">{v.voucherNo}</TableCell>
                <TableCell>{formatDate(v.date)}</TableCell>
                <TableCell>
                  {(v.allocations ?? []).length > 0
                    ? `Against ${(v.allocations ?? []).length} bill(s)`
                    : v.narration || "Maintenance dues"}
                </TableCell>
                <TableCell>
                  {v.mode ? (
                    <Badge variant="outline" className="capitalize">
                      {v.mode}
                    </Badge>
                  ) : (
                    "—"
                  )}
                  {v.reference ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Ref {v.reference}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(v.total)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Download PDF"
                      onClick={() => doExport(v, "pdf")}
                    >
                      <FileText className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Download Word"
                      onClick={() => doExport(v, "word")}
                    >
                      <Download className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Print"
                      onClick={() => doExport(v, "print")}
                    >
                      <Printer className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {receipts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  No receipts yet — payments you make will appear here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
