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

/** Statement serial: the user-defined Print No., else the running position. */
function serialOf(printNo: string | undefined, position: number): string {
  return printNo ?? String(position);
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
    const rows: (string | number)[][] = [];
    const maxLen = Math.max(bs?.assets.length ?? 0, bs?.liabilities.length ?? 0);
    rows.push([
      "",
      "",
      "LIABILITIES & FUNDS",
      "Current Year (₹)",
      "Previous Year (₹)",
      "",
      "ASSETS",
      "Current Year (₹)",
      "Previous Year (₹)",
    ]);
    for (let i = 0; i < maxLen; i++) {
      const li = bs?.liabilities[i];
      const a = bs?.assets[i];
      const liHead = li ? (i === 0 || bs!.liabilities[i - 1]!.group !== li.group) : false;
      const aHead = a ? (i === 0 || bs!.assets[i - 1]!.group !== a.group) : false;
      if (liHead || aHead) {
        rows.push([
          "",
          "",
          liHead ? (li!.group ?? "").toUpperCase() : "",
          "",
          "",
          "",
          aHead ? (a!.group ?? "ASSETS").toUpperCase() : "",
          "",
          "",
        ]);
      }
      rows.push([
        "",
        li ? serialOf(li.printNo, i + 1) : "",
        li ? `    ${li.name}` : "",
        li ? li.amount : "",
        li ? (li.prev ?? 0) : "",
        a ? serialOf(a.printNo, i + 1) : "",
        a ? `    ${a.name}` : "",
        a ? a.amount : "",
        a ? (a.prev ?? 0) : "",
      ]);
    }
    rows.push([
      "",
      "",
      "Total",
      bs?.totalLiabilities ?? 0,
      bs?.totalLiabilitiesPrev ?? 0,
      "",
      "Total",
      bs?.totalAssets ?? 0,
      bs?.totalAssetsPrev ?? 0,
    ]);
    return {
      head: [
        "",
        "S.No.",
        "Liabilities & Funds",
        "Current Year (₹)",
        "Previous Year (₹)",
        "S.No.",
        "Assets",
        "Current Year (₹)",
        "Previous Year (₹)",
      ],
      body: rows,
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
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

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Balance Sheet"
        description="Form N statement — funds and liabilities under the prescribed Roman-numbered headings on one side, assets on the other, each opening/closing figure paired with its previous-year comparative."
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
            className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800 dark:border-violet-900/60 dark:text-violet-300"
          >
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </div>

      {!bs ? null : (
        <div className="panel overflow-hidden">
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
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#312e81] text-xs font-semibold uppercase tracking-[0.14em] text-white">
                <td className="px-5 py-2.5">Liabilities &amp; Funds</td>
                <td className="w-12 px-2 py-2.5 text-center">S.No.</td>
                <td className="w-36 px-5 py-2.5 text-right">Current Year (₹)</td>
                <td className="w-28 px-5 py-2.5 text-right">Previous Year (₹)</td>
                <td className="border-l px-5 py-2.5">Assets</td>
                <td className="w-12 px-2 py-2.5 text-center">S.No.</td>
                <td className="w-36 border-l px-5 py-2.5 text-right">Current Year (₹)</td>
                <td className="w-28 border-l px-5 py-2.5 text-right">Previous Year (₹)</td>
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
                return (
                  <Fragment key={i}>
                    {(liHead || aHead) && (
                      <tr className="border-y bg-indigo-50/60 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#312e81]/80">
                        <td className="px-5 py-1.5">{liHead ? (li!.group ?? "") : ""}</td>
                        <td />
                        <td />
                        <td />
                        <td className="border-l px-5 py-1.5">{aHead ? (a!.group ?? "Assets") : ""}</td>
                        <td />
                        <td className="border-l" />
                        <td className="border-l" />
                      </tr>
                    )}
                    <tr className="border-b last:border-0">
                      <td className="px-5 py-2.5">{li?.name ?? ""}</td>
                      <td className="w-12 px-2 py-2.5 text-center font-mono text-xs">{li ? serialOf(li.printNo, i + 1) : ""}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{li ? money(li.amount) : ""}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {li ? money(li.prev ?? 0) : ""}
                      </td>
                      <td className="border-l px-5 py-2.5">{a?.name ?? ""}</td>
                      <td className="w-12 px-2 py-2.5 text-center font-mono text-xs">{a ? serialOf(a.printNo, i + 1) : ""}</td>
                      <td className="border-l px-5 py-2.5 text-right tabular-nums">{a ? money(a.amount) : ""}</td>
                      <td className="border-l px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {a ? money(a.prev ?? 0) : ""}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              <tr className="bg-indigo-50 text-base font-semibold text-[#312e81]">
                <td className="px-5 py-4">Total</td>
                <td />
                <td className="px-5 py-4 text-right tabular-nums">{money(bs.totalLiabilities)}</td>
                <td className="px-5 py-4 text-right tabular-nums">{money(bs.totalLiabilitiesPrev)}</td>
                <td className="border-l px-5 py-4">Total</td>
                <td />
                <td className="border-l px-5 py-4 text-right tabular-nums">{money(bs.totalAssets)}</td>
                <td className="border-l px-5 py-4 text-right tabular-nums">{money(bs.totalAssetsPrev)}</td>
              </tr>
            </tbody>
          </table>
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
