"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/use-debounced-value";

/**
 * Search box that reports its value after typing pauses (300 ms). Esc clears, Enter applies now.
 * External changes to `value` (e.g. a reset) replace the text unless they are the echo of what
 * this box just reported.
 */
export function QuickSearch({
  value,
  onChange,
  placeholder = "Search name, phone, website, email…",
  delayMs = 300,
  className,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  delayMs?: number;
  className?: string;
}) {
  const ext = value ?? "";
  const [draft, setDraft] = React.useState(ext);
  const [seen, setSeen] = React.useState(ext);
  const [emitted, setEmitted] = React.useState<string | null>(null);
  if (ext !== seen) {
    setSeen(ext);
    if (ext !== emitted) setDraft(ext);
  }

  const emit = React.useCallback(
    (v: string) => {
      const t = v.trim();
      setEmitted(t);
      onChange(t || undefined);
    },
    [onChange],
  );
  const debounced = useDebouncedCallback(emit, delayMs);

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          debounced.call(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.preventDefault();
            e.stopPropagation();
            debounced.cancel();
            setDraft("");
            emit("");
          } else if (e.key === "Enter") {
            e.preventDefault();
            debounced.cancel();
            emit(draft);
          }
        }}
        placeholder={placeholder}
        aria-label="Search results"
        className="h-8 pl-8 pr-8 text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            debounced.cancel();
            setDraft("");
            emit("");
          }}
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label="Clear search"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
