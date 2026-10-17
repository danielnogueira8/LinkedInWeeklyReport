import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { deleteReport } from "@/app/actions";
import { ConfirmSubmit, CopyButton, HighlightsEditor, RegenerateButton } from "@/components/report-controls";
import { button, card } from "@/components/ui";
import { getReportWithClient } from "@/lib/data";
import { formatPeriod, weekdayShort } from "@/lib/period";
import { dmsOf } from "@/lib/report/build";
import { formatNumber, highlightsFor, renderReportText } from "@/lib/report/text";

// "Refresh numbers" calls LeadShark from a Server Action on this page.
export const maxDuration = 60;

export async function generateMetadata({ params }: PageProps<"/reports/[id]">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const report = await getReportWithClient(id);
  return { title: report ? `${report.client.name} report` : "Report" };
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p>
      {sub ? <p className="mt-0.5 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  await connection();
  const report = await getReportWithClient(id);
  if (!report) notFound();

  const { data, client } = report;
  const period = { start: report.periodStart, end: report.periodEnd };
  const highlights = highlightsFor(data, report.highlightsOverride);
  const text = renderReportText({ clientName: client.name, period, data, highlights });
  const { totals } = data;
  const generated = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: data.timezone,
  }).format(report.generatedAt);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href={`/clients/${client.id}`} className="text-sm text-zinc-500 hover:text-zinc-900">
            ← {client.name}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Performance report</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {formatPeriod(period, data.timezone)} · numbers as of {generated}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={text} />
          <a href={`/reports/${report.id}/pdf`} className={button.secondary}>
            Download PDF
          </a>
          <RegenerateButton reportId={report.id} />
        </div>
      </div>

      {data.warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Impressions" value={totals.impressions} />
        <Kpi label="Reactions" value={totals.reactions} />
        <Kpi label="Comments" value={totals.comments} />
        <Kpi label="Reposts" value={totals.reposts} />
        <Kpi
          label="DMs sent"
          value={totals.firstDms + totals.followUps}
          sub={`${formatNumber(totals.firstDms)} first · ${formatNumber(totals.followUps)} follow-ups`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Copy-ready text</h2>
            <CopyButton text={text} label="Copy" />
          </div>
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-4 font-mono text-[13px] leading-relaxed text-zinc-800">
            {text}
          </pre>
        </section>
        <section className={card}>
          {data.posts.length > 0 ? (
            <HighlightsEditor
              reportId={report.id}
              highlights={highlights}
              edited={Boolean(report.highlightsOverride)}
            />
          ) : (
            <p className="text-sm text-zinc-600">No posts in this period, so there&apos;s nothing to highlight.</p>
          )}
        </section>
      </div>

      {data.posts.length > 0 ? (
        <section>
          <h2 className="mb-3 font-semibold">All posts in this period ({data.posts.length})</h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Post</th>
                  <th className="px-4 py-3 text-right font-medium">Impr.</th>
                  <th className="px-4 py-3 text-right font-medium">React.</th>
                  <th className="px-4 py-3 text-right font-medium">Comm.</th>
                  <th className="px-4 py-3 text-right font-medium">Reposts</th>
                  <th className="px-4 py-3 text-right font-medium">DMs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.posts.map((post, index) => (
                  <tr key={post.id} className="align-top">
                    <td className="max-w-md px-4 py-3">
                      <a href={post.url} target="_blank" rel="noreferrer" className="group block">
                        <span className="text-xs text-zinc-500">
                          #{index + 1} · {weekdayShort(new Date(post.postedAt), data.timezone)}
                          {post.automationRunning ? " · automation running" : ""}
                        </span>
                        <span className="block truncate group-hover:underline">{post.excerpt || post.url}</span>
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(post.impressions)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(post.reactions)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(post.comments)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(post.reposts)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(dmsOf(post))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="flex justify-end">
        <ConfirmSubmit
          action={deleteReport.bind(null, report.id)}
          label="Delete report"
          confirmMessage="Delete this report? You can generate it again later."
        />
      </div>
    </div>
  );
}
