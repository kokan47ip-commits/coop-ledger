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
import { formatDate, formatPeriod, todayISO } from "@/lib/format";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { VoucherList } from "./VoucherList";

type Member = Doc<"members">;
type Bill = Doc<"bills">;
type Account = Doc<"accounts">;

export default function MemberReceipt() {
  const { societyId } = useSociety();
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);

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

  const formatUnallocated = (n: number) =>
    `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n)}`;

  const selectedMember = members?.find((m) => m._id === form.memberId);

  return (
    <div>
      <PageHeader
        title="Member Receipt"
        description="Record maintenance collections from members. Receipts debit bank/cash and credit the member's receivable, settling outstanding bills oldest-first."
      />

      <form onSubmit={submit} className="mb-10 rounded-lg border p-5">
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
          <Button type="submit" className="rounded-none px-6">
            <Plus className="size-4" /> Save receipt
          </Button>
        </div>
      </form>

      <h3 className="mb-4 text-sm font-medium">Recorded receipts</h3>
      <VoucherList
        title="Member Receipts"
        description="Member receipt vouchers"
        fixedType="member_receipt"
      />
    </div>
  );
}
