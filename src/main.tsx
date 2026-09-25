import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { SocietyProvider } from "@/components/SocietyContext";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const AppLayout = lazy(() => import("@/components/AppLayout.tsx"));
const SocietyProfile = lazy(() => import("./pages/app/SocietyProfile.tsx"));
const Members = lazy(() => import("./pages/app/Members.tsx"));
const ChartOfAccounts = lazy(() => import("./pages/app/ChartOfAccounts.tsx"));
const Tariffs = lazy(() => import("./pages/app/Tariffs.tsx"));
const BillRegister = lazy(() => import("./pages/app/bills/BillRegister.tsx"));
const BillView = lazy(() => import("./pages/app/bills/BillView.tsx"));
const MemberReceipt = lazy(() => import("./pages/app/vouchers/MemberReceipt.tsx"));
const OtherReceipt = lazy(() => import("./pages/app/vouchers/OtherReceipt.tsx"));
const Payment = lazy(() => import("./pages/app/vouchers/Payment.tsx"));
const Journal = lazy(() => import("./pages/app/vouchers/Journal.tsx"));
const MemberLedger = lazy(() => import("./pages/app/ledgers/MemberLedger.tsx"));
const GeneralLedger = lazy(() => import("./pages/app/ledgers/GeneralLedger.tsx"));
const CashBook = lazy(() => import("./pages/app/ledgers/CashBook.tsx"));
const IncomeExpenditure = lazy(() => import("./pages/app/reports/IncomeExpenditure.tsx"));
const BalanceSheet = lazy(() => import("./pages/app/reports/BalanceSheet.tsx"));
const ReceiptPayment = lazy(() => import("./pages/app/reports/ReceiptPayment.tsx"));
const Uploads = lazy(() => import("./pages/app/Uploads.tsx"));
const TransactionImport = lazy(() => import("./pages/app/TransactionImport.tsx"));
const UsersRights = lazy(() => import("./pages/app/UsersRights.tsx"));
const PortalHome = lazy(() => import("./pages/portal/PortalHome.tsx"));
const PortalLedger = lazy(() => import("./pages/portal/PortalLedger.tsx"));
const PortalBills = lazy(() => import("./pages/portal/PortalBills.tsx"));
const PortalReceipts = lazy(() => import("./pages/portal/PortalReceipts.tsx"));
const PortalPay = lazy(() => import("./pages/portal/PortalPay.tsx"));
const PortalProfile = lazy(() => import("./pages/portal/PortalProfile.tsx"));

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
                <Route path="member-receipt" element={<MemberReceipt />} />
                <Route path="other-receipt" element={<OtherReceipt />} />
                <Route path="payment" element={<Payment />} />
                <Route path="journal" element={<Journal />} />
                <Route path="member-ledger" element={<MemberLedger />} />
                <Route path="general-ledger" element={<GeneralLedger />} />
                <Route path="cash-book" element={<CashBook />} />
                <Route path="income-expenditure" element={<IncomeExpenditure />} />
                <Route path="balance-sheet" element={<BalanceSheet />} />
                <Route path="receipt-payment" element={<ReceiptPayment />} />
                <Route path="uploads" element={<Uploads />} />
                <Route path="transaction-import" element={<TransactionImport />} />
                <Route path="users" element={<UsersRights />} />
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
