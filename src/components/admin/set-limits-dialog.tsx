"use client";
import * as React from "react";
import { MAX_TARGET_COUNT, TARGET_COUNT_PRESETS } from "@/lib/domain";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import type { AdminLimitDefaults, AdminUserDto } from "@/server/admin/types";

export type LimitsPatch = { maxResultsPerSearch: number | null; monthlyRequestLimit: number | null };

const DEFAULT = "default";

/** Parse the monthly limit field: blank = default (null), else a whole number ≥ 0. */
export function parseMonthlyLimit(raw: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const v = raw.trim().replace(/[\s,]/g, "");
  if (v === "") return { ok: true, value: null };
  if (!/^\d+$/.test(v)) return { ok: false, message: "Enter a whole number (0 or more), or leave blank for the default." };
  const n = Number(v);
  if (n > 100_000_000) return { ok: false, message: "That limit is too large." };
  return { ok: true, value: n };
}

export function SetLimitsDialog({
  user,
  defaults,
  saving,
  onOpenChange,
  onSave,
}: {
  user: AdminUserDto | null;
  defaults: AdminLimitDefaults;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: LimitsPatch) => void;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {user && <LimitsForm key={user.id} user={user} defaults={defaults} saving={saving} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function LimitsForm({
  user,
  defaults,
  saving,
  onSave,
}: {
  user: AdminUserDto;
  defaults: AdminLimitDefaults;
  saving: boolean;
  onSave: (patch: LimitsPatch) => void;
}) {
  const [maxResults, setMaxResults] = React.useState(user.maxResultsPerSearch == null ? DEFAULT : String(user.maxResultsPerSearch));
  const [monthly, setMonthly] = React.useState(user.monthlyRequestLimit == null ? "" : String(user.monthlyRequestLimit));
  const [error, setError] = React.useState<string | null>(null);
  const ids = { max: React.useId(), monthly: React.useId() };

  const options: SelectOption[] = React.useMemo(() => {
    const values = new Set<number>(TARGET_COUNT_PRESETS.filter((n) => n <= MAX_TARGET_COUNT));
    if (user.maxResultsPerSearch != null) values.add(user.maxResultsPerSearch);
    return [
      { value: DEFAULT, label: `Default (${formatNumber(defaults.maxResultsPerSearch)})` },
      ...[...values].sort((a, b) => a - b).map((n) => ({ value: String(n), label: formatNumber(n) })),
    ];
  }, [defaults.maxResultsPerSearch, user.maxResultsPerSearch]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const m = parseMonthlyLimit(monthly);
    if (!m.ok) {
      setError(m.message);
      return;
    }
    setError(null);
    onSave({ maxResultsPerSearch: maxResults === DEFAULT ? null : Number(maxResults), monthlyRequestLimit: m.value });
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Limits for {user.name || user.email}</DialogTitle>
        <DialogDescription>Overrides the app-wide defaults for this person only.</DialogDescription>
      </DialogHeader>
      <Field
        label="Max results per search"
        htmlFor={ids.max}
        hint="Searches asking for more results are capped at this number."
      >
        <Select id={ids.max} value={maxResults} onValueChange={setMaxResults} options={options} aria-label="Max results per search" />
      </Field>
      <Field
        label="Monthly request limit"
        htmlFor={ids.monthly}
        error={error}
        hint={`Billable Google requests per month. Leave blank for the default (${formatNumber(defaults.monthlyRequestLimit)}). 0 blocks paid searches.`}
      >
        <Input
          id={ids.monthly}
          inputMode="numeric"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          placeholder={`Default (${formatNumber(defaults.monthlyRequestLimit)})`}
          aria-invalid={error ? true : undefined}
        />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" loading={saving}>
          Save limits
        </Button>
      </DialogFooter>
    </form>
  );
}
