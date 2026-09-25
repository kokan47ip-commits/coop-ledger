import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="brand-gradient h-8 w-1.5 shrink-0 rounded-full shadow-md shadow-primary/40" />
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
        {description && (
          <p className="max-w-2xl pl-[18px] text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/80 bg-card p-5 shadow-md shadow-slate-950/[0.05] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 dark:shadow-black/20",
        className,
      )}
    >
      <div className="brand-gradient absolute inset-x-0 top-0 h-1 opacity-80" />
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.035] p-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Shown in place of entry forms for view-only users. */
export function ViewerBlock({ what = "entries" }: { what?: string }) {
  return (
    <div className="mb-10 rounded-lg border border-sky-500/40 bg-sky-50/60 p-8 text-center dark:border-sky-500/30 dark:bg-sky-950/30">
      <p className="text-sm font-medium text-sky-900 dark:text-sky-200">
        View-only access — {what} are disabled for your account.
      </p>
      <p className="mt-1 text-xs text-sky-800/80 dark:text-sky-300/80">
        Ask the society owner to grant you editor rights to make changes.
      </p>
    </div>
  );
}

export function RightMoney({ value }: { value: number }) {
  return (
    <span className="tabular-nums">
      {new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)}
    </span>
  );
}
