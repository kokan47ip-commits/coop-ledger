import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * READ-ONLY diagnostic census (no auth — CLI/admin use only, read-only).
 * Reports every account, every society with ownership/claim binding and data
 * counts, and every access grant, so a "my data disappeared" report can be
 * traced to the identity the data is actually stored under.
 */
export const dump = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const societies = await ctx.db.query("societies").collect();
    const grants = await ctx.db.query("membersAccess").collect();
    const members = await ctx.db.query("members").collect();
    const vouchers = await ctx.db.query("vouchers").collect();
    const bills = await ctx.db.query("bills").collect();
    const accounts = await ctx.db.query("accounts").collect();
    const tariffs = await ctx.db.query("tariffs").collect();

    const emailOf = (userId?: string) =>
      users.find((u) => u._id === userId)?.email ?? "(unknown user)";

    return {
      generatedAt: new Date().toISOString(),
      accounts: users.map((u) => ({
        email: u.email ?? "(no email — guest)",
        isAnonymous: u.isAnonymous === true,
        softwareAdmin: u.softwareAdmin === true,
        createdAt: new Date(u._creationTime).toISOString(),
      })),
      societies: societies.map((s) => ({
        name: s.name,
        ownerEmail: emailOf(s.createdBy),
        claimEmail: s.claimEmail ?? null,
        hasClaimCode: !!s.claimCode,
        claimCode: s.claimCode ?? null,
        createdAt: new Date(s._creationTime).toISOString(),
        members: members.filter((m) => m.societyId === s._id).length,
        vouchers: vouchers.filter((v) => v.societyId === s._id).length,
        bills: bills.filter((b) => b.societyId === s._id).length,
        accounts: accounts.filter((a) => a.societyId === s._id).length,
        tariffs: tariffs.filter((t) => t.societyId === s._id).length,
      })),
      grants: grants.map((g) => ({
        society: societies.find((s) => s._id === g.societyId)?.name ?? "?",
        email: g.email,
        role: g.role,
        boundToAccount: !!g.userId,
      })),
      totals: {
        users: users.length,
        societies: societies.length,
        members: members.length,
        vouchers: vouchers.length,
        bills: bills.length,
      },
    };
  },
});
