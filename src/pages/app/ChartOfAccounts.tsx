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
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { formatINR } from "@/lib/format";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type AccountRow = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  kind?: "bank_cash" | "receivable";
  openingBalance: number;
};

const GROUPS = [
  { type: "asset", label: "Assets" },
  { type: "liability", label: "Liabilities & Funds" },
  { type: "income", label: "Income" },
  { type: "expense", label: "Expenses" },
] as const;

export default function ChartOfAccounts() {
  const { societyId } = useSociety();
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as AccountRow[] | undefined;
  const upsert = useMutation(api.accounts.upsert);
  const remove = useMutation(api.accounts.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: "" as Id<"accounts"> | "",
    code: "",
    name: "",
    type: "expense",
    kind: "none",
    openingBalance: "0",
  });

  const grouped = useMemo(() => {
    const list = [...(accounts ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    return GROUPS.map((g) => ({
      ...g,
      rows: list.filter((a) => a.type === g.type),
    }));
  }, [accounts]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    try {
      await upsert({
        societyId,
        id: form.id || undefined,
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type as "asset" | "liability" | "income" | "expense",
        kind: form.kind === "none" ? undefined : (form.kind as "bank_cash" | "receivable"),
        openingBalance: Number(form.openingBalance) || 0,
      });
      toast.success(form.id ? "Account updated" : "Account added");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save account");
    }
  };

  const del = async (a: AccountRow) => {
    if (!societyId) return;
    if (!confirm(`Delete account ${a.code} — ${a.name}?`)) return;
    try {
      await remove({ societyId, id: a._id });
      toast.success("Account deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        description="Ledger heads used by tariffs, vouchers and reports. Opening balances set the starting position for the current financial year."
        actions={
          <Button
            className="rounded-none"
            onClick={() => {
              setForm({ id: "", code: "", name: "", type: "expense", kind: "none", openingBalance: "0" });
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Add account
          </Button>
        }
      />

      {!accounts ? null : accounts.length === 0 ? (
        <EmptyHint>No accounts. Add ledger heads or recreate the society profile.</EmptyHint>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) =>
            g.rows.length === 0 ? null : (
              <section key={g.type}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {g.label} · <span className="tabular-nums">{g.rows.length}</span>
                </h3>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="w-20 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map((a) => (
                        <TableRow key={a._id}>
                          <TableCell className="font-mono text-xs">{a.code}</TableCell>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.kind === "bank_cash" ? "Bank / Cash" : a.kind === "receivable" ? "Receivable control" : "—"}
                          </TableCell>
                          <TableCell className="text-right"><RightMoney value={a.openingBalance} /></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => {
                                  setForm({
                                    id: a._id,
                                    code: a.code,
                                    name: a.name,
                                    type: a.type,
                                    kind: a.kind ?? "none",
                                    openingBalance: String(a.openingBalance),
                                  });
                                  setOpen(true);
                                }}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(a)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ),
          )}
          <p className="text-xs text-muted-foreground">
            Total opening value: {formatINR((accounts ?? []).reduce((s, a) => s + a.openingBalance, 0))}
          </p>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit account" : "Add account"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="a-code">Code *</Label>
                <Input id="a-code" required value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="4090" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-name">Name *</Label>
                <Input id="a-name" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Garden Maintenance" />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General</SelectItem>
                    <SelectItem value="bank_cash">Bank / Cash</SelectItem>
                    <SelectItem value="receivable">Members Receivable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="a-open">Opening balance (₹)</Label>
                <Input id="a-open" type="number" step="0.01" value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
