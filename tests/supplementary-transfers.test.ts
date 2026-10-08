/**
 * Supplementary bill + flat transfer backend tests (bun:test).
 *
 * Exercises the REAL Convex handlers via their `._handler` entrypoint against
 * an in-memory db + auth stub (same technique as payments.test.ts /
 * voucherno.test.ts — the auth subject is the actual users-row id).
 * Not part of the vite build; run via bun.
 */
import { describe, expect, test } from "bun:test";
import * as suppMod from "../src/convex/supplementary";
import * as transfersMod from "../src/convex/transfers";

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
    async delete(id: string) {
      const t = byId.get(id);
      if (!t) throw new Error(`delete: unknown id ${id}`);
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

async function makeWorld(opts: { fyStart?: string } = {}) {
  const made = makeDb();
  const { db } = made;
  const ownerId = (await db.insert("users", { email: "owner@test", name: "The Owner" })) as string;
  const today = new Date().toISOString().slice(0, 10);
  const fyStart = opts.fyStart ?? `${today.slice(0, 8)}01`;
  const societyId = (await db.insert("societies", {
    name: "Test Society",
    fyStartMonth: 4,
    fyStartDate: fyStart,
    fyYear: "2026-27",
    createdBy: ownerId,
  })) as string;
  const incomeId = (await db.insert("accounts", {
    societyId,
    kind: undefined,
    code: "3040",
    name: "Other Income",
    type: "income",
    openingBalance: 0,
  })) as string;
  const m1 = (await db.insert("members", {
    societyId,
    code: "01",
    name: "Ravi Kumar",
    wing: "A",
    flatNo: "101",
    isActive: true,
    openingBalance: 0,
  })) as string;
  const m2 = (await db.insert("members", {
    societyId,
    code: "02",
    name: "Sunita Deshmukh",
    wing: "A",
    flatNo: "102",
    isActive: true,
    openingBalance: 0,
  })) as string;
  const inactive = (await db.insert("members", {
    societyId,
    code: "03",
    name: "Old Member",
    isActive: false,
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
  return { made, db, ctx, societyId, ownerId, incomeId, m1, m2, inactive, today };
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

/* --------------------------- supplementary bills --------------------------- */

describe("supplementary.create", () => {
  test("creates one SB- bill per selected member, kind supplementary", async () => {
    const w = await makeWorld();
    const res = (await fn(suppMod, "create")(w.ctx, {
      societyId: w.societyId,
      description: "Terrace waterproofing",
      category: "Special Repair",
      amount: 2500,
      issueDate: w.today,
      dueDate: w.today,
      memberIds: [w.m1, w.m2],
    })) as { created: number; skipped: number };
    expect(res.created).toBe(2);
    expect(res.skipped).toBe(0);
    const bills = w.made.dump("bills");
    expect(bills).toHaveLength(2);
    for (const b of bills) {
      expect(b.billKind).toBe("supplementary");
      expect(b.category).toBe("Special Repair");
      expect(String(b.billNo).startsWith("SB-")).toBe(true);
      expect(b.total).toBe(2500);
      expect(b.status).toBe("unpaid");
      expect(b.lines).toHaveLength(1);
      expect(b.lines[0].accountId).toBe(w.incomeId); // Other Income fallback
    }
    // Separate series: numbering starts at SB-0001, SB-0002.
    const nos = bills.map((b) => b.billNo).sort();
    expect(nos).toEqual(["SB-0001", "SB-0002"]);
  });

  test("skips inactive members and reports the count", async () => {
    const w = await makeWorld();
    const res = (await fn(suppMod, "create")(w.ctx, {
      societyId: w.societyId,
      description: "Event",
      category: "Event Contribution",
      amount: 500,
      issueDate: w.today,
      dueDate: w.today,
      memberIds: [w.m1, w.inactive],
    })) as { created: number; skipped: number };
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
  });

  test("refuses zero/negative amounts, empty selection and empty description", async () => {
    const w = await makeWorld();
    const base = { societyId: w.societyId, issueDate: w.today, dueDate: w.today };
    for (const bad of [
      { ...base, description: "x", category: "Penalty", amount: 0, memberIds: [w.m1] },
      { ...base, description: "x", category: "Penalty", amount: -5, memberIds: [w.m1] },
      { ...base, description: "x", category: "Penalty", amount: 10, memberIds: [] },
      { ...base, description: "   ", category: "Penalty", amount: 10, memberIds: [w.m1] },
    ]) {
      expect(fn(suppMod, "create")(w.ctx, bad)).rejects.toThrow();
    }
    expect(w.made.dump("bills")).toHaveLength(0);
  });

  test("refuses issue dates outside the financial year", async () => {
    const w = await makeWorld({ fyStart: "2026-04-01" });
    expect(
      fn(suppMod, "create")(w.ctx, {
        societyId: w.societyId,
        description: "Backdated",
        category: "Other",
        amount: 100,
        issueDate: "2026-03-31",
        dueDate: "2026-03-31",
        memberIds: [w.m1],
      }),
    ).rejects.toThrow(/outside the current financial year/);
  });

  test("list returns only supplementary bills", async () => {
    const w = await makeWorld();
    await w.db.insert("bills", {
      societyId: w.societyId,
      memberId: w.m1,
      billNo: "BILL-0001",
      period: w.today.slice(0, 7),
      issueDate: w.today,
      dueDate: w.today,
      lines: [],
      total: 100,
      paidAmount: 0,
      status: "unpaid",
    });
    await fn(suppMod, "create")(w.ctx, {
      societyId: w.societyId,
      description: "Penalty test",
      category: "Penalty",
      amount: 50,
      issueDate: w.today,
      dueDate: w.today,
      memberIds: [w.m1],
    });
    const list = (await fn(suppMod, "list")(w.ctx, {
      societyId: w.societyId,
    })) as Doc[];
    expect(list).toHaveLength(1);
    expect(list[0].billKind).toBe("supplementary");
  });
});

/* ------------------------------ flat transfers ----------------------------- */

async function seedBillsFor(w: World, memberId: string, unpaid: number) {
  await w.db.insert("bills", {
    societyId: w.societyId,
    memberId,
    billNo: "BILL-0001",
    period: w.today.slice(0, 7),
    issueDate: w.today,
    dueDate: w.today,
    lines: [],
    total: unpaid,
    paidAmount: 0,
    status: "unpaid",
  });
}

describe("transfers.perform", () => {
  test("settled path: archives outgoing, admits new member, writes full audit trail", async () => {
    const w = await makeWorld();
    const res = (await fn(transfersMod, "perform")(w.ctx, {
      societyId: w.societyId,
      outgoingMemberId: w.m1,
      duesHandling: "settled",
      transferDate: w.today,
      newMember: {
        code: "10",
        name: "New Owner",
        phone: "9876543210",
        familyInfo: "Spouse, one child",
        vehicleNo: "MH01AB1234",
        joinDate: w.today,
      },
    })) as { transferNo: string; outstanding: number; carryForward: number; archivedCode: string };

    expect(res.transferNo).toBe("TR-0001");
    expect(res.outstanding).toBe(0);
    expect(res.carryForward).toBe(0);
    expect(res.archivedCode).toContain("-T"); // archived code suffix

    const outgoing = await w.db.get("members", w.m1);
    expect(outgoing?.isActive).toBe(false);
    expect(outgoing?.code).toBe(res.archivedCode);

    const newMember = w.made.dump("members").find((m) => m.code === "10");
    expect(newMember).toBeTruthy();
    expect(newMember?.isActive).toBe(true);
    expect(newMember?.flatNo).toBe("101"); // inherits the flat
    expect(newMember?.familyInfo).toBe("Spouse, one child");
    expect(newMember?.vehicleNo).toBe("MH01AB1234");

    const transfers = w.made.dump("flatTransfers");
    expect(transfers).toHaveLength(1);
    const actions = (transfers[0].events as { action: string }[]).map((e) => e.action);
    // transfer_recorded MUST be inside the stored record (the old bug dropped it).
    expect(actions).toContain("transfer_recorded");
    expect(actions).toContain("outgoing_archived");
    expect(actions).toContain("new_member_admitted");
    expect(actions).toContain("dues_settled");
  });

  test("settled path refuses while dues remain outstanding", async () => {
    const w = await makeWorld();
    await seedBillsFor(w, w.m1, 750);
    expect(
      fn(transfersMod, "perform")(w.ctx, {
        societyId: w.societyId,
        outgoingMemberId: w.m1,
        duesHandling: "settled",
        transferDate: w.today,
        newMember: { code: "10", name: "New Owner" },
      }),
    ).rejects.toThrow(/must be settled before transfer/);
    // Nothing written.
    expect(w.made.dump("flatTransfers")).toHaveLength(0);
    expect((await w.db.get("members", w.m1))?.isActive).toBe(true);
  });

  test("carry_forward path: outstanding becomes the new member's opening balance", async () => {
    const w = await makeWorld();
    await seedBillsFor(w, w.m1, 1200);
    const res = (await fn(transfersMod, "perform")(w.ctx, {
      societyId: w.societyId,
      outgoingMemberId: w.m1,
      duesHandling: "carry_forward",
      transferDate: w.today,
      newMember: { code: "11", name: "Buyer" },
    })) as { carryForward: number };
    expect(res.carryForward).toBe(1200);
    const newMember = w.made.dump("members").find((m) => m.code === "11");
    expect(newMember?.openingBalance).toBe(1200);
  });

  test("carry_forward also moves dues onto an existing incoming member", async () => {
    const w = await makeWorld();
    await seedBillsFor(w, w.m1, 300);
    await fn(transfersMod, "perform")(w.ctx, {
      societyId: w.societyId,
      outgoingMemberId: w.m1,
      duesHandling: "carry_forward",
      transferDate: w.today,
      newMemberId: w.m2,
    });
    const incoming = await w.db.get("members", w.m2);
    expect(incoming?.openingBalance).toBe(300);
    expect(incoming?.flatNo).toBe("101"); // moved onto the outgoing flat
  });

  test("duplicate member codes and self-transfer are refused", async () => {
    const w = await makeWorld();
    // Self-transfer.
    expect(
      fn(transfersMod, "perform")(w.ctx, {
        societyId: w.societyId,
        outgoingMemberId: w.m1,
        duesHandling: "settled",
        transferDate: w.today,
        newMemberId: w.m1,
      }),
    ).rejects.toThrow(/same record/);
    // Duplicate code for the incoming owner.
    expect(
      fn(transfersMod, "perform")(w.ctx, {
        societyId: w.societyId,
        outgoingMemberId: w.m1,
        duesHandling: "settled",
        transferDate: w.today,
        newMember: { code: "02", name: "Copy Cat" },
      }),
    ).rejects.toThrow(/already in use/);
    expect(w.made.dump("flatTransfers")).toHaveLength(0);
  });

  test("transfer serial numbers increment per society", async () => {
    const w = await makeWorld();
    const first = (await fn(transfersMod, "perform")(w.ctx, {
      societyId: w.societyId,
      outgoingMemberId: w.m1,
      duesHandling: "settled",
      transferDate: w.today,
      newMember: { code: "10", name: "Owner A" },
    })) as { transferNo: string };
    const second = (await fn(transfersMod, "perform")(w.ctx, {
      societyId: w.societyId,
      outgoingMemberId: w.m2,
      duesHandling: "settled",
      transferDate: w.today,
      newMember: { code: "11", name: "Owner B" },
    })) as { transferNo: string };
    expect(first.transferNo).toBe("TR-0001");
    expect(second.transferNo).toBe("TR-0002");
  });
});
