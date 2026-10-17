import Link from "next/link";
const axisFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
import { dayMonth, shortRange } from "@/lib/period";
import { formatNumber, plural } from "@/lib/report/text";

// Single-series bar charts: grey bars, the latest week in the accent, rounded data-ends
// square at the baseline, and no legend (the chart title names the series).

type Point = { start: Date; end: Date; value: number | null; href?: string };

function niceMax(max: number) {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((step) => step * magnitude).find((candidate) => candidate >= max)!;
}

/** A column with only its top corners rounded. */
function columnPath(x: number, top: number, width: number, base: number, radius: number) {
  const r = Math.min(radius, width / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

/** Tiny trend for table rows. Native tooltips per bar; the full numbers live on the client page. */
export function Sparkline({ points, timezone, label }: { points: Point[]; timezone: string; label: string }) {
  if (points.filter((point) => point.value !== null).length < 2) {
    return (
      <span className="text-xs text-zinc-300" title="Needs at least two weekly reports">
        —
      </span>
    );
  }
  const barWidth = 6;
  const gap = 2;
  const height = 24;
  const max = Math.max(...points.map((point) => point.value ?? 0), 1);

  return (
    <svg
      width={points.length * (barWidth + gap) - gap}
      height={height}
      role="img"
      aria-label={`${label}, last ${points.length} weeks`}
      className="overflow-visible"
    >
      {points.map((point, index) => {
        if (point.value === null) return null;
        const barHeight = Math.max(2, (point.value / max) * height);
        const last = index === points.length - 1;
        return (
          <path
            key={point.start.getTime()}
            d={columnPath(index * (barWidth + gap), height - barHeight, barWidth, height, 2)}
            className={last ? "fill-brand-500" : "fill-chart-muted"}
          >
            <title>{`${shortRange(point, timezone)}: ${formatNumber(point.value)}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

/** Weekly impressions on the client page. Each bar links to that week's report. */
export function WeeklyBars({ points, timezone, unit }: { points: Point[]; timezone: string; unit: string }) {
  const top = niceMax(Math.max(...points.map((point) => point.value ?? 0)));
  const ticks = [top, top / 2, 0];

  return (
    <div className="flex gap-3 pt-5">
      <div className="flex h-44 flex-col justify-between pb-0 text-right text-[11px] tabular-nums text-zinc-400">
        {ticks.map((tick) => (
          <span key={tick} className="-my-1.5 leading-3">
            {axisFormat.format(tick)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-44">
          {ticks.map((tick) => (
            <div
              key={tick}
              className={`absolute inset-x-0 h-px ${tick === 0 ? "bg-zinc-300" : "bg-zinc-100"}`}
              style={{ bottom: `${(tick / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-2">
            {points.map((point, index) => {
              const last = index === points.length - 1;
              const height = point.value === null ? 0 : Math.max(1.5, (point.value / top) * 100);
              const tip = point.value === null ? "No report" : plural(point.value, unit);
              const body = (
                <>
                  {last && point.value !== null ? (
                    <span className="mb-1 shrink-0 text-xs font-semibold text-zinc-900">
                      {formatNumber(point.value)}
                    </span>
                  ) : null}
                  <span
                    className={`w-full max-w-6 shrink-0 rounded-t-[4px] transition-colors ${
                      last ? "bg-brand-500" : "bg-chart-muted group-hover:bg-zinc-400"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                  <span className="pointer-events-none absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-300 shadow-lg group-hover:block group-focus-visible:block">
                    <strong className="font-semibold text-white">{tip}</strong> · {shortRange(point, timezone)}
                  </span>
                </>
              );
              const className =
                "group relative flex h-full flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
              return point.href ? (
                <Link key={point.start.getTime()} href={point.href} className={className}>
                  {body}
                </Link>
              ) : (
                <div key={point.start.getTime()} className={className} tabIndex={0}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          {points.map((point) => (
            <span key={point.start.getTime()} className="flex-1 truncate text-center text-[11px] text-zinc-400">
              {dayMonth(point.start, timezone)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
