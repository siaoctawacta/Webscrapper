"use client";
import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Monitor, RefreshCw, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { useElementWidth } from "./hooks";

type Device = "desktop" | "mobile";

const FRAME = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

async function fetchHtml(id: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/concepts/${id}/html`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }
  if (res.status === 401) throw new Error("Your session has ended — please sign in again.");
  if (!res.ok) throw new Error(res.status === 404 ? "This concept no longer exists." : `Couldn’t load the preview (${res.status}).`);
  return res.text();
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Live preview of the rendered concept in a fully sandboxed iframe (no scripts, no same-origin access),
 * scaled to fit: Desktop = 1280 px wide, Mobile = 390 px wide.
 */
export function ConceptPreview({ conceptId, version, title }: { conceptId: string; version: string; title: string }) {
  // Start on the device that fits: phones get the mobile preview (this only renders client-side, after the concept loads).
  const [device, setDevice] = React.useState<Device>(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "mobile" : "desktop"));
  const [boxRef, boxWidth] = useElementWidth<HTMLDivElement>();
  const html = useQuery({
    queryKey: ["concept-html", conceptId, version],
    queryFn: () => fetchHtml(conceptId),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

  const [windowHeight] = React.useState(() => (typeof window !== "undefined" ? window.innerHeight : 900));

  const frame = FRAME[device];
  const scale = boxWidth > 0 ? Math.min(1, boxWidth / frame.width) : 1;
  // Wide layouts: fill the screen height next to the form (the preview is sticky); narrow: keep the frame's proportions.
  const fill = boxWidth >= 600 ? windowHeight - 240 : 0;
  const viewHeight = Math.round(clamp(Math.max(frame.height * scale, fill), device === "desktop" ? 360 : 480, 820));
  const left = Math.max(0, (boxWidth - frame.width * scale) / 2);

  return (
    <section aria-label="Preview" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight">Preview</h2>
          {html.isFetching && !html.isLoading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" aria-label="Updating preview" />}
        </div>
        <div role="radiogroup" aria-label="Preview width" className="inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-1">
          {(["desktop", "mobile"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3.5",
                device === d && "bg-background text-foreground shadow-xs",
              )}
            >
              {d === "desktop" ? <Monitor aria-hidden /> : <Smartphone aria-hidden />}
              {d === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
        </div>
      </div>

      <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl border border-border bg-muted" style={{ height: viewHeight }}>
        {html.isLoading && <Skeleton className="absolute inset-0 rounded-none" />}
        {html.error && !html.data && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-[13px] text-muted-foreground">{html.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => html.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {html.data !== undefined && boxWidth > 0 && (
          <iframe
            title={`Homepage concept preview — ${title}`}
            // Empty sandbox: no scripts, no forms, no top navigation, opaque origin.
            sandbox=""
            srcDoc={html.data}
            referrerPolicy="no-referrer"
            className={cn("absolute top-0 border-0 bg-background", device === "mobile" && "rounded-lg shadow-sm")}
            style={{
              left,
              width: frame.width,
              height: viewHeight / scale,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {device === "desktop" ? "1280 px wide" : "390 px wide"}
        {scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""} · try the buttons on the shared page or downloaded file.
      </p>
    </section>
  );
}
