import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { ReportPreview } from "@/components/ReportPreview";
import {
  exportPDF,
  exportWord,
  printTables,
  type ExportMeta,
  type TableSpec,
} from "@/lib/export";
import { effectiveFyPeriod, formatDate, formatMoney, monthRangeISO } from "@/lib/format";
import { useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

type LedgerRow = {
  date: string;
  voucherNo: string;
  voucherType: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
  note?: string;
  heads?: { name: string; amount: number }[];
};

const drCr = (n: number) => `${formatMoney(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;

export default function PortalLedger() {
  const { societyId, society, memberBinding } = useSociety();
  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [month, setMonth] = useState("");
  const [detailed, setDetailed] = useState(false);

  const rows = useQuery(
    api.memberPortal.myLedger,
    societyId ? { societyId, fromDate: from, toDate: to } : "skip",
  ) as LedgerRow[] | null | undefined;

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

  const flatLabel =
    [memberBinding?.wing, memberBinding?.flatNo].filter(Boolean).join("-") ||
    memberBinding?.code ||
    "";

  /** Detailed mode splits bill rows into one row per charge head. */
  const displayRows: LedgerRow[] = (() => {
    if (!rows) return [];
    if (!detailed) return rows;
    const out: LedgerRow[] = [];
    for (const r of rows) {
      if (r.heads && r.heads.length > 1) {
        r.heads.forEach((h, i) => {
          out.push({
            ...r,
            voucherNo: i === 0 ? r.voucherNo : "",
            date: i === 0 ? r.date : "",
            particulars: `  ${h.name}`,
            debit: i === 0 ? r.debit : 0,
            credit: 0,
            note: undefined,
            heads: undefined,
          });
        });
      } else {
        out.push(r);
      }
    }
    return out;
  })();

  const totDr = displayRows.reduce((s, r) => s + r.debit, 0);
  const totCr = displayRows.reduce((s, r) => s + r.credit, 0);
  const closing = displayRows.length > 0
    ? displayRows[displayRows.length - 1].balance
    : 0;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "MEMBER LEDGER",
        subtitle: `${memberBinding?.name ?? "Member"} — Flat ${flatLabel} — ${formatDate(from)} to ${formatDate(to)}`,
      }
    : null;

  const buildTables = (): TableSpec[] => {
    const body = displayRows.length
      ? displayRows.map((r) => [
          formatDate(r.date),
          r.voucherNo,
          r.particulars,
          r.debit !== 0 ? formatMoney(r.debit) : "",
          r.credit !== 0 ? formatMoney(r.credit) : "",
          drCr(r.balance),
        ])
      : [["", "", "No transactions in this period", "", "", ""]];
    return [
      {
        head: ["Date", "Voucher No.", "Particulars", "Debit", "Credit", "Balance"],
        body,
        foot: [
          [
            "",
            "",
            closing >= 0 ? "To Closing balance c/d" : "By Closing balance c/d",
            formatMoney(totDr),
            formatMoney(totCr),
            drCr(closing),
          ],
        ],
        columnStyles: {
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
      },
    ];
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    try {
      if (kind === "pdf") exportPDF(meta, buildTables(), "member-ledger.pdf");
      else if (kind === "word") exportWord(meta, buildTables(), "member-ledger.doc");
      else printTables(meta, buildTables());
      toast.success(
        kind === "pdf" ? "PDF downloaded" : kind === "word" ? "Word file downloaded" : "Sent to printer",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  if (rows === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Your login is not linked to a flat in this society.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Label className="text-xs text-muted-foreground">Month</Label>
          <Select value={month} onValueChange={applyMonth}>
            <SelectTrigger size="sm" className="mt-1">
              <SelectValue placeholder="Whole year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Whole year</SelectItem>
              {Array.from({ length: 12 }, (_, i) => {
                const [y] = fy.from.split("-");
                const startMonth = Number(fy.from.split("-")[1]);
                const idx = (startMonth - 1 + i) % 12;
                const yy = (startMonth - 1 + i) >= 12 ? Number(y) + 1 : Number(y);
                const value = `${yy}-${String(idx + 1).padStart(2, "0")}`;
                return (
                  <SelectItem key={value} value={value}>
                    {new Date(`${value}-01T00:00:00`).toLocaleString("en", { month: "short", year: "numeric" })}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setMonth("");
            }}
            className="mt-1"
          />
        </div>
        <div className="w-36">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setMonth("");
            }}
            className="mt-1"
          />
        </div>
        <label className="flex items-center gap-2 pb-1 text-sm">
          <Checkbox
            checked={detailed}
            onCheckedChange={(v) => setDetailed(v === true)}
          />
          Detailed entries
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => doExport("pdf")}>
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("word")}>
            Word
          </Button>
          <Button variant="outline" size="sm" onClick={() => doExport("print")}>
            Print
          </Button>
        </div>
      </div>

      <ReportPreview
        title="Member Ledger"
        onPrint={() => doExport("print")}
      >
        <div className="px-2 py-1">
          <h1 className="text-center text-base font-bold">{society?.name}</h1>
          <p className="text-center text-xs">MEMBER LEDGER</p>
          <p className="mb-3 text-center text-[11px]">
            {memberBinding?.name} — Flat {flatLabel} · {formatDate(from)} to {formatDate(to)}
          </p>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="py-1 text-left">Date</th>
                <th className="py-1 text-left">Voucher No.</th>
                <th className="py-1 text-left">Particulars</th>
                <th className="py-1 text-right">Debit</th>
                <th className="py-1 text-right">Credit</th>
                <th className="py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="py-0.5 pr-2 align-top">{formatDate(r.date)}</td>
                  <td className="py-0.5 pr-2 align-top">{r.voucherNo}</td>
                  <td className="py-0.5 pr-2 align-top">
                    {r.particulars}
                    {r.note && <span className="block text-[10px] text-slate-500">{r.note}</span>}
                    {r.heads && r.heads.length > 0 && (
                      <span className="block text-[10px] text-slate-500">
                        {r.heads.map((h) => `${h.name}: ${formatMoney(h.amount)}`).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 text-right align-top tabular-nums">
                    {r.debit !== 0 ? formatMoney(r.debit) : ""}
                  </td>
                  <td className="py-0.5 text-right align-top tabular-nums">
                    {r.credit !== 0 ? formatMoney(r.credit) : ""}
                  </td>
                  <td className="py-0.5 text-right align-top tabular-nums">{drCr(r.balance)}</td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-center text-slate-500">
                    No transactions in this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ReportPreview>
    </div>
  );
}
