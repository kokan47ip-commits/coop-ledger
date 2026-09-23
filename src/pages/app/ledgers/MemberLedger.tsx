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
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
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
};

const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;

export default function MemberLedger() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;

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
          narration: [`${r.debit > 0 ? "To " : "By "}${label}${printNarration && r.note ? `\n${r.note}` : ""}`],
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
          narration: group.map((r) => {
            const label = r.particulars.split("—")[0].trim();
            return `${r.debit > 0 ? "To " : "By "}${label}${printNarration && r.note ? `\n${r.note}` : ""}`;
          }),
          debit: dr,
          credit: cr,
          balance: group[group.length - 1].balance,
          heads: mergedHeads.length > 0 ? mergedHeads : undefined,
        });
        i = j;
      }
    }
    const totDr = items.reduce((s, r) => s + r.debit, 0);
    const totCr = items.reduce((s, r) => s + r.credit, 0);
    const closing = rows.length > 0 ? rows[rows.length - 1].balance : mem.openingBalance;
    return { member: mem, title: `${mem.code}  ${mem.name}`.toUpperCase(), items, totDr, totCr, closing };
  };

  const sections: MemberSection[] =
    bulk && society
      ? sortedMembers
          .filter((m) => selected.has(m._id))
          .map((mem) => {
            const entry = bulk.find((b) => b.memberId === mem._id);
            return buildSection(mem, entry?.rows ?? []);
          })
      : [];

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
        s.member.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old",
        ...blank(),
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
        isDetail ? "" : r.narration.join("\n"),
        r.debit || "",
        r.credit || "",
        drCr(r.balance),
      ]);
    }
    if (body.length === 0) body.push(["", "", "No transactions in this period", "", "", ""]);

    const head = isDetail
      ? ["Date", "Bill / Voucher No.", ...headNames, "Narration", "Debit", "Credit", "Balance"]
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
          s.closing >= 0 ? "To Closing balance cd" : "By Closing balance cd",
          ...blank(),
          s.closing < 0 ? -s.closing : "",
          s.closing > 0 ? s.closing : "",
          "",
        ],
        ["", "", "Total", ...blank(), s.totDr, s.totCr, ""],
      ],
      columnStyles,
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (selected.size === 0) {
      toast.error("Tick at least one member first.");
      return;
    }
    if (!bulk || !meta) {
      toast.error("Loading ledgers… try again in a moment.");
      return;
    }
    const tables = sections.map((s, i) => sectionTable(s, i === 0));
    const name = selected.size === 1 ? `member-ledger-${sections[0]?.member.code}` : "member-ledgers";
    if (kind === "pdf") exportPDF(meta, tables, `${name}.pdf`);
    else if (kind === "word") exportWord(meta, tables, `${name}.doc`);
    else printTables(meta, tables);
  };

  return (
    <div>
      <PageHeader
        title="Member Ledger"
        description="Member ledger in the classic format — tick members, set the period and options, preview, then print or download."
      />

      {/* ---- Ledger selection panel (legacy layout) ---- */}
      <div className="rounded-lg border">
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
              <span>Unit Code</span>
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
                  <span className="font-mono text-xs">{m.code}</span>
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
          <EmptyHint>Tick one or more members above to build the Member Ledger report.</EmptyHint>
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
              <p className="mt-3 text-sm font-bold underline underline-offset-4">MEMBER LEDGER</p>
              <p className="text-[11px] text-slate-600">For the period {formatDate(from)} to {formatDate(to)}</p>
            </div>

            <div className="mt-6 space-y-8">
              {sections.map((s, si) => {
                const isDetail = mode === "detail" && headNames.length > 0;
                return (
                  <div key={s.member._id} className={si > 0 && skipPage ? "border-t border-dashed pt-8" : ""}>
                    <p className="text-[13px] font-bold">{s.title}</p>
                    <table className="mt-2 w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="border-y border-slate-800 text-left">
                          <th className="w-20 py-1.5 pr-2 font-bold">Date</th>
                          <th className="w-24 py-1.5 pr-2 font-bold">Bill / Voucher No.</th>
                          {isDetail && headNames.map((n) => (
                            <th key={n} className="py-1.5 pr-2 text-right font-bold whitespace-nowrap">{n}</th>
                          ))}
                          {!isDetail && <th className="py-1.5 pr-2 font-bold">Narration</th>}
                          <th className="w-24 py-1.5 text-right font-bold">Debit</th>
                          <th className="w-24 py-1.5 text-right font-bold">Credit</th>
                          <th className="w-28 py-1.5 text-right font-bold">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.member.openingBalance !== 0 && (
                          <tr>
                            <td colSpan={2} className="py-1 pr-2">
                              {s.member.openingBalance > 0 ? "By Opening balance old" : "To Opening balance old"}
                            </td>
                            {isDetail && headNames.map((n) => <td key={n} />)}
                            {!isDetail && <td />}
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
                              {!isDetail && (
                                <td className="py-1 pr-2">
                                  {r.narration.map((line, j) => (
                                    <span key={j} className={j > 0 ? "block text-[11px] text-slate-600" : "block"}>
                                      {line}
                                    </span>
                                  ))}
                                </td>
                              )}
                              <td className="py-1 text-right tabular-nums">{r.debit ? formatMoney(r.debit) : ""}</td>
                              <td className="py-1 text-right tabular-nums">{r.credit ? formatMoney(r.credit) : ""}</td>
                              <td className="py-1 text-right tabular-nums">{drCr(r.balance)}</td>
                            </tr>
                          );
                        })}
                        {s.items.length === 0 && (
                          <tr>
                            <td colSpan={isDetail ? 3 + headNames.length : 6} className="py-2 text-center text-slate-500">
                              No transactions in this period
                            </td>
                          </tr>
                        )}
                        <tr className="border-t border-slate-800">
                          <td colSpan={2} className="py-1 pr-2 font-semibold">
                            {s.closing >= 0 ? "To Closing balance cd" : "By Closing balance cd"}
                          </td>
                          {isDetail && headNames.map((n) => <td key={n} />)}
                          {!isDetail && <td />}
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {s.closing < 0 ? formatMoney(-s.closing) : ""}
                          </td>
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {s.closing > 0 ? formatMoney(s.closing) : ""}
                          </td>
                          <td />
                        </tr>
                        <tr className="border-t border-slate-300">
                          <td colSpan={2} className="py-1 pr-2 font-semibold">Total</td>
                          {isDetail && headNames.map((n) => <td key={n} />)}
                          {!isDetail && <td />}
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
