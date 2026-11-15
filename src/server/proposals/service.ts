import "server-only";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { BusinessRow, ProposalDraft, SenderProfile } from "@/lib/api-types";
import type { SourceId } from "@/lib/domain";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { isAiAvailable, type GenerateStructuredDeps } from "../ai/gateway";
import { loadBusinessRef } from "../business-ref";
import { db, type DbOrTx } from "../db";
import { businesses, leads, proposals, searchResults, type Proposal } from "../db/schema";
import { notFound } from "../errors";
import { isUuid } from "../http";
import { canPersist } from "../providers/policy";
import { getSenderProfile } from "../settings";
import { findSharedConceptUrl } from "./concept-link";
import { factsFromRow, whatsappDigits } from "./facts";
import { polishDraft } from "./polish";
import { draftProposalSchema, saveProposalSchema, type DraftProposalInput, type SaveProposalInput } from "./schemas";
import { buildTemplate, signOff } from "./templates";
import type { ProposalDto, ProposalRef, SaveProposalResponse } from "./types";

export const AI_UNAVAILABLE_WARNING = "AI isn't configured — add an AI Gateway key to use “Polish with AI”. Showing the template version.";

export type DraftDeps = {
  /** Load the business behind the ref (ownership enforced). Default: loadBusinessRef. */
  loadBusiness?: (user: AppUser, ref: ProposalRef) => Promise<BusinessRow>;
  /** Default: getSenderProfile. */
  senderProfile?: (user: AppUser) => Promise<SenderProfile>;
  /** Public link to a shared concept for this business. Default: findSharedConceptUrl. */
  conceptUrl?: (user: AppUser, ref: ProposalRef) => Promise<string | null>;
  /** Passed to generateStructured (tests inject a mock model; a model counts as "AI available"). */
  ai?: GenerateStructuredDeps;
  now?: () => Date;
};

/** Build a proposal draft from known facts (+ optional AI polish). Unknown or foreign refs → 404. */
export async function draftProposal(user: AppUser, input: DraftProposalInput, deps: DraftDeps = {}): Promise<ProposalDraft> {
  const { ref, topic, language, customService, useAi } = draftProposalSchema.parse(input);
  const load = deps.loadBusiness ?? ((u: AppUser, r: ProposalRef) => (isUuid(r.id) ? loadBusinessRef(u, { kind: r.kind, id: r.id }) : Promise.reject(notFound("Business"))));
  const row = await load(user, ref);
  const [sender, conceptUrl] = await Promise.all([
    (deps.senderProfile ?? getSenderProfile)(user),
    (deps.conceptUrl ?? findSharedConceptUrl)(user, ref).catch((e: unknown) => {
      console.error("[proposals] concept lookup failed", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);

  const facts = factsFromRow(row, deps.now?.() ?? new Date());
  const tpl = buildTemplate({ topic, language, facts, sender, customService, conceptUrl });
  const draft: ProposalDraft = {
    subject: tpl.subject,
    body: tpl.body,
    topic,
    language,
    generatedBy: "template",
    factsUsed: tpl.factsUsed,
    channels: { email: row.email ?? null, whatsappNumber: whatsappDigits(row.phoneE164) },
    warnings: [...tpl.warnings],
  };

  if (useAi) {
    if (!deps.ai?.model && !isAiAvailable()) {
      draft.warnings.push(AI_UNAVAILABLE_WARNING);
    } else {
      const polished = await polishDraft(
        user,
        { subject: tpl.subject, body: tpl.body, language, factsUsed: tpl.factsUsed, signatureLines: signOff(sender, language).lines },
        deps.ai,
      );
      if (polished.ok) {
        draft.subject = polished.subject;
        draft.body = polished.body;
        draft.generatedBy = "ai";
      } else {
        draft.warnings.push(polished.warning);
      }
    }
  }
  return draft;
}

/* ───────────────────────────── history ───────────────────────────── */

const toDto = (p: Proposal): ProposalDto => ({
  id: p.id,
  businessId: p.businessId,
  leadId: p.leadId,
  businessName: p.businessName,
  topic: p.topic,
  language: p.language,
  subject: p.subject,
  body: p.body,
  channel: p.channel,
  generatedBy: p.generatedBy,
  sentAt: p.sentAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});

type ResolvedRef = {
  leadId: string | null;
  businessId: string | null;
  name: string | null;
  source: SourceId;
  /** Provider place id — persistable under every source policy, so it can link history across results and leads. */
  sourceRecordId: string;
  lead: { status: string } | null;
};

/** Ownership-checked lookup of a ref, without live provider calls. Not the user's → 404. */
async function resolveRef(tx: DbOrTx, user: AppUser, ref: ProposalRef): Promise<ResolvedRef> {
  if (!isUuid(ref.id)) throw notFound(ref.kind === "lead" ? "Lead" : "Search result");
  if (ref.kind === "lead") {
    const [r] = await tx
      .select({
        leadId: leads.id,
        status: leads.status,
        businessId: businesses.id,
        name: businesses.name,
        source: businesses.source,
        sourceRecordId: businesses.sourceRecordId,
      })
      .from(leads)
      .innerJoin(businesses, eq(businesses.id, leads.businessId))
      .where(and(eq(leads.id, ref.id), eq(leads.userId, user.id), eq(businesses.userId, user.id)))
      .limit(1);
    if (!r) throw notFound("Lead");
    return { leadId: r.leadId, businessId: r.businessId, name: r.name, source: r.source, sourceRecordId: r.sourceRecordId, lead: { status: r.status } };
  }
  const [r] = await tx
    .select({ name: searchResults.name, source: searchResults.source, sourceRecordId: searchResults.sourceRecordId })
    .from(searchResults)
    .where(and(eq(searchResults.id, ref.id), eq(searchResults.userId, user.id)))
    .limit(1);
  if (!r) throw notFound("Search result");
  // Link to the saved business record, if this place was already saved to a collection.
  const [b] = await tx
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.userId, user.id), eq(businesses.source, r.source), eq(businesses.sourceRecordId, r.sourceRecordId)))
    .limit(1);
  return { leadId: null, businessId: b?.id ?? null, name: r.name, source: r.source, sourceRecordId: r.sourceRecordId, lead: null };
}

/**
 * Log a proposal. Channel email/whatsapp stamps sent_at. For a lead, status moves to
 * proposal_sent (only from new / contacted — never backwards) and last_contacted_at is set.
 */
export async function saveProposal(user: AppUser, input: SaveProposalInput, opts: { ip?: string | null } = {}): Promise<SaveProposalResponse> {
  const data = saveProposalSchema.parse(input);
  const ref = data.ref ?? null;
  const now = new Date();

  return db().transaction(async (tx) => {
    const resolved = ref ? await resolveRef(tx, user, ref) : null;
    // The name is a snapshot of message content, but provider names are stored only where the source policy allows it.
    const businessName = resolved?.name && canPersist(resolved.source, "business_name") ? resolved.name : null;

    const [saved] = await tx
      .insert(proposals)
      .values({
        userId: user.id,
        businessId: resolved?.businessId ?? null,
        leadId: resolved?.leadId ?? null,
        source: resolved?.source ?? null,
        sourceRecordId: resolved?.sourceRecordId ?? null,
        businessName,
        topic: data.topic,
        language: data.language,
        subject: data.subject,
        body: data.body,
        channel: data.channel,
        generatedBy: data.generatedBy,
        sentAt: data.channel === "email" || data.channel === "whatsapp" ? now : null,
      })
      .returning();
    if (!saved) throw new Error("Saving the proposal returned no row");

    let lead: SaveProposalResponse["lead"] = null;
    let statusChanged = false;
    if (resolved?.leadId) {
      const [u] = await tx
        .update(leads)
        .set({
          status: sql`case when ${leads.status} in ('new', 'contacted') then 'proposal_sent' else ${leads.status} end`,
          lastContactedAt: now,
          updatedAt: now,
        })
        .where(and(eq(leads.id, resolved.leadId), eq(leads.userId, user.id)))
        .returning({ id: leads.id, status: leads.status, lastContactedAt: leads.lastContactedAt });
      if (u) {
        lead = { id: u.id, status: u.status, lastContactedAt: u.lastContactedAt?.toISOString() ?? null };
        statusChanged = resolved.lead?.status !== u.status;
      }
    }

    await audit(
      {
        actorId: user.id,
        action: "proposal.save",
        resourceType: "proposal",
        resourceId: saved.id,
        metadata: {
          topic: data.topic,
          language: data.language,
          channel: data.channel,
          generatedBy: data.generatedBy,
          refKind: ref?.kind ?? null,
          leadId: resolved?.leadId ?? null,
          ...(statusChanged && lead ? { leadStatus: lead.status } : {}),
        },
        ip: opts.ip,
      },
      tx,
    );
    return { ...toDto(saved), lead };
  });
}

export const HISTORY_LIMIT = 50;

/**
 * The user's proposals, newest first — all of them, or those for one place (ref). Foreign ref → 404.
 *
 * A place's history = proposals linked to the lead or its saved business, plus proposals written from
 * a search result for the same place (matched by source + source_record_id).
 */
export async function listProposals(user: AppUser, ref?: ProposalRef | null): Promise<ProposalDto[]> {
  let scope: SQL | undefined;
  if (ref) {
    const r = await resolveRef(db(), user, ref);
    const savedForPlace = and(eq(proposals.source, r.source), eq(proposals.sourceRecordId, r.sourceRecordId))!;
    scope = or(
      ...[r.leadId ? eq(proposals.leadId, r.leadId) : undefined, r.businessId ? eq(proposals.businessId, r.businessId) : undefined, savedForPlace].filter(
        (c): c is SQL => c !== undefined,
      ),
    );
  }
  const rows = await db()
    .select()
    .from(proposals)
    .where(and(eq(proposals.userId, user.id), scope))
    .orderBy(desc(proposals.createdAt), desc(proposals.id))
    .limit(HISTORY_LIMIT);
  return rows.map(toDto);
}
