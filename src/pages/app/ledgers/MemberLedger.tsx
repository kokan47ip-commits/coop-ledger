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
import { Checkbox } from "@/components/ui/checkbox";
import { ReportPreview } from "@/components/ReportPreview";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, ReportLetterhead } from "@/components/PageParts";
import { exportExcel, exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatMoney, monthRangeISO } from "@/lib/format";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type Member = Doc<"members">;
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

/** One rendered member ledger — shared by the preview and every export. */
type MemberSection = {
  member: Member;
  title: string;
  items: {
    date: string;
    voucherNo: string;
    narration: string[];
    debit: number;
    credit: number;
    balance: number;
    heads?: { name: string; amount: number }[];
  }[];
  totDr: number;
  totCr: number;
  closing: number;
  /** Per-billing-head totals across the section's bill rows (Detail format). */
  headTotals: { name: string; amount: number }[];
};

const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;

/** Display flat number — ledgers identify members by flat, not member no. */
const flatOf = (m: Member) => [m.wing, m.flatNo].filter(Boolean).join("-") || m.code;

export default function MemberLedger() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  // Tariff schedule: the detail ledger's head columns print the tariff's
  // short name when set (bills may carry either wording on their lines).
  const tariffs = useQuery(api.tariffs.list, societyId ? { societyId } : "skip") as
    | Doc<"tariffs">[]
    | undefined;

  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(searchParams.get("member") ? [searchParams.get("member")!] : []),
  );
  const [cursor, setCursor] = useState(0); // ▶ row marker (last clicked row)
  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [month, setMonth] = useState("");
  // Report options — the Report Format select mirrors the legacy combo.
  const [mode, setMode] = useState<"simple" | "detail">("simple");
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

  const sortedMembers = [...(members ?? [])].sort((a, b) => a.code.localeCompare(b.code));
  const allSelected = sortedMembers.length > 0 && selected.size === sortedMembers.length;

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(sortedMembers.map((m) => m._id)) : new Set());
    setCursor(0);
  };
  const toggleMember = (id: string, checked: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Ledgers for every ticked member, fetched in one reactive query. */
  const bulk = useQuery(
    api.api.memberLedgersBulk,
    societyId && selected.size > 0
      ? { societyId, memberIds: [...selected] as Id<"members">[], fromDate: from, toDate: to }
      : "skip",
  ) as { memberId: Id<"members">; member: Member | null; rows: LedgerRow[] }[] | undefined;

  /** Tariff-head columns across all selected members (detail format only). */
  const headNames: string[] = [];
  if (mode === "detail") {
    for (const b of bulk ?? []) {
      for (const r of b.rows) {
        for (const h of r.heads ?? []) {
          if (!headNames.includes(h.name)) headNames.push(h.name);
        }
      }
    }
  }
  // Outside the Detail format the heads have no columns of their own, so
  // every bill row's billing heads are spelled out in the narration instead —
  // the user asked to see ALL billing heads in the member ledger.
  const showHeadLines = !(mode === "detail" && headNames.length > 0);
  const headLines = (heads?: { name: string; amount: number }[]) =>
    showHeadLines && heads && heads.length > 0
      ? heads.map((h) => `${h.name}: ${formatMoney(h.amount)}`)
      : [];

  /** Build the render model for one member's ledger (consolidation + totals). */
  const buildSection = (mem: Member, allRows: LedgerRow[]): MemberSection => {
    const rows = allRows.filter((r) => r.voucherNo !== "OPENING");
    const items: MemberSection["items"] = [];
    if (detailed) {
      // Show Detailed Entries: one row per underlying entry, no consolidation.
      for (const r of rows) {
        const label = r.particulars.split("—")[0].trim();
        items.push({
          date: r.date,
          voucherNo: r.voucherNo,
          narration: [
            `${r.debit > 0 ? "To " : "By "}${label}`,
            ...headLines(r.heads),
            ...(printNarration && r.note ? [r.note] : []),
          ],
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
          heads: r.heads,
        });
      }
    } else {
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
        const mergedHeads: { name: string; amount: number }[] = [];
        for (const g of group) {
          for (const h of g.heads ?? []) {
            const existing = mergedHeads.find((x) => x.name === h.name);
            if (existing) existing.amount += h.amount;
            else mergedHeads.push({ name: h.name, amount: h.amount });
          }
        }
        items.push({
          date: group[0].date,
          voucherNo: group[0].voucherNo,
          narration: group.flatMap((r, gi) => {
            const label = r.particulars.split("—")[0].trim();
            const lines = [`${r.debit > 0 ? "To " : "By "}${label}`];
            // Every billing head of the bill, with its amount — once per
            // consolidated group (they are shared across the group's rows).
            if (gi === 0) lines.push(...headLines(mergedHeads));
            if (printNarration && r.note) lines.push(r.note);
            return lines;
          }),
          debit: dr,
          credit: cr,
          balance: group[group.length - 1].balance,
          heads: mergedHeads.length > 0 ? mergedHeads : undefined,
        });
        i = j;
      }
    }
    // Totals include the opening balance row so Dr/Cr columns foot correctly
    // with the printed statement format ("To/By Opening balance old").
    const openingDr = mem.openingBalance < 0 ? -mem.openingBalance : 0;
    const openingCr = mem.openingBalance > 0 ? mem.openingBalance : 0;
    const totDr = openingDr + items.reduce((s, r) => s + r.debit, 0);
    const totCr = openingCr + items.reduce((s, r) => s + r.credit, 0);
    const headTotals: { name: string; amount: number }[] = [];
    for (const it of items) {
      for (const h of it.heads ?? []) {
        const ex = headTotals.find((x) => x.name === h.name);
        if (ex) ex.amount += h.amount;
        else headTotals.push({ name: h.name, amount: h.amount });
      }
    }
    const closing = rows.length > 0 ? rows[rows.length - 1].balance : mem.openingBalance;
    return { member: mem, title: `${flatOf(mem)}  ${mem.name}`.toUpperCase(), items, totDr, totCr, closing, headTotals };
  };

  // A ledger with no entries in the period is skipped entirely — it is not
  // previewed or printed (opening balance alone does not count as an entry).
  const sections: MemberSection[] =
    bulk && society
      ? sortedMembers
          .filter((m) => selected.has(m._id))
          .map((mem) => {
            const entry = bulk.find((b) => b.memberId === mem._id);
            return buildSection(mem, entry?.rows ?? []);
          })
          .filter((s) => s.items.length > 0)
      : [];

  /** Printed label for a head column: the tariff's short name when set. */
  const headLabel = (n: string) => {
    const t = (tariffs ?? []).find((x) => x.name === n);
    return t?.shortName?.trim() || n;
  };

  const meta: ExportMeta | null = society
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

  const sectionTable = (s: MemberSection, first: boolean): TableSpec => {
    const isDetail = mode === "detail" && headNames.length > 0;
    const blank = () => (isDetail ? headNames.map(() => "") : []);
    const body: (string | number)[][] = [];
    if (s.member.openingBalance !== 0) {
      body.push([
        "",
        "",
        ...blank(),
        s.member.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old",
        s.member.openingBalance > 0 ? s.member.openingBalance : "",
        s.member.openingBalance < 0 ? -s.member.openingBalance : "",
        "",
      ]);
    }
    for (const r of s.items) {
      const headVals = isDetail
        ? headNames.map((n) => r.heads?.find((h) => h.name === n)?.amount ?? "")
        : [];
      body.push([
        formatDate(r.date),
        r.voucherNo,
        ...(isDetail ? headVals : []),
        r.narration.join("\n"),
        r.debit || "",
        r.credit || "",
        drCr(r.balance),
      ]);
    }

    const head = isDetail
      ? ["Date", "Bill / Voucher No.", ...headNames.map(headLabel), "Narration", "Debit", "Credit", "Balance"]
      : ["Date", "Bill / Voucher No.", "Narration", "Debit", "Credit", "Balance"];
    const columnStyles: TableSpec["columnStyles"] = {};
    const moneyStart = isDetail ? 2 + headNames.length + 1 : 3;
    const moneyEnd = isDetail ? 2 + headNames.length + 4 : 6;
    for (let i = moneyStart; i < moneyEnd; i++) columnStyles[i] = { halign: "right" };

    return {
      sectionTitle: s.title,
      pageBreakBefore: !first && skipPage,
      head,
      body,
      foot: [
        [
          "",
          "",
          ...blank(),
          s.closing >= 0 ? "To Closing balance cd" : "By Closing balance cd",
          s.closing < 0 ? -s.closing : "",
          s.closing > 0 ? s.closing : "",
          "",
        ],
        [
          "",
          "",
          // The TOTAL line covers ALL columns — every billing head too.
          ...(isDetail
            ? headNames.map((n) => s.headTotals.find((h) => h.name === n)?.amount ?? "")
            : []),
          "Total",
          s.totDr,
          s.totCr,
          "",
        ],
      ],
      columnStyles,
    };
  };

  const doExport = (kind: "pdf" | "word" | "excel" | "print") => {
    if (selected.size === 0) {
      toast.error("Tick at least one member first.");
      return;
    }
    if (!bulk || !members || !meta) {
      toast.error("Loading ledgers… try again in a moment.");
      return;
    }
    if (sections.length === 0) {
      toast.error("No entries in the ticked ledgers for this period — nothing to print.");
      return;
    }
    const tables = sections.map((s, i) => sectionTable(s, i === 0));
    const name = selected.size === 1 ? `member-ledger-${sections[0]?.member.code}` : "member-ledgers";
    if (kind === "pdf") exportPDF(meta, tables, `${name}.pdf`);
    else if (kind === "word") exportWord(meta, tables, `${name}.doc`);
    else if (kind === "excel") exportExcel(meta, tables, `${name}.xlsx`);
    else printTables(meta, tables);
  };

  return (
    <div>
      <PageHeader
        title="Member Ledger"
        description="Member ledger in the classic format — tick members, set the period and options, preview, then print or download."
      />

      {/* ---- Ledger selection panel (legacy layout) ---- */}
      <div className="panel">
        <div className="border-b bg-muted/50 px-4 py-2 text-sm font-medium">Ledger</div>
        <div className="grid gap-6 p-4 lg:grid-cols-[1fr_320px]">
          {/* Left: checkbox member list */}
          <div className="overflow-hidden rounded-md border">            <div className="grid grid-cols-[18px_36px_90px_1fr] items-center border-b bg-muted/50 px-2 py-1.5 text-xs font-semibold">
              <span />
              <Checkbox
                checked={allSelected}
                onCheckedChange={(c) => toggleAll(c === true)}
                aria-label="Select all members"
              />
              <span>Flat No.</span>
              <span>Member Name</span>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {sortedMembers.map((m, idx) => (
                <div
                  key={m._id}
                  onClick={() => setCursor(idx)}
                  className={`grid cursor-default grid-cols-[18px_36px_90px_1fr] items-center border-b px-2 py-1.5 text-sm last:border-b-0 ${
                    cursor === idx ? "bg-accent/60" : "hover:bg-accent/30"
                  }`
                  }
                >
                  <span className="text-[10px] leading-none text-foreground">{cursor === idx ? "▶" : ""}</span>
                  <Checkbox
                    checked={selected.has(m._id)}
                    onCheckedChange={(c) => toggleMember(m._id, c === true)}
                    aria-label={`Select ${m.name}`}
                  />
                  <span className="font-mono text-xs">{flatOf(m)}</span>
                  <span className="truncate uppercase">{m.name}</span>
                </div>
              ))}
              {sortedMembers.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No members yet — add them under Members.
                </p>
              )}
            </div>
          </div>

          {/* Right: dates + report format + options */}
          <div className="space-y-3">
            <div className="grid grid-cols-[84px_1fr] items-center gap-2">
              <Label htmlFor="ml-from" className="text-sm">From Date</Label>
              <Input
                id="ml-from"
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setMonth(""); }}
              />
            </div>
            <div className="grid grid-cols-[84px_1fr] items-center gap-2">
              <Label htmlFor="ml-to" className="text-sm">To Date</Label>
              <Input
                id="ml-to"
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setMonth(""); }}
              />
            </div>
            <div className="grid grid-cols-[84px_1fr] items-center gap-2">
              <Label htmlFor="ml-month" className="text-sm text-muted-foreground">Month</Label>
              <Input id="ml-month" type="month" value={month} onChange={(e) => applyMonth(e.target.value)} />
            </div>
            <div className="grid grid-cols-[84px_1fr] items-center gap-2">
              <Label htmlFor="ml-format" className="text-sm">Report Format</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "simple" | "detail")}>
                <SelectTrigger id="ml-format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple Ledger</SelectItem>
                  <SelectItem value="detail">Detail Ledger</SelectItem>
                </SelectContent>
              </Select>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("print")}
            className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
          >
            Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("pdf")}
            className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("word")}
            className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
          >
            Word
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("excel")}
            className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            Excel
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
          <EmptyHint>Tick one or more members above to build the Member Ledger report.</EmptyHint>
        ) : !bulk || !members ? (
          <EmptyHint>Loading ledgers…</EmptyHint>
        ) : sections.length === 0 ? (
          <EmptyHint>No entries in the ticked ledgers for this period — nothing to print.</EmptyHint>
        ) : (
          <ReportPreview title="Main Report" onPrint={() => doExport("print")}>
            <ReportLetterhead
              name={society.name}
              address={
                [society.address, society.city, society.state, society.pincode]
                  .filter(Boolean)
                  .join(", ") || undefined
              }
              registrationNo={society.registrationNo}
              title="Member Ledger"
              subtitle={`For the period ${formatDate(from)} to ${formatDate(to)}`}
            />

            <div className="mt-6 space-y-8">
              {sections.map((s, si) => {
                const isDetail = mode === "detail" && headNames.length > 0;
                return (
                  <div key={s.member._id} className={si > 0 && skipPage ? "border-t border-dashed pt-8" : ""}>
                    <p className="text-[13px] font-bold">{s.title}</p>
                    <table className="mt-2 w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="bg-[#312e81] text-left text-white [&>th]:pl-2">
                          <th className="w-20 py-1.5 pr-2 font-bold">Date</th>
                          <th className="w-24 py-1.5 pr-2 font-bold">Bill / Voucher No.</th>
                          {isDetail && headNames.map((n) => (
                            <th key={n} className="py-1.5 pr-2 text-right font-bold whitespace-nowrap">{headLabel(n)}</th>
                          ))}
                          <th className="py-1.5 pr-2 font-bold">Narration</th>
                          <th className="w-24 py-1.5 text-right font-bold">Debit</th>
                          <th className="w-24 py-1.5 text-right font-bold">Credit</th>
                          <th className="w-28 py-1.5 text-right font-bold">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.member.openingBalance !== 0 && (
                          <tr>
                            <td colSpan={2} />
                            {isDetail && headNames.map((n) => <td key={n} />)}
                            <td className="py-1 pr-2">
                              {s.member.openingBalance > 0 ? "To Opening balance old" : "By Opening balance old"}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {s.member.openingBalance > 0 ? formatMoney(s.member.openingBalance) : ""}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {s.member.openingBalance < 0 ? formatMoney(-s.member.openingBalance) : ""}
                            </td>
                            <td />
                          </tr>
                        )}
                        {s.items.map((r, i) => {
                          const headVals = isDetail
                            ? headNames.map((n) => r.heads?.find((h) => h.name === n)?.amount ?? "")
                            : [];
                          return (
                            <tr key={i} className="align-top">
                              <td className="whitespace-nowrap py-1 pr-2">{formatDate(r.date)}</td>
                              <td className="py-1 pr-2 font-mono text-[11px]">{r.voucherNo}</td>
                              {isDetail && headVals.map((v, vi) => (
                                <td key={vi} className="py-1 text-right tabular-nums">
                                  {typeof v === "number" ? formatMoney(v) : ""}
                                </td>
                              ))}
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
                          );
                        })}
                        <tr className="bg-indigo-50/70 text-[#312e81]">
                          <td colSpan={2} />
                          {isDetail && headNames.map((n) => <td key={n} />)}
                          <td className="py-1 pr-2 font-semibold">
                            {s.closing >= 0 ? "To Closing balance cd" : "By Closing balance cd"}
                          </td>
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {s.closing < 0 ? formatMoney(-s.closing) : ""}
                          </td>
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {s.closing > 0 ? formatMoney(s.closing) : ""}
                          </td>
                          <td />
                        </tr>
                        <tr className="border-t border-slate-300">
                          <td colSpan={2} />
                          {isDetail &&
                            headNames.map((n) => {
                              const v = s.headTotals.find((h) => h.name === n)?.amount ?? 0;
                              return (
                                <td key={n} className="py-1 text-right font-semibold tabular-nums">
                                  {v ? formatMoney(v) : ""}
                                </td>
                              );
                            })}
                          <td className="py-1 pr-2 font-semibold">Total</td>
                          <td className="py-1 text-right font-semibold tabular-nums">{formatMoney(s.totDr)}</td>
                          <td className="py-1 text-right font-semibold tabular-nums">{formatMoney(s.totCr)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </ReportPreview>
        )}
      </div>
    </div>
  );
}
