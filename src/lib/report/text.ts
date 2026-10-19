import { dmsOf, isJoint, type ReportData, type ReportPost, type ReportTotals } from "@/lib/report/build";
import { formatPeriod, weekdayLong, weekdayShort, type Period } from "@/lib/period";

const TOP_POSTS = 3;

const numberFormat = new Intl.NumberFormat("en-US");

export function formatNumber(value: number) {
  return numberFormat.format(value);
}

export function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

export function topPosts(data: ReportData) {
  return data.posts.slice(0, TOP_POSTS);
}

export function topPostsHeading(count: number) {
  return count === 1 ? "Top post:" : `Top ${count} posts:`;
}

export function dmsSummary(data: ReportData) {
  const { firstDms, followUps } = data.totals;
  const total = firstDms + followUps;
  if (firstDms > 0 && followUps > 0) {
    return `${formatNumber(total)} (${formatNumber(firstDms)} first DMs + ${plural(followUps, "follow-up")})`;
  }
  return formatNumber(total);
}

/** "Mon · 35,814 impressions · 122 reactions · 367 comments · 136 DMs" (joint reports add the creator after the day). */
export function postStatsLine(post: ReportPost, timezone: string) {
  const parts = [
    weekdayShort(new Date(post.postedAt), timezone),
    ...(post.profileName ? [post.profileName] : []),
    plural(post.impressions, "impression"),
    plural(post.reactions, "reaction"),
    plural(post.comments, "comment"),
  ];
  if (dmsOf(post) > 0) parts.push(plural(dmsOf(post), "DM"));
  return parts.join(" · ");
}

/** "35,814 impressions · 367 comments · 136 DMs", for a joint report's per-creator lines. */
export function creatorStatsLine(totals: ReportTotals) {
  const dms = totals.firstDms + totals.followUps;
  return [
    plural(totals.impressions, "impression"),
    plural(totals.comments, "comment"),
    ...(dms > 0 ? [plural(dms, "DM")] : []),
  ].join(" · ");
}

function multiplier(ratio: number) {
  const rounded = ratio >= 3 ? Math.round(ratio) : Math.round(ratio * 2) / 2;
  return `${rounded}x`;
}

/** The auto-written "What worked best" body. Agencies can overwrite it per report. */
export function defaultHighlights(data: ReportData): string {
  const [top] = data.posts;
  if (!top) return "";

  const count = data.posts.length;
  const weekday = weekdayLong(new Date(top.postedAt), data.timezone);
  const label = top.profileName ? `${top.profileName}'s ${weekday} post (#1)` : `${weekday}'s post (#1)`;
  const average = data.totals.impressions / count;
  const ratio = average > 0 ? top.impressions / average : 0;

  const lead =
    count === 1
      ? `${label} carried the week:`
      : ratio >= 2
        ? `${label} was the clear winner:`
        : `${label} led the week:`;

  const bullets = [
    count > 1 && ratio >= 1.5
      ? `${plural(top.impressions, "impression")}, about ${multiplier(ratio)} an average post this week`
      : plural(top.impressions, "impression"),
  ];
  if (top.comments > 0) bullets.push(plural(top.comments, "comment"));
  const dms = dmsOf(top);
  if (dms > 0) {
    bullets.push(
      top.automationRunning ? `${plural(dms, "DM")} sent so far, and still going.` : `${plural(dms, "DM")} sent.`,
    );
  }

  return [lead, ...bullets.map((bullet) => `- ${bullet}`)].join("\n");
}

export function highlightsFor(data: ReportData, override: string | null) {
  return override?.trim() ? override.trim() : defaultHighlights(data);
}

/** The copy-paste version of the report. */
export function renderReportText(input: {
  clientName: string;
  period: Period;
  data: ReportData;
  highlights: string;
}): string {
  const { clientName, period, data, highlights } = input;
  const lines = [`Performance report · ${clientName}`, formatPeriod(period, data.timezone), ""];

  if (data.posts.length === 0) {
    lines.push("No posts were published in this period.");
    return lines.join("\n");
  }

  lines.push(
    `Impressions: ${formatNumber(data.totals.impressions)}`,
    `Reactions: ${formatNumber(data.totals.reactions)}`,
    `Comments: ${formatNumber(data.totals.comments)}`,
    `Reposts: ${formatNumber(data.totals.reposts)}`,
    `DMs sent: ${dmsSummary(data)}`,
    "",
  );

  if (isJoint(data)) {
    lines.push("By creator:");
    for (const creator of data.creators!) lines.push(`- ${creator.name}: ${creatorStatsLine(creator.totals)}`);
    lines.push("");
  }

  const top = topPosts(data);
  lines.push(topPostsHeading(top.length), "");
  top.forEach((post, index) => {
    lines.push(`${index + 1}. ${postStatsLine(post, data.timezone)}`, post.url, "");
  });

  if (highlights.trim()) {
    lines.push("What worked best", highlights.trim());
  }
  return lines.join("\n").trimEnd();
}

export type HighlightBlock = { type: "paragraph"; text: string } | { type: "bullet"; text: string };

/** Splits the highlights body into paragraphs and "- " bullets for the PDF. */
export function parseHighlights(highlights: string): HighlightBlock[] {
  return highlights
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = line.match(/^[-•*]\s+(.*)$/);
      return bullet ? { type: "bullet", text: bullet[1] } : { type: "paragraph", text: line };
    });
}
