import { decrypt } from "@/lib/crypto";
import { db, reports, type Client, type Report } from "@/lib/db";
import { LeadSharkError, listAutomations, listPostsSince } from "@/lib/leadshark";
import { reportTimezone, type Period } from "@/lib/period";
import { buildReportData } from "@/lib/report/build";

/** Pulls fresh numbers from LeadShark and saves (or refreshes) the client's report for `period`. */
export async function generateReport(client: Client, period: Period): Promise<Report> {
  const apiKey = decrypt(client.apiKeyEncrypted);
  const warnings: string[] = [];

  const [postsResult, automations] = await Promise.all([
    listPostsSince(apiKey, period.start),
    listAutomations(apiKey).catch((err: unknown) => {
      if (err instanceof LeadSharkError && err.isAuthError) throw err;
      warnings.push(`Couldn't load automation stats, so DM counts are missing (${(err as Error).message}).`);
      return [];
    }),
  ]);

  if (!postsResult.complete) {
    warnings.push("LeadShark stopped returning posts before the start of this period, so older posts may be missing.");
  }

  const data = buildReportData({
    period,
    timezone: reportTimezone(),
    posts: postsResult.posts,
    automations,
    warnings,
  });

  const now = new Date();
  const [saved] = await db()
    .insert(reports)
    .values({ clientId: client.id, periodStart: period.start, periodEnd: period.end, data, generatedAt: now })
    .onConflictDoUpdate({
      target: [reports.clientId, reports.periodStart, reports.periodEnd],
      set: { data, generatedAt: now },
    })
    .returning();
  return saved;
}
