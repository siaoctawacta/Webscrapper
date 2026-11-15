/** Applies SQL migrations from ./drizzle. Run with `pnpm db:migrate`. */
import "../load-env";
import { explainDbConnectionError } from "./connection-help";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runMigrations(url)
    .then(() => console.log("Migrations applied"))
    .catch((e) => {
      const hint = explainDbConnectionError(e, url);
      console.error(hint ? `Migrations failed: cannot connect to the database.\n  ${hint}` : e);
      process.exit(1);
    });
}
