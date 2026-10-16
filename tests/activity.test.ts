/**
 * Activity ("continue where you left off") tests — the REAL handlers
 * (via `._handler`): same-screen revisits update instead of duplicating,
 * a new screen adds a row, other societies don't dedupe each other, history
 * is capped at 20 and `recent` returns the newest first.
 */
import { describe, expect, test } from "bun:test";
import * as activityMod from "../src/convex/activity";

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

function ctxFor({ db }: { db: ReturnType<typeof makeDb>["db"] }, userId: string | null) {
  return {
    db,
    auth: {
      async getUserIdentity() {
        return userId
          ? { subject: userId, tokenIdentifier: `t:${userId}`, issuer: "test", audience: ["test"] }
          : null;
      },
    },
  };
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

/* --------------------------------- world ---------------------------------- */

async function seedWorld() {
  const made = makeDb();
  const { db, dump } = made;
  const ownerUserId = await db.insert("users", { name: "Priya Owner", email: "owner@x.com" });
  const otherUserId = await db.insert("users", { name: "Omar Other", email: "other@x.com" });
  const societyId = await db.insert("societies", {
    name: "Test CHS",
    fyStartMonth: 4,
    createdBy: ownerUserId,
  });
  const societyB = await db.insert("societies", {
    name: "Other CHS",
    fyStartMonth: 4,
    createdBy: otherUserId,
  });
  return {
    db,
    dump,
    ownerUserId,
    otherUserId,
    societyId,
    societyB,
    ownerCtx: ctxFor(made, ownerUserId),
    otherCtx: ctxFor(made, otherUserId),
  };
}

const record = (ctx: object, args: object) =>
  fn(activityMod, "record")(ctx, args);
const recent = (ctx: object) => fn(activityMod, "recent")(ctx, {});

describe("activity.record", () => {
  test("same screen revisits refresh the timestamp instead of duplicating", async () => {
    const w = await seedWorld();
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/member-receipt", label: "Member Receipt" });
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/member-receipt", label: "Member Receipt" });
    const rows = w.dump("userActivity");
    expect(rows).toHaveLength(1);
    // The single row now carries the refreshed label.
    expect(rows[0].label).toBe("Member Receipt");
  });

  test("a new screen adds a row; newest is first in recent", async () => {
    const w = await seedWorld();
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/member-receipt", label: "Member Receipt" });
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/journal", label: "Journal Voucher" });
    const list = (await recent(w.ownerCtx)) as { path: string; label: string }[];
    expect(list).toHaveLength(2);
    expect(list[0]!.path).toBe("/app/journal");
    expect(list[0]!.label).toBe("Journal Voucher");
    expect(list[1]!.path).toBe("/app/member-receipt");
  });

  test("another society's screen is a separate row, not a same-screen duplicate", async () => {
    const w = await seedWorld();
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/bills", label: "Bill Register" });
    await record(w.ownerCtx, { societyId: w.societyB, path: "/app/bills", label: "Bill Register" });
    const list = (await recent(w.ownerCtx)) as { path: string; societyId?: string }[];
    expect(list).toHaveLength(2);
    expect(list[0]!.societyId).toBe(w.societyB);
    expect(list[1]!.societyId).toBe(w.societyId);
  });

  test("each user's trail is private to their account", async () => {
    const w = await seedWorld();
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/bills", label: "Bill Register" });
    await record(w.otherCtx, { societyId: w.societyB, path: "/app/members", label: "Members" });
    const mine = (await recent(w.ownerCtx)) as { path: string }[];
    expect(mine).toHaveLength(1);
    expect(mine[0]!.path).toBe("/app/bills");
  });

  test("history is capped at 20 rows", async () => {
    const w = await seedWorld();
    for (let i = 0; i < 25; i++) {
      await record(w.ownerCtx, {
        societyId: w.societyId,
        path: `/app/screen-${i}`,
        label: `Screen ${i}`,
      });
    }
    const dump = w.dump("userActivity") as { path: string }[];
    expect(dump).toHaveLength(20);
    // The fake db dumps ascending by creation time: the oldest five
    // (screen-0..screen-4) were dropped, screen-5..screen-24 survived.
    expect(dump[0]!.path).toBe("/app/screen-5");
    expect(dump[19]!.path).toBe("/app/screen-24");
  });

  test("an over-cap save when the previous visit already ticks keeps the cap", async () => {
    const w = await seedWorld();
    for (let i = 0; i < 20; i++) {
      await record(w.ownerCtx, {
        societyId: w.societyId,
        path: `/app/screen-${i}`,
        label: `Screen ${i}`,
      });
    }
    expect(w.dump("userActivity")).toHaveLength(20);
    // A same-screen revisit never grows the list past the cap either.
    await record(w.ownerCtx, { societyId: w.societyId, path: "/app/screen-19", label: "Screen 19" });
    expect(w.dump("userActivity")).toHaveLength(20);
  });

  test("recent returns at most 6 entries", async () => {
    const w = await seedWorld();
    for (let i = 0; i < 9; i++) {
      await record(w.ownerCtx, {
        societyId: w.societyId,
        path: `/app/screen-${i}`,
        label: `Screen ${i}`,
      });
    }
    const list = (await recent(w.ownerCtx)) as { path: string }[];
    expect(list).toHaveLength(6);
    expect(list[0]!.path).toBe("/app/screen-8");
  });
});
