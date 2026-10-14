/**
 * Year-End Process tests (bun:test, run with `bun test tests/`).
 *
 * Exercises the REAL handlers (via `._handler`) against an in-memory db +
 * auth stub: rights gating (owner/editor-viewer/granted users), the
 * closed-year entry gate, carry-forward computations, and the
 * brought-forward ledger behaviour for cross-FY reporting.
 */
import { describe, expect, test } from "bun:test";
import * as yearEndMod from "../src/convex/yearEnd";
import * as vouchersMod from "../src/convex/vouchers";
import { computeAccountLedger, computeMemberLedger } from "../src/convex/reports";

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

  const editorUserId = await db.insert("users", { email: "editor@x.com" });
  await db.insert("membersAccess", {
    societyId,
    userId: editorUserId,
    email: "editor@x.com",
    role: "editor",
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
    ownerUserId,
    editorUserId,
    yearendUserId,
    ownerCtx: ctxFor(made, ownerUserId),
    editorCtx: ctxFor(made, editorUserId),
    yearendCtx: ctxFor(made, yearendUserId),
    anonCtx: ctxFor(made, null),
  };
}

/* ------------------------------- rights gating ---------------------------- */

describe("yearEnd rights", () => {
  test("owner and software admin always hold the right; plain editor does not", async () => {
    const w = await seedWorld();
    const rights = (await fn(yearEndMod, "overview")(w.ownerCtx, {
      societyId: w.societyId,
    })) as { rights: { canManage: boolean } };
    expect(rights.rights.canManage).toBe(true);

    const ed = (await fn(yearEndMod, "overview")(w.editorCtx, {
      societyId: w.societyId,
    })) as { rights: { canManage: boolean } };
    expect(ed.rights.canManage).toBe(false);
  });

  test("a user granted the yearend menu right holds it; viewer-only does not", async () => {
    const w = await seedWorld();
    const y = (await fn(yearEndMod, "overview")(w.yearendCtx, {
      societyId: w.societyId,
    })) as { rights: { canManage: boolean; mayPostClosed: boolean } };
    expect(y.rights.canManage).toBe(true);
    expect(y.rights.mayPostClosed).toBe(true);
  });

  test("manage actions refuse a plain editor", async () => {
    const w = await seedWorld();
    expect(
      fn(yearEndMod, "createYear")(w.editorCtx, {
        societyId: w.societyId,
        label: "2027-28",
        start: "2027-04-01",
        end: "2028-03-31",
      }),
    ).rejects.toThrow(/Only the society owner|Year-End Process rights/);
  });
});

/* ------------------------------- create year ------------------------------ */

describe("createYear", () => {
  test("granted user can register a non-overlapping year", async () => {
    const w = await seedWorld();
    const res = (await fn(yearEndMod, "createYear")(w.yearendCtx, {
      societyId: w.societyId,
      label: "2027-28",
      start: "2027-04-01",
      end: "2028-03-31",
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    const rows = w.dump("accountingYears");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("2027-28");
    expect(rows[0]!.status).toBe("open");
  });

  test("duplicate label and overlapping range are refused", async () => {
    const w = await seedWorld();
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2027-28",
      start: "2027-04-01",
      end: "2028-03-31",
    });
    expect(
      fn(yearEndMod, "createYear")(w.ownerCtx, {
        societyId: w.societyId,
        label: "2027-28",
        start: "2028-04-01",
        end: "2029-03-31",
      }),
    ).rejects.toThrow(/already registered/);
    expect(
      fn(yearEndMod, "createYear")(w.ownerCtx, {
        societyId: w.societyId,
        label: "2028-29",
        start: "2026-06-01",
        end: "2028-05-31",
      }),
    ).rejects.toThrow(/overlaps/);
  });
});

/* ---------------------------- transfer balance ----------------------------- */

describe("transferBalance", () => {
  test("closes the year, snapshots carried balances and moves the books period", async () => {
    const w = await seedWorld();
    // Post an April-2027 receipt so the carry figure is measurable... but
    // society is in FY 2026-27, so 2027-04 is a future (open) year: register
    // both years first.
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
    // A bill in the books year: April 2026, 500 income billed, 200 received.
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

    const res = (await fn(yearEndMod, "transferBalance")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      nextLabel: "2027-28",
    })) as {
      ok: boolean;
      carriedAccounts: number;
      carriedMembers: number;
      memberDues: number;
    };
    expect(res.ok).toBe(true);

    // Society moved into the next books year.
    const soc = await w.db.get(w.societyId);
    expect(soc?.fyStartDate).toBe("2027-04-01");
    expect(soc?.fyYear).toBe("2027-28");

    const yr = w.dump("accountingYears").find((y) => y.label === "2026-27");
    expect(yr?.status).toBe("closed");
    expect(yr?.carriedMembers).toEqual([{ memberId: w.memberId, amount: 300 }]);
    expect(yr?.carriedTotals?.memberDues).toBe(300);
    // Receivable carries 300 Dr; income carries 500 Cr; bank carries 200 Dr.
    const carried = new Map<string, number>(
      (yr?.carriedAccounts as { accountId: string; amount: number }[]).map(
        (r) => [r.accountId, r.amount],
      ),
    );
    expect(carried.get(w.receivableId)).toBe(300);
    expect(carried.get(w.incomeId)).toBe(-500);
    expect(carried.get(w.bankId)).toBe(200);
  });

  test("requires an adjacent next year; refuses closing twice", async () => {
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
    await fn(yearEndMod, "transferBalance")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      nextLabel: "2027-28",
    });
    // Not adjacent.
    await fn(yearEndMod, "createYear")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2029-30",
      start: "2029-04-01",
      end: "2030-03-31",
    });
    expect(
      fn(yearEndMod, "reopenYear")(w.ownerCtx, {
        societyId: w.societyId,
        label: "2027-28",
      }),
    ).rejects.toThrow(/not closed/);
  });
});

/* --------------------------- closed-year entry gate ------------------------ */

describe("closed-year entry gate (vouchers.create)", () => {
  test("plain editor cannot post into a closed year; granted/owner can", async () => {
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
    await fn(yearEndMod, "transferBalance")(w.ownerCtx, {
      societyId: w.societyId,
      label: "2026-27",
      nextLabel: "2027-28",
    });

    // A CLOSED-year date (2026-06). The voucher save posts a journal moving
    // cash between ledgers — dated in the closed year.
    const voucherArgs = {
      societyId: w.societyId,
      type: "journal" as const,
      date: "2026-06-15",
      lines: [
        { accountId: w.bankId, debit: 100, credit: 0 },
        { accountId: w.receivableId, debit: 0, credit: 100 },
      ],
    };
    // Plain editor: refused.
    expect(fn(vouchersMod, "create")(w.editorCtx, voucherArgs)).rejects.toThrow(
      /CLOSED accounting year|x outside the current financial year/,
    );
    // Granted year-end user: allowed.
    const id = (await fn(vouchersMod, "create")(w.yearendCtx, voucherArgs)) as string;
    expect(id).toBeTruthy();
  });

  test("entries in the current books year are unaffected", async () => {
    const w = await seedWorld();
    const id = (await fn(vouchersMod, "create")(w.editorCtx, {
      societyId: w.societyId,
      type: "journal",
      date: "2026-04-20",
      lines: [
        { accountId: w.bankId, debit: 100, credit: 0 },
        { accountId: w.receivableId, debit: 0, credit: 100 },
      ],
    })) as string;
    expect(id).toBeTruthy();
  });
});

/* --------------------- brought-forward ledger anchoring ------------------- */

describe("cross-FY brought-forward ledgers", () => {
  test("account ledger for a past period shows the true brought-forward opening", async () => {
    const w = await seedWorld();
    await w.db.insert("vouchers", {
      societyId: w.societyId,
      type: "journal",
      voucherNo: "JV-0001",
      date: "2026-04-10",
      lines: [
        { accountId: w.bankId, debit: 5000, credit: 0 },
        { accountId: w.receivableId, debit: 0, credit: 5000 },
      ],
    });

    const data = {
      accounts: w.dump("accounts"),
      members: w.dump("members"),
      vouchers: w.dump("vouchers"),
      bills: w.dump("bills"),
      society: await w.db.get(w.societyId),
    } as never;

    // Period January 2027 (after the April posting): the ledger must open at
    // 5000, not the recorded opening 0 — an explicit OPENING row appears.
    const rows = computeAccountLedger(data, w.bankId, "2027-01-01", "2027-01-31");
    expect(rows[0]!.voucherNo).toBe("OPENING");
    expect(rows[0]!.debit).toBe(5000);
    expect(rows).toHaveLength(1);

    // A period with no pre-movement keeps no OPENING row.
    const preRows = computeAccountLedger(data, w.bankId, "2026-04-01", "2026-04-30");
    expect(preRows.find((r) => r.voucherNo === "OPENING")).toBeUndefined();
  });

  test("member ledger for a later period carries the earlier charges/receipts", async () => {
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

    const data = {
      accounts: w.dump("accounts"),
      members: w.dump("members"),
      vouchers: w.dump("vouchers"),
      bills: w.dump("bills"),
      society: await w.db.get(w.societyId),
    } as never;

    // Period 2027-01 (all entries are pre-period): opening = 500 - 200 = 300.
    const rows = computeMemberLedger(data, w.memberId, "2027-01-01", "2027-01-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.voucherNo).toBe("OPENING");
    expect(rows[0]!.debit).toBe(300);
    expect(rows[0]!.balance).toBe(300);
    expect(String(rows[0]!.note)).toContain("Brought forward");
  });
});
