import { sql, type SQL } from "drizzle-orm";
import { xlsx } from "@/lib/commenters/xlsx";
import { db, type ClientWithProfiles } from "@/lib/db";
import { profileHandle } from "@/lib/linkedin";
import { lastSevenDays, localDate } from "@/lib/period";

/** LeadShark's ICP check takes one sentence of up to 280 characters. */
export const ICP_MAX_LENGTH = 280;

/** Commenters on posts published in the last 7 days, or on every post. */
export type CommentersView = "week" | "all";

export function parseView(value: unknown): CommentersView {
  return value === "all" ? "all" : "week";
}

/** The earliest publish date of the view's posts (null: all of them). */
export function viewStart(view: CommentersView, now = new Date()): Date | null {
  return view === "week" ? lastSevenDays(now).start : null;
}

const list = (values: string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/**
 * The client's comments in a view, with each post's hook and creator: people only, so not
 * Company Pages and not the creators themselves (co-creators comment on each other's posts).
 */
export function scopedComments(client: Pick<ClientWithProfiles, "profiles">, since: Date | null): SQL {
  if (client.profiles.length === 0) return sql`SELECT * FROM post_comments WHERE false`;
  const creators = client.profiles.flatMap((profile) => profileHandle(profile.linkedinUrl) ?? []);
  return sql`
    SELECT c.*, p.hook AS post_hook, pr.name AS creator
    FROM post_comments c
    JOIN comment_posts p ON p.profile_id = c.profile_id AND p.post_id = c.post_id
    JOIN profiles pr ON pr.id = c.profile_id
    WHERE c.profile_id IN (${list(client.profiles.map((profile) => profile.id))})
      AND NOT c.is_company
      ${creators.length ? sql`AND c.person_id NOT IN (${list(creators)})` : sql``}
      ${since ? sql`AND p.posted_at >= ${since}` : sql``}`;
}

export type Commenter = {
  personId: string;
  name: string;
  headline: string;
  profileUrl: string;
  networkDistance: string | null;
  comments: number;
  /** How many of the view's posts they commented on. */
  posts: number;
  firstAt: Date;
  lastAt: Date;
  latestComment: string;
  /** The hooks of the posts they commented on. */
  hooks: string[];
  creators: string[];
  /** Null until scored against the client's current ICP. */
  fit: string | null;
  pct: number | null;
  confidence: number | null;
};

/** One row per person in the view, with their score when it's for the current ICP and headline. */
function people(client: ClientWithProfiles, since: Date | null): SQL {
  const icp = client.icp?.trim() || null;
  const current = sql`s.icp = ${icp} AND s.headline = people.headline`;
  return sql`
    WITH scope AS (${scopedComments(client, since)}),
    people AS (
      SELECT person_id,
        (array_agg(name ORDER BY posted_at DESC))[1] AS name,
        (array_agg(headline ORDER BY posted_at DESC))[1] AS headline,
        (array_agg(profile_url ORDER BY posted_at DESC))[1] AS profile_url,
        (array_agg(network_distance ORDER BY posted_at DESC))[1] AS network_distance,
        (array_agg(text ORDER BY posted_at DESC))[1] AS latest_comment,
        count(*)::int AS comments,
        count(DISTINCT (profile_id, post_id))::int AS posts,
        min(posted_at) AS first_at,
        max(posted_at) AS last_at,
        array_agg(DISTINCT post_hook) AS hooks,
        array_agg(DISTINCT creator) AS creators
      FROM scope
      GROUP BY person_id
    )
    SELECT people.*,
      CASE WHEN ${current} THEN s.fit END AS fit,
      CASE WHEN ${current} THEN s.pct END AS pct,
      CASE WHEN ${current} THEN s.confidence END AS confidence
    FROM people
    LEFT JOIN icp_scores s ON s.client_id = ${client.id} AND s.person_id = people.person_id`;
}

/**
 * Highest ICP match first (people not scored yet go last), then fit, adjacent, not yet scored,
 * unreadable and not a fit, then whoever commented most and most recently.
 */
const RANK = sql`
  pct DESC NULLS LAST,
  CASE fit WHEN 'fit' THEN 0 WHEN 'adjacent' THEN 1 WHEN 'unreadable' THEN 3 WHEN 'not' THEN 4 ELSE 2 END,
  comments DESC, last_at DESC, person_id`;

function toCommenter(row: Record<string, unknown>): Commenter {
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    personId: String(row.person_id),
    name: String(row.name ?? ""),
    headline: String(row.headline ?? ""),
    profileUrl: String(row.profile_url ?? ""),
    networkDistance: row.network_distance ? String(row.network_distance) : null,
    comments: Number(row.comments),
    posts: Number(row.posts),
    firstAt: new Date(row.first_at as string | Date),
    lastAt: new Date(row.last_at as string | Date),
    latestComment: String(row.latest_comment ?? ""),
    hooks: strings(row.hooks).filter(Boolean),
    creators: strings(row.creators),
    fit: row.fit ? String(row.fit) : null,
    pct: number(row.pct),
    confidence: number(row.confidence),
  };
}

/** The view's commenters, best first, and how many there are of each ICP label ("unscored" for none yet). */
export async function listCommenters(client: ClientWithProfiles, view: CommentersView, limit?: number) {
  const ranked = sql`SELECT * FROM (${people(client, viewStart(view))}) ranked`;
  const [rows, counts] = await Promise.all([
    db().execute(sql`${ranked} ORDER BY ${RANK} ${limit ? sql`LIMIT ${limit}` : sql``}`),
    db().execute(
      sql`SELECT COALESCE(fit, 'unscored') AS fit, count(*)::int AS count FROM (${ranked}) labelled GROUP BY 1`,
    ),
  ]);
  return {
    commenters: rows.rows.map(toCommenter),
    counts: Object.fromEntries(counts.rows.map((row) => [String(row.fit), Number(row.count)])) as Record<
      string,
      number
    >,
  };
}

const FIT_LABELS: Record<string, string> = {
  fit: "Fit",
  adjacent: "Adjacent",
  not: "Not a fit",
  unreadable: "Unreadable",
};

export function fitLabel(fit: string | null) {
  return fit ? (FIT_LABELS[fit] ?? fit) : "Not scored";
}

const DISTANCES: Record<string, string> = {
  DISTANCE_1: "1st",
  DISTANCE_2: "2nd",
  DISTANCE_3: "3rd",
  OUT_OF_NETWORK: "Out of network",
};

/** "1st" for DISTANCE_1: how they're connected to the creator. */
export function connectionLabel(distance: string | null) {
  return distance ? (DISTANCES[distance] ?? distance) : "";
}

type Column = {
  header: string;
  /** In Excel's character widths. */
  width: number;
  value: (person: Commenter, timezone: string) => string | number | null;
};

/** What the CSV and the Excel file list for each person, in order. */
const COLUMNS: Column[] = [
  { header: "Name", width: 26, value: (person) => person.name },
  { header: "LinkedIn", width: 44, value: (person) => person.profileUrl },
  { header: "Headline", width: 60, value: (person) => person.headline },
  { header: "ICP fit", width: 12, value: (person) => fitLabel(person.fit) },
  { header: "ICP match %", width: 12, value: (person) => person.pct },
  { header: "ICP confidence", width: 14, value: (person) => person.confidence },
  { header: "Comments", width: 11, value: (person) => person.comments },
  { header: "Posts commented on", width: 18, value: (person) => person.posts },
  { header: "Last comment", width: 13, value: (person, timezone) => localDate(person.lastAt, timezone) },
  { header: "First comment", width: 13, value: (person, timezone) => localDate(person.firstAt, timezone) },
  { header: "Latest comment", width: 50, value: (person) => person.latestComment },
  { header: "Connection", width: 12, value: (person) => connectionLabel(person.networkDistance) },
  { header: "Posts", width: 60, value: (person) => person.hooks.join(" | ") },
  { header: "Creators", width: 26, value: (person) => person.creators.join(", ") },
];

/** A spreadsheet cell: quoted when needed, and never read as a formula (comments are anyone's text). */
function csvCell(value: string | number | null) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// A byte-order mark, so Excel reads the file as UTF-8 and names keep their accents.
const BOM = String.fromCharCode(0xfeff);

/** The list as CSV, opening with BOM. */
export function commentersCsv(commenters: Commenter[], timezone: string) {
  const rows = [
    COLUMNS.map((column) => column.header),
    ...commenters.map((person) => COLUMNS.map((column) => column.value(person, timezone))),
  ];
  return `${BOM}${rows.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Row colours in the Excel file, by ICP label (Excel's own Good and Neutral fills). Others stay white. */
const FILLS: Record<string, string> = { fit: "C6EFCE", adjacent: "FFEB9C", not: "EDEDED" };

/** The list as an Excel file: rows coloured by ICP label, LinkedIn links clickable, header frozen with filters. */
export function commentersXlsx(commenters: Commenter[], timezone: string) {
  const linkColumn = COLUMNS.findIndex((column) => column.header === "LinkedIn");
  return xlsx({
    name: "Commenters",
    columns: COLUMNS.map(({ header, width }) => ({ header, width })),
    rows: commenters.map((person) => ({
      cells: COLUMNS.map((column, index) =>
        index === linkColumn && person.profileUrl ? { link: person.profileUrl } : column.value(person, timezone),
      ),
      fill: person.fit ? FILLS[person.fit] : undefined,
    })),
  });
}
