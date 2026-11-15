import "server-only";
import { PgBoss } from "pg-boss";
import { env } from "../env";

/** Background queues. The web app only sends; `pnpm worker` (src/worker) processes them. */
export const QUEUES = {
  searchRun: "search.run",
  exportRun: "export.run",
  maintenance: "maintenance.cleanup",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type QueuePayloads = {
  "search.run": { jobId: string };
  "export.run": { exportId: string };
  "maintenance.cleanup": Record<string, never>;
};

const g = globalThis as unknown as { __leadfinderBoss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!g.__leadfinderBoss) {
    g.__leadfinderBoss = (async () => {
      const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss" });
      boss.on("error", (e) => console.error("[queue]", e));
      await boss.start();
      for (const name of Object.values(QUEUES)) await boss.createQueue(name);
      return boss;
    })().catch((e) => {
      g.__leadfinderBoss = undefined;
      throw e;
    });
  }
  return g.__leadfinderBoss;
}

export async function enqueue<Q extends QueueName>(
  name: Q,
  data: QueuePayloads[Q],
  options: { singletonKey?: string; retryLimit?: number; expireInSeconds?: number } = {},
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(name, data, sendOptions(options));
}

/**
 * pg-boss validates option keys that are present even when undefined (e.g. `expireInSeconds:
 * undefined` fails its "at least every second" assert), so only pass the options that were given.
 */
export function sendOptions(options: { singletonKey?: string; retryLimit?: number; expireInSeconds?: number }) {
  return {
    retryLimit: options.retryLimit ?? 0,
    ...(options.singletonKey !== undefined ? { singletonKey: options.singletonKey } : {}),
    ...(options.expireInSeconds !== undefined ? { expireInSeconds: options.expireInSeconds } : {}),
  };
}

export async function stopBoss() {
  const b = await g.__leadfinderBoss?.catch(() => undefined);
  g.__leadfinderBoss = undefined;
  await b?.stop({ graceful: true }).catch(() => undefined);
}
