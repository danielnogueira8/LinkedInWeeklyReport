import { describe, expect, it } from "vitest";
import { normalizeAutomation, normalizePost } from "@/lib/leadshark";
import { buildReportData } from "@/lib/report/build";
import { renderReportPdf } from "@/lib/report/pdf";
import { defaultHighlights, dmsSummary, parseHighlights, renderReportText } from "@/lib/report/text";

/** A LinkedIn-style id whose embedded timestamp is `iso`. */
function idAt(iso: string) {
  return (BigInt(Date.parse(iso)) << 22n).toString();
}

function rawPost(input: {
  postedAt: string;
  url?: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  automationId?: string;
  text?: string;
}) {
  const activityId = idAt(input.postedAt);
  return {
    post_id: `urn:li:activity:${activityId}`,
    post_url: input.url ?? `https://www.linkedin.com/posts/alex-olim_post-activity-${activityId}-abcd`,
    full_text: input.text ?? "A post\n\nwith a body",
    engagement: {
      impressions: input.impressions,
      reactions: input.reactions,
      comments: input.comments,
      reposts: input.reposts,
    },
    has_automation: Boolean(input.automationId),
    automation_id: input.automationId ?? null,
  };
}

function rawAutomation(id: string, postUrl: string, firstDms: number, followUps: number, status = "Running") {
  return {
    id,
    status,
    active: status === "Running",
    post_url: postUrl,
    stats: { total_dms_sent: firstDms, total_follow_ups_sent: followUps, dms_sent: firstDms },
  };
}

const TOP_URL =
  "https://www.linkedin.com/posts/alex-olim_this-ai-app-hit-1-on-the-app-store-with-share-7515336755005485056-Jtl3";
const SECOND_URL =
  "https://www.linkedin.com/posts/alex-olim_if-i-was-launching-a-consumer-app-today-share-7513146667064430593-D458";
const THIRD_URL = "https://www.linkedin.com/feed/update/urn:li:activity:7514237249639743489/";
const THURSDAY_ID = idAt("2026-10-08T12:00:00Z");

// Mirrors the example report for Alex Olim: 7 posts, totals 47,090 / 194 / 416 / 9.
const posts = [
  rawPost({
    postedAt: "2026-10-12T09:05:00Z",
    url: TOP_URL,
    impressions: 35814,
    reactions: 122,
    comments: 367,
    reposts: 4,
    text: "This AI app hit #1 on the App Store",
  }),
  rawPost({
    postedAt: "2026-10-06T08:02:00Z",
    url: SECOND_URL,
    impressions: 3857,
    reactions: 20,
    comments: 1,
    reposts: 2,
  }),
  rawPost({
    postedAt: "2026-10-09T08:16:00Z",
    url: THIRD_URL,
    impressions: 3435,
    reactions: 25,
    comments: 1,
    reposts: 1,
  }),
  rawPost({
    postedAt: "2026-10-07T10:00:00Z",
    impressions: 1200,
    reactions: 8,
    comments: 20,
    reposts: 1,
    automationId: "auto-wed",
  }),
  {
    ...rawPost({ postedAt: "2026-10-08T12:00:00Z", impressions: 1100, reactions: 7, comments: 12, reposts: 1 }),
    post_id: `urn:li:activity:${THURSDAY_ID}`,
  },
  rawPost({ postedAt: "2026-10-10T10:00:00Z", impressions: 984, reactions: 6, comments: 10, reposts: 0 }),
  rawPost({ postedAt: "2026-10-11T10:00:00Z", impressions: 700, reactions: 6, comments: 5, reposts: 0 }),
  // Outside the period on both sides.
  rawPost({ postedAt: "2026-10-05T23:59:00Z", impressions: 9999, reactions: 99, comments: 99, reposts: 9 }),
  rawPost({ postedAt: "2026-10-13T00:00:00Z", impressions: 9999, reactions: 99, comments: 99, reposts: 9 }),
].map((raw) => normalizePost(raw)!);

const automations = [
  // Matched through the share id in the URL (the post's own id is an activity URN).
  rawAutomation("auto-top", TOP_URL, 100, 36),
  // Matched through the post's automation_id.
  rawAutomation("auto-wed", "https://www.linkedin.com/posts/some-other-url", 60, 10),
  // Matched through the activity id in the URL.
  rawAutomation("auto-thu", `https://www.linkedin.com/feed/update/urn:li:activity:${THURSDAY_ID}/`, 38, 7),
  // Belongs to a post outside the period.
  rawAutomation("auto-old", "https://www.linkedin.com/posts/x-share-7000000000000000000-zz", 500, 500),
].map((raw) => normalizeAutomation(raw)!);

const period = { start: new Date("2026-10-06T00:00:00Z"), end: new Date("2026-10-13T00:00:00Z") };

describe("weekly report", () => {
  const data = buildReportData({ period, timezone: "UTC", posts, automations });

  it("totals only the posts published in the period", () => {
    expect(data.totals).toEqual({
      posts: 7,
      impressions: 47090,
      reactions: 194,
      comments: 416,
      reposts: 9,
      firstDms: 198,
      followUps: 53,
    });
  });

  it("renders the copy-paste text in the agency format", () => {
    const text = renderReportText({
      clientName: "Alex Olim / Plutus Media",
      period,
      data,
      highlights: defaultHighlights(data),
    });

    expect(text).toBe(
      [
        "Performance report · Alex Olim / Plutus Media",
        "Tue 6 Oct to Tue 13 Oct 2026",
        "",
        "Impressions: 47,090",
        "Reactions: 194",
        "Comments: 416",
        "Reposts: 9",
        "DMs sent: 251 (198 first DMs + 53 follow-ups)",
        "",
        "Top 3 posts:",
        "",
        "1. Mon · 35,814 impressions · 122 reactions · 367 comments · 136 DMs",
        TOP_URL,
        "",
        "2. Tue · 3,857 impressions · 20 reactions · 1 comment",
        SECOND_URL,
        "",
        "3. Fri · 3,435 impressions · 25 reactions · 1 comment",
        THIRD_URL,
        "",
        "What worked best",
        "Monday's post (#1) was the clear winner:",
        "- 35,814 impressions, about 5x an average post this week",
        "- 367 comments",
        "- 136 DMs sent so far, and still going.",
      ].join("\n"),
    );
  });

  it("uses hand-edited highlights when given", () => {
    const text = renderReportText({
      clientName: "Alex",
      period,
      data,
      highlights: "The Bro teardown (#1) was the clear winner:\n- 367 comments",
    });
    expect(text.endsWith("What worked best\nThe Bro teardown (#1) was the clear winner:\n- 367 comments")).toBe(true);
  });

  it("handles a week without posts", () => {
    const empty = buildReportData({ period, timezone: "UTC", posts: [], automations: [] });
    expect(renderReportText({ clientName: "Alex", period, data: empty, highlights: "" })).toBe(
      "Performance report · Alex\nTue 6 Oct to Tue 13 Oct 2026\n\nNo posts were published in this period.",
    );
    expect(defaultHighlights(empty)).toBe("");
  });

  it("words the highlights to fit how dominant the top post was", () => {
    const even = buildReportData({ period, timezone: "UTC", posts: posts.slice(1, 3), automations: [] });
    expect(defaultHighlights(even)).toBe("Tuesday's post (#1) led the week:\n- 3,857 impressions\n- 1 comment");

    const single = buildReportData({ period, timezone: "UTC", posts: posts.slice(0, 1), automations: [] });
    expect(defaultHighlights(single)).toBe(
      "Monday's post (#1) carried the week:\n- 35,814 impressions\n- 367 comments",
    );
  });

  it("drops the DM breakdown when there were no follow-ups", () => {
    const noFollowUps = buildReportData({
      period,
      timezone: "UTC",
      posts,
      automations: [normalizeAutomation(rawAutomation("auto-top", TOP_URL, 12, 0, "Paused"))!],
    });
    expect(dmsSummary(noFollowUps)).toBe("12");
    expect(defaultHighlights(noFollowUps)).toContain("- 12 DMs sent.");
  });

  it("warns instead of silently reporting zeros when metrics can't be read", () => {
    const unreadable = [{ post_id: `urn:li:activity:${idAt("2026-10-07T10:00:00Z")}`, share_url: "", foo: 1 }].map(
      (raw) => normalizePost(raw)!,
    );
    const data = buildReportData({ period, timezone: "UTC", posts: unreadable, automations: [] });
    expect(data.warnings).toEqual([expect.stringContaining("Fields it sent: post_id, share_url, foo.")]);
    // Posts with real numbers never trigger it.
    expect(buildReportData({ period, timezone: "UTC", posts, automations }).warnings).toEqual([]);
  });

  it("splits highlights into paragraphs and bullets", () => {
    expect(parseHighlights("Lead line:\n- one\n\n• two\nclosing")).toEqual([
      { type: "paragraph", text: "Lead line:" },
      { type: "bullet", text: "one" },
      { type: "bullet", text: "two" },
      { type: "paragraph", text: "closing" },
    ]);
  });

  it("renders a PDF", async () => {
    const pdf = await renderReportPdf({
      clientName: "Alex Olim / Plutus Media",
      period,
      data,
      highlights: defaultHighlights(data),
      agencyName: "Scale Content Labs",
      generatedAt: new Date("2026-10-13T07:00:00Z"),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
