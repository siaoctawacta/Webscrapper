import * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn("shrink-0 bg-border", vertical ? "h-full w-px" : "h-px w-full", className)} />;
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-muted)_0%,var(--color-subtle)_50%,var(--color-muted)_100%)] bg-[length:200%_100%]", className)}
      {...props}
    />
  );
}

export function Progress({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(pct)} className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full bg-accent transition-[width] duration-500 ease-out", indeterminate && "animate-shimmer w-full bg-[linear-gradient(90deg,transparent,var(--color-accent),transparent)] bg-[length:200%_100%]")}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {icon && <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <div className="grid gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = "info", icon, children, className }: { tone?: "info" | "warning" | "danger" | "success"; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-accent/20 bg-accent-soft text-accent-soft-foreground",
    warning: "border-warning/30 bg-warning-soft text-warning-soft-foreground",
    danger: "border-destructive/25 bg-danger-soft text-danger-soft-foreground",
    success: "border-success/25 bg-success-soft text-success-soft-foreground",
  };
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0", tones[tone], className)}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
