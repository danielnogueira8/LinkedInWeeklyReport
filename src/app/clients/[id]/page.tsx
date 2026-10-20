import { ChevronRight, ExternalLink, FileText, MessagesSquare, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Avatar, avatarSrc, ClientAvatar } from "@/components/avatar";
import { WeeklyBars } from "@/components/charts";
import { compact, Delta, StatTile } from "@/components/metrics";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PartialWeek } from "@/components/partial-week";
import { GenerateReportForm } from "@/components/report-controls";
import { button, card, cardHeader, cardTitle, pill } from "@/components/ui";
import { getClient, listReports } from "@/lib/data";
import { dayMonth, formatTimestamp, isPartial, localDate, shortRange } from "@/lib/period";
import { change, metricValue, previousWeek, weekSlots, weeklySeries } from "@/lib/report/compare";
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

  const joint = client.profiles.length > 1;
  const reports = (await listReports(client.id)).map((report) => ({
    ...report,
    timezone: report.data.timezone,
    totals: report.data.totals,
  }));
  const weeks = weeklySeries(reports);
  const latest = weeks.at(-1) ?? null;
  const previous = latest ? previousWeek(weeks, latest) : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Clients", href: "/" }, { label: client.name }]}
        leading={
          <ClientAvatar
            name={client.name}
            creators={client.profiles.map((profile) => ({ name: profile.name, src: avatarSrc(profile) }))}
            size="lg"
          />
        }
        title={client.name}
        description={
          <span className="mt-1 flex flex-col gap-1">
            {joint ? (
              <span className={`${pill} w-fit bg-brand-50 text-brand-700`}>
                Joint report · {client.profiles.length} creators
              </span>
            ) : null}
            {client.profiles.map((profile) => (
              <span key={profile.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {joint ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
                    <Avatar name={profile.name} size="sm" src={avatarSrc(profile)} />
                    {profile.name}
                  </span>
                ) : null}
                <a
                  href={profile.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-zinc-900"
                >
                  {profile.linkedinUrl.replace(/^https:\/\/www\./, "")}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </span>
            ))}
          </span>
        }
        actions={
          <>
            <Link href={`/clients/${client.id}/settings`} className={button.secondary}>
              <Settings aria-hidden />
              Settings
            </Link>
            <Link href={`/clients/${client.id}/commenters`} className={button.secondary}>
              <MessagesSquare aria-hidden />
              Commenters
            </Link>
            <GenerateReportForm clientId={client.id} />
          </>
        }
      />

      {latest ? (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              Week of {dayMonth(latest.periodStart, latest.timezone)}
              {isPartial({ start: latest.periodStart, end: latest.periodEnd }, latest.generatedAt, latest.timezone) ? (
                <PartialWeek />
              ) : null}
            </h2>
            <Link
              href={`/reports/${latest.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Open report
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  ["Impressions", "impressions"],
                  ["Reactions", "reactions"],
                  ["Comments", "comments"],
                  ["DMs sent", "dms"],
                ] as const
              ).map(([label, metric]) => (
                <StatTile
                  key={metric}
                  label={label}
                  value={metricValue(latest.totals, metric)}
                  delta={
                    previous ? change(metricValue(latest.totals, metric), metricValue(previous.totals, metric)) : null
                  }
                />
              ))}
            </div>
            <div className={card}>
              <div className={cardHeader}>
                <h3 className={cardTitle}>Weekly impressions</h3>
                <span className="text-xs text-zinc-400">Click a week to open it</span>
              </div>
              <div className="px-5 pb-4">
                <WeeklyBars
                  unit="impression"
                  timezone={latest.timezone}
                  points={weekSlots(weeks).map((slot) => ({
                    ...slot,
                    value: slot.row?.totals.impressions ?? null,
                    href: slot.row ? `/reports/${slot.row.id}` : undefined,
                  }))}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={`${card} mb-8 overflow-hidden`}>
        <div className={cardHeader}>
          <h2 className={cardTitle}>Reports</h2>
          <span className="text-xs text-zinc-400">{reports.length}</span>
        </div>
        {reports.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<FileText />} title="No reports yet">
              Generate the first one above. It covers the last 7 days.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reports.map((report) => {
              const period = { start: report.periodStart, end: report.periodEnd };
              const before = previousWeek(weeks, report);
              return (
                <li key={report.id}>
                  <Link
                    href={`/reports/${report.id}`}
                    className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-zinc-50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500 [&_svg]:size-4">
                      <FileText aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-900">
                          {shortRange(period, report.timezone)}{" "}
                          {localDate(new Date(report.periodEnd.getTime() - 1), report.timezone).slice(0, 4)}
                        </span>
                        {isPartial(period, report.generatedAt, report.timezone) ? <PartialWeek /> : null}
                        {report.highlightsOverride ? (
                          <span className={`${pill} bg-brand-50 text-brand-700`}>Edited</span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {report.totals.posts} {report.totals.posts === 1 ? "post" : "posts"} · updated{" "}
                        {formatTimestamp(report.generatedAt)}
                      </span>
                    </span>
                    <span className="hidden flex-col items-end gap-1 sm:flex">
                      <span className="text-sm font-medium tabular-nums text-zinc-900">
                        {compact(report.totals.impressions)}
                        <span className="font-normal text-zinc-400"> impr.</span>
                      </span>
                      <Delta value={before ? change(report.totals.impressions, before.totals.impressions) : null} />
                    </span>
                    <span className="hidden w-20 text-right text-sm tabular-nums text-zinc-700 md:block">
                      {formatNumber(metricValue(report.totals, "dms"))}
                      <span className="text-zinc-400"> DMs</span>
                    </span>
                    <ChevronRight className="size-4 text-zinc-300 group-hover:text-zinc-500" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
