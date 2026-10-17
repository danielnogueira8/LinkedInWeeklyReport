import { ChevronDown, ExternalLink, ListChecks } from "lucide-react";
import { card, pill } from "@/components/ui";
import { dayMonth, weekdayShort } from "@/lib/period";
import type { FeedCheck } from "@/lib/report/build";

/**
 * Everything LeadShark sent back for each creator in the period, counted or not, so the
 * report can be checked against the creator's LinkedIn activity page.
 */
export function FeedCheckPanel({
  feeds,
  timezone,
  profileUrls,
}: {
  feeds: FeedCheck[];
  timezone: string;
  /** LinkedIn profile URLs by creator id, for the "check on LinkedIn" links. */
  profileUrls: Map<string, string>;
}) {
  const day = (iso: string) => `${weekdayShort(new Date(iso), timezone)} ${dayMonth(new Date(iso), timezone)}`;
  return (
    <details className={`${card} group mt-6`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
        <ListChecks className="size-4 text-zinc-400" aria-hidden />
        What LeadShark returned
        <span className="hidden font-normal text-zinc-400 sm:inline">· check it against LinkedIn</span>
        <ChevronDown className="ml-auto size-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="divide-y divide-zinc-100 border-t border-zinc-100">
        {feeds.map((feed) => {
          const counted = feed.items.filter((item) => !item.leftOut).length;
          const profileUrl = feed.profileId ? profileUrls.get(feed.profileId) : undefined;
          return (
            <div key={feed.profileId ?? feed.name} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-zinc-900">{feed.name}</p>
                {profileUrl ? (
                  <a
                    href={`${profileUrl}/recent-activity/all/`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Their LinkedIn activity
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {feed.returned} {feed.returned === 1 ? "post" : "posts"} from LeadShark in {feed.pages}{" "}
                {feed.pages === 1 ? "page" : "pages"} of up to {feed.pageSize},{" "}
                {feed.reachedStart
                  ? "reaching back past the start of this period."
                  : `only reaching back to ${feed.oldest ? day(feed.oldest) : "this period"}.`}{" "}
                {feed.items.length} dated in this period, {counted} counted for {feed.name}.
              </p>
              {feed.items.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {feed.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 text-sm">
                      <span className="w-20 shrink-0 text-xs text-zinc-400">{day(item.postedAt)}</span>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-zinc-700 hover:underline"
                      >
                        {item.excerpt || item.url}
                      </a>
                      <span
                        className={`${pill} shrink-0 ${item.leftOut ? "bg-zinc-100 text-zinc-600" : "bg-good-bg text-good"}`}
                      >
                        {item.leftOut ?? "Counted"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 break-words text-[11px] text-zinc-400">
                Post fields: {feed.postFields.join(", ") || "none"} · Response fields:{" "}
                {feed.responseFields.join(", ") || "none"}
              </p>
            </div>
          );
        })}
      </div>
    </details>
  );
}
