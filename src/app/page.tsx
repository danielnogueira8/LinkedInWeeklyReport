import Link from "next/link";
import { connection } from "next/server";
import { ClientForm } from "@/components/client-form";
import { card } from "@/components/ui";
import { listClientsWithLatestReport } from "@/lib/data";
import { formatPeriod } from "@/lib/period";
import { formatNumber } from "@/lib/report/text";

export default async function ClientsPage() {
  await connection();
  const clients = await listClientsWithLatestReport();

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Last week&apos;s report is built for every client each Monday morning.
          </p>
        </div>

        {clients.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-600">
            No clients yet. Add one with their LeadShark API key to build their first report.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {clients.map((client) => {
              const latest = client.latestReport;
              return (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{client.name}</p>
                      <p className="truncate text-sm text-zinc-500">
                        {client.linkedinUrl.replace(/^https:\/\/www\./, "")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {latest ? (
                        <>
                          <p className="text-zinc-900">{formatNumber(latest.data.totals.impressions)} impressions</p>
                          <p className="text-zinc-500">
                            {formatPeriod({ start: latest.periodStart, end: latest.periodEnd }, latest.data.timezone)}
                          </p>
                        </>
                      ) : (
                        <p className="text-zinc-500">No reports yet</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className={`${card} h-fit`}>
        <h2 className="mb-4 font-semibold">Add a client</h2>
        <ClientForm mode="create" />
      </aside>
    </div>
  );
}
