import type { Metadata } from "next";
import { NewConcept } from "@/components/concepts/new-concept";
import { pageUser } from "@/server/auth/session";
import { isUuid } from "@/server/http";

export const metadata: Metadata = { title: "New homepage concept" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /concepts/new?ref_kind=result|lead&ref_id=<id> — linked from search results and collections. */
export default async function NewConceptPage({ searchParams }: { searchParams: SearchParams }) {
  await pageUser();
  const sp = await searchParams;
  const kind = sp.ref_kind === "result" || sp.ref_kind === "lead" ? sp.ref_kind : null;
  const id = typeof sp.ref_id === "string" && isUuid(sp.ref_id) ? sp.ref_id : null;
  return <NewConcept key={`${kind}:${id}`} refKind={kind && id ? kind : null} refId={kind && id ? id : null} />;
}
