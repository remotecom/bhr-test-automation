"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getCompanyHeaders } from "@/components/CompanySelector";
import { getEnvironmentHeaders } from "@/components/EnvironmentSelector";
import { summarize } from "@/src/gp/evaluate";
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

  const loadLastRun = useCallback(async () => {
    try {
      const res = await fetch("/api/gp/capabilities/last-run");
      if (!res.ok) return;
      const report = (await res.json()) as GPRunReport;
      if (!report?.countries) return;
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
        status: `Last run ${new Date(report.timestamp).toLocaleString()} (${report.gatewayEnv}${report.companySlug ? ` · ${report.companySlug}` : ""})`,
      }));
    } catch {
      // No previous run
    }
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
