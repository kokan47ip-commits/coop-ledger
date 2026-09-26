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
  billPdf,
  billPrint,
  billWord,
  periodLabelLong,
  type LegacyBillData,
} from "@/lib/billDoc";
import { formatDate, formatMoney } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type Bill = Doc<"bills">;

export default function PortalBills() {
  const { societyId, society, memberBinding } = useSociety();
  const bills = useQuery(
    api.memberPortal.myBills,
    societyId ? { societyId } : "skip",
  ) as Bill[] | null | undefined;
  // Self-diagnosis when the list is empty OR the login has no flat binding —
  // shows what the login is actually bound to and where the bills are.
  const debug = useQuery(
    api.memberPortal.debugMyBinding,
    societyId && (bills === null || (bills ?? []).length === 0) ? { societyId } : "skip",
  );
  const debugText = debug
    ? [
        debug.email ? `Signed in as ${debug.email}.` : "Not signed in with an email.",
        debug.bound
          ? `This login is linked to flat ${debug.bound.flat ?? "?"} (${debug.bound.isActive ? "active" : "inactive member row"}) which has ${debug.bound.bills} bill(s).`
          : "No flat is linked to this login (no member-portal grant, or its flat no longer matches any member).",
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
      billDate: bill.issueDate,
      dueDate: bill.dueDate,
      periodLabel: periodLabelLong(bill.period),
      memberName: memberBinding?.name ?? "Member",
      flatNo:
        [memberBinding?.wing, memberBinding?.flatNo].filter(Boolean).join("-") ||
        memberBinding?.code,
      lines: (bill.lines ?? [])
        .filter((l) => !isArrearsLine(l.name))
        .map((l) => ({ name: l.name, amount: l.amount, serial: l.printNo })),
      total: currentCharges,
      arrears,
      totalDue: currentCharges + arrears,
      paidAmount: bill.paidAmount,
    };
  };

  const doExport = (
    bill: Bill,
    kind: "pdf" | "word" | "print",
  ) => {
    try {
      const data = buildData(bill);
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
      <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
        <p className="font-medium">Your login is not linked to a flat in this society.</p>
        {debugText && <p className="text-xs leading-5">{debugText}</p>}
      </div>
    );
  }
  if (!bills || !society) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        All maintenance bills raised for your flat. Download any bill as PDF or
        Word, or print it directly.
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill No.</TableHead>
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
              <TableRow key={b._id}>
                <TableCell className="font-medium">{b.billNo}</TableCell>
                <TableCell>{periodLabelLong(b.period)}</TableCell>
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
      </div>
    </div>
  );
}
