/**
 * The sample "world" (pure, deterministic). The map is divided into fixed grid cells of
 * CELL_DEG × CELL_DEG degrees. For a given category, every cell holds a deterministic number of
 * fictional businesses (denser near city centres); each business is generated from
 * hash(category key, cell, slot), so any search, getDetails() or findPlace() that touches the same
 * cell sees the very same records. IDs encode category key + cell + slot.
 */
import type { FoundEmail, LatLng, Rect, Socials, WebsiteCheck } from "@/lib/domain";
import { M_PER_DEG_LAT, offsetMeters } from "@/server/normalize/geo";
import { slugify, stripAccents } from "@/server/normalize/text";
import type { ProviderPlace } from "../types";
import { categoryFromKey, type CategoryDef, type NameCtx } from "./catalog";
import { samplePhone, type SamplePhone } from "./phones";
import {
  CITIES,
  COUNTRIES,
  LANDMARKS,
  STREETS,
  cityAreaKm2,
  cityRadiusKm,
  cityViewport,
  type CityDef,
  type CountryDef,
  type Neighbourhood,
} from "./places-data";
import { Rng, hash32, token36 } from "./prng";

/** Grid cell size in degrees (~550 m at the equator). */
export const CELL_DEG = 0.005;
/** Businesses per km² for a query far from any city. */
export const RURAL_DENSITY_PER_KM2 = 6;
/** Hard cap on businesses per cell. */
export const MAX_PER_CELL = 400;
/** Share of records generated as probable duplicates of an earlier record in the same cell. */
export const DUPLICATE_RATE = 0.032;
export const ID_PREFIX = "smp1";

const KM_PER_DEG = M_PER_DEG_LAT / 1000;
const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180);

/* ───────────────────────────── city density model ───────────────────────────── */

type Anchor = { lat: number; lng: number; hood: Neighbourhood };
export type CityModel = { def: CityDef; country: CountryDef; viewport: Rect; radiusKm: number; peak: number; kx: number; anchors: Anchor[] };

function gaussianIntegralKm2(c: CityDef, radiusKm: number): number {
  const { s, n, w, e } = c.extentKm;
  const steps = 48;
  const dx = (w + e) / steps;
  const dy = (s + n) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const x = -w + (i + 0.5) * dx;
      const y = -s + (j + 0.5) * dy;
      sum += Math.exp(-(x * x + y * y) / (radiusKm * radiusKm));
    }
  }
  return sum * dx * dy;
}

function buildAnchors(c: CityDef, kx: number): Anchor[] {
  const rng = new Rng(`hoods|${c.id}`);
  const { s, n, w, e } = c.extentKm;
  return c.neighbourhoods.map((hood, i) => {
    // First neighbourhood near the centre, the others spread around it.
    const frac = i === 0 ? 0.08 : 0.2 + 0.7 * Math.sqrt(rng.next());
    const angle = rng.float(0, 2 * Math.PI);
    const dxKm = Math.cos(angle) * frac * (Math.cos(angle) >= 0 ? e : w);
    const dyKm = Math.sin(angle) * frac * (Math.sin(angle) >= 0 ? n : s);
    return { lat: c.center.lat + dyKm / KM_PER_DEG, lng: c.center.lng + dxKm / kx, hood };
  });
}

const CITY_MODELS: CityModel[] = CITIES.map((def) => {
  const country = COUNTRIES[def.country];
  if (!country) throw new Error(`Sample data: unknown country ${def.country} for ${def.name}`);
  const radiusKm = cityRadiusKm(def);
  const kx = KM_PER_DEG * cosDeg(def.center.lat);
  const peak = Math.max(0, (def.capacity - RURAL_DENSITY_PER_KM2 * cityAreaKm2(def)) / gaussianIntegralKm2(def, radiusKm));
  return { def, country, viewport: cityViewport(def), radiusKm, peak, kx, anchors: buildAnchors(def, kx) };
});

export type Region = { city: CityModel; distKm: number; inCity: boolean; hood: Neighbourhood | null };

const inRect = (r: Rect, lat: number, lng: number) => lat >= r.low.lat && lat <= r.high.lat && lng >= r.low.lng && lng <= r.high.lng;

/** Nearest built-in city; `inCity` when the point lies inside that city's map area. */
export function regionAt(lat: number, lng: number): Region {
  let best = CITY_MODELS[0]!;
  let bestD = Infinity;
  for (const m of CITY_MODELS) {
    const dx = (lng - m.def.center.lng) * m.kx;
    const dy = (lat - m.def.center.lat) * KM_PER_DEG;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  const inCity = inRect(best.viewport, lat, lng);
  let hood: Neighbourhood | null = null;
  if (inCity) {
    let hd = Infinity;
    for (const a of best.anchors) {
      const dx = (lng - a.lng) * best.kx;
      const dy = (lat - a.lat) * KM_PER_DEG;
      const d = dx * dx + dy * dy;
      if (d < hd) {
        hd = d;
        hood = a.hood;
      }
    }
  }
  return { city: best, distKm: Math.sqrt(bestD), inCity, hood };
}

/** Expected businesses per km² (per query) at a point. */
export function densityAt(lat: number, lng: number): number {
  const { city, distKm } = regionAt(lat, lng);
  return RURAL_DENSITY_PER_KM2 + city.peak * Math.exp(-(distKm * distKm) / (city.radiusKm * city.radiusKm));
}

/* ───────────────────────────── cells ───────────────────────────── */

export const cellOf = (lat: number, lng: number) => ({ cx: Math.floor(lng / CELL_DEG), cy: Math.floor(lat / CELL_DEG) });

export function cellAreaKm2(cy: number): number {
  const lat = (cy + 0.5) * CELL_DEG;
  return CELL_DEG * KM_PER_DEG * (CELL_DEG * KM_PER_DEG * Math.max(0.01, cosDeg(lat)));
}

/** Number of businesses of this category in a cell (deterministic). */
export function cellCount(def: CategoryDef, cx: number, cy: number): number {
  const rng = new Rng(`${def.key}|count|${cx}|${cy}`);
  const lat = (cy + 0.5) * CELL_DEG;
  const lng = (cx + 0.5) * CELL_DEG;
  if (lat < -85 || lat > 85) return 0;
  const expected = densityAt(lat, lng) * cellAreaKm2(cy);
  const n = Math.floor(expected * (0.7 + 0.6 * rng.next()) + rng.next());
  return Math.max(0, Math.min(MAX_PER_CELL, n));
}

/* ───────────────────────────── ids ───────────────────────────── */

const MAX_CX = Math.ceil(180 / CELL_DEG);
const MAX_CY = Math.ceil(90 / CELL_DEG);

export function encodeId(def: CategoryDef, cx: number, cy: number, slot: number): string {
  return `${ID_PREFIX}.${def.key}.${cx}.${cy}.${slot}`;
}

const INT_RE = /^-?(0|[1-9]\d*)$/;

/** Parse and validate a sample id; null when it is not one this generator could have produced. */
export function decodeId(id: string): { def: CategoryDef; cx: number; cy: number; slot: number } | null {
  if (typeof id !== "string" || id.length > 200) return null;
  const parts = id.split(".");
  if (parts.length !== 5 || parts[0] !== ID_PREFIX) return null;
  const [, key, sx, sy, ss] = parts as [string, string, string, string, string];
  if (!INT_RE.test(sx) || !INT_RE.test(sy) || !/^(0|[1-9]\d*)$/.test(ss)) return null;
  const def = categoryFromKey(key);
  if (!def) return null;
  const cx = Number(sx);
  const cy = Number(sy);
  const slot = Number(ss);
  if (Math.abs(cx) > MAX_CX || Math.abs(cy) > MAX_CY) return null;
  if (slot >= cellCount(def, cx, cy)) return null;
  return { def, cx, cy, slot };
}

/* ───────────────────────────── record generation ───────────────────────────── */

type Base = {
  place: ProviderPlace;
  dupRoll: number;
  dupPick: number;
  phone: SamplePhone | null;
  phoneShown: "both" | "national" | "international";
  region: Region;
};

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;
const mapsUrlFor = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
const UK_LETTERS = "ABDEFGHJLNPQRSTUWXYZ";
const CA_LETTERS = "ABCEGHJKLMNPRSTVWXYZ";

function address(rng: Rng, region: Region): { address: string | null; postalCode: string | null } {
  const { city, inCity, hood } = region;
  const c = city.country;
  const cityName = city.def.name;
  const style = c.addressStyle;
  if (style === "africa") {
    const streets = city.def.streets ?? STREETS[c.language === "fr" ? "fr-africa" : "en-africa"];
    const street = rng.pick(streets);
    const landmark = rng.pick(LANDMARKS[c.language]);
    if (!inCity || !hood) {
      return {
        address: rng.weighted<string | null>([
          [`${street}, ${c.name}`, 55],
          [`${landmark}, ${c.name}`, 25],
          [null, 20],
        ]),
        postalCode: null,
      };
    }
    const num = rng.int(1, 120);
    const options: [string | null, number][] =
      c.language === "fr"
        ? [[`${street}, ${hood.name}, ${cityName}`, 55], [`${landmark}, ${hood.name}, ${cityName}`, 15], [`${hood.name}, ${cityName}`, 26], [null, 4]]
        : [[`${num} ${street}, ${hood.name}, ${cityName}`, 40], [`${street}, ${hood.name}, ${cityName}`, 25], [`${landmark}, ${hood.name}, ${cityName}`, 12], [`${hood.name}, ${cityName}`, 19], [null, 4]];
    return { address: rng.weighted(options), postalCode: null };
  }

  const num = rng.int(1, style === "us" ? 999 : 160);
  const street = rng.pick(city.def.streets ?? STREETS[style]);
  if (!inCity || !hood) return { address: rng.chance(0.85) ? `${num} ${street}, ${c.name}` : null, postalCode: null };
  if (rng.chance(0.03)) return { address: null, postalCode: null };
  switch (style) {
    case "fr": {
      const postal = hood.postal ?? "75001";
      return { address: `${num} ${street}, ${postal} ${cityName}`, postalCode: postal };
    }
    case "uk": {
      const postal = `${hood.postal ?? "EC1A"} ${rng.int(1, 9)}${UK_LETTERS[rng.int(0, UK_LETTERS.length - 1)]}${UK_LETTERS[rng.int(0, UK_LETTERS.length - 1)]}`;
      return { address: `${num} ${street}, ${cityName} ${postal}`, postalCode: postal };
    }
    case "us": {
      const postal = hood.postal ?? "10001";
      return { address: `${num} ${street}, ${cityName}, ${c.state ?? "NY"} ${postal}`, postalCode: postal };
    }
    case "ca": {
      const postal = `${hood.postal ?? "M5V"} ${rng.int(1, 9)}${CA_LETTERS[rng.int(0, CA_LETTERS.length - 1)]}${rng.int(0, 9)}`;
      return { address: `${num} ${street}, ${cityName}, ${c.state ?? "ON"} ${postal}`, postalCode: postal };
    }
  }
}

function websiteTitle(rng: Rng, name: string, lang: "fr" | "en"): string {
  return lang === "fr"
    ? rng.weighted([[`${name} – Site officiel`, 30], [`Accueil – ${name}`, 25], [name, 25], ["Accueil", 10], [`Bienvenue chez ${name}`, 10]])
    : rng.weighted([[`${name} | Official Website`, 30], [`Home - ${name}`, 25], [name, 25], ["Home", 10], [`Welcome to ${name}`, 10]]);
}

function buildEnrichment(
  rng: Rng,
  def: CategoryDef,
  ctx: { name: string; lang: "fr" | "en"; url: string; host: string; handle: string; phone: SamplePhone | null; checkedAt: string },
): NonNullable<ProviderPlace["sampleEnrichment"]> {
  const httpsListed = ctx.url.startsWith("https://");
  const https = httpsListed || rng.chance(0.35);
  const origin = `${https ? "https" : "http"}://${new URL(ctx.url).host}`;
  const finalUrl = `${origin}/`;
  const status = rng.weighted<WebsiteCheck["status"]>([["ok", 90], ["unreachable", 4.5], ["blocked_by_robots", 3.5], ["error", 2]]);

  if (status === "unreachable") {
    return {
      emails: [],
      socials: {},
      websiteCheck: {
        status,
        error: rng.pick(["The website did not respond in time", "The domain name could not be resolved — it may have expired", "The connection was refused by the server"]),
        pagesVisited: 0,
        checkedAt: ctx.checkedAt,
      },
    };
  }
  if (status === "error") {
    const httpStatus = rng.pick([500, 502, 503, 403]);
    return {
      emails: [],
      socials: {},
      websiteCheck: { status, finalUrl, httpStatus, https, error: `The website returned an error (HTTP ${httpStatus})`, pagesVisited: 1, loadMs: rng.int(300, 3000), checkedAt: ctx.checkedAt },
    };
  }
  if (status === "blocked_by_robots") {
    return {
      emails: [],
      socials: {},
      websiteCheck: { status, finalUrl, https, error: "The site's robots.txt does not allow automated visits", pagesVisited: 0, checkedAt: ctx.checkedAt },
    };
  }

  const copyrightYear = rng.chance(0.85) ? 2025 - Math.floor(rng.next() * 13) : undefined;
  const mobileViewport = rng.chance(copyrightYear === undefined ? 0.6 : copyrightYear >= 2018 ? 0.85 : 0.45);
  const loadMs = Math.max(250, Math.min(12000, Math.round(Math.exp(Math.log(1400) + 0.6 * rng.normal()))));

  const emails: FoundEmail[] = [];
  if (rng.chance(1 / 3)) {
    const locals = def.emailLocals[ctx.lang];
    const firstLocal = rng.weighted(locals.map((l, i) => [l, i === 0 ? 4 : 1] as const));
    const contactUrl = `${origin}/contact`;
    emails.push({ email: `${firstLocal}@${ctx.host}`, sourceUrl: contactUrl, sameDomain: true });
    if (rng.chance(0.25)) {
      const second = rng.pick(locals.filter((l) => l !== firstLocal));
      emails.push({ email: `${second}@${ctx.host}`, sourceUrl: contactUrl, sameDomain: true });
    }
    if (rng.chance(0.15)) emails.push({ email: `${ctx.handle}@mail.example`, sourceUrl: contactUrl, sameDomain: false });
  }

  const socials: Socials = {};
  if (rng.chance(0.6)) socials.facebook = `https://facebook.example/${ctx.handle}`;
  if (rng.chance(0.25 + 0.3 * def.visualSocial)) socials.instagram = `https://instagram.example/${ctx.handle}`;
  if (rng.chance(0.12)) socials.x = `https://x.example/${ctx.handle}`;
  if (rng.chance(0.1)) socials.linkedin = `https://linkedin.example/company/${ctx.handle}`;
  if (rng.chance(0.08)) socials.youtube = `https://youtube.example/@${ctx.handle}`;
  if (rng.chance(0.05 + 0.15 * def.visualSocial)) socials.tiktok = `https://tiktok.example/@${ctx.handle}`;
  if (ctx.phone?.mobile && rng.chance(0.3)) socials.whatsapp = `https://wa.example/${ctx.phone.e164Digits}`;

  return {
    emails,
    socials,
    websiteCheck: {
      status: "ok",
      finalUrl,
      httpStatus: 200,
      https,
      mobileViewport,
      title: websiteTitle(rng, ctx.name, ctx.lang),
      ...(copyrightYear !== undefined ? { copyrightYear } : {}),
      loadMs,
      pagesVisited: emails.length ? rng.int(2, 3) : rng.int(1, 3),
      checkedAt: ctx.checkedAt,
    },
  };
}

function buildBase(def: CategoryDef, cx: number, cy: number, slot: number, now: Date): Base {
  const rng = new Rng(`${def.key}|${cx}|${cy}|${slot}`);
  const dupRoll = rng.next();
  const dupPick = rng.next();
  const lat = round7((cy + rng.next()) * CELL_DEG);
  const lng = round7((cx + rng.next()) * CELL_DEG);
  const region = regionAt(lat, lng);
  const country = region.city.country;
  const lang = country.language;
  const subCategory = rng.weighted(def.subs.map((s) => [s, s.weight] as const));
  const nameCtx: NameCtx = { rng, lang, flavor: country.flavor, country, hood: region.hood?.name ?? null };
  const name = def.name(nameCtx, subCategory);
  const main = def.subs[0]?.label ?? subCategory.label;
  const categories = subCategory.label === main ? [main] : [subCategory.label, main];

  const phone = rng.chance(0.9) ? samplePhone(rng, country.code, region.inCity ? region.city.def.id : undefined) : null;
  const phoneShown = rng.weighted([["both", 85], ["national", 10], ["international", 5]] as const);

  const westBoost = country.flavor === "west" ? 0.15 : 0;
  let websiteUrl: string | null = null;
  let sampleEnrichment: ProviderPlace["sampleEnrichment"];
  if (rng.chance(Math.min(0.95, def.websiteRate + westBoost))) {
    const slug = slugify(name, 28) || "business";
    const tok = token36(`${def.key}|${cx}|${cy}|${slot}`, 4);
    const host = `${slug}-${tok}.example`;
    const form = rng.weighted([["https", 55], ["https-www", 20], ["http", 15], ["http-www-path", 10]] as const);
    websiteUrl =
      form === "https" ? `https://${host}`
      : form === "https-www" ? `https://www.${host}/`
      : form === "http" ? `http://${host}`
      : `http://www.${host}/${lang === "fr" ? "accueil" : "home"}`;
    const handle = `${slug.replace(/-/g, "")}${tok}`;
    sampleEnrichment = buildEnrichment(rng, def, { name, lang, url: websiteUrl, host, handle, phone, checkedAt: now.toISOString() });
  }

  const addr = address(rng, region);
  let rating: number | null = null;
  let reviewCount: number | null = null;
  if (!rng.chance(0.08)) {
    rating = Math.round(Math.max(3, Math.min(4.9, 4.15 + 0.45 * rng.normal())) * 10) / 10;
    reviewCount = Math.max(1, Math.min(12000, Math.round(Math.exp(Math.log(12 * def.reviewScale) + 1.3 * rng.normal()))));
  }
  const businessStatus = rng.weighted([["OPERATIONAL", 96], ["CLOSED_TEMPORARILY", 3], ["CLOSED_PERMANENTLY", 1]] as const);

  const place: ProviderPlace = {
    sourceRecordId: encodeId(def, cx, cy, slot),
    name,
    category: subCategory.label,
    categories,
    phoneNational: phone && phoneShown !== "international" ? phone.national : null,
    phoneInternational: phone && phoneShown !== "national" ? phone.international : null,
    websiteUrl,
    email: null,
    address: addr.address,
    city: region.inCity ? region.city.def.name : null,
    region: region.inCity || region.distKm < 60 ? region.city.def.region : null,
    country: country.name,
    countryCode: country.code,
    postalCode: addr.postalCode,
    lat,
    lng,
    rating,
    reviewCount,
    mapsUrl: mapsUrlFor(lat, lng),
    businessStatus,
    ...(sampleEnrichment ? { sampleEnrichment } : {}),
  };
  return { place, dupRoll, dupPick, phone, phoneShown, region };
}

function nameVariant(rng: Rng, name: string, region: Region, strictOnly: boolean): string {
  const plain = stripAccents(name);
  const words = name.split(" ");
  const options: (readonly [string, number])[] = [];
  if (plain !== name) options.push([plain, 3]);
  options.push([name.toUpperCase(), 2]);
  if (!strictOnly) {
    if (words.length >= 3) options.push([words.slice(1).join(" "), 2]);
    if (region.inCity) options.push([`${name} ${region.city.def.name}`, 2]);
    if (region.hood) options.push([`${name} - ${region.hood.name}`, 2]);
    if (name.includes("&")) options.push([name.replace("&", region.city.country.language === "fr" ? "et" : "and"), 2]);
  }
  return rng.weighted(options);
}

const cloneEnrichment = (e: NonNullable<ProviderPlace["sampleEnrichment"]>): NonNullable<ProviderPlace["sampleEnrichment"]> => ({
  emails: e.emails.map((x) => ({ ...x })),
  socials: { ...e.socials },
  websiteCheck: e.websiteCheck ? { ...e.websiteCheck } : null,
});

/** A probable duplicate listing of `orig`: same phone, name variant, < 50 m away, its own id. */
function makeDuplicate(def: CategoryDef, orig: Base, cx: number, cy: number, slot: number): ProviderPlace {
  const rng = new Rng(`${def.key}|${cx}|${cy}|${slot}|dup`);
  const o = orig.place;
  const pos: LatLng = offsetMeters({ lat: o.lat!, lng: o.lng! }, rng.float(5, 45), rng.float(0, 360));
  const lat = round7(pos.lat);
  const lng = round7(pos.lng);
  const hasStrongKey = Boolean(orig.phone);
  const name = nameVariant(rng, o.name ?? "", orig.region, !hasStrongKey);
  const keepWebsite = o.websiteUrl !== null && (!hasStrongKey || rng.chance(0.5));
  let rating: number | null = null;
  let reviewCount: number | null = null;
  if (o.rating !== null && rng.chance(0.5)) {
    rating = Math.round(Math.max(3, Math.min(4.9, o.rating + rng.float(-0.3, 0.3))) * 10) / 10;
    reviewCount = rng.int(1, 15);
  }
  const { sampleEnrichment: origEnrichment, ...rest } = o;
  return {
    ...rest,
    sourceRecordId: encodeId(def, cx, cy, slot),
    name,
    categories: [...o.categories],
    websiteUrl: keepWebsite ? o.websiteUrl : null,
    address: rng.chance(0.7) ? o.address : null,
    lat,
    lng,
    rating,
    reviewCount,
    mapsUrl: mapsUrlFor(lat, lng),
    ...(keepWebsite && origEnrichment ? { sampleEnrichment: cloneEnrichment(origEnrichment) } : {}),
  };
}

/** The business at (category, cell, slot). Deterministic except for websiteCheck.checkedAt (= `now`). */
export function generatePlace(def: CategoryDef, cx: number, cy: number, slot: number, now: Date): ProviderPlace {
  const base = buildBase(def, cx, cy, slot, now);
  if (slot > 0 && base.dupRoll < DUPLICATE_RATE) {
    const j = Math.floor(base.dupPick * slot);
    const orig = buildBase(def, cx, cy, j, now);
    if (orig.dupRoll >= DUPLICATE_RATE || j === 0) return makeDuplicate(def, orig, cx, cy, slot);
  }
  return base.place;
}

/** Whether the record at this slot is generated as a probable duplicate, and of which slot. */
export function duplicateSourceSlot(def: CategoryDef, cx: number, cy: number, slot: number): number | null {
  if (slot === 0) return null;
  const rng = new Rng(`${def.key}|${cx}|${cy}|${slot}`);
  const dupRoll = rng.next();
  const dupPick = rng.next();
  if (dupRoll >= DUPLICATE_RATE) return null;
  const j = Math.floor(dupPick * slot);
  if (j === 0) return 0;
  const o = new Rng(`${def.key}|${cx}|${cy}|${j}`);
  return o.next() >= DUPLICATE_RATE ? j : null;
}

/** All businesses of a cell, in slot order. */
export function generateCell(def: CategoryDef, cx: number, cy: number, now: Date): ProviderPlace[] {
  const n = cellCount(def, cx, cy);
  const out: ProviderPlace[] = new Array(n);
  for (let s = 0; s < n; s++) out[s] = generatePlace(def, cx, cy, s, now);
  return out;
}

/* ───────────────────────────── areas & enumeration ───────────────────────────── */

/** Normalized search area: ordered corners, clamped, with a minimum size of ~500 m. */
export function normalizeArea(area: Rect, center?: LatLng): Rect {
  let lowLat = Math.min(area.low.lat, area.high.lat);
  let highLat = Math.max(area.low.lat, area.high.lat);
  let lowLng = Math.min(area.low.lng, area.high.lng);
  let highLng = Math.max(area.low.lng, area.high.lng);
  const minHalfLat = 250 / M_PER_DEG_LAT;
  if (highLat - lowLat < 2 * minHalfLat) {
    const mid = center && Number.isFinite(center.lat) ? center.lat : (lowLat + highLat) / 2;
    lowLat = mid - minHalfLat;
    highLat = mid + minHalfLat;
  }
  const minHalfLng = 250 / (M_PER_DEG_LAT * Math.max(0.01, cosDeg((lowLat + highLat) / 2)));
  if (highLng - lowLng < 2 * minHalfLng) {
    const mid = center && Number.isFinite(center.lng) ? center.lng : (lowLng + highLng) / 2;
    lowLng = mid - minHalfLng;
    highLng = mid + minHalfLng;
  }
  return {
    low: { lat: Math.max(-85, lowLat), lng: Math.max(-180, lowLng) },
    high: { lat: Math.min(85, highLat), lng: Math.min(180, highLng) },
  };
}

export type CellRange = { x0: number; x1: number; y0: number; y1: number };

export function cellRange(area: Rect): CellRange {
  const a = cellOf(area.low.lat, area.low.lng);
  const b = cellOf(area.high.lat, area.high.lng);
  return { x0: a.cx, x1: b.cx, y0: a.cy, y1: b.cy };
}

export const cellsInRange = (r: CellRange) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);

/** Cells of the range in rings of increasing distance from (cx, cy) — the "tiles" of a search. */
export function* spiralCells(r: CellRange, cx: number, cy: number): Generator<readonly [number, number]> {
  const c = { x: Math.min(r.x1, Math.max(r.x0, cx)), y: Math.min(r.y1, Math.max(r.y0, cy)) };
  const rMax = Math.max(c.x - r.x0, r.x1 - c.x, c.y - r.y0, r.y1 - c.y);
  yield [c.x, c.y] as const;
  for (let k = 1; k <= rMax; k++) {
    const top = c.y + k;
    const bottom = c.y - k;
    const left = c.x - k;
    const right = c.x + k;
    const xFrom = Math.max(r.x0, left);
    const xTo = Math.min(r.x1, right);
    if (top <= r.y1) for (let x = xFrom; x <= xTo; x++) yield [x, top] as const;
    const yFrom = Math.max(r.y0, bottom + 1);
    const yTo = Math.min(r.y1, top - 1);
    if (right <= r.x1) for (let y = yTo; y >= yFrom; y--) yield [right, y] as const;
    if (bottom >= r.y0) for (let x = xTo; x >= xFrom; x--) yield [x, bottom] as const;
    if (left >= r.x0) for (let y = yFrom; y <= yTo; y++) yield [left, y] as const;
  }
}

export const inArea = (area: Rect, p: ProviderPlace) => p.lat !== null && p.lng !== null && inRect(area, p.lat, p.lng);

/** Exact number of businesses of a category inside an area (interior cells are counted without generating them). */
export function countInArea(def: CategoryDef, areaIn: Rect): number {
  const area = normalizeArea(areaIn);
  const r = cellRange(area);
  if (cellsInRange(r) > 2_000_000) return Infinity;
  const now = new Date(0);
  let total = 0;
  for (let cy = r.y0; cy <= r.y1; cy++) {
    for (let cx = r.x0; cx <= r.x1; cx++) {
      // Cells next to the edge are generated too: duplicates sit up to 45 m outside their own cell.
      const edge = cx <= r.x0 + 1 || cx >= r.x1 - 1 || cy <= r.y0 + 1 || cy >= r.y1 - 1;
      if (!edge) {
        total += cellCount(def, cx, cy);
        continue;
      }
      for (const p of generateCell(def, cx, cy, now)) if (inArea(area, p)) total += 1;
    }
  }
  return total;
}

/** Expected count for an average cell near a point (used to plan tiles). */
export function expectedPerCell(lat: number, lng: number): number {
  return densityAt(lat, lng) * cellAreaKm2(cellOf(lat, lng).cy);
}

export { hash32 };
