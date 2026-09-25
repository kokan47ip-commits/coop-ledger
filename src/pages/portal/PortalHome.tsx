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
import { useSociety } from "@/components/SocietyContext";
import { formatMoney } from "@/lib/format";
import {
  BookOpen,
  FileSpreadsheet,
  Landmark,
  Receipt,
  UserCircle,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";
import { useQuery } from "convex/react";

export default function PortalHome() {
  const { societyId, memberBinding } = useSociety();
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

  return (
    <div className="space-y-8">
      {/* Flat header card */}
      <Card className="overflow-hidden">
        <div className="brand-gradient h-1.5 w-full" />
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
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
                    <span className="capitalize">{info.member.ownershipType}</span>
                  </>
                )}
              </CardDescription>
            </div>
            <Badge
              variant={outstanding > 0.005 ? "destructive" : "outline"}
              className="shrink-0 text-xs"
            >
              {outstanding > 0.005
                ? `Due ${formatMoney(outstanding)}`
                : "No dues"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Total billed
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatMoney(info.totals.totalBilled)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Total paid
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatMoney(info.totals.totalPaid)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Outstanding
            </p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                outstanding > 0.005 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {formatMoney(outstanding)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What would you like to do?
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink
            to="/portal/pay"
            icon={<Wallet className="size-5" />}
            title="Make a payment"
            desc="Pay your maintenance dues against open bills."
            highlight={outstanding > 0.005}
          />
          <QuickLink
            to="/portal/ledger"
            icon={<BookOpen className="size-5" />}
            title="My ledger"
            desc="Bills and receipts for your flat, running balance."
          />
          <QuickLink
            to="/portal/bills"
            icon={<FileSpreadsheet className="size-5" />}
            title="My bills"
            desc="Download or print any maintenance bill."
          />
          <QuickLink
            to="/portal/receipts"
            icon={<Receipt className="size-5" />}
            title="My receipts"
            desc="Payment receipts for your records."
          />
          <QuickLink
            to="/portal/profile"
            icon={<UserCircle className="size-5" />}
            title="My profile"
            desc="Contact details and change password."
          />
          <div className="rounded-xl border bg-muted/30 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Landmark className="size-4 text-primary" />
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

function QuickLink({
  to,
  icon,
  title,
  desc,
  highlight,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group rounded-xl border px-4 py-4 transition-all hover:shadow-md ${
        highlight
          ? "border-primary/40 bg-primary/[0.04] hover:border-primary/60"
          : "hover:border-primary/30 hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{desc}</p>
    </Link>
  );
}
