/**
 * Members Receivable resolution tests (bun:test, run with `bun test tests/`).
 *
 * Pins the member-receipt fix: a Society Profile → Accounting setting that
 * points at a BANK/CASH ledger (the cause of the "nullified" bank book) must
 * NOT refuse the member receipt any more — the write path self-repairs by
 * crediting the society's proper `receivable` ledger, so entries save again
 * (the exact symptom: "Server Error Called by client" only on Member Receipt,
 * while Other Receipt / Payment saved fine) and the bank ledger keeps its
 * Dr on the bank and Cr on the receivable instead of cancelling out.
 *
 * Exercises the REAL vouchers.create handler through the same in-memory
 * db + auth stub used by payments.test.ts / voucherno.test.ts. Not part of
 * the vite build; run via bun.
 */
import { describe, expect, test } from "bun:test";
import * as vouchersMod from "../src/convex/vouchers";

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
        if (v === undefined) delete row[k];
        else row[k] = v;
      }
      return undefined;
    },
    query(t: string) {
      let current: Doc[] | null = null;
      const base = () =>
        [...ensure(t).values()].sort((a, b) => a._creationTime - b._creationTime);
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
        order() {
          return h;
        },
        filter(fn: (q: unknown) => unknown) {
          const q = {
            field: (name: string) => name,
            eq: (a: unknown, b: unknown) => (row: Doc) => row[a as string] === b,
          };
          const pred = fn(q) as (r: Doc) => boolean;
          current = (current ?? base()).filter(pred);
          return h;
        },
        async collect() {
          return current ?? base();
        },
        async first() {
          const all = current ?? base();
          return all[0] ?? null;
        },
        async unique() {
          const all = current ?? base();
          if (all.length > 1) throw new Error("unique(): multiple rows");
          return all[0] ?? null;
        },
      };
      return h;
    },
  };
  return { db, dump: (t: string) => [...ensure(t).values()] };
}

type World = Awaited<ReturnType<typeof makeWorld>>;

/** Auth subject = the users-row id (how getAuthUserId resolves ownership). */
async function makeWorld(opts: { withReceivable?: boolean } = {}) {
  const withReceivable = opts.withReceivable ?? true;
  const made = makeDb();
  const { db } = made;
  const ownerId = (await db.insert("users", { email: "owner@test" })) as string;
  const today = new Date().toISOString().slice(0, 10);
  const fyStart = `${today.slice(0, 8)}01`;
  const societyId = (await db.insert("societies", {
    name: "Test Society",
    fyStartMonth: 4,
    fyStartDate: fyStart,
    fyYear: "2026-27",
    createdBy: ownerId,
  })) as string;
  const bankId = (await db.insert("accounts", {
    societyId,
    kind: "bank_cash",
    code: "1020",
    name: "Bank Account",
    type: "asset",
    openingBalance: 0,
  })) as string;
  const receivableId = withReceivable
    ? ((await db.insert("accounts", {
        societyId,
        kind: "receivable",
        code: "1000",
        name: "Members Receivable",
        type: "asset",
        openingBalance: 0,
      })) as string)
    : undefined;
  const memberId = (await db.insert("members", {
    societyId,
    name: "Ravi Kumar",
    code: "01",
    isActive: true,
    openingBalance: 0,
  })) as string;
  const ctx = {
    db,
    auth: {
      async getUserIdentity() {
        return {
          subject: ownerId,
          tokenIdentifier: `t:${ownerId}`,
          issuer: "test",
          audience: ["test"],
        };
      },
    },
  };
  return { made, db, ctx, societyId, memberId, bankId, receivableId, today };
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

/** The office form's payload: explicit Dr bank / Cr receivable lines. */
const createReceipt = (
  world: World,
  creditAccountId: string | undefined,
  extra: Record<string, unknown> = {},
) =>
  fn(vouchersMod, "create")(world.ctx, {
    societyId: world.societyId,
    type: "member_receipt",
    date: world.today,
    memberId: world.memberId,
    bankCashAccountId: world.bankId,
    lines: [
      { accountId: world.bankId, debit: 750, credit: 0 },
      ...(creditAccountId
        ? [{ accountId: creditAccountId, debit: 0, credit: 750 }]
        : []),
    ],
    ...extra,
  });

describe("member receipts survive a mis-set Members Receivable setting", () => {
  test("receivableAccountId pointing at the BANK self-repairs to the proper receivable ledger", async () => {
    const world = await makeWorld();
    // The data-entry mistake: Society Profile → Accounting saved the BANK.
    await world.db.patch(world.societyId, {
      receivableAccountId: world.bankId as unknown as never,
    });
    // Used to throw "Members Receivable account is set to the bank/cash
    // ledger …" — the reported Member Receipt save failure.
    const voucherId = (await createReceipt(
      world,
      world.receivableId,
    )) as string;
    const voucher = (await world.db.get(voucherId)) as {
      lines: { accountId: string; debit: number; credit: number }[];
    };
    // Dr stays on the bank; the credit lands on the PROPER receivable
    // ledger — the two sides no longer cancel out on one bank account.
    expect(voucher.lines[0]!.accountId).toBe(world.bankId);
    expect(voucher.lines[0]!.debit).toBe(750);
    expect(voucher.lines[1]!.accountId).toBe(world.receivableId);
    expect(voucher.lines[1]!.credit).toBe(750);
    expect(world.made.dump("vouchers")).toHaveLength(1);
  });

  test("an empty receivableAccountId also resolves to the proper receivable ledger", async () => {
    const world = await makeWorld();
    const voucherId = (await createReceipt(
      world,
      world.receivableId,
    )) as string;
    const voucher = (await world.db.get(voucherId)) as {
      lines: { accountId: string; credit: number }[];
    };
    expect(voucher.lines[1]!.accountId).toBe(world.receivableId);
    expect(voucher.lines[1]!.credit).toBe(750);
  });

  test("with NO receivable ledger at all the refusal is a clear ConvexError, not a bare server error", async () => {
    const world = await makeWorld({ withReceivable: false });
    const billId = (await world.db.insert("bills", {
      societyId: world.societyId,
      memberId: world.memberId,
      billNo: "B-1",
      issueDate: world.today,
      total: 500,
      paidAmount: 0,
      status: "unpaid",
    })) as string;
    // With bill allocations the create handler hands off to
    // insertMemberReceipt, where the receivable resolution (and its clear
    // refusal) happens.
    let msg = "";
    try {
      await fn(vouchersMod, "create")(world.ctx, {
        societyId: world.societyId,
        type: "member_receipt",
        date: world.today,
        memberId: world.memberId,
        bankCashAccountId: world.bankId,
        lines: [],
        allocations: [{ billId, amount: 500 }],
      });
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).toContain("No Members Receivable account found");
    expect(world.made.dump("vouchers")).toHaveLength(0);
  });

  test("a correctly-set profile keeps posting exactly as before (no regression)", async () => {
    const world = await makeWorld();
    await world.db.patch(world.societyId, {
      receivableAccountId: world.receivableId as unknown as never,
    });
    const voucherId = (await createReceipt(
      world,
      world.receivableId,
    )) as string;
    const voucher = (await world.db.get(voucherId)) as {
      lines: { accountId: string; debit: number; credit: number }[];
    };
    expect(voucher.lines[0]!.accountId).toBe(world.bankId);
    expect(voucher.lines[1]!.accountId).toBe(world.receivableId);
  });
});
