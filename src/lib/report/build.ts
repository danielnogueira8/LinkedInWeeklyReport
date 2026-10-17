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
export type ReportData = {
  timezone: string;
  totals: ReportTotals;
  /** Posts published in the period, best first (by impressions). */
  posts: ReportPost[];
  /** Posts we could not date, so they were left out. */
  undatedPosts: number;
  warnings: string[];
};

export function dmsOf(post: Pick<ReportPost, "firstDms" | "followUps">) {
  return post.firstDms + post.followUps;
}

function excerptOf(text: string) {
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

export function buildReportData(input: {
  period: Period;
  timezone: string;
  posts: LeadSharkPost[];
  automations: LeadSharkAutomation[];
  warnings?: string[];
}): ReportData {
  const { period, posts, automations } = input;
  const inPeriod = posts.filter((post) => post.postedAt && post.postedAt >= period.start && post.postedAt < period.end);

  const reportPosts: ReportPost[] = inPeriod
    .map((post) => {
      const matched = automationsFor(post, automations);
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
      };
    })
    .sort((a, b) => b.impressions - a.impressions || b.comments - a.comments || b.postedAt.localeCompare(a.postedAt));

  const sum = (key: keyof Omit<ReportTotals, "posts">) => reportPosts.reduce((total, post) => total + post[key], 0);
  const undatedPosts = posts.filter((post) => !post.postedAt).length;
  const warnings = [...(input.warnings ?? [])];
  if (undatedPosts > 0) warnings.push(`${undatedPosts} post(s) had no readable publish date and were left out.`);

  return {
    timezone: input.timezone,
    totals: {
      posts: reportPosts.length,
      impressions: sum("impressions"),
      reactions: sum("reactions"),
      comments: sum("comments"),
      reposts: sum("reposts"),
      firstDms: sum("firstDms"),
      followUps: sum("followUps"),
    },
    posts: reportPosts,
    undatedPosts,
    warnings,
  };
}
