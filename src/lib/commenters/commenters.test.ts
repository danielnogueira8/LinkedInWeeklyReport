import { describe, expect, it } from "vitest";
import { commentersCsv, connectionLabel, fitLabel, parseView, viewStart, type Commenter } from "@/lib/commenters/list";

const person = (overrides: Partial<Commenter> = {}): Commenter => ({
  personId: "leanne-hatch",
  name: "Leanne Hatch",
  headline: "Director at LMH Accounts Ltd",
  profileUrl: "https://www.linkedin.com/in/leanne-hatch",
  networkDistance: "DISTANCE_3",
  comments: 2,
  posts: 2,
  firstAt: new Date("2026-10-14T09:00:00Z"),
  lastAt: new Date("2026-10-18T23:30:00Z"),
  latestComment: "Xero",
  hooks: ["I built a 13-week cash flow", "Opus 5.5 for UK Accountants"],
  creators: ["Clare Thompson", "Damon Millar"],
  fit: "fit",
  pct: 93,
  confidence: 79,
  ...overrides,
});

describe("commenter lists", () => {
  it("covers posts published in the last 7 days, or every post", () => {
    const now = new Date("2026-10-20T21:00:00Z");
    expect(parseView("all")).toBe("all");
    expect(parseView(undefined)).toBe("week");
    expect(parseView(["all"])).toBe("week");
    expect(viewStart("week", now)?.toISOString()).toBe("2026-10-13T21:00:00.000Z");
    expect(viewStart("all", now)).toBeNull();
  });

  it("names the labels the way the page and the CSV show them", () => {
    expect([fitLabel("fit"), fitLabel("adjacent"), fitLabel("not"), fitLabel(null)]).toEqual([
      "Fit",
      "Adjacent",
      "Not a fit",
      "Not scored",
    ]);
    expect([connectionLabel("DISTANCE_1"), connectionLabel("DISTANCE_2"), connectionLabel(null)]).toEqual([
      "1st",
      "2nd",
      "",
    ]);
  });

  it("writes a CSV Excel opens cleanly, dated in the report timezone", () => {
    const csv = commentersCsv(
      [
        person(),
        person({
          personId: "x",
          name: 'Sam "the CFO" Lee',
          headline: "CFO, Group Finance",
          latestComment: '=HYPERLINK("https://example.com")\nthanks',
          fit: null,
          pct: null,
          confidence: null,
          networkDistance: null,
          hooks: [],
          creators: ["Damon Millar"],
        }),
      ],
      "Europe/Lisbon",
    );
    expect(csv.startsWith(`${String.fromCharCode(0xfeff)}Name,LinkedIn,Headline,ICP fit,ICP match %,`)).toBe(true);
    const [, first, second] = csv.slice(1).split("\r\n");
    // 23:30 UTC on the 18th is already the 19th in Lisbon (UTC+1).
    expect(first).toBe(
      'Leanne Hatch,https://www.linkedin.com/in/leanne-hatch,Director at LMH Accounts Ltd,Fit,93,79,2,2,2026-10-19,2026-10-14,Xero,3rd,I built a 13-week cash flow | Opus 5.5 for UK Accountants,"Clare Thompson, Damon Millar"',
    );
    // Quotes doubled, commas and line breaks quoted, and a comment starting with = kept as text.
    expect(
      second.startsWith(
        '"Sam ""the CFO"" Lee",https://www.linkedin.com/in/leanne-hatch,"CFO, Group Finance",Not scored,,,',
      ),
    ).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.com"")\nthanks"`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
