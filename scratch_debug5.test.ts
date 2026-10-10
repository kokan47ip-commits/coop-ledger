import { test } from "bun:test";
import * as accountsMod from "./src/convex/accounts";

// EXACT same helpers as tests/chartsync.test.ts
type Doc = { _id: string; _creationTime: number } & Record<string, unknown>;
function makeDb() {
  const tables = new Map<string, Map<string, Doc>>();
  const byId = new Map<string, string>();
  let clock = 0;
  let seq = 0;
  const ensure = (t: string) => {
    let m = tables.get(t);
    if (!m) { m = new Map(); tables.set(t, m); }
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
      const base = () =>
        [...ensure(t).values()].sort((a, b) => a._creationTime - b._creationTime);
      const h = {
        withIndex(_name: string, cb?: (q: unknown) => unknown) {
          const pairs: Record<string, unknown> = {};
          const q = { eq: (f: string, v: unknown) => { pairs[f] = v; return q; } };
          (cb as ((q: typeof q) => unknown) | undefined)?.(q);
          current = (current ?? base()).filter((r) =>
            Object.entries(pairs).every(([k, v]) => r[k] === v));
          return h;
        },
        order() { return h; },
        async collect() { return current ?? base(); },
        async unique() {
          const all = current ?? base();
          if (all.length > 1) throw new Error("unique(): multiple rows");
          return all[0] ?? null;
        },
        async first() { return (current ?? base())[0] ?? null; },
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
      return userId ? { subject: userId, tokenIdentifier: `t:${userId}`, issuer: "test", audience: ["test"] } : null;
    },
  },
});
type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) => (mod as unknown as Record<string, Handler>)[name]._handler;

test("dbg5-upsert-edit", async () => {
  const made = makeDb();
  const { db, dump } = made;
  const userId = await db.insert("users", { email: "owner@x.com" });
  const masterId = await db.insert("societies", { name: "M", createdBy: userId });
  const childId = await db.insert("societies", { name: "C", createdBy: userId, masterSocietyId: masterId });
  const ml = await db.insert("accounts", { societyId: masterId, code: "4060", name: "Audit & Accounting", type: "expense", openingBalance: 0 });
  await db.insert("accounts", { societyId: childId, code: "4060", name: "Audit & Accounting", type: "expense", openingBalance: 0, masterSocietyId: masterId, masterKey: ml, origin: "master" });
  const ctx = makeCtx(db, userId);
  try {
    await fn(accountsMod, "upsert")(ctx, { societyId: masterId, id: ml, code: "E61", name: "Audit Fees", type: "expense", openingBalance: 0 });
    console.log("no throw");
  } catch (e) {
    console.log("THREW:", e instanceof Error ? e.message : String(e));
  }
  const child = dump("accounts").filter((a) => a.societyId === childId);
  console.log("child:", JSON.stringify(child.map((a) => `${a.code}:${a.name}`)));
});
