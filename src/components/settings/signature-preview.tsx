import type { SenderProfile } from "@/lib/api-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CLOSING, signatureLines } from "./signature";

/** Live preview of how a proposal email ends with the current (unsaved) details. */
export function SignaturePreview({ profile }: { profile: SenderProfile }) {
  const { lines, source } = signatureLines(profile);
  const lang = profile.defaultLanguage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signature preview</CardTitle>
        <CardDescription>How your {lang === "fr" ? "French" : "English"} proposals will end.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border bg-subtle p-4 text-[13px] leading-relaxed" aria-live="polite">
          <div aria-hidden className="mb-4 grid gap-1.5">
            <span className="h-2 w-11/12 rounded-full bg-muted" />
            <span className="h-2 w-9/12 rounded-full bg-muted" />
            <span className="h-2 w-10/12 rounded-full bg-muted" />
          </div>
          <p>{CLOSING[lang]}</p>
          {lines.length > 0 ? (
            <div className="mt-3 break-words">
              {lines.map((l, i) => (
                <p key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                  {l || " "}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-muted-foreground">Add your name and contact details to see your signature here.</p>
          )}
        </div>
        {source === "details" && (
          <p className="mt-3 text-xs text-muted-foreground">Built from your details. Write a signature to use your own wording instead.</p>
        )}
      </CardContent>
    </Card>
  );
}
