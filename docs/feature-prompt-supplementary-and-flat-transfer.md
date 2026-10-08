# Feature Prompt & Architecture: Supplementary Bill & Flat Transfer Utility

Status: implemented in this app (spec below = as-built design).

## 1. Supplementary Bill Generation

**Objective** — bill special charges (special repairs, emergency funds, event
contributions, penalties) outside the regular monthly maintenance cycle,
without disturbing the tariff schedule.

**Data model** (extends `bills`) — supplementary bills are *first-class bills*,
so every existing consumer (member ledger, member dues/defaulter reports,
receipt allocation, bill register, statements) keeps working with zero special
casing:

| Field | Type | Meaning |
|---|---|---|
| `billKind` | `"regular" \| "supplementary"` | Discriminates the cycle; absent/`regular` = existing flow. |
| `category` | string | Supplementary category: repair / event / penalty / emergency / other. |
| `period` | issue month `"YYYY-MM"` | Keeps period-based tooling consistent. |
| `dueDate`, `lines`, `total`, `paidAmount`, `status` | as regular | Receipts allocate against them identically. |

Numbering: separate series `SB-0001…` (counter key `<societyId>:supp`) so
supplementary bills never collide with or disturb `BILL-xxxx`.

**Backend** (`src/convex/supplementary.ts`, owner/editor only):

- `create` — one bill per selected member: `memberIds[]`, `description`,
  `category`, `amount`, `issueDate`, `dueDate`, optional `accountId` (income
  ledger; defaults to Other Income / first income account). Validates dates
  inside the financial year (`assertInFy`), active members only, amount > 0.
- `list` / `listByMember` — queries for the register page and portal needs.
- Outstanding = `total − paidAmount`; unpaid supplementary dues flow into
  Member Dues (defaulter) and the member ledger automatically because they are
  ordinary bill rows.

**Invoice** — the document builder emits a clearly labelled
**"SUPPLEMENTARY BILL"** (with category line and description) in PDF / Word /
Print, and the card supports Email (Resend) and WhatsApp (Cloud API) delivery
through the existing `emailer.sendDocs` / `whatsapp.sendWhatsapp` actions —
the exact pipeline regular bills use.

**Integration points**
- *Member Ledger*: bill rows appear alongside regular bills (narration shows
  the supplementary description).
- *Bill Register / Printing Hub*: filter tabs **Regular / Supplementary /
  All**; supplementary rows are badged.
- *Member Dues (defaulter report)*: unpaid supplementary dues are part of the
  standing outstanding and remain separated in the dues drill-down by kind.
- *Receipts*: Member Receipt search + allocation pick supplementary bills up
  automatically (they are bills); Transaction list filters can distinguish
  receipts settled against them via their allocations.

## 2. Flat Transfer Utility

**Objective** — one screen to transfer ownership: outgoing member archived,
new member admitted on the same flat, dues either carried forward or settled
first, everything audited.

**Data model**

`flatTransfers` table:
`{ societyId, transferNo, flatNo, wing, building, outgoingMemberId,
outstandingAtTransfer, duesHandling: "carry_forward" | "settled",
transferDate, newMember: { memberId, code, name, phone, email, familyInfo,
vehicleNo, joinDate }, events: [{ at, byName, action, details }],
createdById, createdAt }`

`members` gains `familyInfo`, `vehicleNo` (used for the incoming member's
profile and printed on the certificate).

**Semantics (the important accounting decisions)**

- The outgoing member is **archived, never deleted**: `isActive = false`, code
  suffixed `-T{n}` (uniqueness preserved). All bills, receipts, vouchers and
  ledger history stay exactly where they are and remain printable — financial
  history is preserved forever.
- Dues handling:
  - **`settled`** (default): refuses the transfer while the outgoing member's
    net outstanding ≠ 0, telling the office to record receipts (or an
    adjustment journal) first.
  - **`carry_forward`**: the net outstanding at transfer date becomes the new
    member's `openingBalance` (positive = owes; a credit balance stays a
    credit). The outgoing member's ledger is untouched so both sides reconcile
    — the carry-forward amount is written into the transfer's audit trail.
- Audit trail: every step (archival, dues handling, admission) appends to
  `events`; the record is immutable from the UI.
- Ownership certificate: printable/exportable (PDF / Word / Print) digital
  record — society header, outgoing → incoming member table, flat details,
  dues statement, transfer no./date, auditor trail summary.
- Notifications: after transfer, Email / WhatsApp can send the certificate to
  the incoming member through the shared messaging actions.

**Backend** (`src/convex/transfers.ts`):
- `perform` (mutation) — all-or-nothing Convex transaction: validates flat and
  members, computes outstanding, archives outgoing, inserts the new member
  (or reuses a provided `newMemberId`), writes the transfer row + events.
- `list`, `get` — register + certificate rendering.

## 3. Notifications & module wiring recap

| Trigger | Channel | Implementation |
|---|---|---|
| Supplementary bill issued | PDF/Word/Print, Email, WhatsApp | shared bill-doc + `emailer.sendDocs` / `whatsapp.sendWhatsapp` |
| Flat transfer completed | Certificate PDF/Word/Print, Email, WhatsApp | certificate doc + shared messaging actions |

Member Management (archived/incoming member rows, `isActive`) and Accounting
(member opening balances, receivable totals via bills) are updated by the
single `transfers.perform` mutation — one transaction, no drift.

## UI surfaces

| Route | Page |
|---|---|
| `/app/supplementary-bills` | Supplementary Bills (create + register + send) |
| `/app/flat-transfer` | Flat Transfer (perform + audit register + certificate) |

Both are owner/editor surfaces; viewers read, members are not affected.
