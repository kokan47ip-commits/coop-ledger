import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { LedgerVoucherForm } from "./LedgerVoucherForm";
import { VoucherList } from "./VoucherList";
import { useSearchParams } from "react-router";

export default function OtherReceipt() {
  const { societyId } = useSociety();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit") ?? undefined;

  return (
    <div>
      <PageHeader
        title={editId ? "Edit Other Receipt" : "Other Receipt"}
        description={
          editId
            ? "Editing an existing receipt — date, cash/bank account, cheque details and narration can change. The amount and its entry lines stay fixed; delete and re-enter to change those."
            : "Non-member collections such as interest, hall rentals or donations — pick the credit ledger and enter the amount; the debit to cash/bank posts automatically, like Member Receipt."
        }
      />

      {societyId ? (
        <LedgerVoucherForm
          kind="other_receipt"
          editId={editId}
          onEditDone={() => setSearchParams({})}
        />
      ) : null}

      <h3 className="mb-4 text-sm font-medium">Recorded other receipts</h3>
      <VoucherList
        title="Other Receipts"
        description="Other receipt vouchers"
        fixedType="other_receipt"
        receiptMode="receipt"
        receiptNoun="Receipts"
      />
    </div>
  );
}
