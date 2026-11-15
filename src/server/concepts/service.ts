import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import type { BusinessRow, SenderProfile } from "@/lib/api-types";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { loadBusinessRef } from "../business-ref";
import { db } from "../db";
import { concepts, type Concept } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { isUuid } from "../http";
import { getPolicy } from "../providers/policy";
import { getSenderProfile } from "../settings";
import { generateConceptContent, type ContentDeps } from "./generate";
import { renderConceptHtml } from "./render";
import {
  conceptContentSchema,
  conceptInputSchema,
  createConceptSchema,
  HEX_COLOR_RE,
  digitsOf,
  isGoogleMapsUrl,
  regenerateConceptSchema,
  updateConceptSchema,
  type ConceptContent,
  type ConceptDto,
  type ConceptGenerateResponse,
  type ConceptInput,
  type ConceptPrefillDto,
  type ConceptRef,
  type ConceptSummaryDto,
  type CreateConceptBody,
  type RegenerateConceptBody,
  type UpdateConceptBody,
} from "./schema";
import { buildTemplateContent } from "./template";

export type ConceptDeps = ContentDeps & {
  /** Load the business behind a ref, ownership enforced (unknown → 404). Default: loadBusinessRef. */
  loadRef?: (user: AppUser, ref: ConceptRef) => Promise<BusinessRow>;
  /** Default: getSenderProfile. */
  senderProfile?: (user: { id: string }) => Promise<SenderProfile>;
};

type Opts = { ip?: string | null };

export const LIST_LIMIT = 50;
export const SHARE_TOKEN_LENGTH = 24;
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

const defaultLoadRef = (user: AppUser, ref: ConceptRef) => loadBusinessRef(user, ref);

/* ───────────────────────────── Row → DTO ───────────────────────────── */

type SummaryRow = Pick<Concept, "id" | "businessName" | "input" | "generatedBy" | "shareEnabled" | "createdAt" | "updatedAt"> & {
  palette: unknown;
};

function swatches(palette: unknown): string[] {
  if (!palette || typeof palette !== "object") return [];
  const p = palette as Record<string, unknown>;
  return ["primary", "accent", "surface", "background"].map((k) => p[k]).filter((v): v is string => typeof v === "string" && HEX_COLOR_RE.test(v));
}

function parseInput(raw: unknown): ConceptInput | null {
  const r = conceptInputSchema.safeParse(raw);
  return r.success ? r.data : null;
}

function readRef(raw: Record<string, unknown>): ConceptRef | null {
  const ref = raw.ref as { kind?: unknown; id?: unknown } | undefined;
  if (!ref || (ref.kind !== "result" && ref.kind !== "lead") || typeof ref.id !== "string") return null;
  return { kind: ref.kind, id: ref.id };
}

function toSummary(row: SummaryRow): ConceptSummaryDto {
  const raw = (row.input ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);
  return {
    id: row.id,
    businessName: row.businessName,
    ref: readRef(raw),
    style: pick(raw.style, ["modern", "minimal", "elegant", "bold", "playful", "natural"] as const),
    tone: pick(raw.tone, ["professional", "friendly", "luxury", "energetic"] as const),
    language: raw.language === "fr" ? "fr" : "en",
    generatedBy: row.generatedBy === "ai" ? "ai" : "template",
    shareEnabled: row.shareEnabled,
    swatches: swatches(row.palette),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function readContent(row: Concept, input: ConceptInput | null): ConceptContent {
  const parsed = conceptContentSchema.safeParse(row.content);
  if (parsed.success) return parsed.data;
  if (input) return buildTemplateContent(input);
  throw new Error(`Concept ${row.id} has unreadable content`);
}

export function toConceptDto(row: Concept): ConceptDto {
  const input = parseInput(row.input);
  return {
    ...toSummary({ ...row, palette: (row.content as Record<string, unknown> | null)?.palette }),
    input,
    content: readContent(row, input),
    model: row.model,
    sharePath: row.shareEnabled && row.shareToken ? `/c/${row.shareToken}` : null,
  };
}

async function loadOwned(user: AppUser, id: string): Promise<Concept> {
  if (!isUuid(id)) throw notFound("Concept");
  const [row] = await db()
    .select()
    .from(concepts)
    .where(and(eq(concepts.id, id), eq(concepts.userId, user.id)))
    .limit(1);
  if (!row) throw notFound("Concept");
  return row;
}

/* ───────────────────────────── Generation ───────────────────────────── */

/**
 * Generate and store a concept for a business the user can see (search result or lead).
 * AI when configured (post-checked), otherwise the template. Unknown / foreign refs → 404.
 */
export async function generateConcept(
  user: AppUser,
  input: CreateConceptBody,
  deps: ConceptDeps = {},
  opts: Opts = {},
): Promise<ConceptGenerateResponse> {
  const { useAi, ...parsed } = createConceptSchema.parse(input);
  // Ownership check (throws 404). Only the user-confirmed form values go into the concept.
  const business = await (deps.loadRef ?? defaultLoadRef)(user, parsed.ref);

  const generated = await generateConceptContent(user, parsed, { useAi }, deps);
  const stored: ConceptInput = parsed;
  const [row] = await db()
    .insert(concepts)
    .values({
      userId: user.id,
      businessId: parsed.ref.kind === "lead" ? (business.businessId ?? null) : null,
      leadId: parsed.ref.kind === "lead" ? parsed.ref.id : null,
      businessName: parsed.contact.businessName,
      input: stored as unknown as Record<string, unknown>,
      content: generated.content as unknown as Record<string, unknown>,
      generatedBy: generated.generatedBy,
      model: generated.model,
    })
    .returning();
  if (!row) throw new Error("Saving the concept returned no row");

  await audit({
    actorId: user.id,
    action: "concept.create",
    resourceType: "concept",
    resourceId: row.id,
    metadata: { refKind: parsed.ref.kind, generatedBy: generated.generatedBy, style: parsed.style, language: parsed.language },
    ip: opts.ip,
  });
  return { ...toConceptDto(row), warnings: generated.warnings };
}

/** Re-generate the copy of an existing concept, optionally with new options (the ref stays). */
export async function regenerateConcept(
  user: AppUser,
  id: string,
  body: RegenerateConceptBody = {},
  deps: ConceptDeps = {},
): Promise<ConceptGenerateResponse> {
  const row = await loadOwned(user, id);
  const { input: options, useAi } = regenerateConceptSchema.parse(body);
  const previous = parseInput(row.input);
  const ref = previous?.ref ?? readRef((row.input ?? {}) as Record<string, unknown>);
  if (!options && !previous) {
    throw new HttpError("validation_failed", "This concept's saved details are incomplete — fill in the form and generate again.");
  }
  const next: ConceptInput | Omit<ConceptInput, "ref"> = options ? { ...(ref ? { ref } : {}), ...options } : previous!;

  const generated = await generateConceptContent(user, next, { useAi }, deps);
  const [updated] = await db()
    .update(concepts)
    .set({
      businessName: next.contact.businessName,
      input: next as unknown as Record<string, unknown>,
      content: generated.content as unknown as Record<string, unknown>,
      generatedBy: generated.generatedBy,
      model: generated.model,
      updatedAt: new Date(),
    })
    .where(and(eq(concepts.id, row.id), eq(concepts.userId, user.id)))
    .returning();
  if (!updated) throw notFound("Concept");
  return { ...toConceptDto(updated), warnings: generated.warnings };
}

/* ───────────────────────────── CRUD ───────────────────────────── */

/** The user's concepts, newest first (at most 50). */
export async function listConcepts(user: AppUser): Promise<ConceptSummaryDto[]> {
  const rows = await db()
    .select({
      id: concepts.id,
      businessName: concepts.businessName,
      input: concepts.input,
      generatedBy: concepts.generatedBy,
      shareEnabled: concepts.shareEnabled,
      palette: sql<unknown>`${concepts.content} -> 'palette'`,
      createdAt: concepts.createdAt,
      updatedAt: concepts.updatedAt,
    })
    .from(concepts)
    .where(eq(concepts.userId, user.id))
    .orderBy(desc(concepts.createdAt), desc(concepts.id))
    .limit(LIST_LIMIT);
  return rows.map(toSummary);
}

export async function getConcept(user: AppUser, id: string): Promise<ConceptDto> {
  return toConceptDto(await loadOwned(user, id));
}

/**
 * Edit copy (validated content), the saved options, or sharing. Turning sharing on creates the
 * unguessable link token once; turning it off keeps the token so re-enabling restores the same link.
 */
export async function updateConcept(user: AppUser, id: string, body: UpdateConceptBody, opts: Opts = {}): Promise<ConceptDto> {
  const patch = updateConceptSchema.parse(body);
  const row = await loadOwned(user, id);

  const set: PgUpdateSetSource<typeof concepts> = { updatedAt: new Date() };
  if (patch.content) set.content = patch.content as unknown as Record<string, unknown>;
  if (patch.input) {
    const previous = parseInput(row.input);
    const ref = previous?.ref ?? readRef((row.input ?? {}) as Record<string, unknown>);
    set.input = { ...(ref ? { ref } : {}), ...patch.input } as unknown as Record<string, unknown>;
    set.businessName = patch.input.contact.businessName;
  }
  if (patch.shareEnabled !== undefined) {
    set.shareEnabled = patch.shareEnabled;
    if (patch.shareEnabled) set.shareToken = sql`coalesce(${concepts.shareToken}, ${nanoid(SHARE_TOKEN_LENGTH)})`;
  }

  const [updated] = await db()
    .update(concepts)
    .set(set)
    .where(and(eq(concepts.id, row.id), eq(concepts.userId, user.id)))
    .returning();
  if (!updated) throw notFound("Concept");

  if (patch.shareEnabled !== undefined && patch.shareEnabled !== row.shareEnabled) {
    await audit({
      actorId: user.id,
      action: "concept.share",
      resourceType: "concept",
      resourceId: row.id,
      metadata: { enabled: patch.shareEnabled },
      ip: opts.ip,
    });
  }
  return toConceptDto(updated);
}

export async function deleteConcept(user: AppUser, id: string, opts: Opts = {}): Promise<void> {
  if (!isUuid(id)) throw notFound("Concept");
  const [row] = await db()
    .delete(concepts)
    .where(and(eq(concepts.id, id), eq(concepts.userId, user.id)))
    .returning({ id: concepts.id, businessName: concepts.businessName });
  if (!row) throw notFound("Concept");
  await audit({ actorId: user.id, action: "concept.delete", resourceType: "concept", resourceId: row.id, ip: opts.ip });
}

/* ───────────────────────────── HTML ───────────────────────────── */

/** "Hôtel Le Bénin" → "hotel-le-benin". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function conceptFileName(businessName: string): string {
  const slug = slugify(businessName);
  return slug ? `${slug}-homepage-concept.html` : "homepage-concept.html";
}

function footerCredit(profile: SenderProfile): string | null {
  return profile.senderCompany?.trim() || profile.senderName?.trim() || null;
}

async function renderRow(row: Concept, deps: ConceptDeps): Promise<string> {
  const input = parseInput(row.input);
  const content = readContent(row, input);
  const raw = (row.input ?? {}) as { contact?: Record<string, unknown>; language?: unknown };
  const c = (input?.contact ?? raw.contact ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const profile = await (deps.senderProfile ?? getSenderProfile)({ id: row.userId }).catch(() => null);
  return renderConceptHtml(
    content,
    {
      businessName: text(c.businessName) ?? row.businessName,
      phone: text(c.phone),
      whatsapp: text(c.whatsapp),
      email: text(c.email),
      address: text(c.address),
      city: text(c.city),
      mapsUrl: text(c.mapsUrl),
    },
    { footerCredit: profile ? footerCredit(profile) : null, language: (input?.language ?? raw.language) === "fr" ? "fr" : "en" },
  );
}

/** Owner preview / download. */
export async function getConceptHtml(user: AppUser, id: string, deps: ConceptDeps = {}): Promise<{ html: string; fileName: string }> {
  const row = await loadOwned(user, id);
  return { html: await renderRow(row, deps), fileName: conceptFileName(row.businessName) };
}

/** Public page for a share token — null unless the token exists and sharing is on. */
export async function getSharedConceptHtml(token: string, deps: ConceptDeps = {}): Promise<string | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const [row] = await db()
    .select()
    .from(concepts)
    .where(and(eq(concepts.shareToken, token), eq(concepts.shareEnabled, true)))
    .limit(1);
  return row ? renderRow(row, deps) : null;
}

/* ───────────────────────────── Prefill ───────────────────────────── */

function whatsappFromSocials(link: string | undefined): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let digits = "";
    if (host === "wa.me") digits = digitsOf(u.pathname);
    else if (host === "api.whatsapp.com" || host === "whatsapp.com") digits = digitsOf(u.searchParams.get("phone") ?? "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  } catch {
    return null;
  }
}

const trimOrNull = (v: string | null | undefined, max: number) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Suggested values for the concept form, read from the business the user can see.
 * Nothing is stored here — the user confirms or edits these values before generating.
 */
export async function getConceptPrefill(user: AppUser, ref: ConceptRef, deps: ConceptDeps = {}): Promise<ConceptPrefillDto> {
  const row = await (deps.loadRef ?? defaultLoadRef)(user, ref);
  const profile = await (deps.senderProfile ?? getSenderProfile)(user).catch(() => null);
  const policy = getPolicy(row.source);
  const phone = trimOrNull(row.phone, 40);
  return {
    ref,
    contact: {
      businessName: trimOrNull(row.name, 120) ?? "",
      phone: phone && /^\+?[0-9 ().-]{4,40}$/.test(phone) ? phone : null,
      whatsapp: whatsappFromSocials(row.socials?.whatsapp),
      email: trimOrNull(row.email, 254),
      address: trimOrNull(row.address, 240),
      city: trimOrNull(row.city, 80),
      mapsUrl: row.mapsUrl && isGoogleMapsUrl(row.mapsUrl) ? row.mapsUrl : null,
    },
    businessType: trimOrNull(row.category?.replace(/_/g, " "), 80),
    city: trimOrNull(row.city, 80),
    hasWebsite: Boolean(row.website) && row.websiteStatus !== "none",
    website: row.website,
    attribution: policy.attribution,
    isSample: policy.isSample,
    defaultLanguage: profile?.defaultLanguage === "fr" ? "fr" : "en",
  };
}
