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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { formatINR } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { FolderOpen, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type AccountRow = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  kind?: "bank_cash" | "receivable";
  openingBalance: number;
  groupId?: Id<"accountGroups">;
  /** User-defined printing serial no. — order on printed statements. */
  printNo?: string;
};

type GroupRow = {
  _id: Id<"accountGroups">;
  code: string;
  name: string;
  type: "asset" | "liability" | "income" | "expense";
  sequence: number;
};

const TYPES = [
  { type: "asset", label: "Assets" },
  { type: "liability", label: "Liabilities & Funds" },
  { type: "income", label: "Income" },
  { type: "expense", label: "Expenses" },
] as const;

/** Selectable statement sections — one at a time in the Chart of Accounts. */
const SECTIONS = TYPES;

const EMPTY_GROUP_FORM = {
  id: "" as Id<"accountGroups"> | "",
  code: "GA",
  name: "",
  type: "asset" as GroupRow["type"],
};

export default function ChartOfAccounts() {
  const { societyId, canEdit } = useSociety();
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as AccountRow[] | undefined;
  const groups = useQuery(
    api.accountGroups.list,
    societyId ? { societyId } : "skip",
  ) as GroupRow[] | undefined;

  const upsertAccount = useMutation(api.accounts.upsert);
  const removeAccount = useMutation(api.accounts.remove);
  const upsertGroup = useMutation(api.accountGroups.upsert);
  const removeGroup = useMutation(api.accountGroups.remove);
  const seedGroups = useMutation(api.accountGroups.seedDefaults);
  const ensureSystem = useMutation(api.accounts.ensureSystem);

  const [open, setOpen] = useState(false);
  /** Section selector — ONE of Assets / Liabilities & Funds / Income / Expenses at a time. */
  const [section, setSection] = useState<(typeof SECTIONS)[number]["type"] | null>(null);
  /** Row selection for bulk actions (Select all / Deselect all). */
  const [selected, setSelected] = useState<Set<Id<"accounts">>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkGroupId, setBulkGroupId] = useState<Id<"accountGroups"> | "">("");
  const [form, setForm] = useState({
    id: "" as Id<"accounts"> | "",
    code: "",
    name: "",
    type: "expense" as AccountRow["type"],
    kind: "none",
    openingBalance: "0",
    groupId: "" as Id<"accountGroups"> | "",
    printNo: "",
  });
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);

  // Create the system Form N ledgers (Dues from Members, Advance from
  // Members, Income over Expenses) once per society. Idempotent.
  useEffect(() => {
    if (!societyId || !canEdit) return;
    ensureSystem({ societyId }).catch(() => {
      // Non-fatal: the statements still work without the ledgers.
    });
  }, [societyId, canEdit, ensureSystem]);

  const groupName = (id?: Id<"accountGroups">) =>
    id ? groups?.find((g) => g._id === id)?.name ?? "—" : "—";

  const accountsOf = (groupId: Id<"accountGroups">) =>
    (accounts ?? []).filter((a) => a.groupId === groupId);

  const grouped = useMemo(() => {
    const list = [...(accounts ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    return TYPES.map((g) => ({
      ...g,
      rows: list.filter((a) => a.type === g.type),
    }));
  }, [accounts]);

  /** Sections visible in the current view — the ONE active section when set, else all. */
  const visibleSections = useMemo(
    () => (section ? grouped.filter((g) => g.type === section) : grouped),
    [section, grouped],
  );

  const toggleRow = (id: Id<"accounts">, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const selectAll = () =>
    setSelected(
      new Set(visibleSections.flatMap((g) => g.rows.map((r) => r._id))),
    );

  const deselectAll = () => setSelected(new Set());

  const bulkAssign = async () => {
    if (!societyId || bulkGroupId === "") return;
    const group = groups?.find((g) => g._id === bulkGroupId);
    if (!group) return;
    try {
      for (const id of selected) {
        const a = (accounts ?? []).find((row) => row._id === id);
        if (!a || a.type !== group.type) {
          toast.error(
            `Group "${group.name}" belongs to ${
              SECTIONS.find((s) => s.type === group.type)?.label
            } — only matching accounts can use it.`,
          );
          return;
        }
        await upsertAccount({
          societyId,
          id: a._id,
          code: a.code,
          name: a.name,
          type: a.type,
          kind: a.kind,
          openingBalance: a.openingBalance,
          groupId: group._id,
          printNo: a.printNo,
        });
      }
      toast.success(
        `${selected.size} account${selected.size > 1 ? "s" : ""} filed under ${group.name}`,
      );
      setBulkOpen(false);
      setBulkGroupId("");
      deselectAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign group");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    try {
      await upsertAccount({
        societyId,
        id: form.id || undefined,
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        kind: form.kind === "none" ? undefined : (form.kind as "bank_cash" | "receivable"),
        openingBalance: Number(form.openingBalance) || 0,
        groupId: form.groupId || undefined,
        printNo: form.printNo.trim() || undefined,
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
      await removeAccount({ societyId, id: a._id });
      toast.success("Account deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const saveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    try {
      await upsertGroup({
        societyId,
        id: groupForm.id || undefined,
        code: groupForm.code.trim(),
        name: groupForm.name.trim(),
        type: groupForm.type,
      });
      toast.success(groupForm.id ? "Group updated" : "Group added");
      setGroupOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save group");
    }
  };

  const delGroup = async (g: GroupRow) => {
    if (!societyId) return;
    const count = accountsOf(g._id).length;
    if (!confirm(`Delete group ${g.name}?`)) return;
    try {
      await removeGroup({ societyId, id: g._id });
      toast.success("Group deleted");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? count > 0
            ? `${err.message} (${count} account${count > 1 ? "s" : ""} use it.)`
            : err.message
          : "Failed to delete",
      );
    }
  };

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        description="Ledger heads used by tariffs, vouchers and reports. Opening balances set the starting position for the current financial year."
        actions={
          <Button
            className="rounded-lg"
            disabled={!canEdit}
            onClick={() => {
              setForm({
                id: "",
                code: "",
                name: "",
                type: section ?? "expense",
                kind: "none",
                openingBalance: "0",
                groupId: "",
                printNo: "",
              });
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Add account
          </Button>
        }
      />

      <Tabs defaultValue="accounts" onValueChange={() => deselectAll()}>
        <TabsList className="rounded-lg">
          <TabsTrigger value="accounts" className="rounded-lg">Accounts</TabsTrigger>
          <TabsTrigger value="groups" className="rounded-lg">
            Groups
            {groups && groups.length > 0 && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{groups.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Section picker — pick ONE at a time (or let the chips follow All). */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {SECTIONS.map((s) => {
            const active = section === s.type;
            const count = (accounts ?? []).filter((a) => a.type === s.type).length;
            return (
              <button
                key={s.type}
                type="button"
                onClick={() => {
                  setSection(active ? null : s.type);
                  deselectAll();
                }}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {s.label}
                <span className={`ml-1.5 tabular-nums ${active ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
          {section && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full text-xs text-muted-foreground"
              onClick={() => {
                setSection(null);
                deselectAll();
              }}
            >
              Clear section (×)
            </Button>
          )}
        </div>

        <TabsContent value="accounts" className="mt-6">
          {!accounts ? null : accounts.length === 0 ? (
            <EmptyHint>No accounts. Add ledger heads or recreate the society profile.</EmptyHint>
          ) : (
            <div className="space-y-8">
              {visibleSections.some((g) => g.rows.length > 0) && (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
                  <span className="text-sm text-muted-foreground">
                    {selected.size === 0
                      ? `Showing ${section ? SECTIONS.find((s) => s.type === section)?.label : "all sections"} — select accounts for a bulk action`
                      : `${selected.size} selected`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={visibleSections.every((g) => g.rows.length === 0) || selected.size ===
                        visibleSections.reduce((s, g) => s + g.rows.length, 0)}
                      onClick={selectAll}
                    >
                      <ListChecks className="size-4" /> Select all
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={selected.size === 0}
                      onClick={deselectAll}
                    >
                      Deselect all
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={!canEdit || selected.size === 0}
                      onClick={() => setBulkOpen(true)}
                    >
                      Assign group…
                    </Button>
                  </div>
                </div>
              )}
              {visibleSections.map((g) =>
                g.rows.length === 0 ? null : (
                  <section key={g.type}>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {g.label} · <span className="tabular-nums">{g.rows.length}</span>
                    </h3>
                    <div className="panel">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-10"></TableHead>
                            <TableHead className="w-24">Code</TableHead>
                            <TableHead>Account</TableHead>
                            <TableHead className="w-20">Print No.</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="text-right">Opening</TableHead>
                            <TableHead className="w-20 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.rows.map((a) => (
                            <TableRow key={a._id}>
                              <TableCell>
                                <Checkbox
                                  checked={selected.has(a._id)}
                                  onCheckedChange={(v) => toggleRow(a._id, v === true)}
                                  aria-label={`Select ${a.name}`}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{a.code}</TableCell>
                              <TableCell className="font-medium">{a.name}</TableCell>
                              <TableCell className="font-mono text-xs">{a.printNo || "—"}</TableCell>
                              <TableCell className="text-muted-foreground">{groupName(a.groupId)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {a.kind === "bank_cash" ? "Bank / Cash" : a.kind === "receivable" ? "Receivable control" : "—"}
                              </TableCell>
                              <TableCell className="text-right"><RightMoney value={a.openingBalance} /></TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {canEdit && (
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
                                        groupId: a.groupId ?? "",
                                        printNo: a.printNo ?? "",
                                      });
                                      setOpen(true);
                                    }}
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                  )}
                                  {canEdit && (
                                  <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(a)}>
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                  )}
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
        </TabsContent>

        <TabsContent value="groups" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Classification heads that organise accounts on the Balance Sheet and Income & Expenditure.
              {section && (
                <>
                  {' '}Showing the{' '}
                  <strong className="font-medium text-foreground">
                    {SECTIONS.find((s) => s.type === section)?.label}
                  </strong>{' '}
                  section only.
                </>
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit}
              onClick={() => {
                setGroupForm({
                  ...EMPTY_GROUP_FORM,
                  type: section ?? EMPTY_GROUP_FORM.type,
                });
                setGroupOpen(true);
              }}
            >
              <Plus className="size-4" /> Add group
            </Button>
          </div>

          {!groups ? null : groups.length === 0 ? (
            <EmptyHint>
              No groups yet.{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={async () => {
                  if (!societyId) return;
                  try {
                    await seedGroups({ societyId });
                    toast.success("Standard groups added");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to add groups");
                  }
                }}
              >
                Add the standard groups
              </button>{' '}
              (Current Assets, Reserve & Surplus, Indirect Expenses and more), or create your own.
            </EmptyHint>
          ) : (
            <div className="space-y-8">
              {(section ? TYPES.filter((t) => t.type === section) : TYPES).map((t) => {
                const rows = groups.filter((g) => g.type === t.type);
                if (rows.length === 0) return null;
                return (
                  <section key={t.type}>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {t.label} · <span className="tabular-nums">{rows.length}</span>
                    </h3>
                    <div className="panel">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-24">Code</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead className="text-right">Accounts</TableHead>
                            <TableHead className="w-20 text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((g) => {
                            const children = accountsOf(g._id);
                            return (
                              <TableRow key={g._id}>
                                <TableCell className="font-mono text-xs">{g.code}</TableCell>
                                <TableCell className="font-medium">{g.name}</TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {children.length === 0 ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs">
                                      <FolderOpen className="size-3.5" /> none
                                    </span>
                                  ) : (
                                    <span title={children.map((a) => a.name).join(", ")}>
                                      {children.length}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {canEdit && (
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8"
                                      onClick={() => {
                                        setGroupForm({
                                          id: g._id,
                                          code: g.code,
                                          name: g.name,
                                          type: g.type,
                                        });
                                        setGroupOpen(true);
                                      }}
                                    >
                                      <Pencil className="size-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => delGroup(g)}>
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Bulk group-assignment dialog (filled from Select all / row checkboxes) */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign group to {selected.size} account{selected.size > 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          {(() => {
            // The selected rows must all share one statement section for a
            // single group to be valid — decode it from the current panel.
            const rowsByType = visibleSections.flatMap((g) => g.rows);
            const typesOfSelected = new Set(
              rowsByType.filter((a) => selected.has(a._id)).map((a) => a.type),
            );
            const common = typesOfSelected.size === 1 ? [...typesOfSelected][0] : null;
            const options = common ? (groups ?? []).filter((g) => g.type === common) : [];
            return (
              <div className="space-y-3">
                <Select value={bulkGroupId} onValueChange={(v) => setBulkGroupId(v as Id<"accountGroups">)}>
                  <SelectTrigger><SelectValue placeholder="Choose a group" /></SelectTrigger>
                  <SelectContent>
                    {options.map((g) => (
                      <SelectItem key={g._id} value={g._id}>
                        {g.name} ({g.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {common ? (
                  options.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No {SECTIONS.find((s) => s.type === common)?.label.toLowerCase()} groups yet —
                      create one on the Groups tab first.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The selection spans more than one statement section — filter to one section
                    (or pick accounts of one type) to assign a group.
                  </p>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={bulkGroupId === "" || !bulkOpen}
              onClick={bulkAssign}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account dialog */}
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
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as AccountRow["type"], groupId: "" })}>
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
                <Label>Group</Label>
                <Select
                  value={form.groupId || "none"}
                  onValueChange={(v) => setForm({ ...form, groupId: v === "none" ? "" : (v as Id<"accountGroups">) })}
                  disabled={groups?.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No group</SelectItem>
                    {(groups ?? [])
                      .filter((g) => g.type === form.type)
                      .map((g) => (
                        <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                      ))}
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
              <div className="space-y-2">
                <Label htmlFor="a-open">Opening balance (₹)</Label>
                <Input id="a-open" type="number" step="0.01" value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-print">Print No.</Label>
                <Input id="a-print" value={form.printNo}
                  onChange={(e) => setForm({ ...form, printNo: e.target.value })}
                  placeholder="1" title="Printing serial no. — order of this ledger on printed statements (I&E, Balance Sheet, Receipts & Payments)" />
              </div>
            </div>
            {groups?.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Tip: create groups on the Groups tab to classify accounts for statement presentation.
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Group dialog */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{groupForm.id ? "Edit group" : "Add group"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveGroup} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="g-code">Code *</Label>
                <Input id="g-code" required value={groupForm.code}
                  onChange={(e) => setGroupForm({ ...groupForm, code: e.target.value })} placeholder="GA" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="g-name">Name *</Label>
                <Input id="g-name" required value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="Fixed Assets" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Statement section</Label>
                <Select value={groupForm.type} onValueChange={(v) => setGroupForm({ ...groupForm, type: v as GroupRow["type"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Assets</SelectItem>
                    <SelectItem value="liability">Liabilities & Funds</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expenses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGroupOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
