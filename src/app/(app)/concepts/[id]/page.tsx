import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConceptEditor } from "@/components/concepts/concept-editor";
import { pageUser } from "@/server/auth/session";
import { isUuid } from "@/server/http";

export const metadata: Metadata = { title: "Homepage concept" };

export default async function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  await pageUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <ConceptEditor conceptId={id} />;
}
