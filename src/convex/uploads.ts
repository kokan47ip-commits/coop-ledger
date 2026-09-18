import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import {
  applyAllocationToBill,
  nextNumber,
  pad,
  recomputeBillStatus,
  requireSociety,
  VOUCHER_PREFIX,
} from "./lib";

type Result = { inserted: number; updated: number; skipped: number; errors: string[] };

function str(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const raw = row[k];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s !== "") return s;
  }
  return undefined;
}

function num(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const raw = row[k];
    if (raw === undefined || raw === null || raw === "") continue;
    const s = String(raw).replace(/[₹,\s]/g, "");
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return undefined;
}

export const uploadMembers = mutation({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.record(v.string(), v.any())),
    defaultOpeningDate: v.string(),
  },
  handler: async (ctx, { societyId, rows, defaultOpeningDate }): Promise<Result> => {
    await requireSociety(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const existing = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const byCode = new Map(existing.map((m) => [m.code.toLowerCase(), m]));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const code = str(row, ["code", "membercode", "member_code", "member id", "memberid"]);
      const name = str(row, ["name", "membername", "member_name"]);
      if (!code || !name) {
        result.errors.push(`Row ${i + 2}: missing member code or name.`);
        continue;
      }
      const match = byCode.get(code.toLowerCase());
      const data = {
        code,
        name,
        flatNo: str(row, ["flatno", "flat_no", "flat", "unit"]),
        wing: str(row, ["wing", "building", "block"]),
        phone: str(row, ["phone", "mobile", "contact"]),
        email: str(row, ["email", "emailaddress"]),
        ownershipType: ((): "owner" | "tenant" | undefined => {
          const o = str(row, ["ownershiptype", "ownership", "type"]);
          if (!o) return undefined;
          return o.toLowerCase().startsWith("t") ? "tenant" : "owner";
        })(),
        joinDate: normalizeDate(str(row, ["joindate", "join_date"])),
        openingBalance: num(row, ["openingbalance", "opening_balance", "opening", "balance", "outstanding"]) ?? 0,
        openingDate:
          normalizeDate(str(row, ["openingdate", "opening_date", "asof", "as_on"])) ??
          defaultOpeningDate,
        isActive: true,
      };
      if (match) {
        await ctx.db.patch(match._id, data);
        result.updated++;
      } else {
        await ctx.db.insert("members", { societyId, ...data });
        result.inserted++;
      }
    }
    return result;
  },
});

export const uploadTariffs = mutation({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.record(v.string(), v.any())),
  },
  handler: async (ctx, { societyId, rows }): Promise<Result> => {
    await requireSociety(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const existingTariffs = await ctx.db
      .query("tariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const findAccount = (needle: string | undefined): Doc<"accounts"> | undefined => {
      if (!needle) return undefined;
      const lower = needle.toLowerCase().trim();
      return accounts.find(
        (a) =>
          a.code.toLowerCase() === lower ||
          a.name.toLowerCase() === lower ||
          a.name.toLowerCase().includes(lower) ||
          lower.includes(a.name.toLowerCase()),
      );
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = str(row, ["name", "tariff", "tariffname", "tariff_name", "charge", "head"]);
      const amount = num(row, ["amount", "rate", "charge"]);
      if (!name || amount === undefined) {
        result.errors.push(`Row ${i + 2}: missing tariff name or amount.`);
        continue;
      }
      const account =
        findAccount(str(row, ["account", "accountcode", "accountname", "ledger", "incomeaccount"])) ??
        findAccount(name);
      if (!account) {
        result.errors.push(`Row ${i + 2}: no matching income account for "${name}".`);
        continue;
      }
      const unitRaw = str(row, ["unit", "basis"])?.toLowerCase();
      const unit = unitRaw?.startsWith("member") ? ("member" as const) : ("flat" as const);
      const match = existingTariffs.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      const data = {
        name,
        accountId: account._id,
        amount,
        unit,
        isActive: true,
      };
      if (match) {
        await ctx.db.patch(match._id, data);
        result.updated++;
      } else {
        await ctx.db.insert("tariffs", { societyId, ...data });
        result.inserted++;
      }
    }
    return result;
  },
});

export const uploadReceipts = mutation({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.record(v.string(), v.any())),
    defaultAccountId: v.id("accounts"),
  },
  handler: async (ctx, { societyId, rows, defaultAccountId }): Promise<Result> => {
    await requireSociety(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const society = await ctx.db.get(societyId);
    const allAccounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const receivableId =
      society?.receivableAccountId ??
      allAccounts.find((a) => a.kind === "receivable")?._id;
    if (!receivableId)
      throw new Error(
        "No Members Receivable account found — add one in Chart of Accounts first.",
      );
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const memberKey = str(row, ["membercode", "member_code", "code", "member", "memberid"]);
      const amount = num(row, ["amount", "received", "paid"]);
      if (!memberKey || amount === undefined || amount <= 0) {
        result.errors.push(`Row ${i + 2}: missing member code or amount.`);
        continue;
      }
      const member = members.find(
        (m) =>
          m.code.toLowerCase() === memberKey.toLowerCase() ||
          m.name.toLowerCase() === memberKey.toLowerCase() ||
          m.flatNo?.toLowerCase() === memberKey.toLowerCase(),
      );
      if (!member) {
        result.errors.push(`Row ${i + 2}: member "${memberKey}" not found.`);
        continue;
      }
      const bankAccountId =
        accounts.find(
          (a) =>
            a.kind === "bank_cash" &&
            str(row, ["mode", "bank", "account"])?.toLowerCase().includes(a.name.toLowerCase().split(" ")[0] ?? "#"),
        )?._id ?? defaultAccountId;
      const date = normalizeDate(str(row, ["date", "receiptdate", "receiveddate"])) ?? new Date().toISOString().slice(0, 10);
      const n = await nextNumber(ctx, `${societyId}:voucher:member_receipt`);

      // Allocate FIFO across unpaid bills of the member
      const memberBills = bills
        .filter((b) => b.memberId === member._id && b.paidAmount < b.total)
        .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
      let remaining = amount;
      const allocations: { billId: Id<"bills">; amount: number }[] = [];
      for (const b of memberBills) {
        if (remaining <= 0) break;
        const need = b.total - b.paidAmount;
        const take = Math.min(need, remaining);
        allocations.push({ billId: b._id, amount: take });
        remaining -= take;
      }

      await ctx.db.insert("vouchers", {
        societyId,
        type: "member_receipt",
        voucherNo: `${VOUCHER_PREFIX.member_receipt}-${pad(n)}`,
        date,
        memberId: member._id,
        mode: str(row, ["mode", "paymentmode"]),
        bankCashAccountId: bankAccountId,
        reference: str(row, ["reference", "ref", "receiptno", "utrn", "txn"]),
        narration: str(row, ["narration", "remarks", "note"]),
        total: amount,
        lines: [
          { accountId: bankAccountId, debit: amount, credit: 0 },
          { accountId: receivableId, debit: 0, credit: amount, note: str(row, ["mode"]) },
        ],
        allocations: allocations.length > 0 ? allocations : undefined,
      });
      for (const a of allocations) {
        const bill = bills.find((b) => b._id === a.billId)!;
        await applyAllocationToBill(ctx, bill, a.amount);
      }
      result.inserted++;
    }
    void recomputeBillStatus;
    return result;
  },
});

export const uploadPayments = mutation({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.record(v.string(), v.any())),
    defaultBankCashAccountId: v.id("accounts"),
  },
  handler: async (ctx, { societyId, rows, defaultBankCashAccountId }): Promise<Result> => {
    await requireSociety(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const findAccount = (needle: string | undefined): Doc<"accounts"> | undefined => {
      if (!needle) return undefined;
      const lower = needle.toLowerCase().trim();
      return accounts.find(
        (a) =>
          a.code === lower ||
          a.name.toLowerCase() === lower ||
          a.name.toLowerCase().includes(lower) ||
          lower.includes(a.name.toLowerCase()),
      );
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const amount = num(row, ["amount", "paid", "payment"]);
      const expenseName = str(row, ["account", "ledger", "expense", "head", "paidto", "particulars"]);
      if (amount === undefined || amount <= 0 || !expenseName) {
        result.errors.push(`Row ${i + 2}: missing amount or expense account.`);
        continue;
      }
      const expenseAccount = findAccount(expenseName);
      if (!expenseAccount) {
        result.errors.push(`Row ${i + 2}: no account matches "${expenseName}".`);
        continue;
      }
      const bankName = str(row, ["bank", "mode", "paidfrom", "bankaccount"]);
      const bankAccount =
        accounts.find(
          (a) =>
            a.kind === "bank_cash" &&
            bankName !== undefined &&
            a.name.toLowerCase().includes(bankName.toLowerCase()),
        ) ?? accounts.find((a) => a._id === defaultBankCashAccountId);
      if (!bankAccount) {
        result.errors.push(`Row ${i + 2}: no bank/cash account available.`);
        continue;
      }
      const date =
        normalizeDate(str(row, ["date", "paymentdate"])) ??
        new Date().toISOString().slice(0, 10);
      const n = await nextNumber(ctx, `${societyId}:voucher:payment`);
      await ctx.db.insert("vouchers", {
        societyId,
        type: "payment",
        voucherNo: `${VOUCHER_PREFIX.payment}-${pad(n)}`,
        date,
        mode: bankName,
        bankCashAccountId: bankAccount._id,
        reference: str(row, ["reference", "ref", "chequeno", "utrn"]),
        narration: str(row, ["narration", "remarks", "note"]),
        total: amount,
        lines: [
          { accountId: expenseAccount._id, debit: amount, credit: 0 },
          { accountId: bankAccount._id, debit: 0, credit: amount },
        ],
        allocations: undefined,
      });
      result.inserted++;
    }
    return result;
  },
});
