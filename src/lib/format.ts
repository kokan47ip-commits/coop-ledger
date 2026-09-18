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
