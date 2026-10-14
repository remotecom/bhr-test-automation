/**
 * Types for the Global Payroll (GP) capability report.
 */

import type { GPFormKey } from "../../data/gp-capability-baseline";

export type { GPFormKey };

/**
 * available           = 200 with a schema
 * requires_employment = 400 "missing required query parameter: employment_id". The form is published
 *                       for the country (unsupported countries get 422 first), but its schema can only
 *                       be read for a specific employment. Counts as published.
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
  };
  baseline: { verdict: BaselineVerdict; checks: BaselineCheck[]; note?: string };
  durationMs: number;
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
}

export type GPBroadcast = (event: string, data: unknown) => void;
