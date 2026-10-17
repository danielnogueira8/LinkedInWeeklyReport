import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { deleteClient } from "@/app/actions";
import { ClientForm } from "@/components/client-form";
import { ConfirmSubmit, GenerateReportForm } from "@/components/report-controls";
import { card } from "@/components/ui";
import { getClient, listReports } from "@/lib/data";
import { currentWeek, formatPeriod, periodOptions, periodValue } from "@/lib/period";
import { formatNumber } from "@/lib/report/text";

// Generating a report calls LeadShark from a Server Action on this page.
export const maxDuration = 60;

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const client = await getClient(id);
  return { title: client?.name ?? "Client" };
}

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  await connection();
  const client = await getClient(id);
  if (!client) notFound();
  const reports = await listReports(client.id);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← All clients
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          <a href={client.linkedinUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-900">
            {client.linkedinUrl.replace(/^https:\/\/www\./, "")}
          </a>
          <span className="mx-2">·</span>
          LeadShark key ••••{client.apiKeyLast4}
        </p>
      </div>

      <section className={card}>
        <h2 className="font-semibold">Generate a report</h2>
        <p className="mb-4 mt-1 text-sm text-zinc-600">
          Covers posts published in the period. Generating the same week again refreshes its numbers.
        </p>
        <GenerateReportForm clientId={client.id} options={periodOptions()} defaultValue={periodValue(currentWeek())} />
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Reports</h2>
        {reports.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600">
            No reports yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 text-right font-medium">Posts</th>
                  <th className="px-5 py-3 text-right font-medium">Impressions</th>
                  <th className="px-5 py-3 text-right font-medium">Comments</th>
                  <th className="px-5 py-3 text-right font-medium">DMs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reports.map((report) => {
                  const { totals, timezone } = report.data;
                  return (
                    <tr key={report.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <Link href={`/reports/${report.id}`} className="font-medium hover:underline">
                          {formatPeriod({ start: report.periodStart, end: report.periodEnd }, timezone)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{totals.posts}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatNumber(totals.impressions)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatNumber(totals.comments)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatNumber(totals.firstDms + totals.followUps)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${card} grid gap-8 md:grid-cols-[1fr_auto]`}>
        <div className="max-w-md">
          <h2 className="mb-4 font-semibold">Client details</h2>
          <ClientForm
            mode="edit"
            client={{
              id: client.id,
              name: client.name,
              linkedinUrl: client.linkedinUrl,
              apiKeyLast4: client.apiKeyLast4,
            }}
          />
        </div>
        <div className="md:border-l md:border-zinc-200 md:pl-8">
          <h2 className="mb-2 font-semibold">Remove client</h2>
          <p className="mb-4 max-w-56 text-sm text-zinc-600">Deletes the client, their key and all their reports.</p>
          <ConfirmSubmit
            action={deleteClient.bind(null, client.id)}
            label="Delete client"
            confirmMessage={`Delete ${client.name} and all their reports? This can't be undone.`}
          />
        </div>
      </section>
    </div>
  );
}
