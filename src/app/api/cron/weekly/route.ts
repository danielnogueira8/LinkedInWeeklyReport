import { asc } from "drizzle-orm";
import { cronSetupProblem } from "@/lib/cron";
import { db, profiles } from "@/lib/db";
import { formatTimestamp, isWeeklyRunHour, lastSevenDays, reportTimezone } from "@/lib/period";
import { generateReport } from "@/lib/report/generate";

// Builds every client's report for the 7 days up to now (last Sunday to this one) on Sunday
// at 21:00 report time.
// vercel.json fires it (via ./[slot]) at 20:00 and 21:00 UTC on Sundays (crons are UTC-only,
// and the zone's offset shifts with daylight saving); only the run that lands in
// the right local hour does the work. `?force=1` skips the clock check.
export const maxDuration = 300;

const CONCURRENCY = 4;

/** Why this request can't run the build, or null when it can. Logged, so Vercel's logs say why. */
function refusal(request: Request): Response | null {
  const problem = cronSetupProblem();
  if (problem) {
    console.error(`Weekly run refused. ${problem}`);
    return Response.json({ error: problem }, { status: 503 });
  }
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    console.error("Weekly run refused: the request didn't carry CRON_SECRET as its Bearer token.");
    return Response.json({ error: "Unauthorized. Send CRON_SECRET as a Bearer token." }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const refused = refusal(request);
  if (refused) return refused;

  const now = new Date();
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && !isWeeklyRunHour(now)) {
    const reason = `Not the weekly run hour: it's ${formatTimestamp(now)} in ${reportTimezone()}.`;
    console.log(`Weekly run skipped. ${reason}`);
    return Response.json({ skipped: true, reason });
  }

  const period = lastSevenDays(now);
  const queue = await db().query.clients.findMany({
    with: { profiles: { orderBy: [asc(profiles.position)], columns: { avatar: false } } },
  });
  const results: Array<{ client: string; reportId?: string; error?: string }> = [];

  async function worker() {
    for (let client = queue.shift(); client; client = queue.shift()) {
      try {
        const report = await generateReport(client, period);
        results.push({ client: client.name, reportId: report.id });
      } catch (err) {
        console.error(`Weekly report failed for ${client.name}`, err);
        results.push({ client: client.name, error: (err as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const failed = results.filter((result) => result.error);
  console.log(`Weekly run built ${results.length - failed.length} of ${results.length} reports.`);
  return Response.json(
    {
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
      generated: results.length - failed.length,
      failed,
    },
    { status: failed.length && failed.length === results.length ? 502 : 200 },
  );
}
