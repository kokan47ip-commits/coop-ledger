import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { downloadMemberTariffTemplate, parseExcelFile } from "@/lib/excel";
import { formatINR } from "@/lib/format";
import { CheckCircle2, Download, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/format";

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

type MemberRow = {
  _id: Id<"members">;
  code: string;
  name: string;
  flatNo?: string;
  wing?: string;
  building?: string;
  unitType?: string;
  floor?: string;
  isActive: boolean;
};

type OverrideRow = {
  _id: Id<"memberTariffs">;
  memberId: Id<"members">;
  tariffId: Id<"tariffs">;
  amount: number;
};

type UploadResult = { inserted: number; updated: number; skipped: number; errors: string[] };

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
  const uploadMemberTariffs = useMutation(api.uploads.uploadMemberTariffs);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: "" as Id<"tariffs"> | "",
    name: "",
    accountId: "",
    amount: "0",
    unit: "flat",
    isActive: true,
  });

  const members = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  const overrides = useQuery(
    api.tariffs.listOverrides,
    societyId ? { societyId } : "skip",
  ) as OverrideRow[] | undefined;
  const setOverride = useMutation(api.tariffs.setMemberOverride);

  const incomeAccounts = (accounts ?? []).filter((a) => a.type === "income");
  const accountName = (id: Id<"accounts">) => {
    const a = (accounts ?? []).find((x) => x._id === id);
    return a ? `${a.code} — ${a.name}` : "—";
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null);

  const runUpload = async (file: File) => {
    if (!societyId) return;
    setUploadBusy(true);
    try {
      const { rows } = await parseExcelFile(file);
      if (rows.length === 0) {
        toast.error("No rows found in the first sheet.");
        return;
      }
      const res = await uploadMemberTariffs({ societyId, rows });
      setLastUpload(res);
      toast.success(
        `Custom tariffs applied: ${res.inserted} added, ${res.updated} updated` +
          (res.errors.length ? `, ${res.errors.length} rows skipped` : ""),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadBusy(false);
    }
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

      <Tabs defaultValue="schedule-heads">
        <TabsList className="mb-8 w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="schedule-heads"
            className="rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Tariff Heads
          </TabsTrigger>
          <TabsTrigger
            value="matrix"
            className="rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <span className="flex items-center gap-2">
              Member Schedule
              {overrides && overrides.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{overrides.length} custom</span>
              )}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule-heads">

      {/* Per-member custom tariff upload */}
      <Card className="mb-8 p-5 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Per-member custom tariffs</h3>
            <p className="text-sm text-muted-foreground">
              Upload a sheet with Flat No., Name of Member and one amount column per tariff. Each column header
              becomes a tariff head (created automatically if new); rows match members by flat number or name.
              Enter 0 to exempt a member from a charge; leave blank to skip that head.
            </p>
            <p className="pt-1 font-mono text-[11px] text-muted-foreground">
              Flat No · Name of Member · Custom Tariff 1 · Custom Tariff 2 · Custom Tariff 3 …
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadMemberTariffTemplate(
                (tariffs ?? []).map((t) => t.name),
                (members ?? []).slice(0, 5).map((m) => ({ flatNo: m.flatNo, name: m.name })),
              )
            }
          >
            <Download className="size-4" /> Template
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runUpload(f);
              e.target.value = "";
            }}
          />
          <Button disabled={uploadBusy} onClick={() => inputRef.current?.click()} className="rounded-none">
            <Upload className="size-4" /> {uploadBusy ? "Uploading…" : "Upload Excel"}
          </Button>
          {lastUpload && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-foreground" />
              {lastUpload.inserted} added · {lastUpload.updated} updated
              {lastUpload.errors.length > 0 && ` · ${lastUpload.errors.length} row errors`}
            </span>
          )}
        </div>
        {lastUpload && lastUpload.errors.length > 0 && (
          <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-md bg-accent/50 p-3 text-xs text-muted-foreground">
            {lastUpload.errors.slice(0, 20).map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
      </Card>

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

        </TabsContent>

        <TabsContent value="matrix">
          <MemberTariffMatrix
            societyId={societyId}
            tariffs={(tariffs ?? []).filter((t) => t.isActive).sort((a, b) => a.name.localeCompare(b.name))}
            members={(members ?? []).filter((m) => m.isActive).sort((a, b) => (a.flatNo ?? a.code).localeCompare(b.flatNo ?? b.code))}
            overrides={overrides ?? []}
            setOverride={setOverride}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Member × tariff matrix (Tariff Schedule View)                       */
/* ------------------------------------------------------------------ */

function MemberTariffMatrix(props: {
  societyId: Id<"societies"> | null;
  tariffs: TariffRow[];
  members: MemberRow[];
  overrides: OverrideRow[];
  setOverride: (args: {
    societyId: Id<"societies">;
    memberId: Id<"members">;
    tariffId: Id<"tariffs">;
    amount?: number;
  }) => Promise<unknown>;
}) {
  const { tariffs, members, overrides, setOverride } = props;
  const [building, setBuilding] = useState("");
  const [wing, setWing] = useState("");
  const [unitType, setUnitType] = useState("");
  const [floor, setFloor] = useState("");
  const [filter, setFilter] = useState({ building: "", wing: "", unitType: "", floor: "" });
  // Draft values keyed by "memberId:tariffId" until Save.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const overrideFor = (memberId: string, tariffId: string) =>
    overrides.find((o) => o.memberId === memberId && o.tariffId === tariffId);

  const valueFor = (memberId: string, tariffId: string) => {
    const key = `${memberId}:${tariffId}`;
    if (key in draft) return draft[key];
    const o = overrideFor(memberId, tariffId);
    return o ? String(o.amount) : "";
  };

  const filtered = members.filter((m) => {
    if (filter.building && !(m.building ?? "").toLowerCase().includes(filter.building.toLowerCase())) return false;
    if (filter.wing && !(m.wing ?? "").toLowerCase().includes(filter.wing.toLowerCase())) return false;
    if (filter.unitType && !(m.unitType ?? "").toLowerCase().includes(filter.unitType.toLowerCase())) return false;
    if (filter.floor && !(m.floor ?? "").toLowerCase().includes(filter.floor.toLowerCase())) return false;
    return true;
  });

  const dirtyCount = Object.keys(draft).length;

  const saveAll = async () => {
    if (!props.societyId || dirtyCount === 0) return;
    setSaving(true);
    let appliedCount = 0;
    try {
      for (const [key, raw] of Object.entries(draft)) {
        const [memberId, tariffId] = key.split(":");
        const amount = raw.trim() === "" ? undefined : Number(raw);
        if (raw.trim() !== "" && (!Number.isFinite(amount) || (amount as number) < 0)) continue;
        const current = overrideFor(memberId, tariffId);
        const currentVal = current ? current.amount : undefined;
        const nextVal = raw.trim() === "" ? undefined : (amount as number);
        if (currentVal === nextVal) continue;
        await setOverride({
          societyId: props.societyId,
          memberId: memberId as Id<"members">,
          tariffId: tariffId as Id<"tariffs">,
          amount: nextVal,
        });
        appliedCount++;
      }
      if (appliedCount > 0) toast.success(`Saved ${appliedCount} custom amount(s)`);
      else toast.info("No changes to save");
      setDraft({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (tariffs.length === 0) {
    return (
      <EmptyHint>
        Add tariff heads on the Tariff Heads tab first — then each member's amounts can be set here.
      </EmptyHint>
    );
  }

  if (members.length === 0) {
    return <EmptyHint>Add members first — the schedule lists every active member with their amounts.</EmptyHint>;
  }

  return (
    <div>
      {/* Filter bar, matching the legacy Tariff Schedule View */}
      <div className="mb-6 grid gap-4 rounded-lg border p-5 sm:grid-cols-3 lg:grid-cols-5">
        <div className="space-y-2">
          <Label htmlFor="mx-building">Building</Label>
          <Input id="mx-building" value={building} onChange={(e) => setBuilding(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mx-wing">Wing</Label>
          <Input id="mx-wing" value={wing} onChange={(e) => setWing(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mx-utype">Unit type</Label>
          <Input id="mx-utype" value={unitType} onChange={(e) => setUnitType(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mx-floor">Floor</Label>
          <Input id="mx-floor" value={floor} onChange={(e) => setFloor(e.target.value)} />
        </div>
        <div className="flex items-end">
          <Button
            variant="outline"
            className="w-full rounded-none"
            onClick={() => setFilter({ building, wing, unitType, floor })}
          >
            Filter
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {filtered.length} member{filtered.length === 1 ? "" : "s"} · blank cells use the schedule amount · 0 exempts
          the member from that charge
        </p>
        <Button className="rounded-none" disabled={saving || dirtyCount === 0} onClick={saveAll}>
          <Save className="size-4" /> {saving ? "Saving…" : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky left-0 z-10 bg-background">Unit Code</TableHead>
              <TableHead className="text-right">Member</TableHead>
              <TableHead>Name</TableHead>
              {tariffs.map((t) => (
                <TableHead key={t._id} className="text-right">
                  <span className="block max-w-24 truncate" title={`${t.name} — schedule ${formatMoney(t.amount)}`}>
                    {t.name}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <TableRow key={m._id}>
                <TableCell className="sticky left-0 z-10 bg-background font-medium">
                  {m.flatNo || m.code}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{m.code.replace(/\D/g, "") || "—"}</TableCell>
                <TableCell className="max-w-48 truncate" title={m.name}>{m.name}</TableCell>
                {tariffs.map((t) => {
                  const key = `${m._id}:${t._id}`;
                  const o = overrideFor(m._id, t._id);
                  const isDirty = key in draft;
                  return (
                    <TableCell key={t._id} className="p-0">
                      <Input
                        value={valueFor(m._id, t._id)}
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                        placeholder={formatMoney(t.amount)}
                        inputMode="decimal"
                        className={`h-9 rounded-none border-0 border-l text-right tabular-nums focus-visible:ring-1 ${
                          isDirty ? "bg-accent/60" : o ? "bg-muted/60" : ""
                        }`}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Shaded cells carry custom amounts uploaded or edited for that member; edited-but-unsaved cells highlight while
        you type. Saving applies immediately to the next bill generation.
      </p>
    </div>
  );
}
