import next from "eslint-config-next";

export default [
  ...next,
  { ignores: [".next/**", ".next-*/**", "node_modules/**", "drizzle/**", "playwright-report/**", "test-results/**"] },
];
