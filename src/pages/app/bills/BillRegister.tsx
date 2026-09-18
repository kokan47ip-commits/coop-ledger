import { Badge } from "@/components/ui/badge";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { currentPeriod, formatDate, formatINR, formatPeriod, todayISO } from "@/lib/format";
import { Download, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Bill = Doc<"bills">;
type Member = Doc<"members">;

export default function BillRegister() {
  const { societyId, society } = useSociety();
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const tariffs = useQuery(api.tariffs.list, societyId ? { societyId } : "skip");
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip");
  const generate = useMutation(api.bills.generate);
  const removeBill = useMutation(api.bills.remove);

  const [period, setPeriod] = useState(currentPeriod());
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  const [generating, setGenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const memberName = (id: Id<"members">) =>
    members?.find((m) => m._id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const list = [...(bills ?? [])].sort(
      (a, b) =>
        b.period.localeCompare(a.period) || b.billNo.localeCompare(a.billNo),
    );
    if (statusFilter === "all") return list;
    return list.filter((b) => b.status === statusFilter);
  }, [bills, statusFilter]);

  const totals = useMemo(() => {
    const list = bills ?? [];
    return {
      count: list.length,
      billed: list.reduce((s, b) => s + b.total, 0),
      collected: list.reduce((s, b) => s + b.paidAmount, 0),
      outstanding: list.reduce((s, b) => s + (b.total - b.paidAmount), 0),
    };
  }, [bills]);

  const meta: ExportMeta | null =
    society && bills
      ? {
          societyName: society.name,
          societyAddress: [society.address, society.city, society.state, society.pincode]
            .filter(Boolean)
            .join(", "),
          registrationNo: society.registrationNo,
          title: "Bill Register",
          subtitle:
            statusFilter === "all"
              ? `All bills · ${filtered.length} entries`
              : `${statusFilter} bills · ${filtered.length} entries`,
        }
      : null;

  const buildTable = (): TableSpec => ({
    head: ["Bill No", "Date", "Member", "Flat", "Period", "Amount", "Paid", "Balance", "Status"],
    body: filtered.map((b) => {
      const m = members?.find((x) => x._id === b.memberId);
      return [
        b.billNo,
        formatDate(b.issueDate),
        m?.name ?? "—",
        [m?.wing, m?.flatNo].filter(Boolean).join("-"),
        formatPeriod(b.period),
        b.total,
        b.paidAmount,
        b.total - b.paidAmount,
        b.status.toUpperCase(),
      ];
    }),
    foot: [["", "", "", "", "TOTAL", totals.billed, totals.collected, totals.outstanding, ""]],
    columnStyles: {
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
    },
  });

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "bill-register.pdf");
    else if (kind === "word") exportWord(meta, [table], "bill-register.doc");
    else printTables(meta, [table]);
  };

  const doGenerate = async () => {
    if (!societyId || !members) return;
    const activeMembers = members.filter((m) => m.isActive);
    if (activeMembers.length === 0) {
      toast.error("Add active members first.");
      return;
    }
    setGenerating(true);
    try {
      const res = await generate({
        societyId,
        period,
        issueDate,
        dueDate,
        memberIds: activeMembers.map((m) => m._id),
      });
      toast.success(
        `Generated ${res.created} bill(s)` +
          (res.skipped > 0 ? ` · ${res.skipped} skipped (already exist or inactive)` : ""),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate bills");
    } finally {
      setGenerating(false);
    }
  };

  const del = async (b: Bill) => {
    if (!societyId) return;
    if (!confirm(`Delete bill ${b.billNo}?`)) return;
    try {
      await removeBill({ societyId, id: b._id });
      toast.success("Bill deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const receivableMissing =
    society && !society.receivableAccountId &&
    (accounts ?? []).some((a) => a.kind === "receivable");

  return (
    <div>
      <PageHeader
        title="Bill Register"
        description="Monthly maintenance bills generated from the tariff schedule, with collection status."
      />

      {receivableMissing && (
        <Card className="mb-6 border-dashed p-4 text-sm text-muted-foreground">
          Tip: set the <span className="font-medium text-foreground">Members Receivable</span> account in{" "}
          <Link to="/app/society" className="underline">Society Profile</Link> so bills post correctly to the books.
        </Card>
      )}

      {/* Generate box */}
      <div className="mb-8 rounded-lg border p-5">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Generate bills</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="b-period">Period</Label>
            <Input id="b-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-issue">Issue date</Label>
            <Input id="b-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-due">Due date</Label>
            <Input id="b-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={doGenerate} disabled={generating || (tariffs ?? []).filter((t) => t.isActive).length === 0} className="w-full rounded-none">
              {generating ? "Generating…" : "Generate for all active members"}
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bills</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{totals.count}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Billed</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(totals.billed)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Collected</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(totals.collected)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(totals.outstanding)}</p>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="partial">Partially paid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => doExport("pdf")}>
            <Download className="size-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("word")}>
            <FileText className="size-4" /> Word
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("print")}>
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      {!bills ? null : filtered.length === 0 ? (
        <EmptyHint>No bills{statusFilter !== "all" ? " in this status" : " yet"}. Generate bills above.</EmptyHint>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Bill No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b._id}>
                  <TableCell className="font-medium">
                    <Link to={`/app/bills/${b._id}`} className="hover:underline">
                      {b.billNo}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(b.issueDate)}</TableCell>
                  <TableCell>{memberName(b.memberId)}</TableCell>
                  <TableCell>{formatPeriod(b.period)}</TableCell>
                  <TableCell className="text-right"><RightMoney value={b.total} /></TableCell>
                  <TableCell className="text-right"><RightMoney value={b.total - b.paidAmount} /></TableCell>
                  <TableCell>
                    <Badge
                      variant={b.status === "paid" ? "secondary" : b.status === "partial" ? "outline" : "destructive"}
                      className={b.status === "unpaid" ? "bg-transparent text-muted-foreground border" : undefined}
                    >
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" asChild>
                        <Link to={`/app/bills/${b._id}`} title="View bill">
                          <FileText className="size-3.5" />
                        </Link>
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(b)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
