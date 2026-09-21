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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatINR, formatMoney, monthRangeISO } from "@/lib/format";
import { Download, FileText, Printer, ListChecks } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

type Account = Doc<"accounts">;
type LedgerRow = {
  date: string;
  voucherNo: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
  note?: string;
};
type TrialBalanceRow = {
  accountId: Id<"accounts">;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
};

const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;

export default function GeneralLedger() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(effectiveFyPeriod(society).from);
  const [to, setTo] = useState(effectiveFyPeriod(society).to);
  const [month, setMonth] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  const applyMonth = (m: string) => {
    setMonth(m);
    if (m) {
      const r = monthRangeISO(m);
      setFrom(r.from);
      setTo(r.to);
    } else {
      const fy = effectiveFyPeriod(society);
      setFrom(fy.from);
      setTo(fy.to);
    }
  };

  const ledger = useQuery(
    api.api.generalLedger,
    societyId && accountId
      ? { societyId, accountId: accountId as Id<"accounts">, fromDate: from, toDate: to }
      : "skip",
  ) as { account: Account | null; rows: LedgerRow[] } | undefined;

  const trialBalance = useQuery(
    api.api.trialBalance,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as TrialBalanceRow[] | undefined;

  const account = accounts?.find((a) => a._id === accountId);
  const ledgerRows = ledger?.rows ?? [];
  const closing = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : 0;

  const meta: ExportMeta | null =
    society && account
      ? {
          societyName: society.name,
          societyAddress: [society.address, society.city, society.state, society.pincode]
            .filter(Boolean)
            .join(", "),
          registrationNo: society.registrationNo,
          title: "ACCOUNT LEDGER",
          subtitle: `For the period ${formatDate(from)} to ${formatDate(to)}`,
          signatures,
        }
      : null;

  const buildLedgerTable = (): TableSpec => {
    const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;
    const body: (string | number)[][] = [];
    if (account && account.openingBalance !== 0) {
      body.push([
        "",
        "",
        account.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old",
        account.openingBalance > 0 ? account.openingBalance : "",
        account.openingBalance < 0 ? -account.openingBalance : "",
        "",
      ]);
    }
    let totDr = 0;
    let totCr = 0;
    for (const r of ledger?.rows ?? []) {
      totDr += r.debit;
      totCr += r.credit;
      body.push([
        formatDate(r.date),
        r.voucherNo,
        `${r.debit > 0 ? "To " : "By "}${r.particulars}${r.note ? `\n${r.note}` : ""}`,
        r.debit || "",
        r.credit || "",
        drCr(r.balance),
      ]);
    }
    return {
      sectionTitle: account ? `${account.code}  ${account.name}`.toUpperCase() : undefined,
      head: ["Date", "Voucher No", "Narration", "Debit", "Credit", "Balance"],
      body,
      foot: [
        [
          "",
          "",
          closing >= 0 ? "To Closing balance cd" : "By Closing balance cd",
          closing < 0 ? -closing : "",
          closing >= 0 ? closing : "",
          "",
        ],
        ["", "", "", totDr, totCr, ""],
      ],
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    };
  };

  const buildTrialTable = (): TableSpec => {
    const rows = (trialBalance ?? []).map((r) => [r.code, r.name, r.debit, r.credit]);
    const totalDr = (trialBalance ?? []).reduce((s, r) => s + r.debit, 0);
    const totalCr = (trialBalance ?? []).reduce((s, r) => s + r.credit, 0);
    return {
      head: ["Code", "Account", "Debit", "Credit"],
      body: rows,
      foot: [["", "TOTAL", totalDr, totalCr]],
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
    };
  };

  const tbMeta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Trial Balance",
        subtitle: `Period ${formatDate(from)} to ${formatDate(to)}`,
        signatures,
      }
    : null;

  const doExport = (kind: "pdf" | "word" | "print", table: TableSpec, m: ExportMeta, name: string) => {
    if (kind === "pdf") exportPDF(m, [table], name);
    else if (kind === "word") exportWord(m, [table], name.replace(".pdf", ".doc"));
    else printTables(m, [table]);
  };

  const sortedAccounts = (accounts ?? [])
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code));
  const allAccountsSelected =
    sortedAccounts.length > 0 && selectedAccounts.size === sortedAccounts.length;

  const toggleAllAccounts = (checked: boolean) =>
    setSelectedAccounts(checked ? new Set(sortedAccounts.map((a) => a._id)) : new Set());
  const toggleAccount = (id: string, checked: boolean) =>
    setSelectedAccounts((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Selection-wise export: one ledger section per ticked account. */
  const bulk = useQuery(
    api.api.generalLedgersBulk,
    societyId && selectedAccounts.size > 0
      ? {
          societyId,
          accountIds: [...selectedAccounts] as Id<"accounts">[],
          fromDate: from,
          toDate: to,
        }
      : "skip",
  ) as { accountId: Id<"accounts">; account: Account | null; rows: LedgerRow[] }[] | undefined;

  const doExportSelected = (kind: "pdf" | "word" | "print") => {
    if (selectedAccounts.size === 0) {
      toast.error("Tick at least one account first.");
      return;
    }
    if (!bulk || !society) {
      toast.error("Loading selected ledgers… try again in a moment.");
      return;
    }
    const m: ExportMeta = {
      societyName: society.name,
      societyAddress: [society.address, society.city, society.state, society.pincode]
        .filter(Boolean)
        .join(", "),
      registrationNo: society.registrationNo,
      title: "GENERAL LEDGER — SELECTED ACCOUNTS",
      subtitle: `For the period ${formatDate(from)} to ${formatDate(to)} · ${selectedAccounts.size} accounts`,
      signatures,
    };
    const order = sortedAccounts.filter((a) => selectedAccounts.has(a._id));
    const tables: TableSpec[] = order.map((acc) => {
      const entry = bulk.find((b) => b.accountId === acc._id);
      const rows = entry?.rows ?? [];
      const body: (string | number)[][] = [];
      if (acc.openingBalance !== 0) {
        body.push([
          "", "",
          acc.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old",
          acc.openingBalance > 0 ? acc.openingBalance : "",
          acc.openingBalance < 0 ? -acc.openingBalance : "",
          "",
        ]);
      }
      let totDr = 0;
      let totCr = 0;
      for (const r of rows) {
        totDr += r.debit;
        totCr += r.credit;
        body.push([
          formatDate(r.date),
          r.voucherNo,
          `${r.debit > 0 ? "To " : "By "}${r.particulars}${r.note ? `\n${r.note}` : ""}`,
          r.debit || "",
          r.credit || "",
          drCr(r.balance),
        ]);
      }
      const closing = rows.length > 0 ? rows[rows.length - 1].balance : acc.openingBalance;
      return {
        sectionTitle: `${acc.code}  ${acc.name}`.toUpperCase(),
        head: ["Date", "Voucher No", "Narration", "Debit", "Credit", "Balance"],
        body: body.length > 0 ? body : [["", "", "No transactions in this period", "", "", ""]],
        foot: [
          ["", "", closing >= 0 ? "To Closing balance cd" : "By Closing balance cd", closing < 0 ? -closing : "", closing >= 0 ? closing : "", ""],
          ["", "", "", totDr, totCr, ""],
        ],
        columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
      };
    });
    if (kind === "pdf") exportPDF(m, tables, `general-ledgers-selected.pdf`);
    else if (kind === "word") exportWord(m, tables, `general-ledgers-selected.doc`);
    else printTables(m, tables);
  };

  return (
    <div>
      <PageHeader
        title="General Ledger"
        description="Account-wise debit/credit statement with running balance, plus a full trial balance across all ledgers."
      />

      <Tabs defaultValue="ledger">
        <TabsList className="rounded-lg">
          <TabsTrigger value="ledger" className="rounded-lg">Account ledger</TabsTrigger>
          <TabsTrigger value="trial" className="rounded-lg">Trial balance</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-6">
          <div className="mb-6 grid gap-4 rounded-lg border p-5 sm:grid-cols-5">
            <div className="space-y-2 sm:col-span-2">
              <Label>Account</Label>
              <Select value={accountId || undefined} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {(accounts ?? [])
                    .slice()
                    .sort((a, b) => a.code.localeCompare(b.code))
                    .map((a) => (
                      <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-from">From</Label>
              <Input id="gl-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonth(""); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-to">To</Label>
              <Input id="gl-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonth(""); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-month">Month</Label>
              <Input id="gl-month" type="month" value={month} onChange={(e) => applyMonth(e.target.value)} />
            </div>
          </div>

          {/* Selection-wise printing: tick accounts and export their ledgers together */}
          <details className="mb-6 rounded-lg border p-4">
            <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium">
              <ListChecks className="size-4 text-primary" />
              Print / download multiple accounts (selection-wise)
              {selectedAccounts.size > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {selectedAccounts.size} selected
                </span>
              )}
            </summary>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allAccountsSelected}
                  onCheckedChange={(c) => toggleAllAccounts(c === true)}
                />
                Select all accounts
              </label>
              <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-3 sm:grid-cols-3">
                {sortedAccounts.map((a) => (
                  <label key={a._id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedAccounts.has(a._id)}
                      onCheckedChange={(c) => toggleAccount(a._id, c === true)}
                    />
                    <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                    <span className="truncate">{a.name}</span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={selectedAccounts.size === 0}
                  onClick={() => doExportSelected("pdf")}>
                  <Download className="size-4" /> PDF selected ({selectedAccounts.size})
                </Button>
                <Button variant="outline" size="sm" disabled={selectedAccounts.size === 0}
                  onClick={() => doExportSelected("word")}>
                  <FileText className="size-4" /> Word selected
                </Button>
                <Button variant="outline" size="sm" disabled={selectedAccounts.size === 0}
                  onClick={() => doExportSelected("print")}>
                  <Printer className="size-4" /> Print selected
                </Button>
              </div>
            </div>
          </details>

          {!accountId ? (
            <EmptyHint>Select an account to view its ledger.</EmptyHint>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Closing: <span className="font-medium text-foreground tabular-nums">{formatINR(closing)}</span>
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => meta && doExport("pdf", buildLedgerTable(), meta, `ledger-${account?.code}.pdf`)}>
                    <Download className="size-4" /> PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => meta && doExport("word", buildLedgerTable(), meta, `ledger-${account?.code}.doc`)}>
                    <FileText className="size-4" /> Word
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => meta && doExport("print", buildLedgerTable(), meta, "")}>
                    <Printer className="size-4" /> Print
                  </Button>
                </div>
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
                    {account && account.openingBalance !== 0 && (
                      <TableRow className="bg-accent/30">
                        <TableCell colSpan={2} />
                        <TableCell className="font-medium">
                          {account.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old"}
                        </TableCell>
                        <TableCell className="text-right"><RightMoney value={account.openingBalance} /></TableCell>
                        <TableCell className="text-right">—</TableCell>
                        <TableCell className="text-right"><RightMoney value={account.openingBalance} /></TableCell>
                      </TableRow>
                    )}
                    {(ledger?.rows ?? []).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.voucherNo}</TableCell>
                        <TableCell>
                          {r.particulars}
                          {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                        </TableCell>
                        <TableCell className="text-right">{r.debit ? <RightMoney value={r.debit} /> : "—"}</TableCell>
                        <TableCell className="text-right">{r.credit ? <RightMoney value={r.credit} /> : "—"}</TableCell>
                        <TableCell className="text-right"><RightMoney value={r.balance} /></TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 hover:bg-transparent">
                      <TableCell colSpan={3} className="font-semibold">
                        {closing >= 0 ? "To Closing balance cd" : "By Closing balance cd"}
                      </TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right font-semibold"><RightMoney value={closing} /></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="trial" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {(trialBalance ?? []).length} ledger accounts with activity
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => tbMeta && doExport("pdf", buildTrialTable(), tbMeta, "trial-balance.pdf")}>
                <Download className="size-4" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => tbMeta && doExport("word", buildTrialTable(), tbMeta, "trial-balance.doc")}>
                <FileText className="size-4" /> Word
              </Button>
              <Button variant="outline" size="sm" onClick={() => tbMeta && doExport("print", buildTrialTable(), tbMeta, "")}>
                <Printer className="size-4" /> Print
              </Button>
            </div>
          </div>
          {!trialBalance ? null : trialBalance.length === 0 ? (
            <EmptyHint>No account activity in this period.</EmptyHint>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialBalance.map((r) => (
                    <TableRow key={r.accountId}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{r.debit ? <RightMoney value={r.debit} /> : "—"}</TableCell>
                      <TableCell className="text-right">{r.credit ? <RightMoney value={r.credit} /> : "—"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 hover:bg-transparent">
                    <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">
                      <RightMoney value={trialBalance.reduce((s, r) => s + r.debit, 0)} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <RightMoney value={trialBalance.reduce((s, r) => s + r.credit, 0)} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

