/**
 * Payment-flow smoke tests (bun:test, run with `bun test tests/`).
 *
 * These exercise the REAL Convex handlers (via their `._handler` entrypoint —
 * `mutation()` stores the original handler on that property) against a
 * faithful in-memory db + auth stub: pending-submission creation, the member
 * edit/delete guards, office approval posting (with allocation re-clamping),
 * rejection, access control and idempotent UPI posting.
 *
 * Not part of the vite build (tsconfig.app includes only src/); run via bun.
 */
import { describe, expect, test } from "bun:test";
import * as memberPortal from "../src/convex/memberPortal";
import * as approvalsMod from "../src/convex/approvals";
import * as paymentsMod from "../src/convex/payments";
import { clampAllocations, isCarriedOpeningLine, societyFyPeriod } from "../src/convex/lib";

/* ----------------------------- fake convex ctx ---------------------------- */

type Doc = { _id: string; _creationTime: number } & Record<string, unknown>;

function makeDb() {
  const tables = new Map<string, Map<string, Doc>>();
  const byId = new Map<string, string>();
  let clock = 0;
  let seq = 0;
  const ensure = (t: string) => {
    let m = tables.get(t);
    if (!m) {
      m = new Map();
      tables.set(t, m);
    }
    return m;
  };
  const db = {
    // Convex db.get(id) takes a single id; the table comes from an internal
    // map. Also support get(table, id) for test-side convenience reads.
    async get(a: string, b?: string) {
      if (b === undefined) {
        const t = byId.get(a);
        return t ? (ensure(t).get(a) ?? null) : null;
      }
      return ensure(a).get(b) ?? null;
    },
    async insert(t: string, doc: Record<string, unknown>) {
      const id = `id${++seq}`;
      const row: Doc = { _id: id, _creationTime: ++clock, ...doc };
      ensure(t).set(id, row);
      byId.set(id, t);
      return id;
    },
    async patch(id: string, p: Record<string, unknown>) {
      const t = byId.get(id);
      if (!t) throw new Error(`patch: unknown id ${id}`);
      const row = ensure(t).get(id);
      if (!row) throw new Error(`patch: missing row ${id}`);
      for (const [k, v] of Object.entries(p)) {
        // Convex patch semantics: undefined fields clear the stored value.
        if (v === undefined) delete row[k];
        else row[k] = v;
      }
    },
    async delete(id: string) {
      const t = byId.get(id);
      if (!t) return;
      ensure(t).delete(id);
      byId.delete(id);
    },
    query(t: string) {
      let current: Doc[] | null = null;
      let dir: "asc" | "desc" | null = null;
      const base = () =>
        [...ensure(t).values()].sort((a, b) => a._creationTime - b._creationTime);
      const sorted = (rows: Doc[]) =>
        dir === "desc" ? [...rows].reverse() : rows;
      const h = {
        withIndex(_name: string, cb?: (q: unknown) => unknown) {
          const pairs: Record<string, unknown> = {};
          const q = {
            eq: (f: string, v: unknown) => {
              pairs[f] = v;
              return q;
            },
          };
          (cb as ((q: typeof q) => unknown) | undefined)?.(q);
          current = (current ?? base()).filter((r) =>
            Object.entries(pairs).every(([k, v]) => r[k] === v),
          );
          return h;
        },
        order(d: "asc" | "desc") {
          dir = d;
          return h;
        },
        filter(fn: (q: unknown) => unknown) {
          // Convex filter callbacks receive a query builder: (q) =>
          // q.eq(q.field("voucherNo"), value). Build one that returns a
          // row predicate, so handlers written against real Convex work.
          const q = {
            field: (name: string) => name,
            eq: (a: unknown, b: unknown) => (row: Doc) => row[a as string] === b,
          };
          const pred = fn(q) as (r: Doc) => boolean;
          current = (current ?? base()).filter(pred);
          return h;
        },
        async collect() {
          return sorted(current ?? base());
        },
        async take(n: number) {
          return sorted(current ?? base()).slice(0, n);
        },
        async unique() {
          const all = sorted(current ?? base());
          if (all.length > 1) throw new Error("unique(): multiple rows");
          return all[0] ?? null;
        },
        async first() {
          // Convex .first(): the first row after withIndex/filter, or null.
          const all = sorted(current ?? base());
          return all[0] ?? null;
        },
      };
      return h;
    },
  };
  return { db, dump: (t: string) => [...ensure(t).values()] };
}

function buildWorldHelpers(world: { db: ReturnType<typeof makeDb>["db"] }) {
  return (userId: string | null) => ({
    db: world.db,
    auth: {
      async getUserIdentity() {
        return userId
          ? {
              subject: userId,
              tokenIdentifier: `t:${userId}`,
              issuer: "test",
              audience: ["test"],
            }
          : null;
      },
    },
  });
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

/* --------------------------------- world ---------------------------------- */

async function seedWorld() {
  const made = makeDb();
  const { db, dump } = made;
  const ctxFor = buildWorldHelpers({ db });

  const today = new Date().toISOString().slice(0, 10);
  const fyStart = `${today.slice(0, 8)}01`;

  const ownerUserId = await db.insert("users", { email: "owner@x.com" });
  const societyId = await db.insert("societies", {
    name: "Test CHS",
    fyStartMonth: 4,
    fyStartDate: fyStart,
    fyYear: "2026-27",
    createdBy: ownerUserId,
  });
  const bankId = await db.insert("accounts", {
    societyId,
    kind: "bank_cash",
    code: "B1",
    name: "HDFC Current",
  });
  const receivableId = await db.insert("accounts", {
    societyId,
    kind: "receivable",
    code: "R1",
    name: "Members Receivable",
  });
  await db.patch(societyId, { receivableAccountId: receivableId });

  const memberId = await db.insert("members", {
    societyId,
    name: "Ravi Kumar",
    wing: "A",
    flatNo: "101",
    code: "A-101",
    isActive: true,
  });
  const memberUserId = await db.insert("users", { email: "ravi@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: memberUserId,
    email: "ravi@x.com",
    role: "member",
    memberId,
    grantedBy: ownerUserId,
    createdAt: 0,
  });

  const editorUserId = await db.insert("users", { email: "editor@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: editorUserId,
    email: "editor@x.com",
    role: "editor",
    grantedBy: ownerUserId,
    createdAt: 0,
  });
  const viewerUserId = await db.insert("users", { email: "viewer@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: viewerUserId,
    email: "viewer@x.com",
    role: "viewer",
    grantedBy: ownerUserId,
    createdAt: 0,
  });

  // Bill 1: 5000 total, 1000 paid → 4000 balance. Bill 2: 2000 → 2000 balance.
  const bill1 = await db.insert("bills", {
    societyId,
    memberId,
    billNo: "B-2026-001",
    period: "2026-04",
    issueDate: today,
    dueDate: today,
    total: 5000,
    paidAmount: 1000,
    status: "partial",
  });
  const bill2 = await db.insert("bills", {
    societyId,
    memberId,
    billNo: "B-2026-002",
    period: "2026-05",
    issueDate: today,
    dueDate: today,
    total: 2000,
    paidAmount: 0,
    status: "unpaid",
  });

  // A pending portal entry: 6000 against bill1(4000) + bill2(2000).
  const submit = fn(memberPortal, "submitPayment");
  const created = (await submit(ctxFor(memberUserId), {
    societyId,
    date: today,
    bankCashAccountId: bankId,
    mode: "cheque",
    reference: "CHQ 12",
    narration: "April + May dues",
    allocations: [
      { billId: bill1, amount: 4000 },
      { billId: bill2, amount: 2000 },
    ],
    amount: undefined,
  })) as { submissionId: string; status: string; total: number };

  return {
    db,
    dump,
    today,
    fyStart,
    societyId,
    bankId,
    receivableId,
    memberId,
    memberUserId,
    editorUserId,
    viewerUserId,
    bill1,
    bill2,
    submissionId: created.submissionId,
    memberCtx: ctxFor(memberUserId),
    editorCtx: ctxFor(editorUserId),
    viewerCtx: ctxFor(viewerUserId),
    anonCtx: ctxFor(null),
  };
}

async function seedUpi(w: Awaited<ReturnType<typeof seedWorld>>) {
  const paymentId = await w.db.insert("upiPayments", {
    societyId: w.societyId,
    memberId: w.memberId,
    createdById: w.memberUserId,
    amount: 7000,
    status: "created",
    provider: "razorpay",
    providerOrderId: "order_test_1",
    allocations: [{ billId: w.bill1, amount: 4000 }],
    advanceAmount: 3000,
    createdAt: Date.now(),
  });
  return paymentId;
}

/* ------------------------------- pure helper ------------------------------ */

describe("clampAllocations", () => {
  test("clamps to balance, drops missing/zero/negative, rounds to paise", () => {
    const applied = clampAllocations(
      [
        { billId: "b1", amount: 5000 },
        { billId: "b2", amount: 2000 },
        { billId: "b3", amount: 300 },
        { billId: "b4", amount: 3.678 },
        { billId: "b5", amount: 100 },
      ],
      (id) =>
        id === "b1" ? 4000 : id === "b2" ? undefined : id === "b3" ? 0 : id === "b4" ? 100 : -50,
    );
    expect(applied).toEqual([{ billId: "b1", amount: 4000 }, { billId: "b4", amount: 3.68 }]);
  });

  test("keeps everything when balances suffice", () => {
    const applied = clampAllocations(
      [
        { billId: "x", amount: 10 },
        { billId: "y", amount: 0.01 },
      ],
      () => 1000,
    );
    expect(applied).toEqual([
      { billId: "x", amount: 10 },
      { billId: "y", amount: 0.01 },
    ]);
  });
});

/* ---------------------------- member submissions --------------------------- */

describe("submitPayment (member portal entry)", () => {
  test("creates a pending submission with correct amount/advance", async () => {
    const w = await seedWorld();
    const res = (await fn(memberPortal, "submitPayment")(w.memberCtx, {
      societyId: w.societyId,
      date: w.today,
      bankCashAccountId: w.bankId,
      mode: "upi",
      reference: "UPI 99",
      narration: undefined,
      allocations: [{ billId: w.bill1, amount: 1500 }],
      amount: 2000,
    })) as { status: string; total: number; submissionId: string };

    expect(res.status).toBe("pending");
    expect(res.total).toBe(2000);
    const row = await w.db.get("paymentSubmissions", res.submissionId);
    expect(row?.amount).toBe(2000);
    expect(row?.advanceAmount).toBe(500);
    expect(row?.status).toBe("pending");
    expect(row?.bankCashAccountId).toBe(w.bankId);
  });

  test("pure advance with no bill selections", async () => {
    const w = await seedWorld();
    const res = (await fn(memberPortal, "submitPayment")(w.memberCtx, {
      societyId: w.societyId,
      date: w.today,
      bankCashAccountId: w.bankId,
      mode: "cash",
      allocations: [],
      amount: 2500,
    })) as { total: number };
    expect(res.total).toBe(2500);
  });

  test("declines dates outside the books period", async () => {
    const w = await seedWorld();
    expect(
      fn(memberPortal, "submitPayment")(w.memberCtx, {
        societyId: w.societyId,
        date: "2030-01-01",
        bankCashAccountId: w.bankId,
        allocations: [],
        amount: 100,
      }),
    ).rejects.toThrow(/outside the current financial year/);
  });

  test("declines allocations beyond the bill balance", async () => {
    const w = await seedWorld();
    expect(
      fn(memberPortal, "submitPayment")(w.memberCtx, {
        societyId: w.societyId,
        date: w.today,
        bankCashAccountId: w.bankId,
        allocations: [{ billId: w.bill1, amount: 9999 }],
      }),
    ).rejects.toThrow(/exceeds its balance/);
  });

  test("declines bills that belong to another flat", async () => {
    const w = await seedWorld();
    const otherBill = await w.db.insert("bills", {
      societyId: w.societyId,
      memberId: "someoneElse",
      billNo: "B-OTHER",
      period: "2026-05",
      total: 1000,
      paidAmount: 0,
      status: "unpaid",
    });
    expect(
      fn(memberPortal, "submitPayment")(w.memberCtx, {
        societyId: w.societyId,
        date: w.today,
        bankCashAccountId: w.bankId,
        allocations: [{ billId: otherBill, amount: 500 }],
      }),
    ).rejects.toThrow(/does not belong to your flat/);
  });

  test("declines logins not bound to a flat", async () => {
    const w = await seedWorld();
    expect(
      fn(memberPortal, "submitPayment")(w.anonCtx, {
        societyId: w.societyId,
        date: w.today,
        bankCashAccountId: w.bankId,
        allocations: [],
        amount: 100,
      }),
    ).rejects.toThrow(/not linked to a flat/);
  });
});

describe("updateSubmission / deleteSubmission (pending-only)", () => {
  test("member edits own pending entry; editedAt is stamped", async () => {
    const w = await seedWorld();
    const res = (await fn(memberPortal, "updateSubmission")(w.memberCtx, {
      societyId: w.societyId,
      id: w.submissionId,
      date: w.today,
      bankCashAccountId: w.bankId,
      mode: "cheque",
      allocations: [{ billId: w.bill2, amount: 1500 }],
      amount: 1500,
    })) as { ok: boolean; total: number };
    expect(res.ok).toBe(true);
    expect(res.total).toBe(1500);
    const row = await w.db.get("paymentSubmissions", w.submissionId);
    expect(row?.status).toBe("pending");
    expect(row?.amount).toBe(1500);
    expect(row?.advanceAmount).toBe(0);
    expect(typeof row?.editedAt).toBe("number");
  });

  test("passed entries can no longer be edited or deleted", async () => {
    const w = await seedWorld();
    // Office passes the entry first.
    const approved = (await fn(approvalsMod, "approve")(w.editorCtx, {
      societyId: w.societyId,
      id: w.submissionId,
    })) as { voucherNo: string };
    expect(approved.voucherNo).toBe("MR-0001");

    expect(
      fn(memberPortal, "updateSubmission")(w.memberCtx, {
        societyId: w.societyId,
        id: w.submissionId,
        date: w.today,
        bankCashAccountId: w.bankId,
        allocations: [],
        amount: 1,
      }),
    ).rejects.toThrow(/can no longer be edited/);
    expect(
      fn(memberPortal, "deleteSubmission")(w.memberCtx, {
        societyId: w.societyId,
        id: w.submissionId,
      }),
    ).rejects.toThrow(/can no longer be deleted/);
  });

  test("member cannot edit or delete another flat's entry", async () => {
    const w = await seedWorld();
    const otherUserId = await w.db.insert("users", { email: "other@x.com" });
    const otherMemberId = await w.db.insert("members", {
      societyId: w.societyId,
      name: "Other Member",
      code: "B-999",
      isActive: true,
    });
    await w.db.insert("membersAccess", {
      societyId: w.societyId,
      userId: otherUserId,
      email: "other@x.com",
      role: "member",
      memberId: otherMemberId,
      grantedBy: "x",
      createdAt: 0,
    });
    const otherCtx = buildWorldHelpers({ db: w.db })(otherUserId);
    expect(
      fn(memberPortal, "deleteSubmission")(otherCtx, {
        societyId: w.societyId,
        id: w.submissionId,
      }),
    ).rejects.toThrow(/Payment entry not found/);
    expect(
      fn(memberPortal, "updateSubmission")(otherCtx, {
        societyId: w.societyId,
        id: w.submissionId,
        date: w.today,
        bankCashAccountId: w.bankId,
        allocations: [],
        amount: 1,
      }),
    ).rejects.toThrow(/Payment entry not found/);
  });

  test("member deletes own pending entry", async () => {
    const w = await seedWorld();
    const res = (await fn(memberPortal, "deleteSubmission")(w.memberCtx, {
      societyId: w.societyId,
      id: w.submissionId,
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(await w.db.get("paymentSubmissions", w.submissionId)).toBeNull();
  });
});

/* ----------------------------- office approvals ---------------------------- */

describe("approvals.approve", () => {
  test("editor passes a pending entry: voucher, lines and bill settlement", async () => {
    const w = await seedWorld();
    const res = (await fn(approvalsMod, "approve")(w.editorCtx, {
      societyId: w.societyId,
      id: w.submissionId,
    })) as { voucherNo: string; total: number };

    expect(res.total).toBe(6000);
    expect(res.voucherNo).toBe("MR-0001");

    const vouchers = w.dump("vouchers");
    expect(vouchers).toHaveLength(1);
    const v = vouchers[0];
    expect(v.type).toBe("member_receipt");
    expect(v.total).toBe(6000);
    // The credit line carries the payment mode as its note (lib.postMemberReceipt).
    expect(v.lines).toEqual([
      { accountId: w.bankId, debit: 6000, credit: 0 },
      { accountId: w.receivableId, debit: 0, credit: 6000, note: "cheque" },
    ]);

    const bill1 = await w.db.get("bills", w.bill1);
    const bill2 = await w.db.get("bills", w.bill2);
    expect(bill1?.paidAmount).toBe(5000);
    expect(bill2?.paidAmount).toBe(2000);

    const sub = await w.db.get("paymentSubmissions", w.submissionId);
    expect(sub?.status).toBe("posted");
    expect(sub?.voucherId).toBe(v._id);
    expect(sub?.reviewedById).toBe(w.editorUserId);
  });

  test("stale allocations re-clamp; the member's amount still lands (rest = advance)", async () => {
    const w = await seedWorld();
    // Office already settled bill1 in full while the entry sat pending.
    await w.db.patch(w.bill1, { paidAmount: 5000, status: "paid" });
    const res = (await fn(approvalsMod, "approve")(w.editorCtx, {
      societyId: w.societyId,
      id: w.submissionId,
    })) as { total: number };

    expect(res.total).toBe(6000); // member's money preserved
    const vouchers = w.dump("vouchers");
    expect(vouchers).toHaveLength(1);
    const v = vouchers[0];
    expect(v.total).toBe(6000);
    // Only bill2's 2000 fits; bill1 is already paid so nothing applies there.
    expect(v.allocations).toEqual([{ billId: w.bill2, amount: 2000 }]);
    const bill2 = await w.db.get("bills", w.bill2);
    expect(bill2?.paidAmount).toBe(2000);
  });

  test("double approval is rejected", async () => {
    const w = await seedWorld();
    await fn(approvalsMod, "approve")(w.editorCtx, {
      societyId: w.societyId,
      id: w.submissionId,
    });
    expect(
      fn(approvalsMod, "approve")(w.editorCtx, {
        societyId: w.societyId,
        id: w.submissionId,
      }),
    ).rejects.toThrow(/already passed/);
  });

  test("member-role and viewer logins cannot approve", async () => {
    const w = await seedWorld();
    expect(
      fn(approvalsMod, "approve")(w.memberCtx, {
        societyId: w.societyId,
        id: w.submissionId,
      }),
    ).rejects.toThrow(/Society not found/);
    expect(
      fn(approvalsMod, "approve")(w.viewerCtx, {
        societyId: w.societyId,
        id: w.submissionId,
      }),
    ).rejects.toThrow(/view-only rights/);
    const sub = await w.db.get("paymentSubmissions", w.submissionId);
    expect(sub?.status).toBe("pending");
  });

  test("date override must stay inside the books period", async () => {
    const w = await seedWorld();
    expect(
      fn(approvalsMod, "approve")(w.editorCtx, {
        societyId: w.societyId,
        id: w.submissionId,
        date: "2030-01-01",
      }),
    ).rejects.toThrow(/outside the current financial year/);
  });
});

describe("approvals.reject", () => {
  test("editor rejects with a reason; entry is kept", async () => {
    const w = await seedWorld();
    const res = (await fn(approvalsMod, "reject")(w.editorCtx, {
      societyId: w.societyId,
      id: w.submissionId,
      note: "Cheque bounced",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    const sub = await w.db.get("paymentSubmissions", w.submissionId);
    expect(sub?.status).toBe("rejected");
    expect(sub?.reviewNote).toBe("Cheque bounced");
    expect(w.dump("vouchers")).toHaveLength(0);
    const bill1 = await w.db.get("bills", w.bill1);
    expect(bill1?.paidAmount).toBe(1000); // untouched
  });

  test("posted entries cannot be rejected", async () => {
    const w = await seedWorld();
    await fn(approvalsMod, "approve")(w.editorCtx, {
      societyId: w.societyId,
      id: w.submissionId,
    });
    expect(
      fn(approvalsMod, "reject")(w.editorCtx, {
        societyId: w.societyId,
        id: w.submissionId,
      }),
    ).rejects.toThrow(/already passed/);
  });
});

/* -------------------------------- UPI posting ------------------------------ */

describe("upi posting (internalPostUpiPayment)", () => {
  test("posts once; replay is an idempotent no-op", async () => {
    const w = await seedWorld();
    const paymentId = await seedUpi(w);
    const post = fn(paymentsMod, "internalPostUpiPayment");

    const first = (await post(w.anonCtx, { paymentId })) as {
      posted: boolean;
      voucherNo: string;
    };
    expect(first.posted).toBe(true);
    expect(first.voucherNo).toBe("MR-0001");
    expect(w.dump("vouchers")).toHaveLength(1);

    const replay = (await post(w.anonCtx, { paymentId })) as {
      posted: boolean;
      alreadyPosted: boolean;
      voucherNo: string;
    };
    expect(replay.posted).toBe(true);
    expect(replay.alreadyPosted).toBe(true);
    expect(replay.voucherNo).toBe(first.voucherNo);
    expect(w.dump("vouchers")).toHaveLength(1); // no double voucher

    const bill1 = await w.db.get("bills", w.bill1);
    expect(bill1?.paidAmount).toBe(5000);
    const p = await w.db.get("upiPayments", paymentId);
    expect(p?.status).toBe("posted");
    expect(typeof p?.postedAt).toBe("number");
  });

  test("advance portion over the allocations is preserved in the voucher", async () => {
    const w = await seedWorld();
    const paymentId = await seedUpi(w);
    await fn(paymentsMod, "internalPostUpiPayment")(w.anonCtx, { paymentId });
    const v = w.dump("vouchers")[0];
    expect(v.total).toBe(7000); // 4000 to bill1 + 3000 advance
    expect(v.allocations).toEqual([{ billId: w.bill1, amount: 4000 }]);
  });

  test("missing receivable account parks the payment as captured", async () => {
    const w = await seedWorld();
    // Society without a receivable account: postMemberReceipt cannot run.
    await w.db.patch(w.societyId, { receivableAccountId: undefined });
    const receivable = w
      .dump("accounts")
      .find((a) => a.kind === "receivable");
    if (receivable) await w.db.delete(receivable._id);

    const paymentId = await seedUpi(w);
    const res = (await fn(paymentsMod, "internalPostUpiPayment")(w.anonCtx, {
      paymentId,
    })) as { posted: boolean };
    expect(res.posted).toBe(false);
    const p = await w.db.get("upiPayments", paymentId);
    expect(p?.status).toBe("captured");
    expect(String(p?.failureReason ?? "")).toContain("Receivable");
    expect(w.dump("vouchers")).toHaveLength(0);
  });
});

/* ------------------------------ period sanity ------------------------------ */

describe("societyFyPeriod", () => {
  test("spans exactly one year from the explicit start", () => {
    const period = societyFyPeriod({
      fyStartDate: "2025-04-01",
      fyStartMonth: 4,
      name: "x",
    } as never);
    expect(period.from).toBe("2025-04-01");
    expect(period.to).toBe("2026-03-31");
  });
});

/* ------------------------ UPI QR payload construction ---------------------- */

import {
  amountUpiUri,
  memberUpiUri,
  qrMatrix,
} from "../src/lib/upiQr";

describe("memberUpiUri", () => {
  test("carries payee, society name and cu=INR", () => {
    const uri = memberUpiUri({
      payeeName: "Green Meadows CHS",
      vpa: "greenmeadowschs@hdfcbank",
      flat: "A-101",
      code: "M001",
    });
    expect(uri.startsWith("upi://pay?")).toBe(true);
    expect(uri).toContain("pa=greenmeadowschs%40hdfcbank"); // @ is percent-encoded
    expect(uri).toContain("pn=Green+Meadows+CHS");
    expect(uri).toContain("cu=INR");
  });

  test("embeds a sanitized flat tag in the payee note", () => {
    const uri = memberUpiUri({
      payeeName: "S",
      vpa: "s@bank",
      flat: "a-101 / b",
      code: "M001",
    });
    expect(uri).toContain("tn=Maint+A101B"); // separators stripped, uppercased
  });

  test("falls back to the member code when no flat is set, caps the tag at 12 chars", () => {
    const uri = memberUpiUri({
      payeeName: "S",
      vpa: "s@bank",
      flat: undefined,
      code: "MEMBER00012345",
    });
    expect(uri).toContain("tn=Maint+MEMBER00012"); // 12-char cap
  });

  test("note is just Maint when neither flat nor code is provided", () => {
    const uri = memberUpiUri({ payeeName: "S", vpa: "s@bank" });
    expect(uri).toContain("tn=Maint&");
  });
});

describe("amountUpiUri", () => {
  test("appends the amount with two decimals", () => {
    const base = memberUpiUri({ payeeName: "S", vpa: "s@bank", flat: "A-1" });
    const uri = amountUpiUri(base, 1234.5);
    expect(uri).toContain("&am=1234.50");
  });

  test("rounds to two decimals", () => {
    const uri = amountUpiUri("upi://pay?pa=x", 1234.567);
    expect(uri.endsWith("am=1234.57")).toBe(true);
  });

  test("appends with ? when the base has no query", () => {
    expect(amountUpiUri("upi://pay", 10).endsWith("?am=10.00")).toBe(true);
  });
});

describe("qrMatrix", () => {
  test("produces a square boolean grid with finder-pattern corners", () => {
    const payload = memberUpiUri({ payeeName: "S", vpa: "s@bank", flat: "A-1" });
    const m = qrMatrix(payload);
    expect(m.length).toBeGreaterThanOrEqual(21); // minimum QR version 1
    expect(m.every((row) => row.length === m.length)).toBe(true);
    // Finder patterns: three corners carry a dark 7x7 ring — the very corner
    // cell must be dark and the cell just outside the 7x7 ring light.
    expect(m[0][0]).toBe(true);
    expect(m[6][6]).toBe(true);
    expect(m[0][7]).toBe(false);
    expect(m[7][0]).toBe(false);
  });

  test("is deterministic for the same payload", () => {
    const a = qrMatrix("upi://pay?pa=demo");
    const b = qrMatrix("upi://pay?pa=demo");
    expect(a).toEqual(b);
  });

  test("changes with the payload (per-member URIs produce distinct codes)", () => {
    const a = qrMatrix(memberUpiUri({ payeeName: "S", vpa: "s@bank", flat: "A-1" }));
    const b = qrMatrix(memberUpiUri({ payeeName: "S", vpa: "s@bank", flat: "B-2" }));
    expect(a).not.toEqual(b);
  });
});

/* -------------------- carried opening-balance line helper ------------------ */

describe("isCarriedOpeningLine", () => {
  const receivable = "accR";

  test("recognises the generated arrears / credit-balance wording", () => {
    expect(
      isCarriedOpeningLine(
        { name: "Arrears — opening balance", accountId: receivable },
        receivable,
      ),
    ).toBe(true);
    expect(
      isCarriedOpeningLine(
        { name: "Credit balance — advance adjusted", accountId: "accX" },
        receivable,
      ),
    ).toBe(true);
  });

  test("never matches interest / late-fee lines or normal charge heads", () => {
    expect(
      isCarriedOpeningLine(
        { name: "Interest on arrears @ 1.5% p.m.", accountId: "accI" },
        receivable,
      ),
    ).toBe(false);
    expect(
      isCarriedOpeningLine(
        { name: "Parking Charges", accountId: "accI", tariffId: "t1" },
        receivable,
      ),
    ).toBe(false);
  });

  test("account fallback catches renamed receivable-only lines; tariffed lines stay", () => {
    expect(
      isCarriedOpeningLine({ name: "Old wording", accountId: receivable }, receivable),
    ).toBe(true);
    expect(
      isCarriedOpeningLine(
        { name: "Adjusted", accountId: receivable, tariffId: "t1" },
        receivable,
      ),
    ).toBe(false);
  });
});

/* --------- opening balance is counted once (April-2026 total-due bug) ------- */

type LedgerRowT = {
  voucherNo: string;
  debit: number;
  credit: number;
  balance: number;
  heads?: { name: string; amount: number }[];
};

/**
 * Member with Rs.100 opening + an April-2026 bill whose lines are the carried
 * opening (100) plus charges (50). `staleCarried` simulates the carried line
 * pointing at an OLD receivable account (the account was changed after the
 * bills were generated); `billTotal` simulates older double-stored totals.
 */
async function seedOpeningWorld(
  opts: { staleCarried?: boolean; billTotal?: number } = {},
) {
  const { db } = makeDb();
  const ctxFor = buildWorldHelpers({ db });
  const today = new Date().toISOString().slice(0, 10);
  const fyStart = `${today.slice(0, 8)}01`;
  const ownerUserId = await db.insert("users", { email: "owner@x.com" });
  const societyId = await db.insert("societies", {
    name: "Test CHS",
    fyStartMonth: 4,
    fyStartDate: fyStart,
    fyYear: "2026-27",
    createdBy: ownerUserId,
  });
  const receivableId = await db.insert("accounts", {
    societyId,
    kind: "receivable",
    code: "R1",
    name: "Members Receivable",
  });
  await db.patch(societyId, { receivableAccountId: receivableId });
  const memberId = await db.insert("members", {
    societyId,
    name: "Ravi Kumar",
    wing: "A",
    flatNo: "101",
    code: "A-101",
    isActive: true,
    openingBalance: 100,
    openingDate: "2026-04-01",
  });
  const memberUserId = await db.insert("users", { email: "ravi@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: memberUserId,
    email: "ravi@x.com",
    role: "member",
    memberId,
    grantedBy: ownerUserId,
    createdAt: 0,
  });
  await db.insert("bills", {
    societyId,
    memberId,
    billNo: "BILL-0001",
    period: "2026-04",
    issueDate: "2026-04-01",
    dueDate: "2026-04-15",
    lines: [
      {
        accountId: opts.staleCarried ? "accStale" : receivableId,
        name: "Arrears — opening balance",
        amount: 100,
      },
      { accountId: "accIncome", name: "Maintenance Charges", amount: 50 },
    ],
    total: opts.billTotal ?? 150,
    paidAmount: 0,
    status: "unpaid",
  });
  return { societyId, receivableId, memberCtx: ctxFor(memberUserId) };
}

describe("opening balance counted once in ledger and outstanding", () => {
  test("healthy data: opening 100 Dr + April bill 50 Dr → closing 150, outstanding 150", async () => {
    const w = await seedOpeningWorld();
    const rows = (await fn(memberPortal, "myLedger")(w.memberCtx, {
      societyId: w.societyId,
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    })) as LedgerRowT[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.voucherNo).toBe("OPENING");
    expect(rows[0]!.debit).toBe(100);
    expect(rows[0]!.balance).toBe(100);
    expect(rows[1]!.voucherNo).toBe("BILL-0001");
    expect(rows[1]!.debit).toBe(50); // NOT 150 — the carried line is not debited twice
    expect(rows[1]!.heads).toEqual([{ name: "Maintenance Charges", amount: 50 }]);
    expect(rows[1]!.balance).toBe(150);
    const info = (await fn(memberPortal, "myInfo")(w.memberCtx, {
      societyId: w.societyId,
    })) as { totals: { totalBilled: number; totalPaid: number; outstanding: number } } | null;
    expect(info?.totals.totalBilled).toBe(50);
    expect(info?.totals.outstanding).toBe(150);
  });

  test("receivable account changed after generation: name-based check keeps total 150", async () => {
    const w = await seedOpeningWorld({ staleCarried: true });
    const rows = (await fn(memberPortal, "myLedger")(w.memberCtx, {
      societyId: w.societyId,
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    })) as LedgerRowT[];
    expect(rows).toHaveLength(2);
    expect(rows[1]!.debit).toBe(50); // 100 (opening) + 150 (bill) would be the bug
    expect(rows[1]!.balance).toBe(150);
    const info = (await fn(memberPortal, "myInfo")(w.memberCtx, {
      societyId: w.societyId,
    })) as { totals: { totalBilled: number; outstanding: number } } | null;
    expect(info?.totals.totalBilled).toBe(50);
    expect(info?.totals.outstanding).toBe(150);
  });

  test("older double-stored total (250): ledger debits charges only → closing 150", async () => {
    const w = await seedOpeningWorld({ billTotal: 250 });
    const rows = (await fn(memberPortal, "myLedger")(w.memberCtx, {
      societyId: w.societyId,
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    })) as LedgerRowT[];
    expect(rows[1]!.debit).toBe(50);
    expect(rows[1]!.balance).toBe(150);
    const info = (await fn(memberPortal, "myInfo")(w.memberCtx, {
      societyId: w.societyId,
    })) as { totals: { totalBilled: number; outstanding: number } } | null;
    expect(info?.totals.totalBilled).toBe(50);
    expect(info?.totals.outstanding).toBe(150);
  });
});
