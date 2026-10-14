"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getCompanyHeaders, getCompanyOverride } from "@/components/CompanySelector";
import { getEnvironmentHeaders, getSelectedEnv } from "@/components/EnvironmentSelector";
import { normalizeReport, summarize } from "@/src/gp/evaluate";
import { GP_BASELINE_SOURCE } from "@/data/gp-capability-baseline";
import type {
  CountryCapability,
  GPEntitySummary,
  GPRunReport,
  GPScope,
} from "@/src/gp/types";

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
}

// ---------------------------------------------------------------------------
// Last run lives in this browser only, one per environment + company.
// Nothing is stored on the server, so no company or entity IDs leave the browser,
// and you never see a run someone else made against a different company.
// ---------------------------------------------------------------------------

const LS_PREFIX = "bhr_gp_last_run";

export function storageKey(): string {
  const env = getSelectedEnv();
  const company = getCompanyOverride(env)?.companySlug || "none";
  return `${LS_PREFIX}__${env}__${company}`;
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
};

export function useGPCapabilities() {
  const [state, setState] = useState<GPState>(initial);
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
      const response = await fetch("/api/gp/capabilities/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCompanyHeaders(),
          ...getEnvironmentHeaders(),
        },
        body: JSON.stringify({ scope, countryCodes }),
        signal: abort.signal,
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
              handleEvent(ev[1], JSON.parse(dt[1]));
            } catch {
              // Malformed event
            }
          }
        }
      }
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
    if (state.report) return state.report;
    if (state.results.size === 0) return null;
    const countries = [...state.results.values()].sort((a, b) => a.code.localeCompare(b.code));
    return {
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
  }, [state.report, state.results, state.startedAt, state.gatewayEnv, state.scope, state.entities, state.entitiesError]);

  return { state, run, cancel, loadLastRun, exportable };
}
