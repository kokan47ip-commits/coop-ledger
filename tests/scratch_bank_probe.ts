/**
 * Scratch probe (NOT picked up by `bun test tests/` — no .test. in the name):
 * reproduces the reported "member receipt shows Dr AND Cr in the bank ledger,
 * nullifying the effect, while the member ledger is correct" symptom against
 * the real unifiedEntries/computeAccountLedger. Run: bun tests/scratch_bank_probe.ts
 */
import { expect, test } from "bun:test";
import {
  computeAccountLedger,
  unifiedEntries,
  type SocietyData,
} from "../src/convex/reports";

const BA = "acc_bank";
const REC = "acc_recv";
const M1 = "mem_1";

function buildData(vouchers: unknown[]): SocietyData {
  return {
    accounts: [
      { _id: BA, _creationTime: 0, societyId: "s1", code: "BNK1", name: "HDFC Bank", type: "asset", kind: "bank_cash", openingBalance: 0 },
      { _id: REC, _creationTime: 0, societyId: "s1", code: "REC1", name: "Members Receivable", type: "asset", kind: "bank_cash", openingBalance: 0 },
    ],
    members: [
      { _id: M1, _creationTime: 0, societyId: "s1", code: "01", name: "Member One", wing: "A", flatNo: "101", isActive: true, openingBalance: 0 },
    ],
    vouchers: vouchers as never,
    bills: [],
    society: { _id: "s1", _creationTime: 0, name: "T", fyStartMonth: 4 },
    tariffs: [],
    accountGroups: [],
  } as unknown as SocietyData;
}

/** Exactly what MemberReceipt.tsx / uploads.ts / postMemberReceipt insert. */
const receipt = {
  _id: "v1", _creationTime: 0, societyId: "s1",
  type: "member_receipt", voucherNo: "MR-0001", date: "2026-04-10",
  memberId: M1, mode: "UPI", bankCashAccountId: BA, reference: "UTR1",
  narration: "April maintenance", total: 2500,
  lines: [
    { accountId: BA, debit: 2500, credit: 0 },
    { accountId: REC, debit: 0, credit: 2500, note: "UPI" },
  ],
  allocations: [],
};

test("healthy config: receipt posts ONE bank ledger row (Dr only)", () => {
  // Here receivable is a proper receivable account, NOT bank-cash.
  const data = buildData([receipt]);
  (data.accounts[1] as { kind: string }).kind = "receivable";
  const bank = computeAccountLedger(data, BA, "2026-04-01", "2027-03-31");
  expect(bank.length).toBe(1);
  expect(bank[0].debit).toBe(2500);
  expect(bank[0].credit).toBe(0);
  expect(bank[0].balance).toBe(2500);
});

test("mis-set receivable (receivableAccountId = bank account): Dr+Cr nullify", () => {
  // Society Profile → receivableAccountId pointing AT the bank account: both
  // receipt lines then sit on the SAME account and the bank ledger nets to
  // zero, while the member ledger (keyed by memberId) stays correct.
  const data = buildData([
    {
      ...receipt,
      lines: [
        { accountId: BA, debit: 2500, credit: 0 },
        { accountId: BA, debit: 0, credit: 2500, note: "UPI" },
      ],
    },
  ]);
  expect(unifiedEntries(data)[0]!.lines.length).toBe(2);
  const bank = computeAccountLedger(data, BA, "2026-04-01", "2027-03-31");
  expect(bank.length).toBe(2); // ← the reported symptom
  expect(bank[0].debit).toBe(2500);
  expect(bank[1].credit).toBe(2500);
  expect(bank[1].balance).toBe(0); // ← "nullifying the effect"
});
