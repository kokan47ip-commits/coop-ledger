import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

const MODULES: { group: string; items: string[] }[] = [
  {
    group: "Masters",
    items: ["Society profile", "Member register", "Chart of accounts", "Tariff schedule"],
  },
  {
    group: "Transactions",
    items: ["Member receipts", "Other receipts", "Payment vouchers", "Journal vouchers"],
  },
  {
    group: "Billing",
    items: ["Monthly bill generation", "Bill register", "Bill view & print", "Auto settlement"],
  },
  {
    group: "Statements",
    items: ["Member ledgers", "General ledger", "Income & expenditure", "Balance sheet · R&P"],
  },
];

const STEPS = [
  {
    no: "01",
    title: "Set up the society",
    desc: "Create the profile — a ready chart of accounts is generated. Import members and openings from Excel.",
  },
  {
    no: "02",
    title: "Bill the members",
    desc: "Define the tariff schedule once. Generate monthly bills for every active flat in one click.",
  },
  {
    no: "03",
    title: "Record & reconcile",
    desc: "Receipts auto-settle outstanding bills oldest-first. Payments and journals keep the books balanced.",
  },
  {
    no: "04",
    title: "Report & share",
    desc: "Every bill, voucher and statement exports to PDF or Word, or prints directly — audit-ready.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded bg-foreground text-[11px] font-bold text-background">
              CH
            </span>
            <span className="text-sm font-semibold tracking-tight">CoLedger</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              / society accounting
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#modules" className="hidden text-muted-foreground transition-colors hover:text-foreground md:inline">
              Modules
            </a>
            <a href="#workflow" className="hidden text-muted-foreground transition-colors hover:text-foreground md:inline">
              Workflow
            </a>
            <Link to="/auth" className="text-muted-foreground transition-colors hover:text-foreground">
              Sign in
            </Link>
            <Button asChild className="h-8 rounded-full px-4 text-xs">
              <Link to="/auth">Open workspace</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-28 md:pt-36">
        <p className="mb-6 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Multi-society · Double-entry · Pure accounting
        </p>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
          The accounting system for co-operative housing societies.
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-8 text-muted-foreground">
          Members, tariffs, bills, receipts and vouchers in one clean double-entry
          ledger — with every statement exportable to PDF or Word. No statutory
          registers, nothing else to learn.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="h-11 rounded-full px-8">
            <Link to="/auth">
              Start bookkeeping <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost" className="h-11 rounded-full px-6 text-muted-foreground">
            <a href="#modules">
              See what's inside <ArrowUpRight className="size-4" />
            </a>
          </Button>
        </div>

        <div className="mt-20 grid max-w-3xl grid-cols-3 divide-x border-y">
          {[
            ["4", "voucher types"],
            ["10+", "statements & registers"],
            ["PDF · Word", "one-click exports"],
          ].map(([v, l]) => (
            <div key={l} className="px-6 py-8 first:pl-0">
              <p className="text-2xl font-semibold tracking-tight">{v}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="mb-14 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-md text-3xl font-semibold tracking-tight md:text-4xl">
              Everything the treasurer needs. Nothing they don't.
            </h2>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Pure accounting — from the member register to the balance sheet —
              organised the way society accountants actually work.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <div key={m.group} className="bg-background p-7">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {m.group}
                </p>
                <ul className="mt-5 space-y-3">
                  {m.items.map((i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm">
                      <span className="h-px w-3 bg-muted-foreground/50" />
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="mb-14 max-w-lg text-3xl font-semibold tracking-tight md:text-4xl">
            From opening balances to audit-ready statements.
          </h2>
          <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
            {STEPS.map((s) => (
              <div key={s.no} className="border-t pt-6">
                <span className="font-mono text-xs text-muted-foreground">{s.no}</span>
                <h3 className="mt-2 text-lg font-medium tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Excel */}
      <section className="border-t">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-2 md:items-center">
          <div>
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Excel in, books ready
            </p>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Bring your existing register.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
              Upload member openings, the tariff schedule, receipt scrolls and
              payment lists straight from Excel. Headers are matched flexibly,
              dates and amounts are cleaned automatically, and every row is
              validated before it touches the ledger.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-6 font-mono text-xs leading-7 text-muted-foreground">
            <p className="text-foreground">members.xlsx</p>
            <Separator className="my-3" />
            <p>Code&nbsp;&nbsp;&nbsp;Name&nbsp;&nbsp;&nbsp;FlatNo&nbsp;&nbsp;&nbsp;OpeningBalance</p>
            <p>M001&nbsp;&nbsp;&nbsp;Ramesh K&nbsp;&nbsp;A-101&nbsp;&nbsp;&nbsp;2,500.00</p>
            <p>M002&nbsp;&nbsp;&nbsp;Sunita S&nbsp;&nbsp;&nbsp;B-204&nbsp;&nbsp;&nbsp;0.00</p>
            <p className="mt-2 text-foreground">receipts.xlsx</p>
            <Separator className="my-3" />
            <p>Date&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;MemberCode&nbsp;&nbsp;Amount&nbsp;&nbsp;Mode</p>
            <p>2025-04-05&nbsp;M001&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;3,000&nbsp;&nbsp;&nbsp;Bank</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 py-28 text-center">
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight md:text-5xl">
            Your society's books, in order.
          </h2>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Create a workspace, add your society, and issue the first bill in minutes.
          </p>
          <Button asChild size="lg" className="h-11 rounded-full px-8">
            <Link to="/auth">
              Get started free <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row">
          <span>CoLedger — housing society accounting</span>
          <span>Bills · Ledgers · Statements · Exports</span>
        </div>
      </footer>
    </div>
  );
}
