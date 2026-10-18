import { TZDate } from "@date-fns/tz";
import { addDays, format, parseISO, subDays } from "date-fns";

export type Period = { start: Date; end: Date };

/** The agency's timezone (Lisbon unless REPORT_TIMEZONE says otherwise). */
export function reportTimezone(): string {
  return process.env.REPORT_TIMEZONE || "Europe/Lisbon";
}

/** "17 Oct, 19:23" in the agency's timezone, for "numbers as of" and "updated" times. */
export function formatTimestamp(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(date);
}

// TZDate does the timezone math; callers get plain Dates (TZDate serializes with an offset).
function plain(start: Date, end: Date): Period {
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The 7 days up to `now`: what every report covers, so one built on a Sunday runs from last Sunday. */
export function lastSevenDays(now = new Date(), tz = reportTimezone()): Period {
  const end = new TZDate(now, tz);
  return plain(subDays(end, 7), end);
}

/** Reports build automatically each Sunday at 21:00 in the report timezone. */
const WEEKLY_RUN = { weekday: 0, hour: 21 };

/** Vercel crons are UTC and hour-precise, so the cron fires twice and this picks the right hour. */
export function isWeeklyRunHour(now = new Date(), tz = reportTimezone()) {
  const local = new TZDate(now, tz);
  return local.getDay() === WEEKLY_RUN.weekday && local.getHours() === WEEKLY_RUN.hour;
}

/** "Sundays at 21:00 Lisbon time" */
export function weeklyRunLabel(tz = reportTimezone()) {
  const day = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][WEEKLY_RUN.weekday];
  const city = tz === "UTC" ? "UTC" : `${tz.split("/").pop()!.replace(/_/g, " ")} time`;
  return `${day} at ${String(WEEKLY_RUN.hour).padStart(2, "0")}:00 ${city}`;
}

/** The calendar date of `date` in the report timezone, as YYYY-MM-DD. */
export function localDate(date: Date, tz = reportTimezone()) {
  return format(new TZDate(date, tz), "yyyy-MM-dd");
}

/** True for a report covering seven days: every report, including the midnight-to-midnight weeks built before. */
export function isWeekReport({ start, end }: Period, tz = reportTimezone()) {
  return addDays(new TZDate(start, tz), 7).getTime() === end.getTime();
}

function startsAtMidnight({ start }: Period, tz: string) {
  const local = new TZDate(start, tz);
  return (
    local.getHours() === 0 && local.getMinutes() === 0 && local.getSeconds() === 0 && local.getMilliseconds() === 0
  );
}

/** A report built the current way: the 7 days up to when it was built, not a midnight-to-midnight week. */
export function isRollingWeek(period: Period, tz = reportTimezone()) {
  return isWeekReport(period, tz) && !startsAtMidnight(period, tz);
}

/**
 * The week a report belongs to, named by the Sunday it ends on (YYYY-MM-DD): the first Sunday on
 * or after its last day. The Sunday run's report and an older Monday-to-Monday week share one.
 */
export function reportWeek({ end }: Period, tz = reportTimezone()): string {
  const last = new TZDate(end.getTime() - 1, tz);
  return format(addDays(last, (7 + WEEKLY_RUN.weekday - last.getDay()) % 7), "yyyy-MM-dd");
}

/** The week `weeks` weeks after (or, negative, before) `week`. */
export function shiftWeek(week: string, weeks: number): string {
  return format(addDays(parseISO(week), 7 * weeks), "yyyy-MM-dd");
}

/** Stand-in dates for a week with no report: the 7 days up to its Sunday run. */
export function weekPeriod(week: string, tz = reportTimezone()): Period {
  const [year, month, day] = week.split("-").map(Number);
  const end = new TZDate(year, month - 1, day, WEEKLY_RUN.hour, 0, tz);
  return plain(subDays(end, 7), end);
}

function parts(date: Date, tz: string) {
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => values.find((part) => part.type === type)?.value ?? "";
  return { weekday: get("weekday"), day: get("day"), month: get("month"), year: get("year") };
}

/** "Sun 11 Oct to Sun 18 Oct 2026" (the start year only shows when it differs). */
export function formatPeriod({ start, end }: Period, tz = reportTimezone()): string {
  const a = parts(start, tz);
  const b = parts(end, tz);
  const from = `${a.weekday} ${a.day} ${a.month}${a.year !== b.year ? ` ${a.year}` : ""}`;
  return `${from} to ${b.weekday} ${b.day} ${b.month} ${b.year}`;
}

/** When the weekly run built a Monday-to-Monday week: its last Sunday, 21:00 local. */
function oldWeeklyRunAt({ end }: Period, tz: string): Date {
  const run = subDays(new TZDate(end, tz), 1);
  run.setHours(WEEKLY_RUN.hour, 0, 0, 0);
  return new Date(run.getTime());
}

/**
 * The numbers only cover part of the period: the report was built before it ended (only
 * possible for weeks from before reports covered the 7 days up to when they're built). A
 * Monday-to-Monday week counts as complete from its last Sunday's 21:00 run, the report
 * clients got back then.
 */
export function isPartial(period: Period, generatedAt: Date, tz = reportTimezone()) {
  const mondayWeek =
    isWeekReport(period, tz) && startsAtMidnight(period, tz) && new TZDate(period.start, tz).getDay() === 1;
  const complete = mondayWeek ? oldWeeklyRunAt(period, tz) : period.end;
  return generatedAt.getTime() < complete.getTime();
}

/** "12 Oct" */
export function dayMonth(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(date);
}

/** "11–18 Oct" or "27 Sep – 4 Oct": the days a period covers, inclusive. */
export function shortRange({ start, end }: Period, tz = reportTimezone()): string {
  const last = new Date(end.getTime() - 1);
  const a = parts(start, tz);
  const b = parts(last, tz);
  return a.month === b.month ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

export function weekdayShort(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(date);
}

export function weekdayLong(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(date);
}
