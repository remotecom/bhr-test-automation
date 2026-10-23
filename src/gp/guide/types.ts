/**
 * Types for the GP SDK testing guide (the partner-facing test cases shown on the Payroll tab).
 *
 * The guide itself lives in data/gp-guide/guide.json and is the source of truth. It round-trips
 * with the "Global Payroll SDK Testing Guide" spreadsheet: export with
 * `npm run gp:guide:export`, edit in Excel or Google Sheets, bring it back with `npm run gp:guide:import`.
 *
 * Partner-facing only: nothing internal (ticket IDs, internal tracking) belongs here.
 */

/** The sheet's Status dropdown, in its order */
export const GUIDE_STATUSES = ["Verified", "Known issue", "Fixed, re-verify", "Untested", "Requires Remote"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

/** Test-case tabs, in sheet order. `title` is the sheet tab name. */
export const GUIDE_TABS = [
  { key: "setup", title: "Setup", short: "Setup" },
  { key: "admin", title: "GP Admin Onboarding", short: "Admin onboarding" },
  { key: "employee", title: "GP Employee Onboarding", short: "Employee onboarding" },
  { key: "bank", title: "Bank Details", short: "Bank details" },
  { key: "tokens", title: "Tokens & Auth", short: "Tokens & auth" },
] as const;
export type GuideTabKey = (typeof GUIDE_TABS)[number]["key"];

/** How a case is tested (the "How tested" column) */
export const GUIDE_METHODS = {
  api: "API",
  sdk: "SDK, in the browser",
  sdk_source: "SDK source review",
  remote: "Confirmed by Remote",
  review: "Manual review",
} as const;
export type GuideMethod = keyof typeof GUIDE_METHODS;

/** Columns of a test-case tab: the sheet's eight, then the two the app adds */
export const CASE_COLUMNS = [
  "Test Case #",
  "Scenario",
  "Input Data",
  "Expected Outcome",
  "Remote Response/Error Message",
  "Blocking Logic/Notes",
  "Status",
  "Comments",
  "Last checked",
  "How tested",
] as const;

export interface GuideCase {
  id: string;
  tab: GuideTabKey;
  scenario: string;
  input: string;
  expected: string;
  /** What Remote actually returns (the recorded evidence) */
  response: string;
  notes: string;
  status: GuideStatus;
  comments: string;
  /** YYYY-MM-DD the recorded evidence is from */
  lastChecked?: string;
  method?: GuideMethod;
}

export interface GuideOverviewRow {
  label: string;
  value: string;
  /** Set when the value is a link */
  url?: string;
}

export interface CoverageRow {
  measure: string;
  count?: number;
  countries: string;
  notes: string;
}

export interface Guide {
  title: string;
  /** The line under the title (draft status, last update) */
  subtitle: string;
  overview: GuideOverviewRow[];
  /** Status -> meaning, from the Overview tab */
  statusLegend: { status: string; meaning: string }[];
  cases: GuideCase[];
  coverage: { title: string; intro: string; rows: CoverageRow[] };
}
