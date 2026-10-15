"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getCompanyHeaders, getCompanyOverride } from "@/components/CompanySelector";
import { getEnvironmentHeaders, getSelectedEnv } from "@/components/EnvironmentSelector";
import { normalizeReport, summarize } from "@/src/gp/evaluate";
import { GP_BASELINE_SOURCE } from "@/data/gp-capability-baseline";
import { RECORDED_FIELD_CHECKS } from "@/data/gp-field-checks";
import type {
  CountryCapability,
  FieldCheckResult,
  GPEntitySummary,
  GPFormKey,
  GPRunReport,
  GPScope,
} from "@/src/gp/types";
import type { GPTestEmployee } from "@/src/gp/test-employee";

export interface GPState {
  running: boolean;
  status: string;
  scope: GPScope;
  gatewayEnv: string;
  startedAt: number | null;
  queue: { code: string; name: string }[];
  results: Map<string, CountryCapability>;
  entities: GPEntitySummary[];
  entitiesError?: string;
  report: GPRunReport | null;
  fromLastRun: boolean;
  /** Country codes being re-checked on their own (after a test employee is added or removed) */
  rechecking: string[];
}

export interface EmployeeState {
  /** Test employees for the connected company, by country code */
  byCountry: Record<string, GPTestEmployee>;
  /** Country a test employee is being created for */
  creating: string | null;
  error?: string;
  /** What the last creation changed in the company */
  lastChanges?: { countryCode: string; changes: string[] };
}

// ---------------------------------------------------------------------------
// Last run lives in this browser only, one per environment + company.
// Nothing is stored on the server, so no company or entity IDs leave the browser,
// and you never see a run someone else made against a different company.
// ---------------------------------------------------------------------------

const LS_PREFIX = "bhr_gp_last_run";
const LS_EMPLOYEES_PREFIX = "bhr_gp_test_employees";
const LS_CHECKS_PREFIX = "bhr_gp_field_checks";

function scopeSuffix(): string {
  const env = getSelectedEnv();
  const company = getCompanyOverride(env)?.companySlug || "none";
  return `${env}__${company}`;
}

export function storageKey(): string {
  return `${LS_PREFIX}__${scopeSuffix()}`;
}

/** Test employees are kept per environment + company too: an employment only exists in its own company */
export function employeesKey(): string {
  return `${LS_EMPLOYEES_PREFIX}__${scopeSuffix()}`;
}

export function loadEmployees(): Record<string, GPTestEmployee> {
  try {
    const raw = localStorage.getItem(employeesKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveEmployees(byCountry: Record<string, GPTestEmployee>) {
  try {
    localStorage.setItem(employeesKey(), JSON.stringify(byCountry));
  } catch {
    // Unavailable storage: the employees still work for this page view
  }
}

// ---------------------------------------------------------------------------
// Skipped-field checks: kept per environment + company, like test employees
// ---------------------------------------------------------------------------

export interface FieldCheckState {
  /** Latest result per `${country}:${form}`; live results replace recorded ones */
  byKey: Record<string, FieldCheckResult>;
  /** Key of the check in progress */
  running: string | null;
  error?: string;
}

export const checkKey = (country: string, form: GPFormKey) => `${country}:${form}`;

function checksKey(): string {
  return `${LS_CHECKS_PREFIX}__${scopeSuffix()}`;
}

/** Recorded results first, then this browser's live results on top */
export function loadChecks(): Record<string, FieldCheckResult> {
  const byKey: Record<string, FieldCheckResult> = {};
  for (const r of RECORDED_FIELD_CHECKS) byKey[checkKey(r.countryCode, r.form)] = r;
  try {
    const raw = localStorage.getItem(checksKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") Object.assign(byKey, parsed);
  } catch {
    // Unavailable storage: recorded results only
  }
  return byKey;
}

function saveChecks(byKey: Record<string, FieldCheckResult>) {
  const live = Object.fromEntries(Object.entries(byKey).filter(([, r]) => r.source === "live"));
  try {
    localStorage.setItem(checksKey(), JSON.stringify(live));
  } catch {
    // Unavailable storage: the result still shows for this page view
  }
}

/** Attach check results to each country, for display and export */
export function withFieldChecks(c: CountryCapability, byKey: Record<string, FieldCheckResult>): CountryCapability {
  const checks = Object.values(byKey).filter((r) => r.countryCode === c.code);
  return checks.length ? { ...c, fieldChecks: checks } : c;
}

const employmentMap = (byCountry: Record<string, GPTestEmployee>) =>
  Object.fromEntries(Object.entries(byCountry).map(([cc, e]) => [cc, e.employmentId]));

/** POST to the GP run endpoint and feed each SSE event to onEvent */
async function streamRun(
  body: unknown,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal: AbortSignal
) {
  const response = await fetch("/api/gp/capabilities/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getCompanyHeaders(),
      ...getEnvironmentHeaders(),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).error || `HTTP ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;
    for (const part of parts) {
      const ev = part.match(/^event: (.+)$/m);
      const dt = part.match(/^data: (.+)$/m);
      if (ev && dt) {
        try {
          onEvent(ev[1], JSON.parse(dt[1]));
        } catch {
          // Malformed event
        }
      }
    }
  }
}

export function saveLocal(report: GPRunReport, key: string) {
  try {
    localStorage.setItem(key, JSON.stringify(report));
  } catch {
    // Storage full, blocked or unavailable: the run still shows, it just won't survive a reload
  }
}

export function loadLocal(): GPRunReport | null {
  try {
    const raw = localStorage.getItem(storageKey());
    const report = raw ? (JSON.parse(raw) as GPRunReport) : null;
    return report?.countries ? normalizeReport(report) : null;
  } catch {
    return null;
  }
}

const initial: GPState = {
  running: false,
  status: "Ready",
  scope: "baseline",
  gatewayEnv: "partners",
  startedAt: null,
  queue: [],
  results: new Map(),
  entities: [],
  report: null,
  fromLastRun: false,
  rechecking: [],
};

export function useGPCapabilities() {
  const [state, setState] = useState<GPState>(initial);
  const [employees, setEmployees] = useState<EmployeeState>({ byCountry: {}, creating: null });
  const [checks, setChecks] = useState<FieldCheckState>({ byKey: {}, running: null });
  // Read inside callbacks without re-creating them on every change
  const employeesRef = useRef<Record<string, GPTestEmployee>>({});
  employeesRef.current = employees.byCountry;
  const abortRef = useRef<AbortController | null>(null);
  // Storage key for the run in progress, fixed when it starts (the company could change mid-run)
  const runKeyRef = useRef<string | null>(null);

  const handleEvent = useCallback((event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "gp:start":
        setState((s) => ({
          ...s,
          status: "Loading entities and country catalog...",
          gatewayEnv: (data.gatewayEnv as string) || s.gatewayEnv,
          startedAt: (data.time as number) || Date.now(),
        }));
        break;
      case "gp:entities":
        setState((s) => ({
          ...s,
          entities: (data.entities as GPEntitySummary[]) || [],
          entitiesError: (data.error as string) || undefined,
        }));
        break;
      case "gp:collected":
        setState((s) => ({
          ...s,
          queue: (data.countries as { code: string; name: string }[]) || [],
          status: `Probing ${data.total} countries...`,
        }));
        break;
      case "gp:country": {
        const c = data as unknown as CountryCapability;
        setState((s) => {
          const results = new Map(s.results);
          results.set(c.code, c);
          return { ...s, results, status: `Probing... ${results.size}/${s.queue.length}` };
        });
        break;
      }
      case "gp:end": {
        const report = data as unknown as GPRunReport;
        if (runKeyRef.current) saveLocal(report, runKeyRef.current);
        setState((s) => ({
          ...s,
          report,
          results: new Map(report.countries.map((c) => [c.code, c])),
          status: `Complete: ${report.summary.total} countries in ${(report.summary.duration / 1000).toFixed(1)}s`,
        }));
        break;
      }
      case "gp:process-done":
        setState((s) => ({
          ...s,
          running: false,
          status: data.error
            ? `Error: ${data.error as string}`
            : data.exitCode === 130
              ? "Cancelled"
              : s.status,
        }));
        break;
    }
  }, []);

  const run = useCallback(async (scope: GPScope, countryCodes?: string[]) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    runKeyRef.current = storageKey();

    setState((s) => ({
      ...initial,
      gatewayEnv: s.gatewayEnv,
      running: true,
      scope,
      status: "Starting...",
    }));

    try {
      await streamRun({ scope, countryCodes, employments: employmentMap(employeesRef.current) }, handleEvent, abort.signal);
      setState((s) => (s.running ? { ...s, running: false } : s));
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState((s) => ({ ...s, running: false, status: "Cancelled" }));
      } else {
        setState((s) => ({ ...s, running: false, status: `Error: ${(err as Error).message}` }));
      }
    }
  }, [handleEvent]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  /**
   * Re-check one country on its own and merge the result into the current report,
   * e.g. right after a test employee is added, so the row updates without a full run.
   */
  const recheck = useCallback(async (code: string) => {
    const key = storageKey();
    setState((s) => ({ ...s, rechecking: [...new Set([...s.rechecking, code])] }));
    const merge = (c: CountryCapability) =>
      setState((s) => {
        const results = new Map(s.results);
        results.set(c.code, c);
        if (!s.report) return { ...s, results };
        const countries = [...results.values()].sort((a, b) => a.code.localeCompare(b.code));
        const report = { ...s.report, countries, summary: summarize(countries, s.report.summary.duration) };
        saveLocal(report, key);
        return { ...s, results, report };
      });
    try {
      await streamRun(
        { scope: "custom", countryCodes: [code], employments: employmentMap(employeesRef.current) },
        (event, data) => {
          if (event === "gp:country") merge(data as unknown as CountryCapability);
        },
        new AbortController().signal
      );
    } catch (err) {
      setEmployees((e) => ({ ...e, error: `Re-check of ${code} failed: ${(err as Error).message}` }));
    } finally {
      setState((s) => ({ ...s, rechecking: s.rechecking.filter((c) => c !== code) }));
    }
  }, []);

  const loadTestEmployees = useCallback(() => {
    setEmployees({ byCountry: loadEmployees(), creating: null });
    setChecks({ byKey: loadChecks(), running: null });
  }, []);

  /** Submit a country's form to its test employee without the skipped fields (writes to that employee only) */
  const runFieldCheck = useCallback(async (countryCode: string, form: GPFormKey) => {
    const code = countryCode.toUpperCase();
    const employee = employeesRef.current[code];
    if (!employee) {
      setChecks((c) => ({ ...c, error: `Create a ${code} test employee first` }));
      return;
    }
    const key = checkKey(code, form);
    setChecks((c) => ({ ...c, running: key, error: undefined }));
    try {
      const res = await fetch("/api/gp/field-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCompanyHeaders(), ...getEnvironmentHeaders() },
        body: JSON.stringify({ countryCode: code, form, employmentId: employee.employmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as Record<string, string>).error || `HTTP ${res.status}`);
      setChecks((c) => {
        const byKey = { ...c.byKey, [key]: data as FieldCheckResult };
        saveChecks(byKey);
        return { byKey, running: null };
      });
    } catch (err) {
      setChecks((c) => ({ ...c, running: null, error: `${code} check failed: ${(err as Error).message}` }));
    }
  }, []);

  /** Create a GP test employee in the connected company, then re-check that country with it */
  const createEmployee = useCallback(async (countryCode: string) => {
    const code = countryCode.trim().toUpperCase();
    setEmployees((e) => ({ ...e, creating: code, error: undefined, lastChanges: undefined }));
    try {
      const res = await fetch("/api/gp/test-employee", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCompanyHeaders(), ...getEnvironmentHeaders() },
        body: JSON.stringify({ countryCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as Record<string, string>).error || `HTTP ${res.status}`);
      const employee = data as GPTestEmployee;
      const byCountry = { ...employeesRef.current, [code]: employee };
      employeesRef.current = byCountry;
      saveEmployees(byCountry);
      setEmployees({ byCountry, creating: null, lastChanges: { countryCode: code, changes: employee.changes } });
      await recheck(code);
    } catch (err) {
      setEmployees((e) => ({ ...e, creating: null, error: (err as Error).message }));
    }
  }, [recheck]);

  /** Stop using a test employee (the employment itself stays in the sandbox company) */
  const forgetEmployee = useCallback(async (countryCode: string) => {
    const byCountry = { ...employeesRef.current };
    delete byCountry[countryCode];
    employeesRef.current = byCountry;
    saveEmployees(byCountry);
    setEmployees((e) => ({ ...e, byCountry, lastChanges: undefined, error: undefined }));
    await recheck(countryCode);
  }, [recheck]);

  /** Show a report that was published (read-only builds), instead of this browser's last run */
  const loadPublished = useCallback(async () => {
    try {
      const res = await fetch("/api/gp/guide/published", { cache: "no-store" });
      const data = await res.json();
      const report = data?.published?.report as GPRunReport | undefined;
      if (!report?.countries) {
        setState((s) => ({ ...s, status: "No country report has been published yet" }));
        return;
      }
      const normalized = normalizeReport(report);
      setState((s) => ({
        ...s,
        report: normalized,
        fromLastRun: true,
        scope: normalized.scope,
        gatewayEnv: normalized.gatewayEnv,
        entities: [],
        queue: normalized.countries.map((c) => ({ code: c.code, name: c.name })),
        results: new Map(normalized.countries.map((c) => [c.code, c])),
        status: `Published ${new Date(data.published.publishedAt).toLocaleString()}`,
      }));
    } catch (err) {
      setState((s) => ({ ...s, status: `Couldn't load published results: ${(err as Error).message}` }));
    }
  }, []);

  const loadLastRun = useCallback(() => {
    const report = loadLocal();
    if (!report) return;
    setState((s) => (s.running ? s : {
        ...s,
        report,
        fromLastRun: true,
        scope: report.scope,
        gatewayEnv: report.gatewayEnv,
        entities: report.entities,
        entitiesError: report.entitiesError,
        queue: report.countries.map((c) => ({ code: c.code, name: c.name })),
        results: new Map(report.countries.map((c) => [c.code, c])),
        status: `Last run ${new Date(report.timestamp).toLocaleString()}`,
    }));
  }, []);

  /** The final report, or a partial one built from the results so far (for exporting a cancelled run) */
  const exportable: GPRunReport | null = useMemo(() => {
    let base: GPRunReport | null = state.report;
    if (!base && state.results.size > 0) {
      const countries = [...state.results.values()].sort((a, b) => a.code.localeCompare(b.code));
      base = {
        timestamp: new Date(state.startedAt || Date.now()).toISOString(),
        gatewayEnv: state.gatewayEnv,
        scope: state.scope,
        baselineSource: GP_BASELINE_SOURCE,
        catalogAdvertisesGP: countries.some((c) => c.catalog.gpSchemasAdvertised.length > 0),
        entities: state.entities,
        entitiesError: state.entitiesError,
        summary: summarize(countries, state.startedAt ? Date.now() - state.startedAt : 0),
        countries,
      };
    }
    if (!base) return null;
    // Skipped-field check results live separately (per browser); attach them for export
    return { ...base, countries: base.countries.map((c) => withFieldChecks(c, checks.byKey)) };
  }, [state.report, state.results, state.startedAt, state.gatewayEnv, state.scope, state.entities, state.entitiesError, checks.byKey]);

  return { state, run, cancel, loadLastRun, loadPublished, exportable, employees, createEmployee, forgetEmployee, loadTestEmployees, checks, runFieldCheck };
}
