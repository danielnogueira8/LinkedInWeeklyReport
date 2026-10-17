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

/** The period hasn't finished yet (e.g. this week's report before Sunday night is over). */
export function isInProgress({ end }: Period) {
  return end.getTime() > Date.now();
}

/** True for Monday-00:00-to-Monday reports (not the rolling "last 7 days" kind). */
export function isCalendarWeek({ start, end }: Period, tz = reportTimezone()) {
  const local = new TZDate(start, tz);
  return (
    local.getDay() === 1 &&
    local.getHours() === 0 &&
    local.getMinutes() === 0 &&
    addDays(local, 7).getTime() === end.getTime()
  );
}

/** "12 Oct" */
export function dayMonth(date: Date, tz = reportTimezone()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(date);
}

/** "12–18 Oct" or "28 Sep – 4 Oct": the days a period covers, inclusive. */
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
