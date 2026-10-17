import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import PortalFlatSelect, {
  usePortalFlatId,
  usePortalFlatIdentity,
} from "@/components/PortalFlatSelect";
import { IconTile, PageHeader } from "@/components/PageParts";
import { receiptPdf, receiptPrint, receiptWord } from "@/lib/billDoc";
import {
  buildMemberReceiptData,
  receiptPdfBase64,
} from "@/lib/memberReceipt";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Banknote,
  CreditCard,
  Download,
  FileText,
  Mail,
  Printer,
  Smartphone,
  Landmark,
} from "lucide-react";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";

type Voucher = Doc<"vouchers">;

const MODE_ICON: Record<
  string,
  { icon: typeof Banknote; tone: "emerald" | "sky" | "violet" | "amber" }
> = {
  cash: { icon: Banknote, tone: "emerald" },
  bank: { icon: Landmark, tone: "sky" },
  upi: { icon: Smartphone, tone: "violet" },
  cheque: { icon: CreditCard, tone: "amber" },
};

export default function PortalReceipts() {
  const { societyId, society } = useSociety();
  // Multi-flat logins pick the flat in the selector (?flat=…); the receipt
  // headers and downloads name the flat actually being viewed.
  const memberBinding = usePortalFlatIdentity();
  const flat = usePortalFlatId();
  const receipts = useQuery(
    api.memberPortal.myReceipts,
    societyId ? { societyId, memberId: flat } : "skip",
  ) as Voucher[] | null | undefined;
  const bills = useQuery(
    api.memberPortal.myBills,
    societyId ? { societyId, memberId: flat } : "skip",
  ) as Bill[] | null | undefined;

  type Bill = Doc<"bills">;
  const emailReceipt = useAction(api.payments.emailMemberReceipt);
  const [emailingId, setEmailingId] = useState<Id<"vouchers"> | null>(null);

  // Shared builder — identical data to the auto-download/auto-email the UPI
  // payment flow produces.
  const buildData = (v: Voucher) =>
    buildMemberReceiptData({ society, memberBinding, voucher: v, bills });

  const doEmail = async (v: Voucher) => {
    if (!societyId) return;
    setEmailingId(v._id);
    try {
      await emailReceipt({
        societyId,
        voucherId: v._id,
        pdfBase64: receiptPdfBase64(buildData(v)),
        filename: `${v.voucherNo}.pdf`,
      });
      toast.success(`Receipt ${v.voucherNo} emailed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Email failed.");
    } finally {
      setEmailingId(null);
    }
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
      <PageHeader
        title="My Receipts"
        description="Receipts for payments received against your flat. Download any receipt as PDF or Word, or print it."
      />
      <PortalFlatSelect />
      <Card className="py-0 shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
        <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Receipt No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Download</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((v) => {
              const mi = v.mode ? MODE_ICON[v.mode] : undefined;
              const ModeIcon = mi?.icon;
              return (
              <TableRow key={v._id} className="group">
                <TableCell className="pl-4 font-medium">
                  <span className="flex items-center gap-2">
                    <IconTile tone="emerald" size="sm">
                      <FileText />
                    </IconTile>
                    {v.voucherNo}
                  </span>
                </TableCell>
                <TableCell>{formatDate(v.date)}</TableCell>
                <TableCell>
                  {(v.allocations ?? []).length > 0
                    ? `Against ${(v.allocations ?? []).length} bill(s)`
                    : v.narration || "Maintenance dues"}
                </TableCell>
                <TableCell>
                  {v.mode ? (
                    <Badge variant="outline" className="gap-1.5 capitalize">
                      {ModeIcon ? <ModeIcon className="size-3" /> : null}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Email this receipt to me (PDF attached)"
                      disabled={emailingId === v._id}
                      onClick={() => void doEmail(v)}
                    >
                      <Mail className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
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
        </CardContent>
      </Card>
    </div>
  );
}
