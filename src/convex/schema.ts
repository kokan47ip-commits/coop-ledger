import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      /** Software-level admin: manages user rights across all societies. */
      softwareAdmin: v.optional(v.boolean()),
    }).index("email", ["email"]),

    // ---- Housing society accounting ----

    societies: defineTable({
      name: v.string(),
      registrationNo: v.optional(v.string()),
      registrationDate: v.optional(v.string()), // date of registration with the registrar
      address: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      pincode: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      fyStartMonth: v.number(), // 1..12 (April = 4 for Indian societies)
      fyYear: v.optional(v.string()), // display label, e.g. "2025-26"
      fyStartDate: v.optional(v.string()), // explicit current-period start, "YYYY-MM-DD"
      chairmanMemberId: v.optional(v.id("members")),
      secretaryMemberId: v.optional(v.id("members")),
      treasurerMemberId: v.optional(v.id("members")),
      createdBy: v.id("users"),
      // When a society is created by a guest (anonymous) user, a claim code is
      // stored here so the creator can adopt it after signing in with email —
      // guest identities are per-device, but the books must survive the login.
      claimCode: v.optional(v.string()),
      // Guest-created societies also stamp the profile email so ownership can
      // be handed over server-side when that email signs in — from any device,
      // without relying on the creating device's localStorage.
      claimEmail: v.optional(v.string()),
      receivableAccountId: v.optional(v.id("accounts")),
    })
      .index("by_creator", ["createdBy"])
      .index("by_claim_code", ["claimCode"])
      .index("by_claim_email", ["claimEmail"]),

    accounts: defineTable({
      societyId: v.id("societies"),
      code: v.string(),
      name: v.string(),
      type: v.union(
        v.literal("asset"),
        v.literal("liability"),
        v.literal("income"),
        v.literal("expense"),
      ),
      kind: v.optional(
        v.union(v.literal("bank_cash"), v.literal("receivable")),
      ),
      openingBalance: v.number(),
      groupId: v.optional(v.id("accountGroups")),
      /** User-defined printing serial no. — orders this ledger on printed statements. */
      printNo: v.optional(v.string()),
    }).index("by_society", ["societyId"]),

    // Ledger classification groups (e.g. Fixed Assets, Reserve & Surplus) that
    // accounts are filed under for statement presentation.
    accountGroups: defineTable({
      societyId: v.id("societies"),
      code: v.string(),
      name: v.string(),
      type: v.union(
        v.literal("asset"),
        v.literal("liability"),
        v.literal("income"),
        v.literal("expense"),
      ),
      sequence: v.number(), // display order within the statement
    }).index("by_society", ["societyId"]),

    members: defineTable({
      societyId: v.id("societies"),
      code: v.string(),
      name: v.string(),
      flatNo: v.optional(v.string()),
      wing: v.optional(v.string()),
      building: v.optional(v.string()),
      unitType: v.optional(v.string()),
      floor: v.optional(v.string()),
      buildupArea: v.optional(v.number()),
      carpetArea: v.optional(v.number()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      ownershipType: v.optional(
        v.union(v.literal("owner"), v.literal("tenant")),
      ),
      joinDate: v.optional(v.string()),
      openingBalance: v.number(), // opening receivable (positive = member owes)
      openingDate: v.optional(v.string()),
      isActive: v.boolean(),
    })
      .index("by_society", ["societyId"])
      .index("by_society_code", ["societyId", "code"]),

    tariffs: defineTable({
      societyId: v.id("societies"),
      name: v.string(),
      /** Optional short label printed on the member schedule, member ledger
       *  head columns and bills. Falls back to the full name. */
      shortName: v.optional(v.string()),
      accountId: v.id("accounts"),
      amount: v.number(),
      unit: v.optional(v.union(v.literal("flat"), v.literal("member"))),
      isActive: v.boolean(),
      /** User-defined printing serial no. — orders this head on printed bills. */
      printNo: v.optional(v.string()),
    }).index("by_society", ["societyId"]),

    // Per-member tariff amounts, e.g. uploaded from an Excel sheet with flat
    // number, member name and custom tariff amounts in columns.
    memberTariffs: defineTable({
      societyId: v.id("societies"),
      memberId: v.id("members"),
      tariffId: v.id("tariffs"),
      amount: v.number(), // 0 = exempt from this charge
    })
      .index("by_society", ["societyId"])
      .index("by_society_member", ["societyId", "memberId"]),

    bills: defineTable({
      societyId: v.id("societies"),
      billNo: v.string(),
      memberId: v.id("members"),
      period: v.string(), // "YYYY-MM"
      issueDate: v.string(), // "YYYY-MM-DD"
      dueDate: v.string(),
      /** As-on date used to compute principal arrears carried into this bill. */
      arrearsDate: v.optional(v.string()),
      lines: v.array(
        v.object({
          tariffId: v.optional(v.id("tariffs")),
          accountId: v.id("accounts"),
          name: v.string(),
          amount: v.number(),
          /** Serial no. carried from the tariff head at generation time. */
          printNo: v.optional(v.string()),
        }),
      ),
      total: v.number(),
      paidAmount: v.number(),
      status: v.union(
        v.literal("unpaid"),
        v.literal("partial"),
        v.literal("paid"),
      ),
    })
      .index("by_society", ["societyId"])
      .index("by_society_member", ["societyId", "memberId"])
      .index("by_society_period", ["societyId", "period"]),

    vouchers: defineTable({
      societyId: v.id("societies"),
      type: v.union(
        v.literal("member_receipt"),
        v.literal("other_receipt"),
        v.literal("payment"),
        v.literal("journal"),
      ),
      voucherNo: v.string(),
      date: v.string(), // "YYYY-MM-DD"
      memberId: v.optional(v.id("members")),
      mode: v.optional(v.string()),
      bankCashAccountId: v.optional(v.id("accounts")),
      reference: v.optional(v.string()),
      narration: v.optional(v.string()),
      total: v.number(),
      lines: v.array(
        v.object({
          accountId: v.id("accounts"),
          debit: v.number(),
          credit: v.number(),
          note: v.optional(v.string()),
        }),
      ),
      allocations: v.optional(
        v.array(v.object({ billId: v.id("bills"), amount: v.number() })),
      ),
    })
      .index("by_society", ["societyId"])
      .index("by_society_type", ["societyId", "type"])
      .index("by_society_member", ["societyId", "memberId"]),

    counters: defineTable({ key: v.string(), value: v.number() }).index(
      "by_key",
      ["key"],
    ),

    // Per-society user rights. The society creator is the implicit "owner";
    // rows here grant "editor" (entry rights), "viewer" (read-only) or
    // "member" (flat-bound portal) access to other signed-in users, matched
    // by Convex user id or by email.
    membersAccess: defineTable({
      societyId: v.id("societies"),
      userId: v.optional(v.id("users")), // set once the invited user signs up
      email: v.string(), // lower-cased; the invite target's sign-in email
      role: v.union(
        v.literal("editor"),
        v.literal("viewer"),
        // Flat-bound portal login: the member sees only their own flat —
        // ledger, bills, receipts, payment entry and their profile.
        v.literal("member"),
      ),
      /** When role is "member": the flat this login is bound to. */
      memberId: v.optional(v.id("members")),
      /** Menu keys the user may open; empty/missing = all non-admin menus. */
      menus: v.optional(v.array(v.string())),
      grantedBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_society", ["societyId"])
      .index("by_user", ["userId"])
      .index("by_email", ["email"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
