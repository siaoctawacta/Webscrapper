import type { Metadata } from "next";
import { ConceptsList } from "@/components/concepts/concepts-list";
import { pageUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Homepage concepts" };

export default async function ConceptsPage() {
  await pageUser();
  return <ConceptsList />;
}
