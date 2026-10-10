/**
 * Reproduction + regression tests for the Chart of Accounts bulk "Edit all"
 * save (src/convex/accounts.ts::bulkUpdate).
 *
 * Runs the REAL mutation handler (`._handler`) against a faithful in-memory
 * db + auth stub (same pattern as tests/payments.test.ts), so a Convex
 * runtime-level crash ("Server Error: Called by client") reproduces here —
 * pure-logic tests cannot catch those.
 */
import { describe, expect, test } from "bun:test";
import * as accountsMod from "../src/convex/accounts";

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
          const all = sorted(current ?? base());
          return all[0] ?? null;
        },
      };
      return h;
    },
  };
  return { db, dump: (t: string) => [...ensure(t).values()] };
}

const makeCtx = (db: unknown, userId: string | null) => ({
  db,
  auth: {
    async getUserIdentity() {
      return userId
        ? { subject: userId, tokenIdentifier: `t:${userId}`, issuer: "test", audience: ["test"] }
        : null;
    },
  },
});

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

/* --------------------------------- world ---------------------------------- */

async function seedWorld() {
  const made = makeDb();
  const { db, dump } = made;
  const userId = await db.insert("users", { email: "owner@x.com" });
  const societyId = await db.insert("societies", {
    name: "Test CHS",
    fyStartMonth: 4,
    fyStartDate: "2026-04-01",
    fyYear: "2026-27",
    createdBy: userId,
  });
  const groupId = await db.insert("accountGroups", {
    societyId,
    code: "CA",
    name: "Current Assets",
    type: "asset",
    sequence: 1,
  });
  const acc1 = await db.insert("accounts", {
    societyId,
    code: "B1",
    name: "Bank of India",
    type: "asset",
    kind: "bank_cash",
    openingBalance: 1000,
    groupId,
  });
  const acc2 = await db.insert("accounts", {
    societyId,
    code: "A1",
    name: "Maintenance Receivable",
    type: "asset",
    kind: "receivable",
    openingBalance: 500,
  });
  const acc3 = await db.insert("accounts", {
    societyId,
    code: "E1",
    name: "Repairs",
    type: "expense",
    openingBalance: 0,
  });
  return { db, dump, userId, societyId, groupId, acc1, acc2, acc3 };
}

const bulkUpdate = fn(accountsMod, "bulkUpdate");

const payload = (
  row: { _id: string; code: string; name: string; openingBalance: number; groupId?: string; kind?: string; printNo?: string },
  over: Record<string, unknown> = {},
) => ({
  id: row._id,
  code: row.code,
  name: row.name,
  openingBalance: row.openingBalance,
  groupId: row.groupId,
  kind: row.kind,
  printNo: row.printNo,
  ...over,
});

/* --------------------------------- tests ---------------------------------- */

describe("bulkUpdate (real handler)", () => {
  test("no-op save succeeds and returns updated: 0", async () => {
    const w = await seedWorld();
    const ctx = makeCtx(w.db, w.userId);
    const got = (await w.db.get("accounts", w.acc1)) as { _id: string; code: string; name: string; openingBalance: number; groupId?: string; kind?: string };
    const res = (await bulkUpdate(ctx, {
      societyId: w.societyId,
      updates: [payload(got)],
    })) as { updated: number };
    expect(res.updated).toBe(0);
  });

  test("saves changed rows (opening, printNo, group) in one call", async () => {
    const w = await seedWorld();
    const ctx = makeCtx(w.db, w.userId);
    const a1 = (await w.db.get("accounts", w.acc1)) as { _id: string; code: string; name: string; openingBalance: number; groupId?: string; kind?: string };
    const res = (await bulkUpdate(ctx, {
      societyId: w.societyId,
      updates: [payload(a1, { openingBalance: 2500, groupId: w.groupId, printNo: "3" })],
    })) as { updated: number };
    expect(res.updated).toBe(1);
    const after = (await w.db.get("accounts", w.acc1)) as { openingBalance: number; printNo?: string };
    expect(after.openingBalance).toBe(2500);
    expect(after.printNo).toBe("3");
  });

  test("duplicate code inside the batch is rejected", async () => {
    const w = await seedWorld();
    const ctx = makeCtx(w.db, w.userId);
    const a1 = (await w.db.get("accounts", w.acc1)) as { _id: string };
    const a2 = (await w.db.get("accounts", w.acc2)) as { _id: string };
    await expect(
      bulkUpdate(ctx, {
        societyId: w.societyId,
        updates: [
          { id: a1._id, code: "X1", name: "Bank", openingBalance: 0 },
          { id: a2._id, code: "x1", name: "Cash", openingBalance: 0 },
        ],
      }),
    ).rejects.toThrow("Duplicate code");
  });

  test("renaming a system ledger is rejected, editing its opening is not", async () => {
    const w = await seedWorld();
    const sys = await w.db.insert("accounts", {
      societyId: w.societyId,
      code: "1090",
      name: "Dues from Members",
      type: "asset",
      kind: "receivable",
      openingBalance: 0,
    });
    const ctx = makeCtx(w.db, w.userId);
    await expect(
      bulkUpdate(ctx, {
        societyId: w.societyId,
        updates: [
          { id: sys, code: "1090", name: "Dues from Members Changed", openingBalance: 5 },
        ],
      }),
    ).rejects.toThrow("system ledger");
    // Opening/printNo only: passes.
    const res = (await bulkUpdate(ctx, {
      societyId: w.societyId,
      updates: [{ id: sys, code: "1090", name: "Dues from Members", openingBalance: 7 }],
    })) as { updated: number };
    expect(res.updated).toBe(1);
  });

  test("group of another section is rejected", async () => {
    const w = await seedWorld();
    const expGroup = await w.db.insert("accountGroups", {
      societyId: w.societyId,
      code: "IE",
      name: "Indirect Expenses",
      type: "expense",
      sequence: 2,
    });
    const ctx = makeCtx(w.db, w.userId);
    const a1 = (await w.db.get("accounts", w.acc1)) as { _id: string; code: string; name: string; openingBalance: number; groupId?: string; kind?: string };
    await expect(
      bulkUpdate(ctx, {
        societyId: w.societyId,
        updates: [payload(a1, { groupId: expGroup })],
      }),
    ).rejects.toThrow("groups can't hold it");
  });
});
