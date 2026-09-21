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
            ? "Editing an existing receipt — every line is now explicit and debits must equal credits."
            : "Non-member receipts such as interest income, hall rentals or donations — add the credit ledgers below and the debit to cash/bank is posted automatically."
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
      <VoucherList title="Other Receipts" description="Other receipt vouchers" fixedType="other_receipt" />
    </div>
  );
}
