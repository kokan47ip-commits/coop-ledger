/**
 * Duplicate voucher-number guard tests (bun:test, run with `bun test tests/`).
 *
 * Pins the part-4 behaviour: duplicate voucher numbers must be REJECTED with
 * a "Duplicate Voucher No." message, in every write path —
 *  • vouchers.create with an office-typed voucherNo that already exists
 *  • vouchers.voucherNoTaken (the forms' live duplicate check)
 *  • the automatic series self-heals past counter drift instead of repeating
 *    an already-used number (claimVoucherNo)
 *
 * Exercises the REAL Convex handlers via their `._handler` entrypoint against
 * the same in-memory db + auth stub used by payments.test.ts (the auth
 * subject is the actual users-row id, which is how getAuthUserId resolves).
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

/** Mirrors payments.test.ts's seedWorld: auth subject = the users-row id. */
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
  const bankId = (await db.insert("accounts", {
    societyId,
    kind: "bank_cash",
    code: "1020",
    name: "Bank Account",
    type: "asset",
    openingBalance: 0,
  })) as string;
  const receivableId = (await db.insert("accounts", {
    societyId,
    kind: "receivable",
    code: "1000",
    name: "Members Receivable",
    type: "asset",
    openingBalance: 0,
  })) as string;
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
  const lines = [
    { accountId: bankId, debit: 1000, credit: 0 },
    { accountId: receivableId, debit: 0, credit: 1000 },
  ];
  return { made, db, ctx, societyId, memberId, lines, today };
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

const createReceipt = (world: World, extra: Record<string, unknown> = {}) =>
  fn(vouchersMod, "create")(world.ctx, {
    societyId: world.societyId,
    type: "member_receipt",
    date: world.today,
    memberId: world.memberId,
    lines: world.lines,
    ...extra,
  });

describe("duplicate voucher numbers are rejected with \"Duplicate Voucher No.\"", () => {
  test("vouchers.create refuses an office-typed voucherNo that already exists", async () => {
    const world = await makeWorld();
    // First voucher takes MR-0001 from the automatic series.
    await createReceipt(world);
    expect(world.made.dump("vouchers")).toHaveLength(1);
    // The office now types MR-0001 manually — must be refused entirely.
    let msg = "";
    try {
      await createReceipt(world, { voucherNo: "MR-0001" });
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).toContain("Duplicate Voucher No.");
    expect(world.made.dump("vouchers")).toHaveLength(1);
  });

  test("a fresh typed number is accepted and saved verbatim", async () => {
    const world = await makeWorld();
    await createReceipt(world, { voucherNo: "MR-0099" });
    const nos = world.made.dump("vouchers").map((v) => v.voucherNo);
    expect(nos).toContain("MR-0099");
  });

  test("the automatic series self-heals past counter drift instead of repeating a used number", async () => {
    const world = await makeWorld();
    // A voucher already carries MR-0001 (imported/restored data) while the
    // counter sits behind at 1.
    await world.db.insert("vouchers", {
      societyId: world.societyId,
      type: "member_receipt",
      voucherNo: "MR-0001",
      date: world.today,
      total: 500,
      lines: world.lines,
    });
    await world.db.insert("counters", {
      key: `${world.societyId}:voucher:member_receipt`,
      value: 1,
    });
    await createReceipt(world);
    const nos = world.made.dump("vouchers").map((v) => v.voucherNo);
    expect(nos.filter((n) => n === "MR-0001")).toHaveLength(1);
    expect(nos).toContain("MR-0002");
  });

  test("voucherNoTaken reports existing numbers and ignores unknown ones", async () => {
    const world = await makeWorld();
    await world.db.insert("vouchers", {
      societyId: world.societyId,
      type: "payment",
      voucherNo: "PY-0007",
      date: world.today,
      total: 100,
      lines: world.lines,
    });
    expect(
      await fn(vouchersMod, "voucherNoTaken")(world.ctx, {
        societyId: world.societyId,
        voucherNo: "PY-0007",
      }),
    ).toBe(true);
    expect(
      await fn(vouchersMod, "voucherNoTaken")(world.ctx, {
        societyId: world.societyId,
        voucherNo: "PY-0008",
      }),
    ).toBe(false);
  });

  test("voucher numbers are unique across the whole society's books", async () => {
    const world = await makeWorld();
    await world.db.insert("vouchers", {
      societyId: world.societyId,
      type: "payment",
      voucherNo: "PY-0001",
      date: world.today,
      total: 100,
      lines: world.lines,
    });
    // Same number through the other-receipt book is still a duplicate.
    expect(
      await fn(vouchersMod, "voucherNoTaken")(world.ctx, {
        societyId: world.societyId,
        voucherNo: "PY-0001",
      }),
    ).toBe(true);
    let msg = "";
    try {
      await fn(vouchersMod, "create")(world.ctx, {
        societyId: world.societyId,
        type: "other_receipt",
        date: world.today,
        lines: world.lines,
        voucherNo: "PY-0001",
      });
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).toContain("Duplicate Voucher No.");
  });
});
