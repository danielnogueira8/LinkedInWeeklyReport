import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { scopedComments, viewStart, type CommentersView } from "@/lib/commenters/list";
import { decrypt } from "@/lib/crypto";
import {
  commentPosts,
  db,
  icpScores,
  leadsharkCalls,
  postComments,
  type ClientWithProfiles,
  type Profile,
} from "@/lib/db";
import {
  ICP_BATCH_SIZE,
  isOwnPost,
  LeadSharkError,
  listComments,
  listPostsSince,
  scoreIcp,
  type PostComment,
} from "@/lib/leadshark";
import { excerptOf } from "@/lib/report/build";

// Every read goes through the creator's own LinkedIn account, so stay well under LeadShark's
// 100 requests a minute: a burst of reads is what LinkedIn notices.
const PACE_MS = 1500;
// LeadShark allows each key 250 requests an hour (and 6,000 a day). The sync spends at most
// 200 of them in any hour, leaving the rest for reports and photos, then pauses.
const HOURLY_BUDGET = 200;
const HOUR_MS = 60 * 60 * 1000;
// A paused sync waits until this many calls are free again, so each round after a pause gets
// real work done instead of re-listing posts for a call or two.
const RESUME_WITH = 100;
// How long to pause on a 429 that doesn't say (another tool may be using the same key).
const RATE_LIMITED_WAIT_MS = 15 * 60 * 1000;
// An ICP batch can take up to 90s; don't start one this close to the deadline.
const SCORING_MARGIN_MS = 60_000;

/** Stops a round when a key is out of calls for now: the sync carries on after `until`. */
class Paused extends Error {
  constructor(readonly until: Date) {
    super(`Paused until ${until.toISOString()}`);
  }
}

/** How many calls each key made in the last hour. */
async function callsInLastHour(profileIds: string[]) {
  const since = new Date(Date.now() - HOUR_MS);
  const ids = sql.join(
    profileIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const { rows } = await db().execute(sql`
    SELECT profile_id, count(*)::int AS used FROM leadshark_calls
    WHERE profile_id IN (${ids}) AND at > ${since} GROUP BY profile_id`);
  return new Map(rows.map((row) => [String(row.profile_id), Number(row.used)]));
}

/** When enough of a key's last-hour calls will be over an hour old to leave RESUME_WITH free. */
async function resumeAt(profileId: string, used: number) {
  const since = new Date(Date.now() - HOUR_MS);
  // The calls are sorted oldest first; the sync can carry on once this one ages out.
  const nth = Math.min(used, Math.max(1, used - HOURLY_BUDGET + RESUME_WITH));
  const { rows } = await db().execute(sql`
    SELECT at FROM leadshark_calls WHERE profile_id = ${profileId} AND at > ${since}
    ORDER BY at OFFSET ${nth - 1} LIMIT 1`);
  const at = rows[0]?.at;
  return new Date((at ? new Date(at as string | Date).getTime() : Date.now()) + HOUR_MS);
}

/**
 * Paces a round's LeadShark calls and keeps each key inside its hourly budget, logging every
 * call. `take` throws Paused when the key has none left; `record` logs calls already made.
 */
function caller() {
  let last = 0;
  const record = async (profileId: string, calls = 1) => {
    if (calls > 0)
      await db()
        .insert(leadsharkCalls)
        .values(Array.from({ length: calls }, () => ({ profileId })));
  };
  const take = async (profileId: string) => {
    const used = (await callsInLastHour([profileId])).get(profileId) ?? 0;
    if (used >= HOURLY_BUDGET) throw new Paused(await resumeAt(profileId, used));
    const wait = last + PACE_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    last = Date.now();
    await record(profileId);
  };
  return { take, record };
}

type Caller = ReturnType<typeof caller>;

export type SyncProgress = {
  /** Every post in the view is read to the end and everyone in it is scored (or there's no ICP). */
  done: boolean;
  posts: number;
  /** Posts whose comments are read to the end, as of their latest comment count. */
  postsRead: number;
  comments: number;
  people: number;
  /** People scored against the current ICP and their current headline. */
  scored: number;
  icp: boolean;
  syncedAt: string | null;
  /** The oldest post read for the client in any view: recent when only the last 7 days have been synced. */
  earliestPost: string | null;
  /** Out of LeadShark calls for now: run again after this (ISO time) to carry on. */
  pausedUntil: string | null;
};

/** Records the creator's own posts in the view, with LinkedIn's latest comment counts. */
async function refreshPosts(profile: Profile, apiKey: string, since: Date | null, calls: Caller) {
  const own = (post: Parameters<typeof isOwnPost>[0]) => isOwnPost(post, profile);
  await calls.take(profile.id);
  const { posts, pages } = await listPostsSince(apiKey, since ?? new Date(0), own);
  // Listing every post can take a few pages.
  await calls.record(profile.id, pages - 1);
  const rows = posts.flatMap((post) =>
    own(post) && post.postedAt && (!since || post.postedAt >= since)
      ? [
          {
            profileId: profile.id,
            postId: post.id,
            url: post.url,
            postedAt: post.postedAt,
            hook: excerptOf(post.text),
            commentsCount: post.comments,
          },
        ]
      : [],
  );
  if (rows.length === 0) return;
  await db()
    .insert(commentPosts)
    .values(rows)
    .onConflictDoUpdate({
      target: [commentPosts.profileId, commentPosts.postId],
      set: {
        url: sql`excluded.url`,
        postedAt: sql`excluded.posted_at`,
        hook: sql`excluded.hook`,
        commentsCount: sql`excluded.comments_count`,
      },
    });
}

async function saveComments(profileId: string, postId: string, comments: PostComment[]) {
  if (comments.length === 0) return;
  await db()
    .insert(postComments)
    .values(comments.map(({ id, ...comment }) => ({ profileId, postId, commentId: id, ...comment })))
    .onConflictDoUpdate({
      target: [postComments.profileId, postComments.commentId],
      set: {
        name: sql`excluded.name`,
        headline: sql`excluded.headline`,
        profileUrl: sql`excluded.profile_url`,
        networkDistance: sql`excluded.network_distance`,
        text: sql`excluded.text`,
      },
    });
}

/**
 * Reads the comments of every post that's new or has changed since it was last read, newest
 * post first, until the deadline. A changed post is read again from the start: comments
 * don't come in date order, so new ones aren't only at the end. True when it finished.
 */
async function readComments(profile: Profile, apiKey: string, since: Date | null, deadline: number, calls: Caller) {
  const queue = await db()
    .select()
    .from(commentPosts)
    .where(
      and(
        eq(commentPosts.profileId, profile.id),
        since ? gte(commentPosts.postedAt, since) : undefined,
        sql`${commentPosts.syncedCount} IS DISTINCT FROM ${commentPosts.commentsCount}`,
      ),
    )
    .orderBy(desc(commentPosts.postedAt));

  for (const post of queue) {
    const thisPost = and(eq(commentPosts.profileId, profile.id), eq(commentPosts.postId, post.postId));
    let cursor = post.cursor;
    // Nothing to read on a post nobody commented on.
    if (post.commentsCount === 0) {
      await db().update(commentPosts).set({ syncedCount: 0, cursor: null, syncedAt: new Date() }).where(thisPost);
      continue;
    }
    do {
      if (Date.now() >= deadline) return false;
      await calls.take(profile.id);
      let page: { comments: PostComment[]; next: string | null };
      try {
        page = await listComments(apiKey, post.postId, cursor);
      } catch (err) {
        // A deleted post: there's nothing left to read.
        if (!(err instanceof LeadSharkError && err.status === 404)) throw err;
        page = { comments: [], next: null };
      }
      await saveComments(profile.id, post.postId, page.comments);
      cursor = page.next;
      await db()
        .update(commentPosts)
        .set({ cursor, syncedAt: new Date(), ...(cursor ? {} : { syncedCount: post.commentsCount }) })
        .where(thisPost);
    } while (cursor);
  }
  return true;
}

/** People in the view with no score for the current ICP and their current headline. */
function unscored(client: ClientWithProfiles, since: Date | null, icp: string): SQL {
  return sql`
    WITH scope AS (${scopedComments(client, since)}),
    latest AS (
      SELECT DISTINCT ON (person_id) person_id, name, headline FROM scope ORDER BY person_id, posted_at DESC
    )
    SELECT latest.* FROM latest
    LEFT JOIN icp_scores s ON s.client_id = ${client.id} AND s.person_id = latest.person_id
    WHERE s.person_id IS NULL OR s.icp <> ${icp} OR s.headline <> latest.headline`;
}

/** Scores everyone in the view against the client's ICP, 100 at a time, until the deadline. True when done. */
async function scorePeople(client: ClientWithProfiles, since: Date | null, deadline: number, calls: Caller) {
  const icp = client.icp?.trim();
  if (!icp) return true;
  // Score with whichever creator's key has the most of its hour left.
  const spent = await callsInLastHour(client.profiles.map((profile) => profile.id));
  const used = (profile: Profile) => spent.get(profile.id) ?? 0;
  const scorer = [...client.profiles].sort((a, b) => used(a) - used(b))[0];
  const apiKey = decrypt(scorer.apiKeyEncrypted);
  while (Date.now() + SCORING_MARGIN_MS < deadline) {
    const { rows } = await db().execute(sql`${unscored(client, since, icp)} LIMIT ${ICP_BATCH_SIZE}`);
    const batch = rows.map((row) => ({
      id: String(row.person_id),
      name: String(row.name ?? ""),
      headline: String(row.headline ?? ""),
    }));
    if (batch.length === 0) return true;
    await calls.take(scorer.id);
    const scores = new Map((await scoreIcp(apiKey, batch, icp)).map((score) => [score.id.toLowerCase(), score]));
    const scoredAt = new Date();
    await db()
      .insert(icpScores)
      .values(
        // Anyone LeadShark didn't answer for is saved as unreadable, so the batch can't come back forever.
        batch.map((person) => {
          const score = scores.get(person.id);
          return {
            clientId: client.id,
            personId: person.id,
            icp,
            headline: person.headline,
            fit: score?.fit ?? "unreadable",
            pct: score?.pct ?? null,
            confidence: score?.confidence ?? null,
            scoredAt,
          };
        }),
      )
      .onConflictDoUpdate({
        target: [icpScores.clientId, icpScores.personId],
        set: {
          icp: sql`excluded.icp`,
          headline: sql`excluded.headline`,
          fit: sql`excluded.fit`,
          pct: sql`excluded.pct`,
          confidence: sql`excluded.confidence`,
          scoredAt: sql`excluded.scored_at`,
        },
      });
  }
  return false;
}

/** Where a view's pulling and scoring stand. `done` is only known after a sync, so it's false here. */
export async function commentersStatus(client: ClientWithProfiles, view: CommentersView): Promise<SyncProgress> {
  const since = viewStart(view);
  const icp = client.icp?.trim() || null;
  const ids = sql.join(
    client.profiles.map((profile) => sql`${profile.id}`),
    sql`, `,
  );
  const own = client.profiles.length ? sql`profile_id IN (${ids})` : sql`false`;
  const { rows } = await db().execute(sql`
    WITH scope AS (${scopedComments(client, since)}),
    latest AS (SELECT DISTINCT ON (person_id) person_id, headline FROM scope ORDER BY person_id, posted_at DESC),
    posts AS (
      SELECT * FROM comment_posts WHERE ${own} ${since ? sql`AND posted_at >= ${since}` : sql``}
    )
    SELECT
      (SELECT min(posted_at) FROM comment_posts WHERE ${own}) AS earliest_post,
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM posts WHERE synced_count IS NOT DISTINCT FROM comments_count) AS posts_read,
      (SELECT max(synced_at) FROM posts) AS synced_at,
      (SELECT count(*)::int FROM scope) AS comments,
      (SELECT count(*)::int FROM latest) AS people,
      (SELECT count(*)::int FROM latest JOIN icp_scores s ON s.client_id = ${client.id}
        AND s.person_id = latest.person_id AND s.icp = ${icp} AND s.headline = latest.headline) AS scored`);
  const row = rows[0] ?? {};
  return {
    done: false,
    posts: Number(row.posts ?? 0),
    postsRead: Number(row.posts_read ?? 0),
    comments: Number(row.comments ?? 0),
    people: Number(row.people ?? 0),
    scored: Number(row.scored ?? 0),
    icp: icp !== null,
    syncedAt: row.synced_at ? new Date(row.synced_at as string | Date).toISOString() : null,
    earliestPost: row.earliest_post ? new Date(row.earliest_post as string | Date).toISOString() : null,
    pausedUntil: null,
  };
}

/**
 * Pulls the comments on the creators' posts in the view and scores the people who wrote them,
 * until `deadline` (ms) or a key runs out of calls for the hour. Run it again to carry on
 * (after `pausedUntil`, when set): everything read so far is kept.
 */
export async function syncCommenters(
  client: ClientWithProfiles,
  view: CommentersView,
  deadline: number,
): Promise<SyncProgress> {
  const since = viewStart(view);
  const calls = caller();
  await db().execute(sql`DELETE FROM leadshark_calls WHERE at < now() - interval '1 day'`);

  let finished = false;
  let pausedUntil: Date | null = null;
  try {
    finished = true;
    for (const profile of client.profiles) {
      const apiKey = decrypt(profile.apiKeyEncrypted);
      if (Date.now() >= deadline) finished = false;
      else await refreshPosts(profile, apiKey, since, calls);
      if (!finished || !(await readComments(profile, apiKey, since, deadline, calls))) {
        finished = false;
        break;
      }
    }
    if (finished) finished = await scorePeople(client, since, deadline, calls);
  } catch (err) {
    finished = false;
    if (err instanceof Paused) pausedUntil = err.until;
    else if (err instanceof LeadSharkError && err.isRateLimited) {
      const wait = err.retryAfterSeconds !== undefined ? err.retryAfterSeconds * 1000 : RATE_LIMITED_WAIT_MS;
      pausedUntil = new Date(Date.now() + wait);
    } else throw err;
  }
  return {
    ...(await commentersStatus(client, view)),
    done: finished,
    pausedUntil: pausedUntil?.toISOString() ?? null,
  };
}
