import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { exportExcel, exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { billPdf, billPdfBytes, billWord, bytesToBase64, receiptPdf, receiptPrint, receiptWord, periodLabelLong, type LegacyBillData, type LegacyReceiptData } from "@/lib/billDoc";
import { useCommitteeSignatures } from "@/lib/committee";
import { currentPeriod, effectiveFyPeriod, formatMoney, formatPeriod, todayISO } from "@/lib/format";
import { BookText, Download, FileSpreadsheet, FileText, HandCoins, Mail, MessageCircle, Plus, Printer, Receipt as ReceiptIcon, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Bill = Doc<"bills">;
type Member = Doc<"members">;
type Tariff = Doc<"tariffs">;

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08" -> "August 2026" */
function periodLong(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS_FULL[Number(m) - 1] ?? m} ${y}`;
}

/** Non-charge lines: carried opening balance (arrears or credit/advance). */
function isArrearsLine(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("arrears") || n.startsWith("credit balance");
}

export default function BillRegister() {
  const { societyId, society, canEdit } = useSociety();
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const tariffs = useQuery(api.tariffs.list, societyId ? { societyId } : "skip") as Tariff[] | undefined;
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Doc<"accounts">[] | undefined;
  const vouchersData = useQuery(api.vouchers.list, societyId ? { societyId } : "skip") as
    | Doc<"vouchers">[]
    | undefined;
  const generate = useMutation(api.bills.generate);
  const updateLines = useMutation(api.bills.updateLines);
  const removeBill = useMutation(api.bills.remove);
  const createVoucher = useMutation(api.vouchers.create);
  const sendDocs = useAction(api.emailer.sendDocs);
  const sendWhatsappDocs = useAction(api.whatsapp.sendWhatsapp);
  const signatures = useCommitteeSignatures();
  const navigate = useNavigate();

  const [payOpen, setPayOpen] = useState(false);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [payForm, setPayForm] = useState({
    date: todayISO(),
    amount: "",
    mode: "cash",
    bankCashAccountId: "",
    reference: "",
    narration: "",
  });

  // ---- View Bills filter bar (Billing Period / Building / Wing / Unit Type / Floor) ----
  const [periodFilter, setPeriodFilter] = useState(currentPeriod());
  const [building, setBuilding] = useState("");
  const [wing, setWing] = useState("");
  const [unitType, setUnitType] = useState("");
  const [floor, setFloor] = useState("");
  const [buildupArea, setBuildupArea] = useState("");
  const [carpetArea, setCarpetArea] = useState("");
  const [applied, setApplied] = useState({
    building: "", wing: "", unitType: "", floor: "", buildupArea: "", carpetArea: "",
  });

  // ---- Editable grid state: { [billId]: { [tariffId]: raw string } } ----
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // Email bills: scope (ticked rows vs all filtered) and send state.
  const [mailOpen, setMailOpen] = useState(false);
  const [mailScope, setMailScope] = useState<"selected" | "filtered">("selected");
  const [mailing, setMailing] = useState(false);
  // WhatsApp bills: same scoping as email.
  const [waOpen, setWaOpen] = useState(false);
  const [waScope, setWaScope] = useState<"selected" | "filtered">("selected");
  const [waSending, setWaSending] = useState(false);
  const hasEdits = Object.keys(edits).length > 0;

  // Bill generation inputs
  const [period, setPeriod] = useState(currentPeriod());
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  // Arrears as-on date: the cutoff for carrying forward earlier unpaid bills.
  const [arrearsDate, setArrearsDate] = useState(effectiveFyPeriod(society).from);
  const [generating, setGenerating] = useState(false);
  // Interest / late fee on the outstanding balance, charged at generation.
  // The rate STARTS from the society's saved late-fee setting so it is stable
  // across months — generation with a percent rate saves it back, so it only
  // changes when the user actually edits it (here or in Society Profile).
  const [interestMode, setInterestMode] = useState<"none" | "percent" | "fixed">("none");
  const [interestRate, setInterestRate] = useState("1.5");
  const rateTouched = useRef(false);
  useEffect(() => {
    if (!rateTouched.current && society?.lateFeePercent !== undefined) {
      setInterestRate(String(society.lateFeePercent));
    }
  }, [society?.lateFeePercent]);
  const [interestFixed, setInterestFixed] = useState("100");
  const [interestAccountId, setInterestAccountId] = useState("");
  // Replace existing bills of the period (applies new rates/amounts/interest).
  const [replaceBills, setReplaceBills] = useState(false);
  // Interest column is always available — it shows 0.00 for bills with none.
  const [showInterestCol, setShowInterestCol] = useState(true);
  const incomeAccounts = (accounts ?? []).filter((a) => a.type === "income");
  const defaultInterestAccountId =
    incomeAccounts.find((a) => a.name.toLowerCase().includes("interest"))?._id ??
    incomeAccounts.slice().sort((a, b) => a.code.localeCompare(b.code))[0]?._id;
  const deleteMonth = useMutation(api.bills.removeByPeriod);
  const [deletingMonth, setDeletingMonth] = useState(false);

  const memberOf = (id: Id<"members">) => members?.find((m) => m._id === id);
  const unitNo = (m?: Member) => m?.flatNo || m?.code || "—";

  // Distinct billing periods for the dropdown, newest first, always including
  // the current month so a fresh period can be selected before generating.
  const periodOptions = useMemo(() => {
    const set = new Set<string>((bills ?? []).map((b) => b.period));
    set.add(currentPeriod());
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [bills]);

  // Principal arrears: everything the member still owes from bills issued
  // before the selected period. Interest arrears are shown as 0.00 until an
  // interest head is billed; the column keeps the legacy layout.
  const arrearsBefore = (memberId: Id<"members">, beforePeriod: string) => {
    let principal = 0;
    for (const b of bills ?? []) {
      if (b.memberId === memberId && b.period < beforePeriod) {
        principal += b.total - b.paidAmount;
      }
    }
    return principal;
  };

  const tariffColumns = useMemo(() => tariffs ?? [], [tariffs]);
  const lineAmount = (b: Bill, tariffId: Id<"tariffs">) =>
    b.lines.find((l) => l.tariffId === tariffId)?.amount ?? 0;

  // Rows for the selected period: one per member's bill, sorted by unit no.
  const rows = useMemo(() => {
    if (!bills) return [];
    const inPeriod = bills.filter((b) => b.period === periodFilter);
    const f = applied;
    const numEq = (val: number | undefined, filter: string) =>
      filter !== "" && (val ?? 0) !== Number(filter);
    const match = (m?: Member) => {
      if (!m) return false;
      if (f.building && !(m.building ?? "").toLowerCase().includes(f.building.toLowerCase())) return false;
      if (f.wing && !(m.wing ?? "").toLowerCase().includes(f.wing.toLowerCase())) return false;
      if (f.unitType && !(m.unitType ?? "").toLowerCase().includes(f.unitType.toLowerCase())) return false;
      if (f.floor && !(m.floor ?? "").toLowerCase().includes(f.floor.toLowerCase())) return false;
      if (numEq(m.buildupArea, f.buildupArea)) return false;
      if (numEq(m.carpetArea, f.carpetArea)) return false;
      return true;
    };
    return inPeriod
      .filter((b) => match(memberOf(b.memberId)))
      .sort((a, b) => unitNo(memberOf(a.memberId)).localeCompare(unitNo(memberOf(b.memberId))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, members, periodFilter, applied, tariffColumns]);

  /** Charge lines only — the opening balance carried on the bill ("Arrears
   *  — …") is reported in the arrears columns, not hidden in the Bill amount. */
  const billCharges = (b: Bill) =>
    (b.lines ?? []).filter((l) => !isArrearsLine(l.name)).reduce((s, l) => s + l.amount, 0);
  /** Interest / late-fee line on the bill, if any. */
  const billInterest = (b: Bill) =>
    (b.lines ?? [])
      .filter((l) => /^(interest|late fee)/i.test(l.name))
      .reduce((s, l) => s + l.amount, 0);
  /** Opening balance carried into this bill at generation (first bill only). */
  const billCarried = (b: Bill) =>
    (b.lines ?? []).filter((l) => isArrearsLine(l.name)).reduce((s, l) => s + l.amount, 0);
  /** Principal arrears for the register: earlier unpaid bills PLUS the
   *  opening balance carried on this bill, so it is visible instead of
   *  silently inflating the Bill column. */
  const principalArrFor = (b: Bill) =>
    arrearsBefore(b.memberId, periodFilter) + billCarried(b);

  /** Row-level total due: edited/current tariff lines + custom lines + arrears. */
  const rowTotal = (b: Bill, principal: number) => {
    let sum = principal;
    for (const t of tariffColumns) {
      const edited = edits[b._id]?.[t._id];
      sum += edited !== undefined && edited !== "" ? Number(edited) : lineAmount(b, t._id);
    }
    // Custom charge lines outside the tariff columns still count toward the due.
    const tariffIds = new Set(tariffColumns.map((t) => t._id));
    for (const l of b.lines ?? []) {
      if (isArrearsLine(l.name)) continue;
      if (l.tariffId && tariffIds.has(l.tariffId)) continue;
      sum += l.amount;
    }
    return sum;
  };

  const totals = useMemo(() => {
    const t = {
      count: rows.length,
      billTotal: 0,
      principalArr: 0,
      interestArr: 0,
      totalArr: 0,
      totalDue: 0,
      perTariff: {} as Record<string, number>,
    };
    for (const b of rows) {
      const principal = principalArrFor(b);
      const due = rowTotal(b, principal);
      t.billTotal += due - principal;
      t.principalArr += principal;
      t.totalArr += principal;
      t.totalDue += due;
      for (const tc of tariffColumns) {
        const edited = edits[b._id]?.[tc._id];
        const amt = edited !== undefined && edited !== "" ? Number(edited) : lineAmount(b, tc._id);
        t.perTariff[tc._id] = (t.perTariff[tc._id] ?? 0) + amt;
      }
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, periodFilter, tariffColumns, bills, edits]);

  /** Legacy-format receipt for the latest receipt against this bill. */
  const exportBillReceipt = (b: Bill, kind: "pdf" | "word" | "print") => {
    if (!society) return;
    const receipt = (vouchersData ?? [])
      .filter((v) => v.memberId === b.memberId && v.type === "member_receipt")
      .sort((a, c) => c.date.localeCompare(a.date))[0];
    if (!receipt) {
      toast.error("No receipt found against this bill yet.");
      return;
    }
    const mem = memberOf(b.memberId);
    const receiptData: LegacyReceiptData = {
      society: {
        name: society.name,
        address: [society.address, society.city, society.state, society.pincode].filter(Boolean).join(", "),
        registrationNo: society.registrationNo,
      },
      receiptNo: receipt.voucherNo.replace(/^[A-Z]+-/, ""),
      receiptDate: receipt.date,
      memberName: mem?.name ?? "Member",
      flatNo: [mem?.wing, mem?.flatNo].filter(Boolean).join("-") || undefined,
      amount: receipt.total,
      paymentKind: b.total - b.paidAmount <= 0 ? "full" : "part",
      purpose: `Maintenance for the Month ${periodLabelLong(b.period)}`,
      mode: receipt.mode,
      reference: receipt.reference,
    };
    if (kind === "pdf") receiptPdf(receiptData, `receipt-${receipt.voucherNo}.pdf`);
    else if (kind === "word") receiptWord(receiptData, `receipt-${receipt.voucherNo}.doc`);
    else receiptPrint(receiptData);
  };

  /** Single-bill export in the legacy Shama-I format. */
  const buildBillData = (b: Bill): LegacyBillData | null => {
    if (!society) return null;
    const m = memberOf(b.memberId);
    const arrearsFromBills = (bills ?? [])
      .filter((x) => x.memberId === b.memberId && x.period < b.period)
      .reduce((s, x) => s + (x.total - x.paidAmount), 0);
    const arrearsOnBill = (b.lines ?? [])
      .filter((l) => isArrearsLine(l.name))
      .reduce((s, l) => s + l.amount, 0);
    // A negative carried line is the member's advance / credit balance —
    // handed to the renderer signed so the printed label reads "Advance:".
    const arrears = arrearsFromBills + arrearsOnBill;
    const currentCharges = (b.lines ?? [])
      .filter((l) => !isArrearsLine(l.name))
      .reduce((s, l) => s + l.amount, 0);
    return {
      society: {
        name: society.name,
        address: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
      },
      billNo: b.billNo.replace(/^BILL-/, ""),
      billDate: b.issueDate,
      dueDate: b.dueDate,
      periodLabel: periodLabelLong(b.period),
      memberName: m?.name ?? "Member",
      flatNo: [m?.wing, m?.flatNo].filter(Boolean).join("-") || undefined,
      lines: (b.lines ?? [])
        .filter((l) => !isArrearsLine(l.name))
        // Full head names on printed/emailed bills — resolve short names
        // saved before full-name printing through the tariff schedule.
        .map((l) => ({
          name: (l.tariffId && tariffs?.find((t) => t._id === l.tariffId)?.name) || l.name,
          amount: l.amount,
          serial: l.printNo,
        })),
      total: currentCharges,
      arrears,
      totalDue: currentCharges + arrears,
      paidAmount: b.paidAmount,
      lateFeePercent: society.lateFeePercent,
      // Supplementary bills print with a "SUPPLEMENTARY BILL" title band
      // instead of the monthly period band.
      supplementary:
        (b as { billKind?: string }).billKind === "supplementary"
          ? { category: b.category }
          : undefined,
    };
  };

  const exportSingle = (b: Bill, kind: "pdf" | "word") => {
    const data = buildBillData(b);
    if (!data) return;
    const m = memberOf(b.memberId);
    const name = m ? `${m.code}-${b.billNo}` : b.billNo;
    if (kind === "pdf") billPdf(data, `${name}.pdf`);
    else billWord(data, `${name}.doc`);
  };

  // ---- Crystal-style "Regular Bills Register" export for the selected period ----
  const buildRegisterTable = (): TableSpec => {
    const head = [
      "Bill No", "Unit No.", "Unit Name",
      "Bill", "Principal", "Interest", "Total Due",
      // Printed register columns use the tariff's short name when set.
      ...tariffColumns.map((t) => t.shortName?.trim() || t.name),
    ];
    const body = rows.map((b) => {
      const m = memberOf(b.memberId);
      const principalArr = principalArrFor(b);
      return [
        b.billNo.replace(/^BILL-/, ""),
        unitNo(m),
        m?.name ?? "—",
        billCharges(b),
        principalArr,
        0,
        billCharges(b) + principalArr,
        ...tariffColumns.map((t) => lineAmount(b, t._id)),
      ];
    });
    const foot = [
      "", "", `Total ${totals.count}`,
      totals.billTotal, totals.principalArr, totals.interestArr, totals.totalDue,
      ...tariffColumns.map((t) => totals.perTariff[t._id] ?? 0),
    ];
    const right = new Set<number>();
    for (let i = 3; i < head.length; i++) right.add(i);
    const columnStyles: TableSpec["columnStyles"] = {};
    for (const i of right) columnStyles[i] = { halign: "right" };
    return {
      head,
      groupHead: [
        { label: "", span: 3 },
        { label: "Bill Summary", span: 4 },
        { label: "Bill Details", span: tariffColumns.length },
      ],
      body,
      foot: [foot],
      columnStyles,
    };
  };

  const registerMeta = (): ExportMeta | null => {
    if (!society) return null;
    return {
      societyName: society.name,
      societyAddress: [society.address, society.city, society.state, society.pincode]
        .filter(Boolean)
        .join(", "),
      registrationNo: society.registrationNo,
      title: "Regular Bills Register",
      subtitle: `For the month ${periodLong(periodFilter)}`,
      signatures,
    };
  };

  const doExport = (kind: "pdf" | "word" | "excel" | "print") => {
    const meta = registerMeta();
    if (!meta) return;
    const table = buildRegisterTable();
    if (kind === "pdf") exportPDF(meta, [table], `bills-register-${periodFilter}.pdf`);
    else if (kind === "word") exportWord(meta, [table], `bills-register-${periodFilter}.doc`);
    else if (kind === "excel") exportExcel(meta, [table], `bills-register-${periodFilter}.xlsx`);
    else printTables(meta, [table]);
  };

  const doGenerate = async () => {
    if (!societyId || !members) return;
    const activeMembers = members.filter((m) => m.isActive);
    if (activeMembers.length === 0) {
      toast.error("Add active members first.");
      return;
    }
    setGenerating(true);
    try {
      const res = await generate({
        societyId,
        period,
        issueDate,
        dueDate,
        arrearsDate: arrearsDate || undefined,
        memberIds: activeMembers.map((m) => m._id),
        interestMode,
        interestRate: interestMode === "percent" ? Number(interestRate) || 0 : 0,
        interestFixed: interestMode === "fixed" ? Number(interestFixed) || 0 : 0,
        interestAccountId: (interestAccountId || defaultInterestAccountId || undefined) as
          | Id<"accounts">
          | undefined,
        replace: replaceBills,
      });
      if (interestMode !== "none") setShowInterestCol(true);
      toast.success(
        `Generated ${res.created} bill(s)` +
          (res.skipped > 0 ? ` · ${res.skipped} skipped (already exist or inactive)` : ""),
      );
      setPeriodFilter(period);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate bills");
    } finally {
      setGenerating(false);
    }
  };

  const del = async (b: Bill) => {
    if (!societyId) return;
    if (!confirm(`Delete bill ${b.billNo}?`)) return;
    try {
      await removeBill({ societyId, id: b._id });
      toast.success("Bill deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const bankAccounts = (accounts ?? []).filter(
    (a) => "kind" in a && a.kind === "bank_cash",
  );

  const setCellEdit = (billId: string, tariffId: string, value: string) =>
    setEdits((prev) => ({
      ...prev,
      [billId]: { ...(prev[billId] ?? {}), [tariffId]: value },
    }));
  const clearEdits = () => setEdits({});

  const saveEdits = async () => {
    if (!societyId) return;
    const isArr = (name: string) => name.toLowerCase().startsWith("arrears");
    // Rebuild each edited bill's charge lines: tariff columns first (honoring
    // cell edits, creating lines for previously-exempt heads), then any custom
    // charge lines that don't belong to a tariff column. Arrears lines are
    // preserved server-side.
    const pending: {
      billId: Id<"bills">;
      lines: { tariffId?: Id<"tariffs">; accountId: Id<"accounts">; name: string; amount: number }[];
    }[] = [];
    for (const billIdStr of Object.keys(edits)) {
      const b = (bills ?? []).find((x) => x._id === billIdStr);
      if (!b) continue;
      const cellEdits = edits[billIdStr];
      const chargeLines: { tariffId?: Id<"tariffs">; accountId: Id<"accounts">; name: string; amount: number }[] = [];
      const seen = new Set<string>();
      for (const t of tariffColumns) {
        seen.add(t._id);
        const existing = (b.lines ?? []).find((l) => l.tariffId === t._id && !isArr(l.name));
        const e = cellEdits[t._id];
        if (e !== undefined && e !== "") {
          const amount = Number(e);
          if (Number.isNaN(amount) || amount < 0) {
            toast.error(`Invalid amount for ${t.name} in bill ${b.billNo}.`);
            return;
          }
          chargeLines.push({
            tariffId: t._id,
            accountId: existing?.accountId ?? t.accountId,
            name: existing?.name ?? t.name,
            amount,
          });
        } else if (existing && existing.amount !== 0) {
          chargeLines.push({
            tariffId: existing.tariffId,
            accountId: existing.accountId,
            name: existing.name,
            amount: existing.amount,
          });
        }
      }
      for (const l of b.lines ?? []) {
        if (!isArr(l.name) && (!l.tariffId || !seen.has(l.tariffId))) {
          chargeLines.push({ tariffId: l.tariffId, accountId: l.accountId, name: l.name, amount: l.amount });
        }
      }
      pending.push({ billId: b._id, lines: chargeLines });
    }
    if (pending.length === 0) {
      toast.info("No cell edits to save.");
      return;
    }
    setSaving(true);
    try {
      for (const p of pending) {
        await updateLines({ societyId, id: p.billId, lines: p.lines });
      }
      toast.success(`Saved ${pending.length} bill(s).`);
      clearEdits();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!societyId || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected bill(s)? This cannot be undone.`)) return;
    try {
      let ok = 0;
      for (const id of selected) {
        try {
          await removeBill({ societyId, id: id as Id<"bills"> });
          ok++;
        } catch {
          // Bill with receipts allocated — surface which failed via toast below.
        }
      }
      toast.success(`Deleted ${ok} of ${selected.size} bill(s). Bills with receipts cannot be deleted.`);
      setSelected(new Set());
      clearEdits();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const toggleRow = (billId: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(billId);
      else next.delete(billId);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((b) => selected.has(b._id));
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(rows.map((b) => b._id)) : new Set());

  const openPay = (b: Bill) => {
    setPayBill(b);
    setPayForm({
      date: todayISO(),
      amount: String(+(b.total - b.paidAmount).toFixed(2)),
      mode: "cash",
      bankCashAccountId: "",
      reference: "",
      narration: `Against bill ${b.billNo} (${formatPeriod(b.period)})`,
    });
    setPayOpen(true);
  };

  const submitPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !payBill) return;
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    try {
      await createVoucher({
        societyId,
        type: "member_receipt",
        date: payForm.date,
        memberId: payBill.memberId,
        mode: payForm.mode,
        bankCashAccountId: (payForm.bankCashAccountId || undefined) as
          | Id<"accounts">
          | undefined,
        reference: payForm.reference || undefined,
        narration: payForm.narration || undefined,
        lines: [],
        allocations: [{ billId: payBill._id, amount }],
      });
      toast.success(`Receipt recorded against ${payBill.billNo}`);
      setPayOpen(false);
      setPayBill(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record receipt");
    }
  };

  const doDeleteMonth = async () => {
    if (!societyId) return;
    const label = formatPeriod(periodFilter);
    if (
      !confirm(
        `Delete ALL bills for ${label}? The bills disappear from registers and the member portal; receipts already recorded stay on the members' ledgers as credits (advances). This cannot be undone.`,
      )
    )
      return;
    setDeletingMonth(true);
    try {
      const res = await deleteMonth({ societyId, period: periodFilter });
      if (res.deleted === 0 && res.blocked === 0) {
        toast.info(`No bills exist for ${label}.`);
      } else {
        toast.success(
          `Deleted ${res.deleted} bill(s) for ${label}. Existing receipts remain on the members' ledgers.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete bills");
    } finally {
      setDeletingMonth(false);
    }
  };

  // ---- Email bills (single / selected / whole filtered month) ------------
  const mailTargets = mailScope === "selected" ? rows.filter((b) => selected.has(b._id)) : rows;
  const mailSkips = mailTargets.filter((b) => {
    const email = memberOf(b.memberId)?.email?.trim() ?? "";
    return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  });
  const mailableCount = mailTargets.length - mailSkips.length;

  const sendBillEmails = async () => {
    if (!societyId || !society) return;
    const messages = mailTargets
      .map((b) => {
        const m = memberOf(b.memberId);
        const to = m?.email?.trim() ?? "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return null;
        const data = buildBillData(b);
        if (!data) return null;
        return {
          to,
          subject: `Maintenance Bill ${periodLabelLong(b.period)} — ${society.name}`,
          html: `<p>Dear ${data.memberName},</p><p>Please find attached the maintenance bill for <b>${periodLabelLong(b.period)}</b> (Bill No. ${data.billNo}, Total Due Rs. ${data.totalDue.toFixed(2)}).</p><p>This is a computer-generated mail from the society office.</p>`,
          attachments: [
            {
              filename: `${m ? `${m.code}-` : ""}${b.billNo}.pdf`,
              contentBase64: bytesToBase64(billPdfBytes(data)),
            },
          ],
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    setMailing(true);
    try {
      const res = await sendDocs({ societyId, messages });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(`Emailed ${ok} bill(s); ${failed.length} failed. ${failed[0]?.error ?? ""}`);
      } else {
        toast.success(`Emailed ${ok} bill(s).`);
      }
      setMailOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to email bills");
    } finally {
      setMailing(false);
    }
  };

  // ---- WhatsApp bills (single / selected / whole filtered month) ---------
  const waTargets = waScope === "selected" ? rows.filter((b) => selected.has(b._id)) : rows;
  const waSkips = waTargets.filter((b) => {
    const phone = memberOf(b.memberId)?.phone?.trim() ?? "";
    return phone.replace(/\D/g, "").length < 10;
  });
  const waCount = waTargets.length - waSkips.length;

  const sendBillWhatsapp = async () => {
    if (!societyId || !society) return;
    const messages = waTargets
      .map((b) => {
        const m = memberOf(b.memberId);
        const phone = m?.phone?.trim() ?? "";
        if (phone.replace(/\D/g, "").length < 10) return null;
        const data = buildBillData(b);
        if (!data) return null;
        return {
          phone,
          name: data.memberName,
          docLabel: `Maintenance Bill ${periodLabelLong(b.period)} — Bill No. ${data.billNo}`,
          filename: `${m ? `${m.code}-` : ""}${b.billNo}.pdf`,
          contentBase64: bytesToBase64(billPdfBytes(data)),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    setWaSending(true);
    try {
      const res = await sendWhatsappDocs({ societyId, messages });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(`Sent ${ok} WhatsApp message(s); ${failed.length} failed. ${failed[0]?.error ?? ""}`);
      } else {
        toast.success(`Sent ${ok} WhatsApp message(s).`);
      }
      setWaOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send WhatsApp messages");
    } finally {
      setWaSending(false);
    }
  };

  const receivableMissing =
    society && !society.receivableAccountId &&
    (accounts ?? []).some((a) => a.kind === "receivable");

  const rightAlign = "text-right tabular-nums";

  return (
    <div>
      <PageHeader
        title="Bill Register"
        description="Monthly maintenance bills generated from the tariff schedule, with arrears and per-head amounts."
      />

      {receivableMissing && (
        <Card className="mb-6 border-dashed p-4 text-sm text-muted-foreground">
          Tip: set the <span className="font-medium text-foreground">Members Receivable</span> account in{" "}
          <Link to="/app/society" className="underline">Society Profile</Link> so bills post correctly to the books.
        </Card>
      )}

      {/* View Bills filter bar */}
      <div className="panel mb-8 p-5">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-8">
          <div className="space-y-2">
            <Label htmlFor="vb-period">Billing period</Label>
            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger id="vb-period"><SelectValue /></SelectTrigger>
              <SelectContent>
                {periodOptions.map((p) => (
                  <SelectItem key={p} value={p}>{formatPeriod(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-building">Building</Label>
            <Input id="vb-building" value={building} onChange={(e) => setBuilding(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-wing">Wing</Label>
            <Input id="vb-wing" value={wing} onChange={(e) => setWing(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-utype">Unit type</Label>
            <Input id="vb-utype" value={unitType} onChange={(e) => setUnitType(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-floor">Floor</Label>
            <Input id="vb-floor" value={floor} onChange={(e) => setFloor(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-buildup">Buildup area</Label>
            <Input id="vb-buildup" type="number" value={buildupArea} onChange={(e) => setBuildupArea(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-carpet">Carpet area</Label>
            <Input id="vb-carpet" type="number" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full rounded-lg"
              onClick={() => setApplied({ building, wing, unitType, floor, buildupArea, carpetArea })}
            >
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Generate box */}
      {canEdit ? (
      <div className="panel mb-8 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Generate bills</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="b-period">Period</Label>
            <Input id="b-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-issue">Issue date</Label>
            <Input id="b-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-due">Due date</Label>
            <Input id="b-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-arr">Arrears as-on date</Label>
            <Input
              id="b-arr"
              type="date"
              value={arrearsDate}
              onChange={(e) => setArrearsDate(e.target.value)}
              title="Bills unpaid as on this date are carried forward as arrears"
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Earlier bills unpaid on this date become arrears on the new bills.
            </p>
          </div>
          <div className="flex items-end">
            <Button onClick={doGenerate} disabled={generating || (tariffs ?? []).filter((t) => t.isActive).length === 0} className="w-full rounded-lg">
              {generating ? "Generating…" : replaceBills ? "Regenerate (replaces existing)" : "Generate for all active members"}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2 lg:col-span-5">
            <Checkbox checked={replaceBills} onCheckedChange={(v) => setReplaceBills(v === true)} />
            Replace existing bills for the period (applies new amounts, heads and interest — bills with receipts are kept)
          </label>

          {/* Interest / late fee — charged on the outstanding balance at generation */}
          <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:col-span-2 lg:col-span-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="b-intmode">Interest / late fee</Label>
              <Select value={interestMode} onValueChange={(v) => setInterestMode(v as typeof interestMode)}>
                <SelectTrigger id="b-intmode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="percent">Percent per month</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {interestMode === "percent" && (
              <div className="space-y-2">
                <Label htmlFor="b-intrate">Rate (% per month)</Label>
                <Input id="b-intrate" type="number" step="0.01" min="0" value={interestRate}
                  onChange={(e) => {
                    rateTouched.current = true;
                    setInterestRate(e.target.value);
                  }} />
              </div>
            )}
            {interestMode === "fixed" && (
              <div className="space-y-2">
                <Label htmlFor="b-intfix">Fixed amount (₹)</Label>
                <Input id="b-intfix" type="number" step="0.01" min="0" value={interestFixed}
                  onChange={(e) => setInterestFixed(e.target.value)} />
              </div>
            )}
            {interestMode !== "none" && (
              <div className="space-y-2">
                <Label>Post interest to</Label>
                <Select value={interestAccountId || defaultInterestAccountId || undefined}
                  onValueChange={setInterestAccountId}>
                  <SelectTrigger><SelectValue placeholder="Interest Income" /></SelectTrigger>
                  <SelectContent>
                    {incomeAccounts.map((a) => (
                      <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {interestMode !== "none" && (
              <p className="self-center text-[11px] leading-4 text-muted-foreground sm:col-span-2 lg:col-span-1">
                Charged only on members with unpaid earlier bills. 1.5% p.m. ≈ 18% p.a.
                This rate is saved with the society — it stays the same for future months
                unless changed here or in Society Profile.
              </p>
            )}
          </div>
        </div>
      </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} bill{rows.length === 1 ? "" : "s"} for {formatPeriod(periodFilter)}
          {hasEdits && <span className="ml-2 font-medium text-foreground">· {Object.keys(edits).length} row(s) edited — Save to apply</span>}
        </p>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deletingMonth || rows.length === 0}
              onClick={doDeleteMonth}
            >
              <Trash2 className="size-4" /> {deletingMonth ? "Deleting…" : "Delete month"}
            </Button>
          )}
          {canEdit && hasEdits && (
            <>
              <Button onClick={saveEdits} disabled={saving} size="sm" className="rounded-lg">
                <Save className="size-4" /> {saving ? "Saving…" : `Save ${Object.keys(edits).length} ${Object.keys(edits).length === 1 ? "bill" : "bills"}`}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearEdits} disabled={saving}>
                <X className="size-4" /> Discard
              </Button>
            </>
          )}
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
            onClick={() => doExport("excel")}
            className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("print")}
            className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
          >
            <Printer className="size-4" /> Print
          </Button>
          {canEdit && !hasEdits && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={rows.length === 0}
                onClick={() => setMailOpen(true)}
              >
                <Mail className="size-4" /> Email
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rows.length === 0}
                onClick={() => setWaOpen(true)}
              >
                <MessageCircle className="size-4" /> WhatsApp
              </Button>
            </>
          )}
        </div>
      </div>

      {!bills ? null : rows.length === 0 ? (
        <EmptyHint>
          No bills for {formatPeriod(periodFilter)}. Generate them above, then use Refresh.
        </EmptyHint>
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => toggleAll(v === true)}
                    aria-label="Select all bills"
                  />
                </TableHead>
                <TableHead className="sticky left-0 bg-background">Unit No</TableHead>
                <TableHead>Bill No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Bill Total</TableHead>
                <TableHead className="text-right">Principal Arr.</TableHead>
                <TableHead className="text-right">Interest Arr.</TableHead>
                <TableHead className="text-right">Total Arr.</TableHead>
                {showInterestCol && <TableHead className="text-right">Interest</TableHead>}
                <TableHead className="bg-emerald-500/10 text-right">Total Due</TableHead>
                {tariffColumns.map((t) => (
                  <TableHead key={t._id} className="text-right">
                    <span className="block max-w-24 truncate" title={t.name}>{t.shortName?.trim() || t.name}</span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const m = memberOf(b.memberId);
                const principal = principalArrFor(b);
                return (
                  <TableRow key={b._id}>
                    <TableCell>
                      {canEdit && (
                        <Checkbox
                          checked={selected.has(b._id)}
                          onCheckedChange={(v) => toggleRow(b._id, v === true)}
                          aria-label={`Select bill ${b.billNo}`}
                        />
                      )}
                    </TableCell>
                    <TableCell className="sticky left-0 bg-background font-medium">{unitNo(m)}</TableCell>
                    <TableCell>
                      <Link to={`/app/bills/${b._id}`} className="hover:underline">
                        {b.billNo}
                      </Link>
                      {(b as { billKind?: string }).billKind === "supplementary" && (
                        <Badge variant="outline" className="ml-1 align-middle text-[10px]">
                          SUPP
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-44 truncate" title={m?.name}>{m?.name ?? "—"}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(billCharges(b))}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(principal)}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(0)}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(principal)}</TableCell>
                    {showInterestCol && (
                      <TableCell className={rightAlign}>{formatMoney(billInterest(b))}</TableCell>
                    )}
                    <TableCell className={`bg-emerald-500/10 font-medium ${rightAlign}`}>
                      {formatMoney(rowTotal(b, principal))}
                    </TableCell>                        {tariffColumns.map((t) => {
                          const e = edits[b._id]?.[t._id] ?? "";
                          return (
                            <TableCell key={t._id} className="p-0 text-right">
                              <Input
                                type="number"
                                step="0.01"
                                disabled={!canEdit}
                                className="h-8 w-24 rounded-none border-0 border-l border-dashed bg-transparent px-2 text-right tabular-nums focus-visible:ring-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                value={e === "" ? String(lineAmount(b, t._id)) : e}
                                onChange={(ev) => setCellEdit(b._id, t._id, ev.target.value)}
                              />
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && b.status !== "paid" && (
                          <Button variant="ghost" size="icon" className="size-8" title="Record payment" onClick={() => openPay(b)}>
                            <HandCoins className="size-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="size-8" title="Export bill as PDF" onClick={() => exportSingle(b, "pdf")}>
                          <Download className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" title="Export bill as Word" onClick={() => exportSingle(b, "word")}>
                          <FileText className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Print receipt for this bill"
                          onClick={() => exportBillReceipt(b, "print")}
                        >
                          <ReceiptIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Open member ledger"
                          onClick={() => navigate(`/app/member-ledger?member=${b.memberId}`)}
                        >
                          <BookText className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(b)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <tfoot>
              <tr className="border-t-2 border-foreground/60 font-semibold">
                <td />
                <td className="sticky left-0 bg-background px-2 py-3 text-right">Total {totals.count}</td>
                <td colSpan={2} />
                <td className={rightAlign}>{formatMoney(totals.billTotal)}</td>
                <td className={rightAlign}>{formatMoney(totals.principalArr)}</td>
                <td className={rightAlign}>{formatMoney(totals.interestArr)}</td>
                <td className={rightAlign}>{formatMoney(totals.totalArr)}</td>
                <td className={`bg-emerald-500/10 ${rightAlign}`}>{formatMoney(totals.totalDue)}</td>
                {tariffColumns.map((t) => (
                  <td key={t._id} className={rightAlign}>{formatMoney(totals.perTariff[t._id] ?? 0)}</td>
                ))}
                <td />
              </tr>
            </tfoot>
          </Table>
        </div>
      )}

      {/* Per-bill status legend for the period grid */}
      {rows.some((b) => b.status !== "unpaid") && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Status:</span>
          {(["unpaid", "partial", "paid"] as const).map((s) => {
            const n = rows.filter((b) => b.status === s).length;
            if (n === 0) return null;
            return (
              <Badge
                key={s}
                variant={s === "paid" ? "secondary" : s === "partial" ? "outline" : "destructive"}
                className={s === "unpaid" ? "bg-transparent text-muted-foreground border" : undefined}
              >
                {s} {n}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Save / Delete / Exit bar (legacy View Bills layout) */}
      {(hasEdits || selected.size > 0) && (
        <div className="panel mt-6 flex flex-wrap items-center justify-end gap-2 p-4">
          {hasEdits && (
            <>
              <Button onClick={saveEdits} disabled={saving} className="rounded-lg">
                <Save className="size-4" /> {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="ghost" onClick={clearEdits} disabled={saving}>
                <X className="size-4" /> Discard edits
              </Button>
            </>
          )}
          {selected.size > 0 && (
            <Button variant="destructive" onClick={deleteSelected} disabled={saving} className="rounded-lg">
              <Trash2 className="size-4" /> Delete selected ({selected.size})
            </Button>
          )}
          <Button variant="outline" onClick={() => { clearEdits(); setSelected(new Set()); }}>
            Exit
          </Button>
        </div>
      )}

      {/* WhatsApp bills dialog: selected or whole filtered month */}
      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>WhatsApp bills — {formatPeriod(periodFilter)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Send to</Label>
              <Select
                value={waScope}
                onValueChange={(v) => setWaScope(v as "selected" | "filtered")}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="selected">
                    Selected bills ({rows.filter((b) => selected.has(b._id)).length})
                  </SelectItem>
                  <SelectItem value="filtered">All filtered bills ({rows.length})</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-4 text-muted-foreground">
                One WhatsApp message per member with their bill PDF — ticked
                rows or the whole filtered month in one go.
              </p>
            </div>
            <div className="rounded-md border bg-accent/30 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bills to send</span>
                <span className="tabular-nums">{waCount}</span>
              </div>
              {waSkips.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No phone on member profile</span>
                  <span className="tabular-nums">{waSkips.length}</span>
                </div>
              )}
            </div>
            {waCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                None of these members have a phone number — add phones in the
                member profiles first.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sent through your society's WhatsApp Business number. Members
                without a phone number are skipped.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWaOpen(false)} disabled={waSending}>
              Cancel
            </Button>
            <Button type="button" onClick={sendBillWhatsapp} disabled={waSending || waCount === 0}>
              {waSending ? "Sending…" : `Send to ${waCount} member${waCount === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email bills dialog: selected or whole filtered month */}
      <Dialog open={mailOpen} onOpenChange={setMailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email bills — {formatPeriod(periodFilter)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Send to</Label>
              <Select
                value={mailScope}
                onValueChange={(v) => setMailScope(v as "selected" | "filtered")}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="selected">
                    Selected bills ({rows.filter((b) => selected.has(b._id)).length})
                  </SelectItem>
                  <SelectItem value="filtered">All filtered bills ({rows.length})</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-4 text-muted-foreground">
                One email per member with their bill attached — a single bill,
                a ticked selection, or the whole filtered month in one go.
              </p>
            </div>
            <div className="rounded-md border bg-accent/30 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bills to email</span>
                <span className="tabular-nums">{mailableCount}</span>
              </div>
              {mailSkips.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No email on member profile</span>
                  <span className="tabular-nums">{mailSkips.length}</span>
                </div>
              )}
            </div>
            {mailableCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                None of these members have an email address — add emails in the
                member profiles first.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Each PDF uses the same legacy bill format as the download
                buttons. Members without an email are skipped.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMailOpen(false)} disabled={mailing}>
              Cancel
            </Button>
            <Button type="button" onClick={sendBillEmails} disabled={mailing || mailableCount === 0}>
              {mailing ? "Sending…" : `Email ${mailableCount} bill${mailableCount === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick payment dialog for a single bill */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Record payment — {payBill?.billNo}
              {payBill ? ` · ${memberOf(payBill.memberId)?.name ?? ""}` : ""}
            </DialogTitle>
          </DialogHeader>
          {payBill && (
            <form onSubmit={submitPay} className="space-y-4">
              <div className="rounded-md border bg-accent/30 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bill total</span>
                  <span className="tabular-nums">{formatMoney(payBill.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already paid</span>
                  <span className="tabular-nums">{formatMoney(payBill.paidAmount)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Balance due</span>
                  <span className="tabular-nums">{formatMoney(payBill.total - payBill.paidAmount)}</span>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="p-date">Date *</Label>
                  <Input id="p-date" type="date" required value={payForm.date}
                    onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-amount">Amount (₹) *</Label>
                  <Input id="p-amount" type="number" step="0.01" min="0.01" required value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select value={payForm.mode} onValueChange={(v) => setPayForm({ ...payForm, mode: v, bankCashAccountId: "" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank">Bank transfer</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Bank / Cash account</Label>
                  <Select value={payForm.bankCashAccountId || undefined}
                    onValueChange={(v) => setPayForm({ ...payForm, bankCashAccountId: v })}>
                    <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((a) => (
                        <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-ref">Reference</Label>
                  <Input id="p-ref" value={payForm.reference}
                    onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                    placeholder="UTR / cheque no." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-narr">Narration</Label>
                  <Input id="p-narr" value={payForm.narration}
                    onChange={(e) => setPayForm({ ...payForm, narration: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The receipt debits bank/cash and credits the member's receivable, settling this bill.
                Any amount above the balance is kept as an advance on their ledger.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
                <Button type="submit">Save receipt</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
