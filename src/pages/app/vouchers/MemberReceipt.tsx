import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { receiptPdf, receiptPrint, receiptWord, periodLabelLong, type LegacyReceiptData } from "@/lib/billDoc";
import { formatDate, formatPeriod, formatMoney, todayISO } from "@/lib/format";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { VoucherList } from "./VoucherList";

type Member = Doc<"members">;
type Bill = Doc<"bills">;
type Account = Doc<"accounts">;
type Voucher = Doc<"vouchers">;

export default function MemberReceipt() {
  const societyCtx = useSociety();
  const { societyId } = societyCtx;
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;
  const editing = useQuery(
    api.vouchers.getMany,
    societyId && editId ? { societyId, ids: [editId as Id<"vouchers">] } : "skip",
  ) as Voucher[] | undefined;
  const editVoucherDoc = editing?.[0];
  const createVoucher = useMutation(api.vouchers.create);
  const updateVoucher = useMutation(api.vouchers.update);
  const removeVoucher = useMutation(api.vouchers.remove);

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const [form, setForm] = useState({
    memberId: "",
    date: todayISO(),
    amount: "",
    mode: "cash",
    bankCashAccountId: "",
    reference: "",
    narration: "",
  });

  const outstandingBills = useMemo(() => {
    if (!form.memberId || !bills) return [];
    return bills
      .filter((b) => b.memberId === form.memberId && b.total > b.paidAmount)
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  }, [bills, form.memberId]);

  const previewAllocation = useMemo(() => {
    let remaining = Number(form.amount) || 0;
    const rows: { bill: Bill; take: number }[] = [];
    for (const b of outstandingBills) {
      if (remaining <= 0) break;
      const need = b.total - b.paidAmount;
      const take = Math.min(need, remaining);
      rows.push({ bill: b, take });
      remaining -= take;
    }
    return { rows, unallocated: remaining };
  }, [outstandingBills, form.amount]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !form.memberId) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    try {
      await createVoucher({
        societyId,
        type: "member_receipt",
        date: form.date,
        memberId: form.memberId as Id<"members">,
        mode: form.mode,
        bankCashAccountId: (form.bankCashAccountId || bankAccounts[0]?._id) as never,
        reference: form.reference || undefined,
        narration: form.narration || undefined,
        lines: [],
        allocations: previewAllocation.rows.map((r) => ({ billId: r.bill._id, amount: r.take })),
      });
      toast.success(
        `Receipt saved${previewAllocation.unallocated > 0 ? ` · ${formatUnallocated(previewAllocation.unallocated)} kept as advance` : ""}`,
      );
      setForm({ ...form, memberId: "", amount: "", reference: "", narration: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save receipt");
    }
  };

  /** Update an existing member receipt — header fields only (total and bill
   * allocations stay fixed; delete & re-enter to change the amount). */
  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !editId || !editVoucherDoc) return;
    try {
      await updateVoucher({
        societyId,
        id: editId as Id<"vouchers">,
        date: form.date,
        mode: form.mode,
        bankCashAccountId: (form.bankCashAccountId || editVoucherDoc.bankCashAccountId) as never,
        reference: form.reference || undefined,
        narration: form.narration || undefined,
        lines: editVoucherDoc.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
        })),
      });
      toast.success("Receipt updated");
      setSearchParams({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update receipt");
    }
  };

  const delEdit = async () => {
    if (!societyId || !editId || !editVoucherDoc) return;
    if (!confirm(`Delete receipt ${editVoucherDoc.voucherNo}? Bill settlements for it will be reversed.`)) return;
    try {
      await removeVoucher({ societyId, id: editId as Id<"vouchers"> });
      toast.success("Receipt deleted");
      setSearchParams({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // Prefill the edit form from the loaded voucher
  useEffect(() => {
    if (!editId || !editVoucherDoc) return;
    setForm({
      memberId: (editVoucherDoc.memberId as string) ?? "",
      date: editVoucherDoc.date,
      amount: String(editVoucherDoc.total),
      mode: editVoucherDoc.mode ?? "cash",
      bankCashAccountId: (editVoucherDoc.bankCashAccountId as string) ?? "",
      reference: editVoucherDoc.reference ?? "",
      narration: editVoucherDoc.narration ?? "",
    });
  }, [editId, editVoucherDoc]);

  const formatUnallocated = (n: number) =>
    `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n)}`;

  const selectedMember = members?.find((m) => m._id === form.memberId);

  /** Print the legacy-format receipt for a saved member receipt voucher. */
  const printReceiptFor = (v: Doc<"vouchers">, kind: "pdf" | "word" | "print") => {
    const s = societyCtx.society;
    if (!s) return;
    const mem = members?.find((m) => m._id === v.memberId);
    const firstBill = (bills ?? [])
      .filter((b) => (v.allocations ?? []).some((a) => a.billId === b._id))
      .sort((a, b) => b.period.localeCompare(a.period))[0];
    const data: LegacyReceiptData = {
      society: {
        name: s.name,
        address: [s.address, s.city, s.state, s.pincode].filter(Boolean).join(", "),
        registrationNo: s.registrationNo,
      },
      receiptNo: v.voucherNo.replace(/^[A-Z]+-/, ""),
      receiptDate: v.date,
      memberName: mem?.name ?? "Member",
      flatNo: [mem?.wing, mem?.flatNo].filter(Boolean).join("-") || undefined,
      amount: v.total,
      paymentKind: "part",
      purpose: `Maintenance for the Month${firstBill ? ` ${periodLabelLong(firstBill.period)}` : ""}`,
      mode: v.mode,
      reference: v.reference,
    };
    if (kind === "pdf") receiptPdf(data, `receipt-${v.voucherNo}.pdf`);
    else if (kind === "word") receiptWord(data, `receipt-${v.voucherNo}.doc`);
    else receiptPrint(data);
  };

  return (
    <div>
      <PageHeader
        title={editId ? "Edit Member Receipt" : "Member Receipt"}
        description={
          editId
            ? "Editing an existing collection — date, mode, bank/cash account and reference can change. The amount and its bill settlements stay fixed; delete and re-enter to change those."
            : "Record maintenance collections from members. Receipts debit bank/cash and credit the member's receivable, settling outstanding bills oldest-first."
        }
      />

      {editId && editVoucherDoc ? (
        <form onSubmit={submitEdit} className="mb-10 rounded-lg border p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Member</Label>
              <Input readOnly className="bg-muted/50"
                value={members?.find((m) => m._id === editVoucherDoc.memberId)?.name ?? "—"} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="er-date">Date *</Label>
              <Input id="er-date" type="date" required value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="er-amount">Amount (₹)</Label>
              <Input id="er-amount" readOnly className="bg-muted/50 text-right tabular-nums"
                value={formatMoney(editVoucherDoc.total)} />
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v })}>
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
              <Select value={form.bankCashAccountId || undefined}
                onValueChange={(v) => setForm({ ...form, bankCashAccountId: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="er-ref">Reference</Label>
              <Input id="er-ref" value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="er-narr">Narration</Label>
              <Input id="er-narr" value={form.narration}
                onChange={(e) => setForm({ ...form, narration: e.target.value })} />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="destructive" className="rounded-lg px-6" onClick={delEdit}>
              Delete
            </Button>
            <Button type="button" variant="outline" className="rounded-lg px-6"
              onClick={() => setSearchParams({})}>
              Exit
            </Button>
            <Button type="submit" className="rounded-lg px-8">Update</Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Member *</Label>
            <Select value={form.memberId || undefined}
              onValueChange={(v) => setForm({ ...form, memberId: v })}>
              <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {(members ?? []).filter((m) => m.isActive).map((m) => (
                  <SelectItem key={m._id} value={m._id}>
                    {m.code} — {m.name} ({[m.wing, m.flatNo].filter(Boolean).join("-")})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-date">Date *</Label>
            <Input id="r-date" type="date" required value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-amount">Amount (₹) *</Label>
            <Input id="r-amount" type="number" step="0.01" min="0.01" required value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v, bankCashAccountId: "" })}>
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
            <Select value={form.bankCashAccountId || undefined}
              onValueChange={(v) => setForm({ ...form, bankCashAccountId: v })}>
              <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-ref">Reference</Label>
            <Input id="r-ref" value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder="UTR / cheque no." />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="r-narr">Narration</Label>
            <Input id="r-narr" value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              placeholder="April maintenance collection" />
          </div>
        </div>

        {selectedMember && outstandingBills.length > 0 && (
          <div className="mt-5 rounded-md border bg-accent/30 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Automatic settlement preview (oldest first)
            </p>
            <div className="space-y-1 text-sm">
              {previewAllocation.rows.map((r) => (
                <div key={r.bill._id} className="flex justify-between">
                  <span>
                    {r.bill.billNo} · {formatPeriod(r.bill.period)} · due {formatDate(r.bill.dueDate)}
                  </span>
                  <span className="tabular-nums">{formatUnallocated(r.take)}</span>
                </div>
              ))}
              {previewAllocation.unallocated > 0 && (
                <div className="flex justify-between font-medium">
                  <span>Excess kept as advance</span>
                  <span className="tabular-nums">{formatUnallocated(previewAllocation.unallocated)}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {selectedMember && outstandingBills.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            No outstanding bills for this member — the receipt will still credit their account.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Button type="submit" className="rounded-lg px-6">
            <Plus className="size-4" /> Save receipt
          </Button>
        </div>
      </form>
      )}

      <h3 className="mb-4 text-sm font-medium">Recorded receipts</h3>
      <VoucherList
        title="Member Receipts"
        description="Member receipt vouchers"
        fixedType="member_receipt"
        renderReceipt={(v, kind) => printReceiptFor(v, kind)}
      />
    </div>
  );
}
