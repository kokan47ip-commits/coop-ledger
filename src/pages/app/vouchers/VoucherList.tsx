import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { EmptyHint, RightMoney } from "@/components/PageParts";
import {
  exportPDF,
  exportWord,
  printTables,
  type ExportMeta,
  type TableSpec,
} from "@/lib/export";
import {
  bytesToBase64,
  periodLabelLong,
  printReceiptWindows,
  receiptPdf,
  receiptPdfBytes,
  receiptPrint,
  receiptWord,
  receiptsPdfBatch,
  receiptsWordBatch,
  voucherPdf,
  voucherPdfBytes,
  voucherPrint,
  voucherWord,
  voucherTitleFor,
  type LegacyReceiptData,
  type VoucherDocData,
} from "@/lib/billDoc";
import { useCommitteeSignatures } from "@/lib/committee";
import { formatDate, formatINR, monthRangeISO, VOUCHER_TYPE_LABEL } from "@/lib/format";
import {
  CalendarRange,
  Download,
  FileText,
  Mail,
  MessageCircle,
  Pencil,
  Printer,
  Receipt as ReceiptIcon,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Voucher = Doc<"vouchers">;

const TYPE_FILTERS = [
  { value: "all", label: "All types" },
  { value: "member_receipt", label: "Member receipts" },
  { value: "other_receipt", label: "Other receipts" },
  { value: "payment", label: "Payments" },
  { value: "journal", label: "Journals" },
];

const EDIT_ROUTE: Record<string, string> = {
  member_receipt: "/app/member-receipt",
  other_receipt: "/app/other-receipt",
  payment: "/app/payment",
  journal: "/app/journal",
};

/**
 * Recorded-voucher table shared by the four voucher pages. Provides:
 * - type filter (or fixed), date-wise and month-wise filters
 * - selection-wise printing via row checkboxes
 * - per-row edit (routes back into the matching voucher form) and delete
 * - legacy-format single-voucher print / PDF / Word
 *
 * With `receiptMode="receipt"` the export buttons produce the legacy-format
 * RECEIPT document for each selected voucher (optionally two receipts per A4
 * page) instead of the voucher register.
 */
export function VoucherList({
  title,
  fixedType,
  renderReceipt,
  receiptMode = "voucher",
  receiptNoun = "Vouchers",
}: {
  title: string;
  description: string;
  fixedType?: "member_receipt" | "other_receipt" | "payment" | "journal";
  /** Optional override for row-level legacy-receipt actions. */
  renderReceipt?: (v: Voucher, kind: "pdf" | "word" | "print") => void;
  /** "voucher" (default) exports voucher documents; "receipt" exports receipts. */
  receiptMode?: "voucher" | "receipt";
  /** Label for the selection-wise buttons, e.g. "Receipts". */
  receiptNoun?: string;
}) {
  const { societyId, society, canEdit } = useSociety();
  const navigate = useNavigate();
  const vouchers = useQuery(
    api.vouchers.list,
    societyId ? { societyId } : "skip",
  ) as Voucher[] | undefined;
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip");
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip");
  const bills = useQuery(
    api.bills.list,
    societyId && receiptMode === "receipt" ? { societyId } : "skip",
  );
  const remove = useMutation(api.vouchers.remove);
  const sendDocs = useAction(api.emailer.sendDocs);
  const sendWhatsappDocs = useAction(api.whatsapp.sendWhatsapp);
  const signatures = useCommitteeSignatures();
  const [typeFilter, setTypeFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Pack two receipt boxes per A4 page when printing / exporting receipts. */
  const [twoUp, setTwoUp] = useState(true);
  // Email receipts/vouchers for the ticked rows.
  const [mailOpen, setMailOpen] = useState(false);
  const [mailing, setMailing] = useState(false);
  // WhatsApp receipts/vouchers for the ticked rows.
  const [waOpen, setWaOpen] = useState(false);
  const [waSending, setWaSending] = useState(false);

  const filtered = useMemo(() => {
    let list = [...(vouchers ?? [])].sort((a, b) =>
      a.date === b.date
        ? b.voucherNo.localeCompare(a.voucherNo)
        : b.date.localeCompare(a.date),
    );
    if (fixedType) list = list.filter((v) => v.type === fixedType);
    else if (typeFilter !== "all") list = list.filter((v) => v.type === typeFilter);
    if (from) list = list.filter((v) => v.date >= from);
    if (to) list = list.filter((v) => v.date <= to);
    if (month) {
      const r = monthRangeISO(month);
      list = list.filter((v) => v.date >= r.from && v.date <= r.to);
    }
    return list;
  }, [vouchers, fixedType, typeFilter, from, to, month]);

  const accountName = (id: string) =>
    accounts?.find((a) => a._id === id)?.name ?? "—";

  const total = filtered.reduce((s, v) => s + v.total, 0);
  const selectedRows = filtered.filter((v) => selected.has(v._id));
  const allChecked = filtered.length > 0 && selectedRows.length === filtered.length;

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(filtered.map((v) => v._id)) : new Set());
  const toggleOne = (id: string, checked: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const voucherLines = (v: Voucher) =>
    v.lines.map((l) => ({
      code: accounts?.find((a) => a._id === l.accountId)?.code ?? "",
      name: accountName(l.accountId),
      debit: l.debit,
      credit: l.credit,
      note: l.note,
    }));

  /** Legacy-format receipt document data for one saved voucher. */
  const buildReceiptDataFor = (v: Voucher): LegacyReceiptData | null => {
    if (!society) return null;
    const mem = members?.find((m) => m._id === v.memberId);
    const firstBill = (bills ?? [])
      .filter((b) => (v.allocations ?? []).some((a) => a.billId === b._id))
      .sort((a, b) => b.period.localeCompare(a.period))[0];
    return {
      society: {
        name: society.name,
        address: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
      },
      receiptNo: v.voucherNo.replace(/^[A-Z]+-/, ""),
      receiptDate: v.date,
      memberName: mem?.name ?? v.mode ?? "Member",
      flatNo: [mem?.wing, mem?.flatNo].filter(Boolean).join("-") || undefined,
      amount: v.total,
      paymentKind: "part",
      purpose: firstBill
        ? `Maintenance for the Month ${periodLabelLong(firstBill.period)}`
        : v.narration || "Maintenance dues",
      mode: v.mode,
      reference: v.reference,
      // Society-wide printing format (receipts share the bill's layout key).
      format: society.billDocFormat,
    };
  };

  const meta = (list: Voucher[], t = title): ExportMeta | null =>
    society
      ? {
          societyName: society.name,
          societyAddress: [society.address, society.city, society.state, society.pincode]
            .filter(Boolean)
            .join(", "),
          registrationNo: society.registrationNo,
          title: t,
          subtitle:
            list.length > 0
              ? `${list.length} vouchers · ${formatDate(list[list.length - 1].date)} to ${formatDate(list[0].date)} · Total ${formatINR(list.reduce((s, v) => s + v.total, 0))}`
              : "No vouchers in the selected range",
          signatures,
        }
      : null;

  const buildTable = (list: Voucher[]): TableSpec => ({
    head: ["Voucher No", "Date", "Type", "Member", "Particulars", "Amount"],
    body: list.map((v) => {
      const member = members?.find((m) => m._id === v.memberId);
      const particulars =
        v.lines
          .map((l) => accountName(l.accountId))
          .filter((n, i, arr) => arr.indexOf(n) === i)
          .join(" / ") || v.narration || "";
      return [
        v.voucherNo,
        formatDate(v.date),
        VOUCHER_TYPE_LABEL[v.type],
        member?.name ?? "",
        v.narration ?? particulars,
        v.total,
      ];
    }),
    foot: [["", "", "", "", "TOTAL", list.reduce((s, v) => s + v.total, 0)]],
    columnStyles: { 5: { halign: "right" } },
  });

  const doExport = (kind: "pdf" | "word" | "print") => {
    const m = meta(filtered);
    if (!m) return;
    const table = buildTable(filtered);
    if (kind === "pdf") exportPDF(m, [table], "vouchers.pdf");
    else if (kind === "word") exportWord(m, [table], "vouchers.doc");
    else printTables(m, [table]);
  };

  /**
   * Selection-wise export. In receipt mode the ticked vouchers become actual
   * receipt documents (one file, two per A4 when enabled) — not a register.
   */
  const doExportSelected = (kind: "pdf" | "word" | "print") => {
    if (selectedRows.length === 0) {
      toast.error("Tick at least one voucher first.");
      return;
    }
    if (receiptMode === "receipt") {
      const items = selectedRows
        .map((v) => buildReceiptDataFor(v))
        .filter((d): d is LegacyReceiptData => d !== null)
        .map((data) => ({ data }));
      if (items.length === 0) {
        toast.error("Could not build receipts for the selection.");
        return;
      }
      if (kind === "pdf") receiptsPdfBatch(items, "receipts.pdf", twoUp);
      else if (kind === "word") receiptsWordBatch(items, "receipts.doc");
      else printReceiptWindows(items.map((i) => i.data));
      return;
    }
    const m = meta(selectedRows, `${title} — Selected (${selectedRows.length})`);
    if (!m) return;
    const table = buildTable(selectedRows);
    if (kind === "pdf") exportPDF(m, [table], "vouchers-selected.pdf");
    else if (kind === "word") exportWord(m, [table], "vouchers-selected.doc");
    else printTables(m, [table]);
  };

  /** Rows that document as a RECEIPT (member/other receipts) rather than a voucher. */
  const isReceiptRow = (v: Voucher) =>
    v.type === "member_receipt" || v.type === "other_receipt";

  /**
   * WhatsApp each ticked row to its member as a PDF — the legacy receipt
   * document for receipt rows, the voucher document otherwise.
   */
  const sendVoucherWhatsapp = async () => {
    if (!societyId || !society) return;
    const messages = selectedRows
      .map((v) => {
        const mem = members?.find((m) => m._id === v.memberId);
        const phone = mem?.phone?.trim() ?? "";
        if (phone.replace(/\D/g, "").length < 10) return null;
        const docLabel = isReceiptRow(v)
          ? `Payment Receipt ${v.voucherNo.replace(/^[A-Z]+-/, "")}`
          : `${voucherTitleFor(v.type)} ${v.voucherNo}`;
        return {
          phone,
          name: mem?.name ?? "Member",
          docLabel,
          filename: isReceiptRow(v) ? `receipt-${v.voucherNo}.pdf` : `${v.voucherNo}.pdf`,
          contentBase64: isReceiptRow(v)
            ? (() => {
                const d = buildReceiptDataFor(v);
                return d ? bytesToBase64(receiptPdfBytes(d)) : "";
              })()
            : (() => {
                const member = members?.find((m) => m._id === v.memberId);
                const data: VoucherDocData = {
                  society: {
                    name: society.name,
                    address: [society.address, society.city, society.state, society.pincode]
                      .filter(Boolean)
                      .join(", "),
                    registrationNo: society.registrationNo,
                  },
                  title: voucherTitleFor(v.type),
                  voucherNo: v.voucherNo,
                  voucherDate: v.date,
                  bookCode: fixedType ?? v.type,
                  party: v.mode || member?.name,
                  mode: v.type === "member_receipt" ? v.mode : undefined,
                  chequeNo: v.reference,
                  bankName: (v.narration ?? "").match(/(?:— )?Bank: (.+)$/)?.[1]?.trim(),
                  narration: v.narration ?? undefined,
                  amount: v.total,
                  lines: voucherLines(v),
                };
                return bytesToBase64(voucherPdfBytes(data));
              })(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.contentBase64 !== "");
    const skipped = selectedRows.length - messages.length;
    setWaSending(true);
    try {
      const res = await sendWhatsappDocs({ societyId, messages });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      const skipNote = skipped > 0 ? ` · ${skipped} row(s) skipped (no member phone)` : "";
      if (failed.length > 0) {
        toast.error(`Sent ${ok}; ${failed.length} failed. ${failed[0]?.error ?? ""}${skipNote}`);
      } else {
        toast.success(`Sent ${ok} WhatsApp message(s).${skipNote}`);
      }
      setWaOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send WhatsApp messages");
    } finally {
      setWaSending(false);
    }
  };

  /**
   * Email each ticked row to its member as a PDF attachment — the legacy
   * receipt document for receipt rows, the voucher document otherwise.
   */
  const sendVoucherEmails = async () => {
    if (!societyId || !society) return;
    const messages = selectedRows
      .map((v) => {
        const mem = members?.find((m) => m._id === v.memberId);
        const to = mem?.email?.trim() ?? "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return null;
        if (isReceiptRow(v)) {
          const d = buildReceiptDataFor(v);
          if (!d) return null;
          return {
            to,
            subject: `Payment Receipt ${d.receiptNo} — ${society.name}`,
            html: `<p>Dear ${d.memberName},</p><p>Thank you for your payment of <b>Rs. ${d.amount.toFixed(2)}</b> (${d.purpose}). The receipt is attached.</p><p>This is a computer-generated mail from the society office.</p>`,
            attachments: [
              { filename: `receipt-${v.voucherNo}.pdf`, contentBase64: bytesToBase64(receiptPdfBytes(d)) },
            ],
          };
        }
        const member = members?.find((m) => m._id === v.memberId);
        const data: VoucherDocData = {
          society: {
            name: society.name,
            address: [society.address, society.city, society.state, society.pincode]
              .filter(Boolean)
              .join(", "),
            registrationNo: society.registrationNo,
          },
          title: voucherTitleFor(v.type),
          voucherNo: v.voucherNo,
          voucherDate: v.date,
          bookCode: fixedType ?? v.type,
          party: v.mode || member?.name,
          mode: v.type === "member_receipt" ? v.mode : undefined,
          chequeNo: v.reference,
          bankName: (v.narration ?? "").match(/(?:— )?Bank: (.+)$/)?.[1]?.trim(),
          narration: v.narration ?? undefined,
          amount: v.total,
          lines: voucherLines(v),
        };
        return {
          to,
          subject: `${data.title} ${v.voucherNo} — ${society.name}`,
          html: `<p>Dear ${member?.name ?? "Member"},</p><p>${data.title} ${v.voucherNo} dated ${formatDate(v.date)} for <b>Rs. ${v.total.toFixed(2)}</b> is attached.</p><p>This is a computer-generated mail from the society office.</p>`,
          attachments: [
            { filename: `${v.voucherNo}.pdf`, contentBase64: bytesToBase64(voucherPdfBytes(data)) },
          ],
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const skipped = selectedRows.length - messages.length;
    setMailing(true);
    try {
      const res = await sendDocs({ societyId, messages });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      const skipNote = skipped > 0 ? ` · ${skipped} row(s) skipped (no member email)` : "";
      if (failed.length > 0) {
        toast.error(`Emailed ${ok}; ${failed.length} failed. ${failed[0]?.error ?? ""}${skipNote}`);
      } else {
        toast.success(`Emailed ${ok} document(s).${skipNote}`);
      }
      setMailOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to email");
    } finally {
      setMailing(false);
    }
  };

  /** Single-voucher / single-receipt row action. */
  const rowPrint = (v: Voucher, kind: "pdf" | "word" | "print") => {
    if (isReceiptRow(v)) {
      const d = buildReceiptDataFor(v);
      if (!d) return;
      if (kind === "pdf") receiptPdf(d, `receipt-${v.voucherNo}.pdf`);
      else if (kind === "word") receiptWord(d, `receipt-${v.voucherNo}.doc`);
      else receiptPrint(d);
      return;
    }
    printOne(v, kind);
  };

  /** Single voucher in the legacy bordered format. */
  const printOne = (v: Voucher, kind: "pdf" | "word" | "print") => {
    if (!society) return;
    const member = members?.find((m) => m._id === v.memberId);
    const data: VoucherDocData = {
      society: {
        name: society.name,
        address: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
      },
      title: voucherTitleFor(v.type),
      voucherNo: v.voucherNo,
      voucherDate: v.date,
      bookCode: fixedType ?? v.type,
      party: v.mode || member?.name,
      mode: v.type === "member_receipt" ? v.mode : undefined,
      chequeNo: v.reference,
      bankName: (v.narration ?? "").match(/(?:— )?Bank: (.+)$/)?.[1]?.trim(),
      narration: v.narration ?? undefined,
      amount: v.total,
      lines: voucherLines(v),
    };
    if (kind === "pdf") voucherPdf(data, `${v.voucherNo}.pdf`);
    else if (kind === "word") voucherWord(data, `${v.voucherNo}.doc`);
    else voucherPrint(data);
  };

  const del = async (v: Voucher) => {
    if (!societyId) return;
    if (!confirm(`Delete voucher ${v.voucherNo}?`)) return;
    try {
      await remove({ societyId, id: v._id });
      setSelected((s) => {
        const next = new Set(s);
        next.delete(v._id);
        return next;
      });
      toast.success("Voucher deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const editVoucher = (v: Voucher) => {
    const route = EDIT_ROUTE[v.type] ?? "/app/journal";
    navigate(`${route}?edit=${v._id}`);
  };

  const dateFiltersActive = Boolean(from || to || month);

  return (
    <div>
      {/* Filters: date-wise / month-wise */}
      <div className="panel mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="vl-from" className="text-xs text-muted-foreground">From</Label>
          <Input id="vl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-36" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vl-to" className="text-xs text-muted-foreground">To</Label>
          <Input id="vl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-8 w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Month</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="h-8 w-36" />
        </div>
        {!fixedType && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_FILTERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {dateFiltersActive && (
          <Button variant="ghost" size="sm" className="h-8"
            onClick={() => { setFrom(""); setTo(""); setMonth(""); }}>
            <X className="size-3.5" /> Clear
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} vouchers · {formatINR(total)}
        </span>
      </div>

      {/* Export bar: date-wise/month-wise list + selection-wise */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => doExport("pdf")}
          className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          title={receiptMode === "receipt" ? "Receipt register for the filtered list" : undefined}>
          <Download className="size-4" /> {receiptMode === "receipt" ? "Register PDF" : `PDF ${dateFiltersActive ? "(filtered)" : ""}`}
        </Button>
        <Button variant="outline" size="sm" onClick={() => doExport("word")}
          className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
          title={receiptMode === "receipt" ? "Receipt register for the filtered list" : undefined}>
          <FileText className="size-4" /> {receiptMode === "receipt" ? "Register Word" : "Word"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => doExport("print")}
          className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
          title={receiptMode === "receipt" ? "Receipt register for the filtered list" : undefined}>
          <Printer className="size-4" /> {receiptMode === "receipt" ? "Register Print" : "Print"}
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="outline" size="sm" disabled={selectedRows.length === 0}
          className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          onClick={() => doExportSelected("pdf")}>
          <CalendarRange className="size-4" /> {receiptNoun} PDF ({selectedRows.length})
        </Button>
        <Button variant="outline" size="sm" disabled={selectedRows.length === 0}
          className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
          onClick={() => doExportSelected("word")}>
          <FileText className="size-4" /> {receiptNoun} Word
        </Button>
        <Button variant="outline" size="sm" disabled={selectedRows.length === 0}
          className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
          onClick={() => doExportSelected("print")}>
          <Printer className="size-4" /> {receiptNoun} Print
        </Button>
        {receiptMode === "receipt" && (
          <>
            <Button variant="outline" size="sm" disabled={selectedRows.length === 0}
              onClick={() => setMailOpen(true)}>
              <Mail className="size-4" /> Email
            </Button>
            <Button variant="outline" size="sm" disabled={selectedRows.length === 0}
              onClick={() => setWaOpen(true)}>
              <MessageCircle className="size-4" /> WhatsApp
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
              <Checkbox checked={twoUp} onCheckedChange={(c) => setTwoUp(c === true)} />
              2 per A4
            </label>
          </>
        )}
      </div>

      {!vouchers ? null : filtered.length === 0 ? (
        <EmptyHint>No vouchers match the current filters.</EmptyHint>
      ) : (
        <div className="panel">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={(c) => toggleAll(c === true)}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Voucher No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-10 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => {
                const member = members?.find((m) => m._id === v.memberId);
                return (
                  <TableRow key={v._id} data-state={selected.has(v._id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(v._id)}
                        onCheckedChange={(c) => toggleOne(v._id, c === true)}
                        aria-label={`Select ${v.voucherNo}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">{v.voucherNo}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(v.date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{VOUCHER_TYPE_LABEL[v.type]}</Badge>
                    </TableCell>
                    <TableCell>{member?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {v.narration ?? v.lines.map((l) => accountName(l.accountId)).join(" / ")}
                    </TableCell>
                    <TableCell className="text-right">
                      <RightMoney value={v.total} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {renderReceipt && v.type === "member_receipt" ? (
                          <>
                            <Button variant="ghost" size="icon" className="size-7"
                              title="Receipt PDF" onClick={() => renderReceipt(v, "pdf")}>
                              <Download className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-7"
                              title="Receipt Word" onClick={() => renderReceipt(v, "word")}>
                              <FileText className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-7"
                              title="Print receipt" onClick={() => renderReceipt(v, "print")}>
                              <ReceiptIcon className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="size-7"
                              title={isReceiptRow(v) ? "Receipt PDF" : "Voucher PDF"} onClick={() => rowPrint(v, "pdf")}>
                              <Download className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-7"
                              title={isReceiptRow(v) ? "Receipt Word" : "Voucher Word"} onClick={() => rowPrint(v, "word")}>
                              <FileText className="size-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-7"
                              title={isReceiptRow(v) ? "Print receipt" : "Print voucher"} onClick={() => rowPrint(v, "print")}>
                              {isReceiptRow(v) ? <ReceiptIcon className="size-3.5" /> : <Printer className="size-3.5" />}
                            </Button>
                          </>
                        )}
                        {canEdit && (
                          <Button variant="ghost" size="icon" className="size-7"
                            title="Edit" onClick={() => editVoucher(v)}>
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                        {canEdit && (
                          <Button variant="ghost" size="icon" className="size-7 text-destructive"
                            title="Delete" onClick={() => del(v)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <tfoot>
              <TableRow className="border-t-2 bg-muted/40 hover:bg-transparent">
                <TableCell colSpan={6} className="font-semibold">Total — {filtered.length} voucher{filtered.length === 1 ? "" : "s"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatINR(total)}
                </TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          </Table>
        </div>
      )}

      {/* Email ticked receipts/vouchers to their members */}
      <Dialog open={mailOpen} onOpenChange={setMailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email {receiptNoun.toLowerCase()} — {selectedRows.length} selected</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-accent/30 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rows to email</span>
                <span className="tabular-nums">{selectedRows.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">No email on member profile</span>
                <span className="tabular-nums">
                  {selectedRows.filter((v) => {
                    const email = members?.find((m) => m._id === v.memberId)?.email?.trim() ?? "";
                    return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
                  }).length}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Each member receives their own document as a PDF, in the same
              legacy format as the download buttons. Rows whose member has no
              email address are skipped.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMailOpen(false)} disabled={mailing}>
              Cancel
            </Button>
            <Button type="button" onClick={sendVoucherEmails} disabled={mailing || selectedRows.length === 0}>
              {mailing ? "Sending…" : `Email ${selectedRows.length} document${selectedRows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp ticked receipts/vouchers to their members */}
      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>WhatsApp {receiptNoun.toLowerCase()} — {selectedRows.length} selected</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-accent/30 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rows to send</span>
                <span className="tabular-nums">{selectedRows.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">No phone on member profile</span>
                <span className="tabular-nums">
                  {selectedRows.filter((v) => {
                    const phone = members?.find((m) => m._id === v.memberId)?.phone?.trim() ?? "";
                    return phone.replace(/\D/g, "").length < 10;
                  }).length}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Each member receives their own document as a PDF on WhatsApp,
              sent through the society's WhatsApp Business number. Rows whose
              member has no phone number are skipped.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWaOpen(false)} disabled={waSending}>
              Cancel
            </Button>
            <Button type="button" onClick={sendVoucherWhatsapp} disabled={waSending || selectedRows.length === 0}>
              {waSending ? "Sending…" : `Send to ${selectedRows.length} member${selectedRows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
