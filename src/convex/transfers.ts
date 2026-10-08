import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, MutationCtx } from "./_generated/server";
import {
  assertInFy,
  nextNumber,
  pad,
  requireSociety,
  requireSocietyWrite,
} from "./lib";

/**
 * Flat Transfer utility: one transaction that archives the outgoing member
 * (never deletes — bills, receipts and ledger history are preserved), admits
 * the incoming member on the same flat, and writes an append-only audit
 * trail. The outstanding can be settled before transfer (default, refuses to
 * run while dues remain) or carried forward as the new member's opening
 * balance.
 */

type TransferEvent = { at: number; byName: string; action: string; details: string };

async function netOutstanding(
  ctx: MutationCtx,
  bills: Doc<"bills">[],
  openingBalance: number,
): Promise<number> {
  // Net standing outstanding = unpaid bill balances + opening receivable.
  // A credit (negative) opening balance reduces dues the same way the
  // member ledger reports it.
  let unpaid = 0;
  for (const b of bills) {
    const fresh = (await ctx.db.get(b._id)) ?? b;
    unpaid += fresh.total - fresh.paidAmount;
  }
  return Math.round((unpaid + openingBalance) * 100) / 100;
}

export const perform = mutation({
  args: {
    societyId: v.id("societies"),
    /** Flat/unit being transferred (matched against member rows). */
    outgoingMemberId: v.id("members"),
    duesHandling: v.union(v.literal("settled"), v.literal("carry_forward")),
    transferDate: v.string(),
    /** leave empty to admit a brand-new member row below */
    newMemberId: v.optional(v.id("members")),
    newMember: v.optional(
      v.object({
        code: v.string(),
        name: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        familyInfo: v.optional(v.string()),
        vehicleNo: v.optional(v.string()),
        joinDate: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      societyId,
      outgoingMemberId,
      duesHandling,
      transferDate,
      newMemberId,
      newMember,
      note,
    },
  ) => {
    const society = await requireSocietyWrite(ctx, societyId);
    assertInFy(society, transferDate, "Flat transfer");

    const outgoing = await ctx.db.get(outgoingMemberId);
    if (!outgoing || outgoing.societyId !== societyId)
      throw new Error("Outgoing member not found in this society.");
    if (!outgoing.isActive)
      throw new Error("The selected member is already archived/inactive.");

    // The incoming row, when reused, must be a different, active member.
    if (newMemberId && newMemberId === outgoingMemberId)
      throw new Error("Outgoing and incoming member are the same record.");

    const flatLabel = [outgoing.wing, outgoing.flatNo].filter(Boolean).join("-") || outgoing.code;

    const byName = (await ctx.db.get(society.createdBy))?.name ?? "Office";
    const events: TransferEvent[] = [];
    const now = Date.now();

    // --- dues -------------------------------------------------------------
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society_member", (q) =>
        q.eq("societyId", societyId).eq("memberId", outgoingMemberId),
      )
      .collect();
    const outstanding = await netOutstanding(ctx, bills, outgoing.openingBalance);

    let carryForward = 0;
    if (duesHandling === "settled") {
      if (outstanding !== 0)
        throw new Error(
          `Outstanding dues of ₹${outstanding.toLocaleString("en-IN")} must be settled before transfer — record receipts or an adjustment journal first, or choose "Carry forward to new member".`,
        );
      events.push({
        at: now,
        byName,
        action: "dues_settled",
        details: `Outstanding dues verified settled (₹0) before transfer.`,
      });
    } else {
      carryForward = outstanding;
      events.push({
        at: now,
        byName,
        action: "dues_carried_forward",
        details: `Net outstanding ₹${outstanding.toLocaleString("en-IN")} carried forward to the incoming member as opening balance.`,
      });
    }

    // --- archive outgoing --------------------------------------------------
    const archivedCode = `${outgoing.code}-T${now.toString(36)}`;
    await ctx.db.patch(outgoingMemberId, {
      isActive: false,
      code: archivedCode,
      phone: outgoing.phone,
      familyInfo: outgoing.familyInfo,
      vehicleNo: outgoing.vehicleNo,
    });
    events.push({
      at: now,
      byName,
      action: "outgoing_archived",
      details: `Member ${outgoing.name} (${outgoing.code}) archived as ${archivedCode}; ledger, bills and receipts preserved.`,
    });

    // --- admit incoming ----------------------------------------------------
    let incomingId: Id<"members">;
    if (newMemberId) {
      const incoming = await ctx.db.get(newMemberId);
      if (!incoming || incoming.societyId !== societyId)
        throw new Error("Incoming member not found in this society.");
      if (!incoming.isActive)
        throw new Error("The selected incoming member is not active.");
      await ctx.db.patch(newMemberId, {
        flatNo: outgoing.flatNo,
        wing: outgoing.wing,
        building: outgoing.building,
        joinDate: newMember?.joinDate ?? transferDate,
      });
      events.push({
        at: now,
        byName,
        action: "existing_member_moved_in",
        details: `Flat ${flatLabel} assigned to existing member ${incoming.name} (${incoming.code}).`,
      });
      incomingId = newMemberId;
    } else {
      if (!newMember?.name?.trim())
        throw new Error("Enter the incoming owner's name (or pick an existing member).");
      if (!newMember.code?.trim())
        throw new Error("Enter a member code for the incoming owner.");
      const dup = await ctx.db
        .query("members")
        .withIndex("by_society_code", (q) =>
          q.eq("societyId", societyId).eq("code", newMember.code),
        )
        .first();
      if (dup) throw new Error(`Member code "${newMember.code}" is already in use.`);
      incomingId = await ctx.db.insert("members", {
        societyId,
        code: newMember.code.trim(),
        name: newMember.name.trim(),
        flatNo: outgoing.flatNo,
        wing: outgoing.wing,
        building: outgoing.building,
        unitType: outgoing.unitType,
        floor: outgoing.floor,
        buildupArea: outgoing.buildupArea,
        carpetArea: outgoing.carpetArea,
        phone: newMember.phone,
        email: newMember.email,
        ownershipType: outgoing.ownershipType,
        familyInfo: newMember.familyInfo,
        vehicleNo: newMember.vehicleNo,
        joinDate: newMember.joinDate ?? transferDate,
        // Carried dues become the buyer's receivable opening balance.
        openingBalance: carryForward,
        isActive: true,
      });
      events.push({
        at: now,
        byName,
        action: "new_member_admitted",
        details: `New member ${newMember.name.trim()} (${newMember.code.trim()}) admitted on flat ${flatLabel}.`,
      });
    }

    // --- transfer record ---------------------------------------------------
    const n = await nextNumber(ctx, `${societyId}:transfer`);
    const transferNo = `TR-${pad(n)}`;
    await ctx.db.insert("flatTransfers", {
      societyId,
      transferNo,
      transferDate,
      flatNo: outgoing.flatNo ?? "",
      wing: outgoing.wing,
      building: outgoing.building,
      outgoingMemberId,
      outstandingAtTransfer: outstanding,
      duesHandling,
      newMemberId: incomingId,
      events,
      note,
      createdById: (await getAuthUserId(ctx)) ?? undefined,
      createdAt: now,
    });
    events.push({
      at: now,
      byName,
      action: "transfer_recorded",
      details: `Transfer ${transferNo} recorded for compliance.`,
    });

    return { transferNo, outstanding, carryForward, archivedCode };
  },
});

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    await requireSociety(ctx, societyId);
    const rows = await ctx.db
      .query("flatTransfers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    // Resolve the member names once so the register reads cleanly.
    const out = [];
    for (const t of rows) {
      const outgoing = await ctx.db.get(t.outgoingMemberId);
      const incoming = await ctx.db.get(t.newMemberId);
      out.push({
        ...t,
        outgoingName: outgoing?.name ?? "(archived)",
        outgoingCode: outgoing?.code,
        incomingName: incoming?.name ?? "(missing)",
        incomingCode: incoming?.code,
      });
    }
    return out;
  },
});

export const get = query({
  args: { societyId: v.id("societies"), id: v.id("flatTransfers") },
  handler: async (ctx, { societyId, id }) => {
    await requireSociety(ctx, societyId);
    const t = await ctx.db.get(id);
    if (!t || t.societyId !== societyId) return null;
    const outgoing = await ctx.db.get(t.outgoingMemberId);
    const incoming = await ctx.db.get(t.newMemberId);
    return { ...t, outgoing, incoming };
  },
});
