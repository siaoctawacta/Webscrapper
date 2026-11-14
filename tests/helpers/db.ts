import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/** Empty every app table (keeps the schema). Call in beforeEach for integration tests. */
export async function resetDb() {
  await db().execute(sql`
    truncate table
      audit_logs, usage_logs, rate_limits, exports, concepts, proposals, leads, collections,
      businesses, search_results, job_events, search_jobs, user_settings, invitations,
      verification, account, session, "user"
    restart identity cascade
  `);
}
