/**
 * Pure evaluation helpers for the GP capability report (no network calls).
 */

import { GP_BASELINE, type GPCountryExpectation } from "../../data/gp-capability-baseline";
import type { LegalEntity } from "../setup/entity-swap";
import { isPublished } from "./types";
import type {
  BaselineCheck,
  BaselineVerdict,
  CountryCapability,
  EntityStatus,
  FormProbe,
  GPCoverage,
  GPEntitySummary,
  GPFormKey,
  GPRunReport,
  GPRunSummary,
} from "./types";

export function classifyCoverage(forms: Partial<Record<GPFormKey, FormProbe>>): GPCoverage {
  const c = forms.contract_details?.status;
  const p = forms.personal_details?.status;
  if (c === "error" || p === "error" || !c || !p) return "unknown";
  const employer = isPublished(c);
  const employee = isPublished(p);
  if (employer && employee) return "full";
  if (employer) return "employer_only";
  if (employee) return "employee_only";
  return "none";
}

/**
 * Cross-check forms the probe could only answer with 400 "missing employment_id" (read as published,
 * since unsupported countries get 422 first) against the country's supported_json_schemas in
 * GET /v1/countries: listed stays published, not listed is unavailable. A safety net in case Remote
 * ever checks the parameter before the country.
 */
export function confirmAgainstCatalog(
  forms: Partial<Record<GPFormKey, FormProbe>>,
  supportedSchemas: string[]
): Partial<Record<GPFormKey, FormProbe>> {
  const out: Partial<Record<GPFormKey, FormProbe>> = {};
  for (const [key, p] of Object.entries(forms) as [GPFormKey, FormProbe][]) {
    if (p?.status !== "requires_employment") continue;
    out[key] = supportedSchemas.includes(p.form)
      ? { ...p, message: "Published (listed for the country in GET /v1/countries); schema only readable for an employee in this country" }
      : { ...p, status: "unavailable", message: "Not listed for the country in GET /v1/countries" };
  }
  return out;
}

export const COVERAGE_LABEL: Record<GPCoverage, string> = {
  full: "Full (employer + employee)",
  employer_only: "Employer only",
  employee_only: "Employee only",
  none: "Not supported",
  unknown: "Unknown (probe error)",
};

function yn(v: boolean | null | undefined): string {
  return v === null || v === undefined ? "n/a" : v ? "yes" : "no";
}

function availability(probe?: FormProbe): boolean | null {
  if (!probe || probe.status === "error" || probe.status === "skipped") return null;
  return isPublished(probe.status);
}

export function evaluateBaseline(
  code: string,
  forms: Partial<Record<GPFormKey, FormProbe>>,
  nameRequired: boolean | null,
  baseline: Record<string, GPCountryExpectation> = GP_BASELINE
): { verdict: BaselineVerdict; checks: BaselineCheck[]; note?: string } {
  const exp = baseline[code];
  if (!exp) return { verdict: "no_baseline", checks: [] };

  const checks: BaselineCheck[] = [];
  let probeError = false;

  for (const key of ["contract_details", "personal_details"] as const) {
    const expected = exp[key];
    if (expected === undefined) continue;
    const actual = availability(forms[key]);
    if (actual === null) probeError = true;
    checks.push({
      label: key === "contract_details" ? "Contract details published" : "Personal details published",
      expected: yn(expected),
      actual: actual === null ? `error (${forms[key]?.httpStatus ?? "no response"})` : yn(actual),
      pass: actual === expected,
    });
  }

  if (exp.nameRequired !== undefined && forms.personal_details?.status === "available") {
    checks.push({
      label: "Personal details requires `name`",
      expected: yn(exp.nameRequired),
      actual: yn(nameRequired),
      pass: nameRequired === exp.nameRequired,
    });
  }

  let verdict: BaselineVerdict;
  if (probeError) verdict = "error";
  else verdict = checks.every((c) => c.pass) ? "match" : "drift";
  return { verdict, checks, note: exp.note };
}

export function entityCode(e: LegalEntity): string {
  const r = e as Record<string, unknown>;
  return String(r.country_code || e.country?.code || "").toUpperCase();
}

export function summarizeEntities(entities: LegalEntity[]): GPEntitySummary[] {
  return entities.map((e) => {
    const r = e as Record<string, unknown>;
    return {
      id: String(r.slug || r.id || e.legal_entity_id || ""),
      name: String(e.name || ""),
      countryCode: entityCode(e),
      gpEnabled: r.global_payroll_enabled === true,
      status: typeof e.status === "string" ? e.status : undefined,
    };
  });
}

export function entityStatusFor(
  code: string,
  entities: GPEntitySummary[] | null
): { status: EntityStatus; entityIds: string[] } {
  if (!entities) return { status: "unknown", entityIds: [] };
  const matches = entities.filter((e) => e.countryCode === code);
  if (matches.length === 0) return { status: "none", entityIds: [] };
  const gp = matches.filter((e) => e.gpEnabled);
  return gp.length > 0
    ? { status: "gp_enabled", entityIds: gp.map((e) => e.id) }
    : { status: "entity_no_gp", entityIds: matches.map((e) => e.id) };
}

/**
 * Re-evaluate a saved report with the current rules. Older runs recorded the Remote sandbox
 * "missing required query parameter: employment_id" 400 as an error; it means published.
 */
export function normalizeReport(report: GPRunReport): GPRunReport {
  const countries = report.countries.map((c) => {
    const forms = { ...c.forms };
    let changed = false;
    for (const [key, p] of Object.entries(forms) as [GPFormKey, FormProbe][]) {
      if (p?.status === "error" && p.httpStatus === 400 && /employment_id/i.test(p.message || "")) {
        forms[key] = { ...p, status: "requires_employment", message: "Published; schema only readable with an employment_id" };
        changed = true;
      }
    }
    if (!changed) return c;
    return {
      ...c,
      forms,
      coverage: classifyCoverage(forms),
      baseline: evaluateBaseline(c.code, forms, c.nameRequired),
    };
  });
  return { ...report, countries, summary: summarize(countries, report.summary.duration) };
}

export function summarize(countries: CountryCapability[], durationMs: number): GPRunSummary {
  const s: GPRunSummary = {
    total: countries.length, full: 0, employerOnly: 0, employeeOnly: 0, none: 0,
    errors: 0, match: 0, drift: 0, noBaseline: 0, gpEntityCountries: 0, duration: durationMs,
  };
  for (const c of countries) {
    if (c.coverage === "full") s.full++;
    else if (c.coverage === "employer_only") s.employerOnly++;
    else if (c.coverage === "employee_only") s.employeeOnly++;
    else if (c.coverage === "none") s.none++;
    else s.errors++;

    if (c.baseline.verdict === "match") s.match++;
    else if (c.baseline.verdict === "drift") s.drift++;
    else if (c.baseline.verdict === "no_baseline") s.noBaseline++;

    if (c.entity.status === "gp_enabled") s.gpEntityCountries++;
  }
  return s;
}
