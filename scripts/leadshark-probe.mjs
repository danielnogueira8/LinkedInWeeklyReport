// Prints what LeadShark's REST API returns for one or more creators: the posts feed
// (every item, with author, repost flags and counters), how its paging parameters behave,
// which likely profile-photo endpoints exist, and the endpoint list from the API docs.
// Read-only, apart from the enrich lookups (a profile view on the creator's own account).
//
//   node scripts/leadshark-probe.mjs <linkedin-handle>=<api-key> [...]
//   node scripts/leadshark-probe.mjs damonmillar=ls_... clare-thompson-51140ba5=ls_...
//
// Set LEADSHARK_API_URL to point it at another host (e.g. a local mock).

const BASE = process.env.LEADSHARK_API_URL || "https://apex.leadshark.io";
const creators = process.argv.slice(2).map((arg) => {
  const [handle, key] = arg.split("=");
  return { handle, key, url: `https://www.linkedin.com/in/${handle}` };
});
if (creators.length === 0 || creators.some((creator) => !creator.handle || !creator.key)) {
  console.error("Usage: node scripts/leadshark-probe.mjs <linkedin-handle>=<api-key> [...]");
  process.exit(1);
}

// LinkedIn post ids embed their publish time (ms since epoch, top 41 bits).
const when = (id) => {
  const match = String(id ?? "").match(/(\d{18,20})/);
  if (!match) return "?";
  return new Date(Number(BigInt(match[1]) >> 22n)).toLocaleString("en-GB", {
    timeZone: "Europe/Lisbon",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

async function call(path, key, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-api-key": key,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON; the text is still printed.
  }
  return { status: res.status, text, json };
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const fieldsOf = (value, prefix = "") =>
  isObject(value)
    ? Object.entries(value).flatMap(([key, child]) => [prefix + key, ...fieldsOf(child, `${prefix + key}.`)])
    : [];
const itemsOf = (json) =>
  Array.isArray(json) ? json : (["items", "posts", "data"].map((key) => json?.[key]).find(Array.isArray) ?? []);
// Everything in a response except the post list: where paging info lives.
const meta = (json) =>
  isObject(json) ? JSON.stringify(Object.fromEntries(Object.entries(json).filter(([, v]) => !Array.isArray(v)))) : "{}";

console.log(`\n=== API docs (${BASE})`);
for (const path of ["/docs/api", "/openapi.json", "/api/openapi.json", "/docs/openapi.json", "/llms.txt"]) {
  const res = await fetch(BASE + path).catch((err) => ({ ok: false, status: err.message, text: async () => "" }));
  const text = await res.text();
  console.log(`${path} -> ${res.status}, ${text.length} chars`);
  if (!res.ok) continue;
  const plain = text
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const endpoints = new Set(plain.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+\/api\/[\w/{}:.-]+/g) ?? []);
  console.log(`  endpoints: ${[...endpoints].join(" | ") || "none found in the page text"}`);
  for (const word of ["/api/v1/posts", "cursor", "enrich", "picture"]) {
    let at = -1;
    for (let n = 1; n <= 2 && (at = plain.indexOf(word, at + 1)) >= 0; n++) {
      console.log(`  [${word} #${n}] ...${plain.slice(Math.max(0, at - 250), at + 450)}...`);
    }
  }
}

for (const { handle, key } of creators) {
  console.log(`\n=== ${handle}: GET /api/v1/posts?limit=100`);
  const res = await call("/api/v1/posts?limit=100", key);
  console.log(`status ${res.status}${res.status >= 400 ? ` ${res.text.slice(0, 300)}` : ""}`);
  console.log(`other fields: ${meta(res.json).slice(0, 600)}`);
  const items = itemsOf(res.json);
  console.log(`${items.length} items. First item's fields: ${fieldsOf(items[0]).join(", ")}`);
  for (const post of items) {
    console.log(
      [
        when(post.post_id ?? post.social_id ?? post.id),
        post.is_repost ? "REPOST" : "",
        post.reposted_by ? `reposted_by=${JSON.stringify(post.reposted_by).slice(0, 80)}` : "",
        `author=${post.author?.public_identifier ?? "-"}/${post.author?.name ?? "-"}`,
        `impr=${post.impressions_counter ?? post.engagement?.impressions}`,
        `react=${post.reaction_counter ?? post.engagement?.reactions}`,
        `comm=${post.comment_counter ?? post.engagement?.comments}`,
        String(post.share_url ?? post.post_url ?? "")
          .split("?")[0]
          .slice(0, 120),
        JSON.stringify(String(post.text ?? post.full_text ?? "").slice(0, 50)),
      ]
        .filter(Boolean)
        .join("  "),
    );
  }

  // How the paging parameters behave.
  const json = isObject(res.json) ? res.json : {};
  const cursor = json.next_cursor ?? json.cursor ?? json.pagination?.next_cursor ?? json.paging?.next_cursor ?? "";
  for (const query of [
    "limit=20",
    "limit=50",
    "limit=20&page=2",
    "limit=20&offset=20",
    `limit=20&cursor=${encodeURIComponent(cursor || "x")}`,
  ]) {
    const page = await call(`/api/v1/posts?${query}`, key);
    const got = itemsOf(page.json);
    console.log(
      `${query.slice(0, 70)} -> ${page.status}, ${got.length} items, newest ${when(got[0]?.post_id ?? got[0]?.id)}, oldest ${when(got.at(-1)?.post_id ?? got.at(-1)?.id)}, other fields ${meta(page.json).slice(0, 200)}`,
    );
  }
}

console.log("\n=== Profile photo lookups");
for (const { handle, key, url } of creators) {
  const profile = encodeURIComponent(url);
  const lookups = [
    ["/api/v1/me"],
    ["/api/v1/profile"],
    ["/api/v1/account"],
    ["/api/me"],
    ["/api/profile"],
    ["/api/account"],
    [`/api/v1/enrich?profile=${profile}`],
    ["/api/v1/enrich", { profile: url }],
    [`/api/enrich?profile=${profile}`],
    ["/api/enrich", { profile: url }],
  ];
  for (const [path, body] of lookups) {
    const res = await call(path, key, body);
    console.log(
      `${handle} ${body ? "POST" : "GET"} ${path.split("?")[0]} -> ${res.status} ${res.text.slice(0, 300).replace(/\s+/g, " ")}`,
    );
  }
}
