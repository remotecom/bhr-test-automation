/**
 * Automated checks behind testing-guide rows (sandbox only; some save forms to test employees).
 *
 * Each check compares what the API does now with what the guide records for that row:
 *   as_recorded    the API still behaves as the guide says (for a known issue: it still reproduces)
 *   differs        it doesn't: the row needs updating, or something regressed
 *   inconclusive   the check ran but couldn't tell (e.g. a test value was rejected)
 *   observed       new behaviour with nothing recorded yet (functional checks: see flow.ts)
 *   skipped        a prerequisite is missing (usually a test employee in that country)
 *   error          the check couldn't run
 * A check never changes a row's status; that stays a person's call in data/gp-guide/guide.json.
 *
 * Checks that only an SDK in a browser can answer (rendering, the SDK's own requests) have no
 * check here and stay manual.
 */

import type { RemoteClient } from "../../client";
import { getCompanyEntities } from "../../setup/entity-swap";
import { getCountries } from "../../steps/countries";
import { probeGPForm } from "../../steps/gp-forms";
import { summarizeEntities } from "../evaluate";
import { checkSkippedFields } from "../field-check";
import { isPublished, type FieldCheckResult } from "../types";
import { FUNCTIONAL_CHECKS } from "./flow";
import { TOKEN_CHECKS } from "./token-checks";

export type GuideCheckOutcome = "as_recorded" | "differs" | "observed" | "inconclusive" | "skipped" | "error";

export interface GuideCheckResult {
  caseId: string;
  outcome: GuideCheckOutcome;
  /** One line, shown on the row */
  summary: string;
  /** Per-country or per-step lines, shown when the row is expanded */
  details: string[];
  checkedAt: string;
  /** Request IDs Remote can look up (only failures carry one) */
  requestIds?: string[];
}

export interface GuideCheckContext {
  client: RemoteClient;
  companySlug: string;
  /** Test employees by country code (employment IDs) */
  employments: Record<string, string>;
}

type CheckFn = (ctx: GuideCheckContext) => Promise<Omit<GuideCheckResult, "caseId" | "checkedAt">>;

/** Countries A4 covers (batch 2) */
export const BATCH_2 = ["DEU", "DNK", "IRL", "SWE"];

/** Save contract details for one country's test employee, the way the SDK would (skipped fields left out) */
async function saveContract(ctx: GuideCheckContext, code: string): Promise<{ line: string; outcome: GuideCheckOutcome; requestId?: string }> {
  const emp = ctx.employments[code];
  if (!emp) return { line: `${code}: no test employee, not checked`, outcome: "skipped" };
  const r: FieldCheckResult = await checkSkippedFields(ctx.client, code, "contract_details", emp, { submitAlways: true });
  const saved = !!r.httpStatus && r.httpStatus >= 200 && r.httpStatus < 300;
  if (saved) {
    const skipped = r.skippedFields.length ? `, without ${r.skippedFields.join(", ")} (hidden by the form)` : "";
    return { line: `${code}: contract details saved (${r.httpStatus})${skipped}`, outcome: "as_recorded" };
  }
  if (r.outcome === "enforced") {
    return { line: `${code}: ${r.httpStatus}, the API requires ${r.enforcedFields.join(", ")}, which the form hides`, outcome: "differs", requestId: r.requestId };
  }
  if (r.outcome === "inconclusive") {
    return { line: `${code}: ${r.httpStatus}, a test value was rejected (${r.otherRejected.join(", ") || "see message"}): ${r.message ?? ""}`.trim(), outcome: "inconclusive", requestId: r.requestId };
  }
  return { line: `${code}: ${r.httpStatus ?? "error"} ${r.message ?? ""}`.trim(), outcome: "error", requestId: r.requestId };
}

/** A country's GP flags from GET /v1/countries: is GP supported, and which GP forms it lists */
async function gpCatalog(ctx: GuideCheckContext, code: string): Promise<{ supported?: boolean; forms: string[] } | undefined> {
  const country = (await getCountries(ctx.client)).find((c) => c.code.toUpperCase() === code);
  if (!country) return undefined;
  const forms = (country.supported_json_schemas || []).filter((f) => f.startsWith("global_payroll_"));
  return { supported: country.global_payroll_supported, forms };
}

/** Country A5 uses as its example of a country without GP */
export const NO_GP_EXAMPLE = "MLT";


/** The overall outcome of several lines: any difference wins, then errors, then inconclusive */
function combine(outcomes: GuideCheckOutcome[]): GuideCheckOutcome {
  for (const o of ["differs", "error", "observed", "inconclusive", "as_recorded"] as const) if (outcomes.includes(o)) return o;
  return "skipped";
}

export const GUIDE_CHECKS: Record<string, { label: string; run: CheckFn }> = {
  S7: {
    label: "Reads the company's legal entities and looks for global_payroll_enabled",
    async run(ctx) {
      const entities = summarizeEntities(await getCompanyEntities(ctx.client, ctx.companySlug));
      const on = entities.filter((e) => e.gpEnabled).map((e) => e.countryCode);
      return on.length
        ? { outcome: "as_recorded", summary: `${on.length} legal entit${on.length === 1 ? "y shows" : "ies show"} global_payroll_enabled: true (${on.join(", ")})`, details: [] }
        : { outcome: "skipped", summary: "No GP-enabled legal entity in the test company", details: [] };
    },
  },
  A1: {
    label: "Uses the GBR test employee: GET /v1/employments/{id}/onboarding-steps",
    async run(ctx) {
      const emp = ctx.employments.GBR;
      if (!emp) return { outcome: "skipped", summary: "Needs a GBR test employee", details: [] };
      const res = await ctx.client.get<{ data?: unknown }>(`/v1/employments/${encodeURIComponent(emp)}/onboarding-steps`);
      if (res.status === 200) {
        const data = (res.data as { data?: unknown })?.data;
        const steps = Array.isArray(data) ? data.length : Array.isArray((data as { onboarding_steps?: unknown[] })?.onboarding_steps) ? (data as { onboarding_steps: unknown[] }).onboarding_steps.length : undefined;
        return { outcome: "as_recorded", summary: `GP employment exists; onboarding steps load (200${steps !== undefined ? `, ${steps} steps` : ""})`, details: [] };
      }
      return { outcome: "differs", summary: `Onboarding steps returned ${res.status}`, details: [], requestIds: res.requestId ? [res.requestId] : undefined };
    },
  },
  A3: {
    label: "Saves contract details to the GBR test employee, leaving out fields the form hides",
    async run(ctx) {
      const r = await saveContract(ctx, "GBR");
      return {
        outcome: r.outcome,
        summary: r.outcome === "skipped" ? "Needs a GBR test employee" : r.line.replace(/^GBR: /, ""),
        details: ["Whether the entity is on TT2.0 isn't known to the check."],
        requestIds: r.requestId ? [r.requestId] : undefined,
      };
    },
  },
  A4: {
    label: `Saves contract details to test employees in ${BATCH_2.join(", ")}`,
    async run(ctx) {
      const results = [];
      for (const code of BATCH_2) results.push(await saveContract(ctx, code));
      const ran = results.filter((r) => r.outcome !== "skipped");
      const outcome = combine(results.map((r) => r.outcome));
      const summary = ran.length === 0
        ? `Needs a test employee in ${BATCH_2.join(", ")}`
        : `${ran.filter((r) => r.outcome === "as_recorded").length} of ${ran.length} saved (${ran.map((r) => r.line.split(":")[0]).join(", ")})`;
      return { outcome, summary, details: results.map((r) => r.line), requestIds: results.flatMap((r) => (r.requestId ? [r.requestId] : [])) };
    },
  },
  A5: {
    label: `Reads ${NO_GP_EXAMPLE} in GET /v1/countries: GP support flag and GP forms listed`,
    async run(ctx) {
      const cat = await gpCatalog(ctx, NO_GP_EXAMPLE);
      if (!cat) return { outcome: "error", summary: `${NO_GP_EXAMPLE} isn't in GET /v1/countries`, details: [] };
      // The form itself: a country without it gets 422 (one with it gets 400, needing an employee there)
      const p = await probeGPForm(ctx.client, NO_GP_EXAMPLE, "global_payroll_contract_details");
      if (p.status === "error") return { outcome: "error", summary: `Reading ${NO_GP_EXAMPLE}'s form failed: ${p.httpStatus ?? ""} ${p.message ?? ""}`.trim(), details: [] };
      const details = [
        `global_payroll_supported: ${cat.supported ?? "not returned"}`,
        `GP forms in supported_json_schemas: ${cat.forms.length ? cat.forms.join(", ") : "none"}`,
        `GET ${NO_GP_EXAMPLE}/global_payroll_contract_details: ${p.httpStatus} ${p.status === "requires_employment" ? "missing employment_id (the form exists; it needs an employee in the country)" : p.message ?? ""}`.trim(),
      ];
      return cat.supported === false && cat.forms.length === 0 && p.status === "unavailable"
        ? { outcome: "as_recorded", summary: `${NO_GP_EXAMPLE}: global_payroll_supported false, no GP forms listed, form ${p.httpStatus}`, details }
        : { outcome: "differs", summary: cat.supported || cat.forms.length ? `${NO_GP_EXAMPLE} now ${cat.supported ? "supports GP" : "lists GP forms"} in GET /v1/countries` : `${NO_GP_EXAMPLE}'s contract-details form now returns ${p.httpStatus} (${p.status})`, details };
    },
  },
  A6: {
    label: "Reads HUN in GET /v1/countries, and HUN's personal-details form",
    async run(ctx) {
      const cat = await gpCatalog(ctx, "HUN");
      if (!cat) return { outcome: "error", summary: "HUN isn't in GET /v1/countries", details: [] };
      const personal = await probeGPForm(ctx.client, "HUN", "global_payroll_personal_details");
      if (personal.status === "error") return { outcome: "error", summary: `Reading ${personal.form} failed: ${personal.httpStatus ?? ""} ${personal.message ?? ""}`.trim(), details: [] };
      const contractListed = cat.forms.includes("global_payroll_contract_details");
      const personalListed = cat.forms.includes("global_payroll_personal_details");
      const details = [
        `global_payroll_supported: ${cat.supported ?? "not returned"}`,
        `GP forms in supported_json_schemas: ${cat.forms.length ? cat.forms.join(", ") : "none"}`,
        `Personal details: ${personal.httpStatus} (${isPublished(personal.status) ? "published" : personal.status})`,
      ];
      const asRecorded = contractListed && !personalListed && !isPublished(personal.status);
      return asRecorded
        ? { outcome: "as_recorded", summary: "HUN still lists the employer form only (global_payroll_supported: " + (cat.supported ?? "not returned") + ")", details }
        : { outcome: "differs", summary: personalListed || isPublished(personal.status) ? "HUN now publishes the personal-details form too" : "HUN no longer lists the contract-details form", details };
    },
  },
  A7: {
    label: "Reads CAN's administrative-details and contract-details forms for the CAN test employee and compares them",
    async run(ctx) {
      const emp = ctx.employments.CAN;
      if (!emp) return { outcome: "skipped", summary: "Needs a CAN test employee", details: [] };
      const admin = await probeGPForm(ctx.client, "CAN", "global_payroll_administrative_details", { employmentId: emp });
      const contract = await probeGPForm(ctx.client, "CAN", "global_payroll_contract_details", { employmentId: emp });
      if (admin.status !== "available" || !admin.analysis) return { outcome: "error", summary: `Administrative details returned ${admin.httpStatus ?? "an error"}`, details: [] };
      if (contract.status === "error") return { outcome: "error", summary: `Contract details returned ${contract.httpStatus ?? "an error"}`, details: [] };
      const a = new Set(admin.analysis.requiredFields);
      const c = contract.analysis?.requiredFields ?? [];
      const shared = c.filter((f) => a.has(f));
      const sameForm = c.length > 0 && shared.length / Math.min(a.size, c.length) > 0.5;
      const details = [`Administrative details: ${a.size} required fields, e.g. ${[...a].slice(0, 5).join(", ")}`, `Shared with contract details: ${shared.length ? shared.join(", ") : "none"}`];
      return sameForm
        ? { outcome: "differs", summary: "The API serves contract-details fields as administrative details", details }
        : { outcome: "as_recorded", summary: "The API serves the administrative-details form (the SDK step itself is checked by hand)", details };
    },
  },
  // Token checks: what the jwt-bearer grant returns for a wrong assertion (src/gp/guide/token-checks.ts)
  ...TOKEN_CHECKS,
  // Functional checks: error codes, messages and blocked steps (src/gp/guide/flow.ts)
  ...FUNCTIONAL_CHECKS,
};

/** The quick checks: everything except the functional scenarios, which create test employees */
export const DEFAULT_CHECK_IDS = Object.keys(GUIDE_CHECKS).filter((id) => !(id in FUNCTIONAL_CHECKS));

/** Run the checks for the given case IDs (default: the quick ones), one at a time */
export async function runGuideChecks(ctx: GuideCheckContext, ids: string[] = DEFAULT_CHECK_IDS, onResult?: (r: GuideCheckResult) => void): Promise<GuideCheckResult[]> {
  const out: GuideCheckResult[] = [];
  for (const caseId of ids) {
    const check = GUIDE_CHECKS[caseId];
    if (!check) continue;
    let r: GuideCheckResult;
    try {
      r = { caseId, checkedAt: new Date().toISOString(), ...(await check.run(ctx)) };
    } catch (err) {
      r = { caseId, checkedAt: new Date().toISOString(), outcome: "error", summary: err instanceof Error ? err.message : String(err), details: [] };
    }
    out.push(r);
    onResult?.(r);
  }
  return out;
}
