import type { Metadata } from "next";
import { CollectionsList } from "@/components/collections/collections-list";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage() {
  return <CollectionsList />;
}
