import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestUser } from "../../../tests/helpers/auth";
import { resetDb } from "../../../tests/helpers/db";
import type { AppUser } from "../auth/session";
import { mockJsonModel, mockTextModel, promptText } from "../ai/test-model";
import { closeDb, db } from "../db";
import { auditLogs, leads, proposals, usageLogs, userSettings } from "../db/schema";
import { notFound } from "../errors";
import { AI_FALLBACK_WARNING } from "./polish";
import { AI_UNAVAILABLE_WARNING, draftProposal, listProposals, saveProposal } from "./service";
import { insertConcept, insertLead, insertResult } from "./test-fixtures";
import { fullRow, fullSender } from "./test-rows";
import type { ProposalRef } from "./types";

let user: AppUser;
let other: AppUser;

const asUser = (u: { id: string; email: string }): AppUser => ({ id: u.id, email: u.email, name: "Test", role: "member", status: "active" });
const REF: ProposalRef = { kind: "result", id: "00000000-0000-4000-8000-000000000001" };

beforeEach(async () => {
  await resetDb();
  user = asUser(await createTestUser());
  other = asUser(await createTestUser());
});

afterAll(async () => {
  await closeDb();
});

/** A loader that only knows one business, owned by `user`. */
const loader = (row = fullRow()) => async (u: AppUser, ref: ProposalRef) => {
  if (u.id !== user.id || ref.id !== row.id) throw notFound("Search result");
  return row;
};

const noConcept = async () => null;

describe("draftProposal", () => {
  it("builds a template draft with facts, channels and the sender profile from settings", async () => {
    await db().insert(userSettings).values({ userId: user.id, senderName: "Kofi Mensah", senderEmail: "kofi@atelier.example", defaultLanguage: "fr" });
    const d = await draftProposal(user, { ref: REF, topic: "website_redesign", language: "en" }, { loadBusiness: loader(), conceptUrl: noConcept });
    expect(d.generatedBy).toBe("template");
    expect(d.topic).toBe("website_redesign");
    expect(d.language).toBe("en");
    expect(d.subject).toBe("A few ideas for the Hôtel Le Bénin website");
    expect(d.body).toContain("Kofi Mensah");
    expect(d.channels).toEqual({ email: "contact@hotel-le-benin.example", whatsappNumber: "22890123456" });
    expect(d.factsUsed).toMatchObject({ businessName: "Hôtel Le Bénin", city: "Lomé", rating: 4.6, reviewCount: 87 });
    expect(d.warnings).toEqual([]);
  });

  it("reports missing channels as null", async () => {
    const row = fullRow({ email: null, phoneE164: null, phone: "90 12 34" });
    const d = await draftProposal(user, { ref: REF, topic: "branding", language: "fr" }, { loadBusiness: loader(row), conceptUrl: noConcept });
    expect(d.channels).toEqual({ email: null, whatsappNumber: null });
    expect(d.warnings).toContain("Add your name and contact details in Settings so prospects know who's writing.");
  });

  it("passes the loader's 404 through for refs the user can't see", async () => {
    await expect(draftProposal(other, { ref: REF, topic: "branding", language: "en" }, { loadBusiness: loader(), conceptUrl: noConcept })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("falls back to the template with a warning when AI isn't configured", async () => {
    const d = await draftProposal(user, { ref: REF, topic: "branding", language: "en", useAi: true }, { loadBusiness: loader(), conceptUrl: noConcept });
    expect(d.generatedBy).toBe("template");
    expect(d.warnings).toContain(AI_UNAVAILABLE_WARNING);
  });

  it("uses the AI rewrite when it keeps every fact and the signature", async () => {
    const sender = fullSender();
    const model = mockTextModel((opts) => {
      const { user: prompt } = promptText(opts);
      // The draft travels inside the data block, never as instructions.
      expect(prompt).toContain("<data>");
      expect(prompt).toContain("Hôtel Le Bénin");
      return JSON.stringify({
        subject: "Ideas for the Hôtel Le Bénin website",
        body: [
          "Hello Hôtel Le Bénin team,",
          "",
          "Your 4.6-star rating from 87 reviews on Google Maps shows how much guests in Lomé enjoy staying with you.",
          "",
          "Best regards,",
          "Kofi Mensah",
          "Atelier Web",
          "+228 90 00 00 00 · kofi@atelier.example",
          "atelier.example",
        ].join("\n"),
      });
    });
    const d = await draftProposal(
      user,
      { ref: REF, topic: "website_redesign", language: "en", useAi: true },
      { loadBusiness: loader(), conceptUrl: noConcept, senderProfile: async () => sender, ai: { model } },
    );
    expect(d.generatedBy).toBe("ai");
    expect(d.subject).toBe("Ideas for the Hôtel Le Bénin website");
    expect(d.body).toContain("shows how much guests in Lomé enjoy");
    expect(d.warnings).toEqual([]);
    const usage = await db().select().from(usageLogs).where(eq(usageLogs.userId, user.id));
    expect(usage.map((u) => u.operation)).toEqual(["ai_proposal"]);
  });

  it("keeps the template when the AI adds facts", async () => {
    const model = mockJsonModel({
      subject: "A website for Hôtel Le Bénin",
      body: "Hello! We have helped 250 hotels grow by 40%.\n\nBest regards,\nKofi Mensah\nAtelier Web\n+228 90 00 00 00 · kofi@atelier.example\natelier.example",
    });
    const d = await draftProposal(
      user,
      { ref: REF, topic: "new_website", language: "en", useAi: true },
      { loadBusiness: loader(), conceptUrl: noConcept, senderProfile: async () => fullSender(), ai: { model } },
    );
    expect(d.generatedBy).toBe("template");
    expect(d.subject).toBe("A website for Hôtel Le Bénin");
    expect(d.body).not.toContain("250 hotels");
    expect(d.warnings).toContain(AI_FALLBACK_WARNING);
  });

  it("keeps the template when the AI output is unusable", async () => {
    const d = await draftProposal(
      user,
      { ref: REF, topic: "local_seo", language: "fr", useAi: true },
      { loadBusiness: loader(), conceptUrl: noConcept, ai: { model: mockTextModel("Voici votre email !") } },
    );
    expect(d.generatedBy).toBe("template");
    expect(d.body.startsWith("Bonjour,")).toBe(true);
    expect(d.warnings.some((w) => /template version is shown instead/.test(w))).toBe(true);
  });

  it("adds the link to a shared concept for the same result or lead", async () => {
    const result = await insertResult(user.id);
    const { lead } = await insertLead(user.id);
    const c1 = await insertConcept(user.id, { ref: { kind: "result", id: result.id }, shareToken: "tok-result" });
    await insertConcept(user.id, { leadId: lead.id, shareToken: "tok-lead" });
    await insertConcept(user.id, { ref: { kind: "result", id: result.id }, shareToken: "tok-private", shareEnabled: false });
    await insertConcept(other.id, { ref: { kind: "lead", id: lead.id }, shareToken: "tok-other" });

    const fromResult = await draftProposal(user, { ref: { kind: "result", id: result.id }, topic: "new_website", language: "en" }, { loadBusiness: async () => fullRow() });
    expect(fromResult.body).toContain(`http://localhost:3000/c/${c1.shareToken}`);
    expect(fromResult.factsUsed.conceptUrl).toBe("http://localhost:3000/c/tok-result");

    const fromLead = await draftProposal(user, { ref: { kind: "lead", id: lead.id }, topic: "new_website", language: "fr" }, { loadBusiness: async () => fullRow() });
    expect(fromLead.body).toContain("http://localhost:3000/c/tok-lead");
    expect(fromLead.body).not.toContain("tok-other");

    const none = await draftProposal(other, { ref: { kind: "result", id: result.id }, topic: "new_website", language: "en" }, { loadBusiness: async () => fullRow() });
    expect(none.body).not.toContain("/c/");
  });
});

describe("saveProposal / listProposals", () => {
  const base = { topic: "new_website" as const, language: "en" as const, subject: "A website for Maquis Chez Ama", body: "Hello…", generatedBy: "template" as const };

  it("logs a lead proposal, moves the lead to proposal_sent and stamps last_contacted_at", async () => {
    const { lead, business } = await insertLead(user.id, { status: "new" });
    const before = Date.now();
    const saved = await saveProposal(user, { ...base, ref: { kind: "lead", id: lead.id }, channel: "email" }, { ip: "203.0.113.9" });
    expect(saved).toMatchObject({ leadId: lead.id, businessId: business.id, businessName: "Maquis Chez Ama", channel: "email", generatedBy: "template" });
    expect(saved.sentAt).not.toBeNull();
    expect(saved.lead?.status).toBe("proposal_sent");
    const [l] = await db().select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("proposal_sent");
    expect(l!.lastContactedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [a] = await db().select().from(auditLogs).where(eq(auditLogs.action, "proposal.save"));
    expect(a).toMatchObject({ actorId: user.id, resourceType: "proposal", resourceId: saved.id, ip: "203.0.113.9" });
    expect(a!.metadata).toMatchObject({ channel: "email", refKind: "lead", leadStatus: "proposal_sent" });
  });

  it("moves contacted leads forward but never moves a lead backwards", async () => {
    const contacted = await insertLead(user.id, { status: "contacted" });
    const replied = await insertLead(user.id, { status: "replied" });
    const won = await insertLead(user.id, { status: "won" });
    expect((await saveProposal(user, { ...base, ref: { kind: "lead", id: contacted.lead.id }, channel: "whatsapp" })).lead?.status).toBe("proposal_sent");
    expect((await saveProposal(user, { ...base, ref: { kind: "lead", id: replied.lead.id }, channel: "email" })).lead?.status).toBe("replied");
    const w = await saveProposal(user, { ...base, ref: { kind: "lead", id: won.lead.id }, channel: "copy" });
    expect(w.lead?.status).toBe("won");
    expect(w.lead?.lastContactedAt).not.toBeNull();
    expect(w.sentAt).toBeNull();
  });

  it("logs a search-result proposal without touching leads, linking the saved business when there is one", async () => {
    const result = await insertResult(user.id, { sourceRecordId: "sample-shared" });
    const unsaved = await saveProposal(user, { ...base, ref: { kind: "result", id: result.id }, channel: "copy" });
    expect(unsaved).toMatchObject({ leadId: null, businessId: null, businessName: "Maquis Chez Ama", sentAt: null, lead: null });

    const { business } = await insertLead(user.id, { sourceRecordId: "sample-shared" });
    const linked = await saveProposal(user, { ...base, ref: { kind: "result", id: result.id }, channel: "email" });
    expect(linked.businessId).toBe(business.id);
  });

  it("doesn't store Google business names (source policy)", async () => {
    const result = await insertResult(user.id, { source: "google_places", sourceRecordId: "ChIJx", name: "Google Place" });
    const saved = await saveProposal(user, { ...base, ref: { kind: "result", id: result.id }, channel: "copy" });
    expect(saved.businessName).toBeNull();
  });

  it("returns 404 for other users' or unknown refs and saves nothing", async () => {
    const { lead } = await insertLead(other.id);
    const result = await insertResult(other.id);
    for (const ref of [
      { kind: "lead" as const, id: lead.id },
      { kind: "result" as const, id: result.id },
      { kind: "lead" as const, id: "not-a-uuid" },
      { kind: "result" as const, id: "11111111-1111-4111-8111-111111111111" },
    ]) {
      await expect(saveProposal(user, { ...base, ref, channel: "email" })).rejects.toMatchObject({ code: "not_found" });
    }
    expect(await db().select().from(proposals)).toHaveLength(0);
    const [l] = await db().select().from(leads).where(and(eq(leads.id, lead.id)));
    expect(l!.status).toBe("new");
  });

  it("lists history newest first, per business, only for the owner", async () => {
    const { lead } = await insertLead(user.id, { sourceRecordId: "sample-hist" });
    const result = await insertResult(user.id, { sourceRecordId: "sample-hist" });
    const unrelated = await insertLead(user.id);
    const p1 = await saveProposal(user, { ...base, subject: "First", ref: { kind: "lead", id: lead.id }, channel: "email" });
    const p2 = await saveProposal(user, { ...base, subject: "From results", ref: { kind: "result", id: result.id }, channel: "whatsapp" });
    await saveProposal(user, { ...base, subject: "Other lead", ref: { kind: "lead", id: unrelated.lead.id }, channel: "email" });
    await saveProposal(user, { ...base, subject: "No ref", channel: "copy" });

    const forLead = await listProposals(user, { kind: "lead", id: lead.id });
    expect(forLead.map((p) => p.id)).toEqual([p2.id, p1.id]);
    const forResult = await listProposals(user, { kind: "result", id: result.id });
    expect(forResult.map((p) => p.subject)).toEqual(["From results", "First"]);
    expect((await listProposals(user)).map((p) => p.subject)).toEqual(["No ref", "Other lead", "From results", "First"]);

    expect(await listProposals(other)).toEqual([]);
    await expect(listProposals(other, { kind: "lead", id: lead.id })).rejects.toMatchObject({ code: "not_found" });
  });
});
