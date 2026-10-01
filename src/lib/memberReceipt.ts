import {
  bytesToBase64,
  receiptPdfBytes,
  type LegacyReceiptData,
} from "@/lib/billDoc";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Shared member-receipt document builder. PortalReceipts (download buttons),
 * the UPI payment flow (auto-download + auto-email after a successful
 * payment) and any future caller all build the exact same receipt data, so
 * the printed receipt can never drift between pages.
 */

/** Minimal society shape (the SocietyContext society object fits). */
export type ReceiptSocietyLike = {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  registrationNo?: string;
};

/** Minimal member receipt voucher shape (the vouchers doc fits). */
export type ReceiptVoucherLike = {
  voucherNo: string;
  date: string;
  total: number;
  mode?: string;
  reference?: string;
  narration?: string;
  allocations?: { billId: Id<"bills">; amount: number }[] | null;
};

export type ReceiptBillLike = { _id: Id<"bills">; period: string };

/** Build the receipt document data shown on the printed/PDF receipt. */
export function buildMemberReceiptData(args: {
  society: ReceiptSocietyLike | null;
  memberBinding: {
    name: string;
    flatNo?: string;
    wing?: string;
    code: string;
  } | null;
  voucher: ReceiptVoucherLike;
  bills?: ReceiptBillLike[] | null;
}): LegacyReceiptData {
  const { society, memberBinding, voucher, bills } = args;
  // Purpose line: the most recent period among the bills this receipt
  // settled, falling back to the voucher narration.
  const firstBill = (bills ?? [])
    .filter((b) => (voucher.allocations ?? []).some((a) => a.billId === b._id))
    .sort((a, b) => b.period.localeCompare(a.period))[0];
  return {
    society: {
      name: society?.name ?? "",
      address: [
        society?.address,
        society?.city,
        society?.state,
        society?.pincode,
      ]
        .filter(Boolean)
        .join(", "),
      registrationNo: society?.registrationNo,
    },
    receiptNo: voucher.voucherNo.replace(/^[A-Z]+-/, ""),
    receiptDate: voucher.date,
    memberName: memberBinding?.name ?? "Member",
    flatNo:
      [memberBinding?.wing, memberBinding?.flatNo].filter(Boolean).join("-") ||
      memberBinding?.code,
    amount: voucher.total,
    paymentKind: "part",
    purpose: firstBill
      ? `Maintenance for the Month ${firstBill.period}`
      : voucher.narration || "Maintenance dues",
    mode: voucher.mode,
    reference: voucher.reference,
  };
}

/** Receipt PDF bytes as base64 — the shape the email action expects. */
export function receiptPdfBase64(data: LegacyReceiptData): string {
  return bytesToBase64(receiptPdfBytes(data));
}
