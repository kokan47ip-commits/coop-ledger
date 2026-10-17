/**
 * Joint ownership + multi-flat login tests (bun:test, run with `bun test tests/`).
 *
 * Pure duplicate-prevention logic plus the REAL handlers (via `._handler`):
 *  • joint owners: add with duplicate/limit/range guards, audit trail, viewer refusal;
 *  • flat links: admin links flats to one login, duplicates refused, portal
 *    `myFlats` shows exactly the login's primary + linked flats (never others'),
 *    and a crafted request for a non-linked flat is refused;
 *  • member register duplicate prevention (code + active flat);
 *  • combined multi-flat payment splits into one pending entry per flat,
 *    never a merged charge.
 */
import { describe, expect, test } from "bun:test";
import {
  duplicateJointOwnerError,
  duplicateMemberError,
  flatIdentity,
  MAX_JOINT_OWNERS_PER_FLAT,
  multiFlatGroupsError,
} from "../src/convex/ownership";
import * as ownershipMod from "../src/convex/ownership";
import * as flatLinksMod from "../src/convex/flatLinks";
import * as membersMod from "../src/convex/members";
import * as portalMod from "../src/convex/memberPortal";

/* ------------------------------- pure logic ------------------------------- */

describe("duplicateMemberError (dup prevention)", () => {
  const mk = (o: {
    id?: string;
    code: string;
    name: string;
    wing?: string;
    flatNo?: string;
    building?: string;
    isActive?: boolean;
  }) => ({
    id: o.id,
    code: o.code,
    name: o.name,
    wing: o.wing,
    building: o.building,
    flatNo: o.flatNo,
    isActive: o.isActive ?? true,
  });

  test("same member code is refused", () => {
    const err = duplicateMemberError(
      [mk({ id: "m1", code: "M001", name: "Ravi" })],
      mk({ code: "m001", name: "Someone New", flatNo: "X-9" }),
    );
    expect(err).toMatch(/already used by Ravi/);
  });

  test("an active flat cannot get a second active member — joint owners instead", () => {
    const err = duplicateMemberError(
      [mk({ id: "m1", code: "M001", name: "Ravi", wing: "A", flatNo: "101" })],
      mk({ code: "M002", name: "Sunita", wing: "a", flatNo: " 101 " }),
    );
    expect(err).toMatch(/already has an active member record: Ravi/);
    expect(err).toMatch(/joint owners/i);
  });

  test("an inactive (archived/sold) member row never blocks the flat", () => {
    const err = duplicateMemberError(
      [mk({ id: "m1", code: "M001", name: "Old Owner", wing: "A", flatNo: "101", isActive: false })],
      mk({ code: "M002", name: "New Owner", wing: "A", flatNo: "101" }),
    );
    expect(err).toBeNull();
  });

  test("editing the same record is allowed; different flats/codes pass", () => {
    expect(
      duplicateMemberError(
        [mk({ id: "m1", code: "M001", name: "Ravi", wing: "A", flatNo: "101" })],
        mk({ id: "m1", code: "M001", name: "Ravi", wing: "A", flatNo: "101" }),
      ),
    ).toBeNull();
    expect(
      duplicateMemberError(
        [mk({ id: "m1", code: "M001", name: "Ravi", wing: "A", flatNo: "101" })],
        mk({ code: "M002", name: "Sunita", wing: "A", flatNo: "102" }),
      ),
    ).toBeNull();
  });

  test("flatIdentity normalises wing/building/flat case and spacing", () => {
    expect(flatIdentity({ wing: "A/1 ", building: "Main", flatNo: " 101-A " })).toBe(
      flatIdentity({ wing: "a/1", building: "main", flatNo: "101-a" }),
    );
    expect(flatIdentity({ wing: "", building: "", flatNo: "" })).toBe("//");
  });
});

describe("duplicateJointOwnerError", () => {
  test("the same name (case/spacing-insensitive) is refused", () => {
    expect(
      duplicateJointOwnerError([{ name: "Sunita Shukla" }], { name: "sunita  shukla" }),
    ).toMatch(/already recorded/);
  });
  test("the same email is refused even under another name spelling", () => {
    expect(
      duplicateJointOwnerError(
        [{ name: "Aaaa", email: "joint@x.com" }],
        { name: "Bbbb", email: "Joint@X.com " },
      ),
    ).toMatch(/already recorded/);
  });
  test("a genuinely different owner passes", () => {
    expect(
      duplicateJointOwnerError([{ name: "Sunita" }], { name: "Meena", email: "m@x.com" }),
    ).toBeNull();
  });
});

describe("multiFlatGroupsError (combined payment guard)", () => {
  test("empty selection refused", () => {
    expect(multiFlatGroupsError(["m1"], [])).toMatch(/at least one flat/);
  });
  test("an unauthorised flat is refused — never another login's flat", () => {
    expect(
      multiFlatGroupsError(["m1"], [
        { memberId: "other-login-flat", allocations: [{ billId: "b1", amount: 10 }] },
      ]),
    ).toMatch(/not linked to your login/);
  });
  test("each flat only once; ≤5 flats; each flat needs an amount; positive total", () => {
    expect(
      multiFlatGroupsError(["m1", "m2"], [
        { memberId: "m1", allocations: [{ billId: "b1", amount: 10 }] },
        { memberId: "m1", amount: 5 },
      ]),
    ).toMatch(/only once/);
    expect(
      multiFlatGroupsError(
        ["m1", "m2", "m3", "m4", "m5", "m6"],
        Array.from({ length: 6 }, (_, i) => ({
          memberId: `m${i + 1}`,
          amount: 1,
        })),
      ),
    ).toMatch(/at most 5/);
    expect(multiFlatGroupsError(["m1"], [{ memberId: "m1", allocations: [] }])).toMatch(
      /needs at least one bill amount/,
    );
    expect(
      multiFlatGroupsError(["m1"], [{ memberId: "m1", amount: 0.0, allocations: [] }]),
    ).toMatch(/needs at least one bill amount/);
  });
  test("a valid grouping passes", () => {
    expect(
      multiFlatGroupsError(["m1", "m2"], [
        { memberId: "m1", amount: 100 },
        { memberId: "m2", allocations: [{ billId: "b2", amount: 50 }] },
      ]),
    ).toBeNull();
  });
});

/* ----------------------------- handler-level ------------------------------ */

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

async function seedWorld() {
  const made = makeDb();
  const { db, dump } = made;
  const ownerUserId = await db.insert("users", { name: "Priya Owner", email: "owner@x.com" });
  const memberUserId = await db.insert("users", { name: "Mohan Member", email: "mem@x.com" });
  const viewerUserId = await db.insert("users", { name: "Vera Viewer", email: "viewer@x.com" });
  const societyId = await db.insert("societies", {
    name: "Test CHS",
    fyStartMonth: 4,
    fyStartDate: "2026-04-01",
    fyYear: "2026-27",
    createdBy: ownerUserId,
  });
  const bankId = await db.insert("accounts", {
    societyId,
    kind: "bank_cash",
    code: "1020",
    name: "HDFC Bank",
    type: "asset",
    openingBalance: 0,
  });
  const recvId = await db.insert("accounts", {
    societyId,
    kind: "receivable",
    code: "1000",
    name: "Members Receivable",
    type: "asset",
    openingBalance: 0,
  });
  const m1 = await db.insert("members", {
    societyId,
    code: "M001",
    name: "Ravi Sharma",
    wing: "A",
    flatNo: "101",
    openingBalance: 0,
    isActive: true,
  });
  const m2 = await db.insert("members", {
    societyId,
    code: "M002",
    name: "Nisha Mehta",
    wing: "B",
    flatNo: "201",
    openingBalance: 0,
    isActive: true,
  });
  const m3 = await db.insert("members", {
    societyId,
    code: "M003",
    name: "Karan Shah",
    wing: "B",
    flatNo: "301",
    openingBalance: 0,
    isActive: true,
  });
  // The portal login: bound to flat M001 (primary), flat M002 linked.
  await db.insert("membersAccess", {
    societyId,
    userId: memberUserId,
    email: "mem@x.com",
    role: "member",
    memberId: m1,
    grantedBy: ownerUserId,
    createdAt: 0,
  });
  await db.insert("flatLinks", {
    societyId,
    email: "mem@x.com",
    memberId: m2,
    userId: memberUserId,
    grantedById: ownerUserId,
    grantedByName: "Priya Owner",
    createdAt: 1,
  });
  await db.insert("memberOwners", {
    societyId,
    memberId: m1,
    name: "Sunita Sharma",
    relation: "Wife",
    addedById: ownerUserId,
    addedByName: "Priya Owner",
    createdAt: 2,
  });
  await db.insert("membersAccess", {
    societyId,
    userId: viewerUserId,
    email: "viewer@x.com",
    role: "viewer",
    grantedBy: ownerUserId,
    createdAt: 3,
  });
  return {
    db,
    dump,
    societyId,
    bankId,
    recvId,
    m1,
    m2,
    m3,
    ownerUserId,
    memberUserId,
    ownerCtx: ctxFor(made, ownerUserId),
    memberCtx: ctxFor(made, memberUserId),
    viewerCtx: ctxFor(made, viewerUserId),
  };
}

describe("joint owners (admin, Members tab)", () => {
  test("viewer cannot add a joint owner", async () => {
    const w = await seedWorld();
    await expect(
      fn(ownershipMod, "addJointOwner")(w.viewerCtx, {
        societyId: w.societyId,
        memberId: w.m1,
        name: "Extra Person",
      }),
    ).rejects.toThrow(/view-only|changes are not allowed/i);
    expect(w.dump("memberOwners")).toHaveLength(1);
  });

  test("add records the owner + audit; duplicates refused (name and email)", async () => {
    const w = await seedWorld();
    const add = fn(ownershipMod, "addJointOwner");
    await add(w.ownerCtx, {
      societyId: w.societyId,
      memberId: w.m1,
      name: "Meena Sharma",
      relation: "Daughter",
      sharePercent: 25,
      email: "meena@x.com",
    });
    expect(w.dump("memberOwners")).toHaveLength(2);
    const audit = w.dump("ownershipAudit");
    expect(audit.some((a) => a.action === "joint_owner.added")).toBe(true);

    await expect(
      add(w.ownerCtx, {
        societyId: w.societyId,
        memberId: w.m1,
        name: "  meena   sharma ",
      }),
    ).rejects.toThrow(/already recorded/);
    await expect(
      add(w.ownerCtx, {
        societyId: w.societyId,
        memberId: w.m1,
        name: "Other Name",
        email: "MEENA@x.com",
      }),
    ).rejects.toThrow(/already recorded/);
    await expect(
      add(w.ownerCtx, {
        societyId: w.societyId,
        memberId: w.m1,
        name: "Ima Bouncer",
        sharePercent: 150,
      }),
    ).rejects.toThrow(/Share must be between/);
  });

  test("a flat is capped at 4 joint owners; the 5th is refused", async () => {
    const w = await seedWorld();
    const add = fn(ownershipMod, "addJointOwner");
    expect(MAX_JOINT_OWNERS_PER_FLAT).toBe(4);
    for (const [i, name] of ["S1", "S2", "S3"].entries()) {
      await add(w.ownerCtx, {
        societyId: w.societyId,
        memberId: w.m1,
        name: `${name} Shukla`,
      });
    }
    expect(w.dump("memberOwners")).toHaveLength(4); // 1 seed + 3
    await expect(
      add(w.ownerCtx, {
        societyId: w.societyId,
        memberId: w.m1,
        name: "Fifth Wheel",
      }),
    ).rejects.toThrow(/already has 4 joint owners/);
  });

  test("removeJointOwner deletes the row and audits it", async () => {
    const w = await seedWorld();
    const rows = w.dump("memberOwners");
    const row = rows[0];
    await fn(ownershipMod, "removeJointOwner")(w.ownerCtx, {
      societyId: w.societyId,
      id: row._id,
    });
    expect(w.dump("memberOwners")).toHaveLength(0);
    expect(w.dump("ownershipAudit").some((a) => a.action === "joint_owner.removed")).toBe(true);
  });
});

describe("member register duplicate prevention", () => {
  test("upsert refuses a duplicated member code and a duplicated active flat", async () => {
    const w = await seedWorld();
    const upsert = fn(membersMod, "upsert");
    await expect(
      upsert(w.ownerCtx, {
        societyId: w.societyId,
        code: "m002",
        name: "Second Record",
        flatNo: "Z-1",
        openingBalance: 0,
        isActive: true,
      }),
    ).rejects.toThrow(/already used by Nisha Mehta/);
    await expect(
      upsert(w.ownerCtx, {
        societyId: w.societyId,
        code: "M010",
        name: "Co-Owner As Duplicate Row",
        wing: "A",
        flatNo: "101",
        openingBalance: 0,
        isActive: true,
      }),
    ).rejects.toThrow(/already has an active member record: Ravi Sharma/);
    // A joint owner is the correct path — the new active flat with a
    // different unit is fine, and an archival (inactive) duplicate is fine.
    await expect(
      upsert(w.ownerCtx, {
        societyId: w.societyId,
        code: "M011",
        name: "New Flat Owner",
        wing: "A",
        flatNo: "102",
        openingBalance: 0,
        isActive: true,
      }),
    ).resolves.toBeTruthy();
    await expect(
      upsert(w.ownerCtx, {
        societyId: w.societyId,
        code: "M012",
        name: "Archived Legacy Row",
        wing: "A",
        flatNo: "101",
        openingBalance: 0,
        isActive: false,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("flat links (multiple flats under one login)", () => {
  test("linkFlat: happy path + audit; duplicates, primary flat and foreign emails refused", async () => {
    const w = await seedWorld();
    const link = fn(flatLinksMod, "linkFlat");
    await link(w.ownerCtx, {
      societyId: w.societyId,
      email: "mem@x.com",
      memberId: w.m3,
    });
    expect(w.dump("flatLinks")).toHaveLength(2); // seed m2 + new m3
    expect(
      w.dump("ownershipAudit").some((a) => a.action === "flat_link.added"),
    ).toBe(true);

    await expect(
      link(w.ownerCtx, { societyId: w.societyId, email: "mem@x.com", memberId: w.m3 }),
    ).rejects.toThrow(/already linked/);
    await expect(
      link(w.ownerCtx, { societyId: w.societyId, email: "mem@x.com", memberId: w.m1 }),
    ).rejects.toThrow(/primary.*flat|bound.*flat/i);
    await expect(
      link(w.ownerCtx, { societyId: w.societyId, email: "stranger@x.com", memberId: w.m3 }),
    ).rejects.toThrow(/No portal login exists/);
  });

  test("unlinkFlat removes only the link (member row untouched) and audits it", async () => {
    const w = await seedWorld();
    const rows = w.dump("flatLinks");
    await fn(flatLinksMod, "unlinkFlat")(w.ownerCtx, {
      societyId: w.societyId,
      id: rows[0]._id,
    });
    expect(w.dump("flatLinks")).toHaveLength(0);
    expect(w.dump("members").filter((m) => m._id === w.m2)).toHaveLength(1);
    expect(w.dump("membersAccess")).toHaveLength(2); // grants untouched
  });
});

describe("portal multi-flat authorization + myFlats", () => {
  test("myFlats shows the primary + linked flats (primary first), never other flats", async () => {
    const w = await seedWorld();
    const flats = (await fn(portalMod, "myFlats")(w.memberCtx, {
      societyId: w.societyId,
    })) as { memberId: string; isPrimary: boolean; flatLabel: string; jointOwnerNames: string[] }[];
    expect(flats.map((f) => f.memberId)).toEqual([w.m1, w.m2]);
    expect(flats[0].isPrimary).toBe(true);
    expect(flats[0].jointOwnerNames).toEqual(["Sunita Sharma"]);
    expect(flats[0].flatLabel).toBe("A-101");
  });

  test("a crafted request for a NON-linked flat is refused loudly", async () => {
    const w = await seedWorld();
    await expect(
      fn(portalMod, "myInfo")(w.memberCtx, { societyId: w.societyId, memberId: w.m3 }),
    ).rejects.toThrow(/not linked to your login/);
    await expect(
      fn(portalMod, "myBills")(w.memberCtx, { societyId: w.societyId, memberId: w.m3 }),
    ).rejects.toThrow(/not linked to your login/);
  });

  test("myInfo follows the selected flat, including its own joint owners", async () => {
    const w = await seedWorld();
    const info2 = (await fn(portalMod, "myInfo")(w.memberCtx, {
      societyId: w.societyId,
      memberId: w.m2,
    })) as { member: { name: string }; jointOwners: { name: string }[] };
    expect(info2.member.name).toBe("Nisha Mehta");
    expect(info2.jointOwners).toHaveLength(0);
  });
});

describe("combined multi-flat payment", () => {
  test("one submission per flat — never a merged charge", async () => {
    const w = await seedWorld();
    const res = (await fn(portalMod, "submitMultiFlatPayment")(w.memberCtx, {
      societyId: w.societyId,
      date: "2026-06-20",
      bankCashAccountId: w.bankId,
      mode: "upi",
      reference: "UTR-1",
      narration: "Combined payment",
      groups: [
        { memberId: w.m1, amount: 500, allocations: [] },
        { memberId: w.m2, amount: 300, allocations: [] },
      ],
    } as unknown as object)) as { created: number; total: number };
    expect(res.created).toBe(2);
    expect(res.total).toBe(800);
    const rows = w.dump("paymentSubmissions");
    expect(rows).toHaveLength(2);
    const byMember = new Map(rows.map((r) => [r.memberId, r]));
    expect(byMember.get(w.m1)!.amount).toBe(500);
    expect(byMember.get(w.m2)!.amount).toBe(300);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  test("a group for an unauthorised flat is refused — nothing is created", async () => {
    const w = await seedWorld();
    await expect(
      fn(portalMod, "submitMultiFlatPayment")(w.memberCtx, {
        societyId: w.societyId,
        date: "2026-06-20",
        bankCashAccountId: w.bankId,
        groups: [{ memberId: w.m1, amount: 500 }, { memberId: w.m3, amount: 100 }],
      }),
    ).rejects.toThrow(/not linked to your login/);
    expect(w.dump("paymentSubmissions")).toHaveLength(0);
  });

  test("the single-flat payment accepts a linked flat other than the primary", async () => {
    const w = await seedWorld();
    const res = (await fn(portalMod, "submitPayment")(w.memberCtx, {
      societyId: w.societyId,
      memberId: w.m2,
      date: "2026-06-20",
      bankCashAccountId: w.bankId,
      mode: "bank",
      allocations: [],
      amount: 250,
    } as unknown as object)) as { submissionId: string; total: number };
    expect(res.total).toBe(250);
    const rows = w.dump("paymentSubmissions");
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(w.m2);
  });
});
