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

export default function OtherReceipt() {
  const { societyId } = useSociety();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const creditableAccounts = (accounts ?? []).filter(
    (a) => a.type === "income" || a.type === "liability" || a.type === "asset",
  );

  const [form, setForm] = useState({
    date: todayISO(),
    creditAccountId: "",
    amount: "",
    bankCashAccountId: "",
    from: "",
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
    if (!form.creditAccountId || !form.bankCashAccountId) {
      toast.error("Select both the credit account and the bank/cash account.");
      return;
    }
    try {
      await createVoucher({
        societyId,
        type: "other_receipt",
        date: form.date,
        mode: form.from || "other",
        bankCashAccountId: form.bankCashAccountId as Id<"accounts">,
        reference: form.reference || undefined,
        narration: form.narration || undefined,
        lines: [
          { accountId: form.bankCashAccountId as Id<"accounts">, debit: amount, credit: 0 },
          { accountId: form.creditAccountId as Id<"accounts">, debit: 0, credit: amount },
        ],
      });
      toast.success(`Other receipt of ${formatINR(amount)} saved`);
      setForm({ ...form, creditAccountId: "", amount: "", reference: "", narration: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save receipt");
    }
  };

  return (
    <div>
      <PageHeader
        title="Other Receipt"
        description="Non-member receipts such as interest income, hall rentals or donations — debits bank/cash, credits the selected account."
      />

      <form onSubmit={submit} className="mb-10 rounded-lg border p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="or-date">Date *</Label>
            <Input id="or-date" type="date" required value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Credit account *</Label>
            <Select value={form.creditAccountId || undefined}
              onValueChange={(v) => setForm({ ...form, creditAccountId: v })}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {creditableAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="or-amount">Amount (₹) *</Label>
            <Input id="or-amount" type="number" step="0.01" min="0.01" required value={form.amount}
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
            <Label htmlFor="or-from">Received from</Label>
            <Input id="or-from" value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="e.g. HDFC Bank" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="or-ref">Reference</Label>
            <Input id="or-ref" value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="or-narr">Narration</Label>
            <Input id="or-narr" value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              placeholder="Fixed deposit interest for Q1" />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" className="rounded-none px-6">
            <Plus className="size-4" /> Save receipt
          </Button>
        </div>
      </form>

      <h3 className="mb-4 text-sm font-medium">Recorded other receipts</h3>
      <VoucherList title="Other Receipts" description="Other receipt vouchers" fixedType="other_receipt" />
    </div>
  );
}
