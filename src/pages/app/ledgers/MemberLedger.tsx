import { Badge } from "@/components/ui/badge";
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
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatINR, formatPeriod } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "convex/react";

type Member = Doc<"members">;
type Bill = Doc<"bills">;
type LedgerRow = {
  date: string;
  voucherNo: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
  note?: string;
};

export default function MemberLedger() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;

  const [searchParams] = useSearchParams();
  const [memberId, setMemberId] = useState(searchParams.get("member") ?? "");
  const [from, setFrom] = useState(effectiveFyPeriod(society).from);
  const [to, setTo] = useState(effectiveFyPeriod(society).to);
  const [mode, setMode] = useState<"simple" | "detail">("simple");

  const ledger = useQuery(
    api.api.memberLedger,
    societyId && memberId
      ? { societyId, memberId: memberId as Id<"members">, fromDate: from, toDate: to }
      : "skip",
  ) as { member: Member | null; rows: LedgerRow[] } | undefined;

  const member = members?.find((m) => m._id === memberId);

  const outstanding = useMemo(() => {
    if (!bills || !memberId) return [];
    return bills
      .filter((b) => b.memberId === memberId && b.total > b.paidAmount)
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  }, [bills, memberId]);

  const totalOutstanding = outstanding.reduce((s, b) => s + (b.total - b.paidAmount), 0);
  const ledgerRows = ledger?.rows ?? [];
  const closingBalance =
    ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : member?.openingBalance ?? 0;

  const meta: ExportMeta | null =
    society && member
      ? {
          societyName: society.name,
          societyAddress: [society.address, society.city, society.state, society.pincode]
            .filter(Boolean)
            .join(", "),
          registrationNo: society.registrationNo,
          title: `Member Ledger — ${member.name} (${member.code})`,
          subtitle: `Period ${formatDate(from)} to ${formatDate(to)} · ${
            mode === "simple" ? "Simple view" : "Detailed view"
          }`,
          signatures,
        }
      : null;

  const buildTable = (): TableSpec => {
    const base: (string | number)[][] = [];
    if (member && member.openingBalance !== 0) {
      base.push(["", "", "Opening Balance", member.openingBalance > 0 ? member.openingBalance : 0, member.openingBalance < 0 ? -member.openingBalance : 0, member.openingBalance]);
    }
    const rows = (ledger?.rows ?? [])
      .filter((r) => r.voucherNo !== "OPENING")
      .map((r) => [
        formatDate(r.date),
        r.voucherNo,
        mode === "simple" ? r.particulars.split("—")[0].trim() : r.particulars + (r.note ? ` (${r.note})` : ""),
        r.debit,
        r.credit,
        r.balance,
      ]);
    return {
      head: ["Date", "Voucher", "Particulars", "Debit", "Credit", "Balance"],
      body: [...base, ...rows],
      foot: [["", "", "CLOSING", "", "", closingBalance]],
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], `member-ledger-${member?.code}.pdf`);
    else if (kind === "word") exportWord(meta, [table], `member-ledger-${member?.code}.doc`);
    else printTables(meta, [table]);
  };

  return (
    <div>
      <PageHeader
        title="Member Ledger"
        description="Per-member statement of bills and receipts with running balance. Simple view collapses particulars; detail shows bill components and references."
      />

      <div className="mb-6 grid gap-4 rounded-lg border p-5 sm:grid-cols-5">
        <div className="space-y-2 sm:col-span-2">
          <Label>Member</Label>
          <Select value={memberId || undefined} onValueChange={setMemberId}>
            <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
            <SelectContent>
              {(members ?? []).map((m) => (
                <SelectItem key={m._id} value={m._id}>
                  {m.code} — {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ml-from">From</Label>
          <Input id="ml-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ml-to">To</Label>
          <Input id="ml-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>View</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as "simple" | "detail")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Simple</SelectItem>
              <SelectItem value="detail">Detail</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!memberId ? (
        <EmptyHint>Select a member to view their ledger statement.</EmptyHint>
      ) : !member ? null : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Opening</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(member.openingBalance)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Closing balance</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(closingBalance)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding bills</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatINR(totalOutstanding)}</p>
            </div>
          </div>

          {outstanding.length > 0 && (
            <div className="mb-6 rounded-md border bg-accent/30 p-4 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Unpaid / partially paid bills
              </p>
              <div className="flex flex-wrap gap-2">
                {outstanding.map((b) => (
                  <Badge key={b._id} variant="outline" className="gap-2">
                    {b.billNo} · {formatPeriod(b.period)}
                    <span className="tabular-nums text-muted-foreground">
                      {formatINR(b.total - b.paidAmount)}
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4 flex justify-end gap-2">
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

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Particulars</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.openingBalance !== 0 && (
                  <TableRow className="bg-accent/30">
                    <TableCell colSpan={2} />
                    <TableCell className="font-medium">Opening Balance</TableCell>
                    <TableCell className="text-right"><RightMoney value={member.openingBalance > 0 ? member.openingBalance : 0} /></TableCell>
                    <TableCell className="text-right"><RightMoney value={member.openingBalance < 0 ? -member.openingBalance : 0} /></TableCell>
                    <TableCell className="text-right"><RightMoney value={member.openingBalance} /></TableCell>
                  </TableRow>
                )}
                {(ledger?.rows ?? [])
                  .filter((r) => r.voucherNo !== "OPENING")
                  .map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.voucherNo}</TableCell>
                      <TableCell>
                        {mode === "simple" ? r.particulars.split("—")[0].trim() : r.particulars}
                        {mode === "detail" && r.note && (
                          <span className="block text-xs text-muted-foreground">{r.note}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.debit ? <RightMoney value={r.debit} /> : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.credit ? <RightMoney value={r.credit} /> : "—"}
                      </TableCell>
                      <TableCell className="text-right"><RightMoney value={r.balance} /></TableCell>
                    </TableRow>
                  ))}
                <TableRow className="border-t-2 hover:bg-transparent">
                  <TableCell colSpan={3} className="font-semibold">Closing balance</TableCell>
                  <TableCell colSpan={2} />
                  <TableCell className="text-right font-semibold"><RightMoney value={closingBalance} /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
