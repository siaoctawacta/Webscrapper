"use client";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Info } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn, formatNumber, formatUsd } from "@/lib/utils";

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Cost estimates always with cents, so small amounts and totals read consistently. */
const formatCost = (n: number) => usd2.format(n);
import { Card } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/misc";
import type { UsageCell, UsageResponse } from "@/server/admin/types";

export const ADMIN_USAGE_KEY = ["admin", "usage"] as const;

/** "2026-06" → "Jun 2026" (UTC, independent of the viewer's time zone). */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function Cell({ c, strong }: { c: UsageCell; strong?: boolean }) {
  if (c.requests === 0 && c.costUsd === 0) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="grid justify-items-end">
      <span className={cn("tabular", strong && "font-semibold")}>{formatNumber(c.requests)}</span>
      <span className="tabular text-[11px] text-muted-foreground">{formatCost(c.costUsd)}</span>
    </span>
  );
}

export function UsagePanel({ initialData }: { initialData: UsageResponse }) {
  const { data = initialData } = useQuery({
    queryKey: ADMIN_USAGE_KEY,
    queryFn: () => api<UsageResponse>("/api/v1/admin/usage"),
    initialData,
  });
  const { pricing } = data;

  return (
    <div className="grid gap-5">
      <Notice tone="info" icon={<Info />}>
        <p>
          Billable Google requests per person and month, with an estimated cost. Estimates use the configured prices (
          {formatUsd(pricing.textSearchPer1000)} per 1,000 Text Search requests, {formatUsd(pricing.placeDetailsPer1000)} per 1,000 Place
          Details requests). The real bill is in your Google Cloud console.
        </p>
        {data.sampleMode && <p className="mt-1 opacity-90">Sample data mode is on: searches use generated data and cost nothing.</p>}
      </Notice>

      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={<BarChart3 />}
            title="No billable requests in the last 6 months"
            description="Requests to Google appear here once someone runs a search with a Google Maps API key configured."
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <caption className="sr-only">Billable requests and estimated cost by user and month</caption>
              <thead>
                <tr className="border-b border-border bg-subtle text-xs text-muted-foreground">
                  <th scope="col" className="sticky left-0 bg-subtle px-4 py-2.5 text-left font-medium">
                    User
                  </th>
                  {data.months.map((m) => (
                    <th key={m} scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.userId ?? "deleted"} className="border-b border-border">
                    <th scope="row" className="sticky left-0 max-w-64 bg-card px-4 py-3 text-left font-normal">
                      {r.userId ? (
                        <>
                          <span className="block truncate font-medium">{r.name || r.email || "Unknown"}</span>
                          {r.email && r.name && <span className="block truncate text-xs text-muted-foreground">{r.email}</span>}
                        </>
                      ) : (
                        <span className="italic text-muted-foreground">Deleted accounts</span>
                      )}
                    </th>
                    {r.months.map((c, i) => (
                      <td key={data.months[i]} className="px-3 py-3 text-right">
                        <Cell c={c} />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <Cell c={r.total} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-subtle">
                  <th scope="row" className="sticky left-0 bg-subtle px-4 py-3 text-left font-semibold">
                    Total
                  </th>
                  {data.totals.months.map((c, i) => (
                    <td key={data.months[i]} className="px-3 py-3 text-right font-medium">
                      <Cell c={c} strong />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <Cell c={data.totals.total} strong />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">Months are calendar months in UTC. People without billable requests in this period are not listed.</p>
    </div>
  );
}
