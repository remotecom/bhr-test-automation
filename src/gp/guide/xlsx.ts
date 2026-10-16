/**
 * Read and write the testing guide as .xlsx (server/CLI only: uses exceljs).
 *
 * The written workbook mirrors the original Google Sheet so it can be uploaded over it
 * (File > Import > Replace spreadsheet): same tab names and columns, the Status dropdown and
 * its colours, navy headers, frozen ID/scenario columns. It has no internal tab.
 */

import ExcelJS from "exceljs";
import { caseGrid, cellText, guideFromSheets, type Grid } from "./sheet";
import { GUIDE_STATUSES, GUIDE_TABS, type Guide } from "./types";
import type { GuideCheckResult } from "./checks";

/** Header of the extra column with automated results; the importer ignores it */
export const AUTOMATED_COLUMN = "Latest automated check (not imported)";
const OUTCOME_TEXT: Record<string, string> = {
  as_recorded: "Matches",
  differs: "DIFFERS",
  observed: "Observed (not recorded yet)",
  inconclusive: "Inconclusive",
  skipped: "Skipped",
  error: "Error",
};

const NAVY = "FF1F3863";
const STATUS_FILL: Record<string, string> = {
  Verified: "FFD9EAD2",
  "Known issue": "FFF4CCCC",
  "Fixed, re-verify": "FFFFF1CC",
  Untested: "FFE7E7E7",
  "Requires Remote": "FFCFE1F3",
};
const FONT = { name: "Arial", size: 10 };
const CASE_WIDTHS = [11, 28, 33, 30, 38, 35, 15, 33, 12, 18];

/** Read an .xlsx into the guide. Tabs the guide doesn't know (e.g. internal ones) are ignored. */
export async function readGuideXlsx(data: ArrayBuffer | Buffer): Promise<{ guide: Guide; problems: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const sheets: Record<string, Grid> = {};
  const links: Record<string, string> = {};
  wb.eachSheet((ws) => {
    const grid: Grid = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(ws.columnCount, 10); c++) {
        const cell = row.getCell(c);
        cells.push(cellText(cell.value));
        if (ws.name === "Overview" && c === 2) {
          const url = linkOf(cell.value);
          if (url) links[cellText(row.getCell(1).value)] = url;
        }
      }
      grid[r - 1] = cells;
    });
    sheets[ws.name] = Array.from(grid, (r) => r ?? []);
  });
  return guideFromSheets(sheets, links);
}

/** URL of a hyperlink cell, or of a =HYPERLINK("url","text") formula */
function linkOf(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.hyperlink === "string") return o.hyperlink;
  if (typeof o.formula === "string") return o.formula.match(/HYPERLINK\(\s*"([^"]+)"/i)?.[1];
  return undefined;
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
}

function styleBody(ws: ExcelJS.Worksheet, fromRow: number) {
  ws.eachRow((row, r) => {
    if (r < fromRow) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      const fill = cell.fill as ExcelJS.FillPattern | undefined;
      if (fill?.fgColor?.argb === NAVY) return; // header rows keep their style
      cell.font = { ...FONT, ...(cell.font?.bold ? { bold: true } : {}), ...(cell.font?.italic ? { italic: true, color: cell.font.color } : {}) };
      cell.alignment = { wrapText: true, vertical: "top" };
    });
  });
}

/**
 * Write the guide as .xlsx. `generatedNote` is added under the title on the Overview tab; `checks`
 * adds a column with each row's latest automated check.
 */
export async function writeGuideXlsx(guide: Guide, opts: { generatedNote?: string; checks?: GuideCheckResult[] } = {}): Promise<Buffer> {
  const { generatedNote } = opts;
  const checkById = new Map((opts.checks ?? []).map((c) => [c.caseId, c]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Remote API Test Lab";

  // Overview
  const ov = wb.addWorksheet("Overview");
  ov.columns = [{ width: 25 }, { width: 88 }];
  ov.addRow([guide.title]).font = { ...FONT, size: 14, bold: true };
  ov.addRow([guide.subtitle]);
  ov.addRow([]);
  for (const r of guide.overview) {
    const row = ov.addRow([r.label, r.url ? { text: r.value, hyperlink: r.url } : r.value]);
    row.getCell(1).font = { ...FONT, bold: true };
  }
  ov.addRow([]);
  styleHeader(ov.addRow(["Status", "Meaning"]));
  for (const s of guide.statusLegend) ov.addRow([s.status, s.meaning]);
  ov.addRow([]);
  styleHeader(ov.addRow(["Tab", "Contents"]));
  const contents: Record<string, string> = {
    Setup: "Integration settings, sandbox company, GP legal entity and server component",
    "GP Admin Onboarding": "Employer-side onboarding flow",
    "GP Employee Onboarding": "Employee self-onboarding flow",
    "Bank Details": "Reading and updating an employee's bank details, before and after activation",
    "Tokens & Auth": "Token types, scopes and token endpoint errors",
  };
  for (const t of GUIDE_TABS) ov.addRow([t.title, contents[t.title] ?? ""]);
  ov.addRow(["Country Coverage", "Which countries publish the GP onboarding forms"]);
  // Last, after the tab list: the importer ignores rows there
  if (generatedNote) {
    ov.addRow([]);
    ov.addRow([generatedNote]).font = { ...FONT, italic: true, color: { argb: "FF666666" } };
  }
  styleBody(ov, 2);
  ov.getCell("A1").font = { ...FONT, size: 14, bold: true };
  ov.mergeCells("A1:B1");
  ov.mergeCells("A2:B2");

  // Test-case tabs
  const statusList = `"${GUIDE_STATUSES.join(",")}"`;
  for (const tab of GUIDE_TABS) {
    const ws = wb.addWorksheet(tab.title, { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
    ws.columns = CASE_WIDTHS.map((width) => ({ width }));
    const cases = guide.cases.filter((c) => c.tab === tab.key);
    const grid = caseGrid(cases);
    if (checkById.size) {
      grid[0].push(AUTOMATED_COLUMN);
      cases.forEach((c, i) => {
        const r = checkById.get(c.id);
        grid[i + 1].push(r ? `${OUTCOME_TEXT[r.outcome] ?? r.outcome} (${r.checkedAt.slice(0, 10)}): ${r.summary}` : "");
      });
      ws.getColumn(11).width = 40;
    }
    grid.forEach((r) => ws.addRow(r));
    styleHeader(ws.getRow(1));
    styleBody(ws, 2);
    // One range rule (per-cell rules make exceljs write overlapping ranges)
    (ws as unknown as { dataValidations: { add: (ref: string, v: ExcelJS.DataValidation) => void } })
      .dataValidations.add("G2:G200", { type: "list", allowBlank: true, formulae: [statusList] });
    ws.addConditionalFormatting({
      ref: "G2:G200",
      rules: GUIDE_STATUSES.map((s, i) => ({
        type: "cellIs" as const,
        operator: "equal" as const,
        formulae: [`"${s}"`],
        priority: i + 1,
        style: { fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: STATUS_FILL[s] } } },
      })),
    });
  }

  // Country Coverage
  const cc = wb.addWorksheet("Country Coverage");
  cc.columns = [{ width: 41 }, { width: 10 }, { width: 48 }, { width: 43 }];
  cc.addRow([guide.coverage.title]).font = { ...FONT, size: 14, bold: true };
  cc.addRow([guide.coverage.intro]);
  cc.addRow([]);
  styleHeader(cc.addRow(["Measure", "Count", "Countries", "Notes"]));
  for (const r of guide.coverage.rows) cc.addRow([r.measure, r.count ?? null, r.countries, r.notes]);
  styleBody(cc, 2);
  cc.getCell("A1").font = { ...FONT, size: 14, bold: true };
  cc.mergeCells("A1:D1");
  cc.mergeCells("A2:D2");

  return Buffer.from(await wb.xlsx.writeBuffer());
}
