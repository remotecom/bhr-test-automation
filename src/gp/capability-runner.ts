/**
 * Global Payroll capability report runner (read-only).
 *
 * For each country in scope:
 *   1. Probe every global_payroll_* form:  GET /v1/countries/{cc}/{form}
 *   2. Analyse each published schema: required, hidden and inert-required fields
 *   3. Cross-reference the company's legal entities (global_payroll_enabled)
 *      and the country catalog (supported_json_schemas)
 *   4. Compare the result against data/gp-capability-baseline.ts
 *
 * Creates nothing and changes no sandbox state, so it is safe to run against a
 * shared or partner company.
 *
 * SSE events:
 *   gp:start         { time, gatewayEnv, scope }
 *   gp:entities      { entities: GPEntitySummary[], error? }
 *   gp:collected     { total, countries: [{ code, name }] }
 *   gp:country       CountryCapability
 *   gp:end           GPRunReport (the full report)
 *   gp:process-done  { exitCode, error? }
 */

import { createClientFromEnv, createClientFromToken, getCompanySlug, type RemoteClient } from "../client";
import { getCountries, type Country } from "../steps/countries";
import { getCompanyEntities } from "../setup/entity-swap";
import { probeGPForm } from "../steps/gp-forms";
import { isNameRequired } from "./schema-analysis";
import {
  classifyCoverage,
  entityStatusFor,
  evaluateBaseline,
  summarizeEntities,
  summarize,
} from "./evaluate";
import {
  GP_BASELINE_COUNTRIES,
  GP_BASELINE_SOURCE,
  GP_FORMS,
} from "../../data/gp-capability-baseline";
import type {
  CountryCapability,
  FormProbe,
  GPBroadcast,
  GPEntitySummary,
  GPFormKey,
  GPRunOptions,
  GPRunReport,
} from "./types";

/** Run tasks with bounded concurrency */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal?: AbortSignal) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      if (signal?.aborted) return;
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function resolveScope(
  options: GPRunOptions,
  catalog: Country[],
  entities: GPEntitySummary[] | null
): string[] {
  const catalogCodes = catalog.map((c) => c.code.toUpperCase());
  const entityCodes = (entities || []).map((e) => e.countryCode).filter(Boolean);

  let codes: string[];
  switch (options.scope) {
    case "all":
      codes = catalogCodes;
      break;
    case "custom":
      codes = (options.countryCodes || []).map((c) => c.trim().toUpperCase()).filter(Boolean);
      break;
    case "baseline":
    default:
      codes = [...GP_BASELINE_COUNTRIES, ...entityCodes];
  }
  return [...new Set(codes)].sort();
}

async function probeCountry(
  client: RemoteClient,
  code: string,
  country: Country | undefined,
  entities: GPEntitySummary[] | null,
  signal?: AbortSignal
): Promise<CountryCapability> {
  const started = Date.now();
  const forms: Partial<Record<GPFormKey, FormProbe>> = {};

  for (const def of GP_FORMS) {
    if (signal?.aborted) break;
    if (def.onlyCountries && !def.onlyCountries.includes(code)) {
      forms[def.key] = { form: def.form, status: "skipped" };
      continue;
    }
    forms[def.key] = await probeGPForm(client, code, def.form);
  }

  const nameRequired =
    forms.personal_details?.status === "available"
      ? isNameRequired(forms.personal_details.analysis)
      : null;

  const supported = Array.isArray(country?.supported_json_schemas) ? country!.supported_json_schemas : [];

  return {
    code,
    name: country?.name || code,
    region: country?.region,
    forms,
    coverage: classifyCoverage(forms),
    nameRequired,
    entity: entityStatusFor(code, entities),
    catalog: {
      inCatalog: !!country,
      eorOnboarding: country?.eor_onboarding,
      gpSchemasAdvertised: supported.filter((s) => typeof s === "string" && s.startsWith("global_payroll")),
    },
    baseline: evaluateBaseline(code, forms, nameRequired),
    durationMs: Date.now() - started,
  };
}

export async function runGPCapabilities(
  broadcast: GPBroadcast,
  options: GPRunOptions = {}
): Promise<GPRunReport> {
  const startTime = Date.now();
  const gatewayEnv = options.gatewayEnv || process.env.GATEWAY_ENV || "partners";
  const scope = options.scope || "baseline";
  const companySlug = options.companySlug || getCompanySlug(gatewayEnv);

  const client = options.refreshToken
    ? createClientFromToken(options.refreshToken, gatewayEnv)
    : createClientFromEnv(gatewayEnv);

  broadcast("gp:start", { time: startTime, gatewayEnv, scope });

  // Company legal entities (GP-enabled?). Non-fatal: the form probe still works without it.
  let entities: GPEntitySummary[] | null = null;
  let entitiesError: string | undefined;
  if (companySlug) {
    try {
      entities = summarizeEntities(await getCompanyEntities(client, companySlug));
    } catch (err) {
      entitiesError = err instanceof Error ? err.message : String(err);
    }
  } else {
    entitiesError = "No company connected; entity status not checked";
  }
  broadcast("gp:entities", { entities: entities || [], error: entitiesError });

  const catalog = await getCountries(client);
  const byCode = new Map(catalog.map((c) => [c.code.toUpperCase(), c]));

  const codes = resolveScope({ ...options, scope }, catalog, entities);
  broadcast("gp:collected", {
    total: codes.length,
    countries: codes.map((code) => ({ code, name: byCode.get(code)?.name || code })),
  });

  const results: CountryCapability[] = [];
  await pool(
    codes,
    options.concurrency ?? 6,
    async (code) => {
      const result = await probeCountry(client, code, byCode.get(code), entities, options.signal);
      results.push(result);
      broadcast("gp:country", result);
    },
    options.signal
  );

  results.sort((a, b) => a.code.localeCompare(b.code));

  const report: GPRunReport = {
    timestamp: new Date().toISOString(),
    gatewayEnv,
    companySlug,
    scope,
    baselineSource: GP_BASELINE_SOURCE,
    catalogAdvertisesGP: results.some((r) => r.catalog.gpSchemasAdvertised.length > 0),
    entities: entities || [],
    entitiesError,
    summary: summarize(results, Date.now() - startTime),
    countries: results,
  };

  if (!options.signal?.aborted) {
    broadcast("gp:end", report);
  }
  return report;
}
