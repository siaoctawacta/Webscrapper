import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Rect } from "@/lib/domain";
import { applyEnrichment, findProbableDuplicates, normalizePlace, sampleEnrichmentToResult, websiteHostOf } from "@/server/normalize";
import { approxDistanceMeters } from "@/server/normalize/geo";
import type { ProviderPlace, SearchPage, SearchPlan, UsageEvent } from "../types";
import { categoryFromKey, resolveCategory } from "./catalog";
import { squareAround } from "./geocode";
import { createSampleProvider, defaultSamplePageDelayMs, sampleEstimate, SAMPLE_NOTE } from "./index";
import { PHONE_COUNTRIES, samplePhone } from "./phones";
import { CITIES } from "./places-data";
import { Rng } from "./prng";
import { countInArea, decodeId, duplicateSourceSlot, encodeId } from "./world";

const NOW = new Date("2026-05-01T12:00:00.000Z");
const provider = createSampleProvider({ now: () => NOW });

async function collect(plan: SearchPlan, ctx: Parameters<typeof provider.search>[1] = {}) {
  const pages: SearchPage[] = [];
  for await (const page of provider.search(plan, ctx)) pages.push(page);
  return { pages, places: pages.flatMap((p) => p.places) };
}

async function cityPlan(location: string, query: string, targetCount: number): Promise<SearchPlan> {
  const g = await provider.geocode(location);
  if (!g) throw new Error(`no geocode for ${location}`);
  return { query, area: g.viewport, center: g.center, targetCount, maxRequests: sampleEstimate(targetCount).maxRequests };
}

const widthKm = (r: Rect) => approxDistanceMeters({ lat: (r.low.lat + r.high.lat) / 2, lng: r.low.lng }, { lat: (r.low.lat + r.high.lat) / 2, lng: r.high.lng }) / 1000;
const heightKm = (r: Rect) => approxDistanceMeters({ lat: r.low.lat, lng: r.low.lng }, { lat: r.high.lat, lng: r.low.lng }) / 1000;

function hostOf(url: string): string {
  return new URL(url).hostname;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sample provider basics", () => {
  it("identifies itself as sample data", () => {
    expect(provider.id).toBe("sample");
    expect(provider.label).toBe("Sample data");
    expect(provider.isSample).toBe(true);
  });

  it("estimates one free request per page of 20", () => {
    expect(provider.estimate(20000)).toEqual({ estimatedRequests: 1000, maxRequests: 1505, estimatedCostUsd: 0, freeMonthlyRequests: null, notes: [SAMPLE_NOTE] });
    expect(provider.estimate(45).estimatedRequests).toBe(3);
    expect(provider.estimate(0)).toMatchObject({ estimatedRequests: 0, maxRequests: 0, estimatedCostUsd: 0 });
    expect(SAMPLE_NOTE).toBe("Sample data mode — no real businesses, no cost");
  });

  it("has no artificial delay in tests and 40–120 ms otherwise", () => {
    expect(defaultSamplePageDelayMs()).toBe(0);
    vi.stubEnv("APP_ENV", "development");
    for (let i = 0; i < 50; i++) {
      const d = defaultSamplePageDelayMs();
      expect(d).toBeGreaterThanOrEqual(40);
      expect(d).toBeLessThanOrEqual(120);
    }
  });
});

describe("geocode", () => {
  it("matches cities accent- and case-insensitively, with aliases and countries", async () => {
    for (const q of ["Lomé", "Lome", "LOMÉ", "lomé, togo", "Lome Togo", "  lome  "]) {
      const g = await provider.geocode(q);
      expect(g?.label).toBe("Lomé, Togo");
      expect(g?.countryCode).toBe("TG");
      expect(g?.city).toBe("Lomé");
    }
    expect((await provider.geocode("Accra, Ghana"))?.label).toBe("Accra, Ghana");
    expect((await provider.geocode("Sekondi-Takoradi"))?.city).toBe("Takoradi");
    expect((await provider.geocode("Yaounde, Cameroun"))?.countryCode).toBe("CM");
    expect((await provider.geocode("Londres"))?.city).toBe("London");
    expect((await provider.geocode("NYC"))?.city).toBe("New York");
    expect((await provider.geocode("Porto Novo"))?.city).toBe("Porto-Novo");
  });

  it("returns a city viewport that contains the centre", async () => {
    for (const c of CITIES) {
      const g = await provider.geocode(c.name);
      expect(g?.city).toBe(c.name);
      const v = g!.viewport;
      expect(v.low.lat).toBeLessThan(g!.center.lat);
      expect(v.high.lat).toBeGreaterThan(g!.center.lat);
      expect(v.low.lng).toBeLessThan(g!.center.lng);
      expect(v.high.lng).toBeGreaterThan(g!.center.lng);
      expect(c.neighbourhoods.length).toBeGreaterThanOrEqual(6);
    }
    expect(CITIES.length).toBeGreaterThanOrEqual(25);
  });

  it("places unknown locations deterministically with a 20 km area, labelled as given", async () => {
    const a = await provider.geocode("Atakpamé, Togo");
    const b = await provider.geocode("Atakpamé, Togo");
    expect(a).toEqual(b);
    expect(a?.label).toBe("Atakpamé, Togo");
    expect(a?.countryCode).toBe("TG");
    expect(widthKm(a!.viewport)).toBeCloseTo(20, 0);
    expect(heightKm(a!.viewport)).toBeCloseTo(20, 0);

    const u = await provider.geocode("Springfield");
    expect(u?.label).toBe("Springfield");
    const lower = await provider.geocode("springfield");
    expect(lower?.label).toBe("springfield");
    expect(lower?.center).toEqual(u?.center);
    expect(u?.center).not.toEqual(a?.center);
  });

  it("returns null for an empty location and handles coordinates", async () => {
    expect(await provider.geocode("   ")).toBeNull();
    const g = await provider.geocode("6.1319, 1.2228");
    expect(g?.center).toEqual({ lat: 6.1319, lng: 1.2228 });
    expect(g?.countryCode).toBe("TG");
  });

  it("records non-billable usage", async () => {
    const usage: UsageEvent[] = [];
    await provider.geocode("Accra", { onUsage: (u) => void usage.push(u) });
    expect(usage).toEqual([{ operation: "geocode", requests: 1, costUsd: 0, billable: false }]);
  });
});

describe("categories", () => {
  it("maps query keywords to categories", () => {
    for (const q of ["hôtel", "Hotel", "auberge", "hotels in Lomé", "guest house"]) expect(resolveCategory(q).key).toBe("hotel");
    expect(resolveCategory("maquis").key).toBe("restaurant");
    expect(resolveCategory("barber shop").key).toBe("salon");
    expect(resolveCategory("salon de coiffure").key).toBe("salon");
    expect(resolveCategory("Pharmacie").key).toBe("pharmacy");
    expect(resolveCategory("école primaire").key).toBe("school");
    expect(resolveCategory("garage mécanique").key).toBe("garage");
    expect(resolveCategory("supermarché").key).toBe("supermarket");
    expect(resolveCategory("boutique").key).toBe("boutique");
    expect(resolveCategory("église").key).toBe("church");
    expect(resolveCategory("clinic").key).toBe("clinic");
  });

  it("uses the title-cased query for unknown keywords and round-trips through the id key", () => {
    const def = resolveCategory("Plombier  ");
    expect(def.subs[0]?.label).toBe("Plombier");
    expect(def.subs.map((s) => s.label)).toEqual(["Plombier", "Plombier service", "Plombier supplier"]);
    expect(categoryFromKey(def.key)?.subs[0]?.label).toBe("Plombier");
    expect(resolveCategory("électricien").subs[0]?.label).toBe("Électricien");
    expect(categoryFromKey("qnot-a-valid@@")).toBeNull();
    expect(categoryFromKey("nope")).toBeNull();
  });

  it("generates hotel sub-categories only from the hotel family", async () => {
    const { places } = await collect(await cityPlan("Lomé", "hôtel", 400));
    const allowed = new Set(["Hotel", "Guest house", "Motel", "Resort", "Hostel", "Lodge"]);
    for (const p of places) {
      expect(allowed.has(p.category!)).toBe(true);
      for (const c of p.categories) expect(allowed.has(c)).toBe(true);
    }
    expect(new Set(places.map((p) => p.category)).size).toBeGreaterThanOrEqual(5);
  });
});

describe("search", () => {
  it("is deterministic for the same query and area", async () => {
    const plan = await cityPlan("Lomé", "hôtel", 300);
    const a = await collect(plan);
    const b = await collect(plan);
    expect(a.places).toEqual(b.places);
    expect(a.pages.map((p) => [p.tilesDone, p.tilesTotal])).toEqual(b.pages.map((p) => [p.tilesDone, p.tilesTotal]));
    // Same records whatever the query spelling for the same category.
    const c = await collect({ ...plan, query: "Hotel" });
    expect(c.places.map((p) => p.sourceRecordId)).toEqual(a.places.map((p) => p.sourceRecordId));
  });

  it("returns different businesses for different areas and categories", async () => {
    const lome = await collect(await cityPlan("Lomé", "hôtel", 100));
    const accra = await collect(await cityPlan("Accra", "hôtel", 100));
    const pharmacies = await collect(await cityPlan("Lomé", "pharmacie", 100));
    const ids = new Set(lome.places.map((p) => p.sourceRecordId));
    expect(accra.places.some((p) => ids.has(p.sourceRecordId))).toBe(false);
    expect(pharmacies.places.some((p) => ids.has(p.sourceRecordId))).toBe(false);
    expect(accra.places.every((p) => p.countryCode === "GH")).toBe(true);
  });

  it("completes a 20 000-result search in a big city quickly with 20 000 unique ids", async () => {
    const usage: UsageEvent[] = [];
    const plan = await cityPlan("Lomé", "hôtel", 20000);
    const t0 = performance.now();
    const { pages, places } = await collect(plan, { onUsage: (u) => void usage.push(u) });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(8000);
    expect(places).toHaveLength(20000);
    expect(new Set(places.map((p) => p.sourceRecordId)).size).toBe(20000);
    expect(pages).toHaveLength(1000);
    expect(pages.every((p) => p.places.length <= 20)).toBe(true);
    expect(usage).toHaveLength(1000);
    expect(usage.every((u) => u.operation === "text_search" && u.requests === 1 && u.costUsd === 0 && u.billable === false)).toBe(true);
    let lastDone = 0;
    for (const p of pages) {
      expect(p.tilesDone).toBeGreaterThanOrEqual(lastDone);
      expect(p.tilesTotal).toBeGreaterThanOrEqual(p.tilesDone);
      lastDone = p.tilesDone;
    }
    const last = pages.at(-1)!;
    expect(last.tilesDone).toBe(last.tilesTotal);
    expect(last.exhausted).toBeUndefined();
    // Everything lies inside the requested area.
    for (const p of places) {
      expect(p.lat!).toBeGreaterThanOrEqual(plan.area.low.lat);
      expect(p.lat!).toBeLessThanOrEqual(plan.area.high.lat);
      expect(p.lng!).toBeGreaterThanOrEqual(plan.area.low.lng);
      expect(p.lng!).toBeLessThanOrEqual(plan.area.high.lng);
    }
  });

  it("offers at least 25 000 businesses per query across a big city, fewer in a small town", async () => {
    for (const city of ["Lomé", "Accra", "Abidjan", "Lagos", "Dakar", "Paris", "London", "New York"]) {
      const g = await provider.geocode(city);
      expect(countInArea(resolveCategory("hotel"), g!.viewport)).toBeGreaterThanOrEqual(25000);
    }
    const kpalime = await provider.geocode("Kpalimé");
    expect(countInArea(resolveCategory("hotel"), kpalime!.viewport)).toBeLessThan(10000);
  });

  it("exhausts a small area", async () => {
    const g = await provider.geocode("Lomé");
    const area = squareAround(g!.center, 0.3);
    const available = countInArea(resolveCategory("hôtel"), area);
    const { pages, places } = await collect({ query: "hôtel", area, center: g!.center, targetCount: 1000, maxRequests: 100 });
    expect(places.length).toBe(available);
    expect(places.length).toBeLessThan(1000);
    expect(places.length).toBeGreaterThan(0);
    expect(pages.at(-1)?.exhausted).toBe(true);
    expect(pages.slice(0, -1).every((p) => !p.exhausted)).toBe(true);
    expect(pages.at(-1)?.tilesDone).toBe(pages.at(-1)?.tilesTotal);
  });

  it("honours maxRequests and reports why it stopped", async () => {
    const notes: string[] = [];
    const plan = { ...(await cityPlan("Accra", "restaurant", 1000)), maxRequests: 3 };
    const { pages, places } = await collect(plan, { onNote: (m) => void notes.push(m) });
    expect(pages).toHaveLength(3);
    expect(places).toHaveLength(60);
    expect(notes).toEqual(["Request budget reached (3 requests)"]);
  });

  it("stops when the signal aborts", async () => {
    const ac = new AbortController();
    const plan = await cityPlan("Accra", "restaurant", 1000);
    const pages: SearchPage[] = [];
    for await (const page of provider.search(plan, { signal: ac.signal })) {
      pages.push(page);
      if (pages.length === 2) ac.abort();
    }
    expect(pages).toHaveLength(2);
  });

  it("stops exactly at the target", async () => {
    const { pages, places } = await collect(await cityPlan("Dakar", "salon", 45));
    expect(places).toHaveLength(45);
    expect(pages.map((p) => p.places.length)).toEqual([20, 20, 5]);
    expect((await collect(await cityPlan("Dakar", "salon", 0))).pages).toHaveLength(0);
  });

  it("applies an injected page delay", async () => {
    const delays: number[] = [];
    const slow = createSampleProvider({ now: () => NOW, pageDelayMs: () => (delays.push(5), 5) });
    const plan = await cityPlan("Kara", "hotel", 60);
    const t0 = performance.now();
    let n = 0;
    for await (const page of slow.search(plan)) n += page.places.length;
    expect(n).toBe(60);
    expect(delays).toHaveLength(3);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(10);
  });
});

describe("generated data", () => {
  const cities = ["Lomé", "Kara", "Accra", "Kumasi", "Cotonou", "Abidjan", "Lagos", "Abuja", "Dakar", "Ouagadougou", "Bamako", "Niamey", "Douala", "Yaoundé", "Nairobi", "Paris", "Lyon", "London", "New York", "Toronto"];

  it("uses valid national phone formats for each country", async () => {
    for (const city of cities) {
      const { places } = await collect(await cityPlan(city, "restaurant", 200));
      let withPhone = 0;
      for (const p of places) {
        if (!p.phoneNational && !p.phoneInternational) continue;
        withPhone += 1;
        const cc = p.countryCode as CountryCode;
        if (p.phoneNational) expect(parsePhoneNumberFromString(p.phoneNational, cc)?.isValid(), `${city} ${p.phoneNational}`).toBe(true);
        if (p.phoneInternational) {
          const parsed = parsePhoneNumberFromString(p.phoneInternational);
          expect(parsed?.isValid(), `${city} ${p.phoneInternational}`).toBe(true);
          expect(parsed?.country, `${city} ${p.phoneInternational}`).toBe(cc);
        }
        if (p.phoneNational && p.phoneInternational) {
          expect(parsePhoneNumberFromString(p.phoneNational, cc)?.number).toBe(parsePhoneNumberFromString(p.phoneInternational)?.number);
        }
      }
      expect(withPhone / places.length).toBeGreaterThan(0.8);
      expect(withPhone / places.length).toBeLessThan(0.97);
    }
  });

  it("formats Togo and Ghana numbers like local listings", () => {
    const tg = samplePhone(new Rng("tg"), "TG")!;
    expect(tg.international).toMatch(/^\+228 \d{2} \d{2} \d{2} \d{2}$/);
    expect(tg.national).toMatch(/^\d{2} \d{2} \d{2} \d{2}$/);
    const gh = samplePhone(new Rng("gh"), "GH")!;
    expect(gh.international).toMatch(/^\+233 \d{2} \d{3} \d{4}$/);
    expect(gh.national).toMatch(/^0\d{2} \d{3} \d{4}$/);
    const bj = samplePhone(new Rng("bj"), "BJ")!;
    expect(bj.international).toMatch(/^\+229 01 \d{2} \d{2} \d{2} \d{2}$/);
    expect(samplePhone(new Rng("x"), "ZZ")).toBeNull();
  });

  it("generates numbers valid for libphonenumber in every supported country", () => {
    for (const cc of PHONE_COUNTRIES) {
      const rng = new Rng(`valid-${cc}`);
      for (let i = 0; i < 2000; i++) {
        const p = samplePhone(rng, cc)!;
        const parsed = parsePhoneNumberFromString(p.international);
        expect(parsed?.isValid(), `${cc} ${p.international}`).toBe(true);
        expect(parsed?.number).toBe(`+${p.e164Digits}`);
        expect(parsePhoneNumberFromString(p.national, cc as CountryCode)?.number).toBe(`+${p.e164Digits}`);
      }
    }
  });

  it("only uses reserved .example hosts for websites, emails and social links", async () => {
    for (const city of ["Lomé", "Accra", "Paris", "New York"]) {
      for (const query of ["hotel", "salon", "plombier"]) {
        const { places } = await collect(await cityPlan(city, query, 400));
        for (const p of places) {
          expect(p.email).toBeNull();
          if (p.websiteUrl) expect(hostOf(p.websiteUrl).endsWith(".example")).toBe(true);
          const e = p.sampleEnrichment;
          if (!p.websiteUrl) expect(e).toBeUndefined();
          if (!e) continue;
          for (const m of e.emails) {
            expect(m.email.split("@")[1]?.endsWith(".example")).toBe(true);
            expect(hostOf(m.sourceUrl).endsWith(".example")).toBe(true);
          }
          for (const url of Object.values(e.socials)) expect(hostOf(url!).endsWith(".example")).toBe(true);
          if (e.websiteCheck?.finalUrl) expect(hostOf(e.websiteCheck.finalUrl).endsWith(".example")).toBe(true);
        }
      }
    }
  });

  it("has realistic shares of missing websites, emails, ratings and plausible values", async () => {
    let total = 0;
    let noWebsite = 0;
    let withWebsite = 0;
    let withEmail = 0;
    let noRating = 0;
    for (const query of ["hotel", "restaurant", "salon", "pharmacie", "école", "garage", "supermarché", "boutique", "église", "clinique", "plombier"]) {
      const { places } = await collect(await cityPlan("Lomé", query, 600));
      for (const p of places) {
        total += 1;
        if (!p.websiteUrl) noWebsite += 1;
        else {
          withWebsite += 1;
          if (p.sampleEnrichment?.emails.length) withEmail += 1;
        }
        if (p.rating === null) {
          noRating += 1;
          expect(p.reviewCount).toBeNull();
        } else {
          expect(p.rating).toBeGreaterThanOrEqual(3);
          expect(p.rating).toBeLessThanOrEqual(4.9);
          expect(Number.isInteger(p.reviewCount)).toBe(true);
          expect(p.reviewCount!).toBeGreaterThan(0);
        }
        expect(p.mapsUrl).toBe(`https://www.google.com/maps/search/?api=1&query=${p.lat!.toFixed(6)},${p.lng!.toFixed(6)}`);
        expect(p.country).toBe("Togo");
        expect(p.name).toBeTruthy();
        const check = p.sampleEnrichment?.websiteCheck;
        if (check?.status === "ok") {
          expect(typeof check.https).toBe("boolean");
          expect(typeof check.mobileViewport).toBe("boolean");
          expect(check.title).toBeTruthy();
          if (check.copyrightYear !== undefined) {
            expect(check.copyrightYear).toBeGreaterThanOrEqual(2013);
            expect(check.copyrightYear).toBeLessThanOrEqual(2025);
          }
          expect(check.checkedAt).toBe(NOW.toISOString());
        }
      }
    }
    expect(noWebsite / total).toBeGreaterThan(0.38);
    expect(noWebsite / total).toBeLessThan(0.55);
    expect(withEmail / withWebsite).toBeGreaterThan(0.24);
    expect(withEmail / withWebsite).toBeLessThan(0.36);
    expect(noRating / total).toBeGreaterThan(0.05);
    expect(noRating / total).toBeLessThan(0.11);
  });

  it("writes French names in francophone cities and English names in anglophone ones", async () => {
    const lome = (await collect(await cityPlan("Lomé", "hotel", 300))).places;
    const accra = (await collect(await cityPlan("Accra", "hotel", 300))).places;
    const fr = /^(Hôtel|Résidence|Maison d'hôtes|Villa|Lodge|Écolodge|Auberge|Complexe Hôtelier|Résidence Hôtelière|Motel) /;
    expect(lome.filter((p) => fr.test(p.name!)).length / lome.length).toBeGreaterThan(0.9);
    expect(accra.filter((p) => / (Hotel|Guest House|Guesthouse|Lodge|Hostel|Backpackers|Resort|Beach Resort|Motel|Inn)$/.test(p.name!)).length / accra.length).toBeGreaterThan(0.9);
    expect(lome.some((p) => p.address?.includes("Lomé"))).toBe(true);
    expect(lome.filter((p) => p.city === "Lomé").length).toBe(lome.length);
  });

  it("includes ~3% probable duplicates (same phone, name variant, < 50 m, different id) that dedupe finds", async () => {
    const { places } = await collect(await cityPlan("Lomé", "hôtel", 5000));
    const byId = new Map(places.map((p) => [p.sourceRecordId, p]));
    const truth: [ProviderPlace, ProviderPlace][] = [];
    for (const p of places) {
      const d = decodeId(p.sourceRecordId)!;
      const src = duplicateSourceSlot(d.def, d.cx, d.cy, d.slot);
      if (src === null) continue;
      const orig = byId.get(encodeId(d.def, d.cx, d.cy, src));
      if (orig) truth.push([orig, p]);
    }
    expect(truth.length / places.length).toBeGreaterThan(0.02);
    expect(truth.length / places.length).toBeLessThan(0.045);
    for (const [orig, dup] of truth) {
      expect(dup.sourceRecordId).not.toBe(orig.sourceRecordId);
      expect(approxDistanceMeters({ lat: orig.lat!, lng: orig.lng! }, { lat: dup.lat!, lng: dup.lng! })).toBeLessThan(50);
      if (orig.phoneInternational || orig.phoneNational) {
        expect(dup.phoneInternational).toBe(orig.phoneInternational);
        expect(dup.phoneNational).toBe(orig.phoneNational);
      }
    }
    const normalized = places.map((p) => normalizePlace(p, { source: "sample" }));
    const dups = findProbableDuplicates(
      normalized.map((r) => ({ id: r.sourceRecordId, name: r.name ?? null, phoneE164: r.phoneE164 ?? null, address: r.address ?? null, websiteHost: r.websiteHost ?? null, lat: r.lat ?? null, lng: r.lng ?? null })),
    );
    for (const [orig, dup] of truth) expect(dups.has(dup.sourceRecordId), `${orig.name} / ${dup.name}`).toBe(true);
    // Accidental matches stay rare.
    expect(dups.size - truth.length).toBeLessThan(places.length * 0.02);
  });

  it("normalizes and enriches sample places without network access", async () => {
    const { places } = await collect(await cityPlan("Accra", "hotel", 500));
    const statuses = new Set<string>();
    let emails = 0;
    for (const p of places) {
      const base = normalizePlace(p, { source: "sample", retrievedAt: NOW });
      const e = sampleEnrichmentToResult(p, NOW);
      const r = e ? { ...base, ...applyEnrichment(base, e, NOW) } : base;
      statuses.add(r.websiteStatus!);
      if (r.primaryEmail) {
        emails += 1;
        expect(r.emailOrigin).toBe("website_crawl");
        expect(r.emailStatus).toBe("source_provided");
      }
      if (!p.websiteUrl) expect(r.websiteStatus).toBe("none");
      else expect(r.websiteHost).toBe(websiteHostOf(p.websiteUrl));
      if (p.phoneInternational || p.phoneNational) expect(r.phoneStatus).toBe("source_provided");
    }
    expect([...statuses].sort()).toEqual(["none", "present", "unreachable"]);
    expect(emails).toBeGreaterThan(0);
  });
});

describe("getDetails and findPlace", () => {
  it("regenerates identical records from their ids", async () => {
    const { places } = await collect(await cityPlan("Abidjan", "pharmacie", 300));
    const sample = places.filter((_, i) => i % 7 === 0);
    const usage: UsageEvent[] = [];
    const details = await provider.getDetails(sample.map((p) => p.sourceRecordId), { onUsage: (u) => void usage.push(u) });
    expect(details.size).toBe(sample.length);
    for (const p of sample) expect(details.get(p.sourceRecordId)).toEqual(p);
    expect(usage).toEqual([{ operation: "place_details", requests: sample.length, costUsd: 0, billable: false }]);
  });

  it("regenerates free-text category records too", async () => {
    const { places } = await collect(await cityPlan("Dakar", "Plombier", 50));
    const details = await provider.getDetails(places.map((p) => p.sourceRecordId));
    expect([...details.values()]).toEqual(places);
    expect(places[0]?.category?.startsWith("Plombier")).toBe(true);
  });

  it("omits unknown or forged ids", async () => {
    const details = await provider.getDetails(["", "nope", "smp1.hotel.1.2", "smp1.hotel.244.1226.99999", "smp1.unknowncat.244.1226.0", "ChIJabc123", "smp1.hotel.x.1226.0"]);
    expect(details.size).toBe(0);
  });

  it("finds the same business from a Maps place link (name + coordinates)", async () => {
    const { places } = await collect(await cityPlan("Lomé", "hôtel", 200));
    for (const p of places.filter((_, i) => i % 25 === 0)) {
      const found = await provider.findPlace({ name: p.name!, center: { lat: p.lat!, lng: p.lng! } });
      expect(found?.sourceRecordId).toBe(p.sourceRecordId);
      expect(found).toEqual(p);
    }
  });

  it("returns a nearby fictional business for an unknown name, and null without coordinates", async () => {
    const center = { lat: 5.6037, lng: -0.187 };
    const a = await provider.findPlace({ name: "Some Real Hotel Name", center });
    const b = await provider.findPlace({ name: "Some Real Hotel Name", center });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(approxDistanceMeters(center, { lat: a!.lat!, lng: a!.lng! })).toBeLessThan(1500);
    expect(await provider.findPlace({ name: "Unknown Place" })).toBeNull();
    expect(await provider.findPlace({ name: "  ", center })).toBeNull();
  });
});
