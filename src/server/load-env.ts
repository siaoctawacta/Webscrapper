/**
 * Load environment files for standalone processes (worker, migrations, scripts) the same way Next.js
 * does for the web app: .env.local first, then .env (earlier files win; real env vars win over both).
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
