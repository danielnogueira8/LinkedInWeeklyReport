import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  currentWeek,
  formatPeriod,
  isCalendarWeek,
  isPartial,
  isWeekReport,
  isWeeklyRunHour,
  lastFullWeek,
  periodOptions,
  periodValue,
  resolvePeriod,
  shortRange,
  weeklyRunLabel,
} from "@/lib/period";

const saturday = new Date("2026-10-17T12:00:00Z");
// Monday 12 to Monday 19 Oct in Lisbon: how weeks ran before they started on Sunday.
const oldWeek = { start: new Date("2026-10-11T23:00:00Z"), end: new Date("2026-10-18T23:00:00Z") };

describe("periods", () => {
  it("picks last Sunday-to-Sunday week in the report timezone", () => {
    const week = lastFullWeek(saturday, "Europe/London");
    // Midnight in London during BST is 23:00 UTC the day before.
    expect(week.start.toISOString()).toBe("2026-10-03T23:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-10-10T23:00:00.000Z");
    expect(formatPeriod(week, "Europe/London")).toBe("Sun 4 Oct to Sun 11 Oct 2026");
  });

  it("round-trips picker values", () => {
    const week = lastFullWeek(saturday, "Europe/London");
    const value = periodValue(week, "Europe/London");
    expect(value).toBe("week:2026-10-04");
    expect(resolvePeriod(value, saturday, "Europe/London")).toEqual(week);
    expect(periodOptions(saturday, "Europe/London").map((option) => option.value)).toContain(value);
  });

  it("rejects non-Sundays, future weeks and junk", () => {
    expect(resolvePeriod("week:2026-10-05", saturday, "UTC")).toBeNull();
    expect(resolvePeriod("week:2026-10-18", saturday, "UTC")).toBeNull();
    expect(resolvePeriod("nope", saturday, "UTC")).toBeNull();
  });

  it("supports a rolling seven days", () => {
    const period = resolvePeriod("last7", saturday, "UTC")!;
    expect(period.end.getTime() - period.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("runs the weekly build at Sunday 21:00 Lisbon time through daylight saving", () => {
    const lisbon = "Europe/Lisbon";
    // Summer time (UTC+1): the 20:00 UTC cron is the one that lands at 21:xx.
    expect(isWeeklyRunHour(new Date("2026-10-18T20:05:00Z"), lisbon)).toBe(true);
    expect(isWeeklyRunHour(new Date("2026-10-18T21:05:00Z"), lisbon)).toBe(false);
    // 25 Oct 2026 is the switch back to UTC+0, so it's the 21:00 UTC cron from then on.
    expect(isWeeklyRunHour(new Date("2026-10-25T20:59:00Z"), lisbon)).toBe(false);
    expect(isWeeklyRunHour(new Date("2026-10-25T21:59:00Z"), lisbon)).toBe(true);
    // Right hour, wrong day.
    expect(isWeeklyRunHour(new Date("2026-10-17T20:05:00Z"), lisbon)).toBe(false);
    expect(weeklyRunLabel(lisbon)).toBe("Sundays at 21:00 Lisbon time");
  });

  it("builds the Sunday-to-Sunday week that ended before the Sunday run", () => {
    const lisbon = "Europe/Lisbon";
    const week = lastFullWeek(new Date("2026-10-18T20:05:00Z"), lisbon);
    expect(formatPeriod(week, lisbon)).toBe("Sun 11 Oct to Sun 18 Oct 2026");
    expect(shortRange(week, lisbon)).toBe("11–17 Oct");
    // Until that Sunday, it's "this week" in the picker.
    expect(currentWeek(saturday, lisbon)).toEqual(week);
    expect(resolvePeriod(periodValue(week, lisbon), saturday, lisbon)).toEqual(week);
  });

  it("tells week reports, old Monday-to-Monday ones included, from a rolling 7 days", () => {
    const lisbon = "Europe/Lisbon";
    const week = currentWeek(saturday, lisbon);
    const rolling = resolvePeriod("last7", saturday, lisbon)!;
    expect([week, oldWeek, rolling].map((period) => isCalendarWeek(period, lisbon))).toEqual([true, false, false]);
    expect([week, oldWeek, rolling].map((period) => isWeekReport(period, lisbon))).toEqual([true, true, false]);
  });

  it("treats a week as partial until it ends", () => {
    const lisbon = "Europe/Lisbon";
    const week = currentWeek(saturday, lisbon);
    // Built on Saturday: partial, whenever you look at it.
    expect(isPartial(week, new Date("2026-10-17T18:48:00Z"), lisbon)).toBe(true);
    // From Sunday midnight (and so the Sunday run) it's the full week.
    expect(isPartial(week, week.end, lisbon)).toBe(false);
    // A rolling 7 days is complete once its end has passed.
    const rolling = resolvePeriod("last7", saturday, lisbon)!;
    expect(isPartial(rolling, rolling.end, lisbon)).toBe(false);
  });

  it("still counts an old Monday-to-Monday week as full from its Sunday 21:00 run", () => {
    const lisbon = "Europe/Lisbon";
    expect(isPartial(oldWeek, new Date("2026-10-18T19:59:00Z"), lisbon)).toBe(true);
    expect(isPartial(oldWeek, new Date("2026-10-18T20:00:04Z"), lisbon)).toBe(false);
    // The week Lisbon left summer time: its run was 21:00 UTC.
    const next = { start: oldWeek.end, end: new Date("2026-10-26T00:00:00Z") };
    expect(isPartial(next, new Date("2026-10-25T20:30:00Z"), lisbon)).toBe(true);
    expect(isPartial(next, new Date("2026-10-25T21:00:00Z"), lisbon)).toBe(false);
  });

  it("shows the start year when the week spans New Year", () => {
    expect(
      formatPeriod({ start: new Date("2025-12-28T00:00:00Z"), end: new Date("2026-01-04T00:00:00Z") }, "UTC"),
    ).toBe("Sun 28 Dec 2025 to Sun 4 Jan 2026");
  });
});

describe("api key encryption", () => {
  it("round-trips and detects tampering", () => {
    const sealed = encrypt("ls_live_secret");
    expect(sealed).not.toContain("ls_live_secret");
    expect(decrypt(sealed)).toBe("ls_live_secret");

    const [version, iv, tag, body] = sealed.split(".");
    const tampered = [version, iv, tag, `${body.slice(0, -2)}AA`].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });
});
