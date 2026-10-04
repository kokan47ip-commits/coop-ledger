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
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { exportExcel, exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { useCommitteeSignatures } from "@/lib/committee";
import { effectiveFyPeriod, formatDate, formatMoney } from "@/lib/format";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";

type Account = Doc<"accounts">;

type BankRow = {
  date: string;
  voucherNo: string;
  narration: string[];
  debit: number;
  credit: number;
  balance: number;
};

type BankSection = {
  accountId: Id<"accounts">;
  code: string;
  name: string;
  opening: number;
  rows: BankRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
};

/** The codebase's bank-vs-cash convention: a bank_cash ledger whose name says "bank". */
const isBankAccount = (a: Account) => /bank/i.test(a.name);

const drCr = (n: number) => `${formatMoney(n)} ${n >= 0 ? "Dr" : "Cr"}`;

export default function BankBook() {
  const { societyId, society } = useSociety();
  const signatures = useCommitteeSignatures();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  // Banks only; if the society never named a ledger "bank", fall back to all
  // cash & bank ledgers so the register is still usable.
  const banks = bankAccounts.filter(isBankAccount);
  const bookAccounts = banks.length > 0 ? banks : bankAccounts;

  const fy = effectiveFyPeriod(society);
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [accountId, setAccountId] = useState<string>("all");

  const sections = useQuery(
    api.api.cashBook,
    societyId
      ? {
          societyId,
          fromDate: from,
          toDate: to,
          accountId: accountId !== "all" ? (accountId as Id<"accounts">) : undefined,
        }
      : "skip",
  ) as BankSection[] | undefined;
  const bankSections = (sections ?? []).filter(
    (s) => banks.length === 0 || banks.some((a) => a._id === s.accountId),
  );

  const meta: ExportMeta | null = society
    ? {
        societyName: society.name,
        societyAddress: [society.address, society.city, society.state, society.pincode]
          .filter(Boolean)
          .join(", "),
        registrationNo: society.registrationNo,
        title: "Bank Book",
        subtitle: `For the period ${formatDate(from)} to ${formatDate(to)}`,
        signatures,
      }
    : null;

  const buildTables = (): TableSpec[] =>
    bankSections.map((s) => {
      const body: (string | number)[][] = [
        [
          "",
          "",
          s.opening >= 0 ? "By Opening balance old" : "To Opening balance old",
          s.opening > 0 ? s.opening : "",
          s.opening < 0 ? -s.opening : "",
          "",
        ],
        ...s.rows.map((r) => [
          formatDate(r.date),
          r.voucherNo,
          r.narration.join("\n"),
          r.debit || "",
          r.credit || "",
          drCr(r.balance),
        ]),
      ];
      return {
        sectionTitle: `${s.code}  ${s.name}`.toUpperCase(),
        head: ["Date", "Voucher No", "Narration", "Debit", "Credit", "Balance"],
        body,
        foot: [["", "", "TOTAL", s.totalDebit, s.totalCredit, drCr(s.closing)]],
        columnStyles: {
          0: { cellWidth: 58 },
          1: { cellWidth: 58 },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
      };
    });

  const doExport = (kind: "pdf" | "word" | "excel" | "print") => {
    if (!meta) return;
    if (kind === "pdf") exportPDF(meta, buildTables(), "bank-book.pdf");
    else if (kind === "word") exportWord(meta, buildTables(), "bank-book.doc");
    else if (kind === "excel") exportExcel(meta, buildTables(), "bank-book.xlsx");
    else printTables(meta, buildTables());
  };

  const grandDebit = bankSections.reduce((s, x) => s + x.totalDebit, 0);
  const grandCredit = bankSections.reduce((s, x) => s + x.totalCredit, 0);

  return (
    <div>
      <PageHeader
        title="Bank Book"
        description="Bank-only day book — deposits as To, withdrawals and cleared cheques as By, with opening balance, running Dr/Cr balance and cheque references for every bank account."
      />

      <div className="panel mb-6 grid gap-4 p-5 sm:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="bb-from">From</Label>
          <Input id="bb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bb-to">To</Label>
          <Input id="bb-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Bank account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {banks.length > 0 ? "All bank accounts" : "All cash & bank accounts"}
              </SelectItem>
              {bookAccounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {bankSections === undefined
            ? "Loading…"
            : `${bankSections.length} ${bankSections.length === 1 ? "account" : "accounts"} · deposits ${formatMoney(grandDebit)} · withdrawals ${formatMoney(grandCredit)}`}
        </p>
        <div className="flex gap-2">
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
            onClick={() => doExport("excel")}
            className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            <FileSpreadsheet className="size-4" /> Excel
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

      {bankSections !== undefined && bankSections.length === 0 ? (
        <EmptyHint>No bank accounts found — add one under Chart of Accounts (kind: Cash &amp; Bank).</EmptyHint>
      ) : (
        <div className="space-y-8">
          {bankSections.map((s) => (
            <div key={s.accountId} className="panel">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
                <p className="text-sm font-semibold tracking-wide">
                  {s.code}&ensp;{s.name.toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Opening <span className="tabular-nums text-foreground">{drCr(s.opening)}</span>
                  <span className="mx-2">·</span>
                  Closing <span className="tabular-nums text-foreground">{drCr(s.closing)}</span>
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-24">Voucher No</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead className="w-28 text-right">Debit</TableHead>
                    <TableHead className="w-28 text-right">Credit</TableHead>
                    <TableHead className="w-32 text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-accent/30 hover:bg-accent/30">
                    <TableCell colSpan={2} />
                    <TableCell className="font-medium">
                      {s.opening >= 0 ? "By Opening balance old" : "To Opening balance old"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.opening > 0 ? formatMoney(s.opening) : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.opening < 0 ? formatMoney(-s.opening) : ""}
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                  </TableRow>
                  {s.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.voucherNo}</TableCell>
                      <TableCell>
                        <span className="font-medium">{r.narration[0]}</span>
                        {r.narration.slice(1).map((line, j) => (
                          <span key={j} className="block text-xs text-muted-foreground">{line}</span>
                        ))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.debit ? formatMoney(r.debit) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.credit ? formatMoney(r.credit) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{drCr(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 hover:bg-transparent">
                    <TableCell colSpan={3} className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(s.totalDebit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(s.totalCredit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {drCr(s.closing)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
