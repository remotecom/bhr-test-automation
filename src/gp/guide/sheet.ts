/**
 * Convert between the testing-guide spreadsheet and data/gp-guide/guide.json.
 *
 * Works on plain grids (rows of cell strings) so it is easy to unit-test; src/gp/guide/xlsx.ts
 * does the .xlsx reading and writing around it.
 *
 * Import rules:
 *   - Test-case tabs are found by their sheet name (GUIDE_TABS) and read by header name, so
 *     column order doesn't matter and unknown columns are ignored.
 *   - Any other tab (e.g. "Known Issues (internal)") is ignored: it never enters the repo.
 *   - Text naming internal tickets or tracker links is refused (see findInternalRefs).
 */

import {
  CASE_COLUMNS,
  GUIDE_METHODS,
  GUIDE_STATUSES,
  GUIDE_TABS,
  type CoverageRow,
  type Guide,
  type GuideCase,
  type GuideMethod,
  type GuideOverviewRow,
  type GuideStatus,
} from "./types";

export type Grid = string[][];

/** A cell as text: numbers without a trailing ".0", dates as YYYY-MM-DD, everything trimmed */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "result" in o) {
      if (o.result != null) return cellText(o.result);
      // No cached value (files saved by some tools): a HYPERLINK's text is still readable
      const link = typeof o.formula === "string" ? o.formula.match(/HYPERLINK\(\s*"[^"]*"\s*[,;]\s*"([^"]*)"/i) : null;
      return link ? link[1].trim() : "";
    }
    if ("text" in o) return cellText(o.text); // hyperlink
    if (Array.isArray(o.richText)) return o.richText.map((p) => (p as { text?: string }).text ?? "").join("").trim();
  }
  return String(v).replace(/^(\d+)\.0$/, "$1").trim();
}

/** Internal references that must never reach the partner-facing guide */
const INTERNAL_PATTERNS: [RegExp, string][] = [
  [/\b(PBYR|TASA|PBR)-\d+\b/, "Linear ticket ID"],
  [/linear\.app/i, "Linear link"],
  [/\bMR\s*!?\d{4,}\b|![0-9]{5,}\b/, "merge request number"],
];

export function findInternalRefs(guide: Guide): string[] {
  const hits: string[] = [];
  const scan = (where: string, text: string | undefined) => {
    if (!text) return;
    for (const [re, what] of INTERNAL_PATTERNS) if (re.test(text)) hits.push(`${where}: ${what} in "${text.slice(0, 80)}"`);
  };
  scan("subtitle", guide.subtitle);
  for (const r of guide.overview) scan(`Overview ${r.label}`, `${r.value} ${r.url ?? ""}`);
  for (const c of guide.cases) for (const k of ["scenario", "input", "expected", "response", "notes", "comments"] as const) scan(`${c.id} ${k}`, c[k]);
  for (const r of guide.coverage.rows) scan(`Coverage ${r.measure}`, `${r.countries} ${r.notes}`);
  return hits;
}

const isStatus = (s: string): s is GuideStatus => (GUIDE_STATUSES as readonly string[]).includes(s);
const METHOD_BY_LABEL = Object.fromEntries(Object.entries(GUIDE_METHODS).map(([k, v]) => [v.toLowerCase(), k as GuideMethod]));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function readCases(tab: (typeof GUIDE_TABS)[number], grid: Grid, problems: string[]): GuideCase[] {
  const headerRow = grid.findIndex((r) => r.some((c) => c === "Test Case #"));
  if (headerRow < 0) {
    problems.push(`${tab.title}: no "Test Case #" header`);
    return [];
  }
  const header = grid[headerRow];
  const col = (name: string) => header.indexOf(name);
  const get = (row: string[], name: string) => (col(name) >= 0 ? row[col(name)] ?? "" : "");
  const cases: GuideCase[] = [];
  for (const row of grid.slice(headerRow + 1)) {
    const id = get(row, "Test Case #");
    if (!id) continue;
    const status = get(row, "Status");
    if (!isStatus(status)) problems.push(`${id}: unknown status "${status}"`);
    const checked = get(row, "Last checked");
    if (checked && !isDate(checked)) problems.push(`${id}: "Last checked" should be YYYY-MM-DD, got "${checked}"`);
    const methodLabel = get(row, "How tested").toLowerCase();
    const method = METHOD_BY_LABEL[methodLabel] ?? (methodLabel in GUIDE_METHODS ? (methodLabel as GuideMethod) : undefined);
    if (methodLabel && !method) problems.push(`${id}: unknown "How tested" value "${get(row, "How tested")}"`);
    cases.push({
      id,
      tab: tab.key,
      scenario: get(row, "Scenario"),
      input: get(row, "Input Data"),
      expected: get(row, "Expected Outcome"),
      response: get(row, "Remote Response/Error Message"),
      notes: get(row, "Blocking Logic/Notes"),
      status: isStatus(status) ? status : "Untested",
      comments: get(row, "Comments"),
      ...(checked && isDate(checked) ? { lastChecked: checked } : {}),
      ...(method ? { method } : {}),
    });
  }
  return cases;
}

function readOverview(grid: Grid, links: Record<string, string>): Pick<Guide, "title" | "subtitle" | "overview" | "statusLegend"> {
  const rows = grid.filter((r) => r.some(Boolean));
  const title = rows[0]?.[0] ?? "";
  const subtitle = rows[1]?.[0] ?? "";
  const overview: GuideOverviewRow[] = [];
  const statusLegend: { status: string; meaning: string }[] = [];
  let section: "pairs" | "legend" | "tabs" = "pairs";
  for (const [label, value] of rows.slice(2)) {
    if (label === "Status" && value === "Meaning") {
      section = "legend";
      continue;
    }
    if (label === "Tab" && value === "Contents") {
      section = "tabs"; // regenerated on export, from GUIDE_TABS
      continue;
    }
    if (section === "pairs" && label) overview.push({ label, value: value ?? "", ...(links[label] ? { url: links[label] } : {}) });
    if (section === "legend" && label) statusLegend.push({ status: label, meaning: value ?? "" });
  }
  return { title, subtitle, overview, statusLegend };
}

function readCoverage(grid: Grid): Guide["coverage"] {
  const rows = grid.filter((r) => r.some(Boolean));
  const headerAt = rows.findIndex((r) => r[0] === "Measure");
  const out: CoverageRow[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    if (!r[0]) continue;
    const n = Number(r[1]);
    out.push({ measure: r[0], ...(r[1] !== "" && Number.isFinite(n) ? { count: n } : {}), countries: r[2] ?? "", notes: r[3] ?? "" });
  }
  return { title: rows[0]?.[0] ?? "", intro: headerAt > 1 ? rows[1][0] : "", rows: out };
}

/**
 * Build the guide from sheet grids keyed by tab name. `links` maps Overview labels to URLs
 * (hyperlink cells). Returns problems instead of throwing, so the caller can show them all.
 */
export function guideFromSheets(sheets: Record<string, Grid>, links: Record<string, string> = {}): { guide: Guide; problems: string[] } {
  const problems: string[] = [];
  const overview = sheets["Overview"] ? readOverview(sheets["Overview"], links) : { title: "", subtitle: "", overview: [], statusLegend: [] };
  if (!sheets["Overview"]) problems.push("No Overview tab");
  const cases = GUIDE_TABS.flatMap((tab) => {
    if (!sheets[tab.title]) {
      problems.push(`No "${tab.title}" tab`);
      return [];
    }
    return readCases(tab, sheets[tab.title], problems);
  });
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`${c.id} appears twice`);
    ids.add(c.id);
  }
  const coverage = sheets["Country Coverage"] ? readCoverage(sheets["Country Coverage"]) : { title: "", intro: "", rows: [] };
  const guide: Guide = { ...overview, cases, coverage };
  problems.push(...findInternalRefs(guide).map((h) => `Internal reference (remove before importing): ${h}`));
  return { guide, problems };
}

/** Grid for one test-case tab, header first, in CASE_COLUMNS order */
export function caseGrid(cases: GuideCase[]): Grid {
  return [
    [...CASE_COLUMNS],
    ...cases.map((c) => [
      c.id, c.scenario, c.input, c.expected, c.response, c.notes, c.status, c.comments,
      c.lastChecked ?? "", c.method ? GUIDE_METHODS[c.method] : "",
    ]),
  ];
}
