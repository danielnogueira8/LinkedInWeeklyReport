import { asc } from "drizzle-orm";
import { db, profiles } from "@/lib/db";
import { currentWeek, isWeeklyRunHour } from "@/lib/period";
import { generateReport } from "@/lib/report/generate";

// Builds this week's report for every client on Sunday at 21:00 report time.
// vercel.json fires it (via ./[slot]) at 20:00 and 21:00 UTC on Sundays (crons are UTC-only,
// and the zone's offset shifts with daylight saving); only the run that lands in
// the right local hour does the work. `?force=1` skips the clock check.
export const maxDuration = 300;

const CONCURRENCY = 4;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized. Set CRON_SECRET and send it as a Bearer token." }, { status: 401 });
  }

  const now = new Date();
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && !isWeeklyRunHour(now)) {
    return Response.json({ skipped: true, reason: "Not the weekly run hour in the report timezone." });
  }

  const period = currentWeek(now);
  const queue = await db().query.clients.findMany({ with: { profiles: { orderBy: [asc(profiles.position)] } } });
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
  return Response.json(
    {
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
      generated: results.length - failed.length,
      failed,
    },
    { status: failed.length && failed.length === results.length ? 502 : 200 },
  );
}
