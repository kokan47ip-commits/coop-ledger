export function formatMoney(n: number | undefined | null): string {
  const v = n ?? 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function formatINR(n: number | undefined | null): string {
  return `₹ ${formatMoney(n)}`;
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const idx = Number(m) - 1;
  return `${months[idx] ?? m} ${y}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Financial year start month (April default) and ISO helpers for pickers. */
export function fyStartISO(fyStartMonth = 4): string {
  const now = new Date();
  const y = now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String(fyStartMonth).padStart(2, "0")}-01`;
}

export function fyEndISO(fyStartMonth = 4): string {
  const now = new Date();
  const y = now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() + 1 : now.getFullYear();
  const endMonth = fyStartMonth - 1 === 0 ? 12 : fyStartMonth - 1;
  const lastDay = new Date(y, endMonth, 0).getDate();
  return `${y}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
}

/** Display label like "2025-26" for a financial year starting in the given month. */
export function fyYearLabel(fyStartMonth = 4): string {
  const start = fyStartISO(fyStartMonth);
  const end = fyEndISO(fyStartMonth);
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  return endYear > startYear ? `${startYear}-${String(endYear).slice(2)}` : `${startYear}`;
}

/**
 * Effective current financial-period boundaries, preferring the explicit
 * start date and year label stored on the society profile.
 */
export function effectiveFyPeriod(society?: {
  fyStartMonth?: number;
  fyYear?: string;
  fyStartDate?: string;
} | null): { from: string; to: string; label: string } {
  const fyStartMonth = society?.fyStartMonth ?? 4;
  if (society?.fyStartDate) {
    const start = society.fyStartDate.slice(0, 10);
    const endDate = new Date(start);
    endDate.setFullYear(endDate.getFullYear() + 1);
    endDate.setDate(endDate.getDate() - 1);
    const to = endDate.toISOString().slice(0, 10);
    const label =
      society.fyYear ??
      fyYearLabelFromRange(start, to);
    return { from: start, to, label };
  }
  return { from: fyStartISO(fyStartMonth), to: fyEndISO(fyStartMonth), label: society?.fyYear ?? fyYearLabel(fyStartMonth) };
}

function fyYearLabelFromRange(from: string, to: string): string {
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  return endYear > startYear ? `${startYear}-${String(endYear).slice(2)}` : `${startYear}`;
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export const VOUCHER_TYPE_LABEL = {
  member_receipt: "Member Receipt",
  other_receipt: "Other Receipt",
  payment: "Payment Voucher",
  journal: "Journal Voucher",
} as const;

export const ACCOUNT_TYPE_LABEL = {
  asset: "Assets",
  liability: "Liabilities",
  income: "Income",
  expense: "Expenses",
} as const;
