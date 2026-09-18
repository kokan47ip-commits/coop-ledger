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
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type TariffRow = {
  _id: Id<"tariffs">;
  name: string;
  accountId: Id<"accounts">;
  amount: number;
  unit?: "flat" | "member";
  isActive: boolean;
};

type AccountRow = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  type: string;
};

export default function Tariffs() {
  const { societyId } = useSociety();
  const tariffs = useQuery(
    api.tariffs.list,
    societyId ? { societyId } : "skip",
  ) as TariffRow[] | undefined;
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as AccountRow[] | undefined;
  const upsert = useMutation(api.tariffs.upsert);
  const remove = useMutation(api.tariffs.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: "" as Id<"tariffs"> | "",
    name: "",
    accountId: "",
    amount: "0",
    unit: "flat",
    isActive: true,
  });

  const incomeAccounts = (accounts ?? []).filter((a) => a.type === "income");
  const accountName = (id: Id<"accounts">) => {
    const a = (accounts ?? []).find((x) => x._id === id);
    return a ? `${a.code} — ${a.name}` : "—";
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !form.accountId) return;
    try {
      await upsert({
        societyId,
        id: form.id || undefined,
        name: form.name.trim(),
        accountId: form.accountId as Id<"accounts">,
        amount: Number(form.amount) || 0,
        unit: form.unit as "flat" | "member",
        isActive: form.isActive,
      });
      toast.success(form.id ? "Tariff updated" : "Tariff added");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save tariff");
    }
  };

  const del = async (t: TariffRow) => {
    if (!societyId) return;
    if (!confirm(`Delete tariff "${t.name}"?`)) return;
    try {
      await remove({ societyId, id: t._id });
      toast.success("Tariff deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const totalPerFlat = (tariffs ?? [])
    .filter((t) => t.isActive)
    .reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <PageHeader
        title="Tariff Schedule"
        description="Recurring charges applied to every member when a monthly bill is generated."
        actions={
          <Button
            className="rounded-none"
            disabled={incomeAccounts.length === 0}
            onClick={() => {
              setForm({ id: "", name: "", accountId: incomeAccounts[0]?._id ?? "", amount: "0", unit: "flat", isActive: true });
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Add tariff
          </Button>
        }
      />

      {!tariffs ? null : tariffs.length === 0 ? (
        <EmptyHint>
          No tariffs yet. Add charge heads (e.g. Maintenance ₹2,500 per flat) to enable bill generation.
        </EmptyHint>
      ) : (
        <>
          <div className="mb-4 text-sm text-muted-foreground">
            Active total per {""}
            flat: <span className="font-medium text-foreground">{formatINR(totalPerFlat)}</span>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Tariff</TableHead>
                  <TableHead>Income account</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...tariffs]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((t) => (
                    <TableRow key={t._id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-sm">{accountName(t.accountId)}</TableCell>
                      <TableCell className="capitalize">per {t.unit ?? "flat"}</TableCell>
                      <TableCell className="text-right"><RightMoney value={t.amount} /></TableCell>
                      <TableCell className={t.isActive ? "text-foreground" : "text-muted-foreground"}>
                        {t.isActive ? "Active" : "Inactive"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => {
                              setForm({
                                id: t._id,
                                name: t.name,
                                accountId: t.accountId,
                                amount: String(t.amount),
                                unit: t.unit ?? "flat",
                                isActive: t.isActive,
                              });
                              setOpen(true);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(t)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit tariff" : "Add tariff"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-name">Tariff name *</Label>
              <Input id="t-name" required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Maintenance Charges" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Income account *</Label>
                <Select value={form.accountId || undefined}
                  onValueChange={(v) => setForm({ ...form, accountId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {incomeAccounts.map((a) => (
                      <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-amount">Amount (₹) *</Label>
                <Input id="t-amount" type="number" step="0.01" required value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Basis</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Per flat</SelectItem>
                    <SelectItem value="member">Per member</SelectItem>
                  </SelectContent>
                </Select>
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
