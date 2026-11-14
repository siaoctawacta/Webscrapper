"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import type { SenderProfile } from "@/lib/api-types";
import type { Language } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { composeSignatureLines } from "./signature";
import { SignaturePreview } from "./signature-preview";

export const SENDER_PROFILE_KEY = ["me", "settings"] as const;

type TextKey = Exclude<keyof SenderProfile, "defaultLanguage">;
type FormState = Record<TextKey, string> & { defaultLanguage: Language };
type FieldErrors = Partial<Record<keyof SenderProfile, string>>;

const SIGNATURE_MAX = 1000;
const TEXT_MAX = 200;

const toForm = (p: SenderProfile): FormState => ({
  senderName: p.senderName ?? "",
  senderCompany: p.senderCompany ?? "",
  senderEmail: p.senderEmail ?? "",
  senderPhone: p.senderPhone ?? "",
  senderWebsite: p.senderWebsite ?? "",
  senderPortfolioUrl: p.senderPortfolioUrl ?? "",
  signature: p.signature ?? "",
  defaultLanguage: p.defaultLanguage,
});

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

const toProfile = (f: FormState): SenderProfile => ({
  senderName: orNull(f.senderName),
  senderCompany: orNull(f.senderCompany),
  senderEmail: orNull(f.senderEmail),
  senderPhone: orNull(f.senderPhone),
  senderWebsite: orNull(f.senderWebsite),
  senderPortfolioUrl: orNull(f.senderPortfolioUrl),
  signature: f.signature.trim() === "" ? null : f.signature.trim(),
  defaultLanguage: f.defaultLanguage,
});

const same = (a: FormState, b: FormState) => (Object.keys(a) as (keyof FormState)[]).every((k) => a[k].trim() === b[k].trim());

/** Map the server's zod details ([{ path, message }]) to field errors. */
function fieldErrors(e: unknown): FieldErrors | null {
  if (!(e instanceof ApiClientError) || e.status !== 422 || !Array.isArray(e.details)) return null;
  const out: FieldErrors = {};
  for (const d of e.details as { path?: unknown; message?: unknown }[]) {
    if (typeof d?.path === "string" && typeof d.message === "string" && !(d.path in out)) out[d.path as keyof SenderProfile] = d.message;
  }
  return Object.keys(out).length ? out : null;
}

function clientErrors(f: FormState): FieldErrors {
  const e: FieldErrors = {};
  for (const k of ["senderName", "senderCompany", "senderEmail", "senderPhone", "senderWebsite", "senderPortfolioUrl"] as const) {
    if (f[k].trim().length > TEXT_MAX) e[k] = `Use ${TEXT_MAX} characters or fewer.`;
  }
  if (f.signature.trim().length > SIGNATURE_MAX) e.signature = `Use ${SIGNATURE_MAX} characters or fewer.`;
  if (f.senderEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.senderEmail.trim())) e.senderEmail = "Enter a valid email address, like name@company.com.";
  return e;
}

export function SenderProfileForm({ initialProfile }: { initialProfile: SenderProfile }) {
  const qc = useQueryClient();
  const [saved, setSaved] = React.useState<FormState>(() => toForm(initialProfile));
  const [form, setForm] = React.useState<FormState>(saved);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [justSaved, setJustSaved] = React.useState(false);
  const dirty = !same(form, saved);

  const save = useMutation({
    mutationFn: (body: SenderProfile) => api<SenderProfile>("/api/v1/me/settings", { method: "PUT", json: body }),
    onSuccess: (profile) => {
      const next = toForm(profile);
      setSaved(next);
      setForm(next);
      setErrors({});
      setJustSaved(true);
      qc.setQueryData(SENDER_PROFILE_KEY, profile);
      toast.success("Your details are saved. New proposals will use them.");
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      if (fe) {
        setErrors(fe);
        toast.error("Some details need fixing before they can be saved.");
      } else {
        toast.error(e instanceof ApiClientError ? e.message : "Couldn't save your details. Please try again.");
      }
    },
  });

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setJustSaved(false);
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ce = clientErrors(form);
    if (Object.keys(ce).length) {
      setErrors(ce);
      return;
    }
    save.mutate(toProfile(form));
  }

  const profile = toProfile(form);
  const composed = composeSignatureLines(profile);
  const id = (k: keyof SenderProfile) => `settings-${k}`;
  const text = (k: TextKey, label: string, props: React.ComponentProps<typeof Input> & { hint?: string } = {}) => {
    const { hint, ...rest } = props;
    return (
      <Field label={label} htmlFor={id(k)} error={errors[k]} hint={hint}>
        <Input
          id={id(k)}
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
          aria-invalid={errors[k] ? true : undefined}
          maxLength={TEXT_MAX + 50}
          {...rest}
        />
      </Field>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <form onSubmit={submit} noValidate>
          <CardHeader>
            <CardTitle>Your details for proposals</CardTitle>
            <CardDescription>Used to sign the emails and WhatsApp messages you write to businesses. Only what you fill in is used.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text("senderName", "Your name", { autoComplete: "name", placeholder: "Kofi Mensah" })}
            {text("senderCompany", "Company or studio", { autoComplete: "organization", placeholder: "Akwaaba Studio" })}
            {text("senderEmail", "Email for replies", { type: "email", inputMode: "email", autoComplete: "email", placeholder: "kofi@akwaaba.studio" })}
            {text("senderPhone", "Phone or WhatsApp", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "+228 90 12 34 56" })}
            {text("senderWebsite", "Website", { inputMode: "url", autoComplete: "url", placeholder: "akwaaba.studio", hint: "We add https:// if you leave it out." })}
            {text("senderPortfolioUrl", "Portfolio link", { inputMode: "url", placeholder: "behance.net/kofi", hint: "Behance, Dribbble or a page of your work." })}

            <Field label="Default proposal language" htmlFor={id("defaultLanguage")} hint="You can still switch language for each proposal.">
              <Select
                id={id("defaultLanguage")}
                value={form.defaultLanguage}
                onValueChange={(v) => set("defaultLanguage", v === "fr" ? "fr" : "en")}
                options={[
                  { value: "en", label: "English" },
                  { value: "fr", label: "Français" },
                ]}
                aria-label="Default proposal language"
              />
            </Field>

            <div className="grid gap-1.5 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={id("signature")}>Signature</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={composed.length === 0}
                  onClick={() => set("signature", composed.join("\n"))}
                >
                  <Wand2 aria-hidden /> Fill from my details
                </Button>
              </div>
              <Textarea
                id={id("signature")}
                rows={5}
                value={form.signature}
                onChange={(e) => set("signature", e.target.value)}
                aria-invalid={errors.signature ? true : undefined}
                aria-describedby={`${id("signature")}-count`}
                placeholder={composed.length ? composed.join("\n") : "Kofi Mensah\nAkwaaba Studio · +228 90 12 34 56"}
              />
              {errors.signature && <p className="text-xs text-destructive">{errors.signature}</p>}
              <p id={`${id("signature")}-count`} className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>Optional. Leave empty to sign with the details above.</span>
                <span className={cn("tabular", form.signature.trim().length > SIGNATURE_MAX && "text-destructive")}>
                  {form.signature.trim().length}/{SIGNATURE_MAX}
                </span>
              </p>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-3">
            <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {dirty ? "You have unsaved changes." : justSaved ? (
                <span className="inline-flex items-center gap-1 text-success-soft-foreground">
                  <Check className="size-3.5" aria-hidden /> Saved
                </span>
              ) : null}
            </span>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setForm(saved);
                  setErrors({});
                }}
              >
                Discard
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <SignaturePreview profile={profile} />
      </div>
    </div>
  );
}
