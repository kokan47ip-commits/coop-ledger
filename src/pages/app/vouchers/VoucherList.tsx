import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { Doc } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, RightMoney } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { formatDate, formatINR, VOUCHER_TYPE_LABEL } from "@/lib/format";
import { Download, FileText, Printer, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Voucher = Doc<"vouchers">;

const TYPE_FILTERS = [
  { value: "all", label: "All types" },
  { value: "member_receipt", label: "Member receipts" },
  { value: "other_receipt", label: "Other receipts" },
  { value: "payment", label: "Payments" },
  { value: "journal", label: "Journals" },
];

export function VoucherList({
  title,
  fixedType,
  description,
}: {
  title: string;
  description: string;
  fixedType?: "member_receipt" | "other_receipt" | "payment" | "journal";
}) {
  const { societyId, society } = useSociety();
  const vouchers = useQuery(
    api.vouchers.list,
    societyId ? { societyId } : "skip",
  ) as Voucher[] | undefined;
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip");
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip");
  const remove = useMutation(api.vouchers.remove);
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = [...(vouchers ?? [])].sort((a, b) =>
      a.date === b.date
        ? b.voucherNo.localeCompare(a.voucherNo)
        : b.date.localeCompare(a.date),
    );
    if (fixedType) list = list.filter((v) => v.type === fixedType);
    else if (typeFilter !== "all") list = list.filter((v) => v.type === typeFilter);
    return list;
  }, [vouchers, fixedType, typeFilter]);

  const accountName = (id: string) =>
    accounts?.find((a) => a._id === id)?.name ?? "—";

  const total = filtered.reduce((s, v) => s + v.total, 0);

  const meta: ExportMeta | null =
    society && vouchers
      ? {
          societyName: society.name,
          societyAddress: [society.address, society.city, society.state, society.pincode]
            .filter(Boolean)
            .join(", "),
          registrationNo: society.registrationNo,
          title,
          subtitle: `${filtered.length} vouchers · Total ${formatINR(total)}`,
        }
      : null;

  const buildTable = (): TableSpec => ({
    head: ["Voucher No", "Date", "Type", "Member", "Particulars", "Amount"],
    body: filtered.map((v) => {
      const member = members?.find((m) => m._id === v.memberId);
      const particulars =
        v.lines
          .map((l) => accountName(l.accountId))
          .filter((n, i, arr) => arr.indexOf(n) === i)
          .join(" / ") || v.narration || "";
      return [
        v.voucherNo,
        formatDate(v.date),
        VOUCHER_TYPE_LABEL[v.type],
        member?.name ?? "",
        v.narration ?? particulars,
        v.total,
      ];
    }),
    foot: [["", "", "", "", "TOTAL", total]],
    columnStyles: { 5: { halign: "right" } },
  });

  const doExport = (kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const table = buildTable();
    if (kind === "pdf") exportPDF(meta, [table], "vouchers.pdf");
    else if (kind === "word") exportWord(meta, [table], "vouchers.doc");
    else printTables(meta, [table]);
  };

  const del = async (v: Voucher) => {
    if (!societyId) return;
    if (!confirm(`Delete voucher ${v.voucherNo}?`)) return;
    try {
      await remove({ societyId, id: v._id });
      toast.success("Voucher deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!fixedType && (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_FILTERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-sm text-muted-foreground">
            {filtered.length} vouchers · {formatINR(total)}
          </span>
        </div>
        <div className="flex gap-2">
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
      </div>

      {!vouchers ? null : filtered.length === 0 ? (
        <EmptyHint>No vouchers recorded yet.</EmptyHint>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Voucher No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-16 text-right">Del</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => {
                const member = members?.find((m) => m._id === v.memberId);
                return (
                  <TableRow key={v._id}>
                    <TableCell className="font-mono text-xs font-medium">{v.voucherNo}</TableCell>
                    <TableCell>{formatDate(v.date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{VOUCHER_TYPE_LABEL[v.type]}</Badge>
                    </TableCell>
                    <TableCell>{member?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {v.narration ?? v.lines.map((l) => accountName(l.accountId)).join(" / ")}
                    </TableCell>
                    <TableCell className="text-right"><RightMoney value={v.total} /></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(v)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
