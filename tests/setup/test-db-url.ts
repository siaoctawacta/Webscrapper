/**
 * Each test run uses its own database: leadfinder_test (default) or leadfinder_test_<TEST_DB_SUFFIX>.
 * Parallel workers/agents set TEST_DB_SUFFIX to avoid clobbering each other.
 */
export function testDatabaseUrl() {
  const base = process.env.TEST_DATABASE_BASE_URL ?? "postgres://leadfinder:leadfinder@localhost:5432";
  const suffix = process.env.TEST_DB_SUFFIX ? `_${process.env.TEST_DB_SUFFIX.replace(/[^a-z0-9_]/gi, "")}` : "";
  return { base, name: `leadfinder_test${suffix}`, url: `${base}/leadfinder_test${suffix}` };
}
