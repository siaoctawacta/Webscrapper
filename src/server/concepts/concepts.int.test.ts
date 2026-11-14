import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { BusinessRow } from "@/lib/api-types";
import { createTestUser, type TestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../tests/helpers/request";
import { closeDb, db } from "@/server/db";
import { auditLogs, businesses, collections, concepts, leads, userSettings } from "@/server/db/schema";
import * as listRoute from "@/app/api/v1/concepts/route";
import * as itemRoute from "@/app/api/v1/concepts/[id]/route";
import * as regenerateRoute from "@/app/api/v1/concepts/[id]/regenerate/route";
import * as htmlRoute from "@/app/api/v1/concepts/[id]/html/route";
import * as prefillRoute from "@/app/api/v1/concepts/prefill/route";
import * as publicRoute from "@/app/c/[token]/route";
import type { AppUser } from "@/server/auth/session";
import { generateConcept } from "./service";
import type { ConceptDto, ConceptGenerateResponse, ConceptListResponse, ConceptPrefillDto, CreateConceptBody } from "./schema";
import { CONCEPT_CSP } from "./serve";
import { STYLE_PALETTES } from "./design";

/* The business loader belongs to another module: fake it, with ownership enforced per user. */
const fake = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));
vi.mock("@/server/business-ref", async () => {
  const { notFound } = await import("@/server/errors");
  return {
    loadBusinessRef: vi.fn(async (user: { id: string }, ref: { kind: string; id: string }) => {
      const row = fake.rows.get(`${user.id}:${ref.kind}:${ref.id}`);
      if (!row) throw notFound("Business");
      return row;
    }),
  };
});

function businessRow(over: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: crypto.randomUUID(),
    source: "sample",
    sourceRecordId: "sample:1",
    name: "Hôtel Le Bénin",
    category: "Hotel",
    categories: ["hotel"],
    phone: "+228 90 12 34 56",
    phoneE164: "+22890123456",
    phoneStatus: "source_provided",
    website: null,
    websiteHost: null,
    websiteStatus: "none",
    websiteCheck: null,
    email: null,
    emails: [],
    emailOrigin: null,
    emailStatus: "unknown",
    socials: { whatsapp: "https://wa.me/22890123456" },
    address: "Boulevard du 13 Janvier",
    city: "Lomé",
    region: "Maritime",
    country: "Togo",
    postalCode: null,
    lat: 6.13,
    lng: 1.22,
    rating: 4.4,
    reviewCount: 120,
    mapsUrl: "https://www.google.com/maps/place/?q=place_id:abc",
    businessStatus: "OPERATIONAL",
    qualityStatus: "complete",
    qualityIssues: [],
    duplicateOfId: null,
    aiCategory: null,
    retrievedAt: new Date().toISOString(),
    enrichedAt: null,
    lastVerifiedAt: null,
    restrictedFields: [],
    liveFields: [],
    ...over,
  };
}

function own(u: TestUser, kind: "result" | "lead", row: BusinessRow) {
  fake.rows.set(`${u.id}:${kind}:${row.id}`, row);
  return row;
}

const body = (refId: string, over: Partial<CreateConceptBody> = {}): CreateConceptBody => ({
  ref: { kind: "result", id: refId },
  services: ["Rooms", "Restaurant", "Airport pick-up"],
  style: "elegant",
  tone: "luxury",
  language: "en",
  businessType: "Hotel",
  contact: { businessName: "Hôtel Le Bénin", phone: "+228 90 12 34 56", whatsapp: "", city: "Lomé", mapsUrl: "https://www.google.com/maps/place/?q=place_id:abc" },
  ...over,
});

const asAppUser = (u: TestUser): AppUser => ({ id: u.id, email: u.email, name: "Test", role: "member", status: "active" });

async function create(u: TestUser, over: Partial<CreateConceptBody> = {}) {
  const row = own(u, "result", businessRow());
  const res = await listRoute.POST(apiRequest("/api/v1/concepts", { method: "POST", user: u, body: body(row.id, over) }), ctx({}));
  expect(res.status).toBe(201);
  return (await res.json()) as ConceptGenerateResponse;
}

const patch = (u: TestUser, id: string, b: unknown) =>
  itemRoute.PATCH(apiRequest(`/api/v1/concepts/${id}`, { method: "PATCH", user: u, body: b }), ctx({ id }));
const getPublic = (token: string, ip = "203.0.113.7") =>
  publicRoute.GET(apiRequest(`/c/${token}`, { headers: { "x-forwarded-for": ip } }), ctx({ token }));

let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await resetDb();
  fake.rows.clear();
  alice = await createTestUser();
  bob = await createTestUser();
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/v1/concepts", () => {
  it("creates a template concept (AI not configured) from the user-confirmed form", async () => {
    const c = await create(alice);
    expect(c.generatedBy).toBe("template");
    expect(c.model).toBeNull();
    expect(c.warnings).toEqual([]);
    expect(c.businessName).toBe("Hôtel Le Bénin");
    expect(c.ref).toEqual({ kind: "result", id: expect.any(String) });
    expect(c.style).toBe("elegant");
    expect(c.content.palette).toEqual(STYLE_PALETTES.elegant);
    expect(c.content.siteTitle).toBe("Hôtel Le Bénin");
    expect(c.shareEnabled).toBe(false);
    expect(c.sharePath).toBeNull();
    // Stored input: the ref + the form values (empty WhatsApp dropped), nothing copied from the listing.
    const [row] = await db().select().from(concepts).where(eq(concepts.id, c.id));
    expect(row!.input).toMatchObject({ ref: c.ref, contact: { businessName: "Hôtel Le Bénin", city: "Lomé" } });
    expect((row!.input as { contact: Record<string, unknown> }).contact.whatsapp).toBeUndefined();
    expect(row!.leadId).toBeNull();
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "concept.create"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.resourceId).toBe(c.id);
  });

  it("422 on invalid input", async () => {
    const row = own(alice, "result", businessRow());
    for (const bad of [
      body(row.id, { services: [] }),
      body(row.id, { style: "neon" as "modern" }),
      body(row.id, { primaryColor: "red" }),
      body(row.id, { contact: { businessName: "" } }),
      body(row.id, { contact: { businessName: "X", mapsUrl: "javascript:alert(1)" } }),
      body(row.id, { notes: "x".repeat(1001) }),
      { ...body(row.id), ref: { kind: "result", id: "not-a-uuid" } },
    ]) {
      const res = await listRoute.POST(apiRequest("/api/v1/concepts", { method: "POST", user: alice, body: bad }), ctx({}));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_failed");
    }
  });

  it("404 for a business the user can't see", async () => {
    const bobs = own(bob, "result", businessRow());
    const res = await listRoute.POST(apiRequest("/api/v1/concepts", { method: "POST", user: alice, body: body(bobs.id) }), ctx({}));
    expect(res.status).toBe(404);
    expect(await db().select().from(concepts)).toHaveLength(0);
  });

  it("links lead concepts to the lead and its business", async () => {
    const [col] = await db().insert(collections).values({ userId: alice.id, name: "Lomé hotels" }).returning();
    const [biz] = await db().insert(businesses).values({ userId: alice.id, source: "sample", sourceRecordId: "sample:9" }).returning();
    const [lead] = await db().insert(leads).values({ collectionId: col!.id, businessId: biz!.id, userId: alice.id }).returning();
    own(alice, "lead", businessRow({ id: lead!.id, businessId: biz!.id }));
    const res = await listRoute.POST(
      apiRequest("/api/v1/concepts", { method: "POST", user: alice, body: { ...body(lead!.id), ref: { kind: "lead", id: lead!.id } } }),
      ctx({}),
    );
    expect(res.status).toBe(201);
    const c = (await res.json()) as ConceptDto;
    const [row] = await db().select().from(concepts).where(eq(concepts.id, c.id));
    expect(row!.leadId).toBe(lead!.id);
    expect(row!.businessId).toBe(biz!.id);
  });

  it("rate limits generation to 20 per minute", async () => {
    const row = own(alice, "result", businessRow());
    const statuses: number[] = [];
    // Fixed one-minute windows: 41 requests overflow at least one window even if they straddle a boundary.
    for (let i = 0; i < 41; i++) {
      const res = await listRoute.POST(apiRequest("/api/v1/concepts", { method: "POST", user: alice, body: body(row.id) }), ctx({}));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 201 || s === 429)).toBe(true);
  });

  it("401 when signed out", async () => {
    const res = await listRoute.GET(apiRequest("/api/v1/concepts"), ctx({}));
    expect(res.status).toBe(401);
  });
});

describe("AI path (injected generator)", () => {
  it("stores AI content after post-checks, with the model name", async () => {
    const row = own(alice, "result", businessRow());
    const r = await generateConcept(asAppUser(alice), body(row.id), {
      generate: async () => ({
        ok: true,
        model: "test/model",
        data: {
          siteTitle: "Hôtel Le Bénin",
          tagline: "Calm rooms in Lomé",
          hero: { headline: "Rest well in Lomé", subheadline: "Quiet rooms and a good restaurant. Rated 4.9 by 300 guests.", primaryCta: "Call us" },
          about: { heading: "About", body: "A calm hotel." },
          services: [{ title: "Rooms", description: "Quiet rooms." }],
          highlights: [{ title: "Since 1998", description: "Old hotel." }],
          gallery: { ideas: ["The terrace"] },
          contact: { heading: "Contact", body: "Call us." },
          palette: { primary: "#000000", secondary: "#111111", accent: "#222222", background: "#ffffff", surface: "#eeeeee", text: "#dddddd" },
          typography: { pairing: "elegant-serif" },
          seo: { title: "Hôtel Le Bénin", metaDescription: "Hotel in Lomé." },
          sections: ["hero", "services", "contact"],
        },
      }),
    });
    expect(r.generatedBy).toBe("ai");
    expect(r.model).toBe("test/model");
    expect(r.content.hero.subheadline).toBe("Quiet rooms and a good restaurant.");
    expect(r.content.highlights).toEqual([]);
    expect(r.content.palette).toEqual(STYLE_PALETTES.elegant);
    expect(r.warnings.length).toBe(2);
    const [stored] = await db().select().from(concepts).where(eq(concepts.id, r.id));
    expect(stored!.generatedBy).toBe("ai");
    expect(stored!.model).toBe("test/model");
  });
});

describe("GET /api/v1/concepts and /{id}", () => {
  it("lists the user's concepts newest first, never other users'", async () => {
    const first = await create(alice, { contact: { businessName: "First" } });
    const second = await create(alice, { contact: { businessName: "Second" } });
    await create(bob, { contact: { businessName: "Bob's" } });
    const res = await listRoute.GET(apiRequest("/api/v1/concepts", { user: alice }), ctx({}));
    const { concepts: list } = (await res.json()) as ConceptListResponse;
    expect(list.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({ businessName: "Second", style: "elegant", tone: "luxury", generatedBy: "template", shareEnabled: false });
  });

  it("404 for another user's concept and for garbage ids", async () => {
    const c = await create(alice);
    expect((await itemRoute.GET(apiRequest(`/api/v1/concepts/${c.id}`, { user: bob }), ctx({ id: c.id }))).status).toBe(404);
    expect((await itemRoute.GET(apiRequest(`/api/v1/concepts/nope`, { user: alice }), ctx({ id: "nope" }))).status).toBe(404);
    expect((await patch(bob, c.id, { shareEnabled: true })).status).toBe(404);
    expect((await htmlRoute.GET(apiRequest(`/api/v1/concepts/${c.id}/html`, { user: bob }), ctx({ id: c.id }))).status).toBe(404);
    const regen = await regenerateRoute.POST(apiRequest(`/api/v1/concepts/${c.id}/regenerate`, { method: "POST", user: bob, body: {} }), ctx({ id: c.id }));
    expect(regen.status).toBe(404);
    const del = await itemRoute.DELETE(apiRequest(`/api/v1/concepts/${c.id}`, { method: "DELETE", user: bob }), ctx({ id: c.id }));
    expect(del.status).toBe(404);
    const ok = await itemRoute.GET(apiRequest(`/api/v1/concepts/${c.id}`, { user: alice }), ctx({ id: c.id }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ConceptDto).content.siteTitle).toBe("Hôtel Le Bénin");
  });
});

describe("PATCH /api/v1/concepts/{id}", () => {
  it("edits copy with validation", async () => {
    const c = await create(alice);
    const content = { ...c.content, hero: { ...c.content.hero, headline: "  A calm stay in Lomé  " }, tagline: "Rest, eat, explore" };
    const res = await patch(alice, c.id, { content });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ConceptDto;
    expect(updated.content.hero.headline).toBe("A calm stay in Lomé");
    expect(updated.content.tagline).toBe("Rest, eat, explore");

    for (const bad of [
      { content: { ...c.content, hero: { ...c.content.hero, headline: "" } } },
      { content: { ...c.content, palette: { ...c.content.palette, primary: "red" } } },
      { content: { ...c.content, sections: ["hero", "pricing"] } },
      { content: { ...c.content, seo: { ...c.content.seo, title: "x".repeat(61) } } },
      {},
    ]) {
      expect((await patch(alice, c.id, bad)).status).toBe(422);
    }
  });

  it("saves edited contact details (used by the renderer) without regenerating", async () => {
    const c = await create(alice);
    const { ref: _ref, ...options } = c.input!;
    const res = await patch(alice, c.id, { input: { ...options, contact: { ...options.contact, businessName: "Hôtel Le Bénin Plage", email: "hello@benin.example" } } });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ConceptDto;
    expect(updated.businessName).toBe("Hôtel Le Bénin Plage");
    expect(updated.input?.ref).toEqual(c.ref);
    expect(updated.content).toEqual(c.content);
    const html = await (await htmlRoute.GET(apiRequest(`/api/v1/concepts/${c.id}/html`, { user: alice }), ctx({ id: c.id }))).text();
    expect(html).toContain('href="mailto:hello@benin.example"');
  });
});

describe("sharing", () => {
  it("creates the token once; public page only while sharing is on, with strict headers", async () => {
    const c = await create(alice);
    const [before] = await db().select().from(concepts).where(eq(concepts.id, c.id));
    expect(before!.shareToken).toBeNull();

    const on = (await (await patch(alice, c.id, { shareEnabled: true })).json()) as ConceptDto;
    expect(on.shareEnabled).toBe(true);
    expect(on.sharePath).toMatch(/^\/c\/[A-Za-z0-9_-]{24}$/);
    const token = on.sharePath!.slice(3);

    const page = await getPublic(token);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toBe(CONCEPT_CSP);
    expect(CONCEPT_CSP).toContain("default-src 'none'");
    expect(CONCEPT_CSP).toContain("frame-ancestors 'self'");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("private, max-age=60");
    const html = await page.text();
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/<script/i);

    // Disabling hides the page; re-enabling restores the same link.
    await patch(alice, c.id, { shareEnabled: false });
    const hidden = await getPublic(token);
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("content-security-policy")).toBe(CONCEPT_CSP);
    expect(await hidden.text()).toContain("This concept isn’t available");
    const again = (await (await patch(alice, c.id, { shareEnabled: true })).json()) as ConceptDto;
    expect(again.sharePath).toBe(on.sharePath);

    const audits = await db().select().from(auditLogs).where(and(eq(auditLogs.action, "concept.share"), eq(auditLogs.resourceId, c.id)));
    expect(audits.map((a) => (a.metadata as { enabled: boolean }).enabled)).toEqual([true, false, true]);
  });

  it("404 for a never-shared concept, unknown or malformed tokens", async () => {
    await create(alice);
    expect((await getPublic("A".repeat(24))).status).toBe(404);
    expect((await getPublic("short")).status).toBe(404);
    expect((await getPublic("../../etc/passwd")).status).toBe(404);
  });

  it("rate limits the public page per IP", async () => {
    const c = await create(alice);
    const token = ((await (await patch(alice, c.id, { shareEnabled: true })).json()) as ConceptDto).sharePath!.slice(3);
    const statuses: number[] = [];
    // 121 requests overflow at least one one-minute window even across a boundary.
    for (let i = 0; i < 121; i++) statuses.push((await getPublic(token, "198.51.100.9")).status);
    expect(statuses).toContain(429);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
    const limited = statuses.indexOf(429);
    expect(limited).toBeGreaterThanOrEqual(60);
    expect((await getPublic(token, "198.51.100.10")).status).toBe(200);
  });

  it("shows the sender's company as the footer credit", async () => {
    await db().insert(userSettings).values({ userId: alice.id, senderCompany: "Studio Kekeli" });
    const c = await create(alice);
    const html = await (await htmlRoute.GET(apiRequest(`/api/v1/concepts/${c.id}/html`, { user: alice }), ctx({ id: c.id }))).text();
    expect(html).toContain("Homepage concept by Studio Kekeli");
  });
});

describe("GET /api/v1/concepts/{id}/html", () => {
  it("serves the owner's preview and a download with a slugged filename", async () => {
    const c = await create(alice);
    const res = await htmlRoute.GET(apiRequest(`/api/v1/concepts/${c.id}/html`, { user: alice }), ctx({ id: c.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CONCEPT_CSP);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBeNull();
    const html = await res.text();
    expect(html).toContain('href="tel:+22890123456"');
    expect(html).toContain("Open in Google Maps");

    const dl = await htmlRoute.GET(apiRequest(`/api/v1/concepts/${c.id}/html?download=1`, { user: alice }), ctx({ id: c.id }));
    expect(dl.headers.get("content-disposition")).toBe('attachment; filename="hotel-le-benin-homepage-concept.html"');
  });
});

describe("POST /api/v1/concepts/{id}/regenerate", () => {
  it("regenerates with new options and keeps the ref", async () => {
    const c = await create(alice);
    const { ref: _ref, ...options } = c.input!;
    const res = await regenerateRoute.POST(
      apiRequest(`/api/v1/concepts/${c.id}/regenerate`, { method: "POST", user: alice, body: { input: { ...options, style: "bold", language: "fr", tone: "friendly" } } }),
      ctx({ id: c.id }),
    );
    expect(res.status).toBe(200);
    const r = (await res.json()) as ConceptGenerateResponse;
    expect(r.id).toBe(c.id);
    expect(r.ref).toEqual(c.ref);
    expect(r.style).toBe("bold");
    expect(r.language).toBe("fr");
    expect(r.content.palette).toEqual(STYLE_PALETTES.bold);
    expect(r.content.hero.headline).toBe("Bienvenue chez Hôtel Le Bénin");
  });

  it("reuses the saved input when no body is sent; validates input", async () => {
    const c = await create(alice);
    const res = await regenerateRoute.POST(apiRequest(`/api/v1/concepts/${c.id}/regenerate`, { method: "POST", user: alice, body: {} }), ctx({ id: c.id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ConceptDto).content).toEqual(c.content);
    const bad = await regenerateRoute.POST(
      apiRequest(`/api/v1/concepts/${c.id}/regenerate`, { method: "POST", user: alice, body: { input: { services: [] } } }),
      ctx({ id: c.id }),
    );
    expect(bad.status).toBe(422);
  });
});

describe("DELETE /api/v1/concepts/{id}", () => {
  it("deletes (204), audits, then 404", async () => {
    const c = await create(alice);
    const res = await itemRoute.DELETE(apiRequest(`/api/v1/concepts/${c.id}`, { method: "DELETE", user: alice }), ctx({ id: c.id }));
    expect(res.status).toBe(204);
    expect((await itemRoute.GET(apiRequest(`/api/v1/concepts/${c.id}`, { user: alice }), ctx({ id: c.id }))).status).toBe(404);
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "concept.delete"));
    expect(audits).toHaveLength(1);
  });
});

describe("GET /api/v1/concepts/prefill", () => {
  it("suggests contact details from the business, for the user to confirm", async () => {
    const row = own(alice, "result", businessRow());
    const res = await prefillRoute.GET(apiRequest(`/api/v1/concepts/prefill?ref_kind=result&ref_id=${row.id}`, { user: alice }), ctx({}));
    expect(res.status).toBe(200);
    const p = (await res.json()) as ConceptPrefillDto;
    expect(p.contact).toEqual({
      businessName: "Hôtel Le Bénin",
      phone: "+228 90 12 34 56",
      whatsapp: "+22890123456",
      email: null,
      address: "Boulevard du 13 Janvier",
      city: "Lomé",
      mapsUrl: "https://www.google.com/maps/place/?q=place_id:abc",
    });
    expect(p).toMatchObject({ businessType: "Hotel", city: "Lomé", hasWebsite: false, isSample: true, defaultLanguage: "en" });
  });

  it("404 for other users' businesses or bad queries", async () => {
    const bobs = own(bob, "result", businessRow());
    const other = await prefillRoute.GET(apiRequest(`/api/v1/concepts/prefill?ref_kind=result&ref_id=${bobs.id}`, { user: alice }), ctx({}));
    expect(other.status).toBe(404);
    const bad = await prefillRoute.GET(apiRequest(`/api/v1/concepts/prefill?ref_kind=place&ref_id=x`, { user: alice }), ctx({}));
    expect(bad.status).toBe(404);
  });
});
