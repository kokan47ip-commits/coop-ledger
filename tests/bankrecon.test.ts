/**
 * Bank Reconciliation tests (bun:test, run with `bun test tests/`).
 *
 * Pure statement builder maths (deposits pending at the bank, cheques not yet
 * presented, books → pass-book expected balance, difference) plus the REAL
 * handlers (via `._handler`): viewer cannot save, one row per
 * (account, statement date) with replace-on-resave, and ticks carrying
 * forward cumulatively into later statements.
 */
import { describe, expect, test } from "bun:test";
import {
  buildBankReconStatement,
  type BankReconStatement,
} from "../src/convex/bankRecon";
import { computeCashBook, type SocietyData } from "../src/convex/reports";
import * as bankReconMod from "../src/convex/bankRecon";

/* --------------------------- SocietyData fixtures -------------------------- */

const acct = (
  id: string,
  type: string,
  extra: { kind?: string; name?: string; openingBalance?: number; code?: string } = {},
) => ({
  _id: id,
  _creationTime: 0,
  societyId: "s1",
  code: extra.code ?? id.toUpperCase(),
  name: extra.name ?? id,
  type,
  kind: extra.kind,
  openingBalance: extra.openingBalance ?? 0,
});

const vouchers = [
  // Deposit: books Dr bank 1000 (receipt of member dues by cash/cheque).
  { _id: "rv1", _creationTime: 1, societyId: "s1", date: "2026-05-05", voucherNo: "MR-0001", type: "other_receipt", total: 1000, lines: [ { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "recv", debit: 0, credit: 1000 } ] },
  // Journal: bank Dr 500 (a fixed deposit opened from cash is another deposit).
  { _id: "jv1", _creationTime: 2, societyId: "s1", date: "2026-05-08", voucherNo: "JV-0001", type: "journal", total: 500, lines: [ { accountId: "bank", debit: 500, credit: 0 }, { accountId: "repair", debit: 0, credit: 500 } ] },
  // Withdrawal: books Cr bank 400 (cheque payment recorded, not yet presented).
  { _id: "pv1", _creationTime: 3, societyId: "s1", date: "2026-05-20", voucherNo: "PY-0001", type: "payment", total: 400, lines: [ { accountId: "repair", debit: 400, credit: 0 }, { accountId: "bank", debit: 0, credit: 400 } ] },
];

const data = {
  accounts: [
    acct("bank", "asset", { kind: "bank_cash", name: "HDFC Bank", code: "1020" }),
    acct("recv", "asset", { kind: "receivable", name: "Members Receivable" }),
    acct("repair", "expense", { name: "Repairs and Maintenance" }),
  ],
  accountGroups: [],
  members: [],
  vouchers,
  bills: [],
  society: { _id: "s1", fyStartMonth: 4 },
  tariffs: [],
} as unknown as SocietyData;

const FROM = "2026-05-01";
const TO = "2026-05-31";

const section = computeCashBook(data, FROM, TO, "bank")[0];
if (!section) throw new Error("fixture bank section missing");

/* ------------------------------ pure computations ------------------------- */

describe("buildBankReconStatement", () => {
  test("fresh books, nothing cleared: every entry is pending and expected pass book nets to 0", () => {
    const s = buildBankReconStatement(section, new Set(), null);
    expect(s.entries).toHaveLength(3);
    expect(s.unclearedDeposits).toBe(1500);
    expect(s.unclearedWithdrawals).toBe(400);
    expect(s.bookClosing).toBe(1100); // 0 opening + 1500 − 400
    // Bank may not have seen any of it yet: expected = 1100 − 1500 + 400.
    expect(s.expectedBankBalance).toBe(0);
    expect(s.stated).toBe(false);
    expect(s.difference).toBeNull();
    expect(s.actualBalance).toBe(0);
  });

  test("stated balance reconciles exactly when everything cleared", () => {
    const cleared = new Set(["MR-0001", "JV-0001", "PY-0001"]);
    const s = buildBankReconStatement(section, cleared, 1100);
    expect(s.unclearedDeposits).toBe(0);
    expect(s.unclearedWithdrawals).toBe(0);
    expect(s.expectedBankBalance).toBe(1100);
    expect(s.difference).toBe(0);
    expect(s.stated).toBe(true);
  });

  test("a stated balance off by 100 shows a 100 difference", () => {
    const cleared = new Set(["MR-0001", "JV-0001", "PY-0001"]);
    const s = buildBankReconStatement(section, cleared, 1200);
    expect(s.expectedBankBalance).toBe(1100);
    expect(s.difference).toBe(100);
  });

  test("partial clearing: only un-ticked entries stay pending", () => {
    const cleared = new Set(["MR-0001", "PY-0001"]); // JV-0001 (deposit 500) still pending
    const s = buildBankReconStatement(section, cleared, 600);
    expect(s.unclearedDeposits).toBe(500);
    expect(s.unclearedWithdrawals).toBe(0);
    // expected = 1100 books − 500 uncredited deposit = 600
    expect(s.expectedBankBalance).toBe(600);
    expect(s.difference).toBe(0);
  });

  test("round to paise: fractional amounts net exactly", () => {
    const tiny = {
      ...data,
      vouchers: [
        ...vouchers,
        { _id: "x1", _creationTime: 4, societyId: "s1", date: "2026-05-21", voucherNo: "PY-0002", type: "payment", total: 10.05, lines: [ { accountId: "repair", debit: 10.05, credit: 0 }, { accountId: "bank", debit: 0, credit: 10.05 } ] },
      ],
    } as unknown as SocietyData;
    const secs = computeCashBook(tiny, FROM, TO, "bank")[0];
    // Cleared: MR/JV. Pending: withdrawals 400 (PY-0001) + 10.05 (PY-0002).
    // Books: 1500 − 410.05 = 1089.95. Expected pass book: 1089.95 + 410.05
    // (cheques not yet presented will hit the bank) = 1500 exactly.
    const s = buildBankReconStatement(secs, new Set(["MR-0001", "JV-0001"]), 1500);
    expect(s.unclearedDeposits).toBe(0);
    expect(s.unclearedWithdrawals).toBe(410.05);
    expect(s.bookClosing).toBe(1089.95);
    expect(s.expectedBankBalance).toBe(1500);
    expect(s.difference).toBe(0);
  });
});

/* ------------------------- handler-level integration ---------------------- */

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
  const repairId = await db.insert("accounts", {
    societyId,
    code: "4020",
    name: "Repairs and Maintenance",
    type: "expense",
    openingBalance: 0,
  });
  // The module-level vouchers reference the FIXTURE ids (bank/recv/repair);
  // re-point them at the ids the world actually inserted.
  const remap = { bank: bankId, recv: recvId, repair: repairId };
  for (const v of vouchers) {
    await db.insert("vouchers", {
      ...v,
      societyId,
      lines: v.lines.map((l) => ({ ...l, accountId: (remap as Record<string, unknown>)[l.accountId] ?? l.accountId })),
    });
  }
  await db.insert("membersAccess", {
    societyId,
    userId: viewerUserId,
    email: "viewer@x.com",
    role: "viewer",
    grantedBy: ownerUserId,
    createdAt: 0,
  });
  return {
    db,
    dump,
    societyId,
    bankId,
    recvId,
    repairId,
    ownerCtx: ctxFor(made, ownerUserId),
    viewerCtx: ctxFor(made, viewerUserId),
  };
}

describe("bnkRecon save + workspace", () => {
  test("viewer cannot save a reconciliation", async () => {
    const w = await seedWorld();
    expect(
      fn(bankReconMod, "save")(w.viewerCtx, {
        societyId: w.societyId,
        accountId: w.bankId,
        toDate: "2026-05-31",
        bookBalance: 1100,
        actualBalance: 600,
        clearedVoucherNos: ["MR-0001", "PY-0001"],
      }),
    ).rejects.toThrow(/view-only|changes are not allowed/i);
    expect(w.dump("bankReconciliations")).toHaveLength(0);
  });

  test("save stores one row; workspace reads it; owner defaults apply", async () => {
    const w = await seedWorld();
    const save = fn(bankReconMod, "save") as Handler["_handler"];
    const res = (await save(w.ownerCtx, {
      societyId: w.societyId,
      accountId: w.bankId,
      toDate: "2026-05-31",
      bookBalance: 1100,
      actualBalance: 600,
      clearedVoucherNos: ["MR-0001", "PY-0001"],
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(w.dump("bankReconciliations")).toHaveLength(1);

    const ws = await fn(bankReconMod, "workspace")(
      w.ownerCtx,
      {
        societyId: w.societyId,
        accountId: w.bankId,
        fromDate: "2026-05-01",
        toDate: "2026-05-31",
      },
    ) as BankReconStatement;
    expect(ws.name).toBe("HDFC Bank");
    expect(ws.entries).toHaveLength(3);
    expect(ws.entries.find((e) => e.voucherNo === "MR-0001")?.cleared).toBe(true);
    expect(ws.entries.find((e) => e.voucherNo === "PY-0001")?.cleared).toBe(true);
    expect(ws.entries.find((e) => e.voucherNo === "JV-0001")?.cleared).toBe(false);
    expect(ws.unclearedDeposits).toBe(500); // JV-0001 pending deposit
    expect(ws.expectedBankBalance).toBe(600);
    expect(ws.stated).toBe(true);
    expect(ws.actualBalance).toBe(600);
    expect(ws.difference).toBe(0);
    expect(ws.savedByName).toBe("Priya Owner");
  });

  test("an earlier statement's ticks carry into a LATER statement date", async () => {
    const w = await seedWorld();
    const save = fn(bankReconMod, "save") as Handler["_handler"];
    await save(w.ownerCtx, {
      societyId: w.societyId,
      accountId: w.bankId,
      toDate: "2026-05-31",
      bookBalance: 1100,
      actualBalance: 600,
      clearedVoucherNos: ["MR-0001", "PY-0001"],
    });
    await save(w.ownerCtx, {
      societyId: w.societyId,
      accountId: w.bankId,
      toDate: "2026-06-30",
      bookBalance: 1100,
      actualBalance: 1100,
      clearedVoucherNos: ["JV-0001"],
    });
    const ws = await fn(bankReconMod, "workspace")(
      w.ownerCtx,
      {
        societyId: w.societyId,
        accountId: w.bankId,
        fromDate: "2026-05-01",
        toDate: "2026-06-30",
      },
    ) as BankReconStatement;
    expect(ws.entries.every((e) => e.cleared)).toBe(true);
    expect(ws.unclearedDeposits).toBe(0);
    expect(ws.unclearedWithdrawals).toBe(0);
    expect(ws.expectedBankBalance).toBe(1100);
    expect(ws.stated).toBe(true);
    expect(ws.difference).toBe(0);
    // The exact June statement feeds the June data, not May's.
    expect(w.dump("bankReconciliations")).toHaveLength(2);
  });

  test("a LATER statement does not pre-clear entries the earlier date hasn't seen", async () => {
    const w = await seedWorld();
    await fn(bankReconMod, "save")(w.ownerCtx, {
      societyId: w.societyId,
      accountId: w.bankId,
      toDate: "2026-05-31",
      bookBalance: 1100,
      actualBalance: 600,
      clearedVoucherNos: ["MR-0001"],
    });
    const ws = await fn(bankReconMod, "workspace")(
      w.ownerCtx,
      {
        societyId: w.societyId,
        accountId: w.bankId,
        fromDate: "2026-05-01",
        toDate: "2026-05-15",
      },
    ) as BankReconStatement;
    // May-15 view: nothing saved yet at 2026-05-15 — everything pending.
    expect(ws.entries.every((e) => !e.cleared)).toBe(true);
    expect(ws.stated).toBe(false);
    expect(ws.difference).toBeNull();
  });

  test("re-saving the same statement date replaces it — never duplicates", async () => {
    const w = await seedWorld();
    const save = fn(bankReconMod, "save") as Handler["_handler"];
    await save(w.ownerCtx, {
      societyId: w.societyId,
      accountId: w.bankId,
      toDate: "2026-05-31",
      bookBalance: 1100,
      actualBalance: 600,
      clearedVoucherNos: ["MR-0001", "PY-0001"],
    });
    await save(w.ownerCtx, {
      societyId: w.societyId,
      accountId: w.bankId,
      toDate: "2026-05-31",
      bookBalance: 1100,
      actualBalance: 610,
      clearedVoucherNos: ["MR-0001"],
    });
    expect(w.dump("bankReconciliations")).toHaveLength(1);
    const ws = await fn(bankReconMod, "workspace")(
      w.ownerCtx,
      {
        societyId: w.societyId,
        accountId: w.bankId,
        fromDate: "2026-05-01",
        toDate: "2026-05-31",
      },
    ) as BankReconStatement;
    expect(ws.actualBalance).toBe(610);
    expect(ws.entries.find((e) => e.voucherNo === "MR-0001")?.cleared).toBe(true);
    expect(ws.entries.find((e) => e.voucherNo === "PY-0001")?.cleared).toBe(false);
  });
});
