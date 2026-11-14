/**
 * Pure helpers for the search runner: a per-host-polite worker pool, a time throttle and the
 * plain-language stop reasons shown to the user. No DB, no secrets.
 */

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * Run `worker` over `items` with at most `concurrency` calls in flight and at most ONE in flight per
 * host (politeness towards each website). Hosts are served round-robin so one big host cannot starve
 * the others. Stops starting new work once `signal` aborts; always waits for in-flight calls.
 * Rejects with the first worker error after in-flight calls settle.
 */
export function runPerHost<T>(
  items: Iterable<T>,
  opts: { concurrency: number; hostOf: (item: T) => string | null | undefined; signal?: AbortSignal },
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const concurrency = Math.max(1, Math.floor(Number.isFinite(opts.concurrency) ? opts.concurrency : 1));
  const queues = new Map<string, T[]>();
  const ready: string[] = [];
  let i = 0;
  for (const item of items) {
    const host = opts.hostOf(item)?.toLowerCase() || `#item-${i}`;
    i += 1;
    const q = queues.get(host);
    if (q) q.push(item);
    else {
      queues.set(host, [item]);
      ready.push(host);
    }
  }

  return new Promise<void>((resolve, reject) => {
    let running = 0;
    let firstError: unknown = null;
    let failed = false;

    const settleIfIdle = () => {
      if (running > 0) return false;
      if (failed) reject(firstError);
      else resolve();
      return true;
    };

    const launch = () => {
      while (!failed && !opts.signal?.aborted && running < concurrency && ready.length > 0) {
        const host = ready.shift()!;
        const q = queues.get(host)!;
        const item = q.shift()!;
        running += 1;
        let p: Promise<void>;
        try {
          p = Promise.resolve(worker(item));
        } catch (e) {
          p = Promise.reject(e);
        }
        p.then(
          () => undefined,
          (e: unknown) => {
            if (!failed) {
              failed = true;
              firstError = e;
            }
          },
        ).finally(() => {
          running -= 1;
          if (q.length > 0) ready.push(host);
          else queues.delete(host);
          if (failed || opts.signal?.aborted || ready.length === 0) {
            settleIfIdle();
            return;
          }
          launch();
        });
      }
      if (ready.length === 0 || failed || opts.signal?.aborted) settleIfIdle();
    };
    launch();
  });
}

/** True at most once per `intervalMs` (the first call is always due). */
export class Throttle {
  private last = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly intervalMs: number,
    private readonly clock: () => number = Date.now,
  ) {}
  due(): boolean {
    const t = this.clock();
    if (t - this.last < this.intervalMs) return false;
    this.last = t;
    return true;
  }
  reset() {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/** Host of a URL (lower-case, without "www."), or null. */
export function hostOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export const STOP_MESSAGES = {
  targetReached: (n: number) => `Found the ${plural(n, "result")} you asked for.`,
  placeFound: () => "Found the business from your link.",
  exhausted: (n: number, isSample: boolean) =>
    isSample
      ? `The sample data has no more results for this area (${fmt(n)}).`
      : `Google returned all the results it has for this area (${fmt(n)}).`,
  noResults: (query: string) => `No businesses were found for “${query}” in this area. Try a broader term or a larger map area.`,
  budget: (n: number, requests: number) =>
    `Stopped after ${plural(requests, "request")}, the cost limit for this search, with ${plural(n, "result")} found. Ask for fewer results or search a smaller area.`,
  monthly: (n: number, limit: number) =>
    `Stopped because your monthly limit of ${fmt(limit)} Google requests was reached (${plural(n, "result")} found). It resets on the 1st of next month, or an administrator can raise it.`,
  monthlyExhaustedBeforeStart: (limit: number) =>
    `Your monthly limit of ${fmt(limit)} Google requests is used up, so this search couldn't run. It resets on the 1st of next month, or an administrator can raise it.`,
  providerErrorPartial: (n: number, message: string) => `Stopped early with ${plural(n, "result")}: ${message}`,
  cancelled: (n: number) => `Stopped by you with ${plural(n, "result")} found.`,
  placeNotFound: () =>
    "We couldn't find this business. Open the link in Google Maps and copy it again, or search by its name and city instead.",
  noArea: () => "This search has no map area to look in. Start it again from a Google Maps link or a typed location.",
  unexpected: () => "Something went wrong while running this search. Please try again.",
  workerStopped: () => "The worker stopped unexpectedly. Results found so far are kept — start the search again to get more.",
} as const;
