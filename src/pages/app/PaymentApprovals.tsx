import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { IconTile, PageHeader, ViewerBlock } from "@/components/PageParts";
import { formatDate, formatMoney } from "@/lib/format";
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Loader2,
  PiggyBank,
  ReceiptText,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Submission = {
  _id: Id<"paymentSubmissions">;
  memberId: Id<"members">;
  memberName: string;
  flatLabel: string;
  amount: number;
  advanceAmount: number;
  date: string;
  mode: string;
  reference: string | null;
  memberNote: string | null;
  accountName: string;
  billCount: number;
  status: "pending" | "posted" | "rejected";
  voucherNo: string | null;
  reviewNote: string | null;
  reviewedAt: number | null;
  createdAt: number;
};

type ListResult = { pending: Submission[]; recent: Submission[] };

/**
 * Payment Approvals — the office's pending-for-passing queue. Member portal
 * entries paid by cash, cheque or bank transfer wait here until an authorised
 * office login passes them; passing creates the member-receipt voucher and
 * applies the bill allocations.
 */
export default function PaymentApprovals() {
  const { societyId, canEdit, role } = useSociety();
  const rows = useQuery(
    api.approvals.list,
    societyId ? { societyId } : "skip",
  ) as ListResult | undefined;

  const approve = useMutation(api.approvals.approve);
  const reject = useMutation(api.approvals.reject);
  const removeDecided = useMutation(api.approvals.removeDecided);

  const [approving, setApproving] = useState<Submission | null>(null);
  const [rejecting, setRejecting] = useState<Submission | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!societyId) return null;

  if (rows === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Payment Approvals"
          description="Member portal entries waiting to be passed into the books."
        />
        <div className="panel h-40 animate-pulse" />
      </div>
    );
  }

  const doApprove = async () => {
    if (!approving) return;
    setBusy(true);
    try {
      const res = await approve({
        societyId,
        id: approving._id,
      });
      toast.success(
        `Passed ${formatMoney(res.total)} for ${approving.memberName} — receipt ${res.voucherNo} posted.`,
      );
      setApproving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not pass the entry.");
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await reject({ societyId, id: rejecting._id, note: rejectNote.trim() || undefined });
      toast.success(`Entry rejected — ${rejecting.memberName} will see the decision.`);
      setRejecting(null);
      setRejectNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reject the entry.");
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (id: Id<"paymentSubmissions">) => {
    try {
      await removeDecided({ societyId, id });
      toast.success("Removed from the list.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the entry.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Approvals"
        description="Member portal entries (cash / cheque / bank) waiting to be passed into the books — passing posts the receipt voucher and settles the bills."
      />

      {!canEdit && (
        <ViewerBlock what="passing or rejecting member payment entries" />
      )}

      {/* Pending queue */}
      <Card className="overflow-hidden py-0 shadow-lg shadow-primary/[0.06]">
        <div className="brand-gradient h-1 w-full" />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <IconTile tone="amber">
              <Clock />
            </IconTile>
            Pending for passing
            {rows.pending.length > 0 && (
              <Badge className="ml-1 border-amber-300/60 bg-amber-100 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-200">
                {rows.pending.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Entries are dated as the member recorded them and post under the
            member-receipt series when passed.
          </CardDescription>
        </CardHeader>
        {rows.pending.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-2 border-t border-border/60 py-10 text-muted-foreground">
            <BadgeCheck className="size-8 text-emerald-500" />
            <p className="text-sm">
              Nothing waiting — every member entry has been passed.
            </p>
          </CardContent>
        ) : (
          <div className="panel border-t-0 rounded-t-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Flat</TableHead>
                  <TableHead>Paid into</TableHead>
                  <TableHead>Mode / ref</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Bills</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.pending.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.memberName}</TableCell>
                    <TableCell>{s.flatLabel}</TableCell>
                    <TableCell className="text-xs">{s.accountName}</TableCell>
                    <TableCell className="text-xs capitalize">
                      {s.mode}
                      {s.reference ? ` · ${s.reference}` : ""}
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(s.date)}</TableCell>
                    <TableCell>
                      {s.billCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <FileSpreadsheet className="size-3.5 text-muted-foreground" />
                          {s.billCount}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <PiggyBank className="size-3.5" /> Advance
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(s.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={!canEdit}
                          onClick={() => setApproving(s)}
                          className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                          <CheckCircle2 className="size-3.5" />
                          Pass
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canEdit}
                          onClick={() => {
                            setRejecting(s);
                            setRejectNote("");
                          }}
                          className="h-8 gap-1.5 border-rose-300/60 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                        >
                          <XCircle className="size-3.5" />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Recently decided */}
      {rows.recent.length > 0 && (
        <Card className="overflow-hidden py-0 shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <IconTile tone="indigo">
                <ReceiptText />
              </IconTile>
              Recently passed / rejected
            </CardTitle>
            <CardDescription>
              The last eight decisions, newest first.
            </CardDescription>
          </CardHeader>
          <div className="border-t border-border/60 px-2 py-2">
            <ul className="divide-y divide-border/50">
              {rows.recent.map((s) => (
                <li key={s._id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  {s.status === "posted" ? (
                    <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <BadgeCheck className="size-3" /> Passed · {s.voucherNo}
                    </Badge>
                  ) : (
                    <Badge className="gap-1 border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                      <XCircle className="size-3" /> Rejected
                    </Badge>
                  )}
                  <span className="font-medium">{s.memberName}</span>
                  <span className="text-xs text-muted-foreground">{s.flatLabel}</span>
                  <span className="font-medium tabular-nums">{formatMoney(s.amount)}</span>
                  <span className="text-xs capitalize text-muted-foreground">{s.mode}</span>
                  {s.status === "rejected" && s.reviewNote && (
                    <span className="text-xs text-rose-700 dark:text-rose-300">— {s.reviewNote}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {s.reviewedAt ? new Date(s.reviewedAt).toLocaleString() : ""}
                  </span>
                  {role === "owner" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-rose-600"
                      onClick={() => doRemove(s._id)}
                      aria-label="Remove from list"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* Pass confirmation */}
      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pass this payment entry?</DialogTitle>
            <DialogDescription>
              Passing creates a member-receipt voucher and settles the member's
              bills. This cannot be undone here — reverse it with a journal or
              rejection of a new entry if needed.
            </DialogDescription>
          </DialogHeader>
          {approving && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Member</span>
                <span className="font-medium">
                  {approving.memberName} · {approving.flatLabel}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid into</span>
                <span>{approving.accountName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode</span>
                <span className="capitalize">
                  {approving.mode}
                  {approving.reference ? ` · ${approving.reference}` : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Entry date</span>
                <span>{formatDate(approving.date)}</span>
              </div>
              {approving.memberNote && (
                <div className="flex justify-between gap-6">
                  <span className="shrink-0 text-muted-foreground">Member's note</span>
                  <span className="text-right italic">{approving.memberNote}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Amount to post</span>
                <span className="tabular-nums">{formatMoney(approving.amount)}</span>
              </div>
              {approving.billCount === 0 && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <PiggyBank className="mt-0.5 size-3.5 shrink-0" />
                  No bills attached — the full amount posts as advance credit on
                  the member's ledger.
                </p>
              )}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Allocations are re-checked against current bill balances when
                passing — amounts that no longer fit stay as advance.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={doApprove}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 size-4" />
              )}
              Pass & post receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject with reason */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this entry?</DialogTitle>
            <DialogDescription>
              The member sees the rejection and your reason. Nothing is posted
              to the books.
            </DialogDescription>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <span className="font-medium">{rejecting.memberName}</span> ·{" "}
                {rejecting.flatLabel} — {formatMoney(rejecting.amount)} (
                {rejecting.mode})
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reject-note">Reason (shown to the member)</Label>
                <Textarea
                  id="reject-note"
                  rows={3}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="e.g. Cheque returned by the bank — please resubmit."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doReject}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 size-4" />
              )}
              Reject entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
