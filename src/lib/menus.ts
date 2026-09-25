import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpen,
  Building2,
  FileInput,
  FileSpreadsheet,
  FileText,
  Home,
  Landmark,
  LayoutDashboard,
  Receipt,
  ShieldCheck,
  TrendingUp,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react";

/**
 * One menu item the software admin can grant or block per user. `nav` mirrors
 * the sidebar; every route belongs to exactly one menu key.
 */
export type MenuKey =
  | "dashboard"
  | "society"
  | "members"
  | "accounts"
  | "tariffs"
  | "member-receipt"
  | "other-receipt"
  | "payment"
  | "journal"
  | "bills"
  | "member-ledger"
  | "general-ledger"
  | "cash-book"
  | "income-expenditure"
  | "balance-sheet"
  | "receipt-payment"
  | "transaction-import"
  | "uploads"
  | "users"
  | // Member self-service portal (flat-bound logins only)
  "portal-home"
  | "portal-ledger"
  | "portal-bills"
  | "portal-receipts"
  | "portal-pay"
  | "portal-profile";

export type MenuSection =
  | "Overview"
  | "Masters"
  | "Transactions"
  | "Reports"
  | "Data"
  | "My Flat";

export type MenuItem = {
  key: MenuKey;
  label: string;
  section: MenuSection;
  path: string;
  icon: LucideIcon;
};

/** Single source of truth for the sidebar and the rights matrix. */
export const MENU_REGISTRY: MenuItem[] = [
  { key: "dashboard", label: "Dashboard", section: "Overview", path: "/dashboard", icon: LayoutDashboard },
  { key: "society", label: "Society Profile", section: "Masters", path: "/app/society", icon: Building2 },
  { key: "members", label: "Members", section: "Masters", path: "/app/members", icon: Users },
  { key: "accounts", label: "Chart of Accounts", section: "Masters", path: "/app/accounts", icon: BookOpen },
  { key: "tariffs", label: "Tariff Schedule", section: "Masters", path: "/app/tariffs", icon: Wallet },
  { key: "member-receipt", label: "Member Receipt", section: "Transactions", path: "/app/member-receipt", icon: Receipt },
  { key: "other-receipt", label: "Other Receipt", section: "Transactions", path: "/app/other-receipt", icon: Banknote },
  { key: "payment", label: "Payment", section: "Transactions", path: "/app/payment", icon: ArrowLeftRight },
  { key: "journal", label: "Journal", section: "Transactions", path: "/app/journal", icon: FileText },
  { key: "bills", label: "Bill Register", section: "Transactions", path: "/app/bills", icon: FileSpreadsheet },
  { key: "member-ledger", label: "Member Ledger", section: "Reports", path: "/app/member-ledger", icon: Users },
  { key: "general-ledger", label: "General Ledger", section: "Reports", path: "/app/general-ledger", icon: BarChart3 },
  { key: "cash-book", label: "Cash Book", section: "Reports", path: "/app/cash-book", icon: Landmark },
  { key: "income-expenditure", label: "Income & Expenditure", section: "Reports", path: "/app/income-expenditure", icon: TrendingUp },
  { key: "balance-sheet", label: "Balance Sheet", section: "Reports", path: "/app/balance-sheet", icon: FileText },
  { key: "receipt-payment", label: "Receipt & Payment", section: "Reports", path: "/app/receipt-payment", icon: Wallet },
  { key: "transaction-import", label: "Transaction Import", section: "Data", path: "/app/transaction-import", icon: FileInput },
  { key: "uploads", label: "Excel Uploads", section: "Data", path: "/app/uploads", icon: FileSpreadsheet },
  { key: "users", label: "Users & Rights", section: "Data", path: "/app/users", icon: ShieldCheck },
];

export const MENU_KEYS = MENU_REGISTRY.map((m) => m.key);

export function menuItem(key: MenuKey): MenuItem | undefined {
  return MENU_REGISTRY.find((m) => m.key === key);
}

/** Path -> menu key, for route guarding (includes bill detail route). */
export const PATH_TO_MENU: Record<string, MenuKey> = Object.fromEntries(
  MENU_REGISTRY.map((m) => [m.path, m.key]),
);

/** Menus a fresh grant gets when the admin doesn't pick any (everything except the rights screen). */
export const DEFAULT_GRANT_MENUS: MenuKey[] = MENU_REGISTRY.filter(
  (m) => m.key !== "users",
).map((m) => m.key);

/**
 * Portal nav for flat-bound member logins — a distinct sidebar experience.
 * Not part of MENU_REGISTRY: society book menus and portal menus never mix.
 */
export const PORTAL_MENUS: MenuItem[] = [
  { key: "portal-home", label: "My Flat", section: "My Flat", path: "/portal", icon: Home },
  { key: "portal-ledger", label: "My Ledger", section: "My Flat", path: "/portal/ledger", icon: BookOpen },
  { key: "portal-bills", label: "My Bills", section: "My Flat", path: "/portal/bills", icon: FileSpreadsheet },
  { key: "portal-receipts", label: "My Receipts", section: "My Flat", path: "/portal/receipts", icon: Receipt },
  { key: "portal-pay", label: "Make Payment", section: "My Flat", path: "/portal/pay", icon: Wallet },
  { key: "portal-profile", label: "My Profile", section: "My Flat", path: "/portal/profile", icon: UserCircle },
];

export const PORTAL_PATHS = new Set(PORTAL_MENUS.map((m) => m.path));

export function portalMenuItem(key: MenuKey): MenuItem | undefined {
  return PORTAL_MENUS.find((m) => m.key === key);
}
