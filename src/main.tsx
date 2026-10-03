import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { SocietyProvider } from "@/components/SocietyContext";
import "./index.css";

/**
 * Stale-chunk self-healing. The platform redeploys the app when files change
 * (HMR is off), so a tab holding the previous bundle asks for route chunks by
 * their OLD content hash and gets 404s ("Failed to fetch dynamically imported
 * module"). Wrap every lazy route: on a fetch/preload failure reload the tab
 * ONCE to pick up the fresh assets. The sessionStorage flag prevents reload
 * loops if a chunk is genuinely broken; any successful import re-arms the
 * guard so a later redeploy (tab kept open) also self-heals.
 */
const CHUNK_RELOAD_FLAG = "vly:chunk-reload";

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|dynamically imported module|preload|importing a module|chunk/i.test(msg);
}

function lazyPage(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  return React.lazy(() =>
    loader().then(
      (mod) => {
        sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
        return mod;
      },
      (err) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_FLAG) && isChunkLoadError(err)) {
          sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
          window.location.reload();
        }
        throw err;
      },
    ),
  );
}

// Belt-and-braces: Vite also surfaces failed module preloads as this event.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  if (!sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
    window.location.reload();
  }
});

// Lazy load route components for better code splitting
const Landing = lazyPage(() => import("./pages/Landing.tsx"));
const AuthPage = lazyPage(() => import("./pages/Auth.tsx"));
const Dashboard = lazyPage(() => import("./pages/Dashboard.tsx"));
const NotFound = lazyPage(() => import("./pages/NotFound.tsx"));
const AppLayout = lazyPage(() => import("@/components/AppLayout.tsx"));
const SocietyProfile = lazyPage(() => import("./pages/app/SocietyProfile.tsx"));
const Members = lazyPage(() => import("./pages/app/Members.tsx"));
const ChartOfAccounts = lazyPage(() => import("./pages/app/ChartOfAccounts.tsx"));
const Tariffs = lazyPage(() => import("./pages/app/Tariffs.tsx"));
const BillRegister = lazyPage(() => import("./pages/app/bills/BillRegister.tsx"));
const BillView = lazyPage(() => import("./pages/app/bills/BillView.tsx"));
const PrintingHub = lazyPage(() => import("./pages/app/PrintingHub.tsx"));
const MemberReceipt = lazyPage(() => import("./pages/app/vouchers/MemberReceipt.tsx"));
const OtherReceipt = lazyPage(() => import("./pages/app/vouchers/OtherReceipt.tsx"));
const Payment = lazyPage(() => import("./pages/app/vouchers/Payment.tsx"));
const PaymentApprovals = lazyPage(
  () => import("./pages/app/PaymentApprovals.tsx"),
);
const Journal = lazyPage(() => import("./pages/app/vouchers/Journal.tsx"));
const MemberLedger = lazyPage(() => import("./pages/app/ledgers/MemberLedger.tsx"));
const MemberDues = lazyPage(() => import("./pages/app/reports/MemberDues.tsx"));
const MemberAdvance = lazyPage(() => import("./pages/app/reports/MemberAdvance.tsx"));
const GeneralLedger = lazyPage(() => import("./pages/app/ledgers/GeneralLedger.tsx"));
const CashBook = lazyPage(() => import("./pages/app/ledgers/CashBook.tsx"));
const TrialBalance = lazyPage(() => import("./pages/app/reports/TrialBalance.tsx"));
const BankBook = lazyPage(() => import("./pages/app/ledgers/BankBook.tsx"));
const IncomeExpenditure = lazyPage(() => import("./pages/app/reports/IncomeExpenditure.tsx"));
const BalanceSheet = lazyPage(() => import("./pages/app/reports/BalanceSheet.tsx"));
const ReceiptPayment = lazyPage(() => import("./pages/app/reports/ReceiptPayment.tsx"));
const Uploads = lazyPage(() => import("./pages/app/Uploads.tsx"));
const TransactionImport = lazyPage(() => import("./pages/app/TransactionImport.tsx"));
const UsersRights = lazyPage(() => import("./pages/app/UsersRights.tsx"));
const MessagingSettings = lazyPage(
  () => import("./pages/app/MessagingSettings.tsx"),
);
const PortalHome = lazyPage(() => import("./pages/portal/PortalHome.tsx"));
const PortalLedger = lazyPage(() => import("./pages/portal/PortalLedger.tsx"));
const PortalBills = lazyPage(() => import("./pages/portal/PortalBills.tsx"));
const PortalReceipts = lazyPage(() => import("./pages/portal/PortalReceipts.tsx"));
const PortalPay = lazyPage(() => import("./pages/portal/PortalPay.tsx"));
const PortalProfile = lazyPage(() => import("./pages/portal/PortalProfile.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <SocietyProvider>
                      <AppLayout />
                    </SocietyProvider>
                  </RequireAuth>
                }
              >
                <Route index element={<Dashboard />} />
              </Route>
              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <SocietyProvider>
                      <AppLayout />
                    </SocietyProvider>
                  </RequireAuth>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="society" element={<SocietyProfile />} />
                <Route path="members" element={<Members />} />
                <Route path="accounts" element={<ChartOfAccounts />} />
                <Route path="tariffs" element={<Tariffs />} />
                <Route path="bills" element={<BillRegister />} />
                <Route path="bills/:billId" element={<BillView />} />
                <Route path="printing-hub" element={<PrintingHub />} />
                <Route path="member-receipt" element={<MemberReceipt />} />
                <Route path="other-receipt" element={<OtherReceipt />} />
                <Route path="payment" element={<Payment />} />
                <Route
                  path="payment-approvals"
                  element={<PaymentApprovals />}
                />
                <Route path="journal" element={<Journal />} />
                <Route path="member-ledger" element={<MemberLedger />} />
                <Route path="member-dues" element={<MemberDues />} />
                <Route path="member-advance" element={<MemberAdvance />} />
                <Route path="general-ledger" element={<GeneralLedger />} />
                <Route path="cash-book" element={<CashBook />} />
                <Route path="trial-balance" element={<TrialBalance />} />
                <Route path="bank-book" element={<BankBook />} />
                <Route path="income-expenditure" element={<IncomeExpenditure />} />
                <Route path="balance-sheet" element={<BalanceSheet />} />
                <Route path="receipt-payment" element={<ReceiptPayment />} />
                <Route path="uploads" element={<Uploads />} />
                <Route path="transaction-import" element={<TransactionImport />} />
                <Route path="users" element={<UsersRights />} />
                <Route
                  path="messaging-settings"
                  element={<MessagingSettings />}
                />
              </Route>
              {/* Member self-service portal (flat-bound logins) */}
              <Route
                path="/portal"
                element={
                  <RequireAuth>
                    <SocietyProvider>
                      <AppLayout />
                    </SocietyProvider>
                  </RequireAuth>
                }
              >
                <Route index element={<PortalHome />} />
                <Route path="ledger" element={<PortalLedger />} />
                <Route path="bills" element={<PortalBills />} />
                <Route path="receipts" element={<PortalReceipts />} />
                <Route path="pay" element={<PortalPay />} />
                <Route path="profile" element={<PortalProfile />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

/**
 * PWA installability: Chromium only fires the install prompt when a service
 * worker with a fetch handler is registered. This SW is a deliberate network
 * passthrough — no offline shell, no caching — so it can never serve stale
 * app code; the platform's redeploy flow stays the single source of truth.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is best-effort; the app works without it.
    });
  });
}
