import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { exportPDF, exportWord, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatINR, fyStartISO, todayISO } from "@/lib/format";
import { BookText, Copy, Download, FileText, HandCoins, History, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type MemberRow = {
  _id: Id<"members">;
  code: string;
  name: string;
  flatNo?: string;
  wing?: string;
  building?: string;
  unitType?: string;
  floor?: string;
  buildupArea?: number;
  carpetArea?: number;
  phone?: string;
  email?: string;
  ownershipType?: "owner" | "tenant";
  joinDate?: string;
  openingBalance: number;
  openingDate?: string;
  isActive: boolean;
};

type Bill = Doc<"bills">;

type LedgerRow = {
  date: string;
  voucherNo: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
  note?: string;
};

const emptyForm = {
  id: "" as Id<"members"> | "",
  code: "",
  name: "",
  flatNo: "",
  wing: "",
  building: "",
  unitType: "",
  floor: "",
  buildupArea: "",
  carpetArea: "",
  phone: "",
  email: "",
  ownershipType: "owner",
  joinDate: "",
  openingBalance: "0",
  openingDate: fyStartISO(),
  isActive: true,
};

type AuditRow = {
  _id: Id<"ownershipAudit">;
  action: string;
  memberId: Id<"members"> | null;
  email: string | null;
  details: string;
  byName: string;
  at: number;
};

type OwnerRow = {
  _id: Id<"memberOwners">;
  memberId: Id<"members">;
  name: string;
  relation?: string;
  sharePercent?: number;
  phone?: string;
  email?: string;
  addedByName: string;
  createdAt: number;
};

const emptyOwnerForm = {
  name: "",
  relation: "",
  sharePercent: "",
  phone: "",
  email: "",
};

export default function Members() {
  const { societyId, society, canEdit } = useSociety();
  const members = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  const owners = useQuery(
    api.ownership.flatJointOwners,
    societyId ? { societyId } : "skip",
  ) as OwnerRow[] | undefined;
  // Ownership / account-linking change history (append-only audit trail).
  const audit = useQuery(
    api.ownership.auditTrail,
    societyId ? { societyId } : "skip",
  ) as AuditRow[] | undefined;
  const addOwner = useMutation(api.ownership.addJointOwner);
  const removeOwner = useMutation(api.ownership.removeJointOwner);
  const [ownerForm, setOwnerForm] = useState(emptyOwnerForm);

  const ownersOf = (memberId: Id<"members">) =>
    (owners ?? []).filter((o) => o.memberId === memberId);
  const bills = useQuery(
    api.bills.list,
    societyId ? { societyId } : "skip",
  ) as Bill[] | undefined;
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"accounts">[] | undefined;
  const upsert = useMutation(api.members.upsert);
  const remove = useMutation(api.members.remove);
  const createVoucher = useMutation(api.vouchers.create);
  const signatures = useCommitteeSignatures();
  const navigate = useNavigate();

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");

  // Quick-pay dialog state (receipt settled across the member's bills, oldest first).
  const [payOpen, setPayOpen] = useState(false);
  const [payMember, setPayMember] = useState<MemberRow | null>(null);
  const [payForm, setPayForm] = useState({
    date: todayISO(),
    amount: "",
    mode: "cash",
    bankCashAccountId: "",
    reference: "",
    narration: "",
  });

  // Deferred ledger export: set a target, wait for the ledger query, export.
  const [exportTarget, setExportTarget] = useState<{
    m: MemberRow;
    kind: "pdf" | "word";
  } | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fy = effectiveFyPeriod(society);
  const ledger = useQuery(
    api.api.memberLedger,
    societyId && exportTarget
      ? {
          societyId,
          memberId: exportTarget.m._id,
          fromDate: fy.from,
          toDate: fy.to,
        }
      : "skip",
  ) as { member: MemberRow | null; rows: LedgerRow[] } | undefined;

  // When the ledger data arrives for a requested export, build and download it.
  useEffect(() => {
    if (!exportTarget || !ledger || !society) return;
    const { m, kind } = exportTarget;
    const meta: ExportMeta = {
      societyName: society.name,
      societyAddress: [society.address, society.city, society.state, society.pincode]
        .filter(Boolean)
        .join(", "),
      registrationNo: society.registrationNo,
      title: `Member Ledger — ${m.name} (${m.code})`,
      subtitle: `Period ${formatDate(fy.from)} to ${formatDate(fy.to)}`,
      signatures,
    };
    const closing =
      ledger.rows.length > 0 ? ledger.rows[ledger.rows.length - 1].balance : m.openingBalance;
    const base: (string | number)[][] = [];
    if (m.openingBalance !== 0) {
      base.push(["", "", "Opening Balance", m.openingBalance > 0 ? m.openingBalance : 0, m.openingBalance < 0 ? -m.openingBalance : 0, m.openingBalance]);
    }
    const rows = ledger.rows
      .filter((r) => r.voucherNo !== "OPENING")
      .map((r) => [
        formatDate(r.date),
        r.voucherNo,
        r.particulars + (r.note ? ` (${r.note})` : ""),
        r.debit,
        r.credit,
        r.balance,
      ]);
    // TOTAL covers all money columns (Dr incl. opening, Cr incl. opening),
    // same as the Member Ledger statement.
    const totDr =
      (m.openingBalance > 0 ? m.openingBalance : 0) +
      rows.reduce((s, r) => s + Number(r[3] ?? 0), 0);
    const totCr =
      (m.openingBalance < 0 ? -m.openingBalance : 0) +
      rows.reduce((s, r) => s + Number(r[4] ?? 0), 0);
    const table: TableSpec = {
      head: ["Date", "Voucher", "Particulars", "Debit", "Credit", "Balance"],
      body: [...base, ...rows],
      foot: [
        ["", "", "CLOSING", "", "", closing],
        ["", "", "TOTAL", totDr, totCr, ""],
      ],
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    };
    if (kind === "pdf") exportPDF(meta, [table], `member-ledger-${m.code}.pdf`);
    else exportWord(meta, [table], `member-ledger-${m.code}.doc`);
    // Reset outside the synchronous effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => setExportTarget(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportTarget, ledger]);

  const outstandingOf = (memberId: Id<"members">) =>
    (bills ?? [])
      .filter((b) => b.memberId === memberId && b.total > b.paidAmount)
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate));

  const openPay = (m: MemberRow) => {
    setPayMember(m);
    const due = outstandingOf(m._id).reduce((s, b) => s + (b.total - b.paidAmount), 0);
    setPayForm({
      date: todayISO(),
      amount: due > 0 ? String(+due.toFixed(2)) : "",
      mode: "cash",
      bankCashAccountId: "",
      reference: "",
      narration: "Maintenance collection",
    });
    setPayOpen(true);
  };

  const submitPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !payMember) return;
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    try {
      // Settle outstanding bills oldest-first; any excess stays as advance.
      let remaining = amount;
      const allocations: { billId: Id<"bills">; amount: number }[] = [];
      for (const b of outstandingOf(payMember._id)) {
        if (remaining <= 0) break;
        const take = Math.min(b.total - b.paidAmount, remaining);
        allocations.push({ billId: b._id, amount: take });
        remaining -= take;
      }
      await createVoucher({
        societyId,
        type: "member_receipt",
        date: payForm.date,
        memberId: payMember._id,
        mode: payForm.mode,
        bankCashAccountId: (payForm.bankCashAccountId || undefined) as Id<"accounts"> | undefined,
        reference: payForm.reference || undefined,
        narration: payForm.narration || undefined,
        lines: [],
        allocations,
      });
      toast.success(
        `Receipt recorded for ${payMember.name}` +
          (remaining > 0 ? ` · ${formatINR(remaining)} kept as advance` : ""),
      );
      setPayOpen(false);
      setPayMember(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record receipt");
    }
  };

  const filtered = useMemo(() => {
    const list = members ?? [];
    const q = query.trim().toLowerCase();
    const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
    if (!q) return sorted;
    return sorted.filter((m) =>
      [m.code, m.name, m.flatNo ?? "", m.wing ?? "", m.phone ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [members, query]);

  const openNew = () => {
    setForm({ ...emptyForm, openingDate: fyStartISO() });
    setOwnerForm(emptyOwnerForm);
    setOpen(true);
  };

  /** Save a joint owner onto the flat being edited. */
  const saveOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !form.id) return;
    const share = ownerForm.sharePercent ? Number(ownerForm.sharePercent) : undefined;
    try {
      await addOwner({
        societyId,
        memberId: form.id as Id<"members">,
        name: ownerForm.name.trim(),
        relation: ownerForm.relation || undefined,
        sharePercent: Number.isFinite(share!) ? share : undefined,
        phone: ownerForm.phone || undefined,
        email: ownerForm.email || undefined,
      });
      setOwnerForm(emptyOwnerForm);
      toast.success("Joint owner added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add joint owner");
    }
  };

  const deleteOwner = async (o: OwnerRow) => {
    if (!societyId) return;
    try {
      await removeOwner({ societyId, id: o._id });
      toast.success(`${o.name} removed from joint owners`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const openEdit = (m: MemberRow) => {
    setOwnerForm(emptyOwnerForm);
    setForm({
      id: m._id,
      code: m.code,
      name: m.name,
      flatNo: m.flatNo ?? "",
      wing: m.wing ?? "",
      building: m.building ?? "",
      unitType: m.unitType ?? "",
      floor: m.floor ?? "",
      buildupArea: m.buildupArea != null ? String(m.buildupArea) : "",
      carpetArea: m.carpetArea != null ? String(m.carpetArea) : "",
      phone: m.phone ?? "",
      email: m.email ?? "",
      ownershipType: m.ownershipType ?? "owner",
      joinDate: m.joinDate ?? "",
      openingBalance: String(m.openingBalance),
      openingDate: m.openingDate ?? fyStartISO(),
      isActive: m.isActive,
    });
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    try {
      await upsert({
        societyId,
        id: form.id || undefined,
        code: form.code.trim(),
        name: form.name.trim(),
        flatNo: form.flatNo || undefined,
        wing: form.wing || undefined,
        building: form.building || undefined,
        unitType: form.unitType || undefined,
        floor: form.floor || undefined,
        buildupArea: form.buildupArea ? Number(form.buildupArea) : undefined,
        carpetArea: form.carpetArea ? Number(form.carpetArea) : undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        ownershipType: form.ownershipType as "owner" | "tenant",
        joinDate: form.joinDate || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        openingDate: form.openingDate || undefined,
        isActive: form.isActive,
      });
      toast.success(form.id ? "Member updated" : "Member added");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save member");
    }
  };

  const del = async (m: MemberRow) => {
    if (!societyId) return;
    if (!confirm(`Delete member ${m.code} — ${m.name}?`)) return;
    try {
      await remove({ societyId, id: m._id });
      toast.success("Member deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // ---- System-generated member portal login password (office-managed) ----
  const [pwMember, setPwMember] = useState<MemberRow | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const pwStatus = useQuery(
    api.memberPortal.adminMemberPasswordStatus,
    societyId && pwMember ? { societyId, memberId: pwMember._id } : "skip",
  ) as { hasPassword: boolean; hasEmail: boolean } | undefined;
  const setMemberPassword = useMutation(api.memberPortal.adminSetMemberPassword);

  /** Random, legible password: 10 chars with upper, lower and 2+ digits. */
  const generatePw = () => {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
    const lower = "abcdefghijkmnpqrstuvwxyz"; // no l/o
    const digits = "23456789"; // no 0/1
    const all = upper + lower + digits;
    const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
    let out = pick(upper) + pick(lower) + pick(lower) + pick(digits) + pick(digits);
    for (let i = 0; i < 5; i++) out += pick(all);
    setPwValue(out);
  };

  const openPassword = (m: MemberRow) => {
    setPwMember(m);
    generatePw();
  };

  const savePassword = async () => {
    if (!societyId || !pwMember) return;
    setPwSaving(true);
    try {
      const res = await setMemberPassword({
        societyId,
        memberId: pwMember._id,
        password: pwValue,
      });
      toast.success(
        `Password saved for ${res.email} — share it with ${pwMember.name}; it is not shown again.`,
      );
      setPwMember(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Members"
        description="Member register with opening receivable balances. Opening balances flow into member ledgers and the balance sheet."
        actions={
          canEdit ? (
            <Button onClick={openNew} className="rounded-lg">
              <Plus className="size-4" /> Add member
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code, name, flat…"
          className="pl-9"
        />
      </div>

      {!members ? null : filtered.length === 0 ? (
        <EmptyHint>
          No members yet. Add members manually or use Excel upload.
        </EmptyHint>
      ) : (
        <div className="panel">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Owners</TableHead>
                <TableHead>Flat</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Pay / PDF / Word / Ledger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m._id}>
                  <TableCell className="font-medium">{m.code}</TableCell>
                  <TableCell>
                    <div className="leading-snug">
                      <span className="font-medium">{m.name}</span>
                      {ownersOf(m._id).length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          + joint: {ownersOf(m._id).map((o) => o.name).join(", ")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {[m.wing, m.flatNo].filter(Boolean).join("-") || "—"}
                  </TableCell>
                  <TableCell className="capitalize">{m.ownershipType ?? "—"}</TableCell>
                  <TableCell>{m.phone ?? "—"}</TableCell>
                  <TableCell className="text-right"><RightMoney value={m.openingBalance} /></TableCell>
                  <TableCell>
                    <Badge variant={m.isActive ? "secondary" : "outline"}>
                      {m.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Record payment"
                        onClick={() => openPay(m)}
                      >
                        <HandCoins className="size-3.5" />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="System-generated portal password"
                          onClick={() => openPassword(m)}
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Export ledger PDF"
                        onClick={() => setExportTarget({ m, kind: "pdf" })}
                      >
                        <FileText className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Export ledger Word"
                        onClick={() => setExportTarget({ m, kind: "word" })}
                      >
                        <Download className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Open member ledger"
                        onClick={() => navigate(`/app/member-ledger?member=${m._id}`)}
                      >
                        <BookText className="size-3.5" />
                      </Button>
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(m)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(m)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <tfoot>
              <TableRow className="border-t-2 bg-muted/40 hover:bg-transparent">
                <TableCell colSpan={5} className="font-semibold">
                  Total — {filtered.length} member{filtered.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatINR(filtered.reduce((s, m) => s + m.openingBalance, 0))}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </tfoot>
          </Table>
        </div>
      )}

      {/* Ownership & account-linking change history (audit trail). */}
      {audit && audit.length > 0 && (
        <div className="panel mt-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-primary" /> Ownership &amp; login change history
          </p>
          <ul className="divide-y">
            {audit.slice(0, 10).map((a) => (
              <li key={a._id} className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {new Date(a.at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1">{a.details}</span>
                <span className="text-xs text-muted-foreground">— {a.byName}</span>
              </li>
            ))}
          </ul>
          {audit.length > 10 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing the latest 10 of {audit.length} recorded changes.
            </p>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit member" : "Add member"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-code">Member code *</Label>
                <Input id="m-code" required value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="M001" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-name">Name *</Label>
                <Input id="m-name" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-wing">Wing / Building (optional)</Label>
                <Input id="m-wing" value={form.wing}
                  onChange={(e) => setForm({ ...form, wing: e.target.value })}
                  placeholder="Blank for single-building societies" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-flat">Flat / Unit no.</Label>
                <Input id="m-flat" value={form.flatNo}
                  onChange={(e) => setForm({ ...form, flatNo: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-building">Building</Label>
                <Input id="m-building" value={form.building}
                  onChange={(e) => setForm({ ...form, building: e.target.value })}
                  placeholder="e.g. Main Building" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-utype">Unit type</Label>
                <Input id="m-utype" value={form.unitType}
                  onChange={(e) => setForm({ ...form, unitType: e.target.value })}
                  placeholder="e.g. Shop / 1BHK / 2BHK" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-floor">Floor</Label>
                <Input id="m-floor" value={form.floor}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
                  placeholder="e.g. Ground / 1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-buildup">Built-up area (sq ft)</Label>
                <Input id="m-buildup" type="number" step="0.01" value={form.buildupArea}
                  onChange={(e) => setForm({ ...form, buildupArea: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-carpet">Carpet area (sq ft)</Label>
                <Input id="m-carpet" type="number" step="0.01" value={form.carpetArea}
                  onChange={(e) => setForm({ ...form, carpetArea: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-phone">Phone</Label>
                <Input id="m-phone" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-email">Email</Label>
                <Input id="m-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {form.id && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => {
                      const m = (members ?? []).find((x) => x._id === form.id);
                      if (m) openPassword(m);
                    }}
                  >
                    <KeyRound className="size-3.5" /> Set system-generated portal password…
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <Label>Ownership</Label>
                <Select value={form.ownershipType}
                  onValueChange={(v) => setForm({ ...form, ownershipType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="tenant">Tenant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-join">Join date</Label>
                <Input id="m-join" type="date" value={form.joinDate}
                  onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-open">Opening balance (₹)</Label>
                <Input id="m-open" type="number" step="0.01" value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-open-date">Opening as on</Label>
                <Input id="m-open-date" type="date" value={form.openingDate}
                  onChange={(e) => setForm({ ...form, openingDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.isActive ? "active" : "inactive"}
                  onValueChange={(v) => setForm({ ...form, isActive: v === "active" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Joint owners: co-owners recorded on this flat (editing only).
                The flat keeps ONE member row — bills, ledger and dues stay
                there; joint owners are people, never duplicate records. */}
            {form.id && (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-sm">Joint owners (co-owners)</Label>
                  <span className="text-xs text-muted-foreground">
                    up to 4 · {ownersOf(form.id as Id<"members">).length} recorded
                  </span>
                </div>
                {ownersOf(form.id as Id<"members">).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No joint owners recorded — add co-owners of this flat below.
                    They appear in the register, member ledgers and the member portal.
                  </p>
                ) : (
                  <ul className="mb-3 divide-y">
                    {ownersOf(form.id as Id<"members">).map((o) => (
                      <li key={o._id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="font-medium">{o.name}</span>
                        {o.relation && <span className="text-muted-foreground">({o.relation})</span>}
                        {o.sharePercent != null && (
                          <Badge variant="outline" className="text-[10px]">{o.sharePercent}%</Badge>
                        )}
                        {o.phone && <span className="text-xs text-muted-foreground">{o.phone}</span>}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                            title="Remove joint owner"
                            onClick={() => deleteOwner(o)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <form onSubmit={saveOwner} className="grid gap-2 sm:grid-cols-6">
                    <Input
                      className="sm:col-span-2"
                      placeholder="Name *"
                      required
                      value={ownerForm.name}
                      onChange={(e) => setOwnerForm({ ...ownerForm, name: e.target.value })}
                    />
                    <Input
                      placeholder="Relation"
                      value={ownerForm.relation}
                      onChange={(e) => setOwnerForm({ ...ownerForm, relation: e.target.value })}
                    />
                    <Input
                      type="number" min="0" max="100" step="0.01"
                      placeholder="Share %"
                      value={ownerForm.sharePercent}
                      onChange={(e) => setOwnerForm({ ...ownerForm, sharePercent: e.target.value })}
                    />
                    <Input
                      placeholder="Phone"
                      value={ownerForm.phone}
                      onChange={(e) => setOwnerForm({ ...ownerForm, phone: e.target.value })}
                    />
                    <Button type="submit" size="sm" className="sm:col-span-6 sm:w-32">
                      <Plus className="size-3.5" /> Add joint owner
                    </Button>
                  </form>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">{form.id ? "Save changes" : "Add member"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Portal password: admin generates/sets a member's portal login password. */}
      <Dialog open={!!pwMember} onOpenChange={(o) => !o && setPwMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Portal login — {pwMember?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Login email: <span className="font-mono text-foreground">{pwMember?.email}</span>
              {!pwMember?.email && (
                <span className="text-destructive">no email on this member — save one first</span>
              )}
              {pwStatus?.hasPassword && " · a password is already set (saving replaces it)"}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-value">Password</Label>
              <div className="flex gap-2">
                <Input id="pw-value" className="font-mono" value={pwValue}
                  onChange={(e) => setPwValue(e.target.value)} />
                <Button type="button" variant="outline" size="icon" title="Generate password"
                  onClick={generatePw}>
                  <RefreshCw className="size-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" title="Copy password"
                  onClick={() => {
                    navigator.clipboard.writeText(pwValue);
                    toast.success("Password copied");
                  }}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Minimum 8 characters with at least one number. The password is never shown again —
                copy it and share it with the member now.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwMember(null)}>Cancel</Button>
              <Button onClick={savePassword} disabled={pwSaving || !pwValue || !pwMember?.email}>
                {pwSaving ? "Saving…" : "Save password"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick payment: posts a member receipt, settles outstanding bills oldest-first. */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Record payment — {payMember?.name} ({payMember?.code})
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submitPay} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-date">Receipt date *</Label>
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
                <Select value={payForm.mode}
                  onValueChange={(v) => setPayForm({ ...payForm, mode: v })}>
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
                <Label htmlFor="p-bank">Bank / cash account</Label>
                <Select value={payForm.bankCashAccountId}
                  onValueChange={(v) => setPayForm({ ...payForm, bankCashAccountId: v })}>
                  <SelectTrigger><SelectValue placeholder="Default account" /></SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((a) => (
                      <SelectItem key={a._id} value={a._id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-ref">Reference</Label>
                <Input id="p-ref" value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                  placeholder="Cheque / UTR no." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-narr">Narration</Label>
                <Input id="p-narr" value={payForm.narration}
                  onChange={(e) => setPayForm({ ...payForm, narration: e.target.value })} />
              </div>
            </div>
            {payMember && (
              <p className="text-xs text-muted-foreground">
                Outstanding bills: {outstandingOf(payMember._id).length}
                {" · "}
                Due {formatINR(outstandingOf(payMember._id).reduce((s, b) => s + (b.total - b.paidAmount), 0))} — the payment settles them oldest-first, and any excess is kept as an advance.
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button type="submit">Record receipt</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
