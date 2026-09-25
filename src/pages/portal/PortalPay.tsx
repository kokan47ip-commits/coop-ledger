import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { formatMoney, todayISO } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Send } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type OpenBill = {
  _id: Id<"bills">;
  billNo: string;
  period: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paidAmount: number;
  balance: number;
};

type PayAccount = { _id: Id<"accounts">; code: string; name: string };

export default function PortalPay() {
  const { societyId } = useSociety();
  const openBills = useQuery(
    api.memberPortal.myOpenBills,
    societyId ? { societyId } : "skip",
  ) as OpenBill[] | null | undefined;
  const accounts = useQuery(
    api.memberPortal.myPayAccounts,
    societyId ? { societyId } : "skip",
  ) as PayAccount[] | null | undefined;

  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState<string>("");
  const [mode, setMode] = useState<string>("bank");
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitPayment = useMutation(api.memberPortal.submitPayment);

  const parsedAllocs = Object.entries(allocs)
    .map(([id, amt]) => ({ billId: id as Id<"bills">, amount: Number(amt) || 0 }))
    .filter((a) => a.amount > 0);
  const total = parsedAllocs.reduce((s, a) => s + a.amount, 0);

  const overAllocated = parsedAllocs.some((a) => {
    const b = openBills?.find((x) => x._id === a.billId);
    return b ? a.amount > b.balance + 0.005 : true;
  });

  const submit = async () => {
    if (!societyId) return;
    if (!accountId) {
      toast.error("Choose the cash/bank account you are paying into.");
      return;
    }
    if (parsedAllocs.length === 0) {
      toast.error("Enter the amount to pay against at least one bill.");
      return;
    }
    if (overAllocated) {
      toast.error("An amount exceeds the bill balance — adjust and retry.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitPayment({
        societyId,
        date: todayISO(),
        bankCashAccountId: accountId as Id<"accounts">,
        mode,
        reference: reference.trim() || undefined,
        narration: narration.trim() || undefined,
        allocations: parsedAllocs,
      });
      toast.success(
        `Payment recorded — receipt ${res.voucherNo} for ${formatMoney(res.total)}.`,
      );
      setAllocs({});
      setReference("");
      setNarration("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (openBills === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Your login is not linked to a flat in this society.
      </p>
    );
  }
  if (!openBills || !accounts) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label className="text-xs text-muted-foreground">Paying into</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Cash / bank account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.code} — {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs text-muted-foreground">Mode</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank">Bank transfer</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="text-xs text-muted-foreground">
            Reference / UTTR no.
          </Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. UPI ref"
            className="mt-1"
          />
        </div>
        <div className="min-w-56 flex-1">
          <Label className="text-xs text-muted-foreground">Note (optional)</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Appears on your receipt"
            className="mt-1"
          />
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Pay</TableHead>
              <TableHead>Bill No.</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-36 text-right">Amount to pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openBills.map((b) => {
              const checked = allocs[b._id] !== undefined;
              return (
                <TableRow key={b._id}>
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setAllocs((prev) => {
                          const next = { ...prev };
                          if (v) {
                            next[b._id] = String(b.balance.toFixed(2));
                          } else {
                            delete next[b._id];
                          }
                          return next;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{b.billNo}</TableCell>
                  <TableCell>{b.period}</TableCell>
                  <TableCell>{b.dueDate}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(b.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(b.paidAmount)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(b.balance)}
                  </TableCell>
                  <TableCell>
                    {checked ? (
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        max={b.balance}
                        value={allocs[b._id]}
                        onChange={(e) =>
                          setAllocs((prev) => ({
                            ...prev,
                            [b._id]: e.target.value,
                          }))
                        }
                        className="ml-auto h-8 w-32 text-right"
                      />
                    ) : (
                      <span className="block text-right text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {openBills.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Badge variant="outline" className="text-emerald-600">
                      All clear
                    </Badge>
                    You have no outstanding bills — nothing to pay right now.
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Submit payment</CardTitle>
          <CardDescription>
            Dated today; allocations cannot exceed each bill's balance. The
            society office sees your payment immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Total payment
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoney(total)}
            </p>
          </div>
          {overAllocated && (
            <p className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="size-4" /> An amount exceeds the bill
              balance.
            </p>
          )}
          <Button
            className="ml-auto"
            size="lg"
            disabled={submitting || total <= 0 || overAllocated || !accountId}
            onClick={submit}
          >
            <Send className="mr-2 size-4" />
            {submitting ? "Submitting..." : "Submit payment"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
