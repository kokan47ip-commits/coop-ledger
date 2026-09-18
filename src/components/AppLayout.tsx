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
  BookOpen,
  Building2,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Plus,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";

type NavItem = { to: string; label: string; icon: ReactNode };

type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
    ],
  },
  {
    title: "Masters",
    items: [
      { to: "/app/society", label: "Society Profile", icon: <Building2 className="size-4" /> },
      { to: "/app/members", label: "Members", icon: <Users className="size-4" /> },
      { to: "/app/accounts", label: "Chart of Accounts", icon: <BookOpen className="size-4" /> },
      { to: "/app/tariffs", label: "Tariff Schedule", icon: <Wallet className="size-4" /> },
    ],
  },
  {
    title: "Transactions",
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
    items: [
      { to: "/app/member-ledger", label: "Member Ledger", icon: <Users className="size-4" /> },
      { to: "/app/general-ledger", label: "General Ledger", icon: <BookOpen className="size-4" /> },
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
  "/app/income-expenditure": "Income & Expenditure",
  "/app/balance-sheet": "Balance Sheet",
  "/app/receipt-payment": "Receipt & Payment",
  "/app/uploads": "Excel Uploads",
};

function SocietySwitcher() {
  const { societies, society, setActiveId } = useSociety();
  return (
    <DropdownMenu>        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between gap-2 px-2 font-normal text-foreground"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-none bg-foreground text-[9px] font-semibold tracking-wide text-background">
                IAS
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{society?.name ?? "No society selected"}</span>
                <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Imamm Accounting
                </span>
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Client societies</DropdownMenuLabel>
        {societies.map((s) => (
          <DropdownMenuItem
            key={s._id}
            onClick={() => setActiveId(s._id)}
            className={cn(society?._id === s._id && "bg-accent")}
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

  if (!isLoading && !societyId && !isSetupRoute) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="max-w-md space-y-4">
          <span className="mx-auto flex size-9 items-center justify-center rounded-none bg-foreground text-[10px] font-semibold tracking-wide text-background">
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
        <Button asChild className="rounded-none px-8">
          <Link to="/app/society?new=1">
            <Plus className="size-4" /> Create society
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center border-b px-3">
          <SocietySwitcher />
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6">
          {NAV.map((group) => (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name ?? user?.email ?? "Signed in"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email ?? "Account"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={handleSignOut}
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <span className="text-lg leading-none">≡</span>
          </Button>
          <h1 className="text-sm font-medium tracking-tight">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            {society?.registrationNo && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Reg. {society.registrationNo}
              </span>
            )}
            <span className="hidden text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:inline">
              Imamm Accounting Solutions
            </span>
          </div>
        </header>
        <main className="flex-1 px-4 py-8 lg:px-10">
          {isGuest && (
            <div className="mb-6 flex flex-col gap-2 border border-amber-600/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/40 dark:text-amber-200">
              <p>
                You are in guest preview. Everything you enter is kept only on
                this device until you sign in with your email — which carries
                your societies and books to any PC you log in from.
              </p>
              <Button asChild variant="outline" size="sm" className="shrink-0 rounded-none border-amber-600/40">
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
