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
import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
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
  groupId?: Id<"accountGroups">;
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

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: "" as Id<"accounts"> | "",
    code: "",
    name: "",
    type: "expense" as AccountRow["type"],
    kind: "none",
    openingBalance: "0",
    groupId: "" as Id<"accountGroups"> | "",
  });
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);

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
              setForm({ id: "", code: "", name: "", type: "expense", kind: "none", openingBalance: "0", groupId: "" });
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Add account
          </Button>
        }
      />

      <Tabs defaultValue="accounts">
        <TabsList className="rounded-lg">
          <TabsTrigger value="accounts" className="rounded-lg">Accounts</TabsTrigger>
          <TabsTrigger value="groups" className="rounded-lg">
            Groups
            {groups && groups.length > 0 && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{groups.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-6">
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
                            <TableHead>Group</TableHead>
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
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit}
              onClick={() => {
                setGroupForm(EMPTY_GROUP_FORM);
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
              {TYPES.map((t) => {
                const rows = groups.filter((g) => g.type === t.type);
                if (rows.length === 0) return null;
                return (
                  <section key={t.type}>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {t.label} · <span className="tabular-nums">{rows.length}</span>
                    </h3>
                    <div className="rounded-lg border">
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
