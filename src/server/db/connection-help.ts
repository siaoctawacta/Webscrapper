/**
 * Turns low-level Postgres connection errors into an actionable hint (pure, no secrets printed).
 * Used by the worker, migrations and scripts when they cannot reach the database.
 */
type PgLikeError = { code?: string; errno?: number; hostname?: string; message?: string };

const hostOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export function explainDbConnectionError(err: unknown, databaseUrl: string | undefined): string | null {
  const e = (err ?? {}) as PgLikeError;
  const host = e.hostname ?? hostOf(databaseUrl) ?? "the database host";
  const supabaseDirect = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);

  if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") {
    if (supabaseDirect) {
      return [
        `Cannot resolve ${host}.`,
        "Supabase's direct connection (db.<project>.supabase.co) is IPv6-only, and many networks only have IPv4.",
        "Fix: in Supabase → Connect, copy the *Session pooler* connection string",
        "(postgresql://postgres.<project>:<password>@aws-…-<region>.pooler.supabase.com:5432/postgres),",
        "add ?uselibpqcompat=true&sslmode=require, put it in DATABASE_URL, then run `pnpm db:migrate`.",
        "Also check that the Supabase project is not paused.",
      ].join("\n  ");
    }
    return `Cannot resolve ${host}. Check the host name in DATABASE_URL and your internet/DNS connection.`;
  }
  if (e.code === "ECONNREFUSED") return `Nothing is listening at ${host}. Is PostgreSQL running, and is the port in DATABASE_URL right?`;
  if (e.code === "ETIMEDOUT" || e.code === "ENETUNREACH" || e.code === "EHOSTUNREACH") {
    return supabaseDirect
      ? `Cannot reach ${host} (likely IPv6-only). Use Supabase's Session pooler connection string instead (see docs).`
      : `Cannot reach ${host}. Check the firewall, the port, and that the database accepts outside connections.`;
  }
  if (e.code === "28P01") return "PostgreSQL rejected the password in DATABASE_URL. (Special characters in the password must be URL-encoded.)";
  if (e.code === "3D000") return "The database named in DATABASE_URL does not exist.";
  if (e.code === "28000") return "PostgreSQL refused this user/connection. With Supabase's pooler the user must be postgres.<project-ref>.";
  if (/self[- ]signed certificate|unable to verify the first certificate|certificate/i.test(e.message ?? "")) {
    return "SSL certificate check failed. For Supabase add ?uselibpqcompat=true&sslmode=require to DATABASE_URL (or provide their CA with sslrootcert and sslmode=verify-full).";
  }
  if (/does not support SSL|SSL off|no pg_hba.conf entry.*SSL/i.test(e.message ?? "")) {
    return "SSL mismatch: remove sslmode from DATABASE_URL, or enable SSL on the server.";
  }
  if (/max clients|too many clients|remaining connection slots/i.test(e.message ?? "")) {
    return "The database has no free connections. Lower DB_POOL_MAX / QUEUE_POOL_MAX (e.g. 4) — Supabase's free pooler allows few clients.";
  }
  return null;
}
