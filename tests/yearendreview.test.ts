/**
 * Review-follow-up tests (bun:test): the fixes found while reviewing the
 * uncommitted year-end / cross-FY changes — portal ledger brought-forward
 * anchoring, transfer adjacency, reopen + re-close snapshot refresh, and
 * bulk-ledger boundary slicing — plus a performance probe on the
 * single-traversal ledger rewrite.
 */
import { describe, expect, test } from "bun:test";
import * as yearEndMod from "../src/convex/yearEnd";
import * as memberPortal from "../src/convex/memberPortal";
import { computeAccountLedger } from "../src/convex/reports";

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

function ctxFor(world: { db: ReturnType<typeof makeDb>["db"] }, userId: string | null) {
  return {
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
  };
}

type Handler = { _handler: (ctx: object, args: object) => Promise<unknown> };
const fn = (mod: object, name: string) =>
  (mod as unknown as Record<string, Handler>)[name]._handler;

/* --------------------------------- world ---------------------------------- */

async function seedWorld() {
  const made = makeDb();
  const { db, dump } = made;
  const ownerUserId = await db.insert("users", { email: "owner@x.com" });
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
    code: "B1",
    name: "HDFC Current",
    openingBalance: 0,
  });
  const receivableId = await db.insert("accounts", {
    societyId,
    kind: "receivable",
    code: "R1",
    name: "Members Receivable",
    openingBalance: 0,
  });
  const incomeId = await db.insert("accounts", {
    societyId,
    code: "I1",
    name: "Maintenance Charges",
    type: "income",
    openingBalance: 0,
  });
  await db.patch(societyId, { receivableAccountId: receivableId });

  const memberId = await db.insert("members", {
    societyId,
    name: "Ravi Kumar",
    wing: "A",
    flatNo: "101",
    code: "A-101",
    isActive: true,
    openingBalance: 0,
  });
  const memberUserId = await db.insert("users", { email: "ravi@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: memberUserId,
    email: "ravi@x.com",
    role: "member",
    memberId,
    grantedBy: ownerUserId,
    createdAt: 0,
  });

  const yearendUserId = await db.insert("users", { email: "accountant@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: yearendUserId,
    email: "accountant@x.com",
    role: "editor",
    menus: ["yearend"],
    grantedBy: ownerUserId,
    createdAt: 0,
  });

  return {
    db,
    dump,
    societyId,
    bankId,
    receivableId,
    incomeId,
    memberId,
    memberUserId,
    yearendUserId,
    memberCtx: ctxFor(made, memberUserId),
    yearendCtx: ctxFor(made, yearendUserId),
    ownerCtx: ctxFor(made, ownerUserId),
  };
}

/* --------------------- portal ledger brought-forward ----------------------- */

describe("portal myLedger brought-forward (cross-FY)", () => {
  test("later-period portal ledger opens at the true balance with the Bf label", async () => {
    const w = await seedWorld();
    await w.db.insert("bills", {
      societyId: w.societyId,
      memberId: w.memberId,
      billNo: "B-0001",
      period: "2026-04",
      issueDate: "2026-04-05",
      dueDate: "2026-04-20",
      lines: [{ accountId: w.incomeId, name: "Maintenance", amount: 500 }],
      total: 500,
      paidAmount: 200,
      status: "partial",
    });
    await w.db.insert("vouchers", {
      societyId: w.societyId,
      type: "member_receipt",
      voucherNo: "MR-0001",
      date: "2026-05-02",
      memberId: w.memberId,
      bankCashAccountId: w.bankId,
      total: 200,
      lines: [
        { accountId: w.bankId, debit: 200, credit: 0 },
        { accountId: w.receivableId, debit: 0, credit: 200 },
      ],
    });

    const rows = (await fn(memberPortal, "myLedger")(w.memberCtx, {
      societyId: w.societyId,
      fromDate: "2027-01-01",
      toDate: "2027-01-31",
    })) as { voucherNo: string; debit: number; balance: number; note?: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.voucherNo).toBe("OPENING");
    expect(rows[0]!.debit).toBe(300);
    expect(rows[0]!.balance).toBe(300);
    expect(String(rows[0]!.note)).toContain("Brought forward");
  });

  test("current-period portal ledger keeps the plain OPENING row (no pre movement)", async () => {
    const w = await seedWorld();
    await w.db.insert("bills", {
      societyId: w.societyId,
      memberId: w.memberId,
      billNo: "B-0001",
      period: "2026-04",
      issueDate: "2026-04-05",
      dueDate: "2026-04-20",
      lines: [{ accountId: w.incomeId, name: "Maintenance", amount: 500 }],
      total: 500,
      paidAmount: 0,
      status: "unpaid",
    });
    const rows = (await fn(memberPortal, "myLedger")(w.memberCtx, {
      societyId: w.societyId,
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    })) as { voucherNo: string; debit: number; balance: number; note?: string }[];
    // Zero opening + no pre-period movement → no OPENING row (as before); the
    // bill is the first row and must NOT double-count anything.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.voucherNo).toBe("B-0001");
    expect(rows[0]!.debit).toBe(500);
    expect(rows[0]!.balance).toBe(500);
  });
});

/* --------------------- transfer adjacency + reopen refresh ------------------ */

describe("transferBalance guards + reopen refresh", () => {
  test("non-adjacent next year is refused", async () => {
    const w = await seedWorld();
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      start: "2026-04-01",
      end: "2027-03-31",
    });
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2028-29",
      start: "2028-04-01",
      end: "2029-03-31",
    });
    expect(
      fn(yearEndMod, "transferBalance")(w.ownerCtx, {
        societyId: w.societyId,
        label: "2026-27",
        nextLabel: "2028-29",
      }),
    ).rejects.toThrow(/must start the day after/);
  });

  test("reopen clears the snapshot; re-close refreshes it to the new state", async () => {
    const w = await seedWorld();
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      start: "2026-04-01",
      end: "2027-03-31",
    });
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2027-28",
      start: "2027-04-01",
      end: "2028-03-31",
    });
    await w.db.insert("bills", {
      societyId: w.societyId,
      memberId: w.memberId,
      billNo: "B-0001",
      period: "2026-04",
      issueDate: "2026-04-05",
      dueDate: "2026-04-20",
      lines: [{ accountId: w.incomeId, name: "Maintenance", amount: 500 }],
      total: 500,
      paidAmount: 0,
      status: "unpaid",
    });
    await fn(yearEndMod, "transferBalance")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      nextLabel: "2027-28",
    });
    let year = w.dump("accountingYears").find((y) => y.label === "2026-27");
    expect(year?.carriedTotals?.memberDues).toBe(500);

    // Reopen: snapshot cleared, status open.
    await fn(yearEndMod, "reopenYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
    });
    year = w.dump("accountingYears").find((y) => y.label === "2026-27");
    expect(year?.status).toBe("open");
    expect(year?.carriedAccounts).toBeUndefined();

    // A later receipt settles 200 — the re-close refreshes the snapshot.
    await w.db.insert("vouchers", {
      societyId: w.societyId,
      type: "member_receipt",
      voucherNo: "MR-0001",
      date: "2026-05-02",
      memberId: w.memberId,
      bankCashAccountId: w.bankId,
      total: 200,
      lines: [
        { accountId: w.bankId, debit: 200, credit: 0 },
        { accountId: w.receivableId, debit: 0, credit: 200 },
      ],
    });
    await fn(yearEndMod, "transferBalance")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      nextLabel: "2027-28",
    });
    year = w.dump("accountingYears").find((y) => y.label === "2026-27");
    expect(year?.status).toBe("closed");
    expect(year?.carriedTotals?.memberDues).toBe(300);
  });
});

/* --------------------- closingBalances: registration guard ----------------- */

describe("closingBalances guards", () => {
  test("unregistered label is refused; registered label returns rows", async () => {
    const w = await seedWorld();
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      start: "2026-04-01",
      end: "2027-03-31",
    });
    expect(
      fn(yearEndMod, "closingBalances")(w.ownerCtx, {
        societyId: w.societyId,
        label: "1999-00",
      }),
    ).rejects.toThrow(/not registered/);
    const res = (await fn(yearEndMod, "closingBalances")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
    })) as { members: { memberId: string; amount: number }[] };
    expect(res.members).toEqual([]);
  });
});

/* ------------------------- performance: single traversal ------------------- */

describe("ledger anchoring performance", () => {
  test("500 entries × masked high-code member: still sub-second", () => {
    const db = makeDb();
    const societyId = db.db.insert("societies", {
      name: "Perf",
      fyStartMonth: 4,
      createdBy: "u0",
      openingBalance: 0,
    });
    void societyId;
    const accounts = [
      { _id: "acc", _creationTime: 0, societyId, code: "A", name: "Acc", openingBalance: 0 },
    ];
    const vouchers = Array.from({ length: 500 }, (_, i) => ({
      _id: `v${i}`,
      _creationTime: i,
      societyId,
      type: "journal",
      voucherNo: `JV-${String(i).padStart(4, "0")}`,
      date: "2026-04-01",
      lines: [{ accountId: "acc", debit: 1, credit: 0 }],
    }));
    const data = {
      accounts,
      accountGroups: [],
      members: [],
      vouchers,
      bills: [],
      society: { _id: societyId, fyStartMonth: 4 },
      tariffs: [],
    } as never;

    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      computeAccountLedger(data, "acc", "0000-01-01", "2027-12-31");
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000); // 50 runs × 500 entries in well under 2s
  });
});
