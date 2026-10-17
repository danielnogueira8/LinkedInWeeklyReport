import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay, startOfWeek, subDays } from "date-fns";

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

/** Weeks run Sunday 00:00 to Sunday 00:00 (Sunday to Saturday) in the report timezone. */
const WEEK_STARTS_ON = 0;
// Reports built before that ran Monday to Monday.
const OLD_WEEK_START = 1;

/** Sunday 00:00 of the week containing `date`, in the report timezone. */
function weekStartOf(date: Date, tz: string): TZDate {
  return startOfWeek(new TZDate(date, tz), { weekStartsOn: WEEK_STARTS_ON });
}

// TZDate does the timezone math; callers get plain Dates (TZDate serializes with an offset).
function plain(start: Date, end: Date): Period {
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The last complete Sunday-to-Sunday week before `now`. */
export function lastFullWeek(now = new Date(), tz = reportTimezone()): Period {
  const end = weekStartOf(now, tz);
  return plain(subDays(end, 7), end);
}

/** The Sunday-to-Sunday week containing `now`. */
export function currentWeek(now = new Date(), tz = reportTimezone()): Period {
  const start = weekStartOf(now, tz);
  return plain(start, addDays(start, 7));
}

/** Reports build automatically each Sunday at 21:00 in the report timezone, for the week that ended that midnight. */
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

export type PeriodOption = { value: string; label: string };

/** The calendar date of `date` in the report timezone, as YYYY-MM-DD. */
export function localDate(date: Date, tz = reportTimezone()) {
  return format(new TZDate(date, tz), "yyyy-MM-dd");
}

export function periodValue({ start }: Period, tz = reportTimezone()) {
  return `week:${localDate(start, tz)}`;
}

/** Choices for the "generate report" picker, most recent first. */
export function periodOptions(now = new Date(), tz = reportTimezone(), weeks = 8): PeriodOption[] {
  const thisWeek = weekStartOf(now, tz);
  const options: PeriodOption[] = [{ value: "last7", label: "Last 7 days" }];
  for (let i = 0; i <= weeks; i++) {
    const start = subDays(thisWeek, 7 * i);
    const prefix = i === 0 ? "This week" : i === 1 ? "Last week" : null;
    const period = { start, end: addDays(start, 7) };
    const range = shortRange(period, tz);
    options.push({ value: periodValue(period, tz), label: prefix ? `${prefix} · ${range}` : range });
  }
  return options;
}

export function resolvePeriod(value: string, now = new Date(), tz = reportTimezone()): Period | null {
  if (value === "last7") {
    const end = new TZDate(now, tz);
    return plain(subDays(end, 7), end);
  }
  const match = value.match(/^week:(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const start = startOfDay(new TZDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]), tz));
  if (start.getDay() !== WEEK_STARTS_ON || start > now) return null;
  return plain(start, addDays(start, 7));
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
 * The numbers only cover part of the period: the report was built before it ended. A
 * Monday-to-Monday week counts as complete from its last Sunday's 21:00 run, the report
 * clients got back then.
 */
export function isPartial(period: Period, generatedAt: Date, tz = reportTimezone()) {
  const complete = weekStartingOn(OLD_WEEK_START, period, tz) ? oldWeeklyRunAt(period, tz) : period.end;
  return generatedAt.getTime() < complete.getTime();
}

function weekStartingOn(weekday: number, { start, end }: Period, tz: string) {
  const local = new TZDate(start, tz);
  return (
    local.getDay() === weekday &&
    local.getHours() === 0 &&
    local.getMinutes() === 0 &&
    addDays(local, 7).getTime() === end.getTime()
  );
}

/** True for Sunday-00:00-to-Sunday weeks (not the rolling "last 7 days" kind). */
export function isCalendarWeek(period: Period, tz = reportTimezone()) {
  return weekStartingOn(WEEK_STARTS_ON, period, tz);
}

/** A week's report: a calendar week, or a Monday-to-Monday one built before weeks started on Sunday. */
export function isWeekReport(period: Period, tz = reportTimezone()) {
  return isCalendarWeek(period, tz) || weekStartingOn(OLD_WEEK_START, period, tz);
}

/** "12 Oct" */
export function dayMonth(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(date);
}

/** "11–17 Oct" or "27 Sep – 3 Oct": the days a period covers, inclusive. */
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
