import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useSociety } from "@/components/SocietyContext";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  LogOut,
  Plus,
  Receipt,
  Repeat,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";

type NavItem = { to: string; label: string; icon: ReactNode };

type NavGroup = {
  title: string;
  icon?: ReactNode;
  collapsible?: boolean;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
    ],
  },
  {
    title: "Masters",
    icon: <FolderOpen className="size-4" />,
    collapsible: true,
    items: [
      { to: "/app/society", label: "Society Profile", icon: <Building2 className="size-4" /> },
      { to: "/app/members", label: "Members", icon: <Users className="size-4" /> },
      { to: "/app/accounts", label: "Chart of Accounts", icon: <BookOpen className="size-4" /> },
      { to: "/app/tariffs", label: "Tariff Schedule", icon: <Wallet className="size-4" /> },
    ],
  },
  {
    title: "Transactions",
    icon: <Repeat className="size-4" />,
    collapsible: true,
    items: [
      { to: "/app/member-receipt", label: "Member Receipt", icon: <Receipt className="size-4" /> },
      { to: "/app/other-receipt", label: "Other Receipt", icon: <Banknote className="size-4" /> },
      { to: "/app/payment", label: "Payment", icon: <ArrowLeftRight className="size-4" /> },
      { to: "/app/journal", label: "Journal", icon: <FileText className="size-4" /> },
      { to: "/app/bills", label: "Bill Register", icon: <FileSpreadsheet className="size-4" /> },
    ],
  },
  {
    title: "Reports",
    icon: <BarChart3 className="size-4" />,
    collapsible: true,
    items: [
      { to: "/app/member-ledger", label: "Member Ledger", icon: <Users className="size-4" /> },
      { to: "/app/general-ledger", label: "General Ledger", icon: <BookOpen className="size-4" /> },
      { to: "/app/cash-book", label: "Cash Book", icon: <Landmark className="size-4" /> },
      { to: "/app/income-expenditure", label: "Income & Expenditure", icon: <TrendingUp className="size-4" /> },
      { to: "/app/balance-sheet", label: "Balance Sheet", icon: <FileText className="size-4" /> },
      { to: "/app/receipt-payment", label: "Receipt & Payment", icon: <Wallet className="size-4" /> },
    ],
  },
  {
    title: "Data",
    items: [
      { to: "/app/uploads", label: "Excel Uploads", icon: <FileSpreadsheet className="size-4" /> },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/app/society": "Society Profile",
  "/app/members": "Members",
  "/app/accounts": "Chart of Accounts",
  "/app/tariffs": "Tariff Schedule",
  "/app/member-receipt": "Member Receipt",
  "/app/other-receipt": "Other Receipt",
  "/app/payment": "Payment Voucher",
  "/app/journal": "Journal Voucher",
  "/app/bills": "Bill Register",
  "/app/member-ledger": "Member Ledger",
  "/app/general-ledger": "General Ledger",
  "/app/cash-book": "Cash Book",
  "/app/income-expenditure": "Income & Expenditure",
  "/app/balance-sheet": "Balance Sheet",
  "/app/receipt-payment": "Receipt & Payment",
  "/app/uploads": "Excel Uploads",
};

function navGroupHasActive(group: NavGroup, pathname: string) {
  return group.items.some(
    (i) => pathname === i.to || pathname.startsWith(`${i.to}/`),
  );
}

const navLinkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all",
    isActive
      ? "bg-gradient-to-r from-primary to-violet-500 font-medium text-white shadow-lg shadow-indigo-950/40 ring-1 ring-white/20 ring-inset"
      : "text-sidebar-foreground/65 hover:bg-white/[0.07] hover:text-sidebar-foreground",
  );

function SocietySwitcher() {
  const { societies, society, setActiveId } = useSociety();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between gap-2 rounded-lg px-2 font-normal text-sidebar-foreground hover:bg-white/[0.07] hover:text-sidebar-foreground"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="brand-gradient flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide text-white shadow-md shadow-indigo-950/50 ring-1 ring-white/20 ring-inset">
              IAS
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {society?.name ?? "No society selected"}
              </span>
              <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/50">
                Imamm Accounting
              </span>
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-sidebar-foreground/60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Client societies</DropdownMenuLabel>
        {societies.map((s) => (
          <DropdownMenuItem
            key={s._id}
            onClick={() => setActiveId(s._id)}
            className={cn(society?._id === s._id && "bg-primary/[0.08] text-primary")}
          >
            <Building2 className="mr-2 size-4" />
            <span className="truncate">{s.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/society?new=1" className="cursor-pointer">
            <Plus className="mr-2 size-4" /> Onboard a new society
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const { societyId, society, isLoading, isGuest } = useSociety();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      NAV.filter((g) => g.collapsible).map((g) => [
        g.title,
        navGroupHasActive(g, location.pathname),
      ]),
    ),
  );

  // Keep the group holding the current page expanded as the user navigates.
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const g of NAV) {
        if (
          g.collapsible &&
          navGroupHasActive(g, location.pathname) &&
          !next[g.title]
        ) {
          next[g.title] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location.pathname]);

  const title =
    PAGE_TITLES[location.pathname] ??
    (location.pathname.startsWith("/app/bills/")
      ? "Bill View"
      : location.pathname.startsWith("/app/vouchers/")
        ? "Voucher View"
        : "Accounting");

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const isSetupRoute = location.pathname === "/app/society";

  const initials = (user?.name ?? user?.email ?? "IA")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  if (!isLoading && !societyId && !isSetupRoute) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="max-w-md space-y-4">
          <span className="brand-gradient mx-auto flex size-12 items-center justify-center rounded-xl text-xs font-bold tracking-wide text-white shadow-lg shadow-primary/40">
            IAS
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            Set up your first client society
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Create a society profile to open its books — the standard chart of
            accounts is generated automatically, ready for bills and vouchers.
          </p>
        </div>
        <Button asChild size="lg" className="px-8">
          <Link to="/app/society?new=1">
            <Plus className="size-4" /> Create society
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-hidden border-r border-white/[0.06] bg-sidebar text-sidebar-foreground shadow-2xl shadow-indigo-950/30 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/40 via-primary/10 to-transparent" />
        <div className="relative flex h-16 items-center border-b border-white/10 px-3">
          <SocietySwitcher />
        </div>
        <nav className="relative flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
          {NAV.map((group) => {
            if (!group.collapsible) {
              return (
                <div key={group.title} className="space-y-0.5 pb-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={navLinkCls}
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              );
            }
            const open = openGroups[group.title] ?? false;
            const hasActive = navGroupHasActive(group, location.pathname);
            return (
              <div key={group.title}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => ({
                      ...prev,
                      [group.title]: !prev[group.title],
                    }))
                  }
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                    hasActive
                      ? "text-sidebar-foreground"
                      : "text-sidebar-foreground/75 hover:bg-white/[0.07] hover:text-sidebar-foreground",
                  )}
                >
                  {group.icon}
                  {group.title}
                  <span className="ml-auto flex items-center gap-1.5">
                    {hasActive && !open && (
                      <span className="brand-gradient size-1.5 rounded-full shadow-[0_0_8px] shadow-primary/70" />
                    )}
                    <ChevronDown
                      className={cn(
                        "size-4 text-sidebar-foreground/50 transition-transform",
                        open && "rotate-180",
                      )}
                    />
                  </span>
                </button>
                {open && (
                  <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className={navLinkCls}
                      >
                        {item.icon}
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="relative border-t border-white/10 p-3">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="brand-gradient flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-md shadow-indigo-950/50">
                {initials || "IA"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name ?? user?.email ?? "Signed in"}</p>
                <p className="truncate text-xs text-sidebar-foreground/55">
                  {user?.email ?? "Account"}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
          >
            <LogOut className="size-4" />
            Logout
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-indigo-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <span className="text-lg leading-none">≡</span>
          </Button>
          <div className="flex items-center gap-2.5">
            <span className="brand-gradient size-2 rounded-full shadow-[0_0_10px] shadow-primary/60" />
            <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {society?.registrationNo && (
              <span className="hidden rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-[11px] font-medium text-primary sm:inline">
                Reg. {society.registrationNo}
              </span>
            )}
            <span className="brand-text hidden text-[11px] font-semibold uppercase tracking-[0.14em] md:inline">
              Imamm Accounting Solutions
            </span>
          </div>
        </header>
        <main className="flex-1 px-4 py-8 lg:px-10">
          {isGuest && (
            <div className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-900 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:from-amber-950/50 dark:to-orange-950/30 dark:text-amber-200">
              <p>
                You are in guest preview. Everything you enter is kept only on
                this device until you sign in with your email — which carries
                your societies and books to any PC you log in from.
              </p>
              <Button asChild variant="outline" size="sm" className="shrink-0 border-amber-600/40 text-amber-900 hover:border-amber-600/60 hover:bg-amber-100/60 hover:text-amber-900 dark:text-amber-200 dark:hover:bg-amber-950/60 dark:hover:text-amber-100">
                <Link to="/auth">Sign in with email</Link>
              </Button>
            </div>
          )}
          {isLoading ? null : <Outlet />}
        </main>
      </div>
      <Separator className="hidden" />
    </div>
  );
}

export default AppLayout;
