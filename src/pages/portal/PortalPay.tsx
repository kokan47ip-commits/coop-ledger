import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { IconTile, PageHeader } from "@/components/PageParts";
import { receiptPdf } from "@/lib/billDoc";
import {
  buildMemberReceiptData,
  receiptPdfBase64,
} from "@/lib/memberReceipt";
import { effectiveFyPeriod, formatMoney, todayISO } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleOff,
  Clock,
  Landmark,
  Loader2,
  PiggyBank,
  Send,
  Smartphone,
  TriangleAlert,
  WalletMinimal,
} from "lucide-react";
import { useState } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type OpenBill = {
  _id: Id<"bills">;
  billNo: string;
  period: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paidAmount: number;
  balance: number;
};

type PayAccount = { _id: Id<"accounts">; code: string; name: string };

type VoucherDoc = {
  _id: Id<"vouchers">;
  voucherNo: string;
  date: string;
  total: number;
  mode?: string;
  reference?: string;
  narration?: string;
  allocations?: { billId: Id<"bills">; amount: number }[] | null;
};

type BillRow = { _id: Id<"bills">; period: string };

type SubmissionRow = {
  _id: Id<"paymentSubmissions">;
  amount: number;
  mode: string;
  date: string;
  status: "pending" | "posted" | "rejected";
  voucherNo: string | null;
  reviewNote: string | null;
  createdAt: number;
};

type UpiPaymentRow = {
  _id: Id<"upiPayments">;
  amount: number;
  status: "created" | "posted" | "captured" | "cancelled";
  voucherNo: string | null;
  createdAt: number;
  postedAt: number | null;
  failureReason: string | null;
};

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: { name?: string; method?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler?: (response: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (resp: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let checkoutPromise: Promise<void> | null = null;

/** Load the gateway's checkout script once per page visit. */
function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutPromise) return checkoutPromise;
  checkoutPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutPromise = null;
      reject(new Error("Could not load the payment window — check your internet connection."));
    };
    document.body.appendChild(script);
  });
  return checkoutPromise;
}

export default function PortalPay() {
  const { societyId, society, memberBinding } = useSociety();
  const convex = useConvex();
  const openBills = useQuery(
    api.memberPortal.myOpenBills,
    societyId ? { societyId } : "skip",
  ) as OpenBill[] | null | undefined;
  const accounts = useQuery(
    api.memberPortal.myPayAccounts,
    societyId ? { societyId } : "skip",
  ) as PayAccount[] | null | undefined;

  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [accountIdChoice, setAccountId] = useState<string>("");
  const [mode, setMode] = useState<string>("bank");
  const [reference, setReference] = useState("");
  const [payDate, setPayDate] = useState<string>(todayISO());
  const [narration, setNarration] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitPayment = useMutation(api.memberPortal.submitPayment);

  // My recent manual (cash/cheque/bank) submissions and their office-approval
  // status — a pending entry is not in the books until the office passes it.
  const submissions = useQuery(
    api.memberPortal.mySubmissions,
    societyId ? { societyId } : "skip",
  ) as SubmissionRow[] | null | undefined;

  // ---- Online UPI payments (GPay / PhonePe / Paytm via the gateway) ----
  const gateway = useQuery(api.payments.gatewayStatus);
  const gatewayReady = gateway?.ready === true;
  const upiPayments = useQuery(
    api.payments.myUpiPayments,
    societyId ? { societyId } : "skip",
  ) as UpiPaymentRow[] | null | undefined;
  const createUpiOrder = useMutation(api.payments.createUpiOrder);
  const initRazorpayOrder = useAction(api.payments.initRazorpayOrder);
  const verifyUpiPayment = useMutation(api.payments.verifyUpiPayment);
  const emailReceipt = useAction(api.payments.emailMemberReceipt);
  const [upiBusy, setUpiBusy] = useState(false);
  const [upiStage, setUpiStage] = useState<string | null>(null);

  // Pre-select the society's first cash/bank account so the member only has
  // to change it when paying somewhere other than the default account.
  // Derived (not effect-synced): falls back to the first account until the
  // member picks one explicitly.
  const accountId =
    accountIdChoice || (accounts && accounts.length > 0 ? accounts[0]._id : "");

  // The payment is dated today; if today sits outside the society's current
  // books period the server would decline it — warn before they type anything.
  const today = todayISO();
  const fy = effectiveFyPeriod(society);
  // The member states when they actually paid (cheque date, cash handover).
  // The voucher keeps that date when the office passes it — and entries dated
  // outside the books period are declined up front, never parked.
  const dateOutsideFy = !!society && (payDate < fy.from || payDate > fy.to);
  const booksClosed = !!society && (today < fy.from || today > fy.to);
  const noAccounts = accounts !== undefined && accounts !== null && accounts.length === 0;

  const parsedAllocs = Object.entries(allocs)
    .map(([id, amt]) => ({ billId: id as Id<"bills">, amount: Number(amt) || 0 }))
    .filter((a) => a.amount > 0);
  const total = parsedAllocs.reduce((s, a) => s + a.amount, 0);

  const overAllocated = parsedAllocs.some((a) => {
    const b = openBills?.find((x) => x._id === a.billId);
    return b ? a.amount > b.balance + 0.005 : true;
  });

  // Advance: pay an amount without selecting any bills — credited to the
  // member's ledger and settled against future bills by the office.
  const [advance, setAdvance] = useState("");
  const advanceNum = Number(advance) || 0;

  /** Why the UPI button is disabled — the settlement account is the office's
   *  choice, so unlike the manual flow it does not need one picked here. */
  const upiBlocked: string | null = booksClosed
    ? "The society's current books period does not include today's date — online payments are paused."
    : parsedAllocs.length === 0 && advanceNum <= 0
      ? "Tick a bill and enter the amount to pay — or enter an advance amount below."
      : overAllocated
        ? "One of the amounts is more than the bill balance — reduce it to continue."
        : null;

  /** Why the submit button is disabled — shown next to it so it's never a mystery. */
  const blockedReason: string | null = booksClosed
    ? "The society's current books period does not include today's date — payments are paused. Please contact the society office."
    : dateOutsideFy
      ? "The payment date is outside the society's current books period — pick a date between the period's start and end."
      : noAccounts
      ? "No cash/bank account is available for payments yet — please contact the society office."
      : !accountId
        ? "Select the cash/bank account you are paying into."
        : parsedAllocs.length === 0 && advanceNum <= 0
          ? "Tick a bill and enter the amount to pay — or enter an advance amount below."
          : overAllocated
            ? "One of the amounts is more than the bill balance — reduce it to continue."
            : null;

  const submit = async () => {
    if (!societyId || blockedReason) return;
    setSubmitting(true);
    try {
      const res = await submitPayment({
        societyId,
        date: payDate,
        bankCashAccountId: accountId as Id<"accounts">,
        mode,
        reference: reference.trim() || undefined,
        narration: narration.trim() || undefined,
        allocations: parsedAllocs,
        amount: parsedAllocs.length === 0 ? advanceNum : undefined,
      });
      toast.success(
        parsedAllocs.length === 0
          ? `Advance of ${formatMoney(res.total)} submitted — it will be credited once the society office passes the entry.`
          : `Payment of ${formatMoney(res.total)} submitted — sent for the society office's approval.`,
      );
      setAllocs({});
      setAdvance("");
      setReference("");
      setNarration("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setSubmitting(false);
    }
  };

  /** Confirm a completed checkout server-side; posts the receipt voucher. */
  const confirmUpi = async (
    paymentId: Id<"upiPayments">,
    resp: RazorpayCheckoutResponse,
  ) => {
    setUpiStage("Confirming payment…");
    try {
      const res = await verifyUpiPayment({
        paymentId,
        razorpayOrderId: resp.razorpay_order_id,
        razorpayPaymentId: resp.razorpay_payment_id,
        razorpaySignature: resp.razorpay_signature,
      });
      if (res.posted && res.voucherNo) {
        toast.success(
          `Payment received — receipt ${res.voucherNo} posted to your ledger.`,
        );
      } else if (res.posted) {
        toast.success("Payment received — it will appear in your ledger shortly.");
      } else {
        toast.success(
          "Payment received — the society office will record it in the books.",
        );
      }
      setAllocs({});
      setAdvance("");
      if (res.posted) void deliverReceipt(res.voucherNo ?? null);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `${err.message} If money was deducted, the bank confirmation will credit your ledger automatically.`
          : "Payment verification failed — if money was deducted, your ledger will be credited automatically.",
      );
    } finally {
      setUpiBusy(false);
      setUpiStage(null);
    }
  };

  /**
   * After a UPI payment posts: download the receipt PDF immediately and email
   * a copy to the member. Both failures are soft — the receipt stays available
   * under My Receipts either way.
   */
  const deliverReceipt = async (voucherNo: string | null) => {
    if (!societyId || !voucherNo) return;
    try {
      const [vouchers, bills] = await Promise.all([
        convex.query(api.memberPortal.myReceipts, { societyId }),
        convex.query(api.memberPortal.myBills, { societyId }),
      ]);
      const v = (vouchers as VoucherDoc[] | null)?.find(
        (r) => r.voucherNo === voucherNo,
      );
      if (!v) return;
      const data = buildMemberReceiptData({
        society,
        memberBinding,
        voucher: v,
        bills: bills as BillRow[] | null,
      });
      receiptPdf(data, `${v.voucherNo}.pdf`);
      toast.success(`Receipt ${v.voucherNo} downloaded.`);
      try {
        await emailReceipt({
          societyId,
          voucherId: v._id,
          pdfBase64: receiptPdfBase64(data),
          filename: `${v.voucherNo}.pdf`,
        });
        toast.success(`A copy of receipt ${v.voucherNo} was emailed to you.`);
      } catch (err) {
        toast.info(
          err instanceof Error
            ? err.message
            : "The receipt email could not be sent — you can download it from My Receipts.",
        );
      }
    } catch {
      // Download is a convenience — the receipt is always in My Receipts.
    }
  };

  /**
   * Start an online UPI payment: store the order, create the gateway order
   * server-side, then open the checkout — on a phone it lists the UPI apps
   * installed on this device (GPay, PhonePe, Paytm…), on desktop a QR code.
   */
  const payViaUpi = async () => {
    if (!societyId || upiBlocked || upiBusy) return;
    setUpiBusy(true);
    setUpiStage("Preparing…");
    try {
      const order = await createUpiOrder({
        societyId,
        allocations: parsedAllocs,
        amount: parsedAllocs.length === 0 ? advanceNum : undefined,
      });
      setUpiStage("Opening payment apps…");
      const init = await initRazorpayOrder({ paymentId: order.paymentId });
      await loadRazorpayCheckout();
      const RazorpayCtor = window.Razorpay;
      if (!RazorpayCtor) throw new Error("The payment window could not be loaded.");
      const rzp = new RazorpayCtor({
        key: init.keyId,
        amount: init.amountPaise,
        currency: "INR",
        name: init.societyName,
        description: "Maintenance payment",
        order_id: init.providerOrderId,
        prefill: { name: init.memberName, method: "upi" },
        notes: { paymentId: init.paymentId },
        theme: { color: "#4f46e5" },
        handler: (resp) => {
          void confirmUpi(order.paymentId, resp);
        },
        modal: {
          ondismiss: () => {
            setUpiBusy(false);
            setUpiStage(null);
            toast.info("Payment window closed — you can pay again any time.");
          },
        },
      });
      rzp.open();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start the UPI payment.",
      );
      setUpiBusy(false);
      setUpiStage(null);
    }
  };

  if (openBills === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Your login is not linked to a flat in this society.
      </p>
    );
  }
  if (!openBills || !accounts) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Make a Payment"
        description="Pay your maintenance dues against open bills — or pay ahead as an advance."
      />
      {booksClosed && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-500/30 dark:from-amber-950/40 dark:to-orange-950/30 dark:text-amber-200">
          <IconTile tone="amber">
            <TriangleAlert />
          </IconTile>
          <p>
            The society's current books period is <strong>{fy.from}</strong> to{" "}
            <strong>{fy.to}</strong>, which does not include today. Payments
            are paused — please contact the society office.
          </p>
        </div>
      )}
      {noAccounts && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-500/30 dark:from-amber-950/40 dark:to-orange-950/30 dark:text-amber-200">
          <IconTile tone="amber">
            <TriangleAlert />
          </IconTile>
          <p>
            The society has not marked any account as a cash/bank account yet.
            Once the office adds one (Chart of Accounts → kind "Bank / Cash"),
            you can pay here.
          </p>
        </div>
      )}

      <Card className="shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
        <CardContent className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Landmark className="size-3.5" /> Paying into
          </Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Cash / bank account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.code} — {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WalletMinimal className="size-3.5" /> Mode
          </Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank">Bank transfer</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" /> Payment date
          </Label>
          <Input
            type="date"
            value={payDate}
            min={fy.from}
            max={fy.to}
            onChange={(e) => setPayDate(e.target.value || todayISO())}
            className="mt-1"
          />
        </div>
        <div className="w-44">
          <Label className="text-xs text-muted-foreground">
            Reference / UTTR no.
          </Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. UPI ref"
            className="mt-1"
          />
        </div>
        <div className="min-w-56 flex-1">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Banknote className="size-3.5" /> Note (optional)
          </Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Appears on your receipt"
            className="mt-1"
          />
        </div>
        </CardContent>
      </Card>

      {/* Advance payment — when there are no dues (or paying ahead of them) */}
      <Card className="border-teal-500/20 bg-teal-500/[0.03] shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <IconTile tone="teal">
              <PiggyBank />
            </IconTile>
            No dues right now? Pay in advance
          </CardTitle>
          <CardDescription>
            The amount is credited to your flat's ledger and adjusted against
            future maintenance bills by the society office.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="w-48">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PiggyBank className="size-3.5" /> Advance amount (₹)
            </Label>
            <Input
              type="text"
              inputMode="decimal"
              value={advance}
              onChange={(e) => setAdvance(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className="mt-1 text-right tabular-nums"
            />
          </div>
          {parsedAllocs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Bill selections below take priority — clear them to pay the advance amount instead.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Pay</TableHead>
              <TableHead>Bill No.</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-36 text-right">Amount to pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openBills.map((b) => {
              const checked = allocs[b._id] !== undefined;
              return (
                <TableRow key={b._id}>
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setAllocs((prev) => {
                          const next = { ...prev };
                          if (v) {
                            next[b._id] = String(b.balance.toFixed(2));
                          } else {
                            delete next[b._id];
                          }
                          return next;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{b.billNo}</TableCell>
                  <TableCell>{b.period}</TableCell>
                  <TableCell>{b.dueDate}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(b.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(b.paidAmount)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(b.balance)}
                  </TableCell>
                  <TableCell>
                    {checked ? (
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        max={b.balance}
                        value={allocs[b._id]}
                        onChange={(e) =>
                          setAllocs((prev) => ({
                            ...prev,
                            [b._id]: e.target.value,
                          }))
                        }
                        onBlur={(e) =>
                          setAllocs((prev) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n > b.balance) {
                              return { ...prev, [b._id]: String(b.balance.toFixed(2)) };
                            }
                            return prev;
                          })
                        }
                        className="ml-auto h-8 w-32 text-right"
                      />
                    ) : (
                      <span className="block text-right text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {openBills.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Badge variant="outline" className="text-emerald-600">
                      All clear
                    </Badge>
                    You have no outstanding bills — nothing to pay right now.
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Online UPI — opens the payment apps installed on the member's phone */}
      <Card className="overflow-hidden py-0 shadow-lg shadow-emerald-950/[0.06]">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-green-500" />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <IconTile tone="emerald">
              <Smartphone />
            </IconTile>
            Pay online with UPI
          </CardTitle>
          <CardDescription>
            Opens the UPI apps on your phone — GPay, PhonePe, Paytm or any
            other. Your ledger is credited automatically the moment the bank
            confirms the payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Banknote className="size-3.5" /> Amount
            </p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300">
              {formatMoney(total)}
            </p>
          </div>
          {!gatewayReady && (
            <p className="flex max-w-md items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <CircleOff className="mt-0.5 size-4 shrink-0" />
              Online UPI payments switch on once the society office completes
              the payment setup (Messaging &amp; Payments → Payments).
            </p>
          )}
          {gatewayReady && upiBlocked && !upiBusy && (
            <p className="flex max-w-md items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {upiBlocked}
            </p>
          )}
          <Button
            className="ml-auto bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 text-white shadow-md shadow-emerald-950/20 hover:from-emerald-500 hover:via-teal-500 hover:to-green-500"
            size="lg"
            disabled={upiBusy || !gatewayReady || !!upiBlocked || total <= 0}
            onClick={payViaUpi}
          >
            {upiBusy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {upiStage ?? "Processing…"}
              </>
            ) : (
              <>
                <Smartphone className="mr-2 size-4" />
                Pay {formatMoney(total)} via UPI
              </>
            )}
          </Button>
        </CardContent>
        {upiPayments && upiPayments.length > 0 && (
          <div className="border-t border-border/60 px-6 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent online payments
            </p>
            <ul className="space-y-1.5">
              {upiPayments.slice(0, 4).map((p) => (
                <li
                  key={p._id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  {p.status === "posted" ? (
                    <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <BadgeCheck className="size-3" /> Paid · {p.voucherNo}
                    </Badge>
                  ) : p.status === "created" ? (
                    <Badge className="gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                      <Loader2 className="size-3 animate-spin" /> Processing
                    </Badge>
                  ) : p.status === "captured" ? (
                    <Badge className="gap-1 border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300">
                      <BadgeCheck className="size-3" /> Received — office will record
                    </Badge>
                  ) : (
                    <Badge className="gap-1 border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                      <CircleOff className="size-3" /> Cancelled
                    </Badge>
                  )}
                  <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden py-0 shadow-lg shadow-primary/[0.06]">
        <div className="brand-gradient h-1 w-full" />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <IconTile tone="indigo">
              <Send />
            </IconTile>
            Submit payment entry
          </CardTitle>
          <CardDescription>
            Record a payment already made (cash, cheque or bank transfer),
            dated today. The entry goes to the society office for approval —
            it is posted to your ledger and bills only after they pass it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-3.5" /> Total payment
            </p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-primary">
              {formatMoney(total)}
            </p>
          </div>
          {blockedReason && !submitting && (
            <p className="flex max-w-md items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {blockedReason}
            </p>
          )}
          <Button
            className="ml-auto"
            size="lg"
            disabled={submitting || !!blockedReason}
            onClick={submit}
          >
            <Send className="mr-2 size-4" />
            {submitting ? "Submitting..." : "Submit for approval"}
          </Button>
        </CardContent>
      </Card>

      {/* Office-approval status of my manual submissions */}
      {submissions && submissions.length > 0 && (
        <Card className="overflow-hidden py-0 shadow-lg shadow-primary/[0.06]">
          <div className="brand-gradient h-1 w-full" />
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <IconTile tone="amber">
                <Clock />
              </IconTile>
              My payment entries
            </CardTitle>
            <CardDescription>
              Cash, cheque and bank entries you submitted, with the office's
              approval status.
            </CardDescription>
          </CardHeader>
          <div className="border-t border-border/60 px-6 py-3">
            <ul className="space-y-1.5">
              {submissions.slice(0, 6).map((s) => (
                <li
                  key={s._id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  {s.status === "pending" ? (
                    <Badge className="gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                      <Clock className="size-3" /> Pending office approval
                    </Badge>
                  ) : s.status === "posted" ? (
                    <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <BadgeCheck className="size-3" /> Passed · {s.voucherNo}
                    </Badge>
                  ) : (
                    <Badge className="gap-1 border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                      <CircleOff className="size-3" /> Rejected
                    </Badge>
                  )}
                  <span className="font-medium tabular-nums">
                    {formatMoney(s.amount)}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">
                    {s.mode} · {s.date}
                  </span>
                  {s.status === "rejected" && s.reviewNote && (
                    <span className="text-xs text-rose-700 dark:text-rose-300">
                      — {s.reviewNote}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
