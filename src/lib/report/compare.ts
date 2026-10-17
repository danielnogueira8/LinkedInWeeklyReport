import { TZDate } from "@date-fns/tz";
import { addDays, subDays } from "date-fns";
import { isCalendarWeek, localDate } from "@/lib/period";
import type { ReportTotals } from "@/lib/report/build";

export type Metric = "impressions" | "reactions" | "comments" | "reposts" | "dms";

export function metricValue(totals: ReportTotals, metric: Metric) {
  return metric === "dms" ? totals.firstDms + totals.followUps : totals[metric];
}

/** Relative change, or null when there's nothing meaningful to compare against. */
export function change(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}

type WeekRow = { periodStart: Date; periodEnd: Date; generatedAt: Date; timezone: string; totals: ReportTotals };

/** Calendar-week reports oldest to newest, one per week (the latest built), most recent `limit`. */
export function weeklySeries<T extends WeekRow>(rows: T[], limit = 8): T[] {
  // Keyed by local start date, so a week also built under another timezone counts once.
  const byWeek = new Map<string, T>();
  for (const row of rows) {
    if (!isCalendarWeek({ start: row.periodStart, end: row.periodEnd }, row.timezone)) continue;
    const week = localDate(row.periodStart, row.timezone);
    const current = byWeek.get(week);
    if (!current || row.generatedAt > current.generatedAt) byWeek.set(week, row);
  }
  return [...byWeek.values()].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime()).slice(-limit);
}

/** The report for the week that ends where `row` starts, if there is one. */
export function previousWeek<T extends WeekRow>(rows: T[], row: Pick<WeekRow, "periodStart">): T | null {
  return rows.find((candidate) => candidate.periodEnd.getTime() === row.periodStart.getTime()) ?? null;
}

export type WeekSlot<T> = { start: Date; end: Date; row: T | null };

/** The last `count` calendar weeks up to the newest report, with null where a week has none. */
export function weekSlots<T extends WeekRow>(weeks: T[], count = 8): WeekSlot<T>[] {
  const latest = weeks.at(-1);
  if (!latest) return [];
  const byStart = new Map(weeks.map((week) => [week.periodStart.getTime(), week]));
  const slots: WeekSlot<T>[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = subDays(new TZDate(latest.periodStart, latest.timezone), 7 * i);
    slots.push({
      start: new Date(start.getTime()),
      end: new Date(addDays(start, 7).getTime()),
      row: byStart.get(start.getTime()) ?? null,
    });
  }
  // Weeks before the first report aren't missing data, they just predate the client.
  while (slots.length && !slots[0].row) slots.shift();
  return slots;
}
