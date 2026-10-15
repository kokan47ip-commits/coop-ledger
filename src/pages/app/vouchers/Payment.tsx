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
            ? "Editing an existing payment — date, cash/bank account, cheque details and narration can change. The amount and its entry lines stay fixed; delete and re-enter to change those."
            : "Society expenses and vendor payments — pick the debit ledger and enter the amount; the credit to cash/bank posts automatically, like Member Receipt. For a payment split across ledgers, use the Journal Voucher."
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
