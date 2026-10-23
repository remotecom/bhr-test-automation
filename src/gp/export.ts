/**
 * Export a GP capability report as CSV or Markdown.
 *
 * Pure string builders used by the dashboard (client-side downloads),
 * the export API route and the CLI.
 *
 * The "test cases" CSV uses the same columns as the Global Payroll SDK
 * Testing Guide sheet, so rows can be pasted straight in:
 *   Test Case # | Scenario | Input Data | Expected Outcome |
 *   Remote Response/Error Message | Blocking Logic/Notes | Status | Comments
 */

import { GP_FORMS } from "../../data/gp-capability-baseline";
import { COVERAGE_LABEL } from "./evaluate";
import type { CountryCapability, FormProbe, GPRunReport } from "./types";

export const TEST_GUIDE_COLUMNS = [
  "Test Case #",
  "Scenario",
  "Input Data",
  "Expected Outcome",
  "Remote Response/Error Message",
  "Blocking Logic/Notes",
  "Status",
  "Comments",
];

const ENTITY_LABEL: Record<string, string> = {
  gp_enabled: "GP-enabled entity",
  entity_no_gp: "Entity, GP not enabled",
  none: "No entity",
  unknown: "Not checked",
};

const VERDICT_STATUS: Record<string, string> = {
  match: "Verified",
  drift: "Drift",
  error: "Error",
  no_baseline: "Observed",
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function mdCell(v: unknown): string {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formCell(p?: FormProbe): string {
  if (!p) return "";
  switch (p.status) {
    case "available": return "yes";
    case "requires_employment": return "yes (needs employment)";
    case "unavailable": return "no";
    case "skipped": return "n/a";
    default: return `error ${p.httpStatus ?? ""}`.trim();
  }
}

function formResponse(p?: FormProbe): string {
  if (!p || p.status === "skipped") return "";
  if (p.status === "available") return `${p.httpStatus} (${p.analysis?.requiredFields.length ?? 0} required / ${p.analysis?.fieldCount ?? 0} fields)`;
  if (p.status === "requires_employment") return `${p.httpStatus} published, schema needs employment_id`;
  return `${p.httpStatus ?? "ERR"}${p.message ? ` ${p.message}` : ""}`;
}

function allSignals(c: CountryCapability): { hidden: string[]; inert: string[] } {
  const hidden: string[] = [];
  const inert: string[] = [];
  for (const def of GP_FORMS) {
    const a = c.forms[def.key]?.analysis;
    if (!a) continue;
    a.hiddenFields.forEach((f) => hidden.push(`${def.short}:${f}`));
    a.inertRequired.forEach((f) => inert.push(`${def.short}:${f}`));
  }
  return { hidden, inert };
}

function driftText(c: CountryCapability): string {
  return c.baseline.checks
    .filter((ch) => !ch.pass)
    .map((ch) => `${ch.label}: expected ${ch.expected}, got ${ch.actual}`)
    .join("; ");
}

/** Plain-language result of each skipped-field check on a country, e.g. "Admin: skips tax_code: not enforced (200, 30 Sep 2026)" */
export function fieldCheckText(c: CountryCapability): string[] {
  const label = (key: string) => GP_FORMS.find((f) => f.key === key)?.short || key;
  return (c.fieldChecks || []).map((r) => {
    const when = `${r.httpStatus ? `${r.httpStatus}, ` : ""}${r.source === "recorded" ? "recorded " : ""}${r.checkedAt.slice(0, 10)}`;
    const skipped = r.skippedFields.join(", ");
    switch (r.outcome) {
      case "not_enforced": return `${label(r.form)}: skips ${skipped}: not enforced (${when})`;
      case "enforced": return `${label(r.form)}: API requires skipped ${r.enforcedFields.join(", ")} (${when})`;
      case "inconclusive": return `${label(r.form)}: check inconclusive, API rejected ${r.otherRejected.join(", ") || "other fields"} (${when})`;
      case "nothing_to_check": return `${label(r.form)}: no skipped fields for the test employee (${when})`;
      default: return `${label(r.form)}: check failed${r.message ? `: ${r.message}` : ""} (${when})`;
    }
  });
}

// ---------------------------------------------------------------------------
// Matrix CSV: one row per country, every column
// ---------------------------------------------------------------------------

export function toMatrixCSV(report: GPRunReport): string {
  const header = [
    "Code", "Country", "Region", "Coverage", "Company entity",
    ...GP_FORMS.map((f) => f.label),
    "Name required", "Contract required fields", "Personal required fields",
    "Hidden fields", "Skipped by form (may be required)", "Skipped-field check", "Catalog GP schemas",
    "Baseline", "Baseline detail",
  ];
  const rows = report.countries.map((c) => {
    const { hidden, inert } = allSignals(c);
    return csvRow([
      c.code, c.name, c.region || "", COVERAGE_LABEL[c.coverage], ENTITY_LABEL[c.entity.status],
      ...GP_FORMS.map((f) => formCell(c.forms[f.key])),
      c.nameRequired === null ? "n/a" : c.nameRequired ? "yes" : "no",
      (c.forms.contract_details?.analysis?.requiredFields || []).join(" "),
      (c.forms.personal_details?.analysis?.requiredFields || []).join(" "),
      hidden.join(" "), inert.join(" "), fieldCheckText(c).join("; "),
      c.catalog.gpSchemasAdvertised.join(" "),
      VERDICT_STATUS[c.baseline.verdict], driftText(c) || c.baseline.note || "",
    ]);
  });
  return [csvRow(header), ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Test cases CSV: Testing Guide columns
// ---------------------------------------------------------------------------

export function toTestCaseRows(report: GPRunReport): string[][] {
  return report.countries.map((c) => {
    const { hidden, inert } = allSignals(c);
    const expected = c.baseline.checks.length
      ? c.baseline.checks.map((ch) => `${ch.label}: ${ch.expected}`).join("; ")
      : "No baseline: observed only";
    const response = GP_FORMS
      .filter((f) => c.forms[f.key] && c.forms[f.key]!.status !== "skipped")
      .map((f) => `${f.short}: ${formResponse(c.forms[f.key])}`)
      .join("; ");
    const notes = [
      `Coverage: ${COVERAGE_LABEL[c.coverage]}`,
      `Company: ${ENTITY_LABEL[c.entity.status]}`,
      c.nameRequired !== null ? `name required: ${c.nameRequired ? "yes" : "no"}` : "",
      hidden.length ? `Hidden: ${hidden.join(", ")}` : "",
      ...(c.fieldChecks?.length
        ? fieldCheckText(c)
        : [inert.length ? `Form skips ${inert.join(", ")}; the API may still require them (untested)` : ""]),
      c.baseline.note || "",
    ].filter(Boolean).join(" | ");
    return [
      `GPC-${c.code}`,
      `GP forms published for ${c.name} (${c.code})`,
      `${report.gatewayEnv}: GET /v1/countries/${c.code}/global_payroll_{${GP_FORMS.filter((f) => !f.onlyCountries || f.onlyCountries.includes(c.code)).map((f) => f.key).join(",")}}`,
      expected,
      response,
      notes,
      VERDICT_STATUS[c.baseline.verdict],
      driftText(c),
    ];
  });
}

export function toTestCasesCSV(report: GPRunReport): string {
  return [csvRow(TEST_GUIDE_COLUMNS), ...toTestCaseRows(report).map(csvRow)].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Markdown: summary plus table, ready to paste into Notion or a PR
// ---------------------------------------------------------------------------

export function toMarkdown(report: GPRunReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(`# Global Payroll capability report`);
  lines.push("");
  lines.push(`- **Run:** ${report.timestamp} · **Environment:** ${report.gatewayEnv} · **Company:** ${report.companySlug || "n/a"} · **Scope:** ${report.scope} (${s.total} countries)`);
  lines.push(`- **Coverage:** ${s.full} full · ${s.employerOnly} employer only · ${s.employeeOnly} employee only · ${s.none} not supported · ${s.errors} probe errors`);
  lines.push(`- **Baseline (${report.baselineSource}):** ${s.match} match · ${s.drift} drift · ${s.noBaseline} no baseline`);
  lines.push(`- **Company GP entities:** ${report.entities.filter((e) => e.gpEnabled).map((e) => e.countryCode).join(", ") || "none"}${report.entitiesError ? ` (${report.entitiesError})` : ""}`);
  lines.push("");
  lines.push(`Coverage is "full" when \`global_payroll_contract_details\` (employer) and \`global_payroll_personal_details\` (employee) are both published. yes = 200, yes (needs employment) = published but the schema can only be read with an \`employment_id\`, no = 404/422 "Form not available", n/a = not probed for this country.`);
  lines.push("");

  const formCols = GP_FORMS.map((f) => f.short);
  lines.push(`| Code | Country | Coverage | Company | ${formCols.join(" | ")} | name req. | Baseline |`);
  lines.push(`|---|---|---|---|${formCols.map(() => "---").join("|")}|---|---|`);
  for (const c of report.countries) {
    lines.push(
      `| ${c.code} | ${mdCell(c.name)} | ${COVERAGE_LABEL[c.coverage]} | ${ENTITY_LABEL[c.entity.status]} | ` +
      GP_FORMS.map((f) => formCell(c.forms[f.key])).join(" | ") +
      ` | ${c.nameRequired === null ? "n/a" : c.nameRequired ? "yes" : "no"} | ${VERDICT_STATUS[c.baseline.verdict]} |`
    );
  }

  const drift = report.countries.filter((c) => c.baseline.verdict === "drift" || c.baseline.verdict === "error");
  if (drift.length) {
    lines.push("");
    lines.push(`## Drift and errors`);
    lines.push("");
    for (const c of drift) {
      lines.push(`- **${c.code}** (${VERDICT_STATUS[c.baseline.verdict]}): ${mdCell(driftText(c) || "probe error")}`);
    }
  }

  const signals = report.countries
    .map((c) => ({ c, ...allSignals(c), checks: fieldCheckText(c) }))
    .filter((x) => x.inert.length > 0 || x.checks.length > 0);
  if (signals.length) {
    lines.push("");
    lines.push(`## Fields the form skips that the API may still require`);
    lines.push("");
    lines.push(`The form never asks for these fields, but its schema still lists them as required under a rule that is switched off. If the API still requires them, submitting the form fails with a 422 (this happened with UK \`overtime_eligible\`). Countries with a check result were tested by submitting the form to a test employee without the skipped fields.`);
    lines.push("");
    for (const x of signals) {
      const fields = x.inert.map((f) => `\`${f}\``).join(", ");
      lines.push(`- **${x.c.code}**: ${x.checks.length ? x.checks.join("; ") : `${fields} (untested)`}`);
    }
  }

  lines.push("");
  lines.push(`## Caveats`);
  lines.push("");
  lines.push(`- Read-only probe. Contract details is fetched without \`employment_id\`, so entity-specific field visibility (for example TT2.0) is not reflected.`);
  lines.push(`- A published form means the schema exists. It does not prove a submission will succeed; use the admin and employee onboarding cases for that.`);
  return lines.join("\n") + "\n";
}

export function exportFilename(report: GPRunReport, kind: "matrix" | "test-cases" | "report", ext: "csv" | "md" | "json"): string {
  const stamp = report.timestamp.replace(/[:.]/g, "-").slice(0, 19);
  return `gp-capabilities-${kind}-${report.gatewayEnv}-${stamp}.${ext}`;
}
