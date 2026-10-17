import { Download, ExternalLink, Eye, MessageCircle, Repeat2, Send, ThumbsUp, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { deleteReport } from "@/app/actions";
import { Avatar, avatarSrc, ClientAvatar } from "@/components/avatar";
import { FeedCheckPanel } from "@/components/feed-check";
import { StatTile } from "@/components/metrics";
import { PageHeader } from "@/components/page-header";
import { PartialWeek } from "@/components/partial-week";
import { ConfirmSubmit, CopyButton, HighlightsEditor, RegenerateButton } from "@/components/report-controls";
import { button, card, cardHeader, cardTitle, pill } from "@/components/ui";
import { getPreviousReport, getReportWithClient } from "@/lib/data";
import { dayMonth, formatTimestamp, isCalendarWeek, isPartial, shortRange, weekdayShort } from "@/lib/period";
import { dmsOf, isJoint, type ReportData, type ReportPost } from "@/lib/report/build";
import { change, metricValue, type Metric } from "@/lib/report/compare";
import { formatNumber, highlightsFor, plural, renderReportText, topPosts } from "@/lib/report/text";

// "Refresh numbers" calls LeadShark from a Server Action on this page.
export const maxDuration = 60;

export async function generateMetadata({ params }: PageProps<"/reports/[id]">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const report = await getReportWithClient(id);
  return { title: report ? `${report.client.name} report` : "Report" };
}

const kpis: Array<[label: string, metric: Metric]> = [
  ["Impressions", "impressions"],
  ["Reactions", "reactions"],
  ["Comments", "comments"],
  ["Reposts", "reposts"],
  ["DMs sent", "dms"],
];

function PostMetrics({ post }: { post: ReportPost }) {
  const items = [
    { icon: Eye, value: post.impressions, label: "impressions" },
    { icon: ThumbsUp, value: post.reactions, label: "reactions" },
    { icon: MessageCircle, value: post.comments, label: "comments" },
    { icon: Repeat2, value: post.reposts, label: "reposts" },
    { icon: Send, value: dmsOf(post), label: "DMs" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
      {items.map((item) => (
        <li
          key={item.label}
          className="inline-flex items-center gap-1.5"
          title={`${formatNumber(item.value)} ${item.label}`}
        >
          <item.icon className="size-3.5 text-zinc-400" aria-hidden />
          <span className="font-medium text-zinc-900">{formatNumber(item.value)}</span>
          <span className="sr-only">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Joint reports: each creator's share of the week. */
function CreatorBreakdown({ data, photos }: { data: ReportData; photos: Map<string, string | null> }) {
  const total = data.totals.impressions;
  return (
    <section className={card}>
      <div className={cardHeader}>
        <h2 className={cardTitle}>By creator</h2>
        <span className="text-xs text-zinc-400">Share of impressions</span>
      </div>
      <ul className="divide-y divide-zinc-100">
        {data.creators!.map((creator) => {
          const share = total > 0 ? creator.totals.impressions / total : 0;
          const dms = creator.totals.firstDms + creator.totals.followUps;
          return (
            <li
              key={creator.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 px-5 py-3.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={creator.name} src={photos.get(creator.id)} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-900">{creator.name}</span>
                  <span className="block text-xs text-zinc-500">{plural(creator.totals.posts, "post")}</span>
                </span>
              </span>
              <span className="hidden items-center gap-3 sm:flex">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${share * 100}%` }} />
                </span>
                <span className="w-9 text-right text-xs tabular-nums text-zinc-500">{Math.round(share * 100)}%</span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-medium tabular-nums text-zinc-900">
                  {formatNumber(creator.totals.impressions)} <span className="font-normal text-zinc-400">impr.</span>
                </span>
                <span className="block text-xs text-zinc-500">
                  {plural(creator.totals.comments, "comment")} · {plural(dms, "DM")}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  await connection();
  const report = await getReportWithClient(id);
  if (!report) notFound();
  const previous = await getPreviousReport(report);

  const { data, client } = report;
  // Current photos by creator id (a removed creator just falls back to initials).
  const photos = new Map(client.profiles.map((profile) => [profile.id, avatarSrc(profile)]));
  const { timezone, totals } = data;
  const period = { start: report.periodStart, end: report.periodEnd };
  const highlights = highlightsFor(data, report.highlightsOverride);
  const text = renderReportText({ clientName: client.name, period, data, highlights });
  const top = topPosts(data);
  const partial = isPartial(period, report.generatedAt, timezone);
  const title = isCalendarWeek(period, timezone)
    ? `Week of ${dayMonth(period.start, timezone)}`
    : shortRange(period, timezone);
  // Shown in the agency's timezone, whatever timezone the report's weeks were built in.
  const generated = formatTimestamp(report.generatedAt);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Clients", href: "/" },
          { label: client.name, href: `/clients/${client.id}` },
          { label: title },
        ]}
        leading={
          <ClientAvatar
            name={client.name}
            creators={(data.creators ?? client.profiles).map((creator) => ({
              name: creator.name,
              src: photos.get(creator.id),
            }))}
            size="lg"
          />
        }
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {client.name} · numbers as of {generated}
            {partial ? <PartialWeek /> : null}
          </span>
        }
        actions={
          <>
            <CopyButton text={text} />
            <a href={`/reports/${report.id}/pdf`} className={button.secondary}>
              <Download aria-hidden />
              PDF
            </a>
            <RegenerateButton reportId={report.id} />
          </>
        }
      />

      {data.warnings.length > 0 ? (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-1">
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map(([label, metric]) => (
          <StatTile
            key={metric}
            label={label}
            value={metricValue(totals, metric)}
            delta={previous ? change(metricValue(totals, metric), metricValue(previous.data.totals, metric)) : null}
            footnote={
              metric === "dms" && totals.followUps > 0
                ? `${formatNumber(totals.firstDms)} first · ${formatNumber(totals.followUps)} follow-ups`
                : undefined
            }
          />
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {isJoint(data) ? <CreatorBreakdown data={data} photos={photos} /> : null}
          <section className={card}>
            <div className={cardHeader}>
              <h2 className={cardTitle}>Top posts</h2>
              <span className="text-xs text-zinc-400">By impressions</span>
            </div>
            {top.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-zinc-500">No posts were published in this period.</p>
            ) : (
              <ol className="divide-y divide-zinc-100">
                {top.map((post, index) => (
                  <li key={post.id} className="flex gap-4 px-5 py-4">
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                        index === 0 ? "bg-brand-500 text-white" : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {post.profileName ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
                            <Avatar name={post.profileName} size="sm" src={photos.get(post.profileId ?? "")} />
                            {post.profileName} ·
                          </span>
                        ) : null}
                        {weekdayShort(new Date(post.postedAt), timezone)} {dayMonth(new Date(post.postedAt), timezone)}
                        {post.automationRunning ? (
                          <span className={`${pill} bg-good-bg text-good`}>Automation running</span>
                        ) : null}
                      </p>
                      <p className="line-clamp-2 text-sm font-medium text-zinc-900">
                        {post.excerpt || "Untitled post"}
                      </p>
                      <PostMetrics post={post} />
                    </div>
                    {post.url ? (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open on LinkedIn"
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <ExternalLink className="size-4" aria-hidden />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {data.posts.length > 0 ? (
            <section className={`${card} overflow-hidden`}>
              <div className={cardHeader}>
                <h2 className={cardTitle}>All posts</h2>
                <span className="text-xs text-zinc-400">{data.posts.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr className="border-b border-zinc-100">
                      <th className="px-5 py-2.5 font-medium">Post</th>
                      <th className="px-3 py-2.5 text-right font-medium">Impr.</th>
                      <th className="px-3 py-2.5 text-right font-medium">React.</th>
                      <th className="px-3 py-2.5 text-right font-medium">Comm.</th>
                      <th className="px-3 py-2.5 text-right font-medium">Reposts</th>
                      <th className="px-5 py-2.5 text-right font-medium">DMs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.posts.map((post) => (
                      <tr key={post.id} className="hover:bg-zinc-50">
                        <td className="max-w-80 px-5 py-2.5">
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate hover:underline"
                          >
                            <span className="mr-2 text-xs text-zinc-400">
                              {weekdayShort(new Date(post.postedAt), timezone)}
                              {post.profileName ? ` · ${post.profileName}` : ""}
                            </span>
                            {post.excerpt || post.url}
                          </a>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(post.impressions)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(post.reactions)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(post.comments)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(post.reposts)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(dmsOf(post))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="order-first space-y-6 lg:order-none">
          <section className={card}>
            <div className={cardHeader}>
              <h2 className={cardTitle}>Ready to send</h2>
              <CopyButton text={text} label="Copy" variant="secondary" />
            </div>
            <pre className="whitespace-pre-wrap break-words px-5 py-4 font-sans text-[13px] leading-relaxed text-zinc-700">
              {text}
            </pre>
          </section>

          {data.posts.length > 0 ? (
            <section className={card}>
              <div className={cardHeader}>
                <h2 className={cardTitle}>What worked best</h2>
                <span
                  className={`${pill} ${report.highlightsOverride ? "bg-brand-50 text-brand-700" : "bg-zinc-100 text-zinc-600"}`}
                >
                  {report.highlightsOverride ? "Edited by you" : "Auto-written"}
                </span>
              </div>
              <div className="p-5">
                <HighlightsEditor
                  reportId={report.id}
                  highlights={highlights}
                  edited={Boolean(report.highlightsOverride)}
                />
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {data.feeds?.length ? (
        <FeedCheckPanel
          feeds={data.feeds}
          timezone={timezone}
          profileUrls={new Map(client.profiles.map((profile) => [profile.id, profile.linkedinUrl]))}
        />
      ) : null}

      <div className="mt-10 flex justify-end">
        <ConfirmSubmit
          action={deleteReport.bind(null, report.id)}
          label="Delete report"
          variant="ghost"
          confirmMessage="Delete this report? You can generate it again later."
        />
      </div>
    </>
  );
}
