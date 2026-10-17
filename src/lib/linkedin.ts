// LinkedIn post ids (activity, share and ugcPost URNs) are snowflake-style:
// the top 41 bits are the creation time in ms since the Unix epoch.
const POST_ID_PATTERN = /(?:activity|share|ugcPost)[:-](\d{18,20})/gi;
const BARE_ID_PATTERN = /\b(\d{19})\b/g;

const EARLIEST_PLAUSIBLE = Date.UTC(2015, 0, 1);

/** Every LinkedIn post id found in the given strings (URNs or URLs). */
export function extractPostIds(...sources: Array<string | null | undefined>): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const match of source.matchAll(POST_ID_PATTERN)) ids.add(match[1]);
    for (const match of source.matchAll(BARE_ID_PATTERN)) ids.add(match[1]);
  }
  return [...ids];
}

/** Decodes the creation time embedded in a LinkedIn post id, if it looks valid. */
export function timestampFromPostId(id: string, now = Date.now()): Date | null {
  if (!/^\d{18,20}$/.test(id)) return null;
  const ms = Number(BigInt(id) >> 22n);
  if (ms < EARLIEST_PLAUSIBLE || ms > now + 24 * 60 * 60 * 1000) return null;
  return new Date(ms);
}

export function postedAtFromIds(...sources: Array<string | null | undefined>): Date | null {
  for (const id of extractPostIds(...sources)) {
    const date = timestampFromPostId(id);
    if (date) return date;
  }
  return null;
}

/** The author's handle in a post link: linkedin.com/posts/<handle>_<text>-activity-<id>-<code>. */
export function handleFromPostUrl(url: string): string | null {
  const match = url.match(/linkedin\.com\/posts\/([^/_?#]+)_/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/** "alex-olim" from a saved profile URL, lowercased for comparing. */
export function profileHandle(profileUrl: string): string | null {
  return normalizeProfileUrl(profileUrl)?.split("/in/")[1]?.toLowerCase() || null;
}

/** Accepts linkedin.com/in/<slug> URLs, with or without protocol or www. */
export function normalizeProfileUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) return null;
  return `https://www.linkedin.com/in/${decodeURIComponent(match[1])}`;
}
