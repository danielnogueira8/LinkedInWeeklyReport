import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ReportData } from "@/lib/report/build";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** A report recipient. One creator is a solo report; two or more make a joint report. */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The report title, e.g. "Alex Olim / Plutus Media". */
  name: text("name").notNull(),
  /** One sentence describing their ideal customer, that commenters are scored against. */
  icp: text("icp"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A creator's LinkedIn profile and the LeadShark key for their account. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    linkedinUrl: text("linkedin_url").notNull(),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    apiKeyLast4: text("api_key_last4").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** LinkedIn profile photo, stored because LinkedIn's image links expire. Never select it in lists. */
    avatar: bytea("avatar"),
    avatarType: text("avatar_type"),
    /** When the stored photo last changed; part of its URL so browsers can cache it forever. */
    avatarVersion: timestamp("avatar_version", { withTimezone: true }),
    /** When we last asked LeadShark for a photo, found or not. */
    avatarCheckedAt: timestamp("avatar_checked_at", { withTimezone: true }),
  },
  (table) => [index("profiles_client_idx").on(table.clientId, table.position)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<ReportData>().notNull(),
    /** Hand-edited "What worked best" text; null means use the generated one. */
    highlightsOverride: text("highlights_override"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reports_client_period_idx").on(table.clientId, table.periodStart, table.periodEnd),
    index("reports_client_generated_idx").on(table.clientId, table.generatedAt),
  ],
);

/** A creator's post whose comments are pulled, and how far that has got. */
export const commentPosts = pgTable(
  "comment_posts",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    url: text("url").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    /** The post's first line, to name it by. */
    hook: text("hook").notNull(),
    /** LinkedIn's comment count (replies included), as of the latest post listing. */
    commentsCount: integer("comments_count").notNull(),
    /** The comment count when the comments were last read to the end; null until they have been. */
    syncedCount: integer("synced_count"),
    /** Where to carry on reading, when a read was cut short. */
    cursor: text("cursor"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.postId] }),
    index("comment_posts_posted_idx").on(table.profileId, table.postedAt),
  ],
);

/** One top-level comment on a creator's post (replies aren't included). */
export const postComments = pgTable(
  "post_comments",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    commentId: text("comment_id").notNull(),
    /** The commenter's LinkedIn handle (linkedin.com/in/<handle>). */
    personId: text("person_id").notNull(),
    name: text("name").notNull(),
    headline: text("headline").notNull(),
    profileUrl: text("profile_url").notNull(),
    /** DISTANCE_1 is a 1st-degree connection of the creator. */
    networkDistance: text("network_distance"),
    isCompany: boolean("is_company").notNull().default(false),
    text: text("text").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.commentId] }),
    index("post_comments_post_idx").on(table.profileId, table.postId),
    index("post_comments_person_idx").on(table.personId),
  ],
);

/** How well a commenter fits a client's ICP, from LeadShark's ICP check of their name and headline. */
export const icpScores = pgTable(
  "icp_scores",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull(),
    /** The ICP and headline it was scored on: when either changes, it's scored again. */
    icp: text("icp").notNull(),
    headline: text("headline").notNull(),
    /** fit, adjacent, not or unreadable. */
    fit: text("fit").notNull(),
    pct: integer("pct"),
    confidence: integer("confidence"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.personId] })],
);

export const clientsRelations = relations(clients, ({ many }) => ({
  reports: many(reports),
  profiles: many(profiles),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  client: one(clients, { fields: [profiles.clientId], references: [clients.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  client: one(clients, { fields: [reports.clientId], references: [clients.id] }),
}));

export type Client = typeof clients.$inferSelect;
/** A profile without its photo bytes, which is how every query but the avatar route loads it. */
export type Profile = Omit<typeof profiles.$inferSelect, "avatar">;
export type ClientWithProfiles = Client & { profiles: Profile[] };
export type Report = typeof reports.$inferSelect;
