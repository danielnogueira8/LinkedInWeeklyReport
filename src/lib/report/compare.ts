import { isRollingWeek, isWeekReport, reportWeek, shiftWeek, weekPeriod, type Period } from "@/lib/period";
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
type Dated = Pick<WeekRow, "periodStart" | "periodEnd">;

const periodOf = (row: Dated): Period => ({ start: row.periodStart, end: row.periodEnd });
const weekOf = (row: Dated & Pick<WeekRow, "timezone">) => reportWeek(periodOf(row), row.timezone);

/** Week reports oldest to newest, one per week (the latest built), most recent `limit`. */
export function weeklySeries<T extends WeekRow>(rows: T[], limit = 8): T[] {
  // Keyed by the Sunday each week ends on, so a week built twice (an old Monday-to-Monday
  // report and a newer one, or under another timezone) counts once.
  const byWeek = new Map<string, T>();
  for (const row of rows) {
    if (!isWeekReport(periodOf(row), row.timezone)) continue;
    const week = weekOf(row);
    const current = byWeek.get(week);
    if (!current || row.generatedAt > current.generatedAt) byWeek.set(week, row);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row)
    .slice(-limit);
}

/** The report for the week before `row`'s, if there is one. */
export function previousWeek<T extends WeekRow>(rows: T[], row: Dated & Pick<WeekRow, "timezone">): T | null {
  const before = shiftWeek(weekOf(row), -1);
  return rows.find((candidate) => weekOf(candidate) === before) ?? null;
}

export type WeekSlot<T> = { start: Date; end: Date; row: T | null };

/** The last `count` weeks up to the newest report, with null where a week has none. */
export function weekSlots<T extends WeekRow>(weeks: T[], count = 8): WeekSlot<T>[] {
  const latest = weeks.at(-1);
  if (!latest) return [];
  const byWeek = new Map(weeks.map((week) => [weekOf(week), week]));
  const slots: WeekSlot<T>[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const week = shiftWeek(weekOf(latest), -i);
    const row = byWeek.get(week);
    slots.push(
      row ? { start: row.periodStart, end: row.periodEnd, row } : { ...weekPeriod(week, latest.timezone), row: null },
    );
  }
  // Weeks before the first report aren't missing data, they just predate the client.
  while (slots.length && !slots[0].row) slots.shift();
  return slots;
}

/**
 * The saved report a new build of `period` should overwrite rather than add another: the
 * client's latest one for the same week, built the current way (the 7 days up to when it was
 * built). Null when `period` itself is already saved (a refresh), or the week has none.
 * Midnight-to-midnight weeks from before are never overwritten. `rows` newest built first.
 */
export function reportToReplace<T extends Dated>(rows: T[], period: Period, tz: string): T | null {
  const same = (row: T) =>
    row.periodStart.getTime() === period.start.getTime() && row.periodEnd.getTime() === period.end.getTime();
  if (rows.some(same)) return null;
  const week = reportWeek(period, tz);
  return rows.find((row) => isRollingWeek(periodOf(row), tz) && reportWeek(periodOf(row), tz) === week) ?? null;
}
