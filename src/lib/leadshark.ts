import { extractPostIds, postedAtFromIds, profileHandle } from "@/lib/linkedin";

// REST API reference: https://apex.leadshark.io/docs/api
// The REST post objects follow Unipile's LinkedIn post shape (share_url,
// impressions_counter, reaction_counter, ...), not the MCP's renamed
// `engagement` object, so metrics are matched by name pattern across both.
const DEFAULT_BASE_URL = "https://apex.leadshark.io";

const POSTS_PAGE_SIZE = 100;
// The page size LeadShark's MCP allows; used if it refuses POSTS_PAGE_SIZE.
const SAFE_PAGE_SIZE = 20;
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
  /** Who wrote it (null on reposts, or when LeadShark doesn't say). */
  author: PostAuthor | null;
  /** False when none of the four metrics were present on the post at all. */
  hasEngagement: boolean;
  /** The post's field names, kept only when no metrics were recognised (for the report warning). */
  fieldNames?: string[];
};

export type PostAuthor = { handle: string; name: string };

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
    /** The creator whose key was in use, on joint reports. */
    readonly creator?: string,
  ) {
    super(creator ? `${message} (${creator})` : message);
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

async function request(
  apiKey: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
  body?: Json,
) {
  const url = new URL(path, baseUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new LeadSharkError(`Could not reach LeadShark (${(err as Error).message})`, null);
  }

  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
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

// LinkedIn member ids (ACoAA...) can stand in for a profile slug; they aren't comparable to URLs.
const MEMBER_ID = /^acoa[\w-]{20,}$/i;

function postAuthor(raw: Json): PostAuthor | null {
  // A repost's author is whoever wrote the original.
  if (raw.is_repost === true || isObject(raw.reposted_by)) return null;
  const author = isObject(raw.author) ? raw.author : {};
  const handle = str(author.public_identifier ?? author.publicIdentifier)
    .trim()
    .toLowerCase();
  if (!handle || MEMBER_ID.test(handle)) return null;
  return { handle, name: str(author.name).trim() };
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
    author: postAuthor(raw),
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

function postsIn(data: unknown): LeadSharkPost[] {
  return firstArray(data, ["items", "posts", "data"])
    .map(normalizePost)
    .filter((post): post is LeadSharkPost => post !== null);
}

/** Whose posts these are: the most common author among them, when LeadShark names one. */
export function feedOwner(posts: LeadSharkPost[]): PostAuthor | null {
  const counts = new Map<string, { author: PostAuthor; posts: number }>();
  for (const { author } of posts) {
    if (author) counts.set(author.handle, { author, posts: (counts.get(author.handle)?.posts ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.posts - a.posts)[0]?.author ?? null;
}

/** The key's owner when it isn't this creator, i.e. a key copied from someone else's account. */
export function otherKeyOwner(owner: PostAuthor | null, creator: { name: string; linkedinUrl: string }) {
  if (!owner) return null;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const handle = profileHandle(creator.linkedinUrl);
  if (!handle || same(owner.handle, handle) || (owner.name && same(owner.name, creator.name))) return null;
  return owner;
}

/** Checks an API key before it's saved. Returns whose posts it reads, when LeadShark says. */
export async function verifyApiKey(apiKey: string): Promise<PostAuthor | null> {
  return feedOwner(postsIn(await request(apiKey, "/api/v1/posts", { limit: SAFE_PAGE_SIZE })));
}

export type PostsResult = {
  posts: LeadSharkPost[];
  /** False when LeadShark stopped returning posts before reaching `since`. */
  complete: boolean;
  /** The oldest publish date among the posts we did get. */
  oldest: Date | null;
  /** The last response's top-level fields, to identify LeadShark's real pagination when it stops early. */
  responseFields: string[];
};

/** The parameters for the next page, from whichever pagination style the response uses. */
function nextPage(
  data: unknown,
  current: Record<string, string | number>,
  page: number,
): Record<string, string | number> | null {
  if (!isObject(data)) return null;
  const containers = [data, data.pagination, data.paging, data.meta].filter(isObject);
  for (const container of containers) {
    const cursor = str(
      container.next_cursor ?? container.nextCursor ?? container.next_page_token ?? container.nextPageToken,
    );
    if (cursor && cursor !== current.cursor) return { cursor };
  }
  const hasMore = containers.some(
    (container) =>
      container.has_more === true ||
      container.hasMore === true ||
      (typeof container.total_pages === "number" && page < container.total_pages),
  );
  return hasMore ? { page: page + 1 } : null;
}

/** The key owner's own posts, paging back until we pass `since`. */
export async function listPostsSince(apiKey: string, since: Date): Promise<PostsResult> {
  const posts = new Map<string, LeadSharkPost>();
  let limit = POSTS_PAGE_SIZE;
  let params: Record<string, string | number> = {};
  let responseFields: string[] = [];

  const result = (complete: boolean): PostsResult => {
    const dates = [...posts.values()].flatMap((post) => (post.postedAt ? [post.postedAt.getTime()] : []));
    return {
      posts: [...posts.values()],
      complete,
      oldest: dates.length ? new Date(Math.min(...dates)) : null,
      responseFields,
    };
  };

  for (let page = 1; page <= MAX_POST_PAGES; page++) {
    let data: unknown;
    try {
      data = await request(apiKey, "/api/v1/posts", { limit, ...params });
    } catch (err) {
      // LeadShark refused the bigger page: retry at the size its MCP uses.
      if (err instanceof LeadSharkError && err.status === 400 && limit !== SAFE_PAGE_SIZE) {
        limit = SAFE_PAGE_SIZE;
        page--;
        continue;
      }
      throw err;
    }
    responseFields = isObject(data) ? Object.keys(data) : [];
    const batch = postsIn(data);

    const before = posts.size;
    for (const post of batch) posts.set(post.id, post);

    if (batch.some((post) => post.postedAt && post.postedAt < since)) return result(true);
    // The same posts again: LeadShark ignored the paging parameter.
    if (posts.size === before) return result(false);
    const next = nextPage(data, params, page);
    if (!next) {
      // No way to ask for more. A short page means the feed really ended; a full page, or
      // exactly 20 (a likely silent cap), means there may be older posts we can't reach.
      return result(batch.length < limit && batch.length !== SAFE_PAGE_SIZE);
    }
    params = next;
  }
  return result(false);
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

// Profile photos. The REST docs we could reach don't list a profile lookup, so try the
// likely ones and remember whichever returns a photo: the key owner's own account first
// (each creator's key is their own), then enrich, as the MCP's `enrich` tool
// (profile.profile_picture_url). Creators without one can have a photo link pasted in.
type PhotoLookup = { path: string; post?: boolean; profile?: boolean };
const PHOTO_LOOKUPS: PhotoLookup[] = [
  { path: "/api/v1/me" },
  { path: "/api/v1/profile" },
  { path: "/api/v1/account" },
  { path: "/api/me" },
  { path: "/api/profile" },
  { path: "/api/account" },
  { path: "/api/v1/enrich", post: true, profile: true },
  { path: "/api/v1/enrich", profile: true },
  { path: "/api/enrich", post: true, profile: true },
  { path: "/api/enrich", profile: true },
];
// Answers that just mean "not this endpoint" (or not on this plan).
const NOT_HERE = [400, 403, 404, 405, 422];
let workingLookup: PhotoLookup | null = null;

const PICTURE_KEY = /^(profile_?)?(picture|photo|image|avatar)(_?url)?$/i;

/** The first http(s) URL under a picture-ish key, searching a few levels deep. */
export function findPictureUrl(data: unknown, depth = 0): string | null {
  if (!isObject(data) || depth > 3) return null;
  for (const [key, value] of Object.entries(data)) {
    if (PICTURE_KEY.test(key) && typeof value === "string" && /^https?:\/\//.test(value)) return value;
  }
  for (const value of Object.values(data)) {
    const nested = findPictureUrl(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

async function lookUp(apiKey: string, lookup: PhotoLookup, profileUrl: string) {
  const params = lookup.profile && !lookup.post ? { profile: profileUrl } : {};
  const body = lookup.post ? { profile: profileUrl } : undefined;
  return findPictureUrl(await request(apiKey, lookup.path, params, body));
}

/** The creator's LinkedIn photo URL via LeadShark, or null when LeadShark doesn't give one. */
export async function findProfilePicture(apiKey: string, profileUrl: string): Promise<string | null> {
  if (workingLookup) return lookUp(apiKey, workingLookup, profileUrl);
  for (const lookup of PHOTO_LOOKUPS) {
    try {
      const url = await lookUp(apiKey, lookup, profileUrl);
      if (!url) continue;
      workingLookup = lookup;
      return url;
    } catch (err) {
      if (err instanceof LeadSharkError && NOT_HERE.includes(err.status ?? 0)) continue;
      throw err;
    }
  }
  console.warn("No LeadShark endpoint returned a profile photo, so photos stay as initials until one is pasted in.");
  return null;
}
