// CONTRACT STUB — implemented by the "search" module agent. Keep this export signature.
import "server-only";

/** Execute a queued search job end-to-end (search → store → enrich → finalize). Never throws for job-level failures; records them on the job. */
export async function runSearchJob(_jobId: string): Promise<void> {
  throw new Error("Not implemented yet");
}
