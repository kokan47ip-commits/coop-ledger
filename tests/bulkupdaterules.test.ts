/**
 * Unit tests for the Chart of Accounts bulk "Edit all" validation rules
 * (bun:test) — the pure model backed by src/lib/bulkUpdateRules.ts, which
 * the Convex mutation src/convex/accounts.ts::bulkUpdate throws on.
 */
import { describe, expect, test } from "bun:test";
import {
  batchDuplicateProblem,
  blankFieldProblem,
  crossChartDuplicateProblem,
  groupMismatchProblem,
  isSystemLedgerName,
  systemRenameProblem,
} from "../src/lib/bulkUpdateRules";

describe("bulk update rules", () => {
  describe("system ledger identity", () => {
    test("recognises the three Form N ledgers, case/whitespace-insensitively", () => {
      expect(isSystemLedgerName("Dues from Members")).toBe(true);
      expect(isSystemLedgerName("  dues FROM members ")).toBe(true);
      expect(isSystemLedgerName("Advance from Members")).toBe(true);
      expect(isSystemLedgerName("Income over Expenses")).toBe(true);
      expect(isSystemLedgerName("Dues from Members 2")).toBe(false);
      expect(isSystemLedgerName("Maintenance")).toBe(false);
    });

    test("renaming/re-coding a system ledger is rejected", () => {
      expect(
        systemRenameProblem(
          { name: "Dues from Members", code: "1090" },
          { name: "Dues from Members", code: "1500" },
        ),
      ).toContain("system ledger");
      expect(
        systemRenameProblem(
          { name: "Dues from Members", code: "1090" },
          { name: "Members Dues", code: "1090" },
        ),
      ).toContain("system ledger");
    });

    test("editing a system ledger's opening balance or print no. is allowed", () => {
      // Only identity fields are compared; sibling fields are not part of the guard.
      expect(
        systemRenameProblem(
          { name: "Advance from Members", code: "2990" },
          { name: "Advance from Members", code: "2990" },
        ),
      ).toBe(null);
    });

    test("renaming a normal account is fine", () => {
      expect(
        systemRenameProblem(
          { name: "Garden Maintenance", code: "4090" },
          { name: "Garden Upkeep", code: "4100" },
        ),
      ).toBe(null);
    });
  });

  describe("required fields", () => {
    test("blank code or name rejected, trimmed-only counts as blank", () => {
      expect(blankFieldProblem({ code: "", name: "X" })).toContain("code");
      expect(blankFieldProblem({ code: "   ", name: "X" })).toContain("code");
      expect(blankFieldProblem({ code: "A1", name: "" })).toContain("name");
      expect(blankFieldProblem({ code: "A1", name: "X" })).toBe(null);
    });
  });

  describe("batch duplicate codes", () => {
    test("two rows colliding on the same code is rejected", () => {
      expect(
        batchDuplicateProblem([
          { id: "a", code: "B1", name: "Bank" },
          { id: "b", code: "b1", name: "Cash" }, // case-insensitive
        ]),
      ).toBe("b1");
    });

    test("same row counted once and distinct codes pass", () => {
      expect(
        batchDuplicateProblem([
          { id: "a", code: "B1", name: "Bank" },
          { id: "a", code: "B1", name: "Bank" },
        ]),
      ).toBe(null);
      expect(
        batchDuplicateProblem([
          { id: "a", code: "B1", name: "Bank" },
          { id: "b", code: "C1", name: "Cash" },
        ]),
      ).toBe(null);
    });
  });

  describe("cross-chart duplicate codes", () => {
    const chart = [
      { id: "a", code: "B1", name: "Bank" },
      { id: "z", code: "B1", name: "Bank of India" },
      { id: "y", code: "C9", name: "Cash" },
    ];

    test("editing a code onto an unedited row's code is rejected", () => {
      expect(
        crossChartDuplicateProblem(
          [{ id: "a", code: "c9", name: "Bank" }],
          chart,
        ),
      ).toBe("C9");
    });

    test("rows being edited are skipped, and no collision passes", () => {
      expect(
        crossChartDuplicateProblem(
          [
            { id: "a", code: "B1", name: "Bank" },
            { id: "z", code: "C1", name: "Bank of India" },
          ],
          chart,
        ),
      ).toBe(null);
    });
  });

  describe("group/section consistency", () => {
    const types = new Map([
      ["g-asset", "asset"],
      ["g-expense", "expense"],
    ] as const);
    const groupType = (gid: string) => types.get(gid as "g-asset" | "g-expense");

    test("asset account cannot take an expense group", () => {
      expect(
        groupMismatchProblem(
          { type: "asset" },
          { name: "Bank", groupId: "g-expense" },
          groupType,
        ),
      ).toContain('is a asset account');
    });

    test("matching section and 'no group' pass", () => {
      expect(
        groupMismatchProblem(
          { type: "asset" },
          { name: "Bank", groupId: "g-asset" },
          groupType,
        ),
      ).toBe(null);
      expect(
        groupMismatchProblem({ type: "asset" }, { name: "Bank" }, groupType),
      ).toBe(null);
    });

    test("unknown/deleted group is reported by the mutation separately", () => {
      expect(
        groupMismatchProblem(
          { type: "asset" },
          { name: "Bank", groupId: "g-gone" },
          groupType,
        ),
      ).toBe(null);
    });
  });
});
