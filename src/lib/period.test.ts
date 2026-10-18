import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  formatPeriod,
  isPartial,
  isRollingWeek,
  isWeekReport,
  isWeeklyRunHour,
  lastSevenDays,
  reportWeek,
  shiftWeek,
  shortRange,
  weekPeriod,
  weeklyRunLabel,
} from "@/lib/period";

const lisbon = "Europe/Lisbon";
const saturday = new Date("2026-10-17T12:00:00Z");
// Monday 12 to Monday 19 Oct in Lisbon: how weeks ran before reports covered the last 7 days.
const oldWeek = { start: new Date("2026-10-11T23:00:00Z"), end: new Date("2026-10-18T23:00:00Z") };
// Sunday 11 to Sunday 18 Oct, midnight to midnight: the other old kind.
const sundayWeek = { start: new Date("2026-10-10T23:00:00Z"), end: new Date("2026-10-17T23:00:00Z") };

describe("periods", () => {
  it("covers the 7 days up to when the report is built: on a Sunday, from last Sunday", () => {
    // Sunday 18 Oct, 00:57 in Lisbon (UTC+1).
    const period = lastSevenDays(new Date("2026-10-17T23:57:00Z"), lisbon);
    expect(period.start.toISOString()).toBe("2026-10-10T23:57:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-17T23:57:00.000Z");
    expect(formatPeriod(period, lisbon)).toBe("Sun 11 Oct to Sun 18 Oct 2026");
    expect(shortRange(period, lisbon)).toBe("11–18 Oct");
  });

  it("keeps Sunday runs back to back through daylight saving", () => {
    const summer = lastSevenDays(new Date("2026-10-18T20:00:00Z"), lisbon);
    // 25 Oct: Lisbon is back on UTC+0, so its 21:00 is 21:00 UTC.
    const winter = lastSevenDays(new Date("2026-10-25T21:00:00Z"), lisbon);
    expect(winter.start).toEqual(summer.end);
    expect(weekPeriod("2026-10-18", lisbon)).toEqual(summer);
  });

  it("files every report under the Sunday its week ends on", () => {
    const builtAt = (iso: string) => lastSevenDays(new Date(iso), lisbon);
    // The Sunday run, an earlier build that Sunday and one on the Saturday: all the week of the 18th.
    expect(reportWeek(builtAt("2026-10-18T20:00:00Z"), lisbon)).toBe("2026-10-18");
    expect(reportWeek(builtAt("2026-10-17T23:57:00Z"), lisbon)).toBe("2026-10-18");
    expect(reportWeek(builtAt("2026-10-17T12:00:00Z"), lisbon)).toBe("2026-10-18");
    // A Monday build starts the next week.
    expect(reportWeek(builtAt("2026-10-19T09:00:00Z"), lisbon)).toBe("2026-10-25");
    // The old midnight-to-midnight weeks line up with them.
    expect(reportWeek(oldWeek, lisbon)).toBe("2026-10-18");
    expect(reportWeek(sundayWeek, lisbon)).toBe("2026-10-18");
    expect(shiftWeek("2026-10-18", -1)).toBe("2026-10-11");
    expect(shiftWeek("2026-12-27", 1)).toBe("2027-01-03");
  });

  it("tells reports built now from the midnight-to-midnight weeks before", () => {
    const rolling = lastSevenDays(saturday, lisbon);
    const sixDays = { start: oldWeek.start, end: sundayWeek.end };
    expect([rolling, oldWeek, sundayWeek, sixDays].map((p) => isWeekReport(p, lisbon))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect([rolling, oldWeek, sundayWeek].map((p) => isRollingWeek(p, lisbon))).toEqual([true, false, false]);
  });

  it("runs the weekly build at Sunday 21:00 Lisbon time through daylight saving", () => {
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

  it("never marks a report built now as partial, only old weeks built before they ended", () => {
    const rolling = lastSevenDays(saturday, lisbon);
    expect(isPartial(rolling, new Date(saturday.getTime() + 5000), lisbon)).toBe(false);
    expect(isPartial(sundayWeek, saturday, lisbon)).toBe(true);
    expect(isPartial(sundayWeek, sundayWeek.end, lisbon)).toBe(false);
  });

  it("still counts an old Monday-to-Monday week as full from its Sunday 21:00 run", () => {
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
