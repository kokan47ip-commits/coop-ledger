import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { LedgerVoucherForm } from "./LedgerVoucherForm";
import { VoucherList } from "./VoucherList";
import { useSearchParams } from "react-router";

export default function Payment() {
  const { societyId } = useSociety();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit") ?? undefined;

  return (
    <div>
      <PageHeader
        title={editId ? "Edit Payment Voucher" : "Payment Voucher"}
        description={
          editId
            ? "Editing an existing payment — every line is now explicit and debits must equal credits."
            : "Society expenses and vendor payments — add the debit ledgers below and the credit to cash/bank is posted automatically."
        }
      />

      {societyId ? (
        <LedgerVoucherForm
          kind="payment"
          editId={editId}
          onEditDone={() => setSearchParams({})}
        />
      ) : null}

      <h3 className="mb-4 text-sm font-medium">Recorded payments</h3>
      <VoucherList title="Payment Vouchers" description="Payment vouchers" fixedType="payment" />
    </div>
  );
}
