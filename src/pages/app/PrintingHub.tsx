import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, IconTile, PageHeader } from "@/components/PageParts";
import {
  billWithReceiptPdf,
  billWithReceiptPrint,
  billWithReceiptWord,
  billsPdfBatch,
  billsPrintBatch,
  billsWordBatch,
  periodLabelLong,
  receiptsPdfBatch,
  receiptsPrintBatch,
  receiptsWordBatch,
  voucherTitleFor,
  vouchersPdfBatch,
  vouchersPrintBatch,
  vouchersWordBatch,
  type BillBatchItem,
  type LegacyBillData,
  type LegacyReceiptData,
  type ReceiptBatchItem,
  type VoucherBatchItem,
  type VoucherDocData,
} from "@/lib/billDoc";
import { amountUpiUri, memberUpiUri, preloadQrImage } from "@/lib/upiQr";
import { currentPeriod, effectiveFyPeriod, formatDate, formatMoney, monthRangeISO } from "@/lib/format";
import {
  CalendarRange,
  FileText,
  Files,
  Loader2,
  Printer,
  Receipt as ReceiptIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type Bill = Doc<"bills">;
type Voucher = Doc<"vouchers">;
type Member = Doc<"members">;

type DocType = "bills" | "receipts" | "vouchers" | "combo";
type Scope = "month" | "range" | "selection";
type ComboContent = "both" | "bills" | "receipts";

/** Non-charge lines: carried opening balance (arrears or credit/advance). */
const isArrearsLine = (name: string) => {
  const n = name.toLowerCase();
  return n.startsWith("arrears") || n.startsWith("credit balance");
};

export default function PrintingHub() {
  const { societyId, society } = useSociety();
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const tariffs = useQuery(api.tariffs.list, societyId ? { societyId } : "skip") as Doc<"tariffs">[] | undefined;
  const vouchers = useQuery(api.vouchers.list, societyId ? { societyId } : "skip") as Voucher[] | undefined;
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Doc<"accounts">[] | undefined;

  const fy = effectiveFyPeriod(society ?? null);
  const [docType, setDocType] = useState<DocType>("bills");
  const [scope, setScope] = useState<Scope>("month");
  const [month, setMonth] = useState(currentPeriod());
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  // Receipt date range for the combo layout (bills come from the month above).
  const [rcptFrom, setRcptFrom] = useState(fy.from);
  const [rcptTo, setRcptTo] = useState(fy.to);
  const [comboContent, setComboContent] = useState<ComboContent>("both");
  const [twoUp, setTwoUp] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const memberOf = (id: Id<"members"> | undefined) =>
    members?.find((m) => m._id === id);

  const flatOf = (m?: Member) =>
    [m?.wing, m?.flatNo].filter(Boolean).join("-") || undefined;

  const monthOptions = useMemo(() => {
    const set = new Set<string>((bills ?? []).map((b) => b.period));
    set.add(currentPeriod());
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [bills]);

  const inRange = (date: string) => date >= from && date <= to;
  const inRcptRange = (date: string) => date >= rcptFrom && date <= rcptTo;

  const memberReceipts = useMemo(
    () => (vouchers ?? []).filter((v) => v.type === "member_receipt"),
    [vouchers],
  );

  /** All bills, receipt vouchers and vouchers in stable print order — the
   *  pools the selection-wise tables tick from. */
  const allBillsSorted = useMemo(
    () =>
      [...(bills ?? [])].sort((a, b) =>
        a.issueDate === b.issueDate
          ? a.billNo.localeCompare(b.billNo)
          : a.issueDate.localeCompare(b.issueDate),
      ),
    [bills],
  );
  const allReceiptsSorted = useMemo(
    () =>
      [...memberReceipts].sort((a, b) =>
        a.date === b.date ? a.voucherNo.localeCompare(b.voucherNo) : a.date.localeCompare(b.date),
      ),
    [memberReceipts],
  );
  const allVouchersSorted = useMemo(
    () =>
      [...(vouchers ?? [])].sort((a, b) =>
        a.date === b.date ? a.voucherNo.localeCompare(b.voucherNo) : a.date.localeCompare(b.date),
      ),
    [vouchers],
  );

  /** Bills in the chosen scope (month / date range / manual selection). */
  const scopedBills = useMemo(() => {
    if (docType === "combo") return allBillsSorted.filter((b) => b.period === month);
    if (scope === "month") return allBillsSorted.filter((b) => b.period === month);
    if (scope === "range") return allBillsSorted.filter((b) => inRange(b.issueDate));
    return allBillsSorted.filter((b) => selected.has(b._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBillsSorted, docType, scope, month, from, to, selected]);

  /** Receipts in the chosen scope (receipt date). */
  const scopedReceipts = useMemo(() => {
    if (docType === "combo") return allReceiptsSorted.filter((v) => inRcptRange(v.date));
    if (scope === "month") {
      const r = monthRangeISO(month);
      return allReceiptsSorted.filter((v) => v.date >= r.from && v.date <= r.to);
    }
    if (scope === "range") return allReceiptsSorted.filter((v) => inRange(v.date));
    return allReceiptsSorted.filter((v) => selected.has(v._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReceiptsSorted, docType, scope, month, from, to, rcptFrom, rcptTo, selected]);

  /** Vouchers (all types) in the chosen scope. */
  const scopedVouchers = useMemo(() => {
    if (scope === "month") {
      const r = monthRangeISO(month);
      return allVouchersSorted.filter((v) => v.date >= r.from && v.date <= r.to);
    }
    if (scope === "range") return allVouchersSorted.filter((v) => inRange(v.date));
    return allVouchersSorted.filter((v) => selected.has(v._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVouchersSorted, scope, month, from, to, selected]);

  /** Legacy-format bill document data (mirrors the Bill Register export). */
  const buildBillData = (b: Bill): LegacyBillData => {
    const m = memberOf(b.memberId);
    const carried = (b.lines ?? []).filter((l) => isArrearsLine(l.name));
    const charges = (b.lines ?? []).filter((l) => !isArrearsLine(l.name));
    const flatLabel = flatOf(m);
    const uri =
      society?.upiVpa && m
        ? memberUpiUri({
            payeeName: society.name,
            vpa: society.upiVpa,
            flat: flatLabel,
            code: m.code,
          })
        : undefined;
    return {
      society: {
        name: society?.name ?? "",
        address: [society?.address, society?.city, society?.state, society?.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society?.registrationNo,
      },
      billNo: b.billNo.replace(/^BILL-/, ""),
      billDate: b.issueDate,
      dueDate: b.dueDate,
      periodLabel: periodLabelLong(b.period),
      memberName: m?.name ?? "Member",
      flatNo: flatLabel,
      lines: charges.map((l) => ({
        name: (l.tariffId && tariffs?.find((t) => t._id === l.tariffId)?.name) || l.name,
        amount: l.amount,
        serial: l.printNo,
      })),
      total: charges.reduce((s, l) => s + l.amount, 0),
      arrears: carried.reduce((s, l) => s + l.amount, 0),
      totalDue:
        charges.reduce((s, l) => s + l.amount, 0) +
        carried.reduce((s, l) => s + l.amount, 0),
      paidAmount: b.paidAmount,
      lateFeePercent: society?.lateFeePercent,
      upi: uri
        ? {
            uri,
            amount:
              charges.reduce((s, l) => s + l.amount, 0) +
              carried.reduce((s, l) => s + l.amount, 0),
          }
        : undefined,
    };
  };

  /** Legacy-format receipt document data for a member-receipt voucher. */
  const buildReceiptData = (v: Voucher): LegacyReceiptData => {
    const m = memberOf(v.memberId ?? undefined);
    // Purpose: the latest allocated bill's period, else "on account".
    const allocBill = (v.allocations ?? []).length
      ? (bills ?? []).find(
          (b) => b._id === (v.allocations ?? []).slice(-1)[0]?.billId,
        )
      : undefined;
    return {
      society: {
        name: society?.name ?? "",
        address: [society?.address, society?.city, society?.state, society?.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society?.registrationNo,
      },
      receiptNo: v.voucherNo.replace(/^[A-Z]+-/, ""),
      receiptDate: v.date,
      memberName: m?.name ?? "Member",
      flatNo: flatOf(m),
      amount: v.total,
      paymentKind: allocBill && allocBill.total - allocBill.paidAmount <= 0 ? "full" : "part",
      purpose: allocBill
        ? `Maintenance for the Month ${periodLabelLong(allocBill.period)}`
        : "Maintenance dues — on account",
      mode: v.mode,
      reference: v.reference,
    };
  };

  /** Voucher document data for any voucher type. */
  const buildVoucherData = (v: Voucher): VoucherDocData => {
    const m = memberOf(v.memberId ?? undefined);
    return {
      society: {
        name: society?.name ?? "",
        address: [society?.address, society?.city, society?.state, society?.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society?.registrationNo,
      },
      title: voucherTitleFor(v.type),
      voucherNo: v.voucherNo,
      voucherDate: v.date,
      party: m ? m.name : undefined,
      mode: v.mode,
      reference: v.reference,
      narration: v.narration,
      amount: v.total,
      lines: (v.lines ?? []).map((l) => {
        const a = (accounts ?? []).find((x) => x._id === l.accountId);
        return {
          code: a?.code,
          name: a?.name ?? "Ledger",
          debit: l.debit,
          credit: l.credit,
          note: l.note,
        };
      }),
    };
  };

  /** Bill batch items with UPI payloads cached for Word/print QRs. */
  const billItems = useMemo<BillBatchItem[]>(
    () => scopedBills.map((b) => ({ data: buildBillData(b) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedBills, society, members, tariffs],
  );

  const receiptItems = useMemo<ReceiptBatchItem[]>(
    () =>
      scopedReceipts.map((v) => ({
        data: buildReceiptData(v),
        copyLabel: "Original",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedReceipts, society, members, bills],
  );

  const voucherItems = useMemo<VoucherBatchItem[]>(
    () => scopedVouchers.map((v) => ({ data: buildVoucherData(v) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedVouchers, society, members, accounts],
  );

  /** Combo pairs: each bill with that member's latest receipt in the window. */
  const comboPairs = useMemo(
    () =>
      scopedBills.map((b) => {
        const receiptsForMember = memberReceipts
          .filter((v) => v.memberId === b.memberId && inRcptRange(v.date))
          .sort((a, c) => c.date.localeCompare(a.date));
        return {
          bill: buildBillData(b),
          receipt: receiptsForMember[0]
            ? buildReceiptData(receiptsForMember[0])
            : undefined,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedBills, memberReceipts, society, members, tariffs, bills, rcptFrom, rcptTo],
  );

  /** Cache QR images for the Word/print exports (they embed data URLs). */
  const preloadBillQrs = async () => {
    if (!society?.upiVpa) return;
    for (const it of billItems) {
      if (it.data.upi) await preloadQrImage(amountUpiUri(it.data.upi.uri, it.data.upi.amount));
    }
  };

  const scopeLabel =
    scope === "month" ? month : scope === "range" ? `${from}-to-${to}` : "selection";

  const doExport = async (kind: "pdf" | "word" | "print") => {
    if (!society) return;
    setBusy(true);
    try {
      if (docType === "bills" || (docType === "combo" && comboContent === "bills")) {
        if (billItems.length === 0) throw new Error("No bills match the selection.");
        if (kind === "pdf") billsPdfBatch(billItems, `bills-${scopeLabel}.pdf`, twoUp);
        else if (kind === "word") {
          await preloadBillQrs();
          billsWordBatch(billItems, `bills-${scopeLabel}`, twoUp);
        } else {
          await preloadBillQrs();
          billsPrintBatch(billItems, twoUp);
        }
      } else if (docType === "receipts" || (docType === "combo" && comboContent === "receipts")) {
        if (receiptItems.length === 0) throw new Error("No receipts match the selection.");
        if (kind === "pdf") receiptsPdfBatch(receiptItems, `receipts-${scopeLabel}.pdf`, twoUp);
        else if (kind === "word") receiptsWordBatch(receiptItems, `receipts-${scopeLabel}`);
        else receiptsPrintBatch(receiptItems, twoUp);
      } else if (docType === "vouchers") {
        if (voucherItems.length === 0) throw new Error("No vouchers match the selection.");
        if (kind === "pdf") vouchersPdfBatch(voucherItems, `vouchers-${scopeLabel}.pdf`, twoUp);
        else if (kind === "word") vouchersWordBatch(voucherItems, `vouchers-${scopeLabel}`, twoUp);
        else vouchersPrintBatch(voucherItems, twoUp);
      } else {
        const pairs = comboPairs.filter((p) => p.receipt) as {
          bill: LegacyBillData;
          receipt: LegacyReceiptData;
        }[];
        if (pairs.length === 0)
          throw new Error(
            "No bill has a matching receipt in the receipt date range — widen the range or switch to Only bills.",
          );
        if (kind === "pdf") billWithReceiptPdf(pairs, `bills-with-receipts-${scopeLabel}.pdf`);
        else if (kind === "word") billWithReceiptWord(pairs, `bills-with-receipts-${scopeLabel}`);
        else billWithReceiptPrint(pairs);
      }
      toast.success(
        kind === "pdf"
          ? "PDF downloaded"
          : kind === "word"
            ? "Word file downloaded"
            : "Sent to printer",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const allIds = useMemo(() => {
    const list: string[] =
      docType === "bills"
        ? scopedBills.map((b) => String(b._id))
        : docType === "vouchers"
          ? scopedVouchers.map((v) => String(v._id))
          : scopedReceipts.map((v) => String(v._id));
    return new Set(list);
  }, [docType, scopedBills, scopedVouchers, scopedReceipts]);

  const allSelected = allIds.size > 0 && [...allIds].every((id) => selected.has(id));
  const toggleAll = (on: boolean) =>
    setSelected((s) => {
      const next = new Set(on ? [...s, ...allIds] : [...s].filter((x) => !allIds.has(x)));
      return next;
    });
  const toggleOne = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const effCount =
    docType === "bills"
      ? billItems.length
      : docType === "receipts"
        ? receiptItems.length
        : docType === "vouchers"
          ? voucherItems.length
          : comboContent === "both"
            ? comboPairs.filter((p) => p.receipt).length
            : comboContent === "bills"
              ? billItems.length
              : receiptItems.length;

  const selectionTable =
    docType === "bills" ? (
      <SelectionTable
        head={["Bill No", "Period", "Member", "Total due", "Paid", "Status"]}
        rows={allBillsSorted.map((b) => {
          const m = memberOf(b.memberId);
          return {
            id: b._id,
            cells: [
              b.billNo,
              periodLabelLong(b.period),
              m?.name ?? "—",
              formatMoney(b.total),
              formatMoney(b.paidAmount),
              b.status,
            ],
          };
        })}
        selected={selected}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onToggle={toggleOne}
      />
    ) : docType === "vouchers" ? (
      <SelectionTable
        head={["Voucher No", "Type", "Date", "Party", "Amount"]}
        rows={allVouchersSorted.map((v) => {
          const m = memberOf(v.memberId ?? undefined);
          return {
            id: v._id,
            cells: [
              v.voucherNo,
              voucherTitleFor(v.type),
              formatDate(v.date),
              m?.name ?? "—",
              formatMoney(v.total),
            ],
          };
        })}
        selected={selected}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onToggle={toggleOne}
      />
    ) : (
      <SelectionTable
        head={["Receipt No", "Date", "Member", "Mode", "Amount"]}
        rows={allReceiptsSorted.map((v) => {
          const m = memberOf(v.memberId ?? undefined);
          return {
            id: v._id,
            cells: [
              v.voucherNo,
              formatDate(v.date),
              m?.name ?? "—",
              v.mode ?? "—",
              formatMoney(v.total),
            ],
          };
        })}
        selected={selected}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onToggle={toggleOne}
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Printing Hub"
        description="Print bills, receipts and vouchers in batches — month-wise, date-wise or selection-wise, as PDF or Word, one or two per A4 page, or bill + receipt together."
      />

      <Tabs value={docType} onValueChange={(v) => setDocType(v as DocType)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
          <TabsTrigger value="combo">Bill with Receipt</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Scope + layout controls */}
      <div className="panel space-y-5 p-5">
        {docType !== "combo" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Print scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month-wise</SelectItem>
                  <SelectItem value="range">Date-wise (range)</SelectItem>
                  <SelectItem value="selection">Selection-wise (tick below)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "month" && (
              <div className="space-y-2">
                <Label>
                  {docType === "bills" ? "Billing month" : "Month (document date)"}
                </Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((m) => (
                      <SelectItem key={m} value={m}>{periodLabelLong(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scope === "range" && (
              <>
                <div className="space-y-2">
                  <Label>From date</Label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>To date</Label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            )}
          </div>
        )}

        {docType === "combo" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Print</Label>
                <Select
                  value={comboContent}
                  onValueChange={(v) => setComboContent(v as ComboContent)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Bill with receipt</SelectItem>
                    <SelectItem value="bills">Only bills</SelectItem>
                    <SelectItem value="receipts">Only receipts</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {comboContent !== "receipts" && (
                <div className="space-y-2">
                  <Label>Billing month (bills)</Label>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((m) => (
                        <SelectItem key={m} value={m}>{periodLabelLong(m)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {comboContent !== "bills" && (
                <>
                  <div className="space-y-2">
                    <Label>Receipts from</Label>
                    <Input
                      type="date"
                      value={rcptFrom}
                      onChange={(e) => setRcptFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Receipts to</Label>
                    <Input
                      type="date"
                      value={rcptTo}
                      onChange={(e) => setRcptTo(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            {comboContent === "both" && (
              <p className="text-xs leading-5 text-muted-foreground">
                Each bill of {periodLabelLong(month)} is printed on the upper half of an A4
                sheet with that member's latest receipt dated {formatDate(rcptFrom)} –{" "}
                {formatDate(rcptTo)} below it. Bills without a receipt in the window are
                skipped — switch to “Only bills” to print them all.
              </p>
            )}
          </div>
        )}

        {/* Layout + output */}
        <div className="flex flex-wrap items-end gap-6 border-t pt-4">
          {!(docType === "combo" && comboContent === "both") && (
            <div className="space-y-2">
              <Label>Layout per A4 page</Label>
              <RadioGroup
                value={twoUp ? "two" : "one"}
                onValueChange={(v) => setTwoUp(v === "two")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="one" id="lay-one" />
                  <Label htmlFor="lay-one" className="font-normal">One (full size)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="two" id="lay-two" />
                  <Label htmlFor="lay-two" className="font-normal">Two (half size, cut line)</Label>
                </div>
              </RadioGroup>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <Files className="size-3.5" />
              {effCount} document{effCount === 1 ? "" : "s"}
              {twoUp && effCount > 0 ? ` · ${Math.ceil(effCount / 2)} page(s)` : ""}
            </Badge>
            <Button variant="outline" disabled={busy || effCount === 0} onClick={() => doExport("pdf")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} PDF
            </Button>
            <Button variant="outline" disabled={busy || effCount === 0} onClick={() => doExport("word")}>
              <Files className="size-4" /> Word
            </Button>
            <Button disabled={busy || effCount === 0} onClick={() => doExport("print")}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </div>
      </div>

      {/* Selection table (selection-wise scope) */}
      {scope === "selection" && docType !== "combo" && (
        <Card className="py-0">
          <CardContent className="px-0">
            {selectionTable}
          </CardContent>
        </Card>
      )}

      {/* Combo preview list */}
      {docType === "combo" && comboContent === "both" && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Bill</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Total due</TableHead>
                  <TableHead>Paired receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comboPairs.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4 font-medium">
                      {p.bill.billNo} · {p.bill.periodLabel}
                    </TableCell>
                    <TableCell>{p.bill.memberName}</TableCell>
                    <TableCell className="tabular-nums">{formatMoney(p.bill.totalDue)}</TableCell>
                    <TableCell>
                      {p.receipt ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                          <IconTile tone="emerald" size="sm"><ReceiptIcon /></IconTile>
                          {p.receipt.receiptNo} · {formatDate(p.receipt.receiptDate)} ·{" "}
                          {formatMoney(p.receipt.amount)}
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          No receipt in range — skipped
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {comboPairs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No bills for {periodLabelLong(month)}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {(scope === "month" || scope === "range") && docType !== "combo" && effCount === 0 && (
        <EmptyHint>
          Nothing matches this scope yet — change the month or dates above.
        </EmptyHint>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarRange className="size-3.5" />
        Half-size layouts draw the same document compactly with a dashed cut line — fold or cut
        the sheet after printing. The combined bill+receipt layout always uses one full A4 sheet
        per pair.
      </p>
    </div>
  );
}

/** Simple tick-to-include table used by selection-wise scope. */
function SelectionTable({
  head,
  rows,
  selected,
  allSelected,
  onToggleAll,
  onToggle,
}: {
  head: string[];
  rows: { id: string; cells: (string | number)[] }[];
  selected: Set<string>;
  allSelected: boolean;
  onToggleAll: (on: boolean) => void;
  onToggle: (id: string, on: boolean) => void;
}) {
  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Nothing to select yet.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8 pl-4">
            <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleAll(v === true)} aria-label="Select all" />
          </TableHead>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="pl-4">
              <Checkbox
                checked={selected.has(r.id)}
                onCheckedChange={(v) => onToggle(r.id, v === true)}
                aria-label={`Select ${r.cells[0]}`}
              />
            </TableCell>
            {r.cells.map((c, i) => (
              <TableCell key={i} className={typeof c === "number" ? "tabular-nums" : ""}>
                {c}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
