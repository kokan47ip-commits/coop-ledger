import { v } from "convex/values";
import { query } from "./_generated/server";
import {
  computeAccountLedger,
  computeBalanceSheet,
  computeCashBook,
  computeIncomeExpenditure,
  computeMemberLedger,
  computeReceiptPayment,
  computeTrialBalance,
  loadSocietyData,
} from "./reports";

export const generalLedger = query({
  args: {
    societyId: v.id("societies"),
    accountId: v.id("accounts"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, accountId, fromDate, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    const account = data.accounts.find((a) => a._id === accountId) ?? null;
    const rows = computeAccountLedger(data, accountId, fromDate, toDate);
    return { account, rows };
  },
});

export const memberLedger = query({
  args: {
    societyId: v.id("societies"),
    memberId: v.id("members"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, memberId, fromDate, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    const member = data.members.find((m) => m._id === memberId) ?? null;
    const rows = computeMemberLedger(data, memberId, fromDate, toDate);
    return { member, rows };
  },
});

/** Cash/Bank Book register: sections per bank-cash account with To/By narrations. */
export const cashBook = query({
  args: {
    societyId: v.id("societies"),
    fromDate: v.string(),
    toDate: v.string(),
    accountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, { societyId, fromDate, toDate, accountId }) => {
    const data = await loadSocietyData(ctx, societyId);
    return computeCashBook(data, fromDate, toDate, accountId);
  },
});

/** Running balance of one account up to and including a date (debit-positive). */
export const accountBalance = query({
  args: {
    societyId: v.id("societies"),
    accountId: v.id("accounts"),
    asOf: v.string(),
  },
  handler: async (ctx, { societyId, accountId, asOf }) => {
    const data = await loadSocietyData(ctx, societyId);
    const account = data.accounts.find((a) => a._id === accountId);
    if (!account) return { balance: 0, debitNature: true };
    const rows = computeAccountLedger(data, accountId, "0000-01-01", asOf);
    const openingNet =
      account.type === "asset" || account.type === "expense"
        ? account.openingBalance
        : -account.openingBalance;
    const balance = rows.reduce((s, r) => s + r.debit - r.credit, openingNet);
    return {
      balance,
      debitNature: account.type === "asset" || account.type === "expense",
    };
  },
});

export const trialBalance = query({
  args: {
    societyId: v.id("societies"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, fromDate, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    return computeTrialBalance(data, fromDate, toDate);
  },
});

export const incomeExpenditure = query({
  args: {
    societyId: v.id("societies"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, fromDate, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    return computeIncomeExpenditure(data, fromDate, toDate);
  },
});

export const balanceSheet = query({
  args: { societyId: v.id("societies"), toDate: v.string() },
  handler: async (ctx, { societyId, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    return computeBalanceSheet(data, toDate);
  },
});

export const receiptPayment = query({
  args: {
    societyId: v.id("societies"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, fromDate, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    return computeReceiptPayment(data, fromDate, toDate);
  },
});

export const dashboard = query({
  args: {
    societyId: v.id("societies"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { societyId, fromDate, toDate }) => {
    const data = await loadSocietyData(ctx, societyId);
    const tb = await computeTrialBalance(data, fromDate, toDate);
    const ie = computeIncomeExpenditure(data, fromDate, toDate);
    const bs = computeBalanceSheet(data, toDate);
    const rp = computeReceiptPayment(data, fromDate, toDate);
    const activeMembers = data.members.filter((m) => m.isActive).length;
    const outstanding = bs.assets
      .filter((a) => a.name.toLowerCase().includes("receivable"))
      .reduce((s, a) => s + a.amount, 0);
    const recentVouchers = [...data.vouchers]
      .sort((a, b) =>
        a.date === b.date
          ? b.voucherNo.localeCompare(a.voucherNo)
          : b.date.localeCompare(a.date),
      )
      .slice(0, 6)
      .map((v) => {
        const member = v.memberId
          ? data.members.find((m) => m._id === v.memberId)
          : undefined;
        return {
          id: v._id,
          date: v.date,
          voucherNo: v.voucherNo,
          type: v.type,
          total: v.total,
          memberName: member?.name ?? null,
        };
      });
    return {
      memberCount: activeMembers,
      billCount: data.bills.length,
      voucherCount: data.vouchers.length,
      outstanding,
      totalIncome: ie.totalIncome,
      totalExpenditure: ie.totalExpenditure,
      surplus: ie.surplus,
      cashOnHand: rp.closingCash,
      trialBalanceTotal: tb.reduce((s, r) => s + r.debit, 0),
      recentVouchers,
    };
  },
});
