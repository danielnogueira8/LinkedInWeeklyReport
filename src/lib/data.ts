import { asc, desc, eq, sql } from "drizzle-orm";
import { clients, db, profiles, reports } from "@/lib/db";
import { reportWeek } from "@/lib/period";
import type { ReportTotals } from "@/lib/report/build";
import { previousWeek, weeklySeries } from "@/lib/report/compare";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

const withoutAvatar = { avatar: false } as const;

export async function listClientNames() {
  return db().query.clients.findMany({
    orderBy: [asc(clients.name)],
    columns: { id: true, name: true },
    with: { profiles: { orderBy: [asc(profiles.position)], columns: { id: true, name: true, avatarVersion: true } } },
  });
}

// What the weekly series needs from a report, without its posts.
const weekColumns = {
  id: reports.id,
  clientId: reports.clientId,
  periodStart: reports.periodStart,
  periodEnd: reports.periodEnd,
  generatedAt: reports.generatedAt,
  timezone: sql<string>`${reports.data}->>'timezone'`,
  totals: sql<ReportTotals>`${reports.data}->'totals'`,
};

/** Clients with their recent weekly totals, for the overview table. */
export async function listClientsOverview() {
  const [clientRows, reportRows] = await Promise.all([
    db().query.clients.findMany({
      orderBy: [asc(clients.name)],
      with: {
        profiles: {
          orderBy: [asc(profiles.position)],
          columns: { id: true, name: true, linkedinUrl: true, avatarVersion: true },
        },
      },
    }),
    db().select(weekColumns).from(reports).orderBy(asc(reports.periodStart)),
  ]);

  return clientRows.map((client) => {
    const own = reportRows.filter((row) => row.clientId === client.id);
    const weeks = weeklySeries(own);
    const latest = weeks.at(-1) ?? null;
    return { ...client, weeks, latest, previous: latest ? previousWeek(weeks, latest) : null };
  });
}

export async function getClient(id: string) {
  if (!isUuid(id)) return null;
  return (
    (await db().query.clients.findFirst({
      where: eq(clients.id, id),
      with: { profiles: { orderBy: [asc(profiles.position)], columns: withoutAvatar } },
    })) ?? null
  );
}

/** Newest week first; within a week, the most recently built first. */
export async function listReports(clientId: string) {
  const rows = await db().query.reports.findMany({
    where: eq(reports.clientId, clientId),
    orderBy: [desc(reports.generatedAt)],
  });
  // By the Sunday each week ends on, so an old Monday-to-Monday report sits with the newer one
  // for the same week, and a week built under another timezone still lines up.
  const week = (row: (typeof rows)[number]) =>
    reportWeek({ start: row.periodStart, end: row.periodEnd }, row.data.timezone);
  return rows.sort((a, b) => week(b).localeCompare(week(a)));
}

export async function getReportWithClient(id: string) {
  if (!isUuid(id)) return null;
  return (
    (await db().query.reports.findFirst({
      where: eq(reports.id, id),
      with: { client: { with: { profiles: { orderBy: [asc(profiles.position)], columns: withoutAvatar } } } },
    })) ?? null
  );
}

/** The client's report for the week before this one's (the latest built for it), if there is one. */
export async function getPreviousReport(report: {
  clientId: string;
  periodStart: Date;
  periodEnd: Date;
  data: { timezone: string };
}) {
  const rows = await db().select(weekColumns).from(reports).where(eq(reports.clientId, report.clientId));
  return previousWeek(weeklySeries(rows, Infinity), { ...report, timezone: report.data.timezone });
}
