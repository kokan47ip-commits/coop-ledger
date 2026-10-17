import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import {
  applyAllocationToBill,
  claimVoucherNo,
  recomputeBillStatus,
  requireSocietyWrite,
  resolveReceivableAccount,
  societyFyPeriod,
} from "./lib";
import { duplicateMemberError } from "./ownership";

type Result = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  /** Non-fatal explanations (e.g. which sheet column created a new head) shown under the upload details. */
  notes?: string[];
};

/**
 * Normalises an Excel header for flexible matching: strips punctuation/spaces
 * and lowercases, so "Member Code", "member_code" and "MEMBERCODE" all match.
 */
const normHeader = (h: string) => h.replace(/[^a-z0-9]/gi, "").toLowerCase();

function str(row: Record<string, unknown>, keys: string[]): string | undefined {
  // keys are normalized aliases; resolve against the row's actual headers.
  const headerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) headerMap.set(normHeader(k), v);
  for (const k of keys) {
    // Aliases may be raw sheet headers ("Flat No") — normalise them the same
    // way as the map keys, or spaced/punctuated headers never match.
    const raw = headerMap.get(normHeader(k));
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s !== "") return s;
  }
  return undefined;
}

function num(row: Record<string, unknown>, keys: string[]): number | undefined {
  // Resolve keys against the row's ACTUAL headers, normalised the same way as
  // str(): a sheet header like "Opening Balance" must match the alias
  // "openingbalance". (Direct row[k] lookups silently miss spaced headers.)
  const headerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) headerMap.set(normHeader(k), v);
  for (const k of keys) {
    // Same normalisation as str(): raw header aliases must match the
    // normalised map keys or lookups silently return undefined.
    const raw = headerMap.get(normHeader(k));
    if (raw === undefined || raw === null) continue;
    if (String(raw).trim() === "") continue;
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
    await requireSocietyWrite(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const existing = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const byCode = new Map(existing.map((m) => [m.code.toLowerCase(), m]));
    // Live view of the register through this import: after each accepted row
    // it reflects what the DB will hold, so later rows in the SAME sheet
    // cannot re-introduce a defended code or flat.
    const live = existing.map((m) => ({
      id: m._id,
      code: m.code,
      name: m.name,
      wing: m.wing,
      building: m.building,
      flatNo: m.flatNo,
      isActive: m.isActive,
    }));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Skip fully blank rows (common after the last data row in exported sheets).
      if (Object.values(row).every((v) => v === undefined || v === null || String(v).trim() === ""))
        continue;
      const code = str(row, ["code", "membercode", "memberid", "memberno", "membernumber"]);
      const name = str(row, ["name", "membername", "nameofmember", "member", "ownername"]);
      if (!code || !name) {
        result.errors.push(
          `Data row ${i + 1}: missing member code or name. Detected columns: ${Object.keys(row).join(", ") || "none"}.`,
        );
        continue;
      }
      const match = byCode.get(code.toLowerCase());
      // A flat like "A-101" with wing "A" would render as "A-A-101" — strip
      // a leading wing prefix when it duplicates the wing value.
      const rawFlat = str(row, ["flatno", "flat", "flatnumber", "unit", "house", "shop", "premises"]);
      const rawWing = str(row, ["wing", "building", "block"]);
      const flatNo =
        rawFlat && rawWing
          ? rawFlat.replace(new RegExp(`^${rawWing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-/ ]?`, "i"), "")
          : rawFlat;
      // Opening balance is a ledger fact: once set (manually or by an earlier
      // upload), a later upload without that column must NOT reset it to 0.
      // An explicit 0 in the sheet still means "clear to zero".
      const uploadedOpening = num(row, [
        "openingbalance",
        "opening",
        "openingbal",
        "opbalance",
        "opbal",
        "opgbalance",
        "opgbal",
        "ob",
        "balance",
        "outstanding",
        "amountdue",
        "arrears",
        "oldbalance",
        "previousbalance",
        "prevbalance",
        "broughtforward",
        "oparrears",
      ]);
      const data = {
        code,
        name,
        flatNo,
        wing: rawWing,
        phone: str(row, ["phone", "mobile", "contact"]),
        email: str(row, ["email", "emailaddress"]),
        ownershipType: ((): "owner" | "tenant" | undefined => {
          const o = str(row, ["ownershiptype", "ownership", "type"]);
          if (!o) return undefined;
          return o.toLowerCase().startsWith("t") ? "tenant" : "owner";
        })(),
        joinDate: normalizeDate(str(row, ["joindate", "dateofjoin", "joiningdate"])),
        openingBalance:
          uploadedOpening !== undefined ? uploadedOpening : (match?.openingBalance ?? 0),
        openingDate:
          normalizeDate(str(row, ["openingdate", "asof", "ason", "asondate"])) ??
          match?.openingDate ??
          defaultOpeningDate,
        isActive: true,
      };
      // Same duplicate rules as the Members register (unique code, ONE row
      // per active flat) — bulk sheets may not bypass them, or the register
      // would end up with double-billed flats. Refused rows are reported.
      const dupeErr = duplicateMemberError<{ id?: Id<"members"> } & {
        code: string;
        name: string;
        wing?: string | null;
        building?: string | null;
        flatNo?: string | null;
        isActive: boolean;
      }>(live, {
        id: match?._id,
        code: data.code,
        name: data.name,
        wing: data.wing,
        building: undefined,
        flatNo: data.flatNo,
        isActive: true,
      });
      if (dupeErr) {
        result.errors.push(`Data row ${i + 1}: ${dupeErr}`);
        result.skipped++;
        continue;
      }
      if (match) {
        await ctx.db.patch(match._id, data);
        const slot = live.find((m) => m.id === match._id);
        if (slot) {
          slot.code = data.code;
          slot.name = data.name;
          slot.wing = data.wing;
          slot.flatNo = data.flatNo;
        }
        result.updated++;
      } else {
        const insertedId = await ctx.db.insert("members", {
          societyId,
          ...data,
        });
        // Later rows in THIS sheet must see the just-inserted member, or a
        // repeated code/flat could slip through as a second insert.
        live.push({
          id: insertedId,
          code: data.code,
          name: data.name,
          wing: data.wing,
          building: undefined,
          flatNo: data.flatNo,
          isActive: true,
        });
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
    await requireSocietyWrite(ctx, societyId);
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
      const name = str(row, ["name", "tariff", "tariffname", "charge", "head", "type"]);
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
        // Optional printing serial no. for the order of this head on bills.
        printNo: str(row, ["printno", "printserialno", "printserial", "serialno", "serial", "printorder", "srl"]),
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

export const uploadMemberTariffs = mutation({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.record(v.string(), v.any())),
  },
  handler: async (ctx, { societyId, rows }): Promise<Result> => {
    await requireSocietyWrite(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const existingTariffs = await ctx.db
      .query("tariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const existingOverrides = await ctx.db
      .query("memberTariffs")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();

    const fallbackAccount =
      accounts.filter((a) => a.type === "income").sort((a, b) => a.code.localeCompare(b.code))[0];

    // Columns that are identity metadata, not tariff amounts. Matched against
    // the punctuation-stripped, lowercased header ("Sr. No." → "srno").
    const isIdentityColumn = (h: string) =>
      /^(sr|srl|srlno|srno|sno|sl|slno|sn|serial|serialno|printno|printserialno|no|number|code|membercode|memberid|memberno|membernumber|id|wing|building|block|floor|unittype|type|remarks|remark|note|notes|total|totalamount|grandtotal|date|status)$/.test(
        // /gi matters: strip case-insensitively BEFORE lowercasing, or
        // uppercase letters are deleted ("Sr. No." → "ro") and headers like
        // "Flat No" / "Name of Member" never match anywhere downstream.
        h.replace(/[^a-z0-9]/gi, "").toLowerCase(),
      );

    if (rows.length === 0) return result;

    // Identify tariff columns from the first row's keys. Headers are
    // normalised (punctuation/case-insensitive) for detection.
    // /gi is required (see isIdentityColumn above): without it, uppercase
    // letters are stripped before lowercasing — "Flat No" became "lato" and
    // "Name of Member" became "ameofember", so uploads of the app's own
    // template failed with "must contain a Flat No. or Name of Member column".
    const normHeader = (h: string) => h.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const headerKeys = Object.keys(rows[0]);
    const flatKey = headerKeys.find((h) =>
      /^(flatno|flat|flatnumber|unit|house|houseno|housenumber|shop|premises)$/.test(normHeader(h)),
    );
    const nameKey =
      headerKeys.find((h) => {
        const t = normHeader(h);
        return t.includes("name") && (t.includes("member") || t.includes("owner") || t.includes("tenant"));
      }) ?? headerKeys.find((h) => normHeader(h) === "name");
    const tariffKeys = headerKeys.filter(
      (h) => h !== flatKey && h !== nameKey && !isIdentityColumn(h),
    );
    if (tariffKeys.length === 0) {
      result.errors.push(
        `No tariff columns found. Beyond "${flatKey ?? "—"}" and "${nameKey ?? "—"}", every remaining column is treated as a tariff. Detected sheet columns: ${headerKeys.join(" · ") || "none"}.`,
      );
      return result;
    }
    if (!flatKey && !nameKey) {
      // If a flat/name-like header is visibly present but didn't match, the
      // cell likely carries hidden characters or non-standard wording — tell
      // the user exactly what to re-type instead of only listing columns.
      const hint = headerKeys.some((h) =>
        /flat|unit|house|shop|premises|name|member|owner/i.test(h),
      )
        ? ` Your sheet appears to have that column — re-type its header exactly as "Flat No" (or "Name of Member") and try again.`
        : "";
      result.errors.push(
        `Sheet must contain a "Flat No." or "Name of Member" column.${hint} Detected sheet columns: ${headerKeys.join(" · ") || "none"}.`,
      );
      return result;
    }

    // Optional Wing/Building column — combined with the sheet's flat number
    // before matching ("Wing B" + "703" ≡ member wing "B" + flat "703").
    const wingKey = headerKeys.find((h) =>
      /^(wing|building|block)$/.test(normHeader(h)),
    );

    // Resolve (or create) a tariff per column header. Saved head names and
    // sheet headers can differ in case/punctuation/spacing (or carry stray
    // spaces), so match on normalised names first, then a UNIQUE containment
    // match — silently creating a near-duplicate head would split member
    // amounts across two columns of the schedule.
    // /gi matters here (see isIdentityColumn): without it uppercase letters
    // are stripped before lowercasing ("SINKING FUND" → "").
    const normTariffName = (s: string) =>
      s.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
    const note = (msg: string) => {
      (result.notes ??= []).push(msg);
    };
    const findTariff = (header: string): Doc<"tariffs"> | undefined => {
      const target = normTariffName(header);
      if (!target) return undefined;
      const exact = existingTariffs.filter((t) => normTariffName(t.name) === target);
      if (exact.length > 0) {
        // Same-named duplicates can exist from earlier uploads — prefer the
        // active head, then the oldest, and surface the collision.
        const pick = exact.find((t) => t.isActive) ?? exact[0];
        if (exact.length > 1)
          note(
            `Column "${header.trim()}": ${exact.length} same-named tariff heads exist — amounts were saved under "${pick.name}". Delete the duplicates on the Tariff Heads tab.`,
          );
        return pick;
      }
      const contains = existingTariffs.filter((t) => {
        const n = normTariffName(t.name);
        return n.includes(target) || (target.includes(n) && n.length >= 4);
      });
      return contains.length === 1 ? contains[0] : undefined;
    };
    const tariffByKey = new Map<string, Doc<"tariffs">>();
    for (const key of tariffKeys) {
      const tariffName = key.trim().replace(/\s+/g, " ");
      const match = findTariff(key);
      if (match) {
        if (normTariffName(match.name) !== normTariffName(key))
          note(
            `Column "${tariffName}" was mapped to the existing tariff head "${match.name}".`,
          );
        tariffByKey.set(key, match);
      } else {
        if (!fallbackAccount) {
          result.errors.push(
            `Column "${tariffName}": no income account exists to attach the new tariff — add one in Chart of Accounts.`,
          );
          continue;
        }
        const id = await ctx.db.insert("tariffs", {
          societyId,
          name: tariffName,
          accountId: fallbackAccount._id,
          amount: 0,
          unit: "flat",
          isActive: true,
        });
        const created = await ctx.db.get(id);
        if (created) {
          existingTariffs.push(created);
          tariffByKey.set(key, created);
          result.inserted++;
          note(
            `Column "${tariffName}": no existing head matched, so a new tariff head was created (income account "${fallbackAccount.code} — ${fallbackAccount.name}"). If this duplicates an existing head, delete it on the Tariff Heads tab and re-upload.`,
          );
        }
      }
    }

    // Match unit codes regardless of separators/case: "A-101" ≡ "A101" ≡
    // "a 101". Also tries wing+flat ("B" + "703" ≡ "B703") and member code.
    const norm = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
    /** "flat 101", "unit no. 101", "shop-5" → "101"/"5" — numbers only. */
    const digits = (s: string) => s.replace(/\D+/g, "");
    /** "Shri. Ramesh  Kumar" → "ramesh kumar"; drops honorifics/punct. */
    const normName = (s: string) =>
      s
        .replace(/[^a-zA-Z\s]/g, " ")
        .replace(/\b(shri|shree|smt|mr|mrs|ms|dr|late)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const flat = flatKey ? str(row, [flatKey]) : undefined;
      const name = nameKey ? str(row, [nameKey]) : undefined;
      if (!flat && !name) {
        result.errors.push(`Row ${i + 2}: missing flat number and member name.`);
        continue;
      }
      const sheetWing = wingKey ? str(row, [wingKey]) : undefined;
      const flatVariants = [
        ...(flat ? [norm(flat)] : []),
        // Wing column next to Flat No: "B" + "703" → "b703".
        ...(sheetWing && flat ? [norm(sheetWing) + norm(flat)] : []),
        // Wing already typed into the flat cell: "B-703" → also "703".
        ...(flat && digits(flat) !== norm(flat) ? [digits(flat)] : []),
      ];
      const nameVariants = name ? [normName(name)] : [];
      const member =
        (flatVariants.length > 0 &&
          members.find(
            (m) =>
              (m.flatNo &&
                flatVariants.some(
                  (fv) =>
                    fv !== "" &&
                    (fv === norm(m.flatNo ?? "") ||
                      fv === norm(`${m.wing ?? ""}${m.flatNo ?? ""}`) ||
                      // digits-only fallback: "101" ≡ "A-101" / "B/703"
                      (digits(fv) !== "" && digits(fv) === digits(m.flatNo ?? ""))),
                )) ||
              (sheetWing &&
                m.wing &&
                norm(sheetWing) === norm(m.wing) &&
                flat &&
                m.flatNo &&
                norm(flat) === norm(m.flatNo)),
          )) ??
        (flat && members.find((m) => norm(m.code) === norm(flat))) ??
        (nameVariants.length > 0 &&
          members.find(
            (m) =>
              normName(m.name) === nameVariants[0] ||
              // Unique containment: sheet "ramesh kumar patel" matches saved
              // "Ramesh Kumar" when only ONE saved name fits inside it.
              (nameVariants[0].includes(normName(m.name)) &&
                normName(m.name).length >= 4 &&
                members.filter((x) => nameVariants[0].includes(normName(x.name)))
                  .length === 1),
          )) ??
        undefined;
      if (!member) {
        const saved = members
          .slice(0, 6)
          .map((m) => [m.flatNo, m.wing, m.code, m.name].filter(Boolean).join(" / "))
          .join(" · ");
        result.errors.push(
          `Row ${i + 2}: no member matches flat "${flat ?? "—"}"${name ? ` / name "${name}"` : ""}. ` +
            `Saved members look like: ${saved || "none — import members first"}.`,
        );
        continue;
      }

      let rowApplied = 0;
      for (const [key, tariff] of tariffByKey) {
        const amount = num(row, [key]);
        if (amount === undefined) continue; // blank cell → head not charged
        const existing = existingOverrides.find(
          (o) => o.memberId === member._id && o.tariffId === tariff._id,
        );
        if (existing) {
          if (existing.amount !== amount) {
            await ctx.db.patch(existing._id, { amount });
            result.updated++;
          }
        } else {
          const id = await ctx.db.insert("memberTariffs", {
            societyId,
            memberId: member._id,
            tariffId: tariff._id,
            amount,
          });
          existingOverrides.push({ ...(await ctx.db.get(id))! });
          result.inserted++;
        }
        rowApplied++;
      }
      if (rowApplied === 0) {
        result.skipped++;
        // Surface silent skips: the member matched but no amount cell held a
        // number, or every tariff column failed to resolve.
        if (tariffByKey.size > 0) {
          result.errors.push(
            `Row ${i + 2}: matched ${member.name} but no amount cells were filled — enter numbers under each tariff column (blank = skip, 0 = exempt).`,
          );
        } else {
          result.errors.push(
            `Row ${i + 2}: matched ${member.name} but no tariff column could be resolved against the schedule.`,
          );
        }
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
    const society = await requireSocietyWrite(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const allAccounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const receivable = resolveReceivableAccount(
      society?.receivableAccountId
        ? allAccounts.find((a) => a._id === society.receivableAccountId)
        : undefined,
      allAccounts,
    ).receivable;
    const receivableId = receivable._id;
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
      const memberKey = str(row, ["membercode", "code", "member", "memberid", "memberno"]);
      const amount = num(row, ["amount", "received", "paid"]);
      if (Object.values(row).every((v) => v === undefined || v === null || String(v).trim() === ""))
        continue;
      if (!memberKey || amount === undefined || amount <= 0) {
        result.errors.push(`Data row ${i + 1}: missing member code or amount.`);
        continue;
      }
      const member = members.find(
        (m) =>
          m.code.toLowerCase() === memberKey.toLowerCase() ||
          m.name.toLowerCase() === memberKey.toLowerCase() ||
          m.flatNo?.toLowerCase() === memberKey.toLowerCase(),
      );
      if (!member) {
        result.errors.push(
          `Data row ${i + 1}: member "${memberKey}" not found. Detected columns: ${Object.keys(row).join(", ") || "none"}.`,
        );
        continue;
      }
      const bankAccountId =
        accounts.find(
          (a) =>
            a.kind === "bank_cash" &&
            str(row, ["mode", "bank", "account"])?.toLowerCase().includes(a.name.toLowerCase().split(" ")[0] ?? "#"),
        )?._id ?? defaultAccountId;
      const date = normalizeDate(str(row, ["date", "receiptdate", "receiveddate"])) ?? new Date().toISOString().slice(0, 10);
      // Decline receipts dated outside the current financial year.
      const fy = societyFyPeriod(society);
      if (date < fy.from || date > fy.to) {
        result.errors.push(
          `Data row ${i + 1}: receipt date ${date} is outside the financial year (${fy.from} to ${fy.to}) — entry declined.`,
        );
        continue;
      }
      // FIFO settlement across unpaid bills; the self-healing voucher no is
      // claimed at write time so the sheet can never collide with an
      // existing voucher number.
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
        voucherNo: await claimVoucherNo(ctx, societyId, "member_receipt"),
        date,
        memberId: member._id,
        mode: str(row, ["mode", "paymentmode"]),
        bankCashAccountId: bankAccountId,
        reference: str(row, ["reference", "ref", "receiptno", "utr", "utrn", "txn"]),
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
    const society = await requireSocietyWrite(ctx, societyId);
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
      // Decline payments dated outside the current financial year.
      const fy = societyFyPeriod(society);
      if (date < fy.from || date > fy.to) {
        result.errors.push(
          `Row ${i + 2}: payment date ${date} is outside the financial year (${fy.from} to ${fy.to}) — entry declined.`,
        );
        continue;
      }
      await ctx.db.insert("vouchers", {
        societyId,
        type: "payment",
        voucherNo: await claimVoucherNo(ctx, societyId, "payment"),
        date,
        mode: bankName,
        bankCashAccountId: bankAccount._id,
        reference: str(row, ["reference", "ref", "chequeno", "chequeno", "utr", "utrn"]),
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

/**
 * Legacy "TransactionImport" register format — one row per voucher with
 * Voucher No., Date, Voucher type (Receipts/Payments/Journal), Ledger
 * Code/Name, Amount, Cash/Bank, Narration, Cheque No., Chq. Date, Bank Name
 * and ChqClearDate columns.
 *
 * Ledger resolution follows the legacy rules and the sheet's Ledger Name is
 * display-only — the system always supplies the real name:
 *  • Receipts  — Ledger Code is the member's FLAT NO (wing + flat, e.g.
 *    "B703" / "B-104-A"); the member is fetched from the register. Falls back
 *    to member code/name, then to an account (non-member income).
 *  • Payments  — Ledger Code is a ledger CODE from Chart of Accounts; a
 *    member flat/code as a last resort books a refund to that member.
 *  • Journal   — member flat/code first (receivable contra), else account.
 *  • Cash/Bank — the bank/cash ACCOUNT CODE; the account's real name comes
 *    from the system. The sheet's Bank Name text is display-only.
 *
 * Voucher numbers are always generated fresh — the sheet's numbers are not
 * reused.
 */
/** A fully validated row, ready to be written once the WHOLE file passes. */
type PlannedTxn = {
  type: "member_receipt" | "other_receipt" | "payment" | "journal";
  memberId?: Id<"members">;
  lines: { accountId: Id<"accounts">; debit: number; credit: number; note?: string }[];
  bankId: Id<"accounts">;
  bankName?: string;
  date: string;
  amount: number;
  chequeNo?: string;
  narrationFull?: string;
  allocations?: { billId: Id<"bills">; amount: number }[];
};

export const uploadTransactions = mutation({
  args: {
    societyId: v.id("societies"),
    rows: v.array(v.record(v.string(), v.any())),
    defaultType: v.union(
      v.literal("receipt"),
      v.literal("payment"),
      v.literal("journal"),
    ),
    defaultBankCashAccountId: v.id("accounts"),
  },
  handler: async (
    ctx,
    { societyId, rows, defaultType, defaultBankCashAccountId },
  ): Promise<Result> => {
    const society = await requireSocietyWrite(ctx, societyId);
    const result: Result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const bills = await ctx.db
      .query("bills")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    const receivable = resolveReceivableAccount(
      society.receivableAccountId
        ? accounts.find((a) => a._id === society.receivableAccountId)
        : undefined,
      accounts,
    ).receivable;
    const receivableId = receivable._id;
    const fy = societyFyPeriod(society);
    const defaultBank =
      accounts.find((a) => a._id === defaultBankCashAccountId) ??
      accounts.find((a) => a.kind === "bank_cash");
    // Every row is validated FIRST and collected as a plan; only when the
    // whole file passes does anything get written. A file with a bad row is
    // never partially imported — the rows stay editable in the
    // TransactionImport screen instead.
    const planned: PlannedTxn[] = [];

    const findAccountBy = (
      code?: string,
      name?: string,
    ): Doc<"accounts"> | undefined => {
      if (code) {
        const c = code.toLowerCase().trim();
        const a = accounts.find((a) => a.code.toLowerCase() === c);
        if (a) return a;
      }
      if (name) {
        const n = name.toLowerCase().trim();
        return accounts.find((a) => a.name.toLowerCase() === n);
      }
      return undefined;
    };
    const findMemberBy = (
      code?: string,
      name?: string,
    ): Doc<"members"> | undefined => {
      if (code) {
        const c = code.toLowerCase().trim();
        const m = members.find((m) => m.code.toLowerCase() === c);
        if (m) return m;
      }
      if (name) {
        const n = name.toLowerCase().trim();
        return members.find(
          (m) => m.name.toLowerCase() === n || m.flatNo?.toLowerCase() === n,
        );
      }
      return undefined;
    };
    /** Matches a sheet flat code like "B703", "B-104-A" or "SHOP05" against
     *  the member's wing + flatNo regardless of separators/case. */
    const normFlat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const findMemberByFlat = (flat?: string): Doc<"members"> | undefined => {
      if (!flat) return undefined;
      const f = normFlat(flat);
      return members.find((m) => {
        if (!m.flatNo) return false;
        return (
          normFlat(m.flatNo) === f || normFlat(`${m.wing ?? ""}${m.flatNo}`) === f
        );
      });
    };
    const findBankBy = (text?: string): Doc<"accounts"> | undefined => {
      if (!text) return undefined;
      const t = text.toLowerCase().trim();
      return accounts.find(
        (a) =>
          a.kind === "bank_cash" &&
          (a.name.toLowerCase().includes(t) || t.includes(a.name.toLowerCase())),
      );
    };
    /** Cash/Bank column carries a bank/cash ACCOUNT CODE — the system
     *  supplies the account name. */
    const findBankByCode = (code?: string): Doc<"accounts"> | undefined => {
      if (!code) return undefined;
      const c = code.toLowerCase().trim();
      return accounts.find((a) => a.kind === "bank_cash" && a.code.toLowerCase() === c);
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (Object.values(row).every((v) => v === undefined || v === null || String(v).trim() === ""))
        continue;
      const typeRaw = (
        str(row, ["vouchertype", "vouchers", "voucher", "type", "vchtype"]) ?? ""
      ).toLowerCase();
      if (typeRaw.startsWith("contra")) {
        result.errors.push(
          `Row ${i + 2}: contra entries are not supported — record them as Journal.`,
        );
        continue;
      }
      const kind: "receipt" | "payment" | "journal" = typeRaw.startsWith("receipt")
        ? "receipt"
        : typeRaw.startsWith("payment") || typeRaw.startsWith("pay")
          ? "payment"
          : typeRaw.startsWith("journal") || typeRaw.startsWith("jv")
            ? "journal"
            : defaultType;
      const ledgerCode = str(row, ["ledgercode", "code", "acctcode", "accountcode"]);
      const ledgerName = str(row, [
        "ledgername",
        "ledger",
        "name",
        "account",
        "particulars",
        "party",
      ]);
      const amount = num(row, ["amount", "amt", "value"]);
      if ((!ledgerCode && !ledgerName) || amount === undefined || amount <= 0) {
        result.errors.push(
          `Row ${i + 2}: needs a ledger (code or name) and a positive amount.`,
        );
        continue;
      }
      const date = normalizeDate(str(row, ["date", "voucherdate"]));
      if (!date) {
        result.errors.push(`Row ${i + 2}: date missing or unreadable (use DD/MM/YYYY).`);
        continue;
      }
      if (date < fy.from || date > fy.to) {
        result.errors.push(
          `Row ${i + 2}: date ${date} is outside the financial year (${fy.from} to ${fy.to}) — skipped.`,
        );
        continue;
      }
      const cashBank = str(row, ["cashbank", "bankcash", "mode", "paidfrom", "receivedin"]);
      const bankName = str(row, ["bankname", "bank"]);
      const chequeNo = str(row, ["chequeno", "chqno", "reference", "ref"]);
      const narration = str(row, ["narration", "remarks", "note"]);
      // Cash/Bank is the bank/cash ACCOUNT CODE; name-text sheets still work
      // through the fuzzy-name fallback. A present-but-unmatched code declines
      // the row — the sheet's Bank Name text is display-only and never trusted.
      const bank =
        findBankByCode(cashBank) ??
        findBankBy(cashBank) ??
        findBankBy(bankName) ??
        (cashBank ? undefined : defaultBank);
      if (!bank) {
        result.errors.push(
          `Row ${i + 2}: no bank/cash account matches "${cashBank}" — check the code in Chart of Accounts.`,
        );
        continue;
      }
      const narrationFull = narration || undefined;

      // Resolution by book type (see handler doc): receipts treat the code
      // column as the member's flat no; payments treat it as a ledger code;
      // journal tries member first, then account.
      let member: Doc<"members"> | undefined;
      let account: Doc<"accounts"> | undefined;
      if (kind === "payment") {
        account = findAccountBy(ledgerCode, ledgerName);
        member = account
          ? undefined
          : (findMemberByFlat(ledgerCode) ?? findMemberBy(ledgerCode, ledgerName));
      } else {
        member = findMemberByFlat(ledgerCode) ?? findMemberBy(ledgerCode, ledgerName);
        account = member ? undefined : findAccountBy(ledgerCode, ledgerName);
      }
      let type: "member_receipt" | "other_receipt" | "payment" | "journal";
      let memberId: Id<"members"> | undefined;
      let lines: { accountId: Id<"accounts">; debit: number; credit: number; note?: string }[];
      if (kind === "receipt") {
        if (member) {
          type = "member_receipt";
          memberId = member._id;
          lines = [
            { accountId: bank._id, debit: amount, credit: 0 },
            { accountId: receivableId, debit: 0, credit: amount, note: cashBank },
          ];
        } else if (account) {
          type = "other_receipt";
          lines = [
            { accountId: bank._id, debit: amount, credit: 0 },
            { accountId: account._id, debit: 0, credit: amount, note: cashBank },
          ];
        } else {
          result.errors.push(
            `Row ${i + 2}: no member matches flat no/code "${[ledgerCode, ledgerName].filter(Boolean).join(" ")}" — add the member or correct the flat no.`,
          );
          continue;
        }
      } else if (kind === "payment") {
        type = "payment";
        if (member) {
          // Payment to a member = refund against their receivable.
          memberId = member._id;
          lines = [
            { accountId: receivableId, debit: amount, credit: 0 },
            { accountId: bank._id, debit: 0, credit: amount },
          ];
        } else if (account) {
          lines = [
            { accountId: account._id, debit: amount, credit: 0 },
            { accountId: bank._id, debit: 0, credit: amount },
          ];
        } else {
          result.errors.push(
            `Row ${i + 2}: no ledger matches code/name "${[ledgerCode, ledgerName].filter(Boolean).join(" ")}" — add it in Chart of Accounts first.`,
          );
          continue;
        }
      } else {
        // Journal: Dr ledger, Cr contra from the Cash/Bank or Bank Name column.
        type = "journal";
        const contra =
          findBankByCode(cashBank) ??
          findBankBy(cashBank) ??
          findBankBy(bankName) ??
          findAccountBy(cashBank, undefined) ??
          findAccountBy(undefined, cashBank) ??
          findAccountBy(undefined, bankName);
        if (!contra) {
          result.errors.push(
            `Row ${i + 2}: journal needs a contra ledger in the Cash/Bank or Bank Name column.`,
          );
          continue;
        }
        if (member) {
          memberId = member._id;
          lines = [
            { accountId: receivableId, debit: amount, credit: 0 },
            { accountId: contra._id, debit: 0, credit: amount },
          ];
        } else if (account) {
          lines = [
            { accountId: account._id, debit: amount, credit: 0 },
            { accountId: contra._id, debit: 0, credit: amount },
          ];
        } else {
          result.errors.push(
            `Row ${i + 2}: no ledger matches "${[ledgerCode, ledgerName].filter(Boolean).join(" ")}".`,
          );
          continue;
        }
      }

      // FIFO settlement against unpaid bills for member receipts — computed
      // at validation time, applied only after the whole file validates.
      let allocations: { billId: Id<"bills">; amount: number }[] | undefined;
      if (type === "member_receipt" && member) {
        const memberBills = bills
          .filter((b) => b.memberId === member._id && b.paidAmount < b.total)
          .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
        let remaining = amount;
        const allocs: { billId: Id<"bills">; amount: number }[] = [];
        for (const b of memberBills) {
          if (remaining <= 0) break;
          const take = Math.min(b.total - b.paidAmount, remaining);
          allocs.push({ billId: b._id, amount: take });
          remaining -= take;
        }
        if (allocs.length > 0) allocations = allocs;
      }
      planned.push({
        type,
        memberId,
        lines,
        bankId: bank._id,
        bankName: bank.name,
        date,
        amount,
        chequeNo,
        narrationFull,
        allocations,
      });
    }
    // ANY bad row aborts the WHOLE upload — the books never receive a
    // partially-imported file. Fix the flagged rows in the
    // TransactionImport grid and upload the file again.
    if (result.errors.length > 0) {
      // ConvexError (not plain Error) so the client receives the value and
      // the TransactionImport screen can show every row's reason on screen
      // instead of the generic "Server Error Called by client".
      throw new ConvexError(
        `${result.errors.length} row(s) invalid — nothing was imported. Fix the flagged rows in the TransactionImport grid and upload the file again.\n${result.errors.join("\n")}`,
      );
    }
    for (const p of planned) {
      const voucherNo = await claimVoucherNo(ctx, societyId, p.type);
      await ctx.db.insert("vouchers", {
        societyId,
        type: p.type,
        voucherNo,
        date: p.date,
        memberId: p.memberId,
        mode: p.bankName,
        bankCashAccountId: p.bankId,
        reference: p.chequeNo,
        narration: p.narrationFull,
        total: p.amount,
        lines: p.lines,
        allocations: p.allocations,
      });
      if (p.allocations) {
        for (const a of p.allocations) {
          // Fresh read: earlier plans in this batch may have settled the
          // same bill, so balances must never come from a stale snapshot.
          const bill = await ctx.db.get(a.billId);
          if (bill) await applyAllocationToBill(ctx, bill, a.amount);
        }
      }
      result.inserted++;
    }
    return result;
  },
});
