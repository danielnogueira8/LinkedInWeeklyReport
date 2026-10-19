import { describe, expect, it } from "vitest";
import { normalizeAutomation, normalizePost } from "@/lib/leadshark";
import { buildReportData } from "@/lib/report/build";
import { previousWeek, reportToReplace, weeklySeries, weekSlots } from "@/lib/report/compare";
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

  describe("joint report", () => {
    const alex = { id: "p-alex", name: "Alex Olim" };
    const sam = { id: "p-sam", name: "Sam Lee" };
    const [autoTop, autoWed, autoThu] = automations;
    const sources = [
      { profile: alex, posts: posts.slice(0, 4), automations: [autoTop, autoWed] },
      { profile: sam, posts: posts.slice(4), automations: [autoThu] },
    ];
    const joint = buildReportData({ period, timezone: "UTC", sources });

    it("combines the totals and keeps each creator's share", () => {
      expect(joint.totals).toEqual(data.totals);
      expect(
        joint.creators?.map((creator) => [creator.name, creator.totals.posts, creator.totals.impressions]),
      ).toEqual([
        ["Alex Olim", 4, 44306],
        ["Sam Lee", 3, 2784],
      ]);
    });

    it("renders a by-creator section and names who wrote each top post", () => {
      const text = renderReportText({
        clientName: "Alex Olim & Sam Lee",
        period,
        data: joint,
        highlights: defaultHighlights(joint),
      });
      expect(text).toBe(
        [
          "Performance report · Alex Olim & Sam Lee",
          "Tue 6 Oct to Tue 13 Oct 2026",
          "",
          "Impressions: 47,090",
          "Reactions: 194",
          "Comments: 416",
          "Reposts: 9",
          "DMs sent: 251 (198 first DMs + 53 follow-ups)",
          "",
          "By creator:",
          "- Alex Olim: 44,306 impressions · 389 comments · 206 DMs",
          "- Sam Lee: 2,784 impressions · 27 comments · 45 DMs",
          "",
          "Top 3 posts:",
          "",
          "1. Mon · Alex Olim · 35,814 impressions · 122 reactions · 367 comments · 136 DMs",
          TOP_URL,
          "",
          "2. Tue · Alex Olim · 3,857 impressions · 20 reactions · 1 comment",
          SECOND_URL,
          "",
          "3. Fri · Alex Olim · 3,435 impressions · 25 reactions · 1 comment",
          THIRD_URL,
          "",
          "What worked best",
          "Alex Olim's Monday post (#1) was the clear winner:",
          "- 35,814 impressions, about 5x an average post this week",
          "- 367 comments",
          "- 136 DMs sent so far, and still going.",
        ].join("\n"),
      );
    });

    it("counts a post that shows up in both creators' feeds once", () => {
      const overlapping = buildReportData({
        period,
        timezone: "UTC",
        sources: [sources[0], { ...sources[1], posts: [...sources[1].posts, posts[0]] }],
      });
      expect(overlapping.totals).toEqual(joint.totals);
    });

    it("leaves solo reports unattributed", () => {
      const solo = buildReportData({ period, timezone: "UTC", sources: [{ profile: alex, posts, automations }] });
      expect(solo.creators).toBeUndefined();
      expect(solo.posts.every((post) => post.profileName === undefined)).toBe(true);
    });

    it("renders a joint PDF", async () => {
      const pdf = await renderReportPdf({
        clientName: "Alex Olim & Sam Lee",
        period,
        data: joint,
        highlights: defaultHighlights(joint),
        generatedAt: new Date("2026-10-13T07:00:00Z"),
      });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    });
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

describe("weekly series", () => {
  const lisbon = "Europe/Lisbon";
  const totals = { posts: 0, impressions: 0, reactions: 0, comments: 0, reposts: 0, firstDms: 0, followUps: 0 };
  const row = (start: string, end: string, timezone: string, generatedAt: string, impressions: number) => ({
    periodStart: new Date(start),
    periodEnd: new Date(end),
    timezone,
    generatedAt: new Date(generatedAt),
    totals: { ...totals, impressions },
  });
  // Old Monday-to-Monday weeks: 28 Sep - 5 Oct and 5 - 12 Oct.
  const sep28 = row("2026-09-27T23:00:00Z", "2026-10-04T23:00:00Z", lisbon, "2026-10-04T20:00:03Z", 30000);
  const oct5 = row("2026-10-04T23:00:00Z", "2026-10-11T23:00:00Z", lisbon, "2026-10-11T20:00:02Z", 86500);
  // The same week built under UTC, earlier: superseded.
  const oct5utc = row("2026-10-05T00:00:00Z", "2026-10-12T00:00:00Z", "UTC", "2026-10-11T17:32:00Z", 0);
  // An old Monday week built on Saturday, then Sunday's run: the last 7 days, Sunday 21:00 to Sunday 21:00.
  const oct12 = row("2026-10-11T23:00:00Z", "2026-10-18T23:00:00Z", lisbon, "2026-10-17T18:48:00Z", 11689);
  const sunday = row("2026-10-11T20:00:02Z", "2026-10-18T20:00:02Z", lisbon, "2026-10-18T20:00:09Z", 20000);

  it("keeps one report per week ending on a Sunday, the latest built, old Monday weeks included", () => {
    const series = weeklySeries([sep28, oct5, oct5utc, oct12, sunday]);
    expect(series.map((week) => week.totals.impressions)).toEqual([30000, 86500, 20000]);
    // Compared with the week before, even though their dates don't meet exactly.
    expect(previousWeek(series, sunday)?.totals.impressions).toBe(86500);
    expect(previousWeek(series, sep28)).toBeNull();
  });

  it("charts the weeks up to the latest, with gaps where a week has no report", () => {
    const slots = weekSlots(weeklySeries([sep28, sunday]));
    expect(slots.map((slot) => slot.row?.totals.impressions ?? null)).toEqual([30000, null, 20000]);
    // The missing week stands in as the 7 days up to its Sunday run.
    expect(slots[1].start.toISOString()).toBe("2026-10-04T20:00:00.000Z");
    expect(slots[1].end.toISOString()).toBe("2026-10-11T20:00:00.000Z");
  });

  it("moves the week's report forward when it's built again, but never an old week or a refresh", () => {
    const saturdayBuild = row("2026-10-10T11:00:00Z", "2026-10-17T11:00:00Z", lisbon, "2026-10-17T11:00:05Z", 0);
    const nextWeek = row("2026-10-18T20:00:00Z", "2026-10-25T21:00:00Z", lisbon, "2026-10-25T21:00:04Z", 0);
    const saved = [nextWeek, saturdayBuild, oct12, oct5];
    const period = (r: typeof sunday) => ({ start: r.periodStart, end: r.periodEnd });
    // Sunday's run lands on Saturday's build of the same week, not the old Monday week next to it.
    expect(reportToReplace(saved, period(sunday), lisbon)).toBe(saturdayBuild);
    // Refreshing a saved report keeps it as it is.
    expect(reportToReplace(saved, period(saturdayBuild), lisbon)).toBeNull();
    expect(reportToReplace(saved, period(oct12), lisbon)).toBeNull();
    // A week with no report built the current way gets a new one.
    expect(reportToReplace([oct5], period(sunday), lisbon)).toBeNull();
  });
});

describe("feed check", () => {
  it("says when a post is counted for the other creator", () => {
    const post = normalizePost({
      post_id: "urn:li:activity:7516785192234024960",
      share_url: "https://www.linkedin.com/posts/damonmillar_x-activity-7516785192234024960-ab",
      impressions_counter: 10,
    })!;
    const period = { start: new Date("2026-10-11T23:00:00Z"), end: new Date("2026-10-18T23:00:00Z") };
    const item = {
      id: post.id,
      url: post.url,
      excerpt: "",
      postedAt: post.postedAt!.toISOString(),
      author: "damonmillar",
    };
    const feed = (name: string) => ({
      name,
      returned: 1,
      pages: 1,
      pageSize: 100,
      reachedStart: true,
      oldest: null,
      responseFields: [],
      postFields: [],
      items: [item],
    });
    const data = buildReportData({
      period,
      timezone: "Europe/Lisbon",
      sources: [
        { profile: { id: "d", name: "Damon Millar" }, posts: [post], automations: [], feed: feed("Damon Millar") },
        { profile: { id: "c", name: "Clare Thompson" }, posts: [post], automations: [], feed: feed("Clare Thompson") },
      ],
    });
    expect(data.feeds?.map((f) => f.items[0].leftOut)).toEqual([undefined, "Counted for Damon Millar"]);
  });
});
