// TEMPORARY visual-check page for the proposals module — delete after the check.
import { DevProposals } from "./client";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <DevProposals id={sp.id ?? "00000000-0000-4000-8000-000000000001"} kind={sp.kind === "lead" ? "lead" : "result"} variant={sp.variant ?? "none"} />;
}
