import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

const PILLARS: { group: string; tint: string; dot: string; items: string[] }[] = [
  {
    group: "Client books",
    tint: "from-indigo-500 to-violet-500",
    dot: "bg-indigo-500",
    items: [
      "Society profiles & registers",
      "Member opening balances",
      "Chart of accounts",
      "Tariff schedules",
    ],
  },
  {
    group: "Daily postings",
    tint: "from-violet-500 to-fuchsia-500",
    dot: "bg-violet-500",
    items: [
      "Member receipts",
      "Other receipts",
      "Payment vouchers",
      "Journal vouchers",
    ],
  },
  {
    group: "Billing",
    tint: "from-sky-500 to-cyan-400",
    dot: "bg-sky-500",
    items: [
      "One-click monthly bills",
      "Bill register & status",
      "Automatic settlement",
      "Ready-to-issue prints",
    ],
  },
  {
    group: "Statements",
    tint: "from-amber-500 to-orange-400",
    dot: "bg-amber-500",
    items: [
      "Member & general ledgers",
      "Income & expenditure",
      "Balance sheet",
      "Receipt & payment",
    ],
  },
];

const STEPS = [
  {
    no: "01",
    title: "Onboard each society",
    desc: "Create a profile and the standard chart of accounts is ready. Import the member register and opening balances from Excel in one pass.",
  },
  {
    no: "02",
    title: "Bill without effort",
    desc: "Define each society's tariff schedule once, then raise the month's bills for every active member with a single action.",
  },
  {
    no: "03",
    title: "Post and reconcile",
    desc: "Receipts settle outstanding bills oldest-first, automatically. Payments and journals keep every book balanced and current.",
  },
  {
    no: "04",
    title: "Deliver statements",
    desc: "Every bill, voucher and statement exports to PDF or Word, or prints directly — presentation-ready for committees and auditors.",
  },
];

const NUM_TINTS = [
  "from-indigo-500 to-violet-500",
  "from-violet-500 to-fuchsia-500",
  "from-sky-500 to-cyan-400",
  "from-amber-500 to-orange-400",
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="brand-gradient h-[3px] w-full" />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="brand-gradient flex size-8 items-center justify-center rounded-lg text-[10px] font-semibold tracking-wide text-white shadow-md shadow-primary/40">
              IAS
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Imamm Chsl Accounting Solutions
            </span>
          </div>
          <nav className="flex items-center gap-7 text-sm">
            <a
              href="#practice"
              className="hidden text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              The practice
            </a>
            <a
              href="#capabilities"
              className="hidden text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              Capabilities
            </a>
            <Link
              to="/auth"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Button
              asChild
              className="h-9 rounded-lg bg-gradient-to-r from-primary via-indigo-500 to-violet-500 px-5 text-xs font-medium tracking-wide text-white uppercase shadow-md shadow-primary/30"
            >
              <Link to="/auth">Client login</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -left-32 size-[38rem] rounded-full bg-violet-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -top-52 right-0 size-[34rem] rounded-full bg-sky-400/15 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 pb-28 pt-28 md:pt-36">
          <p className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.24em] text-primary">
            <span className="brand-gradient size-1.5 rounded-full" />
            Chartered bookkeeping · Co-operative housing societies
          </p>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[1.04] tracking-tight md:text-7xl">
            Accounting, handled with a{" "}
            <span className="brand-text">professional's discipline.</span>
          </h1>
          <p className="mt-9 max-w-xl text-lg leading-8 text-muted-foreground">
            Imamm Chsl Accounting Solutions is the private workspace behind the practice
            — members, tariffs, bills, receipts and vouchers maintained in clean
            double-entry, across every society on the books, with each statement
            ready for PDF or Word.
          </p>
          <div className="mt-11 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-lg bg-gradient-to-r from-primary via-indigo-500 to-violet-500 px-9 tracking-wide text-white shadow-lg shadow-primary/30 transition-transform hover:-translate-y-0.5"
            >
              <Link to="/auth">
                Enter the workspace <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="h-12 rounded-lg px-7 text-muted-foreground"
            >
              <a href="#capabilities">
                Review the capabilities <ArrowUpRight className="size-4" />
              </a>
            </Button>
          </div>

          <div className="mt-24 grid max-w-3xl grid-cols-3 divide-x divide-border border-y border-border">
            {[
              ["4", "voucher types", NUM_TINTS[0]],
              ["10+", "registers & statements", NUM_TINTS[1]],
              ["PDF · Word", "client-ready exports", NUM_TINTS[3]],
            ].map(([v, l, tint]) => (
              <div key={l} className="px-7 py-9 first:pl-0">
                <p
                  className={`bg-gradient-to-r ${tint} bg-clip-text text-2xl font-semibold tracking-tight text-transparent`}
                >
                  {v}
                </p>
                <p className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {l}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <div className="mb-16 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-md text-3xl font-semibold tracking-tight md:text-4xl">
              Every engagement, kept to one standard.
            </h2>
            <p className="max-w-sm text-sm leading-7 text-muted-foreground">
              The same rigorous structure applies to each society served —
              from the member register through to the balance sheet — so the
              work is consistent, reviewable and always current.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((m) => (
              <div
                key={m.group}
                className="group relative overflow-hidden rounded-xl border border-border/80 bg-card p-7 shadow-md shadow-primary/[0.06] transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10"
              >
                <div
                  className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${m.tint} opacity-90`}
                />
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {m.group}
                </p>
                <ul className="mt-6 space-y-3.5">
                  {m.items.map((i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className={`size-1.5 shrink-0 rounded-full ${m.dot}`} />
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Practice workflow */}
      <section id="practice" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            How the practice runs
          </p>
          <h2 className="mb-16 max-w-lg text-3xl font-semibold tracking-tight md:text-4xl">
            From opening balances to audit-ready statements.
          </h2>
          <div className="grid gap-x-14 gap-y-12 md:grid-cols-2">
            {STEPS.map((s, idx) => (
              <div key={s.no} className="border-t border-border pt-7">
                <span
                  className={`inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br ${NUM_TINTS[idx % NUM_TINTS.length]} font-mono text-[11px] font-bold text-white shadow-sm`}
                >
                  {s.no}
                </span>
                <h3 className="mt-3.5 text-lg font-medium tracking-tight">{s.title}</h3>
                <p className="mt-2.5 text-sm leading-7 text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Excel */}
      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-28 md:grid-cols-2 md:items-center">
          <div>
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              Records migration
            </p>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Existing registers, brought across intact.
            </h2>
            <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
              Client data arrives in spreadsheets and that is respected. Member
              openings, tariff schedules, receipt scrolls and payment lists are
              uploaded directly from Excel — columns are matched intelligently,
              dates and amounts cleaned, and every row validated before it
              reaches a ledger.
            </p>
          </div>
          <div className="panel p-7 font-mono text-xs leading-7 text-muted-foreground">
            <p className="font-semibold text-foreground">members.xlsx</p>
            <Separator className="my-3" />
            <p>Code&nbsp;&nbsp;&nbsp;Name&nbsp;&nbsp;&nbsp;FlatNo&nbsp;&nbsp;&nbsp;OpeningBalance</p>
            <p>M001&nbsp;&nbsp;&nbsp;Ramesh K&nbsp;&nbsp;A-101&nbsp;&nbsp;&nbsp;2,500.00</p>
            <p>M002&nbsp;&nbsp;&nbsp;Sunita S&nbsp;&nbsp;&nbsp;B-204&nbsp;&nbsp;&nbsp;0.00</p>
            <p className="mt-3 font-semibold text-foreground">receipts.xlsx</p>
            <Separator className="my-3" />
            <p>Date&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;MemberCode&nbsp;&nbsp;Amount&nbsp;&nbsp;Mode</p>
            <p>2025-04-05&nbsp;M001&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;3,000&nbsp;&nbsp;&nbsp;Bank</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="brand-gradient-deep relative mx-auto max-w-6xl overflow-hidden rounded-2xl px-6 py-24 text-center shadow-2xl shadow-primary/30">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400" />
          <div className="relative flex flex-col items-center gap-9">
            <span className="inline-flex size-12 items-center justify-center rounded-xl bg-white/10 text-amber-300 ring-1 ring-white/20 ring-inset">
              <ShieldCheck className="size-6" strokeWidth={1.5} />
            </span>
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white md:text-5xl">
              Your clients' books, kept in perfect order.
            </h2>
            <p className="max-w-md text-sm leading-7 text-indigo-100/80">
              This workspace is reserved for the practice. Sign in to review
              balances, post the day's vouchers and issue the month's bills.
            </p>
            <Button
              asChild
              size="lg"
              className="h-12 rounded-lg bg-white px-10 tracking-wide text-primary hover:bg-indigo-50"
            >
              <Link to="/auth">
                Sign in <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-9 text-xs text-muted-foreground sm:flex-row">
          <span>Imamm Chsl Accounting Solutions</span>
          <span>Bills · Ledgers · Statements · Client-ready exports</span>
        </div>
      </footer>
    </div>
  );
}
