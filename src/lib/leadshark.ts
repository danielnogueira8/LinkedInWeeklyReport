import { extractPostIds, postedAtFromIds } from "@/lib/linkedin";

// REST API reference: https://apex.leadshark.io/docs/api
// The REST post objects follow Unipile's LinkedIn post shape (share_url,
// impressions_counter, reaction_counter, ...), not the MCP's renamed
// `engagement` object, so metrics are matched by name pattern across both.
const DEFAULT_BASE_URL = "https://apex.leadshark.io";

const POSTS_PAGE_SIZE = 20;
const MAX_POST_PAGES = 10;
const AUTOMATIONS_PAGE_SIZE = 50;
const MAX_AUTOMATION_PAGES = 20;

export type LeadSharkPost = {
  id: string;
  url: string;
  text: string;
  postedAt: Date | null;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  automationId: string | null;
  /** False when none of the four metrics were present on the post at all. */
  hasEngagement: boolean;
  /** The post's field names, kept only when no metrics were recognised (for the report warning). */
  fieldNames?: string[];
};

export type LeadSharkAutomation = {
  id: string;
  postUrl: string;
  postIds: string[];
  running: boolean;
  firstDms: number;
  followUps: number;
};

export class LeadSharkError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "LeadSharkError";
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}

type Json = Record<string, unknown>;

function baseUrl() {
  return process.env.LEADSHARK_API_URL || DEFAULT_BASE_URL;
}

async function request(apiKey: string, path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, baseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new LeadSharkError(`Could not reach LeadShark (${(err as Error).message})`, null);
  }

  const body = await res.text();
  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    // Non-JSON error pages fall through to the status check below.
  }

  if (!res.ok) {
    const detail = isObject(data) ? (data.error ?? data.message) : null;
    const message =
      res.status === 401 || res.status === 403
        ? "LeadShark rejected the API key"
        : `LeadShark returned ${res.status}${typeof detail === "string" ? `: ${detail}` : ""}`;
    throw new LeadSharkError(message, res.status);
  }
  return data;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** A count that may arrive as a number, numeric string, or { total } / { count }. */
function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (isObject(value)) return numeric(value.total) ?? numeric(value.count);
  return null;
}

function count(...candidates: unknown[]): number {
  for (const value of candidates) {
    const n = numeric(value);
    if (n !== null) return n;
  }
  return 0;
}

// Where post metrics may be nested, checked before the post's top level.
const METRIC_CONTAINERS = ["engagement", "stats", "metrics", "counts", "social_counts", "analytics"];

// impressions_counter (Unipile), impressions (MCP), num_impressions, view_count, ...
const METRIC_PATTERNS = {
  impressions: /^(num_|total_)?(impression|view)s?(_count|_counter|_total)?$/i,
  reactions: /^(num_|total_)?(reaction|like)s?(_count|_counter|_total)?$/i,
  comments: /^(num_|total_)?comments?(_count|_counter|_total)?$/i,
  reposts: /^(num_|total_)?(repost|reshare|share)s?(_count|_counter|_total)?$/i,
};

function findMetric(raw: Json, pattern: RegExp): number | null {
  const sources = [...METRIC_CONTAINERS.map((key) => raw[key]).filter(isObject), raw];
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!pattern.test(key)) continue;
      const n = numeric(value);
      if (n !== null) return n;
    }
  }
  return null;
}

function fieldNames(raw: Json): string[] {
  return Object.entries(raw).flatMap(([key, value]) =>
    isObject(value) ? [key, ...Object.keys(value).map((child) => `${key}.${child}`)] : [key],
  );
}

/** LinkedIn share links carry tracking (utm_*, rcm with a member id); the bare URL works the same. */
export function cleanPostUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return url;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function firstArray(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isObject(data)) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
    if (isObject(value)) {
      const nested = firstArray(value, keys);
      if (nested.length) return nested;
    }
  }
  return [];
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number") {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function normalizePost(raw: unknown): LeadSharkPost | null {
  if (!isObject(raw)) return null;
  const id = str(raw.post_id ?? raw.social_id ?? raw.urn ?? raw.id);
  const url = cleanPostUrl(str(raw.share_url ?? raw.post_url ?? raw.url));
  if (!id && !url) return null;

  // The id-embedded timestamp is LinkedIn's own; API date fields are a fallback.
  const postedAt =
    postedAtFromIds(id, url) ??
    parseDate(raw.posted_at ?? raw.parsed_datetime ?? raw.published_at ?? raw.postedAt ?? raw.created_at);

  const metrics = {
    impressions: findMetric(raw, METRIC_PATTERNS.impressions),
    reactions: findMetric(raw, METRIC_PATTERNS.reactions),
    comments: findMetric(raw, METRIC_PATTERNS.comments),
    reposts: findMetric(raw, METRIC_PATTERNS.reposts),
  };
  const hasEngagement = Object.values(metrics).some((value) => value !== null);

  return {
    id: id || url,
    url: url || (id.startsWith("urn:li:") ? `https://www.linkedin.com/feed/update/${id}/` : ""),
    text: str(raw.full_text ?? raw.text ?? raw.text_preview ?? raw.commentary),
    postedAt,
    impressions: metrics.impressions ?? 0,
    reactions: metrics.reactions ?? 0,
    comments: metrics.comments ?? 0,
    reposts: metrics.reposts ?? 0,
    automationId: str(raw.automation_id) || null,
    hasEngagement,
    ...(hasEngagement ? {} : { fieldNames: fieldNames(raw) }),
  };
}

export function normalizeAutomation(raw: unknown): LeadSharkAutomation | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const stats = isObject(raw.stats) ? raw.stats : {};
  const postUrl = str(raw.post_url);
  const status = str(raw.status).toLowerCase();
  return {
    id,
    postUrl,
    postIds: extractPostIds(postUrl, str(raw.post_id), str(raw.post_urn)),
    running: raw.active === true || status === "running",
    firstDms: count(stats.total_dms_sent, stats.dms_sent),
    followUps: count(stats.total_follow_ups_sent, stats.follow_ups_sent),
  };
}

/** Cheap call used to check an API key before saving a client. */
export async function verifyApiKey(apiKey: string): Promise<void> {
  await request(apiKey, "/api/v1/posts", { limit: 1 });
}

/**
 * The key owner's own posts, paging back until we pass `since`.
 * `complete` is false when LeadShark stopped returning posts before reaching `since`.
 */
export async function listPostsSince(
  apiKey: string,
  since: Date,
): Promise<{ posts: LeadSharkPost[]; complete: boolean }> {
  const posts = new Map<string, LeadSharkPost>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_POST_PAGES; page++) {
    const data = await request(apiKey, "/api/v1/posts", { limit: POSTS_PAGE_SIZE, cursor });
    const batch = firstArray(data, ["items", "posts", "data"])
      .map(normalizePost)
      .filter((post): post is LeadSharkPost => post !== null);

    const before = posts.size;
    for (const post of batch) posts.set(post.id, post);

    if (batch.some((post) => post.postedAt && post.postedAt < since) || batch.length < POSTS_PAGE_SIZE) {
      return { posts: [...posts.values()], complete: true };
    }
    const next = isObject(data) ? str(data.next_cursor ?? data.nextCursor) : "";
    if (!next || next === cursor || posts.size === before) break;
    cursor = next;
  }
  return { posts: [...posts.values()], complete: false };
}

export async function listAutomations(apiKey: string): Promise<LeadSharkAutomation[]> {
  const automations: LeadSharkAutomation[] = [];

  for (let page = 1; page <= MAX_AUTOMATION_PAGES; page++) {
    const data = await request(apiKey, "/api/automations", { page, limit: AUTOMATIONS_PAGE_SIZE });
    const batch = firstArray(data, ["automations", "items", "data"])
      .map(normalizeAutomation)
      .filter((automation): automation is LeadSharkAutomation => automation !== null);
    automations.push(...batch);

    const pagination = isObject(data) && isObject(data.pagination) ? data.pagination : null;
    const hasMore =
      pagination?.has_more === true || (typeof pagination?.total_pages === "number" && page < pagination.total_pages);
    if (!hasMore || batch.length === 0) break;
  }
  return automations;
}
