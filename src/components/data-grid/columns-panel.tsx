"use client";
import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { FIELDS, type FieldContext, type FieldKey } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PINNED_COLUMN, canMoveColumn, hiddenColumns, moveColumn, toggleColumn } from "./columns";

/**
 * Column chooser: shown columns in display order (with move up/down buttons) and hidden columns
 * below. Business name is always shown and stays first.
 */
export function ColumnsPanel({
  context,
  columns,
  onChange,
  onReset,
}: {
  context: FieldContext;
  columns: FieldKey[];
  onChange: (cols: FieldKey[]) => void;
  onReset: () => void;
}) {
  const id = React.useId();
  const pendingFocus = React.useRef<{ key: FieldKey; dir: -1 | 1 } | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const hidden = hiddenColumns(columns, context);

  // Moving re-orders DOM nodes, which can drop focus; put it back on the same control.
  React.useEffect(() => {
    const p = pendingFocus.current;
    if (!p || !listRef.current) return;
    pendingFocus.current = null;
    const btn = (dir: -1 | 1) => listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${p.key}:${dir}"]`);
    const target = btn(p.dir);
    (target && !target.disabled ? target : btn(p.dir === -1 ? 1 : -1))?.focus();
  }, [columns]);

  const move = (key: FieldKey, dir: -1 | 1) => {
    pendingFocus.current = { key, dir };
    onChange(moveColumn(columns, key, dir));
  };

  const renderRow = (k: FieldKey, shown: boolean) => {
    const pinned = k === PINNED_COLUMN;
    const cid = `${id}-${k}`;
    return (
      <li key={k} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted", !shown && "text-muted-foreground")}>
        <Checkbox id={cid} checked={shown} disabled={pinned} onCheckedChange={() => onChange(toggleColumn(columns, k, context))} />
        <label htmlFor={cid} className={cn("min-w-0 flex-1 truncate text-[13px]", shown && "text-foreground", !pinned && "cursor-pointer")}>
          {FIELDS[k].label}
          {pinned && <span className="ml-1.5 text-[11px] text-muted-foreground">Always shown</span>}
        </label>
        {shown && !pinned && (
          <span className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon-xs"
              data-move={`${k}:-1`}
              disabled={!canMoveColumn(columns, k, -1)}
              onClick={() => move(k, -1)}
              aria-label={`Move ${FIELDS[k].label} up`}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              data-move={`${k}:1`}
              disabled={!canMoveColumn(columns, k, 1)}
              onClick={() => move(k, 1)}
              aria-label={`Move ${FIELDS[k].label} down`}
            >
              <ArrowDown aria-hidden />
            </Button>
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium">Columns</p>
        <Button variant="link" size="xs" className="text-[12px]" onClick={onReset}>
          Reset to default
        </Button>
      </div>
      <div ref={listRef} className="grid max-h-[min(60vh,26rem)] gap-3 overflow-y-auto pr-1">
        <div className="grid gap-1">
          <p className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Shown</p>
          <ul className="grid">
            {columns.map((k) => renderRow(k, true))}
          </ul>
        </div>
        {hidden.length > 0 && (
          <div className="grid gap-1">
            <p className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Hidden</p>
            <ul className="grid">
              {hidden.map((k) => renderRow(k, false))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
