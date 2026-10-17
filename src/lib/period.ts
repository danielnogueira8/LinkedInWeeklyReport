import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay, startOfWeek, subDays } from "date-fns";

export type Period = { start: Date; end: Date };

export function reportTimezone(): string {
  return process.env.REPORT_TIMEZONE || "UTC";
}

/** Monday 00:00 of the week containing `date`, in the report timezone. */
function mondayOf(date: Date, tz: string): TZDate {
  return startOfWeek(new TZDate(date, tz), { weekStartsOn: 1 });
}

// TZDate does the timezone math; callers get plain Dates (TZDate serializes with an offset).
function plain(start: Date, end: Date): Period {
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The last complete Monday-to-Monday week before `now`. */
export function lastFullWeek(now = new Date(), tz = reportTimezone()): Period {
  const end = mondayOf(now, tz);
  return plain(subDays(end, 7), end);
}

/** The Monday-to-Monday week containing `now`. */
export function currentWeek(now = new Date(), tz = reportTimezone()): Period {
  const start = mondayOf(now, tz);
  return plain(start, addDays(start, 7));
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
  const thisMonday = mondayOf(now, tz);
  const options: PeriodOption[] = [{ value: "last7", label: "Last 7 days" }];
  for (let i = 0; i <= weeks; i++) {
    const start = subDays(thisMonday, 7 * i);
    const prefix = i === 0 ? "This week" : i === 1 ? "Last week" : null;
    const period = { start, end: addDays(start, 7) };
    const range = formatPeriod(period, tz);
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
  if (start.getDay() !== 1 || start > now) return null;
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

/** "Mon 6 Oct to Mon 13 Oct 2026" (the start year only shows when it differs). */
export function formatPeriod({ start, end }: Period, tz = reportTimezone()): string {
  const a = parts(start, tz);
  const b = parts(end, tz);
  const from = `${a.weekday} ${a.day} ${a.month}${a.year !== b.year ? ` ${a.year}` : ""}`;
  return `${from} to ${b.weekday} ${b.day} ${b.month} ${b.year}`;
}

export function weekdayShort(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(date);
}

export function weekdayLong(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(date);
}
