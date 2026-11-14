import { testDatabaseUrl } from "./test-db-url";

process.env.APP_ENV = "test";
process.env.DATABASE_URL = testDatabaseUrl().url;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.SIGNUP_MODE = process.env.SIGNUP_MODE ?? "approval";
// Never call real paid APIs from tests.
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.AI_GATEWAY_API_KEY;
