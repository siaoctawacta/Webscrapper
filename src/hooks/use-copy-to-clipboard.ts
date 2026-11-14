"use client";
import * as React from "react";
import { toast } from "sonner";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path (e.g. non-secure context)
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copy text with a short "copied" state (for swapping the icon) and a toast on failure. */
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = React.useCallback(
    async (text: string, label = "Copied to clipboard") => {
      const ok = await writeClipboard(text);
      if (!ok) {
        toast.error("Couldn't copy — select the text and copy it manually.");
        return false;
      }
      setCopied(true);
      toast.success(label, { duration: 1500 });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
      return true;
    },
    [resetMs],
  );
  return { copied, copy };
}
