import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import { formatPeriod, lastFullWeek, periodOptions, periodValue, resolvePeriod } from "@/lib/period";

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
