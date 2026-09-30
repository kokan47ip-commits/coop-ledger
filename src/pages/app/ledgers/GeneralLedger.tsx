import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ReportPreview } from "@/components/ReportPreview";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatMoney, monthRangeISO } from "@/lib/format";
import { useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

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

/** One rendered ledger section — shared by the on-screen preview and every export. */
type LedgerSection = {
  account: Account;
  title: string;
  items: { date: string; voucherNo: string; narration: string[]; debit: number; credit: number; balance: number }[];
  totDr: number;
  totCr: number;
  closing: number;
};

const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;

export default function GeneralLedger() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0); // ▶ row marker (last clicked row)
  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [month, setMonth] = useState("");
  // Report options, mirroring the legacy Account Ledger window.
  const [skipPage, setSkipPage] = useState(true); // Skip Page After Ledger
  const [printNarration, setPrintNarration] = useState(true); // Print Narration
  const [detailed, setDetailed] = useState(false); // Show Detailed Entries

  const applyMonth = (m: string) => {
    setMonth(m);
    if (m) {
      const r = monthRangeISO(m);
      setFrom(r.from);
      setTo(r.to);
    } else {
      const p = effectiveFyPeriod(society);
      setFrom(p.from);
      setTo(p.to);
    }
  };

  const sortedAccounts = (accounts ?? []).slice().sort((a, b) => a.code.localeCompare(b.code));
  const allSelected = sortedAccounts.length > 0 && selected.size === sortedAccounts.length;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(sortedAccounts.map((a) => a._id)) : new Set());
    setCursor(0);
  };
  const toggleAccount = (id: string, checked: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Ledgers for every ticked account, fetched in one reactive query. */
  const bulk = useQuery(
    api.api.generalLedgersBulk,
    societyId && selected.size > 0
      ? { societyId, accountIds: [...selected] as Id<"accounts">[], fromDate: from, toDate: to }
      : "skip",
  ) as { accountId: Id<"accounts">; account: Account | null; rows: LedgerRow[] }[] | undefined;

  /** Build the render model for one account's ledger (consolidation + totals). */
  const buildSection = (acc: Account, allRows: LedgerRow[]): LedgerSection => {
    const rows = allRows.filter((r) => r.voucherNo !== "OPENING");
    // "Show Detailed Entries" off → collapse each voucher into a single row.
    const items: LedgerSection["items"] = [];
    if (!detailed) {
      let i = 0;
      while (i < rows.length) {
        let j = i;
        let dr = 0;
        let cr = 0;
        while (
          j < rows.length &&
          rows[j].voucherNo === rows[i].voucherNo &&
          rows[j].date === rows[i].date
        ) {
          dr += rows[j].debit;
          cr += rows[j].credit;
          j++;
        }
        const group = rows.slice(i, j);
        items.push({
          date: group[0].date,
          voucherNo: group[0].voucherNo,
          narration: group.map((r) =>
            `${r.debit > 0 ? "To " : "By "}${r.particulars}${printNarration && r.note ? `\n${r.note}` : ""}`,
          ),
          debit: dr,
          credit: cr,
          balance: group[group.length - 1].balance,
        });
        i = j;
      }
    } else {
      for (const r of rows) {
        items.push({
          date: r.date,
          voucherNo: r.voucherNo,
          narration: [
            `${r.debit > 0 ? "To " : "By "}${r.particulars}`,
            ...(printNarration && r.note ? [r.note] : []),
          ],
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        });
      }
    }
    const totDr = items.reduce((s, r) => s + r.debit, 0);
    const totCr = items.reduce((s, r) => s + r.credit, 0);
    const closing = rows.length > 0 ? rows[rows.length - 1].balance : acc.openingBalance;
    return {
      account: acc,
      title: `${acc.code}  ${acc.name}`.toUpperCase(),
      items,
      totDr,
      totCr,
      closing,
    };
  };

  const sections: LedgerSection[] =
    bulk && society
      ? sortedAccounts
          .filter((a) => selected.has(a._id))
          .map((acc) => {
            const entry = bulk.find((b) => b.accountId === acc._id);
            return buildSection(acc, entry?.rows ?? []);
          })
      : [];

  const meta: ExportMeta | null = society
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

  const sectionTable = (s: LedgerSection, first: boolean): TableSpec => {
    const body: (string | number)[][] = [];
    if (s.account.openingBalance !== 0) {
      body.push([
        "",
        "",
        s.account.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old",
        s.account.openingBalance > 0 ? s.account.openingBalance : "",
        s.account.openingBalance < 0 ? -s.account.openingBalance : "",
        "",
      ]);
    }
    for (const r of s.items) {
      body.push([formatDate(r.date), r.voucherNo, r.narration.join("\n"), r.debit || "", r.credit || "", drCr(r.balance)]);
    }
    if (body.length === 0) body.push(["", "", "No transactions in this period", "", "", ""]);
    return {
      sectionTitle: s.title,
      pageBreakBefore: !first && skipPage,
      head: ["Date", "Voucher No", "Narration", "Debit", "Credit", "Balance"],
      body,
      foot: [
        [
          "",
          "",
          s.closing >= 0 ? "To Closing balance cd" : "By Closing balance cd",
          s.closing < 0 ? -s.closing : "",
          s.closing >= 0 ? s.closing : "",
          "",
        ],
        ["", "", "Total", s.totDr, s.totCr, ""],
      ],
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (selected.size === 0) {
      toast.error("Tick at least one ledger first.");
      return;
    }
    if (!bulk || !meta) {
      toast.error("Loading ledgers… try again in a moment.");
      return;
    }
    const tables = sections.map((s, i) => sectionTable(s, i === 0));
    const name = selected.size === 1 ? `ledger-${sections[0]?.account.code}` : "account-ledgers";
    if (kind === "pdf") exportPDF(meta, tables, `${name}.pdf`);
    else if (kind === "word") exportWord(meta, tables, `${name}.doc`);
    else printTables(meta, tables);
  };

  // ---------- Trial balance (kept as a secondary tab) ----------
  const trialBalance = useQuery(
    api.api.trialBalance,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as TrialBalanceRow[] | undefined;

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

  const doExportTrial = (kind: "pdf" | "word" | "print") => {
    if (!tbMeta) return;
    const table = buildTrialTable();
    if (kind === "pdf") exportPDF(tbMeta, [table], "trial-balance.pdf");
    else if (kind === "word") exportWord(tbMeta, [table], "trial-balance.doc");
    else printTables(tbMeta, [table]);
  };

  return (
    <div>
      <PageHeader
        title="General Ledger"
        description="Account ledger in the classic format — tick ledgers, set the period and options, preview, then print or download."
      />

      <Tabs defaultValue="ledger">
        <TabsList className="rounded-lg">
          <TabsTrigger value="ledger" className="rounded-lg">Account ledger</TabsTrigger>
          <TabsTrigger value="trial" className="rounded-lg">Trial balance</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-6">
          {/* ---- Ledger selection panel (legacy layout) ---- */}
          <div className="panel">
            <div className="border-b bg-muted/50 px-4 py-2 text-sm font-medium">Ledger</div>
            <div className="grid gap-6 p-4 lg:grid-cols-[1fr_320px]">
              {/* Left: checkbox list */}
              <div className="overflow-hidden rounded-md border">            <div className="grid grid-cols-[18px_36px_90px_1fr] items-center border-b bg-muted/50 px-2 py-1.5 text-xs font-semibold">
              <span />
              <Checkbox
                checked={allSelected}
                onCheckedChange={(c) => toggleAll(c === true)}
                aria-label="Select all ledgers"
              />
              <span>Ledger Code</span>
              <span>Ledger Name</span>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {sortedAccounts.map((a, idx) => (
                <div
                  key={a._id}
                  onClick={() => setCursor(idx)}
                  className={`grid cursor-default grid-cols-[18px_36px_90px_1fr] items-center border-b px-2 py-1.5 text-sm last:border-b-0 ${
                    cursor === idx ? "bg-accent/60" : "hover:bg-accent/30"
                  }`
                  }
                >
                  <span className="text-[10px] leading-none text-foreground">{cursor === idx ? "▶" : ""}</span>
                  <Checkbox
                    checked={selected.has(a._id)}
                    onCheckedChange={(c) => toggleAccount(a._id, c === true)}
                    aria-label={`Select ${a.name}`}
                  />
                  <span className="font-mono text-xs">{a.code}</span>
                  <span className="truncate uppercase">{a.name}</span>
                </div>
              ))}
                  {sortedAccounts.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No ledgers yet — add accounts under Chart of Accounts.
                    </p>
                  )}
                </div>
              </div>

              {/* Right: date range + report options */}
              <div className="space-y-3">
                <div className="grid grid-cols-[84px_1fr] items-center gap-2">
                  <Label htmlFor="gl-from" className="text-sm">From Date</Label>
                  <Input
                    id="gl-from"
                    type="date"
                    value={from}
                    onChange={(e) => { setFrom(e.target.value); setMonth(""); }}
                  />
                </div>
                <div className="grid grid-cols-[84px_1fr] items-center gap-2">
                  <Label htmlFor="gl-to" className="text-sm">To Date</Label>
                  <Input
                    id="gl-to"
                    type="date"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setMonth(""); }}
                  />
                </div>
                <div className="grid grid-cols-[84px_1fr] items-center gap-2">
                  <Label htmlFor="gl-month" className="text-sm text-muted-foreground">Month</Label>
                  <Input id="gl-month" type="month" value={month} onChange={(e) => applyMonth(e.target.value)} />
                </div>
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={skipPage} onCheckedChange={(c) => setSkipPage(c === true)} />
                    Skip Page After Ledger
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={printNarration} onCheckedChange={(c) => setPrintNarration(c === true)} />
                    Print Narration
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={detailed} onCheckedChange={(c) => setDetailed(c === true)} />
                    Show Detailed Entries
                  </label>
                </div>
              </div>
            </div>
            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => doExport("print")}>
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={() => doExport("pdf")}>
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => doExport("word")}>
                Word
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelected(new Set());
                  setMonth("");
                  const p = effectiveFyPeriod(society);
                  setFrom(p.from);
                  setTo(p.to);
                }}
              >
                Exit
              </Button>
            </div>
          </div>

          {/* ---- Live report preview (mirrors the printed output) ---- */}
          <div className="mt-6">
            {!society || selected.size === 0 ? (
              <EmptyHint>Tick one or more ledgers above to build the Account Ledger report.</EmptyHint>
            ) : !bulk ? (
              <EmptyHint>Loading ledgers…</EmptyHint>
            ) : (
              <ReportPreview title="Main Report" onPrint={() => doExport("print")}>
                <div className="text-center">
                  <p className="text-base font-bold tracking-tight">{society.name.toUpperCase()}</p>
                  {([society.address, society.city, society.state, society.pincode].filter(Boolean).join(", ") || null) && (
                    <p className="text-[11px] text-slate-600">
                      {[society.address, society.city, society.state, society.pincode].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <p className="mt-3 text-sm font-bold underline underline-offset-4">ACCOUNT LEDGER</p>
                  <p className="text-[11px] text-slate-600">For the period {formatDate(from)} to {formatDate(to)}</p>
                </div>

                <div className="mt-6 space-y-8">
                  {sections.map((s, si) => (
                    <div key={s.account._id} className={si > 0 && skipPage ? "border-t border-dashed pt-8" : ""}>
                      <p className="text-[13px] font-bold">{s.title}</p>
                      <table className="mt-2 w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="border-y border-slate-800 text-left">
                            <th className="w-20 py-1.5 pr-2 font-bold">Date</th>
                            <th className="w-24 py-1.5 pr-2 font-bold">Voucher No</th>
                            <th className="py-1.5 pr-2 font-bold">Narration</th>
                            <th className="w-24 py-1.5 text-right font-bold">Debit</th>
                            <th className="w-24 py-1.5 text-right font-bold">Credit</th>
                            <th className="w-28 py-1.5 text-right font-bold">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.account.openingBalance !== 0 && (
                            <tr>
                              <td colSpan={3} className="py-1 pr-2">
                                {s.account.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old"}
                              </td>
                              <td className="py-1 text-right tabular-nums">
                                {s.account.openingBalance > 0 ? formatMoney(s.account.openingBalance) : ""}
                              </td>
                              <td className="py-1 text-right tabular-nums">
                                {s.account.openingBalance < 0 ? formatMoney(-s.account.openingBalance) : ""}
                              </td>
                              <td />
                            </tr>
                          )}
                          {s.items.map((r, i) => (
                            <tr key={i} className="align-top">
                              <td className="whitespace-nowrap py-1 pr-2">{formatDate(r.date)}</td>
                              <td className="py-1 pr-2 font-mono text-[11px]">{r.voucherNo}</td>
                              <td className="py-1 pr-2">
                                {r.narration.map((line, j) => (
                                  <span key={j} className={j > 0 ? "block text-[11px] text-slate-600" : "block"}>
                                    {line}
                                  </span>
                                ))}
                              </td>
                              <td className="py-1 text-right tabular-nums">{r.debit ? formatMoney(r.debit) : ""}</td>
                              <td className="py-1 text-right tabular-nums">{r.credit ? formatMoney(r.credit) : ""}</td>
                              <td className="py-1 text-right tabular-nums">{drCr(r.balance)}</td>
                            </tr>
                          ))}
                          {s.items.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-2 text-center text-slate-500">
                                No transactions in this period
                              </td>
                            </tr>
                          )}
                          <tr className="border-t border-slate-800">
                            <td colSpan={3} className="py-1 pr-2 font-semibold">
                              {s.closing >= 0 ? "To Closing balance cd" : "By Closing balance cd"}
                            </td>
                            <td className="py-1 text-right font-semibold tabular-nums">
                              {s.closing < 0 ? formatMoney(-s.closing) : ""}
                            </td>
                            <td className="py-1 text-right font-semibold tabular-nums">
                              {s.closing >= 0 ? formatMoney(s.closing) : ""}
                            </td>
                            <td />
                          </tr>
                          <tr className="border-t border-slate-300">
                            <td colSpan={3} className="py-1 pr-2 font-semibold">Total</td>
                            <td className="py-1 text-right font-semibold tabular-nums">{formatMoney(s.totDr)}</td>
                            <td className="py-1 text-right font-semibold tabular-nums">{formatMoney(s.totCr)}</td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </ReportPreview>
            )}
          </div>
        </TabsContent>

        <TabsContent value="trial" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {(trialBalance ?? []).length} ledger accounts with activity
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => doExportTrial("pdf")}>
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => doExportTrial("word")}>
                Word
              </Button>
              <Button variant="outline" size="sm" onClick={() => doExportTrial("print")}>
                Print
              </Button>
            </div>
          </div>
          {!trialBalance ? null : trialBalance.length === 0 ? (
            <EmptyHint>No account activity in this period.</EmptyHint>
          ) : (
            <div className="panel">
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
