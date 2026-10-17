import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadSharkError, listAutomations, listPostsSince, normalizePost } from "@/lib/leadshark";
import { extractPostIds, normalizeProfileUrl, timestampFromPostId } from "@/lib/linkedin";

function idAt(iso: string) {
  return (BigInt(Date.parse(iso)) << 22n).toString();
}

function post(iso: string) {
  return { post_id: `urn:li:activity:${idAt(iso)}`, share_url: "", engagement: { impressions: 1 } };
}

function mockFetch(pages: unknown[], status = 200) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      calls.push(new URL(url));
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
      const body = pages[Math.min(calls.length - 1, pages.length - 1)];
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("linkedin ids", () => {
  it("decodes the timestamp embedded in post ids", () => {
    expect(timestampFromPostId("7515336755005485056")?.toISOString()).toBe("2026-10-12T09:05:10.598Z");
    expect(timestampFromPostId("12345")).toBeNull();
  });

  it("finds ids in URNs and the different LinkedIn URL shapes", () => {
    expect(
      extractPostIds(
        "urn:li:activity:7516785192234024960",
        "https://www.linkedin.com/posts/a_b-share-7515336755005485056-Jtl3",
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7514237249639743489/",
      ),
    ).toEqual(["7516785192234024960", "7515336755005485056", "7514237249639743489"]);
  });

  it("normalizes profile URLs", () => {
    expect(normalizeProfileUrl("linkedin.com/in/alex-olim/")).toBe("https://www.linkedin.com/in/alex-olim");
    expect(normalizeProfileUrl("https://uk.linkedin.com/in/alex-olim?trk=x")).toBe(
      "https://www.linkedin.com/in/alex-olim",
    );
    expect(normalizeProfileUrl("https://www.linkedin.com/company/plutus")).toBeNull();
    expect(normalizeProfileUrl("https://example.com/in/alex")).toBeNull();
  });
});

describe("normalizePost", () => {
  it("reads the REST shape (Unipile-style counters) and strips tracking from the link", () => {
    const normalized = normalizePost({
      object: "Post",
      post_id: "urn:li:activity:7516785192234024960",
      social_id: "urn:li:activity:7516785192234024960",
      share_url:
        "https://www.linkedin.com/posts/daniel-h-n_we-checked-2204-top-posts-for-the-tells-activity-7516785192234024960-zc4X?utm_source=social_share_send&utm_medium=member_desktop_web&rcm=ACoAACFJ0F0BjEsJ1hNtrAZTqY26-iqNYZ0PxUU",
      date: "1d",
      parsed_datetime: "2026-10-16T09:00:44.944Z",
      text: "We checked 2,204 top posts for the tells that make writing sound like AI.",
      impressions_counter: 554,
      reaction_counter: 17,
      comment_counter: 36,
      repost_counter: 2,
      is_repost: false,
      author: { name: "Daniel Nogueira", public_identifier: "daniel-h-n" },
    });
    expect(normalized).toMatchObject({
      impressions: 554,
      reactions: 17,
      comments: 36,
      reposts: 2,
      hasEngagement: true,
      url: "https://www.linkedin.com/posts/daniel-h-n_we-checked-2204-top-posts-for-the-tells-activity-7516785192234024960-zc4X",
    });
  });

  it("says so when no metric fields are recognisable", () => {
    const normalized = normalizePost({
      post_id: "urn:li:activity:7516785192234024960",
      share_url: "https://www.linkedin.com/posts/x-activity-7516785192234024960-ab",
      insights: { seen_by: 12 },
    });
    expect(normalized).toMatchObject({ impressions: 0, hasEngagement: false });
    expect(normalized?.fieldNames).toEqual(["post_id", "share_url", "insights", "insights.seen_by"]);
  });

  it("reads the MCP shape", () => {
    const normalized = normalizePost({
      post_id: "urn:li:activity:7516785192234024960",
      post_url: "https://www.linkedin.com/posts/daniel-h-n_we-checked-activity-7516785192234024960-zc4X",
      full_text: "We checked 2,204 top posts",
      engagement: { impressions: 554, comments: 36, reactions: 17, reposts: 2 },
      automation_id: "33719a29",
    });
    expect(normalized).toMatchObject({
      impressions: 554,
      comments: 36,
      reactions: 17,
      reposts: 2,
      automationId: "33719a29",
      postedAt: new Date("2026-10-16T09:00:44.944Z"),
    });
  });

  it("falls back to aliases and API dates", () => {
    const normalized = normalizePost({
      id: "abc",
      url: "https://example.com/post",
      num_impressions: "120",
      num_likes: 4,
      num_comments: 2,
      num_shares: 1,
      posted_at: "2026-10-14T10:00:00Z",
    });
    expect(normalized).toMatchObject({ impressions: 120, reactions: 4, comments: 2, reposts: 1 });
    expect(normalized?.postedAt?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
  });

  it("builds a URL from the URN when none is given", () => {
    expect(normalizePost({ post_id: "urn:li:activity:7516785192234024960" })?.url).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:7516785192234024960/",
    );
  });
});

describe("listPostsSince", () => {
  it("pages until it passes the start of the period", async () => {
    const newer = Array.from({ length: 20 }, (_, i) =>
      post(`2026-10-${String(16 - (i % 5)).padStart(2, "0")}T0${i % 10}:00:00Z`),
    );
    const calls = mockFetch([
      { items: newer, next_cursor: "c1" },
      { items: [post("2026-10-08T10:00:00Z"), post("2026-10-01T10:00:00Z")], next_cursor: "c2" },
    ]);

    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(calls).toHaveLength(2);
    expect(calls[1].searchParams.get("cursor")).toBe("c1");
    expect(result.complete).toBe(true);
  });

  it("flags a feed that ran out before the period started", async () => {
    const full = Array.from({ length: 20 }, (_, i) => post(`2026-10-16T${String(i).padStart(2, "0")}:00:00Z`));
    mockFetch([{ items: full }]);
    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(result.complete).toBe(false);
  });

  it("turns 401s into an auth error", async () => {
    mockFetch([{ error: "Invalid API key" }], 401);
    const error = await listPostsSince("key", new Date()).catch((err) => err);
    expect(error).toBeInstanceOf(LeadSharkError);
    expect(error.isAuthError).toBe(true);
  });
});

describe("listAutomations", () => {
  it("follows pagination.has_more", async () => {
    const automation = (id: string) => ({ id, status: "Running", post_url: "", stats: { total_dms_sent: 1 } });
    const calls = mockFetch([
      { automations: [automation("a")], pagination: { page: 1, has_more: true } },
      { automations: [automation("b")], pagination: { page: 2, has_more: false } },
    ]);
    const result = await listAutomations("key");
    expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    expect(calls.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
  });
});
