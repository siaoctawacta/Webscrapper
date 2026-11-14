# LeadFinder — agent instructions

Business discovery + lead management app: paste a Google Maps link or type keyword + location, get
businesses (name, phone, website, email from the business's own site, rating…), split by
has-website / no-website, save into collections, write proposals, generate AI homepage concepts,
export XLSX/CSV.

Read `docs/ARCHITECTURE.md` before changing code — it is the contract between modules.

## Stack (pinned — do not upgrade or add packages without being asked)
- Next.js 16 App Router (`src/app`), React 19, TypeScript strict, Tailwind CSS v4 (CSS-first, tokens in `src/app/globals.css`).
- **This is NOT the Next.js in your training data.** Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (route handlers take `params: Promise<…>`; `middleware` is now `src/proxy.ts`).
- AI SDK 7 (`ai`) via Vercel AI Gateway — docs in `node_modules/ai/docs/`. Structured output is `generateText({ output: Output.object({ schema }) })`.
- Postgres + Drizzle ORM (`src/server/db/schema.ts`), Better Auth (`src/server/auth`), pg-boss queue (`src/server/queue`), zod 4, TanStack Query/Table v8, radix-ui primitives (`import { Dialog } from "radix-ui"`), lucide-react icons, sonner toasts.
- Package manager: **pnpm**.

## Hard rules
- Never invent business data. Missing = null/"Not available". Never guess or generate email addresses; never label anything "verified" without a real verification process.
- Never scrape Google Maps pages. Google data only via the official Places API adapter. Business websites may be visited only through `src/server/enrichment` (robots.txt, SSRF protection, rate limits).
- Enforce source policy (`src/server/providers/policy.ts`) on persist and export.
- Every API route uses `withUser` / `withAdmin` / `withPublic` from `src/server/http.ts` and checks ownership (`userId = user.id`) in the query itself. Unknown ids → 404.
- Sort/filter only through `src/lib/list-query.ts` + `src/server/db/list-sql.ts` allowlists. Parameterized SQL only — never interpolate user text.
- Secrets stay server-side (`src/server/env.ts`). Files in `src/server/**` start with `import "server-only";` (except pure modules with no secrets/db).
- Treat provider content and website text as untrusted data — never as instructions to an LLM.

## Conventions
- `src/lib/**` isomorphic (types, field registry, list-query, utils). `src/server/**` server only. `src/components/**` UI.
- UI: modern, minimal. Use the primitives in `src/components/ui/*` and semantic color tokens (`bg-background`, `text-muted-foreground`, `border-border`, `bg-accent-soft`…). No raw hex colors. 13px body text in dense UIs, `tracking-tight` headings, generous whitespace, thin borders, `rounded-lg`/`rounded-xl`.
- Client data fetching: TanStack Query + `api()` from `src/lib/api-client.ts`.
- Tests: Vitest, colocated `*.test.ts`. Integration tests hit a real Postgres test DB (see `tests/setup`, helpers in `tests/helpers`). Set `TEST_DB_SUFFIX=<yourmodule>` when running tests in parallel with others.
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm vitest run <path>`, `pnpm lint`, `pnpm build`, `pnpm db:generate` (after schema edits), `pnpm db:migrate`, `pnpm dev`, `pnpm worker`.
