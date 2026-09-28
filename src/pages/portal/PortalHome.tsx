import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { IconTile, PageHeader } from "@/components/PageParts";
import { formatMoney } from "@/lib/format";
import {
  ArrowUpRight,
  BookOpen,
  FileSpreadsheet,
  Landmark,
  Receipt,
  UserCircle,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

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
      desc: "Pay your maintenance dues against open bills.",
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
