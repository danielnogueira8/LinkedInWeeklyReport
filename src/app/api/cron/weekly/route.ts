import { clients, db } from "@/lib/db";
import { lastFullWeek } from "@/lib/period";
import { generateReport } from "@/lib/report/generate";

// Scheduled in vercel.json for Monday mornings. Generates last week's report for every client.
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

  const period = lastFullWeek();
  const queue = await db().select().from(clients);
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
