/**
 * Background worker: `pnpm worker`. Processes search jobs, exports and periodic maintenance.
 * Run at least one instance alongside the web app.
 */
import "@/server/load-env";
import { getBoss, QUEUES, stopBoss } from "@/server/queue";
import { env } from "@/server/env";
import { runSearchJob } from "@/server/search/runner";
import { runExport } from "@/server/exports/runner";
import { runMaintenance } from "@/server/search/maintenance";
import { closeDb } from "@/server/db";
import { explainDbConnectionError } from "@/server/db/connection-help";

async function main() {
  const boss = await getBoss();
  const concurrency = Math.max(1, env().MAX_CONCURRENT_JOBS);

  await boss.work<{ jobId: string }>(QUEUES.searchRun, { localConcurrency: concurrency, batchSize: 1 }, async ([job]) => {
    // job.signal aborts on shutdown/overrun: the runner then stops and keeps what it found.
    if (job) await runSearchJob(job.data.jobId, { signal: job.signal });
  });
  await boss.work<{ exportId: string }>(QUEUES.exportRun, { localConcurrency: 2, batchSize: 1 }, async ([job]) => {
    if (job) await runExport(job.data.exportId);
  });
  await boss.work(QUEUES.maintenance, { batchSize: 1 }, async () => {
    await runMaintenance();
  });
  await boss.schedule(QUEUES.maintenance, "*/10 * * * *");

  console.log(`[worker] ready — search concurrency ${concurrency}`);
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received, finishing current jobs…`);
  await stopBoss();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((e) => {
  const hint = explainDbConnectionError(e, process.env.DATABASE_URL);
  if (hint) console.error(`[worker] failed to start: cannot connect to the database.\n  ${hint}`);
  else console.error("[worker] failed to start", e);
  process.exit(1);
});
