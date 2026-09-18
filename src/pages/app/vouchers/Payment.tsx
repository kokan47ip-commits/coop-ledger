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
import { formatINR, todayISO } from "@/lib/format";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { VoucherList } from "./VoucherList";

type Account = Doc<"accounts">;

export default function Payment() {
  const { societyId } = useSociety();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const debitAccounts = (accounts ?? []).filter(
    (a) => a.type === "expense" || a.type === "asset" || a.type === "liability",
  );

  const [form, setForm] = useState({
    date: todayISO(),
    debitAccountId: "",
    amount: "",
    bankCashAccountId: "",
    paidTo: "",
    reference: "",
    narration: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!form.debitAccountId || !form.bankCashAccountId) {
      toast.error("Select both the debit account and the bank/cash account.");
      return;
    }
    try {
      await createVoucher({
        societyId,
        type: "payment",
        date: form.date,
        mode: form.paidTo || undefined,
        bankCashAccountId: form.bankCashAccountId as Id<"accounts">,
        reference: form.reference || undefined,
        narration: form.narration || undefined,
        lines: [
          { accountId: form.debitAccountId as Id<"accounts">, debit: amount, credit: 0 },
          { accountId: form.bankCashAccountId as Id<"accounts">, debit: 0, credit: amount },
        ],
      });
      toast.success(`Payment of ${formatINR(amount)} saved`);
      setForm({ ...form, debitAccountId: "", amount: "", reference: "", narration: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save payment");
    }
  };

  return (
    <div>
      <PageHeader
        title="Payment Voucher"
        description="Society expenses and vendor payments — debits the expense/ledger account, credits bank or cash."
      />

      <form onSubmit={submit} className="mb-10 rounded-lg border p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="p-date">Date *</Label>
            <Input id="p-date" type="date" required value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Debit account *</Label>
            <Select value={form.debitAccountId || undefined}
              onValueChange={(v) => setForm({ ...form, debitAccountId: v })}>
              <SelectTrigger><SelectValue placeholder="Select expense / ledger" /></SelectTrigger>
              <SelectContent>
                {debitAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-amount">Amount (₹) *</Label>
            <Input id="p-amount" type="number" step="0.01" min="0.01" required value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Bank / Cash account *</Label>
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
            <Label htmlFor="p-paid">Paid to</Label>
            <Input id="p-paid" value={form.paidTo}
              onChange={(e) => setForm({ ...form, paidTo: e.target.value })} placeholder="Vendor name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-ref">Reference</Label>
            <Input id="p-ref" value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Cheque / UTR" />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="p-narr">Narration</Label>
            <Input id="p-narr" value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              placeholder="Security agency invoice for August" />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" className="rounded-none px-6">
            <Plus className="size-4" /> Save payment
          </Button>
        </div>
      </form>

      <h3 className="mb-4 text-sm font-medium">Recorded payments</h3>
      <VoucherList title="Payment Vouchers" description="Payment vouchers" fixedType="payment" />
    </div>
  );
}
