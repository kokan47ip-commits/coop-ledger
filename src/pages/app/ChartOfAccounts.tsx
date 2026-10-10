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
import { exportExcel, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { diffChart, groupCodeFromLabel, parseChartWorkbook, type ChartDiff } from "@/lib/chartImport";
import { formatINR } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FolderOpen, ListChecks, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
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

/** Inline-editable fields for one row in bulk "Edit all" mode. */
type AccountDraft = {
  code: string;
  name: string;
  printNo: string;
  groupId: Id<"accountGroups"> | "";
  kind: string;
  opening: string;
};

const EMPTY_GROUP_FORM = {
  id: "" as Id<"accountGroups"> | "",
  code: "GA",
  name: "",
  type: "asset" as GroupRow["type"],
};

export default function ChartOfAccounts() {
  const { society, societyId, canEdit } = useSociety();
  const signatures = useCommitteeSignatures();
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as AccountRow[] | undefined;
  const groups = useQuery(
    api.accountGroups.list,
    societyId ? { societyId } : "skip",
  ) as GroupRow[] | undefined;

  const upsertAccount = useMutation(api.accounts.upsert);
  const bulkUpdateAccounts = useMutation(api.accounts.bulkUpdate);
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
  /** Bulk live-edit mode — every visible row turns into inline inputs. */
  const [editingAll, setEditingAll] = useState(false);
  const [drafts, setDrafts] = useState<Record<Id<"accounts">, AccountDraft>>({});
  const [bulkEditBusy, setBulkEditBusy] = useState(false);
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

  // ---- Import-back (edited chart-of-accounts.xlsx) ----
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ChartDiff | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const onImportFile = async (file: File) => {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(data, { type: "array" });
      const parsed = parseChartWorkbook(wb);
      // Edited/garbled section labels drop whole ledgers — never guess at a
      // partial read: refuse the import until the sheet is repaired.
      if (parsed.accountsSheet.skipped > 0) {
        toast.error(
          `${parsed.accountsSheet.skipped} row${parsed.accountsSheet.skipped > 1 ? "s" : ""} in the Accounts sheet could not be read (edited or missing Section label). Fix them in the workbook and re-upload.`,
        );
        return;
      }
      if (parsed.groupsSheet.skipped > 0) {
        toast.error(
          `${parsed.groupsSheet.skipped} row${parsed.groupsSheet.skipped > 1 ? "s" : ""} in the Groups sheet could not be read. Fix them and re-upload.`,
        );
        return;
      }
      if (parsed.accountsSheet.error && parsed.accountsSheet.accounts.length === 0) {
        toast.error(parsed.accountsSheet.error);
        return;
      }
      if (parsed.accountsSheet.accounts.length === 0) {
        toast.error("No account rows found in the workbook.");
        return;
      }
      const diff = diffChart(
        parsed.accountsSheet.accounts,
        parsed.groupsSheet.groups,
        {
          accounts: (accounts ?? []).map((a) => ({
            _id: a._id,
            code: a.code,
            name: a.name,
          })),
          groups: (groups ?? []).map((g) => ({
            _id: g._id,
            code: g.code,
            name: g.name,
          })),
        },
      );
      setImportPreview(diff);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the workbook.");
    }
  };

  const applyImport = async () => {
    if (!societyId || !importPreview) return;
    setImportBusy(true);
    try {
      let added = 0;
      let updated = 0;
      // New groups first so accounts can reference them.
      const newGroupIds = new Map<string, Id<"accountGroups">>();
      for (const gc of importPreview.groups) {
        const id = await upsertGroup({
          societyId,
          code: gc.group.code,
          name: gc.group.name,
          type: gc.group.section,
        });
        newGroupIds.set(gc.group.code.trim().toLowerCase(), id);
        added++;
      }
      // Group resolve: label leading code → existing group → freshly created.
      const resolveGroup = (label: string): Id<"accountGroups"> | undefined => {
        // Same splitter as diffChart: em-dash or hyphen-minus both resolve.
        const code = groupCodeFromLabel(label).toLowerCase();
        if (!code) return undefined;
        const existing = (groups ?? []).find(
          (g) => (g.code ?? "").trim().toLowerCase() === code,
        );
        if (existing) return existing._id;
        return newGroupIds.get(code);
      };
      for (const change of importPreview.accounts) {
        const a = change.account;
        await upsertAccount({
          societyId,
          id: change.kind === "update" ? change.id : undefined,
          code: a.code,
          name: a.name || a.code,
          type: a.section,
          kind: a.kind,
          openingBalance: a.openingBalance,
          groupId: resolveGroup(a.group),
          printNo: a.printNo || undefined,
        });
        if (change.kind === "update") updated++;
        else added++;
      }
      // Deletions last: remove what the sheet no longer carries. A ledger
      // still used by vouchers/bills refuses its own deletion server-side;
      // that row is reported, and the rest of the import stays applied.
      let deleted = 0;
      const undeletable: string[] = [];
      for (const d of importPreview.deletions.accounts) {
        try {
          await removeAccount({ societyId, id: d.id });
          deleted++;
        } catch {
          undeletable.push(`${d.code} — ${d.name}`);
        }
      }
      if (undeletable.length > 0) {
        toast.warning(
          `${undeletable.length} deleted in the sheet but still used by vouchers, bills or tariffs — kept: ${undeletable.join(", ")}`,
        );
      }
      toast.success(
        `Import applied — ${added} added, ${updated} updated, ${deleted} deleted`,
      );
      setImportPreview(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

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

  /** Letterhead for the exported Excel workbook (mirrors the report pages). */
  const exportMeta = (): ExportMeta | null =>
    society
      ? {
          societyName: society.name,
          societyAddress: [society.address, society.city, society.state, society.pincode]
            .filter(Boolean)
            .join(", "),
          registrationNo: society.registrationNo,
          title: "Chart of Accounts",
          signatures,
        }
      : null;

  const exportChart = () => {
    const meta = exportMeta();
    if (!meta) return;
    const list = [...(accounts ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    const grpName = new Map((groups ?? []).map((g) => [g._id, `${g.code} — ${g.name}`]));
    const accountsTable: TableSpec = {
      sectionTitle: "Accounts",
      head: ["Code", "Account", "Section", "Group", "Role", "Opening (₹)", "Print No."],
      body: list.map((a) => [
        a.code,
        a.name,
        SECTIONS.find((s) => s.type === a.type)?.label ?? a.type,
        a.groupId ? grpName.get(a.groupId) ?? "—" : "—",
        a.kind === "bank_cash" ? "Bank / Cash" : a.kind === "receivable" ? "Receivable control" : "",
        a.openingBalance,
        a.printNo ?? "",
      ]),
      foot: [
        [
          "",
          `TOTAL — ${list.length} account${list.length === 1 ? "" : "s"}`,
          "",
          "",
          "",
          list.reduce((s, a) => s + a.openingBalance, 0),
          "",
        ],
      ],
      columnStyles: {
        5: { halign: "right" },
        6: { halign: "center" },
      },
    };
    const groupsTable: TableSpec = {
      sectionTitle: "Groups",
      head: ["Code", "Group", "Section", "Accounts"],
      body: [...(groups ?? [])]
        .sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name))
        .map((g) => [
          g.code,
          g.name,
          SECTIONS.find((s) => s.type === g.type)?.label ?? g.type,
          accountsOf(g._id).length,
        ]),
      foot: [["", `TOTAL — ${(groups ?? []).length}${(groups ?? []).length === 1 ? " group" : " groups"}`, "", ""]],
    };
    exportExcel(meta, [accountsTable, groupsTable], "chart-of-accounts.xlsx");
  };

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

  // ---- Bulk live-edit ("Edit all" → inline inputs → Save) ----
  const startEditAll = () => {
    const next: Record<Id<"accounts">, AccountDraft> = {};
    for (const g of visibleSections) {
      for (const row of g.rows) {
        next[row._id] = {
          code: row.code,
          name: row.name,
          printNo: row.printNo ?? "",
          groupId: row.groupId ?? "",
          kind: row.kind ?? "none",
          opening: String(row.openingBalance),
        };
      }
    }
    setDrafts(next);
    setEditingAll(true);
  };

  const cancelEditAll = () => {
    setEditingAll(false);
    setDrafts({});
  };

  const patchDraft = (id: Id<"accounts">, patch: Partial<AccountDraft>) =>
    setDrafts((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, ...patch } } : prev));

  const saveEditAll = async () => {
    if (!societyId) return;
    const updates = Object.entries(drafts).map(([id, d]) => ({
      id: id as Id<"accounts">,
      code: d.code.trim(),
      name: d.name.trim(),
      openingBalance: Number(d.opening) || 0,
      groupId: d.groupId || undefined,
      kind: d.kind === "none" ? undefined : (d.kind as "bank_cash" | "receivable"),
      printNo: d.printNo.trim() || undefined,
    }));
    const blank = updates.find((u) => !u.code || !u.name);
    if (blank) {
      toast.error("Every row needs both a Code and an Account name.");
      return;
    }
    setBulkEditBusy(true);
    try {
      const res = await bulkUpdateAccounts({ societyId, updates });
      toast.success(
        res.updated === 0
          ? "Nothing changed — all rows were already up to date."
          : `Saved — ${res.updated} ledger${res.updated > 1 ? "s" : ""} updated`,
      );
      setEditingAll(false);
      setDrafts({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save the chart");
    } finally {
      setBulkEditBusy(false);
    }
  };

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
          <>
            <span
              className="hidden items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:inline-flex"
              title="Live chart size — accounts and groups currently defined"
            >
              <span className="tabular-nums">
                <strong className="font-semibold text-foreground">{(accounts ?? []).length}</strong>{" "}
                account{(accounts ?? []).length === 1 ? "" : "s"}
              </span>
              <span className="text-border">|</span>
              <span className="tabular-nums">
                <strong className="font-semibold text-foreground">{(groups ?? []).length}</strong>{" "}
                group{(groups ?? []).length === 1 ? "" : "s"}
              </span>
            </span>
            <Button variant="outline" className="rounded-lg" onClick={exportChart} disabled={!society || (accounts ?? []).length === 0}>
              <Download className="size-4" /> Export Excel
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="rounded-lg"
              disabled={!canEdit}
              onClick={() => importInputRef.current?.click()}
              title="Edit the exported chart-of-accounts.xlsx and upload it back here"
            >
              <Upload className="size-4" /> Import Excel
            </Button>
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
          </>
        }
      />

      <Tabs defaultValue="accounts" onValueChange={() => { cancelEditAll(); deselectAll(); }}>
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
                  cancelEditAll();
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
                cancelEditAll();
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
                    {editingAll ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-lg"
                          onClick={cancelEditAll}
                          disabled={bulkEditBusy}
                        >
                          <X className="size-4" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="rounded-lg"
                          onClick={() => void saveEditAll()}
                          disabled={bulkEditBusy}
                        >
                          <Save className="size-4" /> {bulkEditBusy ? "Saving…" : "Save all"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        disabled={!canEdit || visibleSections.every((g) => g.rows.length === 0)}
                        onClick={startEditAll}
                        title="Edit code, account, print no., group, role and opening balance for every visible row inline"
                      >
                        <Pencil className="size-4" /> Edit all
                      </Button>
                    )}
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
                          {g.rows.map((a) => {
                            const d = editingAll ? drafts[a._id] : undefined;
                            const groupOptions = (groups ?? []).filter((grp) => grp.type === a.type);
                            return (
                            <TableRow key={a._id} className={d ? "bg-muted/30" : undefined}>
                              <TableCell>
                                <Checkbox
                                  checked={selected.has(a._id)}
                                  onCheckedChange={(v) => toggleRow(a._id, v === true)}
                                  aria-label={`Select ${a.name}`}
                                  disabled={!!d}
                                />
                              </TableCell>
                              {d ? (
                                <>
                                  <TableCell>
                                    <Input
                                      className="h-8 font-mono text-xs"
                                      value={d.code}
                                      aria-label={`Code for ${a.name}`}
                                      onChange={(e) => patchDraft(a._id, { code: e.target.value })}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      className="h-8 text-sm"
                                      value={d.name}
                                      aria-label={`Account name for ${a.name}`}
                                      onChange={(e) => patchDraft(a._id, { name: e.target.value })}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      className="h-8 font-mono text-xs"
                                      value={d.printNo}
                                      aria-label={`Print No. for ${a.name}`}
                                      title="Printing serial no. — order on printed statements"
                                      onChange={(e) => patchDraft(a._id, { printNo: e.target.value })}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Select
                                      value={d.groupId || "none"}
                                      onValueChange={(v) => patchDraft(a._id, { groupId: v === "none" ? "" : (v as Id<"accountGroups">) })}
                                    >
                                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No group" /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">No group</SelectItem>
                                        {groupOptions.map((grp) => (
                                          <SelectItem key={grp._id} value={grp._id}>{grp.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>
                                    <Select
                                      value={d.kind}
                                      onValueChange={(v) => patchDraft(a._id, { kind: v })}
                                    >
                                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">General</SelectItem>
                                        <SelectItem value="bank_cash">Bank / Cash</SelectItem>
                                        <SelectItem value="receivable">Members Receivable</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      className="h-8 text-right text-sm tabular-nums"
                                      type="number"
                                      step="0.01"
                                      value={d.opening}
                                      aria-label={`Opening balance for ${a.name}`}
                                      onChange={(e) => patchDraft(a._id, { opening: e.target.value })}
                                    />
                                  </TableCell>
                                  <TableCell />
                                </>
                              ) : (
                                <>
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
                                </>
                              )}
                            </TableRow>
                            );
                          })}
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

      {/* Import-back preview — nothing is written until the office confirms. */}
      <Dialog open={importPreview !== null} onOpenChange={(o) => { if (!o) setImportPreview(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review chart import</DialogTitle>
          </DialogHeader>
          {importPreview && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs tabular-nums">
                  <strong className="text-foreground">
                    {importPreview.accounts.filter((c) => c.kind === "add").length + importPreview.groups.length}
                  </strong>{" "}
                  new (accounts + groups)
                </span>
                <span className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs tabular-nums">
                  <strong className="text-foreground">
                    {importPreview.accounts.filter((c) => c.kind === "update").length}
                  </strong>{" "}
                  existing lеdgеrs updated
                </span>
              </div>
              {importPreview.warnings.map((w) => (
                <p key={w} className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
                  {w}
                </p>
              ))}
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-16">Change</TableHead>
                      <TableHead className="w-20">Code</TableHead>
                      <TableHead>Account / Group</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.groups.map((gc) => (
                      <TableRow key={`g-${gc.group.code}`}>
                        <TableCell className="text-xs font-medium text-emerald-700 dark:text-emerald-400">New group</TableCell>
                        <TableCell className="font-mono text-xs">{gc.group.code}</TableCell>
                        <TableCell>{gc.group.name}</TableCell>
                      </TableRow>
                    ))}
                    {importPreview.accounts.map((c, i) => (
                      <TableRow key={`a-${c.account.code}-${i}`}>
                        <TableCell className={`text-xs font-medium ${c.kind === "add" ? "text-emerald-700 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400"}`}>
                          {c.kind === "add" ? "New" : "Update"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.account.code}</TableCell>
                        <TableCell>
                          {c.account.name}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({c.kind === "add" ? "added" : "replaces the ledger with sheet values"})
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {importPreview.deletions.accounts.map((d) => (
                      <TableRow key={`d-${d.code}`} className="bg-rose-50/50 dark:bg-rose-950/20">
                        <TableCell className="text-xs font-semibold text-rose-700 dark:text-rose-400">Delete</TableCell>
                        <TableCell className="font-mono text-xs">{d.code}</TableCell>
                        <TableCell>
                          {d.name}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            (removed from the sheet — ledger will be deleted)
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {importPreview.deletions.groups.map((d) => (
                      <TableRow key={`dg-${d.code}`} className="bg-rose-50/50 dark:bg-rose-950/20">
                        <TableCell className="text-xs font-semibold text-rose-700 dark:text-rose-400">Delete group</TableCell>
                        <TableCell className="font-mono text-xs">{d.code}</TableCell>
                        <TableCell>
                          {d.name}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            (no longer in the Groups sheet and not used by any account)
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Updates replace the ledger's name, section, group, role, opening balance and print number with the sheet's values.{" "}
                {importPreview.deletions.accounts.length + importPreview.deletions.groups.length > 0 && (
                  <span className="font-medium text-rose-700 dark:text-rose-400">
                    Rows marked Delete are ledgers/groups no longer present in the sheet — they will be removed from the book when you apply.
                  </span>
                )}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportPreview(null)} disabled={importBusy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void applyImport()} disabled={importBusy}>
              {importBusy ? "Applying…" : "Apply import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
