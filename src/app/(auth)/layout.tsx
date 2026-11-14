import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link
          href="/sign-in"
          className="mb-8 flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" aria-hidden />
          </span>
          LeadFinder
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        Find local businesses, organise leads and write proposals.
      </footer>
    </div>
  );
}
