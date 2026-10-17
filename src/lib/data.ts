import { and, asc, desc, eq, sql } from "drizzle-orm";
import { clients, db, profiles, reports } from "@/lib/db";
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

/** Clients with their recent calendar-week totals, for the overview table. */
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
    db()
      .select({
        id: reports.id,
        clientId: reports.clientId,
        periodStart: reports.periodStart,
        periodEnd: reports.periodEnd,
        timezone: sql<string>`${reports.data}->>'timezone'`,
        totals: sql<ReportTotals>`${reports.data}->'totals'`,
      })
      .from(reports)
      .orderBy(asc(reports.periodStart)),
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

export async function listReports(clientId: string) {
  return db().query.reports.findMany({
    where: eq(reports.clientId, clientId),
    orderBy: [desc(reports.periodStart), desc(reports.generatedAt)],
  });
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

/** The report covering the period that ends exactly where this one starts. */
export async function getPreviousReport(report: { clientId: string; periodStart: Date }) {
  return (
    (await db().query.reports.findFirst({
      where: and(eq(reports.clientId, report.clientId), eq(reports.periodEnd, report.periodStart)),
      orderBy: [desc(reports.generatedAt)],
    })) ?? null
  );
}
