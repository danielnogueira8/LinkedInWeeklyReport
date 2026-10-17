import { refreshStaleAvatars } from "@/lib/avatars";
import { decrypt } from "@/lib/crypto";
import { db, reports, type ClientWithProfiles, type Profile, type Report } from "@/lib/db";
import { LeadSharkError, listAutomations, listPostsSince } from "@/lib/leadshark";
import { dayMonth, reportTimezone, weekdayShort, type Period } from "@/lib/period";
import { buildReportData, type ReportSource } from "@/lib/report/build";

async function fetchSource(
  profile: Profile,
  period: Period,
  joint: boolean,
  warnings: string[],
): Promise<ReportSource> {
  const apiKey = decrypt(profile.apiKeyEncrypted);
  const whose = joint ? ` for ${profile.name}` : "";

  try {
    const [postsResult, automations] = await Promise.all([
      listPostsSince(apiKey, period.start),
      listAutomations(apiKey).catch((err: unknown) => {
        if (err instanceof LeadSharkError && err.isAuthError) throw err;
        warnings.push(`Couldn't load automation stats${whose}, so DM counts are missing (${(err as Error).message}).`);
        return [];
      }),
    ]);
    if (!postsResult.complete) {
      const tz = reportTimezone();
      const back = postsResult.oldest
        ? `, back to ${weekdayShort(postsResult.oldest, tz)} ${dayMonth(postsResult.oldest, tz)}`
        : "";
      const owner = joint ? `${profile.name}'s` : "the";
      warnings.push(
        `LeadShark only returned ${owner} ${postsResult.posts.length} most recent posts${back}, so anything earlier in this period may be missing. (LeadShark sent: ${postsResult.responseFields.join(", ") || "no fields"}.)`,
      );
    }
    return { profile: { id: profile.id, name: profile.name }, posts: postsResult.posts, automations };
  } catch (err) {
    // Say whose key failed when there's more than one.
    if (err instanceof LeadSharkError && joint) throw new LeadSharkError(err.message, err.status, profile.name);
    throw err;
  }
}

/** Pulls fresh numbers from LeadShark for every creator and saves (or refreshes) the report for `period`. */
export async function generateReport(client: ClientWithProfiles, period: Period): Promise<Report> {
  const warnings: string[] = [];
  const joint = client.profiles.length > 1;
  const [sources] = await Promise.all([
    Promise.all(
      [...client.profiles]
        .sort((a, b) => a.position - b.position)
        .map((profile) => fetchSource(profile, period, joint, warnings)),
    ),
    // Photos ride along with the weekly fetch; failures never affect the report.
    refreshStaleAvatars(client.profiles),
  ]);

  const data = buildReportData({ period, timezone: reportTimezone(), sources, warnings });

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
