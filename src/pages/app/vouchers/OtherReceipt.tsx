import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { LedgerVoucherForm } from "./LedgerVoucherForm";
import { VoucherList } from "./VoucherList";

export default function OtherReceipt() {
  const { societyId } = useSociety();

  return (
    <div>
      <PageHeader
        title="Other Receipt"
        description="Non-member receipts such as interest income, hall rentals or donations — add the credit ledgers below and the debit to cash/bank is posted automatically."
      />

      {societyId ? <LedgerVoucherForm kind="other_receipt" /> : null}

      <h3 className="mb-4 text-sm font-medium">Recorded other receipts</h3>
      <VoucherList title="Other Receipts" description="Other receipt vouchers" fixedType="other_receipt" />
    </div>
  );
}
