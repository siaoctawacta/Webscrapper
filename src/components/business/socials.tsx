"use client";
import * as React from "react";
import type { Socials } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { SOCIAL_KEYS, SOCIAL_LABELS, type SocialKey } from "./labels";
import { safeHttpUrl } from "./row-utils";

const MONOGRAM: Record<SocialKey, string> = {
  facebook: "f",
  instagram: "IG",
  linkedin: "in",
  x: "X",
  tiktok: "TT",
  youtube: "YT",
  whatsapp: "WA",
};

/** Links to the business's social profiles (as linked from its own website). */
export function SocialLinks({ socials, className, size = "sm" }: { socials: Socials; className?: string; size?: "sm" | "md" }) {
  const items = SOCIAL_KEYS.map((k) => ({ key: k, href: safeHttpUrl(socials[k]) })).filter((i): i is { key: SocialKey; href: string } => !!i.href);
  if (!items.length) return <span className="text-muted-foreground/70">—</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {items.map((i) => (
        <Tooltip key={i.key} content={SOCIAL_LABELS[i.key]}>
          <a
            href={i.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            aria-label={`${SOCIAL_LABELS[i.key]} (opens in a new tab)`}
            className={cn(
              "inline-flex items-center justify-center rounded-md border border-border bg-background font-semibold text-muted-foreground outline-none transition hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
              size === "sm" ? "h-5 min-w-5 px-1 text-[9px]" : "h-7 min-w-7 px-1.5 text-[11px]",
            )}
          >
            {MONOGRAM[i.key]}
          </a>
        </Tooltip>
      ))}
    </span>
  );
}
