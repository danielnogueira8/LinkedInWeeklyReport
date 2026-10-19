import type { LeadSharkAutomation, LeadSharkPost } from "@/lib/leadshark";
import { extractPostIds } from "@/lib/linkedin";
import type { Period } from "@/lib/period";

export type ReportPost = {
  id: string;
  url: string;
  postedAt: string;
  excerpt: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  firstDms: number;
  followUps: number;
  automationRunning: boolean;
  /** Which creator posted it. Set on joint reports. */
  profileId?: string;
  profileName?: string;
};

export type ReportTotals = {
  posts: number;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  firstDms: number;
  followUps: number;
};

/** Everything a report renders from, stored as a snapshot so it can be re-rendered later. */
/** One post LeadShark sent for a creator, dated in the period, and whether the report counts it. */
export type FeedItem = {
  id: string;
  url: string;
  excerpt: string;
  postedAt: string;
  /** Who the post's link or author field names. */
  author: string | null;
  /** Why it isn't counted for this creator; absent when it is. */
  leftOut?: string;
};

/** What LeadShark returned for one creator, kept so a report's numbers can be checked against LinkedIn. */
export type FeedCheck = {
  profileId?: string;
  name: string;
  /** Everything LeadShark sent, across all pages, before filtering. */
  returned: number;
  pages: number;
  pageSize: number;
  /** Whether the feed reached back past the start of the period. */
  reachedStart: boolean;
  /** The oldest of the creator's own posts that came back. */
  oldest: string | null;
  responseFields: string[];
  postFields: string[];
  items: FeedItem[];
};

export type ReportData = {
  timezone: string;
  totals: ReportTotals;
  /** Posts published in the period, best first (see byRank; reports built before then are by impressions). */
  posts: ReportPost[];
  /** Posts we could not date, so they were left out. */
  undatedPosts: number;
  warnings: string[];
  /** Per-creator totals. Present only on joint reports (two or more creators). */
  creators?: Array<{ id: string; name: string; totals: ReportTotals }>;
  /** What LeadShark returned for each creator (reports built before this was added have none). */
  feeds?: FeedCheck[];
};

/** One creator's raw LeadShark data. A solo report has one source, a joint report several. */
export type ReportSource = {
  profile?: { id: string; name: string };
  posts: LeadSharkPost[];
  automations: LeadSharkAutomation[];
  feed?: FeedCheck;
};

export function isJoint(data: Pick<ReportData, "creators">) {
  return (data.creators?.length ?? 0) > 1;
}

export function dmsOf(post: Pick<ReportPost, "firstDms" | "followUps">) {
  return post.firstDms + post.followUps;
}

type Ranked = Pick<ReportPost, "comments" | "impressions" | "postedAt">;

/** Best first: most comments, then most impressions, then the newest. */
export function byRank(a: Ranked, b: Ranked) {
  return b.comments - a.comments || b.impressions - a.impressions || b.postedAt.localeCompare(a.postedAt);
}

export function excerptOf(text: string) {
  const lines = text.split("\n").map((line) => line.trim());
  const firstLine = lines.find(Boolean) ?? "";
  return firstLine.length > 140 ? `${firstLine.slice(0, 139).trimEnd()}…` : firstLine;
}

function automationsFor(post: LeadSharkPost, automations: LeadSharkAutomation[]) {
  const postIds = new Set(extractPostIds(post.id, post.url));
  return automations.filter(
    (automation) =>
      automation.id === post.automationId ||
      automation.postIds.some((id) => postIds.has(id)) ||
      (automation.postUrl !== "" && automation.postUrl === post.url),
  );
}

function totalsOf(posts: ReportPost[]): ReportTotals {
  const sum = (key: keyof Omit<ReportTotals, "posts">) => posts.reduce((total, post) => total + post[key], 0);
  return {
    posts: posts.length,
    impressions: sum("impressions"),
    reactions: sum("reactions"),
    comments: sum("comments"),
    reposts: sum("reposts"),
    firstDms: sum("firstDms"),
    followUps: sum("followUps"),
  };
}

export function buildReportData(
  input: { period: Period; timezone: string; warnings?: string[] } & (
    | { sources: ReportSource[] }
    | { posts: LeadSharkPost[]; automations: LeadSharkAutomation[] }
  ),
): ReportData {
  const { period } = input;
  const sources = "sources" in input ? input.sources : [{ posts: input.posts, automations: input.automations }];
  const posts = sources.flatMap((source) => source.posts);

  // A post can show up in two creators' feeds (e.g. a repost); count it once, for the first.
  const countedFor = new Map<string, ReportSource>();
  const inPeriod = sources.flatMap((source) =>
    source.posts
      .filter((post) => post.postedAt && post.postedAt >= period.start && post.postedAt < period.end)
      .filter((post) => !countedFor.has(post.id) && countedFor.set(post.id, source))
      .map((post) => ({ post, source })),
  );
  const feeds = sources.flatMap((source) => {
    if (!source.feed) return [];
    const items = source.feed.items.map((item) => {
      const other = countedFor.get(item.id);
      return item.leftOut || !other || other === source
        ? item
        : { ...item, leftOut: `Counted for ${other.profile?.name ?? "another creator"}` };
    });
    return [{ ...source.feed, items }];
  });

  const reportPosts: ReportPost[] = inPeriod
    .map(({ post, source }) => {
      const matched = automationsFor(post, source.automations);
      return {
        id: post.id,
        url: post.url,
        postedAt: post.postedAt!.toISOString(),
        excerpt: excerptOf(post.text),
        impressions: post.impressions,
        reactions: post.reactions,
        comments: post.comments,
        reposts: post.reposts,
        firstDms: matched.reduce((sum, a) => sum + a.firstDms, 0),
        followUps: matched.reduce((sum, a) => sum + a.followUps, 0),
        automationRunning: matched.some((a) => a.running),
        ...(sources.length > 1 && source.profile
          ? { profileId: source.profile.id, profileName: source.profile.name }
          : {}),
      };
    })
    .sort(byRank);

  const undatedPosts = posts.filter((post) => !post.postedAt).length;
  const warnings = [...(input.warnings ?? [])];
  if (undatedPosts > 0) warnings.push(`${undatedPosts} post(s) had no readable publish date and were left out.`);
  const unreadable = inPeriod.find(({ post }) => !post.hasEngagement)?.post;
  if (unreadable && inPeriod.every(({ post }) => !post.hasEngagement)) {
    warnings.push(
      `LeadShark sent these posts without engagement numbers this app recognises, so impressions, reactions, comments and reposts show as 0. Fields it sent: ${unreadable.fieldNames?.join(", ") || "none"}.`,
    );
  }

  const creators =
    sources.length > 1
      ? sources.flatMap(({ profile }) =>
          profile
            ? [{ ...profile, totals: totalsOf(reportPosts.filter((post) => post.profileId === profile.id)) }]
            : [],
        )
      : undefined;

  return {
    timezone: input.timezone,
    totals: totalsOf(reportPosts),
    posts: reportPosts,
    undatedPosts,
    warnings,
    ...(creators ? { creators } : {}),
    ...(feeds.length ? { feeds } : {}),
  };
}
