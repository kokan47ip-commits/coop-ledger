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
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { billPdf, billWord, receiptPdf, receiptPrint, receiptWord, periodLabelLong, type LegacyBillData, type LegacyReceiptData } from "@/lib/billDoc";
import { useCommitteeSignatures } from "@/lib/committee";
import { currentPeriod, effectiveFyPeriod, formatMoney, formatPeriod, todayISO } from "@/lib/format";
import { BookText, Download, FileText, HandCoins, Plus, Printer, Receipt as ReceiptIcon, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
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

  /** Row-level total due: edited/current tariff lines + arrears before this period. */
  const rowTotal = (b: Bill, principal: number) => {
    let sum = principal;
    for (const t of tariffColumns) {
      const edited = edits[b._id]?.[t._id];
      sum += edited !== undefined && edited !== "" ? Number(edited) : lineAmount(b, t._id);
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
      const principal = arrearsBefore(b.memberId, periodFilter);
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
  const exportSingle = (b: Bill, kind: "pdf" | "word") => {
    if (!society) return;
    const m = memberOf(b.memberId);
    const isArrearsLine = (name: string) => name.toLowerCase().startsWith("arrears");
    const arrearsFromBills = (bills ?? [])
      .filter((x) => x.memberId === b.memberId && x.period < b.period)
      .reduce((s, x) => s + (x.total - x.paidAmount), 0);
    const arrearsOnBill = (b.lines ?? [])
      .filter((l) => isArrearsLine(l.name))
      .reduce((s, l) => s + l.amount, 0);
    const arrears = arrearsFromBills + arrearsOnBill;
    const currentCharges = (b.lines ?? [])
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
      billNo: b.billNo.replace(/^BILL-/, ""),
      billDate: b.issueDate,
      dueDate: b.dueDate,
      periodLabel: periodLabelLong(b.period),
      memberName: m?.name ?? "Member",
      flatNo: [m?.wing, m?.flatNo].filter(Boolean).join("-") || undefined,
      lines: (b.lines ?? [])
        .filter((l) => !isArrearsLine(l.name))
        .map((l) => ({ name: l.name, amount: l.amount })),
      total: currentCharges,
      arrears,
      totalDue: currentCharges + arrears,
      paidAmount: b.paidAmount,
    };
    const name = m ? `${m.code}-${b.billNo}` : b.billNo;
    if (kind === "pdf") billPdf(data, `${name}.pdf`);
    else billWord(data, `${name}.doc`);
  };

  // ---- Crystal-style "Regular Bills Register" export for the selected period ----
  const buildRegisterTable = (): TableSpec => {
    const head = [
      "Bill No", "Unit No.", "Unit Name",
      "Bill", "Principal", "Interest", "Total Due",
      ...tariffColumns.map((t) => t.name),
    ];
    const body = rows.map((b) => {
      const m = memberOf(b.memberId);
      const principal = arrearsBefore(b.memberId, periodFilter);
      return [
        b.billNo.replace(/^BILL-/, ""),
        unitNo(m),
        m?.name ?? "—",
        b.total,
        principal,
        0,
        b.total + principal,
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

  const doExport = (kind: "pdf" | "word" | "print") => {
    const meta = registerMeta();
    if (!meta) return;
    const table = buildRegisterTable();
    if (kind === "pdf") exportPDF(meta, [table], `bills-register-${periodFilter}.pdf`);
    else if (kind === "word") exportWord(meta, [table], `bills-register-${periodFilter}.doc`);
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
      });
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
      <div className="mb-8 rounded-lg border p-5">
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
      <div className="mb-8 rounded-lg border p-5">
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
              {generating ? "Generating…" : "Generate for all active members"}
            </Button>
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

      {!bills ? null : rows.length === 0 ? (
        <EmptyHint>
          No bills for {formatPeriod(periodFilter)}. Generate them above, then use Refresh.
        </EmptyHint>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
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
                <TableHead className="bg-emerald-500/10 text-right">Total Due</TableHead>
                {tariffColumns.map((t) => (
                  <TableHead key={t._id} className="text-right">
                    <span className="block max-w-24 truncate" title={t.name}>{t.name}</span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const m = memberOf(b.memberId);
                const principal = arrearsBefore(b.memberId, periodFilter);
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
                    </TableCell>
                    <TableCell className="max-w-44 truncate" title={m?.name}>{m?.name ?? "—"}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(b.total)}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(principal)}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(0)}</TableCell>
                    <TableCell className={rightAlign}>{formatMoney(principal)}</TableCell>
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
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2 rounded-lg border p-4">
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
