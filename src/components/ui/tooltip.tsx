"use client";
import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top", className }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn("z-50 max-w-72 rounded-md bg-primary px-2.5 py-1.5 text-xs leading-relaxed text-primary-foreground shadow-md data-[state=delayed-open]:animate-in", className)}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
