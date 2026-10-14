import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { formatDate, formatMoney, fyStartISO } from "@/lib/format";
import { CalendarRange, CheckCircle2, Lock, LockOpen, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type YearRow = {
  label: string;
  start: string;
  end: string;
  status: "open" | "closed";
  closedAt?: number | null;
  closedByName?: string | null;
  carriedTotals?: {
    accounts: number;
    members: number;
    memberDues: number;
    memberAdvance: number;
  } | null;
};

type ClosingAccount = { accountId: string; code: string; name: string; amount: number };
type ClosingMember = { memberId: string; code: string; name: string; flatNo: string; amount: number };

/** Default labels: "2026-27" style, aligned on the society's FY start month. */
function nextFyLabel(soc: { fyStartMonth: number }, afterLabel: string | null): string {
  const base = afterLabel ? Number(afterLabel.slice(0, 4)) : Number(fyStartISO(soc.fyStartMonth).slice(0, 4));
  const next = base + 1;
  return `${next}-${String((next + 1) % 100).padStart(2, "0")}`;
}

export default function YearEnd() {
  const { societyId, society } = useSociety();
  const overview = useQuery(
    api.yearEnd.overview,
    societyId ? { societyId } : "skip",
  ) as
    | {
        current: { label: string | null; start: string | null; fyStartMonth: number };
        years: YearRow[];
        rights: { canManage: boolean; mayPostClosed: boolean; mayCrossReports: boolean };
      }
    | undefined;

  const [createOpen, setCreateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const [closeLabel, setCloseLabel] = useState("");
  const [nextLabel, setNextLabel] = useState("");

  const createYear = useMutation(api.yearEnd.createYear);
  const transferBalance = useMutation(api.yearEnd.transferBalance);
  const reopenYear = useMutation(api.yearEnd.reopenYear);

  const rights = overview?.rights;
  const canManage = rights?.canManage ?? false;
  // Only owners/admins (or granted users) may see this page's actions; the
  // route guard already blocks others, so viewers landing here read-only.
  const years = overview?.years ?? [];
  const nextYear = useMemo(() => {
    // The label suggested in dialogs: the successor of the LATEST year label.
    const sorted = [...years].sort((a, b) => a.start.localeCompare(b.start));
    return nextFyLabel(society ?? { fyStartMonth: 4 }, sorted[sorted.length - 1]?.label ?? null);
  }, [years, society]);

  const openCreate = () => {
    const suggested = nextYear;
    const base = Number(suggested.slice(0, 4));
    setLabel(suggested);
    setStart(`${base}-${String(society?.fyStartMonth ?? 4).padStart(2, "0")}-01`);
    const endD = new Date(`${base + 1}-${String(society?.fyStartMonth ?? 4).padStart(2, "0")}-01T00:00:00Z`);
    endD.setUTCDate(endD.getUTCDate() - 1);
    setEnd(endD.toISOString().slice(0, 10));
    setCreateOpen(true);
  };

  const openTransfer = (y: YearRow) => {
    setCloseLabel(y.label);
    setNextLabel(() => {
      const sorted = [...years].sort((a, b) => a.start.localeCompare(b.start));
      const idx = sorted.findIndex((x) => x.label === y.label);
      const successor = idx >= 0 ? sorted[idx + 1]?.label : undefined;
      return successor ?? nextYear;
    });
    setTransferOpen(true);
  };

  if (!societyId || !overview) {
    return (
      <div>
        <PageHeader title="Year-End Process" description="Close the books year and carry balances forward." />
        <EmptyHint>Loading accounting years…</EmptyHint>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Year-End Process"
        description="Create the next accounting year, transfer closing balances into it and lock the closed year — entries in a closed year are refused unless you hold the Year-End right."
      />

      {!canManage && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Read-only view</AlertTitle>
          <AlertDescription>
            You can see the accounting years but cannot run the year-end process. Ask the admin
            to grant you the “Year-End Process” right in Users &amp; Rights.
          </AlertDescription>
        </Alert>
      )}

      {rights?.mayPostClosed && (
        <Alert>
          <LockOpen className="h-4 w-4" />
          <AlertTitle>Closed-year override active</AlertTitle>
          <AlertDescription>
            You may post vouchers, bills and receipts into closed accounting years — corrections
            land in the books with their original dates and the closed year's carried figures
            remain audited.
          </AlertDescription>
        </Alert>
      )}

      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2">
          <div className="text-sm font-semibold">Accounting years</div>
          {canManage && (
            <Button size="sm" onClick={openCreate} className="gap-2">
              <CalendarRange className="h-4 w-4" /> Create Year
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Carried (Dues / Advance)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyHint>
                    No accounting years registered yet. Create the current year, then create the
                    next one — Transfer Balance moves the closing balances across and closes the old year.
                  </EmptyHint>
                </TableCell>
              </TableRow>
            )}
            {years.map((y) => (
              <TableRow key={y.label}>
                <TableCell className="font-medium">{y.label}</TableCell>
                <TableCell>{formatDate(y.start)}</TableCell>
                <TableCell>{formatDate(y.end)}</TableCell>
                <TableCell>
                  {y.status === "closed" ? (
                    <Badge variant="secondary" className="gap-1">
                      <Lock className="h-3 w-3" /> Closed
                      {y.closedByName ? ` · ${y.closedByName}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Open
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {y.status === "closed" && y.carriedTotals
                    ? `${formatMoney(y.carriedTotals.memberDues)} / ${formatMoney(y.carriedTotals.memberAdvance)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {canManage && y.status === "open" && (
                    <Button size="sm" variant="outline" onClick={() => openTransfer(y)}>
                      Transfer Balance →
                    </Button>
                  )}
                  {canManage && y.status === "closed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-amber-700"
                      onClick={async () => {
                        try {
                          await reopenYear({ societyId, label: y.label });
                          toast.success(`${y.label} re-opened (status: open)`);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Could not re-open the year.");
                        }
                      }}
                    >
                      <LockOpen className="h-4 w-4" /> Re-open
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create-year dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Accounting Year</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-[120px_1fr] items-center gap-2">
              <Label htmlFor="yl">Year label</Label>
              <Input id="yl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027-28" />
            </div>
            <div className="grid grid-cols-[120px_1fr] items-center gap-2">
              <Label htmlFor="ys">Fin. Year from</Label>
              <Input id="ys" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid grid-cols-[120px_1fr] items-center gap-2">
              <Label htmlFor="ye">Fin. Year to</Label>
              <Input id="ye" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Exit
            </Button>
            <Button
              onClick={async () => {
                try {
                  await createYear({ societyId, label, start, end });
                  toast.success(`Accounting year ${label} created`);
                  setCreateOpen(false);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not create the year.");
                }
              }}
            >
              Create Year
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer-balance dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Balance — Close {closeLabel}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-[140px_1fr] items-center gap-2">
              <Label>Current Year</Label>
              <Input value={closeLabel} disabled />
            </div>
            <div className="grid grid-cols-[140px_1fr] items-center gap-2">
              <Label htmlFor="nl">Next A/c Year</Label>
              <Input id="nl" value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} placeholder="2027-28" />
            </div>
            <p className="text-xs text-muted-foreground">
              The next year must be registered (Create Year) and start the day after {closeLabel}{" "}
              ends. Transfer snapshots every ledger's and member's closing balance into the closed
              year (printed on the year-end statement) and moves the society's current books period
              to {nextLabel || "the next year"}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Exit
            </Button>
            <Button
              onClick={async () => {
                try {
                  const res = (await transferBalance({
                    societyId,
                    label: closeLabel,
                    nextLabel,
                  })) as { carriedAccounts: number; carriedMembers: number; memberDues: number; memberAdvance: number };
                  toast.success(
                    `${closeLabel} closed — ${res.carriedAccounts} ledger(s) and ${res.carriedMembers} member balance(s) carried to ${nextLabel}`,
                  );
                  setTransferOpen(false);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Transfer declined.");
                }
              }}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" /> Transfer Balance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
