import { Button } from "@/components/ui/button";
import { ViewerBlock } from "@/components/PageParts";
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
import { formatMoney, fyWarningMessage, todayISO } from "@/lib/format";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Account = Doc<"accounts">;
type Voucher = Doc<"vouchers">;

/** Text-based decimal input — avoids the number spinner auto-filling "00"
 before the user finishes typing. */
export function NumInput({
  value,
  onChange,
  id,
  className,
  placeholder,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode">) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        // Digits and a single dot only; never rewrite what's typed.
        const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1");
        onChange(v);
      }}
      {...rest}
    />
  );
}

/** Boxed total cell shown bottom-right of the entries grid (legacy style). */
function TotalBox({ value }: { value: string }) {
  return (
    <div className="w-36 rounded-none border bg-background px-3 py-1.5 text-right text-sm font-semibold tabular-nums">
      {value}
    </div>
  );
}

/**
 * Payment and Other Receipt — SAME pattern, working and section order as the
 * Member Receipt screen:
 *
 *  • header: Book Code / Voucher Date / Last Voucher No / Voucher No;
 *  • one field grid: Ledger · Cash/Bank (with Cur Bal) · Amount · Cheque No ·
 *    Cheque Date · Bank Name · Narration;
 *  • ONE head per voucher — pick the ledger, type the Amount, and the
 *    cash/bank line posts automatically (Dr first, then Cr), exactly like the
 *    member screen's Dr Bank · Cr Member rows;
 *  • boxed Dr/Cr totals, then Delete · Exit · Save;
 *  • a posting-preview panel below the form (the analog of Member Receipt's
 *    settlement preview). A payment split across several ledgers belongs in
 *    the Journal Voucher.
 *
 * With `editId` set the form loads an existing voucher: header fields (date,
 * cash/bank, cheque details, narration) stay editable while the amount and
 * its entry lines are fixed — delete and re-enter to change those, same as
 * Member Receipt. Changing Cash/Bank moves the voucher's cash leg onto the
 * chosen account (server-side), so header and lines can never disagree.
 */
export function LedgerVoucherForm({
  kind,
  editId,
  onEditDone,
}: {
  kind: "payment" | "other_receipt";
  editId?: string;
  onEditDone?: () => void;
}) {
  const isPayment = kind === "payment";
  const { society, societyId, canEdit } = useSociety();
  const accounts = useQuery(api.accounts.list, societyId ? { societyId } : "skip") as Account[] | undefined;
  const createVoucher = useMutation(api.vouchers.create);
  const updateVoucher = useMutation(api.vouchers.update);
  const removeVoucher = useMutation(api.vouchers.remove);
  const editing = useQuery(
    api.vouchers.getMany,
    societyId && editId ? { societyId, ids: [editId as Id<"vouchers">] } : "skip",
  ) as Voucher[] | undefined;
  const lastNo = useQuery(
    api.vouchers.lastNo,
    societyId && !editId ? { societyId, type: kind } : "skip",
  ) as { last: number; lastVoucherNo: string | null; prefix: string } | undefined;

  const bankAccounts = (accounts ?? []).filter((a) => a.kind === "bank_cash");
  const ledgerAccounts = (accounts ?? []).filter((a) => a.kind !== "bank_cash");

  const [date, setDate] = useState(todayISO());
  const [bankCashAccountId, setBankCashAccountId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [bankName, setBankName] = useState("");
  const [narration, setNarration] = useState("");
  const [ledgerId, setLedgerId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  // Voucher number: blank = automatic numbering; a typed number is checked
  // for duplicates live and re-checked on the server before the entry saves.
  const [voucherNo, setVoucherNo] = useState("");
  const suggestedNo = lastNo
    ? `${lastNo.prefix}-${String((lastNo.last ?? 0) + 1).padStart(4, "0")}`
    : "";
  const noTaken = useQuery(
    api.vouchers.voucherNoTaken,
    societyId && voucherNo.trim() && !editId
      ? { societyId, voucherNo: voucherNo.trim() }
      : "skip",
  ) as boolean | undefined;

  const isEdit = Boolean(editId);

  /** Financial-year guard: dated entries outside the books period are declined. */
  const fyWarning = fyWarningMessage(society, date);

  // Prefill when editing — during render (not in an effect) so a reactive
  // refetch of the voucher never clobbers in-progress edits.
  const editDoc = editing?.[0];
  if (editId && editDoc && loadedFrom !== editDoc._id) {
    setLoadedFrom(editDoc._id);
    setDate(editDoc.date);
    setBankCashAccountId((editDoc.bankCashAccountId as string) ?? "");
    // Narration is stored as "text — Bank: X"; split it back apart.
    const raw = editDoc.narration ?? "";
    const bankMatch = raw.match(/— Bank: (.+)$/);
    setBankName(bankMatch?.[1]?.trim() ?? "");
    setNarration(bankMatch ? raw.slice(0, bankMatch.index).replace(/ — $/, "") : raw);
    const ref = editDoc.reference ?? "";
    setChequeNo(ref.includes(" dt ") ? ref.split(" dt ")[0] : ref);
    setChequeDate(ref.includes(" dt ") ? ref.split(" dt ")[1]?.slice(0, 10) ?? "" : "");
    // Primary head = the first line that is not the cash/bank leg (grid
    // selection only — the stored lines themselves stay fixed).
    const head =
      editDoc.lines.find((l) => l.accountId !== editDoc.bankCashAccountId) ??
      editDoc.lines[0];
    setLedgerId((head?.accountId as string) ?? "");
    setAmount(editDoc.total ? String(editDoc.total) : "");
  }

  // Cash/Bank falls back to the first bank account — same defaulting as
  // Member Receipt, where the account need not be re-picked every time.
  const selectedBank =
    bankAccounts.find((a) => a._id === bankCashAccountId) ?? bankAccounts[0];
  const selectedLedger = ledgerAccounts.find((a) => a._id === ledgerId);
  const amountNum = Number(amount) || 0;

  const bankBal = useQuery(
    api.api.accountBalance,
    societyId && selectedBank
      ? { societyId, accountId: selectedBank._id as Id<"accounts">, asOf: date }
      : "skip",
  ) as { balance: number; debitNature: boolean } | undefined;

  const ledgerBal = useQuery(
    api.api.accountBalance,
    societyId && ledgerId
      ? { societyId, accountId: ledgerId as Id<"accounts">, asOf: date }
      : "skip",
  ) as { balance: number; debitNature: boolean } | undefined;

  const balText = (b: { balance: number } | undefined) =>
    b ? `${formatMoney(Math.abs(b.balance))} ${b.balance >= 0 ? "Dr" : "Cr"}` : "—";

  // Mode is derived from the instrument/account — no manual field, exactly
  // like Member Receipt.
  const derivedMode = chequeNo
    ? "cheque"
    : (selectedBank?.name ?? "").toLowerCase().includes("bank")
      ? "bank"
      : "cash";

  const composeReference = () =>
    chequeNo
      ? chequeDate
        ? `${chequeNo} dt ${chequeDate}`
        : chequeNo
      : undefined;

  const composeNarration = () =>
    [narration, bankName ? `Bank: ${bankName}` : ""].filter(Boolean).join(" — ") ||
    undefined;

  const editTotDr = editDoc?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  const editTotCr = editDoc?.lines.reduce((s, l) => s + l.credit, 0) ?? 0;

  const reset = () => {
    // Same fields Member Receipt clears on Exit — date and cash/bank stick.
    setAmount("");
    setChequeNo("");
    setChequeDate("");
    setBankName("");
    setNarration("");
    setLedgerId("");
    setVoucherNo("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    if (fyWarning) {
      toast.error(fyWarning);
      return;
    }
    if (!amountNum || amountNum <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!ledgerId) {
      toast.error(isPayment ? "Select the ledger to debit." : "Select the ledger to credit.");
      return;
    }
    const bankId = selectedBank?._id;
    if (!bankId) {
      toast.error(
        "No cash/bank account found — add one in Chart of Accounts first.",
      );
      return;
    }
    if (voucherNo.trim() && noTaken) {
      toast.error(
        `Duplicate Voucher No. — ${voucherNo.trim()} is already used in the books.`,
      );
      return;
    }
    // Two explicit balanced lines for the FULL amount — the same shape
    // Member Receipt posts (Dr first, then Cr). Payment debits the head and
    // credits cash/bank; a receipt debits cash/bank and credits the head.
    const lines = isPayment
      ? [
          { accountId: ledgerId as Id<"accounts">, debit: amountNum, credit: 0 },
          { accountId: bankId as Id<"accounts">, debit: 0, credit: amountNum },
        ]
      : [
          { accountId: bankId as Id<"accounts">, debit: amountNum, credit: 0 },
          { accountId: ledgerId as Id<"accounts">, debit: 0, credit: amountNum },
        ];
    setSaving(true);
    try {
      await createVoucher({
        societyId,
        type: kind,
        date,
        mode: derivedMode,
        bankCashAccountId: bankId as Id<"accounts">,
        reference: composeReference(),
        narration: composeNarration(),
        voucherNo: voucherNo.trim() || undefined,
        lines,
      });
      toast.success(
        `${isPayment ? "Payment" : "Receipt"} of ₹ ${formatMoney(amountNum)} saved`,
      );
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save voucher");
    } finally {
      setSaving(false);
    }
  };

  /** Update an existing voucher — header fields only (amount and entry lines
   stay fixed; delete & re-enter to change them), same as Member Receipt. */
  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId || !editId || !editDoc) return;
    if (fyWarning) {
      toast.error(fyWarning);
      return;
    }
    const bankId = (bankCashAccountId ||
      (editDoc.bankCashAccountId as string) ||
      undefined) as Id<"accounts"> | undefined;
    setSaving(true);
    try {
      await updateVoucher({
        societyId,
        id: editId as Id<"vouchers">,
        date,
        mode: derivedMode,
        bankCashAccountId: bankId,
        reference: composeReference(),
        narration: composeNarration(),
        lines: editDoc.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
        })),
      });
      toast.success("Voucher updated");
      onEditDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update voucher");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!societyId || !editId || !editDoc) return;
    if (!confirm(`Delete voucher ${editDoc.voucherNo}? Balances recalculate without it.`))
      return;
    try {
      await removeVoucher({ societyId, id: editId as Id<"vouchers"> });
      toast.success("Voucher deleted");
      onEditDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const exit = () => {
    if (isEdit) onEditDone?.();
    else reset();
  };

  const editHeadName = accounts?.find((a) => a._id === ledgerId)?.name ?? "—";

  return !canEdit ? (
    <ViewerBlock what="voucher entries" />
  ) : (
    <>
      <form onSubmit={isEdit ? submitEdit : submit} className="panel mb-10">
        {/* Voucher header — Book Code / Voucher Date / Last Voucher No / Voucher No */}
        <div className="grid gap-3 border-b p-3 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>Book Code</Label>
            <Input value={isPayment ? "Payments" : "Receipts"} readOnly className="bg-muted/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v-date">Voucher Date *</Label>
            <Input id="v-date" type="date" required value={date}
              onChange={(e) => setDate(e.target.value)} />
            {fyWarning && (
              <p className="text-xs font-medium text-destructive">{fyWarning}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Last Voucher No.</Label>
            <Input
              value={editDoc?.voucherNo ?? lastNo?.lastVoucherNo ?? "—"}
              readOnly
              className="bg-muted/50 font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v-no">Voucher No.</Label>
            <Input
              id="v-no"
              value={isEdit ? (editDoc?.voucherNo ?? "…") : voucherNo}
              onChange={(e) => setVoucherNo(e.target.value)}
              placeholder={suggestedNo || "auto"}
              readOnly={isEdit}
              className={`font-mono text-xs ${noTaken ? "border-destructive" : ""}`}
              title="Leave blank for the next automatic number"
              autoComplete="off"
            />
            {noTaken && (
              <p className="text-xs font-medium text-destructive">Duplicate Voucher No.</p>
            )}
          </div>
        </div>

        {/* Ledger + Cash/Bank (Cur Bal) + Amount + Cheque No + Cheque Date + Bank Name + Narration —
            the same single grid Member Receipt uses. */}
        <div className="grid gap-3 border-b p-3 sm:grid-cols-12">
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="v-ledger">{isPayment ? "Paid to (Ledger) *" : "Received towards (Ledger) *"}</Label>
            <Select
              value={ledgerId || undefined}
              onValueChange={(v) => setLedgerId(v)}
              disabled={isEdit}
            >
              <SelectTrigger id="v-ledger">
                <SelectValue
                  placeholder={isEdit ? editHeadName : "Select ledger account"}
                />
              </SelectTrigger>
              <SelectContent>
                {ledgerAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label>Cash/Bank *</Label>
            <Select
              value={(isEdit ? bankCashAccountId || editDoc?.bankCashAccountId : bankCashAccountId) || undefined}
              onValueChange={(v) => setBankCashAccountId(v)}
            >
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Cur Bal: <span className="font-medium tabular-nums text-foreground">{balText(bankBal)}</span>
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="v-amount">Amount</Label>
            {isEdit ? (
              <Input
                id="v-amount"
                value={formatMoney(editDoc?.total ?? 0)}
                readOnly
                className="bg-muted/50 text-right font-semibold tabular-nums"
              />
            ) : (
              <NumInput
                id="v-amount"
                value={amount}
                onChange={setAmount}
                className="text-right font-semibold tabular-nums"
                placeholder="0.00"
              />
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="v-chq">Cheque No</Label>
            <Input id="v-chq" value={chequeNo}
              onChange={(e) => setChequeNo(e.target.value)}
              placeholder="UTR / cheque no." />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="v-chqdt">Cheque Date</Label>
            <Input id="v-chqdt" type="date" value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-6">
            <Label htmlFor="v-bankname" className="text-muted-foreground">Bank Name</Label>
            <Input id="v-bankname" value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="For cheque / NEFT instruments" />
          </div>
          <div className="space-y-2 sm:col-span-6">
            <Label htmlFor="v-narr">Narration</Label>
            <Input id="v-narr" value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder={isPayment ? "PAID TO … FOR …" : "Received towards …"} />
          </div>
        </div>

        {/* Entries grid — auto-posted Dr first · Cr second, five columns, exactly like Member Receipt */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Ledger</TableHead>
              <TableHead className="w-32 text-right">Debit</TableHead>
              <TableHead className="w-32 text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isEdit && editDoc ? (
              editDoc.lines.map((l, i) => {
                const acc = accounts?.find((a) => a._id === l.accountId);
                return (
                  <TableRow key={i}>
                    <TableCell className="w-8 text-xs text-muted-foreground">{i === 0 ? "▶" : ""}</TableCell>
                    <TableCell className="font-mono text-xs">{acc?.code ?? "—"}</TableCell>
                    <TableCell className="font-medium uppercase">{acc?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.debit ? formatMoney(l.debit) : "0.00"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.credit ? formatMoney(l.credit) : "0.00"}</TableCell>
                  </TableRow>
                );
              })
            ) : (
              <>
                <TableRow>
                  <TableCell className="w-8 text-xs text-muted-foreground">▶</TableCell>
                  <TableCell className="font-mono text-xs">
                    {(isPayment ? selectedLedger : selectedBank)?.code ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium uppercase">
                    {isPayment
                      ? (selectedLedger?.name ?? "Select a ledger above")
                      : (selectedBank?.name ?? "Cash/Bank")}
                    {!isPayment && !bankCashAccountId && bankAccounts.length > 0 && (
                      <span className="ml-2 text-xs normal-case text-muted-foreground">(default)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {amountNum > 0 ? formatMoney(amountNum) : "0.00"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">0.00</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="w-8" />
                  <TableCell className="font-mono text-xs">
                    {(isPayment ? selectedBank : selectedLedger)?.code ?? "—"}
                  </TableCell>
                  <TableCell className="font-medium uppercase">
                    {isPayment
                      ? (selectedBank?.name ?? "Cash/Bank")
                      : (selectedLedger?.name ?? "Select a ledger above")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">0.00</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {amountNum > 0 ? formatMoney(amountNum) : "0.00"}
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>

        {/* Boxed totals — legacy bottom-right Dr / Cr boxes */}
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
          {isEdit && editDoc ? (
            <>
              <TotalBox value={editTotDr ? formatMoney(editTotDr) : "0.00"} />
              <TotalBox value={editTotCr ? formatMoney(editTotCr) : "0.00"} />
            </>
          ) : (
            <>
              <TotalBox value={amountNum > 0 ? formatMoney(amountNum) : "0.00"} />
              <TotalBox value={amountNum > 0 ? formatMoney(amountNum) : "0.00"} />
            </>
          )}
        </div>

        {/* Delete · Exit · Save — same legacy order as Member Receipt */}
        <div className="flex justify-end gap-2 border-t p-4">
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              className="min-w-24 rounded-none text-destructive hover:text-destructive"
              onClick={del}
            >
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-w-24 rounded-none"
            onClick={exit}
          >
            Exit
          </Button>
          <Button
            type="submit"
            variant="outline"
            className="min-w-24 rounded-none"
            disabled={saving || (!isEdit && (!ledgerId || amountNum <= 0))}
          >
            {isEdit ? "Update" : "Save"}
          </Button>
        </div>
      </form>

      {/* Posting preview — the analog of Member Receipt's settlement preview */}
      {!isEdit && selectedLedger && (
        <div className="panel mb-6 -mt-4 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Posting preview (on save)
          </p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="uppercase">
                {isPayment ? selectedLedger.name : (selectedBank?.name ?? "Cash/Bank")}
              </span>
              <span className="tabular-nums">
                Dr {amountNum > 0 ? `₹ ${formatMoney(amountNum)}` : "₹ 0.00"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="uppercase">
                {isPayment ? (selectedBank?.name ?? "Cash/Bank") : selectedLedger.name}
              </span>
              <span className="tabular-nums">
                Cr {amountNum > 0 ? `₹ ${formatMoney(amountNum)}` : "₹ 0.00"}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{selectedLedger.name} · Cur Bal</span>
              <span className="tabular-nums">{balText(ledgerBal)}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One head per voucher — like Member Receipt. For a payment split across several
            ledgers, use the Journal Voucher.
          </p>
        </div>
      )}

      {/* Fixed-amount note while editing — same wording policy as Member Receipt */}
      {isEdit && editDoc && (
        <p className="mb-6 -mt-4 text-xs text-muted-foreground">
          Editing {editDoc.voucherNo} — amount ₹ {formatMoney(editDoc.total)} and its entry
          lines are fixed; delete and re-enter to change them.
        </p>
      )}
    </>
  );
}
