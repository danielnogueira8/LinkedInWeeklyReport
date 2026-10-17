import { ChevronRight, Plus, Users } from "lucide-react";
import Link from "next/link";
import { after, connection } from "next/server";
import { avatarSrc, ClientAvatar } from "@/components/avatar";
import { Sparkline } from "@/components/charts";
import { compact, Delta } from "@/components/metrics";
import { EmptyState, PageHeader } from "@/components/page-header";
import { button, card, pill } from "@/components/ui";
import { refreshAvatarsInBackground } from "@/lib/avatars";
import { listClientsOverview } from "@/lib/data";
import { isInProgress, shortRange, weeklyRunLabel } from "@/lib/period";
import { change, metricValue, weekSlots } from "@/lib/report/compare";
import { formatNumber } from "@/lib/report/text";

const columns =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 md:grid-cols-[minmax(0,2fr)_1fr_1fr_0.8fr_0.8fr_auto_auto]";

function handle(url: string) {
  return url.replace(/^https:\/\/www\.linkedin\.com\//, "");
}

export default async function ClientsPage() {
  await connection();
  const clients = await listClientsOverview();
  after(refreshAvatarsInBackground);

  return (
    <>
      <PageHeader
        title="Clients"
        description={`Every client's weekly report builds automatically on ${weeklyRunLabel()}. Generate one by hand any time.`}
        actions={
          <Link href="/clients/new" className={button.primary}>
            <Plus aria-hidden />
            Add client
          </Link>
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No clients yet"
          action={
            <Link href="/clients/new" className={button.primary}>
              <Plus aria-hidden />
              Add your first client
            </Link>
          }
        >
          Add a client with their LeadShark API key and their first report builds straight away.
        </EmptyState>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div
            className={`${columns} border-b border-zinc-100 bg-zinc-50/60 px-5 py-2.5 text-xs font-medium text-zinc-500`}
          >
            <span>Client</span>
            <span className="hidden md:block">Latest week</span>
            <span className="text-right">Impressions</span>
            <span className="hidden text-right md:block">Comments</span>
            <span className="hidden text-right md:block">DMs sent</span>
            <span className="hidden w-16 md:block">Trend</span>
            <span className="hidden w-4 md:block" />
          </div>
          <ul className="divide-y divide-zinc-100">
            {clients.map((client) => {
              const { latest, previous } = client;
              const slots = weekSlots(client.weeks);
              return (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className={`${columns} group px-5 py-3.5 transition-colors hover:bg-zinc-50`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <ClientAvatar
                        name={client.name}
                        creators={client.profiles.map((profile) => ({ name: profile.name, src: avatarSrc(profile) }))}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium text-zinc-900">{client.name}</span>
                          {client.profiles.length > 1 ? (
                            <span className={`${pill} shrink-0 bg-brand-50 text-brand-700`}>Joint</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {client.profiles.map((profile) => handle(profile.linkedinUrl)).join(" · ")}
                        </span>
                      </span>
                    </span>

                    {latest ? (
                      <>
                        <span className="hidden text-sm text-zinc-600 md:block">
                          {shortRange({ start: latest.periodStart, end: latest.periodEnd }, latest.timezone)}
                          {isInProgress({ start: latest.periodStart, end: latest.periodEnd }) ? (
                            <span className={`${pill} ml-2 bg-amber-50 text-amber-700`}>In progress</span>
                          ) : null}
                          <span className="block text-xs text-zinc-400">
                            {latest.totals.posts} {latest.totals.posts === 1 ? "post" : "posts"}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className="font-medium tabular-nums text-zinc-900">
                            {compact(latest.totals.impressions)}
                          </span>
                          <Delta value={change(latest.totals.impressions, previous?.totals.impressions)} />
                        </span>
                        <span className="hidden text-right tabular-nums text-zinc-700 md:block">
                          {formatNumber(latest.totals.comments)}
                        </span>
                        <span className="hidden text-right tabular-nums text-zinc-700 md:block">
                          {formatNumber(metricValue(latest.totals, "dms"))}
                        </span>
                        <span className="hidden w-16 md:block">
                          <Sparkline
                            label="Weekly impressions"
                            timezone={latest.timezone}
                            points={slots.map((slot) => ({ ...slot, value: slot.row?.totals.impressions ?? null }))}
                          />
                        </span>
                      </>
                    ) : (
                      <span className="text-right text-sm text-zinc-400 md:col-span-5 md:text-left">
                        No reports yet
                      </span>
                    )}
                    <ChevronRight
                      className="hidden size-4 text-zinc-300 transition-colors group-hover:text-zinc-500 md:block"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
