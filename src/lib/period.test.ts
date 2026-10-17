import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  currentWeek,
  formatPeriod,
  isPartial,
  isWeeklyRunHour,
  lastFullWeek,
  periodOptions,
  periodValue,
  resolvePeriod,
  weeklyRunLabel,
  weeklyRunAt,
} from "@/lib/period";

const saturday = new Date("2026-10-17T12:00:00Z");

describe("periods", () => {
  it("picks last Monday-to-Monday week in the report timezone", () => {
    const week = lastFullWeek(saturday, "Europe/London");
    // Midnight in London during BST is 23:00 UTC the day before.
    expect(week.start.toISOString()).toBe("2026-10-04T23:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-10-11T23:00:00.000Z");
    expect(formatPeriod(week, "Europe/London")).toBe("Mon 5 Oct to Mon 12 Oct 2026");
  });

  it("round-trips picker values", () => {
    const week = lastFullWeek(saturday, "Europe/London");
    const value = periodValue(week, "Europe/London");
    expect(value).toBe("week:2026-10-05");
    expect(resolvePeriod(value, saturday, "Europe/London")).toEqual(week);
    expect(periodOptions(saturday, "Europe/London").map((option) => option.value)).toContain(value);
  });

  it("rejects non-Mondays, future weeks and junk", () => {
    expect(resolvePeriod("week:2026-10-06", saturday, "UTC")).toBeNull();
    expect(resolvePeriod("week:2026-10-19", saturday, "UTC")).toBeNull();
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

  it("reports on the Monday-to-Monday week the Sunday run falls in", () => {
    const week = currentWeek(new Date("2026-10-18T20:05:00Z"), "Europe/Lisbon");
    expect(formatPeriod(week, "Europe/Lisbon")).toBe("Mon 12 Oct to Mon 19 Oct 2026");
    expect(resolvePeriod(periodValue(week, "Europe/Lisbon"), saturday, "Europe/Lisbon")).toEqual(week);
  });

  it("treats a week as partial until its Sunday 21:00 build", () => {
    const lisbon = "Europe/Lisbon";
    const week = currentWeek(saturday, lisbon);
    expect(weeklyRunAt(week, lisbon).toISOString()).toBe("2026-10-18T20:00:00.000Z");
    // Built on Saturday: partial, whenever you look at it.
    expect(isPartial(week, new Date("2026-10-17T18:48:00Z"), lisbon)).toBe(true);
    // The Sunday run (and anything after) is the full week.
    expect(isPartial(week, new Date("2026-10-18T20:00:04Z"), lisbon)).toBe(false);
    // The week Lisbon leaves summer time: its run is 21:00 UTC.
    const next = currentWeek(new Date("2026-10-21T12:00:00Z"), lisbon);
    expect(weeklyRunAt(next, lisbon).toISOString()).toBe("2026-10-25T21:00:00.000Z");
    // A rolling 7 days is complete once its end has passed.
    const rolling = resolvePeriod("last7", saturday, lisbon)!;
    expect(isPartial(rolling, rolling.end, lisbon)).toBe(false);
  });

  it("shows the start year when the week spans New Year", () => {
    expect(
      formatPeriod({ start: new Date("2025-12-29T00:00:00Z"), end: new Date("2026-01-05T00:00:00Z") }, "UTC"),
    ).toBe("Mon 29 Dec 2025 to Mon 5 Jan 2026");
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
