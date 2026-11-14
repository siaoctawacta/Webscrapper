/**
 * Recognise links to a business's own social profiles and return one canonical URL per network.
 * Share buttons, intents, posts/videos and platform pages are ignored. Pure module.
 */
import type { Socials } from "@/lib/domain";

export type SocialPlatform = keyof Socials;
export type SocialLink = { platform: SocialPlatform; url: string };

const FACEBOOK_RESERVED = new Set([
  "sharer",
  "sharer.php",
  "share",
  "share.php",
  "dialog",
  "plugins",
  "tr",
  "login",
  "login.php",
  "logout.php",
  "help",
  "policies",
  "policy.php",
  "privacy",
  "legal",
  "terms",
  "settings",
  "watch",
  "hashtag",
  "events",
  "groups",
  "marketplace",
  "gaming",
  "home.php",
  "photo.php",
  "photo",
  "photos",
  "story.php",
  "permalink.php",
  "video.php",
  "videos",
  "l.php",
  "ads",
  "business",
  "search",
  "notes",
  "media",
  "reel",
  "reels",
  "stories",
  "messages",
  "friends",
  "pages_reaction_units",
  "ajax",
  "connect",
  "v2.0",
  "fbml",
]);

const INSTAGRAM_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "explore",
  "stories",
  "accounts",
  "direct",
  "about",
  "legal",
  "developer",
  "web",
  "share",
  "s",
  "embed.js",
  "challenge",
]);

const X_RESERVED = new Set([
  "intent",
  "share",
  "home",
  "hashtag",
  "search",
  "i",
  "login",
  "signup",
  "tos",
  "privacy",
  "explore",
  "settings",
  "messages",
  "notifications",
  "compose",
  "widgets",
  "widgets.js",
  "oauth",
  "account",
  "personalization",
]);

const YOUTUBE_RESERVED = new Set([
  "watch",
  "embed",
  "shorts",
  "playlist",
  "results",
  "feed",
  "redirect",
  "live",
  "t",
  "about",
  "howyoutubeworks",
  "premium",
  "kids",
  "music",
  "gaming",
  "account",
  "signin",
  "logout",
  "upload",
  "attribution_link",
  "share",
  "subscription_center",
  "iframe_api",
  "s",
  "v",
  "hashtag",
]);

const FACEBOOK_HOST = /^(?:(?:www|m|mobile|web|touch|mbasic|business|[a-z]{2}(?:-[a-z]{2})?)\.)?(?:facebook|fb)\.com$/;
const INSTAGRAM_HOST = /^(?:(?:www|m)\.)?instagram\.com$|^instagr\.am$/;
const LINKEDIN_HOST = /^(?:(?:www|m|[a-z]{2})\.)?linkedin\.com$/;
const X_HOST = /^(?:(?:www|m|mobile)\.)?(?:twitter|x)\.com$/;
const TIKTOK_HOST = /^(?:(?:www|m)\.)?tiktok\.com$/;
const YOUTUBE_HOST = /^(?:(?:www|m)\.)?youtube\.com$/;
const WA_ME_HOST = /^(?:www\.)?wa\.me$/;
const WHATSAPP_HOST = /^(?:www|api|web)\.whatsapp\.com$|^whatsapp\.com$/;

const segmentsOf = (u: URL) =>
  u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

/** WhatsApp click-to-chat number: 6–15 digits, "00" international prefix removed. */
function whatsappDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 6 && digits.length <= 15 ? digits : null;
}

function facebook(u: URL): string | null {
  const segs = segmentsOf(u);
  const first = segs[0]?.toLowerCase();
  if (!first) return null;
  if (first === "profile.php") {
    const id = u.searchParams.get("id");
    return id && /^\d{5,20}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  if (first === "pages" || first === "people") {
    if (segs.length < 2) return null;
    // /pages/<Name>/<id>, /pages/category/<Category>/<Name-id>, /people/<Name>/<id>
    const keep = segs[1]!.toLowerCase() === "category" ? 4 : 3;
    return `https://www.facebook.com/${segs.slice(0, keep).map(encodeURIComponent).join("/")}`;
  }
  if (first === "pg") return segs[1] && /^[\p{L}\p{N}.\-_]{2,80}$/u.test(segs[1]) ? `https://www.facebook.com/${encodeURIComponent(segs[1])}` : null;
  if (first === "p") return segs[1] ? `https://www.facebook.com/p/${encodeURIComponent(segs[1])}` : null;
  if (FACEBOOK_RESERVED.has(first)) return null;
  if (!/^[\p{L}\p{N}.\-_]{2,80}$/u.test(segs[0]!)) return null;
  return `https://www.facebook.com/${encodeURIComponent(segs[0]!)}`;
}

function instagram(u: URL): string | null {
  const segs = segmentsOf(u);
  const first = segs[0];
  if (!first || INSTAGRAM_RESERVED.has(first.toLowerCase())) return null;
  if (!/^[a-z0-9._]{1,30}$/i.test(first)) return null;
  return `https://www.instagram.com/${first}`;
}

function linkedin(u: URL): string | null {
  const segs = segmentsOf(u);
  const kind = segs[0]?.toLowerCase();
  const name = segs[1];
  if (!kind || !name || !["company", "in", "school", "showcase"].includes(kind)) return null;
  if (!/^[\p{L}\p{N}.\-_%]{1,100}$/u.test(name)) return null;
  return `https://www.linkedin.com/${kind}/${encodeURIComponent(name)}`;
}

function xTwitter(u: URL): string | null {
  let segs = segmentsOf(u);
  // Legacy "twitter.com/#!/handle"
  if (segs.length === 0 && u.hash.startsWith("#!/")) segs = u.hash.slice(3).split("/").filter(Boolean);
  if (segs.length !== 1) return null;
  const handle = segs[0]!;
  if (X_RESERVED.has(handle.toLowerCase()) || !/^[a-z0-9_]{1,15}$/i.test(handle)) return null;
  return `https://x.com/${handle}`;
}

function tiktok(u: URL): string | null {
  const segs = segmentsOf(u);
  if (segs.length !== 1) return null;
  const handle = segs[0]!;
  if (!/^@[a-z0-9._]{2,24}$/i.test(handle)) return null;
  return `https://www.tiktok.com/${handle}`;
}

function youtube(u: URL): string | null {
  const segs = segmentsOf(u);
  const first = segs[0];
  if (!first) return null;
  const lower = first.toLowerCase();
  if (first.startsWith("@")) {
    return /^@[\p{L}\p{N}._-]{2,100}$/u.test(first) ? `https://www.youtube.com/${encodeURIComponent(first).replace(/^%40/, "@")}` : null;
  }
  if (lower === "channel" || lower === "c" || lower === "user") {
    const name = segs[1];
    if (!name || !/^[\p{L}\p{N}._-]{2,100}$/u.test(name)) return null;
    return `https://www.youtube.com/${lower}/${encodeURIComponent(name)}`;
  }
  if (segs.length === 1 && !YOUTUBE_RESERVED.has(lower) && /^[a-z0-9._-]{2,100}$/i.test(first)) {
    return `https://www.youtube.com/${first}`;
  }
  return null;
}

function whatsapp(u: URL): string | null {
  if (u.protocol === "whatsapp:") {
    const digits = whatsappDigits(u.searchParams.get("phone"));
    return digits ? `https://wa.me/${digits}` : null;
  }
  const host = u.hostname.toLowerCase();
  const segs = segmentsOf(u);
  if (WA_ME_HOST.test(host)) {
    if (segs.length !== 1) return null;
    const digits = /^\+?[\d\s-]+$/.test(segs[0]!) ? whatsappDigits(segs[0]) : null;
    return digits ? `https://wa.me/${digits}` : null;
  }
  if (segs.length !== 1 || segs[0]!.toLowerCase() !== "send") return null;
  const digits = whatsappDigits(u.searchParams.get("phone"));
  return digits ? `https://wa.me/${digits}` : null;
}

/** Classify one absolute link. Returns null for anything that is not a profile/chat link. */
export function classifySocialLink(href: string, base?: string): SocialLink | null {
  let u: URL;
  try {
    u = base ? new URL(href, base) : new URL(href);
  } catch {
    return null;
  }
  if (u.protocol === "whatsapp:") {
    const url = whatsapp(u);
    return url ? { platform: "whatsapp", url } : null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const match = (platform: SocialPlatform, url: string | null): SocialLink | null => (url ? { platform, url } : null);

  if (FACEBOOK_HOST.test(host)) return match("facebook", facebook(u));
  if (INSTAGRAM_HOST.test(host)) return match("instagram", instagram(u));
  if (LINKEDIN_HOST.test(host)) return match("linkedin", linkedin(u));
  if (X_HOST.test(host)) return match("x", xTwitter(u));
  if (TIKTOK_HOST.test(host)) return match("tiktok", tiktok(u));
  if (YOUTUBE_HOST.test(host)) return match("youtube", youtube(u));
  if (WA_ME_HOST.test(host) || WHATSAPP_HOST.test(host)) return match("whatsapp", whatsapp(u));
  return null;
}

/** Fold links into `into`, keeping the first profile found per network. */
export function collectSocials(hrefs: Iterable<string>, base: string, into: Socials = {}): Socials {
  for (const href of hrefs) {
    const s = classifySocialLink(href, base);
    if (s && !into[s.platform]) into[s.platform] = s.url;
  }
  return into;
}
