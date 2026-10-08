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
import { IconTile, PageHeader } from "@/components/PageParts";
import {
  DEFAULT_MARGINS,
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
  type PageMargins,
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
  Ruler,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type Bill = Doc<"bills">;
type Voucher = Doc<"vouchers">;
type Member = Doc<"members">;

type DocType = "bills" | "receipts" | "vouchers" | "combo" | "flats";
type FlatDoc = "bills" | "receipts" | "vouchers";
type Scope = "month" | "range" | "selection";
type ComboContent = "both" | "bills" | "receipts";

/** Non-charge lines: carried opening balance (arrears or credit/advance). */
const isArrearsLine = (name: string) => {
  const n = name.toLowerCase();
  return n.startsWith("arrears") || n.startsWith("credit balance");
};

/** Margin inputs shown in the controls panel (millimetres, A4). */
const MARGIN_FIELDS = [
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["left", "Left"],
  ["right", "Right"],
  ["centre", "Centre gap"],
] as const satisfies readonly (readonly [keyof PageMargins, string])[];

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
  const [margins, setMargins] = useState<PageMargins>({ ...DEFAULT_MARGINS });
  const [monthTouched, setMonthTouched] = useState(false);
  // Flat-wise tab: document kind, date range and ticked member ids.
  const [flatDoc, setFlatDoc] = useState<FlatDoc>("bills");
  const [flatFrom, setFlatFrom] = useState(fy.from);
  const [flatTo, setFlatTo] = useState(fy.to);
  const [flatSel, setFlatSel] = useState<Set<string>>(new Set());

  const memberOf = (id: Id<"members"> | undefined) =>
    members?.find((m) => m._id === id);

  const flatOf = (m?: Member) =>
    [m?.wing, m?.flatNo].filter(Boolean).join("-") || undefined;

  /** Months that hold ANY printable document — bills, receipts or vouchers —
   *  plus the current month, newest first. */
  const monthOptions = useMemo(() => {
    const set = new Set<string>((bills ?? []).map((b) => b.period));
    for (const v of vouchers ?? []) set.add(v.date.slice(0, 7));
    set.add(currentPeriod());
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [bills, vouchers]);

  /** Before the user picks a month themselves, default to the newest month
   *  that actually has documents so the hub never opens on an empty month. */
  const newestDocMonth = useMemo(() => {
    const months = [
      ...(bills ?? []).map((b) => b.period),
      ...(vouchers ?? []).map((v) => v.date.slice(0, 7)),
    ].sort((a, b) => b.localeCompare(a));
    return months[0];
  }, [bills, vouchers]);
  const activeMonth = monthTouched ? month : newestDocMonth ?? month;
  const pickMonth = (m: string) => {
    setMonth(m);
    setMonthTouched(true);
  };

  const setMargin = (key: keyof PageMargins, raw: string) => {
    const v = Math.max(0, Math.min(50, Number(raw) || 0));
    setMargins((m) => ({ ...m, [key]: v }));
  };

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

  /** Selection-wise pools narrowed by the From/To range — the tick list shows
   *  only documents dated inside it, and prints honour the same filter. */
  const selectionBillsPool = useMemo(
    () => allBillsSorted.filter((b) => inRange(b.issueDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBillsSorted, from, to],
  );
  const selectionReceiptsPool = useMemo(
    () => allReceiptsSorted.filter((v) => inRange(v.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allReceiptsSorted, from, to],
  );
  const selectionVouchersPool = useMemo(
    () => allVouchersSorted.filter((v) => inRange(v.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allVouchersSorted, from, to],
  );

  /** Flat-wise: members in flat order, and their documents in the flat range. */
  const membersSorted = useMemo(
    () =>
      [...(members ?? [])].sort((a, b) => {
        const fa = [a.wing, a.flatNo].filter(Boolean).join("-") || a.code;
        const fb = [b.wing, b.flatNo].filter(Boolean).join("-") || b.code;
        return fa.localeCompare(fb) || a.name.localeCompare(b.name);
      }),
    [members],
  );
  const flatBills = useMemo(
    () =>
      allBillsSorted.filter(
        (b) => flatSel.has(String(b.memberId)) && b.issueDate >= flatFrom && b.issueDate <= flatTo,
      ),
    [allBillsSorted, flatSel, flatFrom, flatTo],
  );
  const flatReceipts = useMemo(
    () =>
      allReceiptsSorted.filter(
        (v) =>
          !!v.memberId && flatSel.has(String(v.memberId)) && v.date >= flatFrom && v.date <= flatTo,
      ),
    [allReceiptsSorted, flatSel, flatFrom, flatTo],
  );
  const flatVouchers = useMemo(
    () =>
      allVouchersSorted.filter(
        (v) =>
          !!v.memberId && flatSel.has(String(v.memberId)) && v.date >= flatFrom && v.date <= flatTo,
      ),
    [allVouchersSorted, flatSel, flatFrom, flatTo],
  );

  /** Bills in the chosen scope (month / date range / manual selection). */
  const scopedBills = useMemo(() => {
    if (docType === "combo") return allBillsSorted.filter((b) => b.period === activeMonth);
    if (scope === "month") return allBillsSorted.filter((b) => b.period === activeMonth);
    if (scope === "range") return allBillsSorted.filter((b) => inRange(b.issueDate));
    return allBillsSorted.filter((b) => selected.has(b._id) && inRange(b.issueDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBillsSorted, docType, scope, activeMonth, from, to, selected]);

  /** Receipts in the chosen scope (receipt date). */
  const scopedReceipts = useMemo(() => {
    if (docType === "combo") return allReceiptsSorted.filter((v) => inRcptRange(v.date));
    if (scope === "month") {
      const r = monthRangeISO(activeMonth);
      return allReceiptsSorted.filter((v) => v.date >= r.from && v.date <= r.to);
    }
    if (scope === "range") return allReceiptsSorted.filter((v) => inRange(v.date));
    return allReceiptsSorted.filter((v) => selected.has(v._id) && inRange(v.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReceiptsSorted, docType, scope, activeMonth, from, to, rcptFrom, rcptTo, selected]);

  /** Vouchers (all types) in the chosen scope. */
  const scopedVouchers = useMemo(() => {
    if (scope === "month") {
      const r = monthRangeISO(activeMonth);
      return allVouchersSorted.filter((v) => v.date >= r.from && v.date <= r.to);
    }
    if (scope === "range") return allVouchersSorted.filter((v) => inRange(v.date));
    return allVouchersSorted.filter((v) => selected.has(v._id) && inRange(v.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVouchersSorted, scope, activeMonth, from, to, selected]);

  /** Legacy-format bill document data (mirrors the Bill Register export). */
  const buildBillData = (b: Bill): LegacyBillData => {
    const m = memberOf(b.memberId);
    // Carried lines are signed: a negative figure is the member's advance /
    // credit balance and prints as "Advance:" (see billDoc.arrearsLabel).
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
      // Supplementary bills print with a "SUPPLEMENTARY BILL" title band
      // instead of the monthly period band.
      supplementary:
        (b as { billKind?: string }).billKind === "supplementary"
          ? { category: (b as { category?: string }).category }
          : undefined,
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

  /** Flat-wise batch items (reuse the same document builders). */
  const flatBillItems = useMemo<BillBatchItem[]>(
    () => flatBills.map((b) => ({ data: buildBillData(b) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flatBills, society, members, tariffs],
  );
  const flatReceiptItems = useMemo<ReceiptBatchItem[]>(
    () => flatReceipts.map((v) => ({ data: buildReceiptData(v), copyLabel: "Original" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flatReceipts, society, members, bills],
  );
  const flatVoucherItems = useMemo<VoucherBatchItem[]>(
    () => flatVouchers.map((v) => ({ data: buildVoucherData(v) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flatVouchers, society, members, accounts],
  );

  /** Cache QR images for the Word/print exports (they embed data URLs). */
  const preloadBillQrs = async (items: BillBatchItem[] = billItems) => {
    if (!society?.upiVpa) return;
    for (const it of items) {
      if (it.data.upi) await preloadQrImage(amountUpiUri(it.data.upi.uri, it.data.upi.amount));
    }
  };

  const scopeLabel =
    scope === "month" ? activeMonth : scope === "range" ? `${from}-to-${to}` : "selection";

  const doExport = async (kind: "pdf" | "word" | "print") => {
    if (!society) return;
    setBusy(true);
    try {
      if (docType === "flats") {
        const fLabel = `${flatFrom}-to-${flatTo}`;
        if (flatDoc === "bills") {
          if (flatBillItems.length === 0) throw new Error("No bills match the selected flats.");
          if (kind === "pdf") billsPdfBatch(flatBillItems, `bills-${fLabel}.pdf`, twoUp, margins);
          else if (kind === "word") {
            await preloadBillQrs(flatBillItems);
            billsWordBatch(flatBillItems, `bills-${fLabel}`, twoUp, margins);
          } else {
            await preloadBillQrs(flatBillItems);
            billsPrintBatch(flatBillItems, twoUp, margins);
          }
        } else if (flatDoc === "receipts") {
          if (flatReceiptItems.length === 0)
            throw new Error("No receipts match the selected flats.");
          if (kind === "pdf")
            receiptsPdfBatch(flatReceiptItems, `receipts-${fLabel}.pdf`, twoUp, margins);
          else if (kind === "word")
            receiptsWordBatch(flatReceiptItems, `receipts-${fLabel}`, margins, twoUp);
          else receiptsPrintBatch(flatReceiptItems, twoUp, margins);
        } else {
          if (flatVoucherItems.length === 0)
            throw new Error("No vouchers match the selected flats.");
          if (kind === "pdf")
            vouchersPdfBatch(flatVoucherItems, `vouchers-${fLabel}.pdf`, twoUp, margins);
          else if (kind === "word")
            vouchersWordBatch(flatVoucherItems, `vouchers-${fLabel}`, twoUp, margins);
          else vouchersPrintBatch(flatVoucherItems, twoUp, margins);
        }
      } else if (docType === "bills" || (docType === "combo" && comboContent === "bills")) {
        if (billItems.length === 0) throw new Error("No bills match the selection.");
        if (kind === "pdf") billsPdfBatch(billItems, `bills-${scopeLabel}.pdf`, twoUp, margins);
        else if (kind === "word") {
          await preloadBillQrs();
          billsWordBatch(billItems, `bills-${scopeLabel}`, twoUp, margins);
        } else {
          await preloadBillQrs();
          billsPrintBatch(billItems, twoUp, margins);
        }
      } else if (docType === "receipts" || (docType === "combo" && comboContent === "receipts")) {
        if (receiptItems.length === 0) throw new Error("No receipts match the selection.");
        if (kind === "pdf") receiptsPdfBatch(receiptItems, `receipts-${scopeLabel}.pdf`, twoUp, margins);
        else if (kind === "word")
          receiptsWordBatch(receiptItems, `receipts-${scopeLabel}`, margins, twoUp);
        else receiptsPrintBatch(receiptItems, twoUp, margins);
      } else if (docType === "vouchers") {
        if (voucherItems.length === 0) throw new Error("No vouchers match the selection.");
        if (kind === "pdf") vouchersPdfBatch(voucherItems, `vouchers-${scopeLabel}.pdf`, twoUp, margins);
        else if (kind === "word") vouchersWordBatch(voucherItems, `vouchers-${scopeLabel}`, twoUp, margins);
        else vouchersPrintBatch(voucherItems, twoUp, margins);
      } else {
        // Every bill of the month prints — with its receipt when one exists,
        // otherwise with a clear "no receipt yet" placeholder below it.
        if (comboPairs.length === 0)
          throw new Error(`No bills found for ${periodLabelLong(activeMonth)}.`);
        if (kind === "pdf")
          billWithReceiptPdf(comboPairs, `bills-with-receipts-${scopeLabel}.pdf`, margins);
        else if (kind === "word") {
          await preloadBillQrs();
          billWithReceiptWord(comboPairs, `bills-with-receipts-${scopeLabel}`, margins);
        } else {
          await preloadBillQrs();
          billWithReceiptPrint(comboPairs, margins);
        }
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

  /** Full pool of the active tab — "select all" ticks every document, and
   *  selection-wise tables list all of them for ticking. */
  /** Tick pool: selection-wise narrows to the From/To range so "select all"
   *  matches exactly the rows listed below. */
  const allIds = useMemo(() => {
    if (scope === "selection") {
      const pool =
        docType === "bills"
          ? selectionBillsPool
          : docType === "vouchers"
            ? selectionVouchersPool
            : selectionReceiptsPool;
      return new Set(pool.map((d) => String(d._id)));
    }
    const list: string[] =
      docType === "bills"
        ? allBillsSorted.map((b) => String(b._id))
        : docType === "vouchers"
          ? allVouchersSorted.map((v) => String(v._id))
          : allReceiptsSorted.map((v) => String(v._id));
    return new Set(list);
  }, [
    scope,
    docType,
    selectionBillsPool,
    selectionVouchersPool,
    selectionReceiptsPool,
    allBillsSorted,
    allVouchersSorted,
    allReceiptsSorted,
  ]);

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

  /** Flat-wise tick helpers (ticked member ids). */
  const allFlatSelected =
    membersSorted.length > 0 && membersSorted.every((m) => flatSel.has(String(m._id)));
  const toggleAllFlats = (on: boolean) =>
    setFlatSel(on ? new Set(membersSorted.map((m) => String(m._id))) : new Set());
  const toggleFlat = (id: string, on: boolean) =>
    setFlatSel((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Documents in range per member — drives the flat tab's count column. */
  const flatDocCountByMember = useMemo(() => {
    const pool =
      flatDoc === "bills" ? flatBills : flatDoc === "receipts" ? flatReceipts : flatVouchers;
    const counts = new Map<string, number>();
    for (const d of pool) {
      const mid = (d as Bill).memberId ?? (d as Voucher).memberId ?? undefined;
      if (mid) counts.set(String(mid), (counts.get(String(mid)) ?? 0) + 1);
    }
    return counts;
  }, [flatDoc, flatBills, flatReceipts, flatVouchers]);

  const effCount =
    docType === "flats"
      ? flatDoc === "bills"
        ? flatBillItems.length
        : flatDoc === "receipts"
          ? flatReceiptItems.length
          : flatVoucherItems.length
      : docType === "bills"
        ? billItems.length
        : docType === "receipts"
          ? receiptItems.length
          : docType === "vouchers"
            ? voucherItems.length
            : comboContent === "both"
              ? comboPairs.length
              : comboContent === "bills"
                ? billItems.length
                : receiptItems.length;

  /** Pages the export produces — the combo layout always uses one full A4
   *  sheet per pair, regardless of the two-up toggle hidden on that tab. */
  const pageCount =
    docType === "combo" && comboContent === "both"
      ? effCount
      : twoUp
        ? Math.ceil(effCount / 2)
        : effCount;
  const showPages =
    effCount > 0 && (twoUp || (docType === "combo" && comboContent === "both"));

  /** Cells for the bills / vouchers / receipts table of the active tab. */
  const cellsFor = (d: Bill | Voucher): (string | number)[] => {
    const m = memberOf(
      docType === "bills" ? (d as Bill).memberId : (d as Voucher).memberId ?? undefined,
    );
    if (docType === "bills") {
      const b = d as Bill;
      return [
        b.billNo,
        periodLabelLong(b.period),
        m?.name ?? "—",
        formatMoney(b.total),
        formatMoney(b.paidAmount),
        b.status,
      ];
    }
    const v = d as Voucher;
    return docType === "vouchers"
      ? [
          v.voucherNo,
          voucherTitleFor(v.type),
          formatDate(v.date),
          m?.name ?? "—",
          formatMoney(v.total),
        ]
      : [v.voucherNo, formatDate(v.date), m?.name ?? "—", v.mode ?? "—", formatMoney(v.total)];
  };

  const tableHead =
    docType === "bills"
      ? ["Bill No", "Period", "Member", "Total due", "Paid", "Status"]
      : docType === "vouchers"
        ? ["Voucher No", "Type", "Date", "Party", "Amount"]
        : ["Receipt No", "Date", "Member", "Mode", "Amount"];

  /** Month/date-wise shows what will print (read-only); selection-wise lists
   *  the full pool with tick boxes. */
  const tableRows: (Bill | Voucher)[] =
    scope === "selection"
      ? docType === "bills"
        ? selectionBillsPool
        : docType === "vouchers"
          ? selectionVouchersPool
          : selectionReceiptsPool
      : docType === "bills"
        ? scopedBills
        : docType === "vouchers"
          ? scopedVouchers
          : scopedReceipts;

  const docsTable = (
    <SelectionTable
      showChecks={scope === "selection"}
      head={tableHead}
      rows={tableRows.map((d) => ({ id: String(d._id), cells: cellsFor(d) }))}
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
        description="Print bills, receipts and vouchers in batches — month-wise, date-wise, selection-wise or flat-wise, as PDF or Word, one or two per A4 page, or bill + receipt together."
      />

      <Tabs value={docType} onValueChange={(v) => setDocType(v as DocType)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
          <TabsTrigger value="combo">Bill with Receipt</TabsTrigger>
          <TabsTrigger value="flats">Flat wise</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Scope + layout controls */}
      <div className="panel space-y-5 p-5">
        {docType !== "combo" && docType !== "flats" && (
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
                <Select value={activeMonth} onValueChange={pickMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((m) => (
                      <SelectItem key={m} value={m}>{periodLabelLong(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(scope === "range" || scope === "selection") && (
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
            {scope === "selection" && (
              <p className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-3">
                Selection-wise honours this date range: the tick list below shows only documents
                dated between the From and To dates, and only ticked documents inside the range
                print.
              </p>
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
                  <Select value={activeMonth} onValueChange={pickMonth}>
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
                Every bill of {periodLabelLong(activeMonth)} is printed on the upper half of an A4
                sheet, with that member's latest receipt dated {formatDate(rcptFrom)} –{" "}
                {formatDate(rcptTo)} below it. Bills without a receipt in the window still print —
                the lower half carries a “no receipt issued yet” note.
              </p>
            )}
          </div>
        )}

        {docType === "flats" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Print</Label>
              <Select value={flatDoc} onValueChange={(v) => setFlatDoc(v as FlatDoc)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bills">Bills</SelectItem>
                  <SelectItem value="receipts">Receipts</SelectItem>
                  <SelectItem value="vouchers">Vouchers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>From date</Label>
              <Input type="date" value={flatFrom} onChange={(e) => setFlatFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To date</Label>
              <Input type="date" value={flatTo} onChange={(e) => setFlatTo(e.target.value)} />
            </div>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-1">
              Tick one or more flats below, then print every bill, receipt or voucher of those
              members dated between the From and To dates — flat by flat, in flat order.
            </p>
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
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Ruler className="size-3.5" /> Page margins (mm)
            </Label>
            <div className="flex flex-wrap gap-3">
              {MARGIN_FIELDS.map(([k, lbl]) => (
                <div key={k} className="w-20 space-y-1">
                  <Label htmlFor={`mg-${k}`} className="text-xs text-muted-foreground">
                    {lbl}
                  </Label>
                  <Input
                    id={`mg-${k}`}
                    type="number"
                    min={0}
                    max={50}
                    value={margins[k]}
                    onChange={(e) => setMargin(k, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <Files className="size-3.5" />
              {effCount} document{effCount === 1 ? "" : "s"}
              {showPages ? ` · ${pageCount} page(s)` : ""}
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

      {/* Document list — tick boxes in selection scope, print preview otherwise */}
      {docType !== "combo" && docType !== "flats" && (
        <Card className="py-0">
          <CardContent className="px-0">
            {docsTable}
          </CardContent>
        </Card>
      )}

      {/* Flat-wise: tick the flats whose documents should print */}
      {docType === "flats" && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8 pl-4">
                    <Checkbox
                      checked={allFlatSelected}
                      onCheckedChange={(v) => toggleAllFlats(v === true)}
                      aria-label="Select all flats"
                    />
                  </TableHead>
                  <TableHead>Flat</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>In range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersSorted.map((m) => {
                  const id = String(m._id);
                  const count = flatDocCountByMember.get(id) ?? 0;
                  return (
                    <TableRow key={id}>
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={flatSel.has(id)}
                          onCheckedChange={(v) => toggleFlat(id, v === true)}
                          aria-label={`Select flat ${flatOf(m) ?? m.code}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{flatOf(m) ?? "—"}</TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell className="text-muted-foreground">{m.code}</TableCell>
                      <TableCell className="text-muted-foreground">{m.phone ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{count}</TableCell>
                    </TableRow>
                  );
                })}
                {membersSorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No members yet — add flats in the Members page first.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
                          No receipt in range — bill prints alone
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {comboPairs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No bills for {periodLabelLong(activeMonth)}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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

/** Document list: tick-to-include in selection scope, read-only preview otherwise. */
function SelectionTable({
  showChecks = false,
  head,
  rows,
  selected,
  allSelected,
  onToggleAll,
  onToggle,
}: {
  showChecks?: boolean;
  head: string[];
  rows: { id: string; cells: (string | number)[] }[];
  selected: Set<string>;
  allSelected: boolean;
  onToggleAll: (on: boolean) => void;
  onToggle: (id: string, on: boolean) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {showChecks
          ? "Nothing to select yet."
          : "No documents match this scope — change the month or dates above."}
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {showChecks && (
            <TableHead className="w-8 pl-4">
              <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleAll(v === true)} aria-label="Select all" />
            </TableHead>
          )}
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            {showChecks && (
              <TableCell className="pl-4">
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={(v) => onToggle(r.id, v === true)}
                  aria-label={`Select ${r.cells[0]}`}
                />
              </TableCell>
            )}
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
