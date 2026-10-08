import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { formatINR } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type MemberRow = {
  _id: Id<"members">;
  code: string;
  name: string;
  flatNo?: string;
  wing?: string;
  isActive: boolean;
};

type SuppBill = {
  _id: Id<"bills">;
  billNo: string;
  memberId: Id<"members">;
  period: string;
  issueDate: string;
  dueDate: string;
  category?: string;
  description?: string;
  lines: { name: string; amount: number }[];
  total: number;
  paidAmount: number;
  status: "unpaid" | "partial" | "paid";
};

const CATEGORIES = [
  "Special Repair",
  "Emergency Fund",
  "Event Contribution",
  "Penalty",
  "Other",
] as const;

export default function SupplementaryBills() {
  const { societyId, canEdit } = useSociety();
  const members = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  const bills = useQuery(
    api.supplementary.list,
    societyId ? { societyId } : "skip",
  ) as SuppBill[] | undefined;

  const createBill = useMutation(api.supplementary.create);
  const removeBill = useMutation(api.supplementary.remove);

  const [form, setForm] = useState({
    description: "",
    category: "Special Repair" as (typeof CATEGORIES)[number],
    amount: "",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    accountId: "",
    selected: new Set<string>(),
  });
  const [busy, setBusy] = useState(false);

  const activeMembers = (members ?? []).filter((m) => m.isActive);

  const nameOf = (id: Id<"members">) => {
    const m = (members ?? []).find((x) => x._id === id);
    return m ? `${m.name} (${m.code})` : "(archived)";
  };

  const sorted = useMemo(
    () =>
      (bills ?? []).slice().sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1)),
    [bills],
  );

  const totalOutstanding = sorted.reduce(
    (s, b) => s + (b.total - b.paidAmount),
    0,
  );

  const toggle = (id: string) => {
    const next = new Set(form.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm((f) => ({ ...f, selected: next }));
  };

  const submit = async () => {
    if (!societyId) return;
    setBusy(true);
    try {
      const res = await createBill({
        societyId,
        description: form.description,
        category: form.category,
        amount: Number(form.amount),
        issueDate: form.issueDate,
        dueDate: form.dueDate || form.issueDate,
        accountId:
          form.accountId !== "" ? (form.accountId as Id<"accounts">) : undefined,
        memberIds: [...form.selected] as Id<"members">[],
      });
      toast.success(
        `${res.created} supplementary bill${res.created === 1 ? "" : "s"} issued${res.skipped ? `, ${res.skipped} skipped` : ""}.`,
      );
      setForm((f) => ({
        ...f,
        description: "",
        amount: "",
        selected: new Set(),
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (bill: SuppBill) => {
    if (!societyId) return;
    try {
      await removeBill({ societyId, id: bill._id });
      toast.success(`Supplementary bill ${bill.billNo} deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplementary Bills"
        description="Charge special repairs, emergency funds, event contributions or penalties outside the regular maintenance cycle. These bills join the member ledger and dues automatically, with their own SB- number series."
      />

      {canEdit && societyId ? (
        <Card className="p-4">
          <div className="grid gap-4 md:grid-cols-6">
            <div className="md:col-span-2 space-y-1.5">
              <Label>Charge description</Label>
              <Input
                placeholder="e.g. Terrace waterproofing special repair"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    category: v as (typeof CATEGORIES)[number],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount per member (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Issue date</Label>
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, issueDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              Apply to members ({form.selected.size} of {activeMembers.length}{" "}
              selected)
            </Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    selected: new Set(activeMembers.map((m) => m._id)),
                  }))
                }
              >
                Select all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, selected: new Set() }))}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-md border">
            {activeMembers.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                No active members found — add members first.
              </div>
            ) : (
              activeMembers.map((m) => (
                <label
                  key={m._id}
                  className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={form.selected.has(m._id)}
                    onCheckedChange={() => toggle(m._id)}
                  />
                  <span>{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.code}
                    {m.flatNo ? ` • ${m.wing ?? ""}-${m.flatNo}` : ""}
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="mt-3 flex justify-end">
            <Button
              onClick={submit}
              disabled={
                busy ||
                !form.description.trim() ||
                !(Number(form.amount) > 0) ||
                form.selected.size === 0
              }
            >
              <Plus className="mr-1 size-4" />
              {busy ? "Issuing…" : `Issue ${form.selected.size || ""} supplementary bill${form.selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Supplementary bill register</h3>            <p className="text-xs text-muted-foreground">
              Outstanding: ₹{formatINR(totalOutstanding)} — payments settle
              these like any regular bill.
            </p>
          </div>
          <Badge variant="secondary">{sorted.length} bills</Badge>
        </div>
        {sorted === undefined ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="p-4">
            <EmptyHint>
              No supplementary bills yet — issue one above when the society
              levies a special charge.
            </EmptyHint>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill No.</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Charge</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                {canEdit ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((b) => (
                <TableRow key={b._id}>
                  <TableCell className="font-mono text-xs">{b.billNo}</TableCell>
                  <TableCell>{nameOf(b.memberId)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{b.category ?? "Other"}</Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {b.lines.map((l) => l.name).join("; ")}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatINR(b.total)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatINR(b.paidAmount)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatINR(b.total - b.paidAmount)}
                  </TableCell>
                  <TableCell className="text-xs">{b.issueDate}</TableCell>
                  <TableCell className="text-xs">{b.dueDate}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        b.status === "paid"
                          ? "secondary"
                          : b.status === "partial"
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {b.status}
                    </Badge>
                  </TableCell>
                  {canEdit && societyId ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOne(b)}
                        title="Delete"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  ) : (
                    <TableCell />
                  )}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-medium">
                  Total — {sorted.length} supplementary bill
                  {sorted.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatINR(sorted.reduce((s, b) => s + b.total, 0))}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatINR(sorted.reduce((s, b) => s + b.paidAmount, 0))}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatINR(totalOutstanding)}
                </TableCell>
                <TableCell colSpan={canEdit ? 3 : 2} />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>
    </div>
  );
}
