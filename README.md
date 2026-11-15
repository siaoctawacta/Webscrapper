# LeadFinder

Find businesses from a Google Maps link (or keyword + place), see who has a website and who doesn't,
save leads into collections, write proposals, draft AI homepage concepts, and export to Excel/CSV.

Built for web designers and agencies prospecting local businesses — English and French.

## What it does

| | |
|---|---|
| **Paste a Google Maps link** | Copy the address bar of any Google Maps search (e.g. `…/maps/search/hôtel/@6.14,1.16,12z`), a place link, or a `maps.app.goo.gl` share link. The app reads the search term and map area from the link and runs the same search through Google's **official Places API** — it never scrapes Google Maps pages. |
| **Keyword + place** | "hotel" + "Lomé, Togo" works too. |
| **20 → 20,000 results** | Pick 20, 40, 60, 100, 500, 1,000, 2,000, 5,000, 10,000 or 20,000. Google returns at most ~60 results per query, so large searches split the map into smaller squares automatically (each square is a billed request; you see an estimate and confirm big searches first). You get as many businesses as actually exist in the area. |
| **Contact details** | Name, category, phone, website, address, rating, reviews, Google Maps link. Emails and social links come only from the business's **own website** (we visit it, respecting robots.txt). Emails are never guessed and never labelled "verified". |
| **Website / no website** | Results are split into *All · No website · Has website*. For businesses with a site we also note HTTPS, mobile-friendliness and how old the footer © year is — useful talking points. |
| **Results grid** | Click a heading to sort, Shift+click to add a second sort, filters (has/missing phone, website, email, address; category; city; rating; reviews; data quality…), quick search, column chooser (remembered), 25/50/100 per page, select page or all filtered rows. |
| **Collections** | Save selected or all filtered results into named collections. Each lead has a status (New → Contacted → Proposal sent → Replied → Qualified → Won / Not a fit), tags and notes. Bulk actions: set status, add/remove/replace tags, copy/move to another collection, remove. |
| **Proposals** | One click writes a personal email or WhatsApp message (English or French) for: new website, website redesign, local Google ranking, social media, branding, or your own service — using only facts we actually know. Optional "Polish with AI". Open in your email app or WhatsApp, or copy. |
| **AI homepage concepts** | For a business without a website: enter its services and style preferences, and the AI drafts a homepage (copy, sections, colours). Preview desktop/mobile, edit the copy, download the HTML, or share a private link with the prospect. |
| **Export** | XLSX (sheets: Business Data, Search Summary, Data Quality) or UTF-8 CSV. Selected rows, current page, or all filtered rows; your columns and sort order. Phone numbers keep their `+` and leading zeros; cells are protected against spreadsheet formula injection; download links expire after 15 minutes. |
| **Access control** | Email + password sign-in. The first account becomes the admin (in production it needs the server's `SETUP_TOKEN`). Everyone else waits for approval, or joins through a personal invite link. Admins approve/disable people, set per-person limits, and see usage, estimated cost and an audit log. |

## Documentation (français)

- [Guide d’utilisation (PDF)](docs/LeadFinder-Guide-utilisateur.pdf) — search, results, collections, proposals, homepage concepts, export, admin.
- [Documentation technique (PDF)](docs/LeadFinder-Documentation-technique.pdf) — step-by-step deployment on a VPS with Docker, Google/AI setup, configuration reference, operations, security, troubleshooting.
- Sources in `docs/manuals/` (HTML + screenshots); rebuild with `node docs/manuals/build.cjs`.

## Data sources and what is stored (please read)

The app follows Google Maps Platform terms by default:

- **Search results** from Google are kept for **24 hours** (`GOOGLE_RESULTS_RETENTION_HOURS`) so you can sort, filter and review them, then deleted automatically.
- **Saved leads** keep only Google's place ID and Maps link, plus everything that is yours: emails and social links found on the business's website, website status, your status/tags/notes, proposals and concepts. Names, phones, addresses and ratings are **re-loaded live from Google** when you open a collection (billed per lead shown; usage is logged).
- **Exports** of Google-sourced rows contain the Google Maps link, place ID and your own fields; Google's names/phones/addresses/ratings are left out, and the export's *Data Quality* sheet says why.
- Without a Google key the app runs in **Sample data mode**: realistic, clearly-labelled fake businesses (`.example` websites) that can be stored and exported freely — handy for trying everything out.

If you hold a different agreement with Google or switch to a licensed data provider that allows storage and bulk export, change `src/server/providers/policy.ts` deliberately (it's one place, enforced on save and export). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-data-source-policy-critical).

### Compliance checklist

- [x] Google data only through the official Places API (New), with field masks limited to the fields we use.
- [x] No scraping of Google Maps pages; no CAPTCHA or rate-limit circumvention. Map tiling stays inside your quota and every request is billed and logged.
- [x] Source policy enforced in the backend on retention, save and export; attribution "Data from Google Maps" shown with Google data.
- [x] Website visits: robots.txt respected (RFC 9309), polite rate limits, a clear User-Agent, private-network (SSRF) protection, small page budget per site.
- [x] Emails only when published by the business itself; never inferred; status "source-provided", never "verified".
- [x] AI only through allowlisted backend functions with schema-validated output; business/website text is treated as untrusted data; daily AI limits per user.
- [x] Keys server-side only; per-user ownership checks on every endpoint; audit log of searches, saves, exports, downloads and admin actions.
- [x] No email address alone grants access: the first admin needs `SETUP_TOKEN`, invitations need their secret link; sign-in attempts are limited per account.
- [x] Live Google lookups in collections count against each person's monthly request limit.
- [ ] **Your part:** review local privacy and marketing laws (e.g. Togo's 2019 personal data law, Ghana's Data Protection Act 2012, GDPR for EU contacts) before contacting people, and honour opt-outs.

## Quick start (local)

Requirements: Node 22+, pnpm 10, PostgreSQL 16.

```bash
pnpm install
```

```bash
cp .env.example .env.local   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
```

```bash
pnpm db:migrate
```

Run the web app and the background worker (two terminals):

```bash
pnpm dev
```

```bash
pnpm worker
```

Open http://localhost:3000 and sign up — the first account becomes the admin. (In production, set `SETUP_TOKEN` and create the first account at `/sign-up?setup=<SETUP_TOKEN>`.)

`pnpm dev`, `pnpm worker`, `pnpm db:migrate` and `pnpm user:set-password` all read `.env.local` first, then `.env`.

### Using Supabase (or another hosted Postgres)

1. In Supabase, open **Connect** and copy the **Session pooler** connection string (`postgres.<ref>@aws-…pooler.supabase.com:5432`). Don't use the *Direct connection* host `db.<ref>.supabase.co`: it only answers over IPv6, and most home networks and many servers fail with `getaddrinfo ENOTFOUND`.
2. Put your database password in place of `[YOUR-PASSWORD]` (URL-encode special characters: `@` → `%40`, `#` → `%23`, `/` → `%2F`) and add `?uselibpqcompat=true&sslmode=require` at the end:

   ```
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?uselibpqcompat=true&sslmode=require
   DB_POOL_MAX=5
   QUEUE_POOL_MAX=4
   ```

3. Run `pnpm db:migrate`, then restart `pnpm dev` and `pnpm worker`.

If the database can't be reached, the worker and `pnpm db:migrate` print the likely cause and the fix (wrong host, paused project, wrong password, SSL setting…), and the sign-in page says the server has a problem instead of showing a misleading message.

### Turning on real data (Google Places API)

1. In Google Cloud, create a project with billing enabled and enable **Places API (New)**.
2. Create an API key restricted to *Places API (New)* (and, in production, to your server's IP).
3. Set `GOOGLE_MAPS_API_KEY` and restart the app and worker. Set budget alerts in Google Cloud.
4. Adjust `GOOGLE_TEXT_SEARCH_PRICE_PER_1000` if your pricing differs (estimates only — the real bill is in Google Cloud).

### Turning on AI (Vercel AI Gateway)

Set `AI_GATEWAY_API_KEY` (and optionally `AI_MODEL`, default `anthropic/claude-sonnet-5.5`). Without it, proposals and homepage concepts use built-in templates.

## Docker

```bash
cp .env.example .env
```

```bash
docker compose up --build
```

This starts Postgres, runs migrations, then the web app and the worker behind a Caddy reverse proxy on ports 80/443 (set `DOMAIN` in `.env` for automatic HTTPS). Create the first admin at `/sign-up?setup=<SETUP_TOKEN>`.

## Configuration

All settings are in [.env.example](.env.example) with comments: sign-up mode (`approval` / `invite` / `closed`), admin emails, per-search and monthly limits, the cost-confirmation threshold, crawler limits, export link lifetime.

## Development

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build && pnpm test:e2e
```

```bash
pnpm lint
```

Tests use a separate Postgres database (`leadfinder_test`) that is recreated on each run. Architecture, module contracts and the API reference are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deployment checklist

- [ ] Managed Postgres with backups; `DATABASE_URL` set.
- [ ] `APP_URL` = your public https URL; `BETTER_AUTH_SECRET` = strong random secret.
- [ ] Run `pnpm db:migrate` on each release before starting new web/worker processes.
- [ ] Run at least one `pnpm worker` process next to the web app; give both the same `EXPORT_STORAGE_DIR` (shared volume) or one host.
- [ ] `SETUP_TOKEN` set; create your admin account at `/sign-up?setup=<SETUP_TOKEN>` right after deploying.
- [ ] `SIGNUP_MODE=invite` or `approval`. Invite people from Admin → Invitations and send them their personal link.
- [ ] Run behind a reverse proxy that overwrites `X-Forwarded-For` (the bundled Caddy does), or set `CLIENT_IP_HEADER` to your platform's client-IP header.
- [ ] Set a strong `POSTGRES_PASSWORD` before the first `docker compose up` (Docker only).
- [ ] Password resets (no email sending): `pnpm user:set-password <email> '<new password>'` on the server.
- [ ] Google key restricted by API and IP; billing alerts and quotas configured in Google Cloud.
- [ ] HTTPS in front of the app (cookies are `Secure` automatically when `APP_URL` is https).
- [ ] Log shipping and uptime monitoring for both processes.

## Limitations

- **Not yet verified against the live Google Places API or AI Gateway.** Both integrations follow the official documentation and are covered by tests with recorded/mock responses, but this build was developed without network access to Google or the AI Gateway. Run one small search (20 results) after adding your key and check the results before running large ones.

- Google returns at most ~60 results per query; very large targets rely on map tiling, and the real number depends on how many businesses Google lists in the area.
- Saved Google leads show names/phones only while the Google key works (they're loaded live); sorting/filtering by those fields inside collections only works for sources that allow storage.
- Email discovery depends on businesses publishing an address on their own website; many small businesses don't have one.
- No automated bulk sending — you send each proposal yourself from your email app or WhatsApp.
