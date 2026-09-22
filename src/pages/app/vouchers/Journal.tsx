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
import { formatMoney, todayISO } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { VoucherList } from "./VoucherList";

type Account = Doc<"accounts">;
type Voucher = Doc<"vouchers">;

type Line = { key: number; accountId: string; debit: string; credit: string };

let lineKey = 1;
const newLine = (): Line => ({ key: lineKey++, accountId: "", debit: "", credit: "" });

/**
 * Legacy-style Journal Voucher screen: Book Code / Voucher Date / Last Voucher
 * No header, a Ledger · Debit · Credit · Add quick-entry row, an entries grid
 * with code + running totals, and Save / Delete / Exit actions. Also serves as
 * the edit screen when opened with ?edit=<voucherId>.
 */
export default function Journal() {
  const { societyId } = useSociety();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");

  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const editing = useQuery(
    api.vouchers.getMany,
    societyId && editId ? { societyId, ids: [editId as Id<"vouchers">] } : "skip",
  ) as Voucher[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);
  const updateVoucher = useMutation(api.vouchers.update);
  const removeVoucher = useMutation(api.vouchers.remove);
  const lastNo = useQuery(
    api.vouchers.lastNo,
    societyId && !editId ? { societyId, type: "journal" } : "skip",
  ) as { last: number; lastVoucherNo: string | null; prefix: string } | undefined;

  const [date, setDate] = useState(todayISO());
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [narration, setNarration] = useState("");
  const [ledgerId, setLedgerId] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  // Prefill when editing — guarded so refetches never overwrite user edits.
  useEffect(() => {
    if (!editId || !editing) return;
    const v = editing[0];
    if (!v || loadedFrom === v._id) return;
    setDate(v.date);
    setNarration(v.narration ?? "");
    const ref = v.reference ?? "";
    setChequeNo(ref.includes(" dt ") ? ref.split(" dt ")[0] : ref);
    setChequeDate(ref.includes(" dt ") ? ref.split(" dt ")[1]?.slice(0, 10) ?? "" : "");
    setLines(
      v.lines.map((l) => ({
        key: lineKey++,
        accountId: l.accountId as string,
        debit: l.debit ? String(l.debit) : "",
        credit: l.credit ? String(l.credit) : "",
      })),
    );
    setLoadedFrom(v._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, loadedFrom]);

  const ledgerAccounts = accounts ?? [];

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const net = totalDebit - totalCredit;
  const balanced = Math.round(net * 100) === 0 && totalDebit > 0;

  const curBal = useQuery(
    api.api.accountBalance,
    societyId && ledgerId
      ? { societyId, accountId: ledgerId as Id<"accounts">, asOf: date }
      : "skip",
  ) as { balance: number; debitNature: boolean } | undefined;

  const balText = (b: { balance: number } | undefined) =>
    b ? `${formatMoney(Math.abs(b.balance))} ${b.balance >= 0 ? "Dr" : "Cr"}` : "—";

  const addLine = () => {
    const dr = Number(debit) || 0;
    const cr = Number(credit) || 0;
    if (!ledgerId) {
      toast.error("Select a ledger account first.");
      return;
    }
    if (dr > 0 && cr > 0) {
      toast.error("Enter an amount on either the debit or the credit side — not both.");
      return;
    }
    if (dr <= 0 && cr <= 0) {
      toast.error("Enter a debit or credit amount.");
      return;
    }
    setLines((ls) => [...ls, { key: lineKey++, accountId: ledgerId, debit: String(dr || ""), credit: String(cr || "") }]);
    setLedgerId("");
    setDebit("");
    setCredit("");
  };

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const clearForm = () => {
    setDate(todayISO());
    setChequeNo("");
    setChequeDate("");
    setNarration("");
    setLedgerId("");
    setDebit("");
    setCredit("");
    setLines([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    if (!balanced) {
      toast.error("Total debits must equal total credits before saving.");
      return;
    }
    const payloadLines = lines
      .filter((l) => l.accountId)
      .map((l) => ({
        accountId: l.accountId as Id<"accounts">,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }));
    if (payloadLines.length < 2) {
      toast.error("At least two ledger lines are required.");
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await updateVoucher({
          societyId,
          id: editId as Id<"vouchers">,
          date,
          narration: narration || undefined,
          reference: chequeNo
            ? chequeDate
              ? `${chequeNo} dt ${chequeDate}`
              : chequeNo
            : undefined,
          lines: payloadLines,
        });
        toast.success(`Journal updated`);
        setSearchParams({});
      } else {
        await createVoucher({
          societyId,
          type: "journal",
          date,
          narration: narration || undefined,
          reference: chequeNo
            ? chequeDate
              ? `${chequeNo} dt ${chequeDate}`
              : chequeNo
            : undefined,
          lines: payloadLines,
        });
        toast.success(`Journal of ₹ ${formatMoney(totalDebit)} saved`);
        clearForm();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save journal");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!societyId || !editId) return;
    if (!confirm("Delete this journal voucher? This reverses nothing — balances recalculate without it.")) return;
    try {
      await removeVoucher({ societyId, id: editId as Id<"vouchers"> });
      toast.success("Journal deleted");
      navigate("/app/journal");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const exit = () => {
    if (editId) setSearchParams({});
    else clearForm();
  };

  return (
    <div>
      <PageHeader
        title={editId ? "Edit Journal Voucher" : "Journal Voucher"}
        description="Adjustments, fund transfers and year-end entries. Post each Dr/Cr pair below — debits must equal credits before saving."
      />

      <form onSubmit={submit} className="mb-10 rounded-lg border">
        {/* Voucher header */}
        <div className="grid gap-4 border-b p-5 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>Book Code</Label>
            <Input value="Journal" readOnly className="bg-muted/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="j-date">Voucher Date *</Label>
            <Input id="j-date" type="date" required value={date}
              onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Last Voucher No</Label>
            <Input value={lastNo?.lastVoucherNo ?? "—"} readOnly className="bg-muted/50 font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label>Voucher No</Label>
            <Input
              value={
                editId
                  ? (editing?.[0]?.voucherNo ?? "…")
                  : lastNo
                    ? `${lastNo.prefix}-${String((lastNo.last ?? 0) + 1).padStart(4, "0")}`
                    : "auto"
              }
              readOnly
              className="bg-muted/50 font-mono text-xs"
              title="Assigned automatically"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="j-chq">Cheque No</Label>
            <Input id="j-chq" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="j-chqdt">Cheque Date</Label>
            <Input id="j-chqdt" type="date" value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="j-total">Total Amount</Label>
            <Input id="j-total" value={totalDebit > 0 ? formatMoney(totalDebit) : ""} readOnly
              className="bg-muted/50 text-right font-medium tabular-nums"
              placeholder="0.00" />
          </div>
          <div className="space-y-2 sm:col-span-4">
            <Label htmlFor="j-narr">Narration</Label>
            <Input id="j-narr" value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="e.g. 4W PARKING FROM APRIL-2026 TO SEP-2026" />
          </div>
        </div>

        {/* Ledger quick-add row — Dr stacked over Cr for a compact form */}
        <div className="border-b p-5">
          <div className="grid items-start gap-3 sm:grid-cols-12">
            <div className="space-y-2 sm:col-span-7">
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
                Cur Bal: <span className="tabular-nums text-foreground">{balText(curBal)}</span>
              </p>
            </div>
            <div className="grid gap-2 sm:col-span-3">
              <div className="space-y-1">
                <Label htmlFor="j-dr" className="text-xs text-muted-foreground">Debit (Dr)</Label>
                <Input id="j-dr" type="number" step="0.01" min="0" className="h-8 text-right"
                  value={debit} onChange={(e) => { setDebit(e.target.value); setCredit(""); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="j-cr" className="text-xs text-muted-foreground">Credit (Cr)</Label>
                <Input id="j-cr" type="number" step="0.01" min="0" className="h-8 text-right"
                  value={credit} onChange={(e) => { setCredit(e.target.value); setDebit(""); }} />
              </div>
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button type="button" variant="outline" className="w-full rounded-lg" onClick={addLine}>
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
              <TableHead className="w-36 text-right">Debit</TableHead>
              <TableHead className="w-36 text-right">Credit</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Add journal lines above — at least one debit and one credit.
                </TableCell>
              </TableRow>
            ) : (
              lines.map((l) => {
                const acc = accounts?.find((a) => a._id === l.accountId);
                return (
                  <TableRow key={l.key}>
                    <TableCell className="font-mono text-xs">{acc?.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{acc?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Input type="number" step="0.01" min="0" className="h-8 border-0 bg-transparent text-right shadow-none focus-visible:bg-background"
                        value={l.debit}
                        onChange={(e) => updateLine(l.key, { debit: e.target.value, credit: "" })} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Input type="number" step="0.01" min="0" className="h-8 border-0 bg-transparent text-right shadow-none focus-visible:bg-background"
                        value={l.credit}
                        onChange={(e) => updateLine(l.key, { credit: e.target.value, debit: "" })} />
                    </TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
            <TableRow className="border-t-2 hover:bg-transparent">
              <TableCell colSpan={2} />
              <TableCell className="text-right font-semibold tabular-nums">
                {totalDebit ? formatMoney(totalDebit) : ""}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {totalCredit ? formatMoney(totalCredit) : ""}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>

        <div className="flex justify-end gap-2 border-t p-5">
          {editId && (
            <Button type="button" variant="destructive" className="rounded-lg px-6" onClick={del}>
              Delete
            </Button>
          )}
          <Button type="button" variant="outline" className="rounded-lg px-6" onClick={exit}>
            Exit
          </Button>
          <Button type="submit" className="rounded-lg px-8" disabled={saving || !balanced}>
            {editId ? "Update" : "Save"}
          </Button>
        </div>
      </form>

      <h3 className="mb-4 text-sm font-medium">Recorded journals</h3>
      <VoucherList title="Journal Vouchers" description="Journal vouchers" fixedType="journal" />
    </div>
  );
}
