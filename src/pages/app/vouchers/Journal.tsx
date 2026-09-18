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
import { PageHeader } from "@/components/PageParts";
import { formatINR, todayISO } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { VoucherList } from "./VoucherList";

type Account = Doc<"accounts">;

type Line = { key: number; accountId: string; debit: string; credit: string; note: string };

let lineKey = 1;
const newLine = (): Line => ({ key: lineKey++, accountId: "", debit: "", credit: "", note: "" });

export default function Journal() {
  const { societyId } = useSociety();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);

  const [form, setForm] = useState({
    date: todayISO(),
    narration: "",
  });
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.round(totalDebit * 100) === Math.round(totalCredit * 100) && totalDebit > 0;

  const accountName = (id: string) =>
    accounts?.find((a) => a._id === id)?.name ?? "—";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    if (!balanced) {
      toast.error("Debits and credits must balance.");
      return;
    }
    const payloadLines = lines
      .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({
        accountId: l.accountId as Id<"accounts">,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        note: l.note || undefined,
      }));
    if (payloadLines.length < 2) {
      toast.error("At least two lines are required.");
      return;
    }
    try {
      await createVoucher({
        societyId,
        type: "journal",
        date: form.date,
        narration: form.narration || undefined,
        lines: payloadLines,
      });
      toast.success(`Journal of ${formatINR(totalDebit)} saved`);
      setLines([newLine(), newLine()]);
      setForm({ ...form, narration: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save journal");
    }
  };

  const updateLine = (key: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  return (
    <div>
      <PageHeader
        title="Journal Voucher"
        description="Adjustments, fund transfers and year-end entries. Debits must equal credits before saving."
      />

      <form onSubmit={submit} className="mb-10 rounded-lg border p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="j-date">Date *</Label>
            <Input id="j-date" type="date" required value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="j-narr">Narration</Label>
            <Input id="j-narr" value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              placeholder="Transfer maintenance surplus to sinking fund" />
          </div>
        </div>

        <div className="mt-5 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-56">Account</TableHead>
                <TableHead className="w-36 text-right">Debit (₹)</TableHead>
                <TableHead className="w-36 text-right">Credit (₹)</TableHead>
                <TableHead className="min-w-40">Note</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.key}>
                  <TableCell>
                    <Select value={l.accountId || undefined}
                      onValueChange={(v) => updateLine(l.key, { accountId: v })}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>
                        {(accounts ?? []).map((a) => (
                          <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-right" type="number" step="0.01" min="0" value={l.debit}
                      onChange={(e) => updateLine(l.key, { debit: e.target.value, credit: "" })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 text-right" type="number" step="0.01" min="0" value={l.credit}
                      onChange={(e) => updateLine(l.key, { credit: e.target.value, debit: "" })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8" value={l.note}
                      onChange={(e) => updateLine(l.key, { note: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive"
                      disabled={lines.length <= 2}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
            <Plus className="size-4" /> Add line
          </Button>
          <div className="flex items-center gap-6 text-sm">
            <span className="tabular-nums">Dr {formatINR(totalDebit)}</span>
            <span className="tabular-nums">Cr {formatINR(totalCredit)}</span>
            <span className={balanced ? "text-muted-foreground" : "text-destructive"}>
              {balanced ? "Balanced" : "Out of balance"}
            </span>
            <Button type="submit" className="rounded-none px-6" disabled={!balanced}>
              Save journal
            </Button>
          </div>
        </div>
      </form>

      <h3 className="mb-4 text-sm font-medium">Recorded journals</h3>
      <VoucherList title="Journal Vouchers" description="Journal vouchers" fixedType="journal" />
    </div>
  );
}
