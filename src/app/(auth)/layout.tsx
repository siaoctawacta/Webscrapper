import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-subtle px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        LeadFinder
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
