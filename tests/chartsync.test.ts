/**
 * Real-handler regression tests for the October-2026 fixes:
 *
 * 1. bulkUpdate refuses a row whose statement section (type) differs from the
 *    stored one — a stale tab must not silently move a ledger between the
 *    Balance Sheet and the I&E, and the rejection is row-named (no opaque
 *    "Called by client" server error).
 * 2. Master-society ledger/group EDITS propagate to linked (onboarded)
 *    societies — structure only, never balances (the 4060 → E61 "Audit Fees"
 *    sync gap).
 */
import { describe, expect, test } from "bun:test";
import * as accountsMod from "../src/convex/accounts";
import * as groupsMod from "../src/convex/accountGroups";

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
      // Real Convex hands out immutable snapshots; hand out clones so a later
      // patch (which mutates in place) cannot rewind a doc an earlier get()
      // already returned — that made before/after comparisons inside handlers
      // see the SAME object and read as "unchanged".
      const snap = (r: Doc | null): Doc | null => {
        if (!r) return null;
        const copy = { ...r };
        if (Array.isArray(copy.lines)) copy.lines = copy.lines.map((l) => ({ ...l }));
        return copy;
      };
      if (b === undefined) {
        const t = byId.get(a);
        return t ? snap(ensure(t).get(a) ?? null) : null;
      }
      return snap((ensure(a).get(b) ?? null) as Doc | null);
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
        async collect() {
          return current ?? base();
        },
        async unique() {
          const all = current ?? base();
          if (all.length > 1) throw new Error("unique(): multiple rows");
          return all[0] ?? null;
        },
        async first() {
          return (current ?? base())[0] ?? null;
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

/* ---------------------------------- world --------------------------------- */

/** Master society + one onboarded child (linked at create time). */
async function seedMasterWorld() {
  const made = makeDb();
  const { db, dump } = made;
  const userId = await db.insert("users", { email: "owner@x.com" });
  const ctx = makeCtx(db, userId);
  // create() builds claim codes etc. — seed rows directly instead.
  const masterId = await db.insert("societies", {
    name: "Master CHS",
    fyStartMonth: 4,
    fyStartDate: "2026-04-01",
    fyYear: "2026-27",
    createdBy: userId,
  });
  const childId = await db.insert("societies", {
    name: "Onboarded CHS",
    fyStartMonth: 4,
    fyStartDate: "2026-04-01",
    fyYear: "2026-27",
    createdBy: userId,
    masterSocietyId: masterId,
  });
  // Master chart: an expense ledger the office will rename.
  const masterLedger = await db.insert("accounts", {
    societyId: masterId,
    code: "4060",
    name: "Audit & Accounting",
    type: "expense",
    openingBalance: 0,
  });
  const childLedger = await db.insert("accounts", {
    societyId: childId,
    code: "4060",
    name: "Audit & Accounting",
    type: "expense",
    openingBalance: 0,
    masterSocietyId: masterId,
    masterKey: masterLedger,
    origin: "master",
  });
  // The child also carries a posted voucher against the ledger (a balance
  // must never be touched by propagation).
  await db.insert("vouchers", {
    societyId: childId,
    voucherNo: "P-0001",
    type: "payment",
    date: "2026-05-10",
    total: 5000,
    lines: [{ accountId: childLedger, debit: 5000, credit: 0 }],
  });
  return { db, dump, ctx, masterId, childId, masterLedger, childLedger, userId };
}

const bulkUpdate = fn(accountsMod, "bulkUpdate");
const accountsUpsert = fn(accountsMod, "upsert");
const groupsUpsert = fn(groupsMod, "upsert");

/* ------------------------------- section guard ---------------------------- */

describe("bulkUpdate — section (type) change is refused with a row name", () => {
  test("a row sweeping its type from liability to expense is rejected, naming the row", async () => {
    const w = await seedMasterWorld();
    const ctx = makeCtx(w.db, w.userId);
    await expect(
      bulkUpdate(ctx, {
        societyId: w.masterId,
        updates: [
          {
            id: w.masterLedger,
            // The row's stored type is "expense"; a stale tab sends "liability"
            // (the "Liabilities & Funds" section was edited in the meantime).
            code: "4060",
            name: "Audit & Accounting",
            type: "liability",
            openingBalance: 0,
          },
        ],
      }),
    ).rejects.toThrow(/4060 — Audit & Accounting.*expense/);
  });

  test("an unchanged type passes and the save applies", async () => {
    const w = await seedMasterWorld();
    const ctx = makeCtx(w.db, w.userId);
    const res = (await bulkUpdate(ctx, {
      societyId: w.masterId,
      updates: [
        {
          id: w.masterLedger,
          type: "expense",
          code: "4060",
          name: "Audit & Accounting",
          openingBalance: 250, // print order/only balance edits go through
        },
      ],
    })) as { updated: number };
    expect(res.updated).toBe(1);
    const row = await w.db.get("accounts", w.masterLedger);
    expect(row?.openingBalance).toBe(250);
  });
});

/* --------------------------- master chart sync ---------------------------- */

describe("master chart sharing — identity EDITS propagate to onboarded societies", () => {
  test("renaming a master ledger (4060 → E61 Audit Fees) updates the clone in the linked society", async () => {
    const w = await seedMasterWorld();
    const ctx = makeCtx(w.db, w.userId);
    const res = (await accountsUpsert(ctx, {
      societyId: w.masterId,
      id: w.masterLedger,
      code: "E61",
      name: "Audit Fees",
      type: "expense",
      openingBalance: 0,
    })) as string;
    expect(res).toBe(w.masterLedger);

    // The child's clone now mirrors the new identity...
    const child = await w.db.get("accounts", w.childLedger);
    expect(child?.code).toBe("E61");
    expect(child?.name).toBe("Audit Fees");
    // ...without a balance ever crossing societies.
    expect(child?.openingBalance).toBe(0);
    const vouchers = w.dump("vouchers").filter((v) => v.societyId === w.childId);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]!.total).toBe(5000);
  });

  test("bulk 'Edit all' renames propagate too", async () => {
    const w = await seedMasterWorld();
    const ctx = makeCtx(w.db, w.userId);
    await bulkUpdate(ctx, {
      societyId: w.masterId,
      updates: [
        {
          id: w.masterLedger,
          type: "expense",
          code: "E61",
          name: "Audit Fees",
          openingBalance: 0,
        },
      ],
    });
    const child = await w.db.get("accounts", w.childLedger);
    expect(child?.code).toBe("E61");
    expect(child?.name).toBe("Audit Fees");
  });

  test("edits never propagate when the master row itself came from a sync (origin master)", async () => {
    const w = await seedMasterWorld();
    const synced = await w.db.insert("accounts", {
      societyId: w.masterId,
      code: "5000",
      name: "Rooftop Repairs",
      type: "expense",
      openingBalance: 0,
      masterSocietyId: w.masterId, // degenerate but exercises the origin guard
      masterKey: "irrelevant",
      origin: "master",
    });
    const ctx = makeCtx(w.db, w.userId);
    await accountsUpsert(ctx, {
      societyId: w.masterId,
      id: synced,
      code: "5001",
      name: "Rooftop Repairs Renamed",
      type: "expense",
      openingBalance: 0,
    });
    // No child clone exists for this row — the patch on the master itself
    // applied, and no crash happened.
    const row = await w.db.get("accounts", synced);
    expect(row?.name).toBe("Rooftop Repairs Renamed");
  });

  test("a colliding child code keeps the child code but still takes the name change", async () => {
    const w = await seedMasterWorld();
    // Child society already has a locally-created ledger with code E61.
    await w.db.insert("accounts", {
      societyId: w.childId,
      code: "E61",
      name: "Local Audit Expense",
      type: "expense",
      openingBalance: 0,
    });
    const ctx = makeCtx(w.db, w.userId);
    await accountsUpsert(ctx, {
      societyId: w.masterId,
      id: w.masterLedger,
      code: "E61",
      name: "Audit Fees",
      type: "expense",
      openingBalance: 0,
    });
    const names = w
      .dump("accounts")
      .filter((a) => a.societyId === w.childId)
      .map((a) => `${a.code}:${a.name}`);
    // The clone skips the conflicting code but still receives the name.
    expect(names).toContain("4060:Audit Fees");
    expect(names).toContain("E61:Local Audit Expense");
  });

  test("master society is a linked child itself → no propagation (cycle guard)", async () => {
    const w = await seedMasterWorld();
    // Make the "master" itself linked; propagation must skip.
    await w.db.patch(w.masterId, { masterSocietyId: w.childId, masterSocietyIdOf: 1 } as Record<string, unknown>);
    const ctx = makeCtx(w.db, w.userId);
    await accountsUpsert(ctx, {
      societyId: w.masterId,
      id: w.masterLedger,
      code: "E61",
      name: "Audit Fees",
      type: "expense",
      openingBalance: 0,
    });
    const child = await w.db.get("accounts", w.childLedger);
    expect(child?.code).toBe("4060"); // untouched
  });
});

describe("group edits propagate", () => {
  test("renaming a master group updates its clone", async () => {
    const w = await seedMasterWorld();
    const masterGroup = await w.db.insert("accountGroups", {
      societyId: w.masterId,
      code: "IG",
      name: "Indirect Expenses",
      type: "expense",
      sequence: 1,
    });
    await w.db.insert("accountGroups", {
      societyId: w.childId,
      code: "IG",
      name: "Indirect Expenses",
      type: "expense",
      sequence: 1,
      masterSocietyId: w.masterId,
      masterKey: masterGroup,
      origin: "master",
    });
    const ctx = makeCtx(w.db, w.userId);
    const res = (await groupsUpsert(ctx, {
      societyId: w.masterId,
      id: masterGroup,
      code: "IG",
      name: "Admin & General Expenses",
      type: "expense",
      sequence: 2,
    })) as string;
    expect(res).toBe(masterGroup);
    const childGroups = w
      .dump("accountGroups")
      .filter((g) => g.societyId === w.childId);
    expect(childGroups.map((g) => g.name)).toContain("Admin & General Expenses");
  });
});
