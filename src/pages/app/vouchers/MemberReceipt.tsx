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
import { PageHeader } from "@/components/PageParts";
import { receiptPdf, receiptPrint, receiptWord, periodLabelLong, type LegacyReceiptData } from "@/lib/billDoc";
import { formatDate, formatPeriod, formatMoney, todayISO } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { VoucherList } from "./VoucherList";

type Member = Doc<"members">;
type Bill = Doc<"bills">;
type Account = Doc<"accounts">;
type Voucher = Doc<"vouchers">;

/**
 * Legacy-style Receipt Voucher screen for member collections: Book Code /
 * Voucher Date / Last Voucher No header, the Cash/Bank side with its current
 * balance, cheque details, and an entries grid showing the auto-posted
 * Dr Bank/Cash · Cr Member(receivable) lines before saving. Also serves as
 * the edit screen with ?edit=<voucherId> (header fields only — the amount and
 * its bill settlements stay fixed).
 */
export default function MemberReceipt() {
  const societyCtx = useSociety();
  const { societyId } = societyCtx;
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const members = useQuery(api.members.list, societyId ? { societyId } : "skip") as Member[] | undefined;
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const bills = useQuery(api.bills.list, societyId ? { societyId } : "skip") as Bill[] | undefined;
  const editing = useQuery(
    api.vouchers.getMany,
    societyId && editId ? { societyId, ids: [editId as Id<"vouchers">] } : "skip",
  ) as Voucher[] | undefined;
  const editVoucherDoc = editing?.[0];
  const createVoucher = useMutation(api.vouchers.create);
  const updateVoucher = useMutation(api.vouchers.update);
  const removeVoucher = useMutation(api.vouchers.remove);
  const lastNo = useQuery(
    api.vouchers.lastNo,
    societyId && !editId ? { societyId, type: "member_receipt" } : "skip",
  ) as { last: number; lastVoucherNo: string | null; prefix: string } | undefined;

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const [form, setForm] = useState({
    memberId: "",
    date: todayISO(),
    amount: "",
    mode: "cash",
    bankCashAccountId: "",
    chequeNo: "",
    chequeDate: "",
    bankName: "",
    narration: "",
  });

  const outstandingBills = useMemo(() => {
    if (!form.memberId || !bills) return [];
    return bills
      .filter((b) => b.memberId === form.memberId && b.total > b.paidAmount)
      .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  }, [bills, form.memberId]);

  const amountNum = Number(form.amount) || 0;

  const previewAllocation = useMemo(() => {
    let remaining = amountNum;
    const rows: { bill: Bill; take: number }[] = [];
    for (const b of outstandingBills) {
      if (remaining <= 0) break;
      const need = b.total - b.paidAmount;
      const take = Math.min(need, remaining);
      rows.push({ bill: b, take });
      remaining -= take;
    }
    return { rows, unallocated: remaining };
  }, [outstandingBills, amountNum]);

  const selectedMember = members?.find((m) => m._id === form.memberId);
  const selectedBank = bankAccounts.find((a) => a._id === form.bankCashAccountId) ?? bankAccounts[0];

  const bankBal = useQuery(
    api.api.accountBalance,
    societyId && (form.bankCashAccountId || selectedBank?._id)
      ? {
          societyId,
          accountId: (form.bankCashAccountId || selectedBank?._id) as Id<"accounts">,
          asOf: form.date,
        }
      : "skip",
  ) as { balance: number; debitNature: boolean } | undefined;

  const balText = (b: { balance: number } | undefined) =>
    b ? `${formatMoney(Math.abs(b.balance))} ${b.balance >= 0 ? "Dr" : "Cr"}` : "—";

  const composeReference = () =>
    form.chequeNo
      ? form.chequeDate
        ? `${form.chequeNo} dt ${form.chequeDate}`
        : form.chequeNo
      : undefined;

  const composeNarration = () =>
    [form.narration, form.bankName ? `Bank: ${form.bankName}` : ""].filter(Boolean).join(" — ") ||
    undefined;

  const receivableAccount = (accounts ?? []).find((a) => a.kind === "receivable");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !form.memberId) return;
    if (!amountNum || amountNum <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    const bankId = form.bankCashAccountId || bankAccounts[0]?._id;
    // With no outstanding bills there are no allocations — send explicit
    // balanced lines (Dr Bank/Cash, Cr Members Receivable) so the backend
    // accepts an advance/against-account receipt.
    const noAllocLines =
      previewAllocation.rows.length === 0 && bankId && receivableAccount
        ? [
            { accountId: bankId as Id<"accounts">, debit: amountNum, credit: 0 },
            { accountId: receivableAccount._id, debit: 0, credit: amountNum },
          ]
        : [];
    if (previewAllocation.rows.length === 0 && !noAllocLines.length) {
      toast.error(
        "No outstanding bills and no Members Receivable / bank-cash account found — add them in Chart of Accounts first.",
      );
      return;
    }
    try {
      await createVoucher({
        societyId,
        type: "member_receipt",
        date: form.date,
        memberId: form.memberId as Id<"members">,
        mode: form.mode,
        bankCashAccountId: bankId as never,
        reference: composeReference(),
        narration: composeNarration(),
        lines: noAllocLines,
        allocations: previewAllocation.rows.map((r) => ({ billId: r.bill._id, amount: r.take })),
      });
      toast.success(
        `Receipt saved${previewAllocation.unallocated > 0 ? ` · ${formatUnallocated(previewAllocation.unallocated)} kept as advance` : ""}`,
      );
      setForm({
        ...form,
        memberId: "",
        amount: "",
        chequeNo: "",
        chequeDate: "",
        bankName: "",
        narration: "",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save receipt");
    }
  };

  /** Update an existing member receipt — header fields only (total and bill
   * allocations stay fixed; delete & re-enter to change the amount). */
  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !editId || !editVoucherDoc) return;
    try {
      await updateVoucher({
        societyId,
        id: editId as Id<"vouchers">,
        date: form.date,
        mode: form.mode,
        bankCashAccountId: (form.bankCashAccountId || editVoucherDoc.bankCashAccountId) as never,
        reference: composeReference(),
        narration: composeNarration(),
        lines: editVoucherDoc.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
        })),
      });
      toast.success("Receipt updated");
      setSearchParams({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update receipt");
    }
  };

  const delEdit = async () => {
    if (!societyId || !editId || !editVoucherDoc) return;
    if (!confirm(`Delete receipt ${editVoucherDoc.voucherNo}? Bill settlements for it will be reversed.`)) return;
    try {
      await removeVoucher({ societyId, id: editId as Id<"vouchers"> });
      toast.success("Receipt deleted");
      setSearchParams({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // Prefill the edit form once per voucher — guarded so reactive refetches
  // (new object identity) never overwrite the user's in-progress edits.
  const [editLoadedFor, setEditLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!editId || !editVoucherDoc || editLoadedFor === editId) return;
    // Narration is stored as "text — Bank: X"; split it back apart.
    const raw = editVoucherDoc.narration ?? "";
    const bankMatch = raw.match(/— Bank: (.+)$/);
    const ref = editVoucherDoc.reference ?? "";
    setForm({
      memberId: (editVoucherDoc.memberId as string) ?? "",
      date: editVoucherDoc.date,
      amount: String(editVoucherDoc.total),
      mode: editVoucherDoc.mode ?? "cash",
      bankCashAccountId: (editVoucherDoc.bankCashAccountId as string) ?? "",
      chequeNo: ref.includes(" dt ") ? ref.split(" dt ")[0] : ref,
      chequeDate: ref.includes(" dt ") ? ref.split(" dt ")[1]?.slice(0, 10) ?? "" : "",
      bankName: bankMatch?.[1]?.trim() ?? "",
      narration: bankMatch ? raw.slice(0, bankMatch.index).trimEnd() : raw,
    });
    setEditLoadedFor(editId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, editLoadedFor]);

  const formatUnallocated = (n: number) =>
    `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(n)}`;

  /** Print the legacy-format receipt for a saved member receipt voucher. */
  const printReceiptFor = (v: Doc<"vouchers">, kind: "pdf" | "word" | "print") => {
    const s = societyCtx.society;
    if (!s) return;
    const mem = members?.find((m) => m._id === v.memberId);
    const firstBill = (bills ?? [])
      .filter((b) => (v.allocations ?? []).some((a) => a.billId === b._id))
      .sort((a, b) => b.period.localeCompare(a.period))[0];
    const data: LegacyReceiptData = {
      society: {
        name: s.name,
        address: [s.address, s.city, s.state, s.pincode].filter(Boolean).join(", "),
        registrationNo: s.registrationNo,
      },
      receiptNo: v.voucherNo.replace(/^[A-Z]+-/, ""),
      receiptDate: v.date,
      memberName: mem?.name ?? "Member",
      flatNo: [mem?.wing, mem?.flatNo].filter(Boolean).join("-") || undefined,
      amount: v.total,
      paymentKind: "part",
      purpose: `Maintenance for the Month${firstBill ? ` ${periodLabelLong(firstBill.period)}` : ""}`,
      mode: v.mode,
      reference: v.reference,
    };
    if (kind === "pdf") receiptPdf(data, `receipt-${v.voucherNo}.pdf`);
    else if (kind === "word") receiptWord(data, `receipt-${v.voucherNo}.doc`);
    else receiptPrint(data);
  };

  const editMember = members?.find((m) => m._id === editVoucherDoc?.memberId);

  return (
    <div>
      <PageHeader
        title={editId ? "Edit Member Receipt" : "Member Receipt"}
        description={
          editId
            ? "Editing an existing collection — date, mode, bank/cash account, cheque details and narration can change. The amount and its bill settlements stay fixed; delete and re-enter to change those."
            : "Record maintenance collections from members. Receipts debit bank/cash and credit the member's receivable, settling outstanding bills oldest-first."
        }
      />

      <form onSubmit={editId ? submitEdit : submit} className="mb-10 rounded-lg border">
        {/* Voucher header */}
        <div className="grid gap-4 border-b p-5 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>Book Code</Label>
            <Input value="Receipts" readOnly className="bg-muted/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mr-date">Voucher Date *</Label>
            <Input id="mr-date" type="date" required value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Last Voucher No</Label>
            <Input
              value={editVoucherDoc?.voucherNo ?? lastNo?.lastVoucherNo ?? "—"}
              readOnly
              className="bg-muted/50 font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>Voucher No</Label>
            <Input
              value={
                editId
                  ? (editVoucherDoc?.voucherNo ?? "…")
                  : lastNo
                    ? `${lastNo.prefix}-${String((lastNo.last ?? 0) + 1).padStart(4, "0")}`
                    : "auto"
              }
              readOnly
              className="bg-muted/50 font-mono text-xs"
              title="Assigned automatically on save"
            />
          </div>
        </div>

        {/* Cash/Bank + instrument details */}
        <div className="grid gap-4 border-b p-5 sm:grid-cols-4">
          <div className="space-y-2 sm:col-span-2">
            <Label>{editId ? "Cash/Bank" : "Cash/Bank *"}</Label>
            <Select
              value={(editId ? form.bankCashAccountId || editVoucherDoc?.bankCashAccountId : form.bankCashAccountId) || undefined}
              onValueChange={(v) => setForm({ ...form, bankCashAccountId: v })}
            >
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Cur Bal: <span className="tabular-nums text-foreground">{balText(bankBal)}</span>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mr-amount">Amount (₹)</Label>
            <Input
              id="mr-amount"
              value={editId ? formatMoney(editVoucherDoc?.total ?? 0) : amountNum > 0 ? formatMoney(amountNum) : ""}
              readOnly={Boolean(editId)}
              required={!editId}
              type={editId ? "text" : "number"}
              step={editId ? undefined : "0.01"}
              min={editId ? undefined : "0.01"}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className={`text-right font-medium tabular-nums ${editId ? "bg-muted/50" : ""}`}
              placeholder={editId ? undefined : "Total of the entries below"}
            />
          </div>
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank">Bank transfer</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mr-chq">Cheque No</Label>
            <Input id="mr-chq" value={form.chequeNo}
              onChange={(e) => setForm({ ...form, chequeNo: e.target.value })}
              placeholder="UTR / cheque no." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mr-chqdt">Cheque Date</Label>
            <Input id="mr-chqdt" type="date" value={form.chequeDate}
              onChange={(e) => setForm({ ...form, chequeDate: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="mr-bankname">Bank Name</Label>
            <Input id="mr-bankname" value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              placeholder="For cheque / NEFT instruments" />
          </div>
          <div className="space-y-2 sm:col-span-4">
            <Label htmlFor="mr-narr">Narration</Label>
            <Input id="mr-narr" value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              placeholder="April maintenance collection" />
          </div>
        </div>

        {/* Entries grid — auto-posted lines */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Ledger</TableHead>
              <TableHead className="w-36 text-right">Debit</TableHead>
              <TableHead className="w-36 text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editId && editVoucherDoc ? (
              editVoucherDoc.lines.map((l, i) => {
                const acc = accounts?.find((a) => a._id === l.accountId);
                return (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{acc?.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{acc?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.debit ? formatMoney(l.debit) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.credit ? formatMoney(l.credit) : ""}</TableCell>
                  </TableRow>
                );
              })
            ) : (
              <>
                <TableRow>
                  <TableCell className="font-mono text-xs">{selectedBank?.code ?? "—"}</TableCell>
                  <TableCell className="font-medium">
                    {selectedBank?.name ?? "Cash/Bank"}
                    {!form.bankCashAccountId && bankAccounts.length > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {amountNum > 0 ? formatMoney(amountNum) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" />
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{selectedMember?.code ?? "—"}</TableCell>
                  <TableCell className="font-medium">
                    {selectedMember
                      ? `${selectedMember.name} (${[selectedMember.wing, selectedMember.flatNo].filter(Boolean).join("-") || "member"})`
                      : "Select a member above"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" />
                  <TableCell className="text-right tabular-nums">
                    {amountNum > 0 ? formatMoney(amountNum) : ""}
                  </TableCell>
                </TableRow>
              </>
            )}
            <TableRow className="border-t-2 hover:bg-transparent">
              <TableCell colSpan={2} className="text-right text-muted-foreground">Total</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {editId && editVoucherDoc
                  ? editVoucherDoc.lines.reduce((s, l) => s + l.debit, 0)
                    ? formatMoney(editVoucherDoc.lines.reduce((s, l) => s + l.debit, 0))
                    : ""
                  : amountNum > 0
                    ? formatMoney(amountNum)
                    : ""}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {editId && editVoucherDoc
                  ? editVoucherDoc.lines.reduce((s, l) => s + l.credit, 0)
                    ? formatMoney(editVoucherDoc.lines.reduce((s, l) => s + l.credit, 0))
                    : ""
                  : amountNum > 0
                    ? formatMoney(amountNum)
                    : ""}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* Settlement preview */}
        {!editId && selectedMember && outstandingBills.length > 0 && (
          <div className="border-t p-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Automatic settlement preview (oldest first)
            </p>
            <div className="space-y-1 text-sm">
              {previewAllocation.rows.map((r) => (
                <div key={r.bill._id} className="flex justify-between">
                  <span>
                    {r.bill.billNo} · {formatPeriod(r.bill.period)} · due {formatDate(r.bill.dueDate)}
                  </span>
                  <span className="tabular-nums">{formatUnallocated(r.take)}</span>
                </div>
              ))}
              {previewAllocation.unallocated > 0 && (
                <div className="flex justify-between font-medium">
                  <span>Excess kept as advance</span>
                  <span className="tabular-nums">{formatUnallocated(previewAllocation.unallocated)}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {!editId && selectedMember && outstandingBills.length === 0 && (
          <div className="border-t p-5">
            <p className="text-sm text-muted-foreground">
              No outstanding bills for {selectedMember.name} — the receipt will still credit their account.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t p-5">
          {editId && (
            <Button type="button" variant="destructive" className="rounded-lg px-6" onClick={delEdit}>
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="rounded-lg px-6"
            onClick={() => (editId ? setSearchParams({}) : setForm({
              ...form,
              memberId: "",
              amount: "",
              chequeNo: "",
              chequeDate: "",
              bankName: "",
              narration: "",
            }))}
          >
            Exit
          </Button>
          <Button
            type="submit"
            className="rounded-lg px-8"
            disabled={!editId && (!form.memberId || amountNum <= 0)}
          >
            {editId ? "Update" : "Save"}
          </Button>
        </div>
      </form>

      {editId && editVoucherDoc && (
        <p className="mb-6 -mt-6 text-xs text-muted-foreground">
          Editing {editVoucherDoc.voucherNo} for {editMember?.name ?? "member"} — amount ₹ {formatMoney(editVoucherDoc.total)} is fixed.
        </p>
      )}

      <h3 className="mb-4 text-sm font-medium">Recorded receipts</h3>
      <VoucherList
        title="Member Receipts"
        description="Member receipt vouchers"
        fixedType="member_receipt"
        renderReceipt={(v, kind) => printReceiptFor(v, kind)}
      />
    </div>
  );
}
