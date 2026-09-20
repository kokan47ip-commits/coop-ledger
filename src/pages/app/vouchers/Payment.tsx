import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { LedgerVoucherForm } from "./LedgerVoucherForm";
import { VoucherList } from "./VoucherList";

export default function Payment() {
  const { societyId } = useSociety();

  return (
    <div>
      <PageHeader
        title="Payment Voucher"
        description="Society expenses and vendor payments — add the debit ledgers below and the credit to cash/bank is posted automatically."
      />

      {societyId ? <LedgerVoucherForm kind="payment" /> : null}

      <h3 className="mb-4 text-sm font-medium">Recorded payments</h3>
      <VoucherList title="Payment Vouchers" description="Payment vouchers" fixedType="payment" />
    </div>
  );
}
