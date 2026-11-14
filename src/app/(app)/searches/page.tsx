import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { AllSearches } from "@/components/search/recent-searches";

export const metadata: Metadata = { title: "Searches" };

export default function SearchesPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Searches"
        description="Your recent searches. Google results are kept for a limited time — save the leads you want to keep into a collection."
        actions={
          <Button asChild>
            <Link href="/search">
              <Plus /> New search
            </Link>
          </Button>
        }
      />
      <AllSearches />
    </div>
  );
}
