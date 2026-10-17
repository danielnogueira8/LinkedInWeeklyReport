import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ReportData } from "@/lib/report/build";

/** A report recipient. One creator is a solo report; two or more make a joint report. */
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The report title, e.g. "Alex Olim / Plutus Media". */
  name: text("name").notNull(),
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
export type Profile = typeof profiles.$inferSelect;
export type ClientWithProfiles = Client & { profiles: Profile[] };
export type Report = typeof reports.$inferSelect;
