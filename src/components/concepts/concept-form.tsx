"use client";
import * as React from "react";
import { Info, Sparkles } from "lucide-react";
import type { ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ConceptInput, ConceptLanguage, ConceptOptions, ConceptOptionsBody, ConceptPrefillDto, ConceptSection, ConceptStyle, ConceptTone } from "@/server/concepts/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LANGUAGE_OPTIONS, SECTION_OPTIONS, SECTION_ORDER, STYLE_KEYS, STYLE_OPTIONS, TONE_KEYS, TONE_OPTIONS } from "./options";

export type ConceptFormState = {
  businessName: string;
  businessType: string;
  servicesText: string;
  style: ConceptStyle;
  tone: ConceptTone;
  /** null = "Auto" (the style's palette). */
  primaryColor: string | null;
  language: ConceptLanguage;
  sections: ConceptSection[];
  notes: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  mapsUrl: string;
};

export type FormErrors = Partial<Record<keyof ConceptFormState, string>>;

export const MAX_SERVICES = 12;

export function emptyFormState(language: ConceptLanguage = "en"): ConceptFormState {
  return {
    businessName: "",
    businessType: "",
    servicesText: "",
    style: "modern",
    tone: "friendly",
    primaryColor: null,
    language,
    sections: [...SECTION_ORDER],
    notes: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    city: "",
    mapsUrl: "",
  };
}

export function formStateFromPrefill(p: ConceptPrefillDto): ConceptFormState {
  return {
    ...emptyFormState(p.defaultLanguage),
    businessName: p.contact.businessName,
    businessType: p.businessType ?? "",
    phone: p.contact.phone ?? "",
    whatsapp: p.contact.whatsapp ?? "",
    email: p.contact.email ?? "",
    address: p.contact.address ?? "",
    city: p.contact.city ?? p.city ?? "",
    mapsUrl: p.contact.mapsUrl ?? "",
  };
}

export function formStateFromInput(input: ConceptInput | ConceptOptions): ConceptFormState {
  const c = input.contact;
  return {
    businessName: c.businessName,
    businessType: input.businessType ?? "",
    servicesText: input.services.join("\n"),
    style: input.style,
    tone: input.tone,
    primaryColor: input.primaryColor ?? null,
    language: input.language,
    sections: input.sections?.length ? SECTION_ORDER.filter((s) => input.sections!.includes(s)) : [...SECTION_ORDER],
    notes: input.notes ?? "",
    phone: c.phone ?? "",
    whatsapp: c.whatsapp ?? "",
    email: c.email ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    mapsUrl: c.mapsUrl ?? "",
  };
}

export const parseServices = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.replace(/^[\s•\-*·]+/, "").trim())
    .filter(Boolean);

/** Form → API body (the server validates again). */
export function formStateToBody(s: ConceptFormState): ConceptOptionsBody {
  return {
    services: parseServices(s.servicesText),
    style: s.style,
    tone: s.tone,
    primaryColor: s.primaryColor ?? undefined,
    language: s.language,
    sections: s.sections,
    notes: s.notes,
    businessType: s.businessType,
    contact: {
      businessName: s.businessName,
      phone: s.phone,
      whatsapp: s.whatsapp,
      email: s.email,
      address: s.address,
      city: s.city,
      mapsUrl: s.mapsUrl,
    },
  };
}

/** Quick checks before sending (the server is the authority). */
export function validateForm(s: ConceptFormState): FormErrors {
  const e: FormErrors = {};
  const services = parseServices(s.servicesText);
  if (!s.businessName.trim()) e.businessName = "Enter the business name.";
  if (services.length === 0) e.servicesText = "List at least one service, one per line.";
  else if (services.length > MAX_SERVICES) e.servicesText = `At most ${MAX_SERVICES} services — remove ${services.length - MAX_SERVICES}.`;
  else if (services.some((x) => x.length > 80)) e.servicesText = "Keep each service under 80 characters.";
  if (s.sections.length === 0) e.sections = "Choose at least one section.";
  if (s.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) e.email = "Enter a valid email address.";
  if (s.mapsUrl.trim() && !/^https:\/\//i.test(s.mapsUrl.trim())) e.mapsUrl = "Paste an https Google Maps link.";
  return e;
}

const PATH_TO_FIELD: Record<string, keyof ConceptFormState> = {
  services: "servicesText",
  style: "style",
  tone: "tone",
  primaryColor: "primaryColor",
  language: "language",
  sections: "sections",
  notes: "notes",
  businessType: "businessType",
  "contact.businessName": "businessName",
  "contact.phone": "phone",
  "contact.whatsapp": "whatsapp",
  "contact.email": "email",
  "contact.address": "address",
  "contact.city": "city",
  "contact.mapsUrl": "mapsUrl",
};

/** Map a 422 response (details: [{ path, message }]) onto form fields. */
export function errorsFromApi(err: unknown): FormErrors | null {
  const e = err as ApiClientError | undefined;
  if (!e || e.code !== "validation_failed" || !Array.isArray(e.details)) return null;
  const out: FormErrors = {};
  for (const d of e.details as { path?: string; message?: string }[]) {
    const path = (d.path ?? "").replace(/^input\./, "");
    const key = PATH_TO_FIELD[path] ?? PATH_TO_FIELD[path.split(".").slice(0, 2).join(".")] ?? PATH_TO_FIELD[path.split(".")[0] ?? ""];
    if (key && !out[key]) out[key] = d.message ?? "Check this field";
  }
  return Object.keys(out).length ? out : null;
}

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="grid gap-0.5">
        <legend className="text-[13px] font-semibold tracking-tight">{title}</legend>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}

export function ConceptForm({
  value,
  onChange,
  errors = {},
  disabled,
  attribution,
  idPrefix = "cf",
}: {
  value: ConceptFormState;
  onChange: (next: ConceptFormState) => void;
  errors?: FormErrors;
  disabled?: boolean;
  /** Shown under the contact block when values were pre-filled from a provider (e.g. "Data from Google Maps"). */
  attribution?: string | null;
  idPrefix?: string;
}) {
  const set = <K extends keyof ConceptFormState>(k: K, v: ConceptFormState[K]) => onChange({ ...value, [k]: v });
  const id = (k: string) => `${idPrefix}-${k}`;
  const services = parseServices(value.servicesText);
  const err = (k: keyof ConceptFormState) => (errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${id(k)}-error` } : {});
  const fieldError = (k: keyof ConceptFormState) => (errors[k] ? <span id={`${id(k)}-error`}>{errors[k]}</span> : undefined);

  return (
    <div className="grid gap-6">
      <Section title="Business">
        <Field label="Business name" htmlFor={id("businessName")} error={fieldError("businessName")}>
          <Input id={id("businessName")} value={value.businessName} maxLength={120} disabled={disabled} onChange={(e) => set("businessName", e.target.value)} {...err("businessName")} />
        </Field>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Type of business" htmlFor={id("businessType")} hint="e.g. Hotel, Hair salon" error={fieldError("businessType")}>
            <Input id={id("businessType")} value={value.businessType} maxLength={80} disabled={disabled} onChange={(e) => set("businessType", e.target.value)} {...err("businessType")} />
          </Field>
          <Field label="City" htmlFor={id("city")} error={fieldError("city")}>
            <Input id={id("city")} value={value.city} maxLength={80} disabled={disabled} onChange={(e) => set("city", e.target.value)} {...err("city")} />
          </Field>
        </div>
        <Field
          label="Services"
          htmlFor={id("servicesText")}
          hint={`One per line · ${services.length}/${MAX_SERVICES}`}
          error={fieldError("servicesText")}
        >
          <Textarea
            id={id("servicesText")}
            rows={5}
            value={value.servicesText}
            disabled={disabled}
            placeholder={"Rooms and suites\nRestaurant\nAirport pick-up"}
            onChange={(e) => set("servicesText", e.target.value)}
            {...err("servicesText")}
          />
        </Field>
      </Section>

      <Section title="Look and feel">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Style" htmlFor={id("style")}>
            <Select
              id={id("style")}
              value={value.style}
              disabled={disabled}
              onValueChange={(v) => set("style", v as ConceptStyle)}
              options={STYLE_KEYS.map((k) => ({ value: k, label: STYLE_OPTIONS[k].label, description: STYLE_OPTIONS[k].description }))}
            />
          </Field>
          <Field label="Tone of voice" htmlFor={id("tone")}>
            <Select
              id={id("tone")}
              value={value.tone}
              disabled={disabled}
              onValueChange={(v) => set("tone", v as ConceptTone)}
              options={TONE_KEYS.map((k) => ({ value: k, label: TONE_OPTIONS[k].label, description: TONE_OPTIONS[k].description }))}
            />
          </Field>
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={value.primaryColor === null ? id("autoColor") : id("primaryColor")}>Main colour</Label>
            <div className="flex h-9 items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id={id("autoColor")}
                  checked={value.primaryColor === null}
                  disabled={disabled}
                  onCheckedChange={(auto) => set("primaryColor", auto ? null : "#2563eb")}
                  aria-label="Use the style's colours"
                />
                <Label htmlFor={id("autoColor")} className="font-normal text-muted-foreground">
                  Auto
                </Label>
              </div>
              {value.primaryColor !== null && (
                <>
                  <input
                    id={id("primaryColor")}
                    type="color"
                    value={value.primaryColor}
                    disabled={disabled}
                    onChange={(e) => set("primaryColor", e.target.value.toLowerCase())}
                    className="h-8 w-12 cursor-pointer rounded-md border border-input bg-background p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-describedby={id("primaryColor-hint")}
                  />
                  <span className="font-mono text-xs text-muted-foreground tabular">{value.primaryColor}</span>
                </>
              )}
            </div>
            <p id={id("primaryColor-hint")} className="text-xs text-muted-foreground">
              {value.primaryColor === null ? "Uses the style’s palette. Turn off Auto to pick the main colour." : "Buttons and accents use this colour."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium leading-none" id={id("language-label")}>
              Language
            </span>
            <div role="radiogroup" aria-labelledby={id("language-label")} className="inline-flex h-9 w-fit items-center gap-1 rounded-lg bg-muted p-1">
              {(Object.keys(LANGUAGE_OPTIONS) as ConceptLanguage[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={value.language === l}
                  disabled={disabled}
                  onClick={() => set("language", l)}
                  className={cn(
                    "h-7 rounded-md px-3 text-[13px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
                    value.language === l && "bg-background text-foreground shadow-xs",
                  )}
                >
                  {LANGUAGE_OPTIONS[l]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Sections" description="Choose what the homepage shows.">
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Sections" aria-describedby={errors.sections ? id("sections-error") : undefined}>
          {SECTION_ORDER.map((s) => {
            const checked = value.sections.includes(s);
            return (
              <label
                key={s}
                htmlFor={id(`section-${s}`)}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-subtle",
                  checked && "border-ring/40 bg-accent-soft/40",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <Checkbox
                  id={id(`section-${s}`)}
                  checked={checked}
                  disabled={disabled}
                  className="mt-0.5"
                  onCheckedChange={(on) =>
                    set(
                      "sections",
                      SECTION_ORDER.filter((x) => (x === s ? on === true : value.sections.includes(x))),
                    )
                  }
                />
                <span className="grid gap-0.5">
                  <span className="text-[13px] font-medium leading-none">{SECTION_OPTIONS[s].label}</span>
                  <span className="text-xs text-muted-foreground">{SECTION_OPTIONS[s].description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.sections && (
          <p id={id("sections-error")} className="text-xs text-destructive">
            {errors.sections}
          </p>
        )}
      </Section>

      <Section title="Notes for the copy" description="Anything the text should mention or avoid. Only facts you give here are used.">
        <Field label="Notes" htmlFor={id("notes")} hint={`${value.notes.length}/1000`} error={fieldError("notes")} className="[&>label]:sr-only">
          <Textarea
            id={id("notes")}
            rows={3}
            maxLength={1000}
            value={value.notes}
            disabled={disabled}
            placeholder="e.g. Family-run since 2015, rooftop terrace, speaks English and French"
            onChange={(e) => set("notes", e.target.value)}
            {...err("notes")}
          />
        </Field>
      </Section>

      <Section title="Contact details on the page" description="Shown exactly as written — check them before sharing the concept.">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor={id("phone")} error={fieldError("phone")}>
            <Input id={id("phone")} type="tel" inputMode="tel" value={value.phone} maxLength={40} disabled={disabled} placeholder="+228 90 12 34 56" onChange={(e) => set("phone", e.target.value)} {...err("phone")} />
          </Field>
          <Field
            label="WhatsApp"
            htmlFor={id("whatsapp")}
            error={fieldError("whatsapp")}
            hint={
              value.phone.trim() && value.whatsapp.trim() !== value.phone.trim() ? (
                <button type="button" className="text-accent underline-offset-2 hover:underline disabled:opacity-50" disabled={disabled} onClick={() => set("whatsapp", value.phone.trim())}>
                  Same as phone
                </button>
              ) : (
                "International format, e.g. +228…"
              )
            }
          >
            <Input id={id("whatsapp")} type="tel" inputMode="tel" value={value.whatsapp} maxLength={40} disabled={disabled} onChange={(e) => set("whatsapp", e.target.value)} {...err("whatsapp")} />
          </Field>
        </div>
        <Field label="Email" htmlFor={id("email")} error={fieldError("email")}>
          <Input id={id("email")} type="email" value={value.email} maxLength={254} disabled={disabled} onChange={(e) => set("email", e.target.value)} {...err("email")} />
        </Field>
        <Field label="Address" htmlFor={id("address")} error={fieldError("address")}>
          <Input id={id("address")} value={value.address} maxLength={240} disabled={disabled} onChange={(e) => set("address", e.target.value)} {...err("address")} />
        </Field>
        <Field label="Google Maps link" htmlFor={id("mapsUrl")} hint="Adds an “Open in Google Maps” button" error={fieldError("mapsUrl")}>
          <Input id={id("mapsUrl")} type="url" value={value.mapsUrl} maxLength={2048} disabled={disabled} placeholder="https://maps.app.goo.gl/…" onChange={(e) => set("mapsUrl", e.target.value)} {...err("mapsUrl")} />
        </Field>
        {attribution && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" aria-hidden /> Pre-filled values: {attribution}
          </p>
        )}
      </Section>
    </div>
  );
}

/** "Polish with AI" switch, or a quiet note when the server has no AI key. */
export function AiToggle({ available, checked, onCheckedChange, disabled }: { available: boolean; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  if (!available) {
    return (
      <Notice tone="info" className="py-2">
        AI not configured — using a template. The copy is built only from the details above.
      </Notice>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="flex items-center gap-2 text-[13px] font-medium">
        <Sparkles className="size-4 text-accent" aria-hidden />
        Polish with AI
        <span className="font-normal text-muted-foreground">· uses only your details</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label="Polish with AI" />
    </label>
  );
}

export function hasErrors(e: FormErrors) {
  return Object.values(e).some(Boolean);
}

/** Uncontrolled helper so pages share the same AI preference handling. */
export function useAiPreference(available: boolean) {
  const [useAi, setUseAi] = React.useState(true);
  return { useAi: available && useAi, setUseAi, checked: useAi };
}

export function SubmitRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">{children}</div>;
}

