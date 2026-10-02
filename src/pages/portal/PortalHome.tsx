import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { IconTile, PageHeader } from "@/components/PageParts";
import InstallAppButton from "@/components/InstallAppButton";
import MemberQrCard from "@/pages/portal/MemberQrCard";
import { formatDate, formatMoney } from "@/lib/format";
import {
  ArrowUpRight,
  BookOpen,
  CircleCheck,
  FileSpreadsheet,
  Info,
  Landmark,
  Loader2,
  Receipt,
  UserCircle,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

/**
 * UPI payment status banner windows: a posted/captured payment stays visible
 * for a day; an in-flight (created) payment only while it is plausibly still
 * open in a UPI app.
 */
const POSTED_BANNER_MS = 24 * 60 * 60 * 1000;
const PROCESSING_BANNER_MS = 30 * 60 * 1000;
const BANNER_KEY = "chs.upiBannerDismissed";

type UpiBannerPayment = {
  _id: Id<"upiPayments">;
  amount: number;
  status: "created" | "posted" | "captured" | "cancelled";
  voucherNo: string | null;
  createdAt: number;
  postedAt: number | null;
};

type OpenBillRow = { _id: Id<"bills">; dueDate: string; balance: number };

function initialsOf(name: string): string {
  return (
    name
      .split(/[\s.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "M"
  );
}

export default function PortalHome() {
  const { societyId } = useSociety();
  const info = useQuery(
    api.memberPortal.myInfo,
    societyId ? { societyId } : "skip",
  );
  const upiPayments = useQuery(
    api.payments.myUpiPayments,
    societyId ? { societyId } : "skip",
  ) as UpiBannerPayment[] | null | undefined;
  const openBills = useQuery(
    api.memberPortal.myOpenBills,
    societyId ? { societyId } : "skip",
  ) as OpenBillRow[] | null | undefined;

  // The most recent online payment worth surfacing, newest first — posted
  // receipts and captured-but-unrecorded money stay visible for a day,
  // in-flight payments only while checkout may still be open. Dismissal is
  // remembered per payment, so a new payment brings the banner back.
  // Wall clock captured once per mount so the render stays pure; windows are
  // wide (hours) so a stale value within a session is harmless.
  const [now] = useState(() => Date.now());
  const bannerPayment = (upiPayments ?? []).find((p) => {
    if (p.status === "cancelled") return false;
    const ts = p.status === "created" ? p.createdAt : (p.postedAt ?? p.createdAt);
    const window = p.status === "created" ? PROCESSING_BANNER_MS : POSTED_BANNER_MS;
    return now - ts < window;
  });
  const [dismissedBannerId, setDismissedBannerId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(BANNER_KEY);
      } catch {
        return null;
      }
    },
  );
  const showBanner =
    bannerPayment !== undefined && bannerPayment._id !== dismissedBannerId;

  const dismissBanner = () => {
    if (!bannerPayment) return;
    setDismissedBannerId(bannerPayment._id);
    try {
      localStorage.setItem(BANNER_KEY, bannerPayment._id);
    } catch {
      // Private browsing — banner just returns next visit.
    }
  };

  if (!societyId) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (info === null) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>No flat linked to your login</CardTitle>
          <CardDescription>
            Your account is not yet linked to a flat in this society. Ask the
            society office to activate your member portal access.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!info) {
    return <Skeleton className="h-64 w-full" />;
  }

  const flatLabel =
    [info.member.wing, info.member.flatNo].filter(Boolean).join("-") ||
    info.member.code;
  const outstanding = info.totals.outstanding;
  const hasDue = outstanding > 0.005;

  // Dues summary: how many bills are open and when the earliest one is due —
  // mirrors the open-bill list on the payment page.
  const openBillCount = openBills?.length ?? 0;
  const earliestDue =
    openBills && openBills.length > 0
      ? openBills.map((b) => b.dueDate).sort()[0]
      : null;
  const overdue = !!earliestDue && earliestDue < new Date().toISOString().slice(0, 10);

  const quickLinks: {
    to: string;
    tone: "emerald" | "indigo" | "violet" | "amber" | "sky";
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    desc: string;
    highlight?: boolean;
  }[] = [
    {
      to: "/portal/pay",
      tone: "emerald",
      icon: Wallet,
      title: "Make a payment",
      desc: hasDue
        ? "Pay open bills by UPI (GPay, PhonePe, Paytm) or at the office."
        : "Pay your maintenance dues against open bills.",
      highlight: hasDue,
    },
    {
      to: "/portal/ledger",
      tone: "indigo",
      icon: BookOpen,
      title: "My ledger",
      desc: "Bills and receipts for your flat, running balance.",
    },
    {
      to: "/portal/bills",
      tone: "violet",
      icon: FileSpreadsheet,
      title: "My bills",
      desc: "Download or print any maintenance bill.",
    },
    {
      to: "/portal/receipts",
      tone: "amber",
      icon: Receipt,
      title: "My receipts",
      desc: "Payment receipts for your records.",
    },
    {
      to: "/portal/profile",
      tone: "sky",
      icon: UserCircle,
      title: "My profile",
      desc: "Contact details and change password.",
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="My Flat"
        description="Dues, bills, receipts and payments for your flat — all in one place."
      />

      {/* UPI payment status banner */}
      {showBanner && bannerPayment && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${
            bannerPayment.status === "posted"
              ? "border-emerald-500/40 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-900 dark:border-emerald-500/30 dark:from-emerald-950/50 dark:to-teal-950/30 dark:text-emerald-200"
              : bannerPayment.status === "captured"
                ? "border-sky-500/40 bg-gradient-to-r from-sky-50 to-indigo-50 text-sky-900 dark:border-sky-500/30 dark:from-sky-950/50 dark:to-indigo-950/30 dark:text-sky-200"
                : "border-amber-500/40 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-900 dark:border-amber-500/30 dark:from-amber-950/50 dark:to-orange-950/30 dark:text-amber-200"
          }`}
        >
          <IconTile
            tone={
              bannerPayment.status === "posted"
                ? "emerald"
                : bannerPayment.status === "captured"
                  ? "sky"
                  : "amber"
            }
          >
            {bannerPayment.status === "created" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CircleCheck />
            )}
          </IconTile>
          <p className="min-w-0 flex-1">
            {bannerPayment.status === "posted" ? (
              <>
                <strong>Payment successful.</strong>{" "}
                {formatMoney(bannerPayment.amount)} receipt
                {bannerPayment.voucherNo ? ` ${bannerPayment.voucherNo}` : ""} posted to your ledger.
              </>
            ) : bannerPayment.status === "captured" ? (
              <>
                <strong>Payment received.</strong> {formatMoney(bannerPayment.amount)} — the office will record it in the books shortly.
              </>
            ) : (
              <>
                <strong>Processing your payment.</strong> Complete it in your UPI app if the payment is still open.
              </>
            )}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-current opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            onClick={dismissBanner}
            aria-label="Dismiss"
          >
            <X />
          </Button>
        </div>
      )}

      {/* Dues summary strip */}
      {openBills !== undefined && (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm shadow-sm ${
            overdue
              ? "border-rose-500/40 bg-rose-50/70 text-rose-900 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200"
              : openBillCount > 0
                ? "border-amber-500/40 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
                : "border-emerald-500/40 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200"
          }`}
        >
          <IconTile
            tone={overdue ? "rose" : openBillCount > 0 ? "amber" : "emerald"}
            size="sm"
          >
            {openBillCount > 0 ? <Info /> : <CircleCheck />}
          </IconTile>
          <p className="min-w-0 flex-1">
            {openBillCount === 0 ? (
              <strong>All dues are clear.</strong>
            ) : (
              <>
                <strong>
                  {openBillCount === 1
                    ? "1 open bill"
                    : `${openBillCount} open bills`}
                </strong>
                {earliestDue
                  ? ` — earliest due ${formatDate(earliestDue)}`
                  : ""}
                {overdue ? " · Overdue" : ""}
              </>
            )}
          </p>
          {openBillCount > 0 && (
            <Button asChild size="sm" className="shrink-0">
              <Link to="/portal/pay">Pay now</Link>
            </Button>
          )}
        </div>
      )}

      {/* Install the app on phones/tablets (PWA) — hides itself once installed. */}
      <InstallAppButton />

      {/* Per-member dynamic UPI QR — appears once the office adds a VPA. */}
      <MemberQrCard
        societyName={info.society.name}
        vpa={info.society.upiVpa}
        memberName={info.member.name}
        flatLabel={flatLabel}
        memberCode={info.member.code}
        outstanding={outstanding}
      />

      {/* Flat hero card */}
      <Card className="relative overflow-hidden border-primary/15 shadow-lg shadow-primary/[0.06]">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
        <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/10 blur-2xl" />
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-4">
              <span className="brand-gradient flex size-14 shrink-0 items-center justify-center rounded-2xl text-base font-bold text-white shadow-lg shadow-primary/30 ring-1 ring-white/20 ring-inset">
                {initialsOf(info.member.name)}
              </span>
              <div>
                <CardTitle className="text-2xl tracking-tight">
                  {info.member.name}
                </CardTitle>
                <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">
                    Flat {flatLabel}
                  </span>
                  <span>·</span>
                  <span>{info.society.name}</span>
                  {info.member.ownershipType && (
                    <>
                      <span>·</span>
                      <span className="capitalize">
                        {info.member.ownershipType}
                      </span>
                    </>
                  )}
                </CardDescription>
              </div>
            </div>
            <Badge
              variant={hasDue ? "destructive" : "outline"}
              className="shrink-0 text-xs"
            >
              {hasDue ? `Due ${formatMoney(outstanding)}` : "No dues"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Total billed"
            value={formatMoney(info.totals.totalBilled)}
            tone="indigo"
          />
          <StatTile
            label="Total paid"
            value={formatMoney(info.totals.totalPaid)}
            tone="emerald"
          />
          <StatTile
            label="Outstanding"
            value={formatMoney(outstanding)}
            tone={hasDue ? "rose" : "emerald"}
          />
        </CardContent>
      </Card>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What would you like to do?
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((q) => (
            <QuickLink
              key={q.to}
              to={q.to}
              tone={q.tone}
              icon={<q.icon className="size-5" />}
              title={q.title}
              desc={q.desc}
              highlight={q.highlight}
            />
          ))}
          <div className="rounded-xl border bg-muted/30 px-4 py-4 transition-colors hover:border-primary/30">
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconTile tone="teal" size="sm">
                <Landmark />
              </IconTile>
              Society office
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {info.society.phone ? `Phone: ${info.society.phone}` : null}
              {info.society.email ? ` · ${info.society.email}` : null}
              {!info.society.phone && !info.society.email
                ? "Contact details are with the society office."
                : null}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "indigo" | "emerald" | "rose";
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-2">
        <IconTile tone={tone} size="sm">
          <span className="block size-1.5 rounded-full bg-current" />
        </IconTile>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p
        className={`mt-1.5 text-lg font-semibold tabular-nums ${
          tone === "rose"
            ? "text-rose-600 dark:text-rose-400"
            : tone === "emerald"
              ? "text-emerald-600 dark:text-emerald-400"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  title,
  desc,
  tone,
  highlight,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  desc: string;
  tone: "emerald" | "indigo" | "violet" | "amber" | "sky";
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group rounded-xl border px-4 py-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${
        highlight
          ? "border-primary/40 bg-primary/[0.04] hover:border-primary/60"
          : "hover:border-primary/30 hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2.5 text-sm font-medium">
        <IconTile tone={tone}>{icon}</IconTile>
        {title}
        <ArrowUpRight className="ml-auto size-4 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{desc}</p>
    </Link>
  );
}
