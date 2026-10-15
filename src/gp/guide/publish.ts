/**
 * Published results: what a partner-facing (deployed) build shows on the Payroll tab.
 *
 * James runs the report and the guide checks locally, then clicks Publish, which writes
 * data/gp-guide/published.json. Committing and deploying that file is the publish step, so
 * partners only ever see results someone chose to share.
 *
 * Sanitized on the way in: no company slug, no legal entities, no employment IDs. Request IDs
 * stay (Remote can look them up, and they identify nothing on their own).
 */

import type { CountryCapability, FieldCheckResult, GPRunReport } from "../types";
import type { GuideCheckResult } from "./checks";

export interface GuidePublished {
  /** ISO time of publishing; null when nothing has been published yet */
  publishedAt: string | null;
  gatewayEnv?: string;
  /** The country report (sanitized) */
  report?: GPRunReport;
  /** Latest automated check per guide case */
  checks: GuideCheckResult[];
}

function sanitizeFieldCheck(r: FieldCheckResult): FieldCheckResult {
  const { employmentId: _employmentId, ...rest } = r;
  return rest;
}

function sanitizeCountry(c: CountryCapability): CountryCapability {
  const { employmentId: _employmentId, ...rest } = c;
  const forms = Object.fromEntries(
    Object.entries(c.forms).map(([k, p]) => {
      if (!p) return [k, p];
      const { employmentId: _e, ...probe } = p;
      return [k, probe];
    })
  ) as CountryCapability["forms"];
  return {
    ...rest,
    forms,
    entity: { status: "unknown", entityIds: [] },
    ...(c.fieldChecks ? { fieldChecks: c.fieldChecks.map(sanitizeFieldCheck) } : {}),
  };
}

export function sanitizeReport(report: GPRunReport): GPRunReport {
  const { companySlug: _slug, entitiesError: _err, ...rest } = report;
  return { ...rest, entities: [], countries: report.countries.map(sanitizeCountry), summary: { ...report.summary, gpEntityCountries: 0 } };
}

const isCheck = (x: unknown): x is GuideCheckResult => {
  const o = x as Record<string, unknown>;
  return !!o && typeof o.caseId === "string" && typeof o.outcome === "string" && typeof o.summary === "string";
};

/** Build the file contents from what the browser sends; anything malformed is dropped */
export function buildPublished(input: { report?: unknown; checks?: unknown }, now = new Date()): GuidePublished {
  const report = input.report && typeof input.report === "object" && Array.isArray((input.report as GPRunReport).countries)
    ? sanitizeReport(input.report as GPRunReport)
    : undefined;
  const checks = Array.isArray(input.checks) ? input.checks.filter(isCheck).map((c) => ({
    caseId: c.caseId, outcome: c.outcome, summary: c.summary,
    details: Array.isArray(c.details) ? c.details.filter((d) => typeof d === "string") : [],
    checkedAt: c.checkedAt,
    ...(c.requestIds?.length ? { requestIds: c.requestIds } : {}),
  })) : [];
  return { publishedAt: now.toISOString(), ...(report ? { gatewayEnv: report.gatewayEnv, report } : {}), checks };
}
