"use client";
import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

/** Underline-style tabs for page sections (e.g. All / No website / Has website). */
export function SegmentTabs<V extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: V;
  onChange: (v: V) => void;
  items: { value: V; label: React.ReactNode; count?: number | null }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex items-center gap-5 border-b border-border", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-2 border-transparent pb-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === it.value && "border-foreground text-foreground",
          )}
        >
          {it.label}
          {it.count != null && <span className="tabular rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground">{it.count.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}
