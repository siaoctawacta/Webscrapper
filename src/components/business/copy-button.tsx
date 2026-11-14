"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

/**
 * Small icon button that copies `value`. With `reveal` it stays hidden until the surrounding
 * `.group` is hovered or focused (always visible on touch screens).
 */
export function CopyButton({ value, label, reveal, className }: { value: string; label: string; reveal?: boolean; className?: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy(value, `${label} copied`);
      }}
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        reveal && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
