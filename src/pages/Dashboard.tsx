import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader, StatCard } from "@/components/PageParts";
import { formatDate, formatINR, fyEndISO, fyStartISO, VOUCHER_TYPE_LABEL } from "@/lib/format";
import {
  ArrowRight,
  ArrowUpRight,
  FileSpreadsheet,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";
import { useQuery } from "convex/react";

type DashboardResult = {
  memberCount: number;
  billCount: number;
  voucherCount: number;
  outstanding: number;
  totalIncome: number;
  totalExpenditure: number;
  surplus: number;
  cashOnHand: number;
  trialBalanceTotal: number;
  recentVouchers: {
    id: string;
    date: string;
    voucherNo: string;
    type: keyof typeof VOUCHER_TYPE_LABEL;
    total: number;
    memberName: string | null;
  }[];
};

export default function Dashboard() {
  const { societyId, society } = useSociety();
  const stats = useQuery(
    api.api.dashboard,
    societyId
      ? { societyId, fromDate: fyStartISO(society?.fyStartMonth ?? 4), toDate: fyEndISO(society?.fyStartMonth ?? 4) }
      : "skip",
  ) as DashboardResult | undefined;

  const fyLabel = `${formatDate(fyStartISO(society?.fyStartMonth ?? 4))} – ${formatDate(
    fyEndISO(society?.fyStartMonth ?? 4),
  )}`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={society ? society.name : "Dashboard"}
        description={
          society
            ? `Accounting overview for the current financial year (${fyLabel}).`
            : "Overview of your society's books."
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/bills">
              <Receipt className="size-4" /> Generate bills
            </Link>
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active members"
          value={String(stats?.memberCount ?? 0)}
          hint="Registered flats/members"
        />
        <StatCard
          label="Outstanding"
          value={formatINR(stats?.outstanding ?? 0)}
          hint="Member receivables"
        />
        <StatCard
          label="Cash & bank"
          value={formatINR(stats?.cashOnHand ?? 0)}
          hint="Closing balance, FY to date"
        />
        <StatCard
          label={stats && stats.surplus >= 0 ? "Surplus (FY)" : "Deficit (FY)"}
          value={formatINR(Math.abs(stats?.surplus ?? 0))}
          hint={`Income ${formatINR(stats?.totalIncome ?? 0)} · Expense ${formatINR(stats?.totalExpenditure ?? 0)}`}
        />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-5">
        {/* Recent vouchers */}
        <section className="lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium">Recent vouchers</h3>
            <Link
              to="/app/member-receipt"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {!stats ? null : stats.recentVouchers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No transactions yet. Start with a member receipt or generate bills.
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Voucher</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentVouchers.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs font-medium">{v.voucherNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(v.date)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{VOUCHER_TYPE_LABEL[v.type]}</Badge>
                        {v.memberName && (
                          <span className="ml-2 text-xs text-muted-foreground">{v.memberName}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(v.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section className="lg:col-span-2">
          <div className="mb-4">
            <h3 className="text-sm font-medium">Quick actions</h3>
          </div>
          <div className="space-y-2">
            {[
              {
                to: "/app/member-receipt",
                icon: <Receipt className="size-4" />,
                title: "Record member receipt",
                desc: "Collect maintenance with auto bill settlement",
              },
              {
                to: "/app/bills",
                icon: <FileSpreadsheet className="size-4" />,
                title: "Generate monthly bills",
                desc: "From the active tariff schedule",
              },
              {
                to: "/app/uploads",
                icon: <ArrowUpRight className="size-4" />,
                title: "Import opening data",
                desc: "Members, tariffs, receipts and payments via Excel",
              },
              {
                to: "/app/income-expenditure",
                icon: <TrendingUp className="size-4" />,
                title: "View Income & Expenditure",
                desc: "Surplus for the financial year",
              },
              {
                to: "/app/members",
                icon: <Users className="size-4" />,
                title: "Manage members",
                desc: "Register, openings and flat details",
              },
              {
                to: "/app/receipt-payment",
                icon: <Wallet className="size-4" />,
                title: "Receipt & Payment",
                desc: "Cash-book summary with closing balance",
              },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="group flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-accent/40"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground group-hover:text-foreground">
                  {a.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="block text-xs text-muted-foreground">{a.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
