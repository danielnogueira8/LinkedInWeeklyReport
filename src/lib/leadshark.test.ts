import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPictureUrl,
  findProfilePicture,
  isOwnPost,
  LeadSharkError,
  listAutomations,
  listPostsSince,
  normalizePost,
  otherKeyOwner,
  verifyApiKey,
} from "@/lib/leadshark";
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

describe("listPostsSince paging styles", () => {
  const recent = (count: number, day = 16) =>
    Array.from({ length: count }, (_, i) => post(`2026-10-${day}T${String(i % 24).padStart(2, "0")}:00:00Z`));

  it("follows page numbers when there's no cursor", async () => {
    const calls = mockFetch([
      { items: recent(20), pagination: { page: 1, has_more: true } },
      { items: [post("2026-10-01T10:00:00Z")], pagination: { page: 2, has_more: false } },
    ]);
    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(calls[1].searchParams.get("page")).toBe("2");
    expect(result.complete).toBe(true);
  });

  it("retries at 20 when the bigger page is refused", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        calls.push(new URL(url));
        const limit = new URL(url).searchParams.get("limit");
        return limit === "100"
          ? new Response(JSON.stringify({ error: "limit must be <= 20" }), { status: 400 })
          : new Response(JSON.stringify({ items: [post("2026-10-01T10:00:00Z")] }));
      }),
    );
    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(calls.map((url) => url.searchParams.get("limit"))).toEqual(["100", "20"]);
    expect(result.complete).toBe(true);
  });

  it("doesn't take a short page for the end of the feed", async () => {
    // LeadShark pages the whole activity feed and drops non-posts, so pages come back short.
    mockFetch([{ items: recent(8) }]);
    expect((await listPostsSince("key", new Date("2026-10-05T00:00:00Z"))).complete).toBe(false);
  });

  it("keeps paging past a repost of an older post", async () => {
    const repost = { ...post("2026-09-20T10:00:00Z"), is_repost: true };
    const calls = mockFetch([
      { items: [...recent(3), repost], next_cursor: "c1" },
      { items: [post("2026-10-01T10:00:00Z")] },
    ]);
    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(calls).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  it("reports how far back it got when it can't page further", async () => {
    mockFetch([{ items: recent(20, 12), total: 80 }]);
    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(result.complete).toBe(false);
    expect(result.oldest?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(result.responseFields).toEqual(["items", "total"]);
  });

  it("stops when the paging parameter is ignored", async () => {
    mockFetch([{ items: recent(100), next_cursor: "same-page-again" }]);
    const result = await listPostsSince("key", new Date("2026-10-05T00:00:00Z"));
    expect(result.complete).toBe(false);
  });
});

describe("profile photos", () => {
  it("finds the picture in an enrich-style response", () => {
    expect(
      findPictureUrl({ profile: { name: "Daniel", profile_picture_url: "https://media.licdn.com/dms/image/x" } }),
    ).toBe("https://media.licdn.com/dms/image/x");
    expect(findPictureUrl({ profile: { name: "Daniel" } })).toBeNull();
  });

  it("tries the likely endpoints and remembers the first that returns a photo", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        const { pathname } = new URL(url);
        calls.push(`${init.method} ${pathname}`);
        // Answers, but with no photo: not the one.
        if (pathname === "/api/v1/me") return new Response(JSON.stringify({ user: { email: "a@b.co" } }));
        if (pathname !== "/api/v1/enrich" || init.method === "POST") return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ profile: { profile_picture_url: "https://media.licdn.com/p.jpg" } }));
      }),
    );
    expect(await findProfilePicture("key", "https://www.linkedin.com/in/daniel-h-n")).toBe(
      "https://media.licdn.com/p.jpg",
    );
    expect(await findProfilePicture("key", "https://www.linkedin.com/in/someone")).toBe(
      "https://media.licdn.com/p.jpg",
    );
    expect(calls).toEqual([
      "GET /api/v1/me",
      "GET /api/v1/profile",
      "GET /api/v1/account",
      "GET /api/me",
      "GET /api/profile",
      "GET /api/account",
      "POST /api/v1/enrich",
      "GET /api/v1/enrich",
      "GET /api/v1/enrich",
    ]);
  });
});

describe("key owners", () => {
  const authored = (handle: string, name: string, extra = {}) => ({
    post_id: "urn:li:activity:7516785192234024960",
    author: { public_identifier: handle, name },
    ...extra,
  });

  const clare = { name: "Clare Thompson", linkedinUrl: "https://www.linkedin.com/in/clare-thompson-51140ba5" };
  const damon = { name: "Damon Millar", linkedinUrl: "https://www.linkedin.com/in/damonmillar" };
  const linked = (handle: string, extra = {}) => ({
    post_id: "urn:li:activity:7516785192234024960",
    share_url: `https://www.linkedin.com/posts/${handle}_some-post-activity-7516785192234024960-zc4X`,
    ...extra,
  });

  it("reads who wrote a post from its author, or else its link", () => {
    expect(normalizePost(authored("Clare-Thompson-51140ba5", "Clare Thompson"))?.author).toEqual({
      handle: "clare-thompson-51140ba5",
      name: "Clare Thompson",
    });
    // The MCP shape has no author, but the link names them.
    expect(normalizePost(linked("damonmillar"))?.author).toEqual({ handle: "damonmillar", name: "" });
    // A member id isn't a handle, and with no link there's nothing to compare.
    expect(normalizePost(authored("ACoAAAWtE78B6Hegj7EIoiN07oWE6W7gI95vjyk", "Damon"))?.author).toBeNull();
    expect(normalizePost(authored("damonmillar", "Damon Millar", { is_repost: true }))?.isRepost).toBe(true);
    // An unflagged repost whose author field is the reposter: the link names who wrote it.
    const repost = normalizePost(
      linked("damonmillar", { author: { public_identifier: "clare-thompson-51140ba5", name: "Clare Thompson" } }),
    );
    expect(repost?.author).toEqual({ handle: "damonmillar", name: "" });
    expect(isOwnPost(repost!, clare)).toBe(false);
  });

  it("counts only the creator's own posts, not reposts of their co-creator's", () => {
    const feed = [linked("clare-thompson-51140ba5"), linked("damonmillar"), linked("x", { is_repost: true })]
      .map(normalizePost)
      .filter((p) => p !== null);
    expect(feed.map((p) => isOwnPost(p, clare))).toEqual([true, false, false]);
    // Some of the posts are hers, so the key is hers.
    expect(otherKeyOwner(feed, clare)).toBeNull();
  });

  it("flags a key that reads someone else's posts", async () => {
    mockFetch([
      {
        items: [
          authored("damonmillar", "Damon Millar"),
          authored("someone-else", "Someone Else", { is_repost: true }),
          authored("damonmillar", "Damon Millar"),
        ],
      },
    ]);
    const posts = await verifyApiKey("key");
    expect(otherKeyOwner(posts, clare)).toEqual({ handle: "damonmillar", name: "Damon Millar" });
    expect(otherKeyOwner(posts, damon)).toBeNull();
    // A changed URL with the right person still passes on the name.
    expect(otherKeyOwner(posts, { ...damon, linkedinUrl: "https://www.linkedin.com/in/old" })).toBeNull();
    // Nothing to compare: no complaint.
    expect(otherKeyOwner([], clare)).toBeNull();
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
