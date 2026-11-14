import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestUser, type TestUser } from "../../../../../tests/helpers/auth";
import { resetDb } from "../../../../../tests/helpers/db";
import { apiRequest, ctx } from "../../../../../tests/helpers/request";
import type { ProposalDraft } from "@/lib/api-types";
import { closeDb, db } from "@/server/db";
import { leads, userSettings } from "@/server/db/schema";
import { insertLead, insertResult } from "@/server/proposals/test-fixtures";
import type { ProposalListResponse, SaveProposalResponse } from "@/server/proposals/types";
import { POST as draftPOST } from "./draft/route";
import { GET, POST } from "./route";

let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await resetDb();
  alice = await createTestUser();
  bob = await createTestUser();
});

afterAll(async () => {
  await closeDb();
});

const draft = (user: TestUser | undefined, body: unknown) => draftPOST(apiRequest("/api/v1/proposals/draft", { method: "POST", user, body }), ctx({}));
const save = (user: TestUser | undefined, body: unknown) => POST(apiRequest("/api/v1/proposals", { method: "POST", user, body }), ctx({}));
const list = (user: TestUser | undefined, qs = "") => GET(apiRequest(`/api/v1/proposals${qs}`, { user }), ctx({}));

describe("POST /api/v1/proposals/draft", () => {
  it("drafts from a search result the user owns", async () => {
    await db().insert(userSettings).values({ userId: alice.id, senderName: "Ama Koffi", senderPhone: "+228 91 00 00 00" });
    const result = await insertResult(alice.id);
    const res = await draft(alice, { ref: { kind: "result", id: result.id }, topic: "new_website", language: "fr" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as ProposalDraft;
    expect(d.subject).toBe("Un site web pour Maquis Chez Ama");
    expect(d.body).toContain("J'ai découvert Maquis Chez Ama, restaurant à Lomé, et j'ai remarqué que vous n'avez pas encore de site web.");
    expect(d.body).toContain("Félicitations pour votre note de 4,5/5 (42 avis)");
    expect(d.body).not.toContain("Google Maps (");
    expect(d.body).toMatch(/Cordialement,\nAma Koffi\n\+228 91 00 00 00$/);
    expect(d.channels).toEqual({ email: null, whatsappNumber: "22890123456" });
    expect(d.generatedBy).toBe("template");
  });

  it("drafts from a saved lead the user owns", async () => {
    const { lead } = await insertLead(alice.id, { websiteStatus: "present", websiteUrl: "https://ama.example", websiteHost: "ama.example", primaryEmail: "hello@ama.example" });
    const res = await draft(alice, { ref: { kind: "lead", id: lead.id }, topic: "website_redesign", language: "en" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as ProposalDraft;
    expect(d.body.startsWith("Hello Maquis Chez Ama team,")).toBe(true);
    expect(d.channels.email).toBe("hello@ama.example");
  });

  it("returns 404 for another user's refs and unknown ids", async () => {
    const result = await insertResult(bob.id);
    const { lead } = await insertLead(bob.id);
    for (const ref of [
      { kind: "result", id: result.id },
      { kind: "lead", id: lead.id },
      { kind: "lead", id: "nope" },
      { kind: "result", id: "11111111-1111-4111-8111-111111111111" },
    ]) {
      const res = await draft(alice, { ref, topic: "branding", language: "en" });
      expect(res.status, JSON.stringify(ref)).toBe(404);
    }
  });

  it("validates the body (422) and requires sign-in (401)", async () => {
    const bad = await draft(alice, { ref: { kind: "place", id: "x" }, topic: "seo", language: "de" });
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.map((d) => d.path).sort()).toEqual(["language", "ref.kind", "topic"]);
    expect((await draft(undefined, { ref: { kind: "result", id: "x" }, topic: "branding", language: "en" })).status).toBe(401);
  });

  it("is rate limited to 30 drafts per minute", async () => {
    const result = await insertResult(alice.id);
    const body = { ref: { kind: "result", id: result.id }, topic: "branding", language: "en" };
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await draft(alice, body)).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("POST /api/v1/proposals and GET /api/v1/proposals", () => {
  const base = { topic: "new_website", language: "en", subject: "A website for Maquis Chez Ama", body: "Hello Maquis Chez Ama team,\n\nBest regards,", generatedBy: "template" };

  it("saves a lead proposal (201), updates the lead and shows it in the history", async () => {
    const { lead } = await insertLead(alice.id, { status: "new" });
    const res = await save(alice, { ...base, ref: { kind: "lead", id: lead.id }, channel: "whatsapp" });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as SaveProposalResponse;
    expect(saved).toMatchObject({ leadId: lead.id, channel: "whatsapp", topic: "new_website", language: "en", subject: base.subject });
    expect(saved.sentAt).not.toBeNull();
    expect(saved.lead).toMatchObject({ id: lead.id, status: "proposal_sent" });
    expect(saved.lead?.lastContactedAt).not.toBeNull();

    const [l] = await db().select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("proposal_sent");
    expect(l!.lastContactedAt).not.toBeNull();

    const hist = await list(alice, `?ref_kind=lead&ref_id=${lead.id}`);
    expect(hist.status).toBe(200);
    const h = (await hist.json()) as ProposalListResponse;
    expect(h.aiAvailable).toBe(false);
    expect(h.proposals.map((p) => p.id)).toEqual([saved.id]);
  });

  it("saves a result proposal without a lead", async () => {
    const result = await insertResult(alice.id);
    const res = await save(alice, { ...base, ref: { kind: "result", id: result.id }, channel: "copy" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ leadId: null, sentAt: null, lead: null });
  });

  it("returns 404 for another user's refs, on save and on list", async () => {
    const { lead } = await insertLead(bob.id);
    expect((await save(alice, { ...base, ref: { kind: "lead", id: lead.id }, channel: "email" })).status).toBe(404);
    expect((await list(alice, `?ref_kind=lead&ref_id=${lead.id}`)).status).toBe(404);
    expect((await list(alice, `?ref_kind=result&ref_id=garbage`)).status).toBe(404);
    const [l] = await db().select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("new");
  });

  it("validates input (422)", async () => {
    const res = await save(alice, { ...base, subject: "   ", channel: "fax" });
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as { error: { details: { path: string; message: string }[] } };
    expect(error.details).toEqual(
      expect.arrayContaining([
        { path: "subject", message: "Add a subject" },
        expect.objectContaining({ path: "channel" }),
      ]),
    );
    expect((await list(alice, "?ref_kind=lead")).status).toBe(422);
  });

  it("lists only the user's own proposals", async () => {
    await save(alice, { ...base, channel: "copy" });
    await save(bob, { ...base, subject: "Bob's", channel: "copy" });
    const h = (await (await list(alice)).json()) as ProposalListResponse;
    expect(h.proposals).toHaveLength(1);
    expect(h.proposals[0]!.subject).toBe(base.subject);
    expect((await list(undefined)).status).toBe(401);
  });
});
