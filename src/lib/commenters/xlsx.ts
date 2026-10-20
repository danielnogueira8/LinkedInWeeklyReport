import { deflateRawSync } from "node:zlib";

// A one-sheet .xlsx writer: just what the commenter export needs (text, numbers, links,
// column widths, a frozen header row with filters, and a fill colour per row). An .xlsx is a
// zip of a few XML files; Node's zlib does the compressing.

/** A cell: text, a number, empty, or a link that shows its URL and opens it when clicked. */
export type XlsxCell = string | number | null | { link: string };

export type XlsxSheet = {
  name: string;
  columns: Array<{ header: string; width: number }>;
  /** `fill` colours the whole row: an RGB hex colour such as "C6EFCE". */
  rows: Array<{ cells: XlsxCell[]; fill?: string }>;
};

// The most text Excel keeps in a cell, and the longest text its HYPERLINK formula takes.
const MAX_TEXT = 32_767;
const MAX_LINK = 255;
const HEADER_FILL = "D9D9D9";

/** XML-escaped, without the characters XML can't hold (control characters, lone surrogates). */
function escapeXml(text: string) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "A", "B", ... "Z", "AA": the column's letters. */
function columnName(index: number): string {
  return (index >= 26 ? columnName(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));
}

function cellXml(ref: string, value: XlsxCell, style: number) {
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === "") return style ? `<c r="${ref}"${s}/>` : "";
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : "";
  if (typeof value === "object") {
    const url = value.link.slice(0, MAX_LINK);
    const formula = `HYPERLINK("${url.replace(/"/g, '""')}")`;
    return `<c r="${ref}"${s} t="str"><f>${escapeXml(formula)}</f><v>${escapeXml(url)}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value.slice(0, MAX_TEXT))}</t></is></c>`;
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

function stylesXml(fills: string[]) {
  const solid = (rgb: string) =>
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  // Fill 0 and 1 are required placeholders; 2 is the header's; then one per row colour.
  const fillXml = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
    solid(HEADER_FILL),
    ...fills.map(solid),
  ];
  // Style 1 is the header (bold, grey); style 2 + n is row colour n.
  const xfs = [
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`,
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`,
    ...fills.map(
      (_, index) => `<xf numFmtId="0" fontId="0" fillId="${index + 3}" borderId="0" xfId="0" applyFill="1"/>`,
    ),
  ];
  return `${XML}<styleSheet xmlns="${MAIN}">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="${fillXml.length}">${fillXml.join("")}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function sheetXml(sheet: XlsxSheet, styleOf: (fill?: string) => number) {
  const lastColumn = columnName(Math.max(sheet.columns.length, 1) - 1);
  const range = `A1:${lastColumn}${sheet.rows.length + 1}`;
  const header = `<row r="1">${sheet.columns.map((column, index) => cellXml(`${columnName(index)}1`, column.header, 1)).join("")}</row>`;
  const rows = sheet.rows.map((row, rowIndex) => {
    const r = rowIndex + 2;
    const style = styleOf(row.fill);
    const cells = sheet.columns.map((_, index) => cellXml(`${columnName(index)}${r}`, row.cells[index] ?? null, style));
    // A row style colours the cells past the last column too, the way a row fill does in Excel.
    return `<row r="${r}"${style ? ` s="${style}" customFormat="1"` : ""}>${cells.join("")}</row>`;
  });
  return `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">
<dimension ref="${range}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${sheet.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${header}${rows.join("")}</sheetData>
<autoFilter ref="${range}"/>
</worksheet>`;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of deflated files (no folders, no comments, dated 1 Jan 1980). */
function zip(files: Array<{ name: string; data: Buffer }>) {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const packed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(8, 10); // deflate
    entry.writeUInt16LE(0x21, 14); // 1980-01-01
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

/** The sheet as an .xlsx file. */
export function xlsx(sheet: XlsxSheet): Buffer {
  const fills = [...new Set(sheet.rows.flatMap((row) => (row.fill ? [row.fill.toUpperCase()] : [])))];
  const styleOf = (fill?: string) => (fill ? fills.indexOf(fill.toUpperCase()) + 2 : 0);
  // Sheet names: at most 31 characters, none of []:*?/\.
  const name = sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1";
  const lastColumn = columnName(Math.max(sheet.columns.length, 1) - 1);
  const filterRange = `'${name.replace(/'/g, "''")}'!$A$1:$${lastColumn}$${sheet.rows.length + 1}`;

  const file = (path: string, text: string) => ({ name: path, data: Buffer.from(text, "utf8") });
  return zip([
    file(
      "[Content_Types].xml",
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    ),
    file(
      "_rels/.rels",
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    ),
    file(
      "xl/workbook.xml",
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">
<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${escapeXml(filterRange)}</definedName></definedNames>
</workbook>`,
    ),
    file(
      "xl/_rels/workbook.xml.rels",
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/>
</Relationships>`,
    ),
    file("xl/styles.xml", stylesXml(fills)),
    file("xl/worksheets/sheet1.xml", sheetXml(sheet, styleOf)),
  ]);
}
