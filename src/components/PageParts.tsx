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

export function IconTile({
  children,
  tone = "indigo",
  size = "md",
  className,
}: {
  children: ReactNode;
  /** Palette family for the tile background/icon. */
  tone?:
    | "indigo"
    | "violet"
    | "sky"
    | "emerald"
    | "amber"
    | "rose"
    | "teal"
    | "fuchsia";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    fuchsia: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  };
  const sizes: Record<string, string> = {
    sm: "size-7 rounded-md [&_svg]:size-3.5",
    md: "size-9 rounded-lg [&_svg]:size-[18px]",
    lg: "size-12 rounded-xl [&_svg]:size-6",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        tones[tone],
        sizes[size],
        className,
      )}
    >
      {children}
    </span>
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
