/**
 * Society UPI ID (VPA) save-path tests (bun:test, real handlers, in-memory db
 * — same pattern as tests/payments.test.ts).
 *
 * Covers both save paths against the shared normalizeVpa rule:
 *  • settings.saveUpiSettings: valid save, no-@ rejection, whitespace clear,
 *    viewer rejection, settlement account untouched by VPA-only saves
 *  • societies.update: invalid payee also rejected there (dual-editor parity)
 *  • the pure normalizeVpa rule itself
 */
import { describe, expect, test } from "bun:test";
import * as settingsMod from "../src/convex/settings";
import * as societiesMod from "../src/convex/societies";
import { normalizeVpa } from "../src/lib/bulkUpdateRules";

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

const saveUpiSettings = fn(settingsMod, "saveUpiSettings");
const updateSociety = fn(societiesMod, "update");

async function seedOwnerOwned() {
  const made = makeDb();
  const { db } = made;
  const owner = await db.insert("users", { email: "owner@x.com" });
  const viewer = await db.insert("users", { email: "viewer@x.com" });
  const societyId = await db.insert("societies", {
    name: "Shama-1 CHS Ltd",
    fyStartMonth: 4,
    createdBy: owner,
  });
  await db.insert("membersAccess", {
    societyId,
    userId: viewer,
    email: "viewer@x.com",
    role: "viewer",
    grantedBy: owner,
    createdAt: 0,
  });
  return { db, owner, viewer, societyId };
}

describe("normalizeVpa rule", () => {
  test("accepts a normal VPA, trims whitespace, clears empty", () => {
    expect(normalizeVpa("shamachsl@hdfcbank")).toEqual({ ok: true, vpa: "shamachsl@hdfcbank" });
    expect(normalizeVpa("  shama@ybl  ")).toEqual({ ok: true, vpa: "shama@ybl" });
    expect(normalizeVpa("   ")).toEqual({ ok: true, vpa: undefined });
    expect(normalizeVpa(null)).toEqual({ ok: true, vpa: undefined });
  });

  test("rejects VPA without the @ bank part", () => {
    const got = normalizeVpa("broken-vpa");
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.problem).toContain("@");
  });
});

describe("saveUpiSettings VPA path (real handler)", () => {
  test("valid VPA saves trimmed; whitespace-only clears", async () => {
    const w = await seedOwnerOwned();
    const ctx = makeCtx(w.db, w.owner);
    await saveUpiSettings(ctx, { societyId: w.societyId, upiVpa: "  shama@ybl " });
    expect(((await w.db.get("societies", w.societyId)) as { upiVpa?: string }).upiVpa).toBe("shama@ybl");
    await saveUpiSettings(ctx, { societyId: w.societyId, upiVpa: "   " });
    expect(((await w.db.get("societies", w.societyId)) as { upiVpa?: string }).upiVpa).toBeUndefined();
  });

  test("VPA without @ is rejected with a readable message", async () => {
    const w = await seedOwnerOwned();
    await expect(
      saveUpiSettings(makeCtx(w.db, w.owner), { societyId: w.societyId, upiVpa: "broken-vpa" }),
    ).rejects.toThrow("@");
  });

  test("viewer cannot save the VPA", async () => {
    const w = await seedOwnerOwned();
    await expect(
      saveUpiSettings(makeCtx(w.db, w.viewer), { societyId: w.societyId, upiVpa: "shama@ybl" }),
    ).rejects.toThrow("view-only");
  });

  test("VPA-only save leaves the settlement account untouched", async () => {
    const w = await seedOwnerOwned();
    const accId = await w.db.insert("accounts", {
      societyId: w.societyId,
      code: "B1",
      name: "HDFC",
      type: "asset",
      kind: "bank_cash",
      openingBalance: 0,
    });
    const ctx = makeCtx(w.db, w.owner);
    await saveUpiSettings(ctx, { societyId: w.societyId, settlementAccountId: accId });
    await saveUpiSettings(ctx, { societyId: w.societyId, upiVpa: "shama@ybl" });
    expect(
      ((await w.db.get("societies", w.societyId)) as { upiSettlementAccountId?: string })
        .upiSettlementAccountId,
    ).toBe(accId);
  });
});

describe("societies.update VPA parity (real handler)", () => {
  test("the Society Profile save path rejects an invalid payee too", async () => {
    const w = await seedOwnerOwned();
    await expect(
      updateSociety(makeCtx(w.db, w.owner), {
        id: w.societyId,
        name: "Shama-1 CHS Ltd",
        fyStartMonth: 4,
        upiVpa: "broken-vpa",
      }),
    ).rejects.toThrow("@");
  });

  test("a valid VPA still saves through the profile path", async () => {
    const w = await seedOwnerOwned();
    await updateSociety(makeCtx(w.db, w.owner), {
      id: w.societyId,
      name: "Shama-1 CHS Ltd",
      fyStartMonth: 4,
      upiVpa: "shama1@icici",
    });
    expect(((await w.db.get("societies", w.societyId)) as { upiVpa?: string }).upiVpa).toBe("shama1@icici");
  });
});
