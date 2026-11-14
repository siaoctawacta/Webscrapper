import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isUuid } from "@/server/http";
import { Skeleton } from "@/components/ui/misc";
import { CollectionView } from "@/components/collections/collection-view";

export const metadata: Metadata = { title: "Collection" };

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <CollectionView collectionId={id} />
    </Suspense>
  );
}
