import { z } from "zod";
import type { ParsedMapsLinkDto } from "@/lib/api-types";
import { HttpError, json, readJson, withUser } from "@/server/http";
import { MAX_MAPS_LINK_LENGTH, MapsLinkError, resolveMapsLink, toParsedMapsLinkDto } from "@/server/maps-link";
import { rateLimit } from "@/server/rate-limit";

const Body = z.object({
  url: z
    .string({ error: "Paste a Google Maps link." })
    .trim()
    .min(1, "Paste a Google Maps link.")
    .max(MAX_MAPS_LINK_LENGTH, "That link is too long to be a Google Maps link."),
});

/** POST /api/v1/maps-links/parse — read a Google Maps link (following short links) → ParsedMapsLinkDto. */
export const POST = withUser(async (req, { user }) => {
  await rateLimit(`maps-parse:${user.id}`, 60, 60);
  const { url } = await readJson(req, Body);
  try {
    const resolved = await resolveMapsLink(url, { signal: req.signal });
    return json<ParsedMapsLinkDto>(toParsedMapsLinkDto(resolved));
  } catch (e) {
    if (e instanceof MapsLinkError) throw new HttpError("validation_failed", e.message);
    throw e;
  }
});
