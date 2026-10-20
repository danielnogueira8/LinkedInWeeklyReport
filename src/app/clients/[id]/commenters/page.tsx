import { Download, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { avatarSrc, ClientAvatar } from "@/components/avatar";
import { IcpForm, SyncCommenters } from "@/components/commenters";
import { EmptyState, PageHeader } from "@/components/page-header";
import { button, card, cardHeader, cardTitle, pill } from "@/components/ui";
import {
  connectionLabel,
  fitLabel,
  ICP_MAX_LENGTH,
  listCommenters,
  parseView,
  viewStart,
  type CommentersView,
} from "@/lib/commenters/list";
import { commentersStatus } from "@/lib/commenters/sync";
import { getClient } from "@/lib/data";
import { dayMonth, formatTimestamp } from "@/lib/period";
import { formatNumber } from "@/lib/report/text";

// The page shows the best this many; the CSV has everyone.
const SHOWN = 200;

const VIEWS: Array<{ view: CommentersView; label: string; description: string }> = [
  { view: "week", label: "Last 7 days", description: "People who commented on posts published in the last 7 days." },
  { view: "all", label: "All time", description: "People who commented on any of the creators' posts." },
];

const FIT_STYLES: Record<string, string> = {
  fit: "bg-good-bg text-good",
  adjacent: "bg-amber-50 text-amber-700",
  not: "bg-zinc-100 text-zinc-500",
  unreadable: "bg-zinc-100 text-zinc-500",
};

const SUMMARY: Array<[string, string]> = [
  ["fit", "Fit"],
  ["adjacent", "Adjacent"],
  ["unscored", "Not scored"],
  ["unreadable", "Unreadable"],
  ["not", "Not a fit"],
];

export async function generateMetadata({ params }: PageProps<"/clients/[id]/commenters">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const client = await getClient(id);
  return { title: client ? `${client.name} commenters` : "Commenters" };
}

export default async function CommentersPage({ params, searchParams }: PageProps<"/clients/[id]/commenters">) {
  const { id } = await params;
  const view = parseView((await searchParams).view);
  await connection();
  const client = await getClient(id);
  if (!client) notFound();

  const [status, { commenters, counts }] = await Promise.all([
    commentersStatus(client, view),
    listCommenters(client, view, SHOWN),
  ]);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const current = VIEWS.find((option) => option.view === view)!;
  // All time, but nothing older than the week has been read yet.
  const weekStart = viewStart("week")!;
  const onlyRecent =
    view === "all" && status.earliestPost !== null && new Date(status.earliestPost).getTime() >= weekStart.getTime();

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Clients", href: "/" },
          { label: client.name, href: `/clients/${client.id}` },
          { label: "Commenters" },
        ]}
        leading={
          <ClientAvatar
            name={client.name}
            creators={client.profiles.map((profile) => ({ name: profile.name, src: avatarSrc(profile) }))}
            size="lg"
          />
        }
        title="Commenters"
        description={`Everyone who commented on ${client.name}'s posts, scored against their ideal customer.`}
        actions={
          <>
            {total > 0 ? (
              <a href={`/clients/${client.id}/commenters/csv?view=${view}`} className={button.secondary}>
                <Download aria-hidden />
                CSV
              </a>
            ) : null}
            <SyncCommenters key={view} clientId={client.id} view={view} />
          </>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${card} p-5`}>
          <IcpForm clientId={client.id} icp={client.icp ?? ""} maxLength={ICP_MAX_LENGTH} />
        </section>
        <section className={`${card} p-5 text-sm`}>
          <h2 className={cardTitle}>{current.label}</h2>
          <dl className="mt-3 space-y-1.5 text-zinc-600">
            <div className="flex justify-between gap-3">
              <dt>Posts read</dt>
              <dd className="tabular-nums text-zinc-900">
                {formatNumber(status.postsRead)} of {formatNumber(status.posts)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Comments</dt>
              <dd className="tabular-nums text-zinc-900">{formatNumber(status.comments)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>People scored</dt>
              <dd className="tabular-nums text-zinc-900">
                {status.icp ? `${formatNumber(status.scored)} of ${formatNumber(status.people)}` : "Add an ICP"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-zinc-500">
            {status.syncedAt ? `Last synced ${formatTimestamp(new Date(status.syncedAt))}.` : "Not synced yet."} The
            first all-time sync reads every post and can take a while; later ones only read what changed.
          </p>
          {onlyRecent ? (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Only the last 7 days&apos; posts have been read so far. Sync all time to read the older ones.
            </p>
          ) : null}
        </section>
      </div>

      <section className={`${card} overflow-hidden`}>
        <div className={`${cardHeader} flex-wrap`}>
          <nav className="flex gap-1 rounded-lg bg-zinc-100 p-0.5" aria-label="Which posts">
            {VIEWS.map((option) => (
              <Link
                key={option.view}
                href={`/clients/${client.id}/commenters?view=${option.view}`}
                aria-current={option.view === view ? "page" : undefined}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  option.view === view ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </nav>
          {total > 0 ? (
            <p className="text-xs text-zinc-500">
              {SUMMARY.filter(([key]) => counts[key])
                .map(([key, text]) => `${text} ${formatNumber(counts[key])}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <p className="border-b border-zinc-100 px-5 py-2.5 text-xs text-zinc-500">
          {current.description}
          {total > SHOWN ? ` Showing the best ${SHOWN} of ${formatNumber(total)}: the CSV has everyone.` : ""}
        </p>

        {commenters.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<MessagesSquare />} title="No commenters yet">
              {status.posts === 0
                ? `Click "${view === "week" ? "Sync last 7 days" : "Sync all time"}" to read the comments.`
                : "Nobody has commented on these posts yet."}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  <th className="px-5 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">ICP</th>
                  <th className="px-3 py-2.5 text-right font-medium">Comments</th>
                  <th className="px-3 py-2.5 font-medium">Last comment</th>
                  <th className="px-5 py-2.5 font-medium">Connection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {commenters.map((person) => (
                  <tr key={person.personId} className="align-top hover:bg-zinc-50">
                    <td className="max-w-96 px-5 py-2.5">
                      <a
                        href={person.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-zinc-900 hover:underline"
                      >
                        {person.name || person.personId}
                      </a>
                      <span className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{person.headline}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span
                        className={`${pill} ${person.fit ? (FIT_STYLES[person.fit] ?? FIT_STYLES.not) : "bg-zinc-50 text-zinc-400 ring-1 ring-zinc-200"}`}
                      >
                        {fitLabel(person.fit)}
                        {person.pct !== null ? <span className="tabular-nums">{person.pct}%</span> : null}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums"
                      title={`On ${person.posts} ${person.posts === 1 ? "post" : "posts"}: ${person.hooks.join(" | ")}`}
                    >
                      {formatNumber(person.comments)}
                    </td>
                    <td className="max-w-72 px-3 py-2.5">
                      <span className="text-xs text-zinc-400">{dayMonth(person.lastAt)}</span>
                      <span className="block truncate text-zinc-700">{person.latestComment}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-zinc-600">
                      {connectionLabel(person.networkDistance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
