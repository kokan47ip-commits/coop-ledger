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
import { formatMoney, todayISO } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Account = Doc<"accounts">;

type AddedLine = {
  key: number;
  accountId: Id<"accounts">;
  code: string;
  name: string;
  debit: number;
  credit: number;
};

let lineKey = 1;

/**
 * Legacy-style voucher screen shared by Payment and Other Receipt: a voucher
 * header (book, date, last number), the cash/bank side with its current
 * balance, cheque details, and a ledger entry row that appends Dr/Cr lines to
 * the entries grid. Saving posts the bank/cash line automatically on the
 * opposite side of the net entry so the voucher always balances.
 */
export function LedgerVoucherForm({ kind }: { kind: "payment" | "other_receipt" }) {
  const isPayment = kind === "payment";
  const { societyId } = useSociety();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);
  const lastNo = useQuery(
    api.vouchers.lastNo,
    societyId ? { societyId, type: kind } : "skip",
  ) as { last: number; lastVoucherNo: string | null; prefix: string } | undefined;

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const ledgerAccounts = (accounts ?? []).filter((a) => a.kind !== "bank_cash");

  const [date, setDate] = useState(todayISO());
  const [bankCashAccountId, setBankCashAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [bankName, setBankName] = useState("");
  const [party, setParty] = useState(""); // Paid to / Received from
  const [narration, setNarration] = useState("");
  const [ledgerId, setLedgerId] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [lines, setLines] = useState<AddedLine[]>([]);
  const [saving, setSaving] = useState(false);

  const bankBal = useQuery(
    api.api.accountBalance,
    societyId && bankCashAccountId
      ? { societyId, accountId: bankCashAccountId as Id<"accounts">, asOf: date }
      : "skip",
  ) as { balance: number; debitNature: boolean } | undefined;

  const ledgerBal = useQuery(
    api.api.accountBalance,
    societyId && ledgerId
      ? { societyId, accountId: ledgerId as Id<"accounts">, asOf: date }
      : "skip",
  ) as { balance: number; debitNature: boolean } | undefined;

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const net = isPayment ? totalDebit - totalCredit : totalCredit - totalDebit;

  const balText = (b: { balance: number } | undefined) =>
    b ? `${formatMoney(Math.abs(b.balance))} ${b.balance >= 0 ? "Dr" : "Cr"}` : "—";

  const addLine = () => {
    const dr = Number(debit) || 0;
    const cr = Number(credit) || 0;
    if (!ledgerId) {
      toast.error("Select a ledger account first.");
      return;
    }
    if ((dr > 0) === (cr > 0)) {
      toast.error("Enter an amount on either the debit or the credit side — not both.");
      return;
    }
    const acc = accounts?.find((a) => a._id === ledgerId);
    if (!acc) return;
    setLines((ls) => [
      ...ls,
      { key: lineKey++, accountId: acc._id, code: acc.code, name: acc.name, debit: dr, credit: cr },
    ]);
    setLedgerId("");
    setDebit("");
    setCredit("");
  };

  const removeLine = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));

  const reset = () => {
    setAmount("");
    setChequeNo("");
    setChequeDate("");
    setBankName("");
    setParty("");
    setNarration("");
    setLedgerId("");
    setDebit("");
    setCredit("");
    setLines([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    if (!bankCashAccountId) {
      toast.error("Select the cash/bank account.");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one ledger entry.");
      return;
    }
    if (net <= 0) {
      toast.error(
        isPayment
          ? "Debits must exceed credits — the difference is what leaves the bank."
          : "Credits must exceed debits — the difference is what enters the bank.",
      );
      return;
    }
    const reference = chequeNo
      ? chequeDate
        ? `${chequeNo} dt ${chequeDate}`
        : chequeNo
      : undefined;
    const fullNarration = [narration, bankName ? `Bank: ${bankName}` : ""]
      .filter(Boolean)
      .join(" — ") || undefined;

    const payloadLines = [
      ...lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })),
      isPayment
        ? { accountId: bankCashAccountId as Id<"accounts">, debit: 0, credit: net }
        : { accountId: bankCashAccountId as Id<"accounts">, debit: net, credit: 0 },
    ];

    setSaving(true);
    try {
      await createVoucher({
        societyId,
        type: kind,
        date,
        mode: party || (isPayment ? undefined : "other"),
        bankCashAccountId: bankCashAccountId as Id<"accounts">,
        reference,
        narration: fullNarration,
        lines: payloadLines,
      });
      toast.success(`Voucher of ₹ ${formatMoney(net)} saved`);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save voucher");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-10 rounded-lg border">
      {/* Voucher header */}
      <div className="grid gap-4 border-b p-5 sm:grid-cols-4">
        <div className="space-y-2">
          <Label>Book Code</Label>
          <Input value={isPayment ? "Payments" : "Receipts"} readOnly className="bg-muted/50" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-date">Voucher Date *</Label>
          <Input id="v-date" type="date" required value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Last Voucher No</Label>
          <Input value={lastNo?.lastVoucherNo ?? "—"} readOnly className="bg-muted/50 font-mono text-xs" />
        </div>
        <div className="space-y-2">
          <Label>Voucher No</Label>
          <Input
            value={lastNo ? `${lastNo.prefix}-${String((lastNo.last ?? 0) + 1).padStart(4, "0")}` : "auto"}
            readOnly
            className="bg-muted/50 font-mono text-xs"
            title="Assigned automatically on save"
          />
        </div>
      </div>

      {/* Cash/Bank + instrument details */}
      <div className="grid gap-4 border-b p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Cash/Bank *</Label>
          <Select value={bankCashAccountId || undefined}
            onValueChange={setBankCashAccountId}>
            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {bankAccounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Cur Bal: <span className="tabular-nums text-foreground">{balText(bankBal)}</span>
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-amount">Amount (₹)</Label>
          <Input id="v-amount" value={net > 0 ? formatMoney(net) : ""} readOnly
            className="bg-muted/50 text-right font-medium tabular-nums"
            placeholder="Total of the entries below" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="v-chq">Cheque No</Label>
            <Input id="v-chq" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v-chqdt">Cheque Date</Label>
            <Input id="v-chqdt" type="date" value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-bankname">Bank Name</Label>
          <Input id="v-bankname" value={bankName} onChange={(e) => setBankName(e.target.value)}
            placeholder="For cheque / NEFT instruments" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-party">{isPayment ? "Paid To" : "Received From"}</Label>
          <Input id="v-party" value={party} onChange={(e) => setParty(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="v-narr">Narration</Label>
          <Input id="v-narr" value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>

      {/* Ledger quick-add row */}
      <div className="border-b p-5">
        <div className="grid items-start gap-3 sm:grid-cols-12">
          <div className="space-y-2 sm:col-span-6">
            <Label>Ledger</Label>
            <Select value={ledgerId || undefined}
              onValueChange={(v) => { setLedgerId(v); setDebit(""); setCredit(""); }}>
              <SelectTrigger><SelectValue placeholder="Select ledger account" /></SelectTrigger>
              <SelectContent>
                {ledgerAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Cur Bal: <span className="tabular-nums text-foreground">{balText(ledgerBal)}</span>
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="v-dr">Debit</Label>
            <Input id="v-dr" type="number" step="0.01" min="0" className="text-right"
              value={debit} onChange={(e) => { setDebit(e.target.value); setCredit(""); }} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="v-cr">Credit</Label>
            <Input id="v-cr" type="number" step="0.01" min="0" className="text-right"
              value={credit} onChange={(e) => { setCredit(e.target.value); setDebit(""); }} />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="button" variant="outline" className="w-full rounded-none" onClick={addLine}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>
      </div>

      {/* Entries grid */}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24">Code</TableHead>
            <TableHead>Ledger</TableHead>
            <TableHead className="w-32 text-right">Debit</TableHead>
            <TableHead className="w-32 text-right">Credit</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                Add ledger entries above — the {isPayment ? "credit" : "debit"} to cash/bank is posted automatically on save.
              </TableCell>
            </TableRow>
          ) : (
            lines.map((l) => (
              <TableRow key={l.key}>
                <TableCell className="font-mono text-xs">{l.code}</TableCell>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.debit ? formatMoney(l.debit) : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.credit ? formatMoney(l.credit) : ""}
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon"
                    className="size-8 text-destructive" onClick={() => removeLine(l.key)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
          <TableRow className="border-t-2 hover:bg-transparent">
            <TableCell colSpan={2} className="font-semibold">
              {isPayment ? "To" : "By"} {bankAccounts.find((a) => a._id === bankCashAccountId)?.name ?? "Cash/Bank"} (auto)
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {!isPayment && net > 0 ? formatMoney(net) : ""}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {isPayment && net > 0 ? formatMoney(net) : ""}
            </TableCell>
            <TableCell />
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={2} className="text-right text-muted-foreground">Total</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatMoney(totalDebit + (isPayment ? 0 : net > 0 ? net : 0))}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {formatMoney(totalCredit + (isPayment && net > 0 ? net : 0))}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>

      <div className="flex justify-end gap-2 border-t p-5">
        <Button type="submit" className="rounded-none px-8" disabled={saving || net <= 0}>
          Save voucher
        </Button>
      </div>
    </form>
  );
}
