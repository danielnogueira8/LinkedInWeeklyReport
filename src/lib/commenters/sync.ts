import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { scopedComments, viewStart, type CommentersView } from "@/lib/commenters/list";
import { decrypt } from "@/lib/crypto";
import { commentPosts, db, icpScores, postComments, type ClientWithProfiles, type Profile } from "@/lib/db";
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
// An ICP batch can take up to 90s; don't start one this close to the deadline.
const SCORING_MARGIN_MS = 60_000;

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
};

/** Waits so calls are at least `ms` apart. */
function pacer(ms = PACE_MS) {
  let last = 0;
  return async () => {
    const wait = last + ms - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    last = Date.now();
  };
}

/** Records the creator's own posts in the view, with LinkedIn's latest comment counts. */
async function refreshPosts(profile: Profile, apiKey: string, since: Date | null) {
  const own = (post: Parameters<typeof isOwnPost>[0]) => isOwnPost(post, profile);
  const { posts } = await listPostsSince(apiKey, since ?? new Date(0), own);
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
async function readComments(
  profile: Profile,
  apiKey: string,
  since: Date | null,
  deadline: number,
  pace: () => Promise<void>,
) {
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
      await pace();
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
async function scorePeople(
  client: ClientWithProfiles,
  since: Date | null,
  deadline: number,
  pace: () => Promise<void>,
) {
  const icp = client.icp?.trim();
  if (!icp) return true;
  const apiKey = decrypt(client.profiles[0].apiKeyEncrypted);
  while (Date.now() + SCORING_MARGIN_MS < deadline) {
    const { rows } = await db().execute(sql`${unscored(client, since, icp)} LIMIT ${ICP_BATCH_SIZE}`);
    const batch = rows.map((row) => ({
      id: String(row.person_id),
      name: String(row.name ?? ""),
      headline: String(row.headline ?? ""),
    }));
    if (batch.length === 0) return true;
    await pace();
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
  };
}

/**
 * Pulls the comments on the creators' posts in the view and scores the people who wrote them,
 * until `deadline` (ms). Run it again to carry on: everything read so far is kept.
 */
export async function syncCommenters(
  client: ClientWithProfiles,
  view: CommentersView,
  deadline: number,
): Promise<SyncProgress> {
  const since = viewStart(view);
  const pace = pacer();
  let finished = true;
  for (const profile of client.profiles) {
    if (Date.now() >= deadline) {
      finished = false;
      break;
    }
    const apiKey = decrypt(profile.apiKeyEncrypted);
    await pace();
    await refreshPosts(profile, apiKey, since);
    if (!(await readComments(profile, apiKey, since, deadline, pace))) {
      finished = false;
      break;
    }
  }
  if (finished) finished = await scorePeople(client, since, deadline, pace);
  return { ...(await commentersStatus(client, view)), done: finished };
}
