/**
 * Global Payroll (GP) capability baseline.
 *
 * The GP capability report probes the global_payroll_* JSON schema forms for
 * each country and compares what the API publishes today against this baseline.
 * A mismatch is reported as "drift". Drift is not necessarily a bug: it means
 * coverage changed since the baseline was written and someone should look.
 *
 * Sources (internal):
 *   - Remote API gaps analysis for Payroll Admin + Employee Self Onboarding
 *     (Tiger local DB, 2026-05-14): the 42 "full coverage" countries.
 *   - GP SDK test harness sandbox sweep (partners sandbox, 2026-09-30):
 *     57 countries publish contract details, 56 publish personal details.
 *     Edge cases below come from this sweep and override the May list.
 *   - Global Payroll SDK Testing Guide, Country Coverage tab.
 *
 * Update this file when a fresh sweep is accepted as the new truth.
 */

export type GPFormKey =
  | "basic_information"
  | "contract_details"
  | "administrative_details"
  | "personal_details"
  | "bank_account_details"
  | "federal_taxes";

export interface GPFormDef {
  key: GPFormKey;
  /** Form name as used by GET /v1/countries/{cc}/{form} */
  form: string;
  label: string;
  short: string;
  /** Which onboarding flow uses the form */
  side: "employer" | "employee";
  /** Only probe these countries (undefined = probe every country in scope) */
  onlyCountries?: string[];
}

/**
 * GP forms, in onboarding order. Always use the global_payroll_ prefix:
 * the unprefixed names (contract_details, administrative_details) return 200
 * with the EOR schema, which silently produces a wrong report.
 */
export const GP_FORMS: GPFormDef[] = [
  { key: "basic_information", form: "global_payroll_basic_information", label: "Basic information", short: "Basic", side: "employer" },
  { key: "contract_details", form: "global_payroll_contract_details", label: "Contract details", short: "Contract", side: "employer" },
  { key: "administrative_details", form: "global_payroll_administrative_details", label: "Administrative details", short: "Admin", side: "employer" },
  { key: "personal_details", form: "global_payroll_personal_details", label: "Personal details", short: "Personal", side: "employee" },
  { key: "bank_account_details", form: "global_payroll_bank_account_details", label: "Bank account details", short: "Bank", side: "employee" },
  { key: "federal_taxes", form: "global_payroll_federal_taxes", label: "Federal taxes (US)", short: "Tax", side: "employee", onlyCountries: ["USA"] },
];

/** Shown to partners in the tab and in exports, so keep internal system and ticket names out of it */
export const GP_BASELINE_SOURCE = "Remote GP coverage baseline, last updated 2026-09-30";

/** May 2026: countries with admin + contract + personal details forms */
export const GP_FULL_COVERAGE_MAY_2026: string[] = [
  // Americas
  "ARG", "BRA", "CAN", "CHL", "COL", "CRI", "MEX", "USA",
  // EMEA
  "BEL", "BGR", "DEU", "DNK", "ESP", "EST", "FIN", "FRA", "GBR", "GRC", "HUN",
  "IRL", "ITA", "LTU", "MAR", "NLD", "NOR", "POL", "PRT", "ROU", "SVK", "SWE",
  "TUR", "ZAF",
  // APAC
  "AUS", "CHN", "HKG", "IDN", "IND", "JPN", "SGP", "THA", "TWN", "VNM",
];

export interface GPCountryExpectation {
  contract_details?: boolean;
  personal_details?: boolean;
  /** Is `name` in the personal details required list? */
  nameRequired?: boolean;
  note?: string;
}

/** Sept 2026 sweep edge cases (these override the May list) */
const EDGE_CASES: Record<string, GPCountryExpectation> = {
  // Notes are shown to partners: no internal ticket, sheet or sales references
  HUN: { contract_details: true, personal_details: false, note: "Employer form only" },
  LVA: { contract_details: false, personal_details: false, note: "No GP forms: both return 422 'Form not available'" },
  KEN: { contract_details: false, personal_details: false, note: "No GP forms: both return 422 'Form not available'" },
  NGA: { contract_details: false, personal_details: false, note: "No GP forms: both return 422 'Form not available'" },
  PER: { contract_details: false, personal_details: false, note: "No GP forms: both return 422 'Form not available'" },
  URY: { contract_details: false, personal_details: false, note: "No GP forms: both return 422 'Form not available'" },
};

/** Countries where personal details does NOT require `name` (Testing Guide E2) */
export const GP_NAME_NOT_REQUIRED: string[] = ["ESP", "FRA", "IDN", "IRL", "ITA", "USA"];

/** Build the per-country expectation map */
function buildBaseline(): Record<string, GPCountryExpectation> {
  const out: Record<string, GPCountryExpectation> = {};
  for (const cc of GP_FULL_COVERAGE_MAY_2026) {
    out[cc] = {
      contract_details: true,
      personal_details: true,
      nameRequired: !GP_NAME_NOT_REQUIRED.includes(cc),
    };
  }
  for (const [cc, exp] of Object.entries(EDGE_CASES)) {
    out[cc] = { ...exp };
  }
  return out;
}

export const GP_BASELINE: Record<string, GPCountryExpectation> = buildBaseline();

export const GP_BASELINE_COUNTRIES: string[] = Object.keys(GP_BASELINE).sort();
