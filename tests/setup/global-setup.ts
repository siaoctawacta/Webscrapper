import { Client } from "pg";
import { testDatabaseUrl } from "./test-db-url";
import { runMigrations } from "../../src/server/db/migrate";

export default async function setup() {
  const { base, name, url } = testDatabaseUrl();
  const admin = new Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  try {
    // Recreate from scratch so every run starts from the current migrations.
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
    await admin.query(`drop database if exists "${name}"`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(url);
}
