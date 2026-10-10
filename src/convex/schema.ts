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
      /** Outbound messaging preferences (Email & WhatsApp settings tab). */
      messagingReplyTo: v.optional(v.string()),
      messagingWhatsappMode: v.optional(
        v.union(v.literal("template"), v.literal("session")),
      ),
      messagingSenderName: v.optional(v.string()),
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
      /** Bank/cash account that online (UPI gateway) payments settle into. */
      upiSettlementAccountId: v.optional(v.id("accounts")),
      /**
       * The society's UPI ID (VPA) that members pay into — powers the
       * per-member portal QR codes and the QR printed on bills. No gateway:
       * money lands directly in the society's UPI account and the office
       * records the receipt.
       */
      upiVpa: v.optional(v.string()),
      /**
       * Stable late-fee / interest rate (% PER MONTH on the outstanding
       * balance) applied when bills are generated. A society-level setting:
       * it only changes when the office edits it here (or in the generate
       * dialog, which persists its value) — never silently per generation.
       * 1.5 % p.m. ≈ 18 % per annum.
       */
      lateFeePercent: v.optional(v.number()),
      /**
       * Master-society chart sharing: this society's ledgers/groups were
       * cloned from the master (whose id is stored here) and stay in sync —
       * new ledgers/groups added to the master flow into every linked
       * society automatically (no balances, ever — chart structure only).
       */
      masterSocietyId: v.optional(v.id("societies")),
      /**
       * Billing frequency: how many months one regular bill covers. Tariff
       * amounts are per month; bills multiply them by this factor (2 =
       * bi-monthly, 3 = quarterly, 6 = half-yearly, 12 = yearly). Same
       * society setting drives the register UI's expectation that generation
       * starts on cycle-anchor months. Default 1 = monthly.
       */
      billingFrequency: v.optional(
        v.union(
          v.literal(1),
          v.literal(2),
          v.literal(3),
          v.literal(6),
          v.literal(12),
        ),
      ),
    })
      .index("by_creator", ["createdBy"])
      .index("by_claim_code", ["claimCode"])
      .index("by_claim_email", ["claimEmail"])
      .index("by_master", ["masterSocietyId"]),

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
      /**
       * Chart-sync provenance: masterSocietyId + masterKey tie this account
       * to its source ledger in the master society, so master-side additions
       * land (idempotently) on every linked society.
       */
      masterSocietyId: v.optional(v.id("societies")),
      masterKey: v.optional(v.string()), // master account _id (as string key)
      origin: v.optional(v.union(
        v.literal("master"),
        v.literal("local"),
      )),
    }).index("by_society", ["societyId"]).index("by_master_key", ["masterSocietyId", "masterKey"]),

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
      /** Chart-sync provenance (see accounts). */
      masterSocietyId: v.optional(v.id("societies")),
      masterKey: v.optional(v.string()),
      origin: v.optional(v.union(
        v.literal("master"),
        v.literal("local"),
      )),
    }).index("by_society", ["societyId"]).index("by_master_key", ["masterSocietyId", "masterKey"]),

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
      /** Resident family members info (used on transfer certificates). */
      familyInfo: v.optional(v.string()),
      /** Vehicle number(s) — shown on member profile / certificate. */
      vehicleNo: v.optional(v.string()),
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
      /**
       * Months this bill covers (1 = monthly). Billed amounts are the
       * per-month tariff × this factor; the printed period label spans it.
       * Carried per bill so later changes to the society's billing frequency
       * never rewrite history.
       */
      monthsPerCycle: v.optional(v.number()),
      /** "supplementary" = billed outside the regular maintenance cycle. */
      billKind: v.optional(
        v.union(v.literal("regular"), v.literal("supplementary")),
      ),
      /** Supplementary category (repair / event / penalty / …). */
      category: v.optional(v.string()),
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
      /** Set when this receipt was auto-posted from an online UPI payment. */
      upiPaymentId: v.optional(v.id("upiPayments")),
    })
      .index("by_society", ["societyId"])
      .index("by_society_type", ["societyId", "type"])
      .index("by_society_member", ["societyId", "memberId"]),

    counters: defineTable({ key: v.string(), value: v.number() }).index(
      "by_key",
      ["key"],
    ),

    /**
     * One online (UPI) payment initiated by a member from the portal. The
     * gateway (Razorpay) notifies us by webhook; when the payment is captured
     * the row is posted as a member receipt voucher — debiting the society's
     * UPI settlement bank/cash account and crediting the member's receivable
     * ledger, with the bill allocations settled at the same time.
     */
    upiPayments: defineTable({
      societyId: v.id("societies"),
      memberId: v.id("members"),
      /** Portal login that created the payment — ownership checks. */
      createdById: v.id("users"),
      amount: v.number(), // rupees, two decimals
      /** created → awaiting payment; posted → receipt in the books;
       *  captured → money received but not yet posted (office action);
       *  cancelled → member closed the checkout / gateway reported failure. */
      status: v.union(
        v.literal("created"),
        v.literal("posted"),
        v.literal("captured"),
        v.literal("cancelled"),
      ),
      provider: v.literal("razorpay"),
      providerOrderId: v.optional(v.string()),
      providerPaymentId: v.optional(v.string()),
      providerMethod: v.optional(v.string()),
      allocations: v.array(
        v.object({ billId: v.id("bills"), amount: v.number() }),
      ),
      /** Part of the amount not tied to any bill — an advance on the ledger. */
      advanceAmount: v.number(),
      voucherId: v.optional(v.id("vouchers")),
      voucherNo: v.optional(v.string()),
      failureReason: v.optional(v.string()),
      createdAt: v.number(),
      postedAt: v.optional(v.number()),
    })
      .index("by_society", ["societyId"])
      .index("by_society_member", ["societyId", "memberId"])
      .index("by_provider_order", ["providerOrderId"]),

    /**
     * A payment/entry the member entered at the portal by cash, cheque or
     * bank transfer. Never posts to the books by itself: it waits in the
     * office queue until an authorised office login (owner/editor — the
     * secretary, treasurer, chairman or accountant) passes it, which creates
     * the member-receipt voucher and applies the bill allocations.
     */
    paymentSubmissions: defineTable({
      societyId: v.id("societies"),
      memberId: v.id("members"),
      /** Portal login that submitted the entry. */
      createdById: v.id("users"),
      /** Date the member says the payment was made ("YYYY-MM-DD"). */
      date: v.string(),
      /** cash | cheque | bank (portal payment mode for manual entries). */
      mode: v.string(),
      /** Cash/bank account the member said the payment went into. */
      bankCashAccountId: v.id("accounts"),
      reference: v.optional(v.string()),
      memberNote: v.optional(v.string()),
      amount: v.number(), // rupees, two decimals
      /** Advance part: amount above the selected bill allocations. */
      advanceAmount: v.number(),
      allocations: v.array(
        v.object({ billId: v.id("bills"), amount: v.number() }),
      ),
      /** pending → awaiting office approval; posted → voucher created;
       *  rejected → office declined, visible to the member with a reason. */
      status: v.union(
        v.literal("pending"),
        v.literal("posted"),
        v.literal("rejected"),
      ),
      voucherId: v.optional(v.id("vouchers")),
      voucherNo: v.optional(v.string()),
      reviewedById: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      reviewNote: v.optional(v.string()),
      /** Set when the member edited the entry while it was still pending. */
      editedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_society", ["societyId"])
      .index("by_society_member", ["societyId", "memberId"]),

    // Per-society user rights. The society creator is the implicit "owner";
    // rows here grant "editor" (entry rights), "viewer" (read-only) or
    // "member" (flat-bound portal) access to other signed-in users, matched
    // by Convex user id or by email.
    // Flat ownership transfer records: one row per who-sold-to-whom event.
    // Preserves the archived member's financial history (their bills,
    // receipts and vouchers are never deleted) while documenting dues
    // handling, the admitted buyer and an append-only compliance trail.
    flatTransfers: defineTable({
      societyId: v.id("societies"),
      /** Transfer serial no. TR-0001… per society. */
      transferNo: v.string(),
      transferDate: v.string(), // "YYYY-MM-DD"
      flatNo: v.string(),
      wing: v.optional(v.string()),
      building: v.optional(v.string()),
      /** Archived (isActive=false) member who sold/leaves the flat. */
      outgoingMemberId: v.id("members"),
      /** Net outstanding of the outgoing member at transfer time. */
      outstandingAtTransfer: v.number(),
      /** carry the dues to the buyer or demand settlement first. */
      duesHandling: v.union(
        v.literal("settled"),
        v.literal("carry_forward"),
      ),
      /** Admitted member row for the incoming owner. */
      newMemberId: v.id("members"),
      /** Immutable compliance audit trail (append-only). */
      events: v.array(
        v.object({
          at: v.number(),
          byName: v.string(),
          action: v.string(),
          details: v.string(),
        }),
      ),
      note: v.optional(v.string()),
      createdById: v.optional(v.id("users")),
      createdAt: v.number(),
    }).index("by_society", ["societyId"]),

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
