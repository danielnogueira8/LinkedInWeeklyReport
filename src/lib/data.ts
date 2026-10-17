import { desc, eq } from "drizzle-orm";
import { clients, db, reports } from "@/lib/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export async function listClientsWithLatestReport() {
  const rows = await db().query.clients.findMany({
    orderBy: [clients.name],
    with: {
      reports: {
        orderBy: [desc(reports.periodStart)],
        limit: 1,
        columns: { id: true, periodStart: true, periodEnd: true, data: true },
      },
    },
  });
  return rows.map(({ reports: [latest], ...client }) => ({ ...client, latestReport: latest ?? null }));
}

export async function getClient(id: string) {
  if (!isUuid(id)) return null;
  return (await db().query.clients.findFirst({ where: eq(clients.id, id) })) ?? null;
}

export async function listReports(clientId: string) {
  return db().query.reports.findMany({
    where: eq(reports.clientId, clientId),
    orderBy: [desc(reports.periodStart), desc(reports.generatedAt)],
  });
}

export async function getReportWithClient(id: string) {
  if (!isUuid(id)) return null;
  return (await db().query.reports.findFirst({ where: eq(reports.id, id), with: { client: true } })) ?? null;
}
