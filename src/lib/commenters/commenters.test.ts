import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  commentersCsv,
  commentersXlsx,
  connectionLabel,
  fitLabel,
  parseView,
  viewStart,
  type Commenter,
} from "@/lib/commenters/list";
import { crc32 } from "@/lib/commenters/xlsx";

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

/** The files in a zip, inflated: enough of a reader to check what the writer made. */
function unzip(data: Buffer) {
  const files = new Map<string, string>();
  for (let at = 0; data.readUInt32LE(at) === 0x04034b50; ) {
    const size = data.readUInt32LE(at + 18);
    const nameLength = data.readUInt16LE(at + 26);
    const name = data.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + data.readUInt16LE(at + 28);
    const content = inflateRawSync(data.subarray(start, start + size));
    expect(crc32(content)).toBe(data.readUInt32LE(at + 14));
    files.set(name, content.toString("utf8"));
    at = start + size;
  }
  return files;
}

describe("Excel export", () => {
  it("checksums the way zip readers expect", () => {
    expect(crc32(Buffer.from("123456789")).toString(16)).toBe("cbf43926");
  });

  it("colours each row by ICP label and keeps links clickable", () => {
    const files = unzip(
      commentersXlsx(
        [
          person(),
          person({ personId: "b", name: "Billy <Harding> & co", fit: "adjacent", pct: 75 }),
          person({ personId: "c", fit: "not", pct: 0, latestComment: "bell\u0007 rings" }),
          person({ personId: "d", fit: null, pct: null, confidence: null }),
        ],
        "Europe/Lisbon",
      ),
    );
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    const styles = files.get("xl/styles.xml")!;
    // Fill 3 is green (fit), 4 yellow (adjacent), 5 grey (not a fit); styles 2, 3 and 4 use them.
    expect(styles).toContain('<fills count="6">');
    expect(styles.indexOf("FFC6EFCE")).toBeLessThan(styles.indexOf("FFFFEB9C"));
    expect(styles).toContain('<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>');
    const rowStyles = [...sheet.matchAll(/<row r="(\d+)"( s="(\d+)")?/g)].map((match) => match[3] ?? "none");
    expect(rowStyles).toEqual(["none", "2", "3", "4", "none"]);
    // The header row is bold and frozen, with filters over everything.
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:N5"/>');
    expect(files.get("xl/workbook.xml")).toContain("'Commenters'!$A$1:$N$5");
    expect(sheet).toContain(
      '<c r="B2" s="2" t="str"><f>HYPERLINK(&quot;https://www.linkedin.com/in/leanne-hatch&quot;)</f><v>https://www.linkedin.com/in/leanne-hatch</v></c>',
    );
    expect(sheet).toContain('<c r="E3" s="3"><v>75</v></c>');
    expect(sheet).toContain("Billy &lt;Harding&gt; &amp; co");
    // A control character would make the file unreadable: it's dropped.
    expect(sheet).toContain(">bell rings<");
    // Not scored: no colour, and no match % cell.
    expect(sheet).not.toContain('r="E5"');
  });
});
