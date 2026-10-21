/**
 * Types for the Global Payroll (GP) capability report.
 */

import type { GPFormKey } from "../../data/gp-capability-baseline";

export type { GPFormKey };

/**
 * available           = 200 with a schema
 * requires_employment = 400 "missing required query parameter: employment_id". The form is published
 *                       for the country (unsupported countries get 422 first), but its schema can only
 *                       be read for an employee in that country. Counts as published. The report also
 *                       checks it against GET /v1/countries (confirmAgainstCatalog).
 * unavailable         = 404/422 "Form not available"
 * error               = anything else
 */
export type ProbeStatus = "available" | "requires_employment" | "unavailable" | "error" | "skipped";

export const isPublished = (s?: ProbeStatus) => s === "available" || s === "requires_employment";

export interface SchemaAnalysis {
  /** Top-level property count */
  fieldCount: number;
  /** Top-level `required` list */
  requiredFields: string[];
  /** Fields presented as hidden (x-jsf-presentation.inputType === "hidden"), dotted paths */
  hiddenFields: string[];
  /** Fields only required by an `if: false` rule (never applies under JSON Schema, but the backend may still enforce it) */
  inertRequired: string[];
  /** Fields required by a live if/then rule */
  conditionalRequired: string[];
}

export interface FormProbe {
  form: string;
  status: ProbeStatus;
  httpStatus?: number;
  message?: string;
  analysis?: SchemaAnalysis;
  durationMs?: number;
  /** Set when the form was fetched for a specific test employee (?employment_id=) */
  employmentId?: string;
}

export type GPCoverage = "full" | "employer_only" | "employee_only" | "none" | "unknown";

export type EntityStatus = "gp_enabled" | "entity_no_gp" | "none" | "unknown";

export interface GPEntitySummary {
  id: string;
  name: string;
  countryCode: string;
  gpEnabled: boolean;
  status?: string;
}

export interface BaselineCheck {
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export type BaselineVerdict = "match" | "drift" | "no_baseline" | "error";

export interface CountryCapability {
  code: string;
  name: string;
  region?: string;
  forms: Partial<Record<GPFormKey, FormProbe>>;
  /** Derived from contract_details (employer) and personal_details (employee) */
  coverage: GPCoverage;
  /** Is `name` required in personal details? null when the form is unavailable */
  nameRequired: boolean | null;
  entity: { status: EntityStatus; entityIds: string[] };
  catalog: {
    inCatalog: boolean;
    eorOnboarding?: boolean;
    /** global_payroll_* names listed in the country's supported_json_schemas */
    gpSchemasAdvertised: string[];
    /** The country's global_payroll_supported flag in GET /v1/countries (reported since 9 Oct) */
    gpSupported?: boolean;
  };
  baseline: { verdict: BaselineVerdict; checks: BaselineCheck[]; note?: string };
  durationMs: number;
  /** Test employee the employment-specific forms were fetched for, if any */
  employmentId?: string;
  /** Results of submitting forms without their skipped fields (merged in from the browser for display/export) */
  fieldChecks?: FieldCheckResult[];
}

/**
 * Skipped-field check: submit an employer form to a test employee with its skipped fields left out.
 *   not_enforced     the API accepted it, so the skipped fields aren't required in practice
 *   enforced         the API rejected it and named one of the skipped fields
 *   inconclusive     the API rejected it for some other field (the test values, not the skipped fields)
 *   nothing_to_check this employee's version of the form has no skipped fields
 *   error            the check couldn't run (schema fetch failed, unexpected status, ...)
 */
export type FieldCheckOutcome = "not_enforced" | "enforced" | "inconclusive" | "nothing_to_check" | "error";

export interface FieldCheckResult {
  countryCode: string;
  form: GPFormKey;
  /** Skipped fields that were left out of the submission */
  skippedFields: string[];
  outcome: FieldCheckOutcome;
  /** Skipped fields the API named as required */
  enforcedFields: string[];
  /** Other fields the API rejected (why a check is inconclusive) */
  otherRejected: string[];
  /** Fields that were sent, filled with test values */
  sentFields: string[];
  httpStatus?: number;
  message?: string;
  requestId?: string;
  employmentId?: string;
  checkedAt: string;
  /** live: run from this app. recorded: a documented earlier result (see data/gp-field-checks.ts) */
  source: "live" | "recorded";
  sourceNote?: string;
}

export type GPScope = "baseline" | "all" | "custom";

export interface GPRunSummary {
  total: number;
  full: number;
  employerOnly: number;
  employeeOnly: number;
  none: number;
  errors: number;
  match: number;
  drift: number;
  noBaseline: number;
  gpEntityCountries: number;
  duration: number;
}

export interface GPRunReport {
  timestamp: string;
  gatewayEnv: string;
  companySlug?: string;
  scope: GPScope;
  baselineSource: string;
  /** True when any country's supported_json_schemas lists a global_payroll_* form */
  catalogAdvertisesGP: boolean;
  entities: GPEntitySummary[];
  entitiesError?: string;
  summary: GPRunSummary;
  countries: CountryCapability[];
}

export interface GPRunOptions {
  signal?: AbortSignal;
  companySlug?: string;
  refreshToken?: string;
  gatewayEnv?: string;
  scope?: GPScope;
  /** Used when scope === "custom" */
  countryCodes?: string[];
  /** Parallel requests (default 6) */
  concurrency?: number;
  /** Test employee per country (code -> employment ID); those countries' forms are fetched for that employee */
  employments?: Record<string, string>;
}

export type GPBroadcast = (event: string, data: unknown) => void;
