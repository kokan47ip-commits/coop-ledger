/**
 * Users & Rights regression tests (bun:test, run with `bun test tests/`).
 *
 * Exercises the REAL access handlers (via their `._handler` entrypoint) with
 * an in-memory db + auth stub — the same technique as payments.test.ts.
 *
 * Covers the reported bug "admin cannot edit a granted user's rights":
 *  • re-granting the same email (existing-member or other-email flow) UPDATES
 *    the one grant row instead of failing or duplicating it,
 *  • setRole (the edit dialog) can reduce AND expand menus, restore
 *    all-menus, rebind/clear the portal flat and heal stale user bindings,
 *  • setMenus (the sliders dialog) still reduces/restores menus,
 *  • myMenus serves the edited lists back to the granted user,
 *  • only the owner or a software admin can perform any of it.
 *
 * Not part of the vite build (tsconfig.app includes only src/); run via bun.
 */
import { describe, expect, test } from "bun:test";
import * as accessMod from "../src/convex/access";

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
        filter(fn: unknown) {
          const rows = current ?? base();
          let pred: (r: Doc) => boolean;
          // Convex q-expression style: .filter((q) => q.eq(q.field("x"), v)).
          // Build a q whose eq returns a row predicate, then let the callback
          // compose it; if the callback is a plain row predicate instead,
          // calling it with this q yields a non-function and we fall back.
          try {
            const q = {
              field: (f: string) => ({ __field: f }),
              eq: (a: unknown, b: unknown) => {
                const f = (a as { __field?: string }).__field;
                return (r: Doc) => r[f as string] === b;
              },
            };
            const out = (fn as (q: unknown) => unknown)(q);
            if (typeof out === "function") pred = out as (r: Doc) => boolean;
            else pred = fn as (r: Doc) => boolean;
          } catch {
            pred = fn as (r: Doc) => boolean;
          }
          current = rows.filter(pred);
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
      };
      return h;
    },
  };
  return {
    db,
    dump: (t: string) => [...ensure(t).values()],
  };
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

  const ownerUserId = await db.insert("users", {
    email: "owner@x.com",
    name: "Owner",
    // The owner is the system's first software admin — no bootstrap needed.
    softwareAdmin: true,
  });
  const societyId = await db.insert("societies", {
    name: "Test CHS",
    fyStartMonth: 4,
    fyStartDate: "2026-04-01",
    fyYear: "2026-27",
    createdBy: ownerUserId,
  });

  // Two flats for portal binding checks.
  const flatA = await db.insert("members", {
    societyId,
    name: "Ravi Kumar",
    wing: "A",
    flatNo: "101",
    code: "A-101",
    isActive: true,
  });
  const flatB = await db.insert("members", {
    societyId,
    name: "Sunita Rao",
    wing: "B",
    flatNo: "202",
    code: "B-202",
    isActive: true,
  });

  // "Existing member" grant: invited before sign-up (no userId yet), with an
  // explicit menu list.
  const editorGrantId = await db.insert("membersAccess", {
    societyId,
    email: "sec@x.com",
    role: "editor",
    menus: ["dashboard", "members", "bills"],
    grantedBy: ownerUserId,
    createdAt: 1,
  });
  const editorUserId = await db.insert("users", {
    email: "sec@x.com",
    name: "Secretary",
  });

  // "Other email" grant: a viewer who has signed up already.
  const viewerUserId = await db.insert("users", {
    email: "audit@x.com",
    name: "Auditor",
  });
  const viewerGrantId = await db.insert("membersAccess", {
    societyId,
    email: "audit@x.com",
    role: "viewer",
    menus: ["dashboard", "trial-balance"],
    userId: viewerUserId,
    grantedBy: ownerUserId,
    createdAt: 2,
  });

  // Flat-bound portal grant.
  const memberUserId = await db.insert("users", {
    email: "ravi@x.com",
    name: "Ravi",
  });
  const memberGrantId = await db.insert("membersAccess", {
    societyId,
    email: "ravi@x.com",
    role: "member",
    memberId: flatA,
    userId: memberUserId,
    grantedBy: ownerUserId,
    createdAt: 3,
  });

  return {
    db,
    dump,
    ctxFor,
    ownerUserId,
    societyId,
    flatA,
    flatB,
    editorGrantId,
    editorUserId,
    viewerGrantId,
    viewerUserId,
    memberGrantId,
    memberUserId,
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;
const grantRow = (w: World, id: string) => w.dump("membersAccess").find((g) => g._id === id)!;

/* --------------------------------- tests ---------------------------------- */

describe("Users & Rights — editing an existing grant", () => {
  test("other-email flow: re-granting the same email UPDATES the one grant row with fewer menus", async () => {
    const w = await seedWorld();
    const res = (await fn(accessMod, "grant")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      email: "audit@x.com",
      role: "editor",
      menus: ["dashboard"],
    })) as { id: string; updated: boolean };

    expect(res.updated).toBe(true);
    expect(res.id).toBe(w.viewerGrantId); // same row — no duplicate grant
    expect(w.dump("membersAccess").length).toBe(3);
    const row = grantRow(w, w.viewerGrantId);
    expect(row.role).toBe("editor");
    expect(row.menus).toEqual(["dashboard"]);
  });

  test("existing-member flow: re-granting heals the stale user binding and replaces menus", async () => {
    const w = await seedWorld();
    const res = (await fn(accessMod, "grantFromMember")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      memberId: w.flatA,
      email: "sec@x.com",
      role: "viewer",
      menus: ["dashboard"],
    })) as { id: string; updated: boolean };

    expect(res.updated).toBe(true);
    expect(res.id).toBe(w.editorGrantId);
    const row = grantRow(w, w.editorGrantId);
    expect(row.role).toBe("viewer");
    expect(row.menus).toEqual(["dashboard"]);
    // The grant was created before the invitee signed up; the update re-binds
    // the account so rights resolve by user id too.
    expect(row.userId).toBe(w.editorUserId);
  });

  test("edit dialog: setRole replaces the menu list — reduce and expand", async () => {
    const w = await seedWorld();
    const ctx = w.ctxFor(w.ownerUserId);

    // Reduce: editor with 3 menus down to 1.
    await fn(accessMod, "setRole")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "editor",
      menus: ["dashboard"],
    });
    expect(grantRow(w, w.editorGrantId).menus).toEqual(["dashboard"]);

    // Expand: 1 menu up to 4.
    await fn(accessMod, "setRole")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "editor",
      menus: ["dashboard", "members", "bills", "journal"],
    });
    expect(grantRow(w, w.editorGrantId).menus).toEqual([
      "dashboard",
      "members",
      "bills",
      "journal",
    ]);

    // Omitted menus keep the current list untouched (role-only edits).
    await fn(accessMod, "setRole")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "viewer",
    });
    const row = grantRow(w, w.editorGrantId);
    expect(row.role).toBe("viewer");
    expect(row.menus).toEqual(["dashboard", "members", "bills", "journal"]);
  });

  test("edit dialog: empty menu list restores all menus", async () => {
    const w = await seedWorld();
    await fn(accessMod, "setRole")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "editor",
      menus: [],
    });
    expect(grantRow(w, w.editorGrantId).menus).toBeUndefined();
  });

  test("edit dialog: switching to Member portal binds a flat; switching back clears it", async () => {
    const w = await seedWorld();
    const ctx = w.ctxFor(w.ownerUserId);

    // Editor → member requires the flat and keeps menus as-is.
    await fn(accessMod, "setRole")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "member",
      memberId: w.flatB,
    });
    let row = grantRow(w, w.editorGrantId);
    expect(row.role).toBe("member");
    expect(row.memberId).toBe(w.flatB);

    // A member-role switch with no flat anywhere (grant has none, none
    // picked) → clear error, not a silent failure.
    const flatlessId = await w.db.insert("membersAccess", {
      societyId: w.societyId,
      email: "flatless@x.com",
      role: "viewer",
      grantedBy: w.ownerUserId,
      createdAt: 8,
    });
    expect(
      fn(accessMod, "setRole")(ctx, {
        societyId: w.societyId,
        id: flatlessId,
        role: "member",
      }),
    ).rejects.toThrow(/must be linked to a flat/);

    // Back to a book role: the flat binding is cleared.
    await fn(accessMod, "setRole")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "viewer",
      menus: ["dashboard"],
    });
    row = grantRow(w, w.editorGrantId);
    expect(row.role).toBe("viewer");
    expect(row.memberId).toBeUndefined();
    expect(row.menus).toEqual(["dashboard"]);
  });

  test("sliders dialog: setMenus still reduces and restores all menus, and heals the binding", async () => {
    const w = await seedWorld();
    const ctx = w.ctxFor(w.ownerUserId);

    await fn(accessMod, "setMenus")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      menus: ["bills"],
    });
    expect(grantRow(w, w.editorGrantId).menus).toEqual(["bills"]);

    await fn(accessMod, "setMenus")(ctx, {
      societyId: w.societyId,
      id: w.editorGrantId,
      menus: [],
    });
    expect(grantRow(w, w.editorGrantId).menus).toBeUndefined();

    // A never-signed-up invitee's grant gets its user binding healed too.
    await db_heal_check(w);
    async function db_heal_check(world: World) {
      const fresh = await world.db.insert("membersAccess", {
        societyId: world.societyId,
        email: "audit@x.com", // matches the signed-up viewer account
        role: "viewer",
        grantedBy: world.ownerUserId,
        createdAt: 9,
      });
      await fn(accessMod, "setMenus")(world.ctxFor(world.ownerUserId), {
        societyId: world.societyId,
        id: fresh,
        menus: ["dashboard"],
      });
      const row = grantRow(world, fresh);
      expect(row.menus).toEqual(["dashboard"]);
      expect(row.userId).toBe(world.viewerUserId);
    }
  });

  test("member-role grants stay portal-bound and remain editable back to book roles", async () => {
    const w = await seedWorld();
    await fn(accessMod, "setRole")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      id: w.memberGrantId,
      role: "viewer",
    });
    const row = grantRow(w, w.memberGrantId);
    expect(row.role).toBe("viewer");
    expect(row.memberId).toBeUndefined();
  });
});

describe("Users & Rights — edited rights reach the user", () => {
  test("myMenus serves the edited menu list back to the granted user", async () => {
    const w = await seedWorld();
    // Restrict the viewer to two menus, then read their gate as they see it.
    await fn(accessMod, "setRole")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      id: w.viewerGrantId,
      role: "viewer",
      menus: ["dashboard", "trial-balance"],
    });
    const mine = (await fn(accessMod, "myMenus")(w.ctxFor(w.viewerUserId), {
      societyId: w.societyId,
    })) as { menus: string[] | null; admin: boolean };
    expect(mine.menus).toEqual(["dashboard", "trial-balance"]);
    expect(mine.admin).toBe(false);

    // A reduced list that no longer contains a menu keeps them out of it:
    // drop trial-balance and only dashboard remains.
    await fn(accessMod, "setRole")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      id: w.viewerGrantId,
      role: "viewer",
      menus: ["dashboard"],
    });
    const reduced = (await fn(accessMod, "myMenus")(w.ctxFor(w.viewerUserId), {
      societyId: w.societyId,
    })) as { menus: string[] | null };
    expect(reduced.menus).toEqual(["dashboard"]);
  });

  test("owner-only screens can be granted explicitly and reach myMenus", async () => {
    const w = await seedWorld();
    await fn(accessMod, "setRole")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
      id: w.viewerGrantId,
      role: "viewer",
      menus: ["dashboard", "society", "users"],
    });
    const mine = (await fn(accessMod, "myMenus")(w.ctxFor(w.viewerUserId), {
      societyId: w.societyId,
    })) as { menus: string[] | null };
    expect(mine.menus).toEqual(["dashboard", "society", "users"]);
  });

  test("member logins keep seeing only the portal, and admins stay unrestricted", async () => {
    const w = await seedWorld();
    const memberMine = (await fn(accessMod, "myMenus")(w.ctxFor(w.memberUserId), {
      societyId: w.societyId,
    })) as { menus: string[] | null; admin: boolean };
    expect(memberMine.menus).toEqual(["portal"]);

    const ownerMine = (await fn(accessMod, "myMenus")(w.ctxFor(w.ownerUserId), {
      societyId: w.societyId,
    })) as { menus: string[] | null; admin: boolean };
    expect(ownerMine.menus).toBeNull();
    expect(ownerMine.admin).toBe(true);
  });
});

describe("Users & Rights — who may edit", () => {
  test("viewers and outsiders cannot edit grants", async () => {
    const w = await seedWorld();
    expect(
      fn(accessMod, "setRole")(w.ctxFor(w.viewerUserId), {
        societyId: w.societyId,
        id: w.editorGrantId,
        role: "editor",
      }),
    ).rejects.toThrow(/Only the society owner or a software admin/);

    const outsiderId = await w.db.insert("users", { email: "out@x.com" });
    expect(
      fn(accessMod, "setRole")(w.ctxFor(outsiderId), {
        societyId: w.societyId,
        id: w.editorGrantId,
        role: "editor",
      }),
    ).rejects.toThrow(/Society not found/);
  });

  test("a software admin who is not the owner can edit grants", async () => {
    const w = await seedWorld();
    const adminId = await w.db.insert("users", {
      email: "sa@x.com",
      softwareAdmin: true,
    });
    await fn(accessMod, "setRole")(w.ctxFor(adminId), {
      societyId: w.societyId,
      id: w.editorGrantId,
      role: "viewer",
      menus: ["dashboard"],
    });
    const row = grantRow(w, w.editorGrantId);
    expect(row.role).toBe("viewer");
    expect(row.menus).toEqual(["dashboard"]);
  });
});

describe("Users & Rights — invited-before-signup binding", () => {
  test("bindPendingGrants attaches the account to its email grant on first sign-in", async () => {
    const w = await seedWorld();
    // The viewer grant in the seed already carries userId; make a fresh
    // email-only grant the way an invite does before the person signs up.
    const pendingId = await w.db.insert("membersAccess", {
      societyId: w.societyId,
      email: "newbie@x.com",
      role: "editor",
      menus: ["dashboard", "bills"],
      grantedBy: w.ownerUserId,
      createdAt: 4,
    });
    const newbieId = await w.db.insert("users", { email: "newbie@x.com" });

    const bound = (await fn(accessMod, "bindPendingGrants")(
      w.ctxFor(newbieId),
      {},
    )) as number;
    expect(bound).toBeGreaterThanOrEqual(1);
    expect(grantRow(w, pendingId).userId).toBe(newbieId);
  });
});
