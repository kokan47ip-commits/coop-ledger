import { Button } from "@/components/ui/button";
import { MENU_REGISTRY, PATH_TO_MENU, PORTAL_MENUS, PORTAL_PATHS, type MenuKey } from "@/lib/menus";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { toast } from "sonner";
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
  CreditCard,
  ClipboardCheck,
  FileInput,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  Loader2,
  KeyRound,
  LogIn,
  MessageCircle,
  Printer,
  LogOut,
  Plus,
  Receipt,
  Repeat,
  Scale,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Link,
  Navigate,
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
      { to: "/app/payment-approvals", label: "Payment Approvals", icon: <ClipboardCheck className="size-4" /> },
      { to: "/app/journal", label: "Journal", icon: <FileText className="size-4" /> },
      { to: "/app/bills", label: "Bill Register", icon: <FileSpreadsheet className="size-4" /> },
      { to: "/app/printing-hub", label: "Printing Hub", icon: <Printer className="size-4" /> },
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
      { to: "/app/trial-balance", label: "Trial Balance", icon: <Scale className="size-4" /> },
      { to: "/app/bank-book", label: "Bank Book", icon: <CreditCard className="size-4" /> },
      { to: "/app/income-expenditure", label: "Income & Expenditure", icon: <TrendingUp className="size-4" /> },
      { to: "/app/balance-sheet", label: "Balance Sheet", icon: <FileText className="size-4" /> },
      { to: "/app/receipt-payment", label: "Receipt & Payment", icon: <Wallet className="size-4" /> },
    ],
  },
  {
    title: "Data",
    items: [
      { to: "/app/transaction-import", label: "Transaction Import", icon: <FileInput className="size-4" /> },
      { to: "/app/uploads", label: "Excel Uploads", icon: <FileSpreadsheet className="size-4" /> },
      { to: "/app/users", label: "Users & Rights", icon: <ShieldCheck className="size-4" /> },
    ],
  },
  {
    title: "Settings",
    icon: <MessageCircle className="size-4" />,
    items: [
      { to: "/app/messaging-settings", label: "Messaging & Payments", icon: <MessageCircle className="size-4" /> },
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
  "/app/printing-hub": "Printing Hub",
  "/app/member-ledger": "Member Ledger",
  "/app/general-ledger": "General Ledger",
  "/app/cash-book": "Cash Book",
  "/app/income-expenditure": "Income & Expenditure",
  "/app/balance-sheet": "Balance Sheet",
  "/app/receipt-payment": "Receipt & Payment",
  "/app/uploads": "Excel Uploads",
  "/app/transaction-import": "Transaction Import",
  "/app/users": "Users & Rights",
  "/app/messaging-settings": "Messaging & Payments",
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
      ? "bg-gradient-to-r from-primary via-indigo-500 to-violet-500 font-medium text-white shadow-lg shadow-indigo-950/50 ring-1 ring-white/25 ring-inset"
      : "text-sidebar-foreground/65 hover:bg-white/[0.07] hover:text-sidebar-foreground",
  );

function SocietySwitcher() {
  const { societies, society, setActiveId, role } = useSociety();
  const isPortalMember = role === "member";
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
        {!isPortalMember && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/app/society?new=1" className="cursor-pointer">
                <Plus className="mr-2 size-4" /> Onboard a new society
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const {
    societyId,
    society,
    isLoading,
    isGuest,
    role,
    isAdmin,
    allowedMenus,
    memberBinding,
  } = useSociety();
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
  // The state update runs outside the synchronous effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    queueMicrotask(() => {
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
    });
  }, [location.pathname]);

  const title =
    PAGE_TITLES[location.pathname] ??
    (location.pathname.startsWith("/app/bills/")
      ? "Bill View"
      : location.pathname.startsWith("/app/vouchers/")
        ? "Voucher View"
        : location.pathname.startsWith("/portal/")
          ? "My Flat"
          : location.pathname === "/portal"
            ? "My Flat"
            : "Accounting");

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  // ---- Own login password (any signed-in account) -------------------------
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const changeOwnPassword = useMutation(api.memberPortal.changePassword);

  const saveOwnPassword = async () => {
    if (!user?.email || !newPw) return;
    setPwBusy(true);
    setPwError(null);
    try {
      await changeOwnPassword({ currentPassword: curPw, newPassword: newPw });
      toast.success("Password saved — sign in with your email and this password.");
      setPwOpen(false);
      setCurPw("");
      setNewPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Could not set the password.");
    } finally {
      setPwBusy(false);
    }
  };

  const isSetupRoute = location.pathname === "/app/society";

  // ---- Member portal mode -------------------------------------------------
  // Flat-bound member logins get their own sidebar experience; they never
  // see society book menus (their access level is "member" on the server).
  const isMemberPortal = role === "member" && !!memberBinding;

  const pathMenuKey = PORTAL_PATHS.has(location.pathname)
    ? (location.pathname.replace("/portal/", "portal-").replace("/portal", "portal-home") as MenuKey)
    : PATH_TO_MENU[location.pathname];
  const billDetail: MenuKey | null = location.pathname.startsWith("/app/bills/")
    ? "bills"
    : null;
  const requiredMenu = billDetail ?? pathMenuKey ?? null;
  const menuAllowed =
    !requiredMenu ||
    (requiredMenu === "users" && (role === "owner" || isAdmin)) ||
    (requiredMenu === "portal-home" && (role === "member" || allowedMenus === null)) ||
    (requiredMenu.startsWith("portal-") && allowedMenus?.includes("portal") === true) ||
    allowedMenus === null ||
    allowedMenus.includes(requiredMenu);
  // First menu the user may open — the fallback when a screen is blocked.
  // Member-portal logins fall back to /portal (their menus are portal keys,
  // which MENU_REGISTRY does not know about).
  const fallbackPath =
    role === "member"
      ? "/portal"
      : !allowedMenus || allowedMenus.length === 0 || allowedMenus.includes("dashboard")
        ? "/dashboard"
        : (MENU_REGISTRY.find((m) => allowedMenus.includes(m.key))?.path ?? "/dashboard");

  // Route guard. Portal members may only open /portal/*; book users may
  // never open /portal/*. Everyone else honours menu rights.
  if (!isLoading) {
    if (isMemberPortal && location.pathname.startsWith("/app")) {
      return <Navigate to="/portal" replace />;
    }
    if (
      role === "member" &&
      !memberBinding &&
      !location.pathname.startsWith("/portal")
    ) {
      return <Navigate to="/portal" replace />;
    }
    if (
      isMemberPortal &&
      requiredMenu &&
      !PORTAL_MENUS.some((m) => m.key === requiredMenu)
    ) {
      return <Navigate to="/portal" replace />;
    }
    if (
      role !== "member" &&
      location.pathname.startsWith("/portal")
    ) {
      return <Navigate to={fallbackPath} replace />;
    }
    if (!menuAllowed && location.pathname !== fallbackPath) {
      return <Navigate to={fallbackPath} replace />;
    }
  }

  const initials = (user?.name ?? user?.email ?? "IA")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  const roleLabel =
    role === "owner"
      ? "Owner"
      : role === "editor"
        ? "Editor"
        : role === "viewer"
          ? "Viewer (read-only)"
          : role === "member"
            ? memberBinding
              ? `Member — ${[memberBinding.wing, memberBinding.flatNo].filter(Boolean).join("-") || memberBinding.code}`
              : "Member"
            : null;

  if (!isLoading && !societyId && !isSetupRoute) {
    // Guest sessions keep data on the server but tied to the guest identity
    // of THIS device. A fresh device — or an expired session — therefore
    // starts empty: the way back to the books is signing in with the email
    // they were saved under, so say that instead of pushing "create society".
    if (isGuest) {
      // A guest session that carries an email (converted identity) restores
      // its books automatically on mount — show that it is happening.
      if (user?.email) {
        return (
          <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
            <span className="brand-gradient mx-auto flex size-12 items-center justify-center rounded-xl text-xs font-bold tracking-wide text-white shadow-lg shadow-primary/40">
              IAS
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              Restoring your societies…
            </h1>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Linking your books to <strong>{user.email}</strong> — they will
              open here automatically in a moment.
            </p>
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        );
      }
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
          <div className="max-w-md space-y-4">
            <span className="brand-gradient mx-auto flex size-12 items-center justify-center rounded-xl text-xs font-bold tracking-wide text-white shadow-lg shadow-primary/40">
              IAS
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              You are browsing as a guest
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Your societies and books are stored safely on the server — but
              they follow your <strong>email account</strong>, not this device.
              Sign in with the same email you used before (for example on your
              phone) and everything opens right up here.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className="px-8"
              onClick={() => {
                // /auth bounces signed-in sessions back here, so end the
                // guest session first — then the sign-in screen is reachable.
                void signOut().then(() => navigate("/auth?returnTo=%2Fdashboard"));
              }}
            >
              <LogIn className="size-4" /> Sign in with email
            </Button>
            <Button asChild variant="outline" size="lg" className="px-6">
              <Link to="/app/society?new=1">
                <Plus className="size-4" /> Continue as guest
              </Link>
            </Button>
          </div>
          <p className="max-w-md text-xs leading-5 text-muted-foreground/80">
            Guest data entered on this device is never lost — sign in with the
            society's profile email and it is adopted into your account
            automatically.
          </p>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="max-w-md space-y-4">
          <span className="brand-gradient mx-auto flex size-12 items-center justify-center rounded-xl text-xs font-bold tracking-wide text-white shadow-lg shadow-primary/40">
            IAS
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            No societies on this account yet
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Signed in as <strong>{user?.email ?? "your account"}</strong>. Books
            live under the email they were created with — if your societies are
            missing, sign out and sign in with that email instead.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="px-8">
            <Link to="/app/society?new=1">
              <Plus className="size-4" /> Create society
            </Link>
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="px-6"
            onClick={() => {
              void signOut().then(() => navigate("/auth?returnTo=%2Fdashboard"));
            }}
          >
            <LogOut className="size-4" /> Sign in with a different email
          </Button>
        </div>
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
        <div className="brand-gradient-deep pointer-events-none absolute inset-0 opacity-90" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/45 via-primary/10 to-transparent" />
        <div className="brand-gradient-gold pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-90" />
        <div className="relative flex h-16 items-center border-b border-white/10 px-3">
          <SocietySwitcher />
        </div>
        <nav className="relative flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
          {isMemberPortal
            ? PORTAL_MENUS.map((item) => (
                <div key={item.key} className="space-y-0.5 pb-1">
                  <NavLink
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={navLinkCls}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </NavLink>
                </div>
              ))
            : NAV.map((group) => {
            // Users & Rights: owners and software admins only. All other menus
            // honour the per-user menu rights set by the admin.
            const items = group.items.filter((i) => {
              const key = PATH_TO_MENU[i.to];
              if (key === "users") return role === "owner" || isAdmin;
              if (!allowedMenus) return true;
              return allowedMenus.includes(key as MenuKey);
            });
            if (items.length === 0) return null;
            if (!group.collapsible) {
              return (
                <div key={group.title} className="space-y-0.5 pb-1">
                  {items.map((item) => (
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
                    {items.map((item) => (
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
                  {isGuest && !user?.email
                    ? "Guest preview — sign in to use on any device"
                    : roleLabel
                      ? `${user?.email ?? "Account"} · ${roleLabel}`
                      : user?.email ?? "Account"}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPwOpen(true)}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
          >
            <KeyRound className="size-4" />
            Set login password
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
          >
            <LogOut className="size-4" />
            Logout
          </button>
        </div>

      {/* Own login password: works for password logins (current password
          required) and for OTP-only logins (no current password needed). */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set your login password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              For <span className="font-mono text-foreground">{user?.email}</span>
              {!user?.email &&
                " — your account has no email on it, so a password cannot be set."}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cur-pw">Current password</Label>
              <Input
                id="cur-pw"
                type="password"
                autoComplete="current-password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if you sign in with emailed codes and have no
                password yet.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                placeholder="8+ characters, at least 1 number"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            {pwError && <p className="text-sm text-red-500">{pwError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPwOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={saveOwnPassword}
                disabled={pwBusy || !newPw || !user?.email}
              >
                {pwBusy ? "Saving…" : "Save password"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
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
          <div className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-90" />
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
          {isAdmin && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              Admin
            </span>
          )}
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
          {role === "member" && (
            <div className="mb-6 flex flex-col gap-2 rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 text-sm text-emerald-900 shadow-sm dark:border-emerald-500/30 dark:from-emerald-950/50 dark:to-teal-950/30 dark:text-emerald-200">
              <p>
                Welcome! You are signed in as a <strong>member</strong>
                {memberBinding
                  ? ` of flat ${[memberBinding.wing, memberBinding.flatNo].filter(Boolean).join("-") || memberBinding.code}`
                  : ""}
                . You can view your own ledger, bills and receipts, make
                payments, and manage your profile — nothing else.
              </p>
            </div>
          )}
          {role === "viewer" && (
            <div className="mb-6 flex flex-col gap-2 rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-50 to-indigo-50 px-4 py-3 text-sm text-sky-900 shadow-sm dark:border-sky-500/30 dark:from-sky-950/50 dark:to-indigo-950/30 dark:text-sky-200">
              <p>
                You have <strong>view-only</strong> rights for this society.
                Entry forms and edits are disabled — ask the society owner for
                editor access to record transactions.
              </p>
            </div>
          )}
          {isGuest && (
            <div className="mb-6 flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-900 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:from-amber-950/50 dark:to-orange-950/30 dark:text-amber-200">
              <p>
                You are in guest preview. Everything you enter is kept only on
                this device until you sign in with your email — which carries
                your societies and books to any PC you log in from.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-600/40 text-amber-900 hover:border-amber-600/60 hover:bg-amber-100/60 hover:text-amber-900 dark:text-amber-200 dark:hover:bg-amber-950/60 dark:hover:text-amber-100"
                onClick={() => {
                  // /auth bounces authenticated sessions back, so end the
                  // guest session before opening the sign-in screen.
                  void signOut().then(() => navigate("/auth?returnTo=%2Fdashboard"));
                }}
              >
                <LogIn className="size-4" /> Sign in with email
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
