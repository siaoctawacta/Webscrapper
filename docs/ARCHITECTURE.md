# Architecture & module contracts

## 1. What the product does

1. **Discover** — the user either pastes a Google Maps link (a *search* link such as
   `https://www.google.com/maps/search/h%C3%B4tel/@6.1433903,1.1657635,12z/...`, a *place* link, or a
   `maps.app.goo.gl` short link) or types *keyword + location*. They choose a capacity:
   20, 40, 60, 100, 500, 1 000, 2 000, 5 000, 10 000 or 20 000 results.
2. A background **search job** reads the link's query + map area (no page scraping), calls the
   provider (Google Places API, or the Sample provider when no key is set), tiles the area into
   smaller cells when more than ~60 results are wanted, de-duplicates by provider ID, normalizes
   fields and stores them in the transient `search_results` working set.
3. **Enrichment**: for each result with a website, our crawler visits the business's own site
   (robots.txt respected) to find published emails, social links, and simple site-health signals
   (HTTPS, mobile viewport, copyright year). Businesses with no website get `website_status = none`.
4. **Results grid**: server-side sort (multi-column), filters, quick search, pagination, column
   chooser, selection; segment tabs **All / No website / Has website**.
5. **Collections**: save selected/filtered results into named collections. Leads carry user-owned
   status, tags and notes; bulk actions update many at once.
6. **Proposals**: personalised email / WhatsApp drafts (templates EN/FR, optional AI polish) using
   only known facts about the business plus the user's sender profile.
7. **Homepage concepts**: for a business without a website, the user enters services and style
   preferences; the AI Gateway returns a structured concept (validated JSON) which we render into a
   safe static HTML preview, downloadable and shareable via an unguessable link.
8. **Exports**: XLSX (3 sheets) / CSV of selected, current page, or all filtered rows, respecting
   source policy, protected against formula injection, via short-lived download links.
9. **Access control**: email/password sign-in; first account = admin; others pending until approved
   (or invited); admins manage users, limits, see usage and audit log.

## 2. Data-source policy (critical)

Implemented in `src/server/providers/policy.ts`. The product owner chose to stay within Google's
terms:

| Data | Google source | Sample source |
|---|---|---|
| Shown in results grid | yes, for `GOOGLE_RESULTS_RETENTION_HOURS` (default 24h), then purged | yes (30 days) |
| Persisted in collections | only `source_record_id` (place ID) and `maps_url`; other provider fields stored NULL and listed in `businesses.restricted_fields` | everything |
| Shown in collections | restricted fields re-loaded **live** via Place Details for the visible page (billed, logged in usage) | stored values |
| Exported | only `source_record_id`, `maps_url` + all app-owned fields | everything |

App-owned fields (origin `enrichment` / `derived` / `user` in `src/lib/fields.ts`) are always
storable and exportable: emails & socials found on the business's own website, website status /
check, quality, lead status, tags, notes.

Attribution "Data from Google Maps" must be shown wherever Google data is displayed.

## 3. Directory map and owners

```
src/lib/                      isomorphic contracts (FOUNDATION — do not change without need)
  domain.ts                   enums, value types (statuses, presets, LatLng/Rect, JobProgress…)
  fields.ts                   field registry: keys, labels, origin, sortable, default columns
  list-query.ts               ?page&page_size&sort&filter[..]&search parsing + allowlists
  api-types.ts                JSON DTOs returned by /api/v1
  api-client.ts               browser fetch wrapper  ·  auth-client.ts  ·  utils.ts
src/server/                   server-only
  env.ts  errors.ts  http.ts  audit.ts  usage.ts  rate-limit.ts  rows.ts   (FOUNDATION)
  db/schema.ts db/index.ts db/list-sql.ts db/migrate.ts                   (FOUNDATION)
  auth/auth.ts auth/session.ts                                            (FOUNDATION)
  queue/index.ts                                                          (FOUNDATION)
  providers/types.ts policy.ts registry.ts                                (FOUNDATION)
  providers/google-places/    Google Places API (New) adapter             (module: google)
  maps-link/                  Google Maps URL parser + short-link resolver(module: google)
  providers/sample/           deterministic sample provider               (module: sample)
  normalize/                  phone/url/email normalization, quality, dedupe (module: sample)
  enrichment/                 SSRF-safe website crawler & extractors      (module: crawler)
  search/                     job creation, estimate, quotas, runner, results query (module: search)
  collections/                collections, leads, bulk actions, hydration (module: collections)
  exports/                    xlsx/csv builders, sanitizer, storage, export runner (module: exports)
  proposals/                  templates EN/FR, AI polish                  (module: proposals)
  concepts/                   concept schema, AI generation, HTML renderer(module: concepts)
  ai/                         AI Gateway wrapper (shared by proposals & concepts) (module: proposals)
  admin/, settings/           user management, invitations, sender profile (module: access)
src/worker/index.ts           pg-boss worker: search.run, export.run, maintenance.cleanup (module: search; exports registers its handler)
src/app/api/v1/**             REST route handlers (each module owns its routes)
src/components/ui/*           primitives (FOUNDATION)
src/components/shell/*        app shell (FOUNDATION)
src/components/data-grid/*    shared server-driven grid (module: grid)
src/components/business/*     business detail sheet, provenance badges, cells (module: grid)
```

**Ownership rule for parallel work:** only create/edit files inside your module's directories and
routes. If you need a change in a FOUNDATION file, make the smallest additive edit and list it in
your report. Do not edit another module's files. Do not add npm packages. Do not generate
migrations (report schema needs instead).

## 4. Module contracts

### 4.1 maps-link (`src/server/maps-link/index.ts`)
Signatures are fixed in the stub. Must handle:
- `/maps/search/<query>/@lat,lng,<zoom>z/...` (percent-encoded, `+` as space, e.g. `h%C3%B4tel` → `hôtel`)
- `/maps/search/?api=1&query=...` and `?q=` / `query=` params
- `/maps/place/<name>/@lat,lng,<zoom>z/data=...!3d<lat>!4d<lng>...` (prefer the `!3d!4d` pin coordinates for the place)
- `/maps/@lat,lng,<zoom>z` (map view, no query) and `@lat,lng,<meters>m` (satellite) forms
- any Google country domain (`google.com`, `google.fr`, `google.tg`, `google.com.gh`, `maps.google.*`)
- short links `maps.app.goo.gl/*`, `goo.gl/maps/*` → `kind: "short"`; `resolveMapsLink` follows
  redirects with `redirect: "manual"`, max 5 hops, only to Google hosts, and handles
  `consent.google.com/...?continue=<url>`.
- Reject non-Google hosts with a friendly `MapsLinkError`.
- `viewportFromZoom(center, zoom)`: meters/px = 156543.03392·cos(lat)/2^zoom; default viewport 1280×800 px.

### 4.2 Google provider (`src/server/providers/google-places/`)
Implements `BusinessProvider` (`src/server/providers/types.ts`) with the **Places API (New)**:
- Text Search: `POST https://places.googleapis.com/v1/places:searchText`, headers `X-Goog-Api-Key`,
  `X-Goog-FieldMask` (only fields we use: `places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.location,places.primaryType,places.primaryTypeDisplayName,places.types,places.businessStatus,nextPageToken`),
  body `{ textQuery, pageSize: 20, pageToken?, locationRestriction: { rectangle: { low, high } }, languageCode? }`.
  Max 20 per page, ~60 (3 pages) per query.
- **Adaptive quadtree tiling** for target > 60: search a cell (≤3 pages); if the cell was saturated
  (a next page token remained after page 3, i.e. ≥60 results) and the cell is larger than ~300 m,
  split into 4 children and queue them (densest first). Stop at target unique count, `maxRequests`,
  area exhausted or abort. Report `tilesDone/tilesTotal` in each `SearchPage`.
- `geocode(location)`: Text Search for the location string with field mask `places.displayName,places.location,places.viewport,places.formattedAddress,places.addressComponents` (pageSize 1).
- `findPlace({name, center})`: Text Search `textQuery=name`, `locationBias` circle 1 km, pageSize 5, best match by name similarity + distance.
- `getDetails(ids)`: `GET https://places.googleapis.com/v1/places/{id}` with the same field mask (without `places.` prefix); bounded concurrency (4).
- Retries: 429/5xx/network → exponential backoff with jitter, max 3 attempts; 400 → `ProviderError("invalid")`; 401/403 → `ProviderError("auth")` (message must say the key/billing is the problem); after retries 429 → `ProviderError("quota")`.
- Call `ctx.onUsage({ operation, requests: 1, costUsd, billable: true })` for **every** HTTP request.
- `estimate(target)`: pages = ceil(target/20); target ≤ 60 → pages; else ceil(pages × 1.6) + 4 for tiling overhead; `maxRequests` = ceil(estimated × 1.5) + 5; cost = requests × textSearchPricePer1000 / 1000; `freeMonthlyRequests: 1000` with a note that this is Google's free monthly allowance for Text Search Enterprise and actual billing is on the user's Google account.
- Map to `ProviderPlace`: category = `primaryTypeDisplayName.text`, categories = `types`, city = `locality`, region = `administrative_area_level_1`, country/countryCode from `country` component, postalCode, mapsUrl = `googleMapsUri`.
- `sourceRecordId` = place `id`.

### 4.3 Sample provider (`src/server/providers/sample/`)
Deterministic (seeded by query + area) fake businesses that look realistic for the searched
location (built-in table of ~25 cities incl. Lomé, Accra, Kumasi, Cotonou, Abidjan, Lagos, Dakar,
Ouagadougou, Paris, London, New York; unknown locations → deterministic coordinates). Phone numbers
in the right national format for the country (+228 Togo, +233 Ghana …). About 45% have no website,
~30% have a website + email (domains under `.example` only), some no phone, a few probable
duplicates (same phone, slightly different name) to exercise dedupe. Supplies `sampleEnrichment`
so sample mode never touches the internet. Emulates paging and tiling (20 per page, tiles) with a
small artificial delay (≈40–120 ms per page, skipped when `process.env.APP_ENV === "test"`). `estimate()` returns 0 cost, `isSample: true`. Names should be plausible ("Hôtel Le Bénin", "Golden Palm Lodge") and clearly fictional. `getDetails` and `findPlace` work over the same generator.

### 4.4 normalize (`src/server/normalize/index.ts`)
Signatures fixed in the stub. Use `libphonenumber-js` (`parsePhoneNumberFromString(raw, countryCode)`) →
`phoneE164` and `phoneDigits` (digits of E.164, else of raw); `phoneRaw` = provider international
format if present else national. `phoneStatus` = `source_provided` if a phone exists and parses as
valid, `needs_review` if present but not valid, else `unknown`. Website: keep original URL, derive
`websiteHost` (lowercase, no `www.`), `websiteStatus` = `none` if no URL else `unknown`. Provider
email → `providerEmail`, `primaryEmail`, `emailOrigin: "provider"`, `emailStatus: "source_provided"`.
`computeQuality`: issues among `missing_name`, `missing_phone`, `missing_address`, `missing_category`,
`invalid_phone`, `website_unreachable`, `email_needs_review`; status `complete` if no issues among
name/phone/address/category, `needs_review` if invalid_phone or website_unreachable or
email_needs_review, else `incomplete`; `duplicate_candidate` is set by the search runner.
`findProbableDuplicates`: same E.164 phone, or same normalized website host, or (name similarity ≥ 0.9
and distance < 80 m). Never merges — only flags.

### 4.5 enrichment (`src/server/enrichment/index.ts`)
`enrichWebsite(url, opts)` — signature fixed in stub:
- Only `http(s)`, default ports. Resolve DNS and **block private/loopback/link-local/reserved IPs**
  (ipaddr.js `range() === "unicast"` only) on every hop (manual redirects, max 5) unless
  `opts.allowPrivateNetwork` (tests). Connect to the validated IP (undici `Agent` with custom
  `connect.lookup`) to avoid DNS rebinding.
- Fetch and honour `robots.txt` (robots-parser; UA token `LeadFinderBot`); disallowed → `status: "blocked_by_robots"`.
- Timeout `CRAWL_TIMEOUT_MS`, max 1.5 MB body, only `text/html`/`application/xhtml+xml`.
- Homepage + up to `maxPages-1` same-site contact/about pages (links whose href/text match
  `contact|contacts|contactez|nous-contacter|kontakt|about|a-propos|qui-sommes-nous|impressum`).
- Extract: `mailto:` links, visible text emails, Cloudflare `data-cfemail` decoding, `[at]`/`(at)`
  obfuscation; drop asset-like (`.png`, `@2x`, etc.), placeholders (`example.com`, `domain.com`,
  `email.com`, `yourname@`, `sentry`, `wixpress`), and invalid TLDs. Rank same-domain first. Max 5.
- Socials: facebook, instagram, linkedin, x/twitter, tiktok, youtube, WhatsApp (`wa.me`, `api.whatsapp.com/send?phone=`).
- `tel:` links → `phones`.
- Site check: final URL, status, https, viewport meta, `<title>`, latest `© YEAR`/`Copyright YEAR`, load time, pages visited.
- Optional MX check through `opts.resolveMx` (default `dns.promises.resolveMx`); if the best email's domain has no MX → caller sets `emailStatus = needs_review` (expose via result: emails keep order; add nothing invented).
- Never throws for site problems — returns `status: "unreachable" | "error"` with a short message.
User-Agent: `LeadFinderBot/1.0 (+${APP_URL}/bot)`.

### 4.6 search (`src/server/search/`, `src/worker/`, routes)
- `createSearchJob(user, input)` — validates (zod), resolves the link (`resolveMapsLink`) or
  geocodes keyword+location via provider, clamps `targetCount` to the user's limit
  (`user_settings.max_results_per_search` ?? `MAX_RESULTS_PER_SEARCH`), checks quotas
  (concurrent jobs per user, jobs per day, monthly billable requests incl. this job's estimate),
  computes estimate; if `estimatedCostUsd > COST_CONFIRM_THRESHOLD_USD` and not `confirm` →
  `HttpError("confirmation_required", ..., { estimate })`. Idempotency via `Idempotency-Key` header.
  Inserts job (status queued, progress), enqueues `search.run`, audits `search.create`.
  Place links create `kind = maps_place_link`, `targetCount = 1`.
- Runner `runSearchJob(jobId)` (worker): status `searching` → stream provider pages → normalize →
  insert with `ON CONFLICT (job_id, source, source_record_id) DO NOTHING` → progress updates
  (throttled ≤ 1/s) + job_events → stop at target/budget/cancel → `enriching` (bounded concurrency
  `CRAWL_CONCURRENCY`, cancel-aware, per-host politeness) → duplicate & quality pass → terminal
  status (`completed`, `partial` with `stopReason`, `failed` with `error`, `cancelled`) and
  `resultsExpireAt = now + policy.transientRetentionHours`. Usage recorded per provider request.
  Sample results use `sampleEnrichment` instead of crawling.
- Maintenance (cron every 10 min): purge expired `search_results` (set `results_purged_at`), delete
  expired export files (status `expired`), null Google coords on `businesses` past `coords_expire_at`,
  clear old `rate_limits`.
- Results query: `listSearchResults(user, jobId, query)` → `ListResponse` (ownership enforced,
  facets: categories top 50, cities top 30, websiteStatus counts), `listSearchResultIds(...)`.

### 4.7 collections (`src/server/collections/`)
- CRUD; `addToCollection(user, collectionId, { jobId, resultIds } | { jobId, query })` upserts
  `businesses` (per user, per source record) applying policy (`nonPersistableFields` stored NULL +
  `restricted_fields`), copies app-owned enrichment, inserts leads (skip existing), returns counts.
- `listLeads(user, collectionId, query)` → `ListResponse` using `COLLECTION_GRID`; then
  `hydrateRows(user, rows)` fills restricted fields live via `provider.getDetails` for Google rows
  (only for the current page; mark `liveFields`; if no key/error, leave null and keep `restrictedFields`).
  Facets include tags and lead statuses.
- `updateLead(user, leadId, { status?, tags?, notes? })`; `bulkLeads(user, collectionId, selector, action)`
  where selector = `{ leadIds }` or `{ query }` (all filtered, ≤ `MAX_BULK_ROWS`) and action ∈
  `set_status | add_tags | remove_tags | replace_tags | copy_to | move_to | remove`. Single SQL
  statements per action, transaction, audit `collection.bulk` with counts.
- Tags: trimmed, lowercased? **No** — keep user casing, dedupe case-insensitively, max 30 tags × 40 chars.

### 4.8 exports (`src/server/exports/`)
- `createExport(user, input)` validates columns against the field registry + context, snapshots the
  query; scope `selected` (ids ≤ 20 000), `page`, `filtered` (≤ 20 000). Enqueue `export.run`.
- Runner builds rows via the search/collection list functions (page through in sorted order),
  drops non-exportable fields per row source (report in `excluded_fields` and the Data Quality
  sheet), sanitises every string cell (prefix `'` when it starts with `= + - @`, tab or CR; strip
  control chars), phones/postal codes/IDs as text, UTF-8 CSV with BOM, XLSX sheets
  **Business Data** (frozen header, autofilter, widths), **Search Summary** (query, location,
  provider, generated at, rows found/exported, filters, sort, limitations, attribution),
  **Data Quality** (missing-field counts, duplicates, verification statuses, exclusions).
- Files under `EXPORT_STORAGE_DIR/<userId>/<exportId>.<ext>`; `expires_at = now + 24h`.
- `GET /exports/{id}` returns `downloadUrl` = `/api/v1/exports/{id}/download?token=…` where token is
  random, stored hashed, valid `EXPORT_LINK_TTL_MINUTES`; download checks owner + token + expiry,
  streams with `Content-Disposition`, audits `export.download`. Re-check policy at download.

### 4.9 proposals & AI (`src/server/proposals/`, `src/server/ai/`)
- `ai/gateway.ts`: `generateStructured({ schema, system, prompt, userId, operation })` using AI SDK
  `generateText` + `Output.object`, model `env().AI_MODEL` (gateway string). Enforces
  `AI_DAILY_LIMIT_PER_USER`, records usage, timeouts, returns null-safe errors. Untrusted business
  data goes inside a clearly delimited JSON block with an instruction to treat it as data.
- Templates EN + FR for every topic, personalised from known facts only (name, category, city,
  rating, review count, website issues from `websiteCheck`, no-website status) + sender profile.
  Missing facts → sentence omitted, never invented.
- `draftProposal(user, { ref: { kind: "result" | "lead", id }, topic, language, customService?, useAi? })`
  → `ProposalDraft`. `saveProposal(user, {..., channel})` logs it and, for leads, sets status
  `proposal_sent` (unless already further along) and `last_contacted_at`.
- WhatsApp: `whatsappNumber` = E.164 digits when the phone parses; the UI builds `https://wa.me/<digits>?text=`.

### 4.10 concepts (`src/server/concepts/`)
- zod `ConceptContent` schema: siteTitle, tagline, hero {headline, subheadline, primaryCta, secondaryCta?},
  about {heading, body}, services [{title, description}] (≤ 8), highlights [{title, description}] (no
  invented numbers), testimonialsNote (placeholder guidance only — never fake quotes), gallery
  {ideas: string[]}, contact {heading, body}, palette {primary, secondary, accent, background,
  surface, text} (hex validated), typography {pairing: one of an allowlist}, seo {title,
  metaDescription}, sections order.
- `generateConcept(user, { ref, services, style, tone, colors?, language, notes? })` → AI if
  configured else deterministic template; stored in `concepts`.
- `renderConceptHtml(content, facts)` → complete standalone HTML string, all text escaped, CSS
  inline, no scripts, phone/WhatsApp/map links only from known facts. Served:
  `GET /api/v1/concepts/{id}/html` (owner, download) and public `GET /c/{token}` (only when
  `share_enabled`), both with CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'` and `X-Robots-Tag: noindex`.

### 4.11 access (`src/server/admin/`, `src/server/settings/`, auth pages)
- Pages `/sign-in`, `/sign-up`, `/pending` (status explanation, sign out).
- Admin: list users (role, status, created, last seen, usage this month), approve / disable /
  re-enable / change role (not yourself, not the last admin), set per-user `max_results_per_search`
  and `monthly_request_limit`; disabling deletes that user's sessions. Invitations (create/revoke).
  Usage page (requests & estimated cost by user, month), audit log (paginated, filter by action).
- Settings: sender profile + default language; grid prefs stored via `PUT /api/v1/me/grid-prefs`.

## 5. REST API (`/api/v1`)

All JSON. Errors: `{ error: { code, message, details? } }` (see `src/lib/api-types.ts`).

| Method | Path | Body / query → response |
|---|---|---|
| POST | `/maps-links/parse` | `{ url }` → `ParsedMapsLinkDto` |
| POST | `/search-jobs/estimate` | same body as create → `CostEstimate` |
| POST | `/search-jobs` | `{ mapsUrl? , query?, location?: string, targetCount, enrich?, filters?, sort?, fields?, confirm? }` → 201 `SearchJobDto` · 409 `confirmation_required` (details.estimate) |
| GET | `/search-jobs` | `?page` → `{ jobs: SearchJobDto[], total }` |
| GET | `/search-jobs/{id}` | → `SearchJobDto` (+counts) |
| POST | `/search-jobs/{id}/cancel` | → `SearchJobDto` |
| DELETE | `/search-jobs/{id}` | → 204 (deletes job + results) |
| GET | `/search-jobs/{id}/results` | list query → `ListResponse` |
| GET | `/search-jobs/{id}/results/ids` | list query → `{ ids: string[], total, truncated }` |
| GET | `/search-jobs/{id}/results/{resultId}` | → `BusinessRow` |
| GET/POST | `/collections` | → `{ collections: CollectionDto[] }` / `{ name, description? }` → 201 `CollectionDto` |
| GET/PATCH/DELETE | `/collections/{id}` | `CollectionDto` / `{ name?, description? }` / 204 |
| GET | `/collections/{id}/leads` | list query → `ListResponse` (hydrated) |
| POST | `/collections/{id}/leads` | `{ jobId, resultIds?: string[], query?: ListQuery }` → `{ added, skipped }` |
| POST | `/collections/{id}/leads/bulk` | `{ leadIds?: string[], query?: ListQuery, action, status?, tags?, targetCollectionId? }` → `{ affected }` |
| GET | `/collections/{id}/leads/ids` | list query → `{ ids, total, truncated }` |
| PATCH/DELETE | `/leads/{id}` | `{ status?, tags?, notes? }` → `BusinessRow` / 204 |
| POST | `/exports` | `{ target, jobId?, collectionId?, format, scope, columns, includeAnnotations?, query, rowIds? }` → 202 `ExportDto` |
| GET | `/exports`, `/exports/{id}` | `{ exports: ExportDto[] }`, `ExportDto` (with `downloadUrl` when ready) |
| GET | `/exports/{id}/download?token=` | file |
| POST | `/proposals/draft` | `{ ref: { kind, id }, topic, language, customService?, useAi? }` → `ProposalDraft` |
| POST | `/proposals` | `{ ref?, topic, language, subject, body, channel, generatedBy }` → 201 |
| GET | `/proposals` | `?ref_kind&ref_id` → `{ proposals }` |
| GET/POST | `/concepts` | `{ concepts }` / `{ ref, services, style, tone, colors?, language, notes? }` → 201 concept |
| GET/PATCH/DELETE | `/concepts/{id}` | concept / `{ content?, shareEnabled? }` / 204 |
| GET | `/concepts/{id}/html` | HTML download |
| GET | `/c/{token}` (not under /api) | public shared concept page |
| GET/PUT | `/me/settings` | `SenderProfile` |
| GET/PUT | `/me/grid-prefs` | `{ results?: GridPrefs, collection?: GridPrefs }` |
| GET | `/me` | `MeDto` + limits + usage this month |
| GET | `/usage` | own usage by month/operation (admins: `?all=1`) |
| GET/PATCH | `/admin/users`, `/admin/users/{id}` | list / `{ status?, role?, maxResultsPerSearch?, monthlyRequestLimit? }` |
| GET/POST/DELETE | `/admin/invitations[/{id}]` | |
| GET | `/admin/audit` | `?page&action` |

## 6. UI map

- `/search` — big link box ("Paste a Google Maps link") + alternative "Keyword + location" tab,
  capacity selector, enrich toggle, parsed-link preview chip, live cost estimate, start → `/searches/{id}`.
- `/searches` — history list with status, counts, expiry. `/searches/{id}` — progress (phase, found,
  tiles, enrichment), cancel, segment tabs All / No website / Has website, grid toolbar (quick
  search, filters, columns, sort chips, page size), selection bar (Save to collection, Export,
  Proposal), row actions (details, proposal, concept for no-website, open in Maps), attribution.
- `/collections`, `/collections/{id}` — same grid + lead status / tags / notes, bulk action bar.
- `/concepts`, `/concepts/{id}` — form left, sandboxed iframe preview right, share toggle, download.
- `/settings` — sender profile. `/admin` — users, invitations, usage, audit.

## 7. Testing

- Unit: parser, provider mapping/tiling (fixtures, mocked fetch), normalization, crawler extraction
  (local HTTP server with `allowPrivateNetwork`), sanitizer, templates, renderer escaping.
- Integration (real Postgres): route handlers called directly with `tests/helpers/request.ts` and
  users from `tests/helpers/auth.ts`; ownership (other user → 404), validation (422), quotas.
- E2E (Playwright, sample mode): sign up → search → sort/filter → select → save to collection → bulk
  → proposal → concept → export → download.
