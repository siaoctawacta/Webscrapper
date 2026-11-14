"use client";
import * as React from "react";
import { EllipsisVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Kebab menu for the grid's trailing actions cell. Children are DropdownMenuItem elements:
 *
 *   rowActions={(row) => (
 *     <RowActionsMenu label={`Actions for ${row.name ?? "business"}`}>
 *       <DropdownMenuItem onSelect={() => open(row)}><PanelRight /> Details</DropdownMenuItem>
 *     </RowActionsMenu>
 *   )}
 */
export function RowActionsMenu({ children, label = "Row actions" }: { children: React.ReactNode; label?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} className="text-muted-foreground data-[state=open]:bg-muted">
          <EllipsisVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
