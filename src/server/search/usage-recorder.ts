import "server-only";
import type { SourceId } from "@/lib/domain";
import type { UsageEvent } from "../providers/types";
import { recordUsage } from "../usage";

type Totals = { requests: number; billableRequests: number; costUsd: number };

/**
 * Collects provider usage events (one per HTTP request) and writes them to usage_logs in batches,
 * grouped by operation and billability. Totals are kept for progress and quota decisions.
 */
export class UsageRecorder {
  private pending: UsageEvent[] = [];
  private flushing: Promise<void> = Promise.resolve();
  readonly totals: Totals = { requests: 0, billableRequests: 0, costUsd: 0 };

  constructor(
    private readonly userId: string,
    private readonly provider: SourceId,
    private jobId: string | null = null,
  ) {}

  setJobId(jobId: string) {
    this.jobId = jobId;
  }

  /** Pass as ProviderContext.onUsage. */
  readonly onUsage = (u: UsageEvent): void => {
    const requests = Number.isFinite(u.requests) && u.requests > 0 ? Math.floor(u.requests) : 1;
    const costUsd = Number.isFinite(u.costUsd) && u.costUsd > 0 ? u.costUsd : 0;
    const event: UsageEvent = { ...u, requests, costUsd };
    this.pending.push(event);
    this.totals.requests += requests;
    if (event.billable) {
      this.totals.billableRequests += requests;
      this.totals.costUsd += costUsd;
    }
  };

  /** Write everything collected so far. Safe to call concurrently; never loses events on failure. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.writePending());
    return this.flushing;
  }

  private async writePending(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const groups = new Map<string, { operation: string; billable: boolean; requests: number; cost: number }>();
    for (const e of batch) {
      const key = `${e.operation}|${e.billable}`;
      const g = groups.get(key) ?? { operation: e.operation, billable: e.billable, requests: 0, cost: 0 };
      g.requests += e.requests;
      g.cost += e.costUsd;
      groups.set(key, g);
    }
    const failed: UsageEvent[] = [];
    for (const g of groups.values()) {
      try {
        await recordUsage({
          userId: this.userId,
          provider: this.provider,
          operation: g.operation,
          requestCount: g.requests,
          billable: g.billable,
          estimatedCostUsd: Math.round(g.cost * 10_000) / 10_000,
          jobId: this.jobId,
        });
      } catch (e) {
        console.error("[search] failed to record usage", e);
        failed.push({ operation: g.operation as UsageEvent["operation"], billable: g.billable, requests: g.requests, costUsd: g.cost });
      }
    }
    // Keep failed groups for the next flush so billing stays accurate.
    if (failed.length) this.pending.unshift(...failed);
  }
}
