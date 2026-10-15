/**
 * Payment / Other Receipt edit — the cash/bank LEG must follow the header's
 * Cash/Bank account (vouchers.update remap added with the Member-Receipt-style
 * voucher screens). Run with `bun test tests/`.
 *
 * Pins:
 *  • update with a NEW Cash/Bank moves the voucher's cash leg onto that
 *    account (header and posted lines can never disagree);
 *  • update WITHOUT a Cash/Bank keeps the existing leg — no accidental remap;
 *  • the counter-head line and the voucher total stay untouched.
 *
 * Exercises the REAL Convex handlers via their `._handler` entrypoint against
 * the same in-memory db + auth stub used by payments.test.ts / voucherno.test.ts
 * (auth subject = the users-row id, which is how getAuthUserId resolves).
 * Not part of the vite build; run via bun.
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

/** Mirrors voucherno.test.ts's world: auth subject = the users-row id. */
async function makeWorld() {
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
  const bank1 = (await db.insert("accounts", {
    societyId,
    kind: "bank_cash",
    code: "1020",
    name: "Bank Account",
    type: "asset",
    openingBalance: 0,
  })) as string;
  const bank2 = (await db.insert("accounts", {
    societyId,
    kind: "bank_cash",
    code: "1010",
    name: "Cash in Hand",
    type: "asset",
    openingBalance: 0,
  })) as string;
  const expenseId = (await db.insert("accounts", {
    societyId,
    code: "4020",
    name: "Repairs & Maintenance",
    type: "expense",
    openingBalance: 0,
  })) as string;
  const incomeId = (await db.insert("accounts", {
    societyId,
    code: "3040",
    name: "Other Income",
    type: "income",
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
  return { made, db, ctx, societyId, bank1, bank2, expenseId, incomeId, today };
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

type StoredVoucher = {
  bankCashAccountId?: string;
  total: number;
  lines: { accountId: string; debit: number; credit: number }[];
};

/** Create one voucher of the given kind on bank1; returns its id + amount. */
async function seedVoucher(w: World, kind: "payment" | "other_receipt") {
  const amount = kind === "payment" ? 500 : 300;
  const lines =
    kind === "payment"
      ? [
          { accountId: w.expenseId, debit: amount, credit: 0 },
          { accountId: w.bank1, debit: 0, credit: amount },
        ]
      : [
          { accountId: w.bank1, debit: amount, credit: 0 },
          { accountId: w.incomeId, debit: 0, credit: amount },
        ];
  const id = (await fn(vouchersMod, "create")(w.ctx, {
    societyId: w.societyId,
    type: kind,
    date: w.today,
    bankCashAccountId: w.bank1,
    narration: "seed",
    lines,
  })) as string;
  return { id, amount };
}

describe("vouchers.update keeps the cash leg on the header's Cash/Bank account", () => {
  for (const kind of ["payment", "other_receipt"] as const) {
    test(`${kind}: changing Cash/Bank moves the cash leg onto the new account`, async () => {
      const w = await makeWorld();
      const { id, amount } = await seedVoucher(w, kind);
      const before = w.made.dump("vouchers")[0]!;
      // Header-only edit — exactly what the reworked form submits.
      await fn(vouchersMod, "update")(w.ctx, {
        societyId: w.societyId,
        id,
        date: w.today,
        bankCashAccountId: w.bank2,
        narration: "edited",
        lines: before.lines,
      });
      const v = w.made.dump("vouchers")[0] as unknown as StoredVoucher;
      // Header and posted lines agree on the new account…
      expect(v.bankCashAccountId).toBe(w.bank2);
      expect(v.lines).toHaveLength(2);
      const cashLeg = v.lines.find(
        (l) => l.accountId === w.bank1 || l.accountId === w.bank2,
      );
      expect(cashLeg?.accountId).toBe(w.bank2);
      expect((cashLeg?.debit ?? 0) + (cashLeg?.credit ?? 0)).toBe(amount);
      // …the counter-head line is untouched and the total stands.
      const head = v.lines.find(
        (l) => l.accountId !== w.bank1 && l.accountId !== w.bank2,
      );
      expect(head?.accountId).toBe(
        kind === "payment" ? w.expenseId : w.incomeId,
      );
      expect(v.total).toBe(amount);
    });
  }

  test("update without a Cash/Bank keeps the existing leg — no accidental remap", async () => {
    const w = await makeWorld();
    const { id, amount } = await seedVoucher(w, "payment");
    const before = w.made.dump("vouchers")[0]!;
    await fn(vouchersMod, "update")(w.ctx, {
      societyId: w.societyId,
      id,
      date: w.today,
      narration: "edited",
      lines: before.lines,
    });
    const v = w.made.dump("vouchers")[0] as unknown as StoredVoucher;
    expect(v.bankCashAccountId).toBe(w.bank1);
    const cashLeg = v.lines.find((l) => l.accountId === w.bank1);
    expect(cashLeg?.accountId).toBe(w.bank1);
    expect((cashLeg?.debit ?? 0) + (cashLeg?.credit ?? 0)).toBe(amount);
    expect(v.total).toBe(amount);
  });
});
