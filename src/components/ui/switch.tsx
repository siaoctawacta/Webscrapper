"use client";
import * as React from "react";
import { Switch as S } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}
