"use client";
import * as React from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean };

/** Simple single-select built on Radix Select. */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = "default",
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate",
          size === "sm" ? "h-8 text-[13px]" : "h-9",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in">
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default select-none flex-col rounded-md py-1.5 pl-8 pr-2 text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
              >
                <span className="absolute left-2 top-2 flex size-4 items-center justify-center">
                  <S.ItemIndicator>
                    <Check className="size-4" />
                  </S.ItemIndicator>
                </span>
                <S.ItemText>{o.label}</S.ItemText>
                {o.description && <span className="text-xs text-muted-foreground">{o.description}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
