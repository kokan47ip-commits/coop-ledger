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
import { effectiveFyPeriod, formatDate, formatINR, formatMoney, formatPeriod } from "@/lib/format";
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
  heads?: { name: string; amount: number }[];
};

const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;

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
  const isDetail = mode === "detail";

  // Tariff-head columns for the detail view, in order of first appearance.
  const headNames = useMemo(() => {
    const names: string[] = [];
    for (const r of ledger?.rows ?? []) {
      for (const h of r.heads ?? []) {
        if (!names.includes(h.name)) names.push(h.name);
      }
    }
    return names;
  }, [ledger]);

  const { headTotals, totDebit, totCredit } = useMemo(() => {
    const headTotals = headNames.map(() => 0);
    let totDebit = 0;
    let totCredit = 0;
    for (const r of ledger?.rows ?? []) {
      totDebit += r.debit;
      totCredit += r.credit;
      headNames.forEach((n, i) => {
        const h = r.heads?.find((x) => x.name === n);
        if (h) headTotals[i] += h.amount;
      });
    }
    return { headTotals, totDebit, totCredit };
  }, [ledger, headNames]);

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
          title: "MEMBER LEDGER",
          subtitle: `For the period ${formatDate(from)} to ${formatDate(to)}`,
          signatures,
        }
      : null;

  const buildTable = (): TableSpec => {
    const rows = (ledger?.rows ?? []).filter((r) => r.voucherNo !== "OPENING");
    const detail = isDetail && headNames.length > 0;
    const blank = () => (detail ? headNames.map(() => "") : []);

    const body: (string | number)[][] = [];
    if (member && member.openingBalance !== 0) {
      body.push([
        "",
        "",
        member.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old",
        ...blank(),
        member.openingBalance > 0 ? member.openingBalance : "",
        member.openingBalance < 0 ? -member.openingBalance : "",
        "",
      ]);
    }
    for (const r of rows) {
      if (detail) {
        body.push([
          formatDate(r.date),
          r.voucherNo,
          ...headNames.map((n) => r.heads?.find((x) => x.name === n)?.amount ?? ""),
          r.debit || "",
          r.credit || "",
          drCr(r.balance),
        ]);
      } else {
        body.push([
          formatDate(r.date),
          r.voucherNo,
          r.particulars.split("—")[0].trim() + (r.note ? `\n${r.note}` : ""),
          r.debit || "",
          r.credit || "",
          drCr(r.balance),
        ]);
      }
    }

    const head = detail
      ? ["Date", "Bill / Voucher No.", ...headNames, "Debit", "Credit", "Balance"]
      : ["Date", "Bill / Voucher No.", "Narration", "Debit", "Credit", "Balance"];
    const columnStyles: TableSpec["columnStyles"] = {};
    for (let i = detail ? 2 : 3; i < (detail ? 2 + headNames.length + 3 : 6); i++) {
      columnStyles[i] = { halign: "right" };
    }

    return {
      sectionTitle: member ? `${member.code}  ${member.name}`.toUpperCase() : undefined,
      head,
      body,
      foot: [
        [
          "",
          "",
          closingBalance >= 0 ? "To Closing balance cd" : "By Closing balance cd",
          ...blank(),
          closingBalance < 0 ? -closingBalance : "",
          closingBalance > 0 ? closingBalance : "",
          "",
        ],
        ["", "Total", ...headTotals, totDebit, totCredit, ""],
      ],
      columnStyles,
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
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-28">Bill / Voucher No.</TableHead>
                  {isDetail && headNames.length > 0 && headNames.map((n) => (
                    <TableHead key={n} className="whitespace-nowrap text-right">{n}</TableHead>
                  ))}
                  {!isDetail && <TableHead>Particulars</TableHead>}
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.openingBalance !== 0 && (
                  <TableRow className="bg-accent/30 hover:bg-accent/30">
                    <TableCell colSpan={2} />
                    {isDetail && headNames.length > 0 && headNames.map((n) => <TableCell key={n} />)}
                    {!isDetail && (
                      <TableCell className="font-medium">
                        {member.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old"}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">
                      {member.openingBalance > 0 ? formatMoney(member.openingBalance) : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {member.openingBalance < 0 ? formatMoney(-member.openingBalance) : ""}
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                  </TableRow>
                )}
                {(ledger?.rows ?? [])
                  .filter((r) => r.voucherNo !== "OPENING")
                  .map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.voucherNo}
                        {isDetail && r.note && (
                          <span className="block font-sans text-[11px] text-muted-foreground">{r.note}</span>
                        )}
                      </TableCell>
                      {isDetail && headNames.length > 0 && headNames.map((n) => {
                        const h = r.heads?.find((x) => x.name === n);
                        return (
                          <TableCell key={n} className="text-right tabular-nums">
                            {h ? formatMoney(h.amount) : ""}
                          </TableCell>
                        );
                      })}
                      {!isDetail && (
                        <TableCell>
                          {r.particulars.split("—")[0].trim()}
                          {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        {r.debit ? formatMoney(r.debit) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.credit ? formatMoney(r.credit) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{drCr(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                {isDetail && headNames.length > 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} />
                    {headNames.map((n, i) => (
                      <TableCell key={n} className="text-right font-medium tabular-nums">
                        {headTotals[i] ? formatMoney(headTotals[i]) : ""}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totDebit)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totCredit)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
                <TableRow className="border-t-2 hover:bg-transparent">
                  <TableCell colSpan={2} className="font-semibold">
                    {closingBalance >= 0 ? "To Closing balance cd" : "By Closing balance cd"}
                  </TableCell>
                  {isDetail && headNames.length > 0 && headNames.map((n) => <TableCell key={n} />)}
                  {!isDetail && <TableCell />}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {closingBalance < 0 ? formatMoney(-closingBalance) : ""}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {closingBalance > 0 ? formatMoney(closingBalance) : ""}
                  </TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
