/**
 * Starts the e2e stack: fresh database → migrations → worker + `next start`.
 * Used as Playwright's webServer command so the DB is reset before anything connects.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "pg";
import { runMigrations } from "../src/server/db/migrate";

async function resetDb(urlStr: string) {
  const url = new URL(urlStr);
  const name = url.pathname.slice(1);
  const admin = new Client({ connectionString: `${url.protocol}//${url.username}:${url.password}@${url.host}/postgres` });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}"`);
  await admin.end();
  await runMigrations(urlStr);
}

async function main() {
  const port = process.env.E2E_PORT ?? "3200";
  await resetDb(process.env.DATABASE_URL!);
  const children: ChildProcess[] = [
    spawn("pnpm", ["worker"], { stdio: "inherit", env: process.env }),
    spawn("pnpm", ["next", "start", "--port", port], { stdio: "inherit", env: process.env }),
  ];
  const stop = () => {
    for (const c of children) c.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1500);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  for (const c of children) c.on("exit", (code) => code && code !== 0 && stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
