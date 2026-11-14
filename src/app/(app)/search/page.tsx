import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchForm } from "@/components/search/search-form";
import { RecentSearches } from "@/components/search/recent-searches";

export const metadata: Metadata = { title: "New search" };

const STEPS = [
  { n: 1, title: "Search on Google Maps", body: "Type what you’re looking for, e.g. “hotel” or “salon de coiffure”." },
  { n: 2, title: "Frame the area", body: "Zoom and move the map to the neighbourhood or city you want to cover." },
  { n: 3, title: "Copy the link", body: "Copy the address bar and paste it here. Short share links work too." },
];

export default function SearchPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Find businesses</h1>
        <p className="text-sm text-muted-foreground">
          Paste a Google Maps search link or search by keyword and place. We’ll collect each business’s details and sort out who has a website and who doesn’t.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <SearchForm />
        </CardContent>
      </Card>

      <section className="grid gap-3">
        <h2 className="text-[13px] font-medium text-muted-foreground">How to get a Google Maps link</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-lg border border-border p-4">
              <span className="mb-2 flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular">{s.n}</span>
              <p className="text-[13px] font-medium">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        <Link
          href="https://www.google.com/maps"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-[13px] text-accent hover:underline"
        >
          Open Google Maps <ArrowUpRight className="size-3.5" />
        </Link>
      </section>

      <RecentSearches />
    </div>
  );
}
