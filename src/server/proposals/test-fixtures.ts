/**
 * Test-only DB fixtures for the proposals module (imported by *.test.ts files only, never by app code).
 * Inserts search results, leads and concepts directly so tests don't depend on other modules' services.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { emptyProgress, type LeadStatus } from "@/lib/domain";
import { db } from "../db";
import { businesses, collections, concepts, leads, searchJobs, searchResults, type NewSearchResult } from "../db/schema";

type BusinessFields = Partial<Omit<NewSearchResult, "id" | "jobId" | "userId" | "position">>;

/** Sample-source business with every fact a proposal can use. */
export const sampleBusiness = (o: BusinessFields = {}): BusinessFields => ({
  source: "sample",
  sourceRecordId: `sample-${randomBytes(4).toString("hex")}`,
  name: "Maquis Chez Ama",
  category: "Restaurant",
  categories: ["restaurant"],
  phoneRaw: "+228 90 12 34 56",
  phoneE164: "+22890123456",
  phoneDigits: "22890123456",
  websiteUrl: null,
  websiteHost: null,
  websiteStatus: "none",
  city: "Lomé",
  country: "Togo",
  rating: 4.5,
  reviewCount: 42,
  primaryEmail: null,
  emails: [],
  socials: {},
  ...o,
});

export async function insertResult(userId: string, o: BusinessFields = {}) {
  const [job] = await db()
    .insert(searchJobs)
    .values({
      userId,
      kind: "keyword",
      query: "restaurant",
      location: { label: "Lomé, Togo" },
      provider: "sample",
      targetCount: 20,
      status: "completed",
      progress: emptyProgress(),
    })
    .returning();
  const spec = sampleBusiness(o);
  const [row] = await db()
    .insert(searchResults)
    .values({ ...spec, source: spec.source ?? "sample", sourceRecordId: spec.sourceRecordId!, jobId: job!.id, userId, position: 0 })
    .returning();
  return row!;
}

export async function insertLead(userId: string, o: BusinessFields & { status?: LeadStatus; sourceRecordId?: string } = {}) {
  const { status, ...fields } = o;
  const spec = sampleBusiness(fields);
  const [collection] = await db()
    .insert(collections)
    .values({ userId, name: `Leads ${randomBytes(3).toString("hex")}` })
    .returning();
  const [business] = await db()
    .insert(businesses)
    .values({ ...spec, source: spec.source ?? "sample", sourceRecordId: spec.sourceRecordId!, userId })
    .returning();
  const [lead] = await db()
    .insert(leads)
    .values({ collectionId: collection!.id, businessId: business!.id, userId, status: status ?? "new" })
    .returning();
  return { lead: lead!, business: business!, collection: collection! };
}

export async function insertConcept(
  userId: string,
  o: { leadId?: string | null; ref?: { kind: "result" | "lead"; id: string }; shareEnabled?: boolean; shareToken?: string } = {},
) {
  const [c] = await db()
    .insert(concepts)
    .values({
      userId,
      leadId: o.leadId ?? null,
      businessName: "Maquis Chez Ama",
      input: o.ref ? { ref: o.ref } : {},
      content: {},
      generatedBy: "template",
      shareEnabled: o.shareEnabled ?? true,
      shareToken: o.shareToken ?? randomBytes(16).toString("hex"),
    })
    .returning();
  return c!;
}
