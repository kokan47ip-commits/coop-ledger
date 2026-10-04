import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader, ReportLetterhead } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate } from "@/lib/format";
import { Download, FileText, Printer } from "lucide-react";
import { Fragment, useState } from "react";
import { useQuery } from "convex/react";

type Row = {
  code: string;
  name: string;
  amount: number;
  printNo?: string;
  /** Form N fund heading this liability/fund row files under. */
  group?: string;
  /** Previous-year figure (negative means it sat on the opposite side). */
  prev?: number;
};

type BSResult = {
  assets: Row[];
  liabilities: Row[];
  totalAssets: number;
  totalLiabilities: number;
  totalAssetsPrev: number;
  totalLiabilitiesPrev: number;
};

/**
 * Per-group subtotal of the current-year figures — the statement's TOTAL
 * column, printed against the last ledger of each group (reference format).
 */
function groupTotals(rows: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.group!, (m.get(r.group!) ?? 0) + r.amount);
  return m;
}

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n);

export default function BalanceSheet() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const period = effectiveFyPeriod(society);
  const [to, setTo] = useState(period.to);

  const bs = useQuery(
    api.api.balanceSheet,
    societyId ? { societyId, toDate: to } : "skip",
  ) as BSResult | undefined;

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Balance Sheet",
        subtitle: `As at ${formatDate(to)}`,
        signatures,
      }
    : null;

  const buildTable = (): TableSpec => {
    const liRows = bs?.liabilities ?? [];
    const aRows = bs?.assets ?? [];
    const liTotals = groupTotals(liRows);
    const aTotals = groupTotals(aRows);
    const rows: (string | number)[][] = [];
    // Column order per side: Previous Year | Particulars | Current Year | Total.
    rows.push(["", "", "LIABILITIES & FUNDS", "", "", "", "", "ASSETS", "", ""]);
    const maxLen = Math.max(liRows.length, aRows.length);
    for (let i = 0; i < maxLen; i++) {
      const li = liRows[i];
      const a = aRows[i];
      const liHead = li ? (i === 0 || liRows[i - 1]!.group !== li.group) : false;
      const aHead = a ? (i === 0 || aRows[i - 1]!.group !== a.group) : false;
      if (liHead || aHead) {
        rows.push([
          "",
          "",
          liHead ? (li!.group ?? "").toUpperCase() : "",
          "",
          "",
          "",
          "",
          aHead ? (a!.group ?? "ASSETS").toUpperCase() : "",
          "",
          "",
        ]);
      }
      // The group's TOTAL figure prints against its last ledger.
      const liLast = li && (i === liRows.length - 1 || liRows[i + 1]!.group !== li.group);
      const aLast = a && (i === aRows.length - 1 || aRows[i + 1]!.group !== a.group);
      rows.push([
        "",
        li ? (li.prev ?? 0) : "",
        li ? `    ${li.name}` : "",
        li ? li.amount : "",
        li && liLast ? (liTotals.get(li.group!) ?? 0) : "",
        "",
        a ? (a.prev ?? 0) : "",
        a ? `    ${a.name}` : "",
        a ? a.amount : "",
        a && aLast ? (aTotals.get(a.group!) ?? 0) : "",
      ]);
    }
    rows.push([
      "",
      bs?.totalLiabilitiesPrev ?? 0,
      "Total",
      bs?.totalLiabilities ?? 0,
      "",
      "",
      bs?.totalAssetsPrev ?? 0,
      "Total",
      bs?.totalAssets ?? 0,
      "",
    ]);
    return {
      head: [
        "",
        "Previous Year (₹)",
        "Liabilities & Funds",
        "Current Year (₹)",
        "Total",
        "",
        "Previous Year (₹)",
        "Assets",
        "Current Year (₹)",
        "Total",
      ],
      body: rows,
      columnStyles: {
        1: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        6: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
      },
    };
  };

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "balance-sheet.pdf");
    else if (kind === "word") exportWord(meta, [table], "balance-sheet.doc");
    else printTables(meta, [table]);
  };

  const liTotals = bs ? groupTotals(bs.liabilities) : new Map<string, number>();
  const aTotals = bs ? groupTotals(bs.assets) : new Map<string, number>();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Balance Sheet"
        description="Form N statement — funds and liabilities under the prescribed Roman-numbered headings on one side, assets on the other. Columns run Previous Year | Particulars | Current Year | Total, every Chart of Accounts ledger is printed (0.00 when nil), and group totals foot the Total column."
      />

      <div className="panel mb-8 grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="bs-to">As on</Label>
          <Input id="bs-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex items-end justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("pdf")}
            className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <Download className="size-4" /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("word")}
            className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
          >
            <FileText className="size-4" /> Word
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport("print")}
            className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
          >
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      {!bs ? null : (
        <div className="panel">
          <ReportLetterhead
            className="mx-0 mt-0"
            name={society?.name ?? ""}
            address={
              [society?.address, society?.city, society?.state, society?.pincode]
                .filter(Boolean)
                .join(", ") || undefined
            }
            registrationNo={society?.registrationNo}
            title="Balance Sheet"
            subtitle={`As at ${formatDate(to)}`}
          />
          {/* Scroll frame: the report slides horizontally when wider than the
              screen, headings stay frozen, vertical bar stays in view. */}
          <div className="report-scroll">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="bg-[#312e81] text-xs font-semibold uppercase tracking-[0.14em] text-white">
                  <td className="w-32 px-3 py-2.5 text-right">Previous Year (₹)</td>
                  <td className="px-5 py-2.5">Liabilities &amp; Funds</td>
                  <td className="w-36 px-5 py-2.5 text-right">Current Year (₹)</td>
                  <td className="w-28 px-5 py-2.5 text-right">Total</td>
                  <td className="w-32 border-l px-3 py-2.5 text-right">Previous Year (₹)</td>
                  <td className="border-l px-5 py-2.5">Assets</td>
                  <td className="w-36 border-l px-5 py-2.5 text-right">Current Year (₹)</td>
                  <td className="w-28 border-l px-5 py-2.5 text-right">Total</td>
                </tr>
              </thead>
              <tbody>
                {Array.from({
                  length: Math.max(bs.assets.length, bs.liabilities.length, 1),
                }).map((_, i) => {
                  const li = bs.liabilities[i];
                  const a = bs.assets[i];
                  const liHead = li ? (i === 0 || bs.liabilities[i - 1]!.group !== li.group) : false;
                  const aHead = a ? (i === 0 || bs.assets[i - 1]!.group !== a.group) : false;
                  const liLast =
                    li && (i === bs.liabilities.length - 1 || bs.liabilities[i + 1]!.group !== li.group);
                  const aLast =
                    a && (i === bs.assets.length - 1 || bs.assets[i + 1]!.group !== a.group);
                  return (
                    <Fragment key={i}>
                      {(liHead || aHead) && (
                        <tr className="border-y bg-indigo-50/60 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#312e81]/80">
                          <td />
                          <td className="px-5 py-1.5">{liHead ? (li!.group ?? "").toUpperCase() : ""}</td>
                          <td />
                          <td />
                          <td className="border-l" />
                          <td className="border-l px-5 py-1.5">{aHead ? (a!.group ?? "Assets").toUpperCase() : ""}</td>
                          <td className="border-l" />
                          <td className="border-l" />
                        </tr>
                      )}
                      <tr className="border-b last:border-0">
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {li ? money(li.prev ?? 0) : ""}
                        </td>
                        <td className="px-5 py-2.5">{li?.name ?? ""}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{li ? money(li.amount) : ""}</td>
                        <td
                          className={`px-5 py-2.5 text-right tabular-nums ${
                            liLast ? "font-semibold text-[#312e81]" : ""
                          }`}
                        >
                          {li && liLast ? money(liTotals.get(li.group!) ?? 0) : ""}
                        </td>
                        <td className="border-l px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {a ? money(a.prev ?? 0) : ""}
                        </td>
                        <td className="border-l px-5 py-2.5">{a?.name ?? ""}</td>
                        <td className="border-l px-5 py-2.5 text-right tabular-nums">{a ? money(a.amount) : ""}</td>
                        <td
                          className={`border-l px-5 py-2.5 text-right tabular-nums ${
                            aLast ? "font-semibold text-[#312e81]" : ""
                          }`}
                        >
                          {a && aLast ? money(aTotals.get(a.group!) ?? 0) : ""}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="bg-indigo-50 text-base font-semibold text-[#312e81]">
                  <td className="px-3 py-4 text-right tabular-nums">{money(bs.totalLiabilitiesPrev)}</td>
                  <td className="px-5 py-4">Total</td>
                  <td className="px-5 py-4 text-right tabular-nums">{money(bs.totalLiabilities)}</td>
                  <td />
                  <td className="border-l px-3 py-4 text-right tabular-nums">{money(bs.totalAssetsPrev)}</td>
                  <td className="border-l px-5 py-4">Total</td>
                  <td className="border-l px-5 py-4 text-right tabular-nums">{money(bs.totalAssets)}</td>
                  <td className="border-l" />
                </tr>
              </tbody>
            </table>
          </div>
          {Math.abs(bs.totalAssets - bs.totalLiabilities) > 0.01 && (
            <p className="border-t bg-destructive/5 px-5 py-3 text-xs text-destructive">
              Difference of {money(Math.abs(bs.totalAssets - bs.totalLiabilities))} — check opening balances
              and the receivable account configuration.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
