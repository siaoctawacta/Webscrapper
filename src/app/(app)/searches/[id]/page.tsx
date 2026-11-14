import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isUuid } from "@/server/http";
import { Skeleton } from "@/components/ui/misc";
import { ResultsView } from "@/components/search/results-view";

export const metadata: Metadata = { title: "Search results" };

export default async function SearchResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ResultsView jobId={id} />
    </Suspense>
  );
}
