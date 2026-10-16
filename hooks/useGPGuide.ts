"use client";

/**
 * Testing guide state for the Payroll tab: the guide, the published results, and (where runs are
 * enabled) this browser's unpublished check results plus run and publish actions.
 */

import { useCallback, useEffect, useState } from "react";
import { getCompanyHeaders, getCompanyOverride } from "@/components/CompanySelector";
import { getEnvironmentHeaders, getSelectedEnv } from "@/components/EnvironmentSelector";
import type { Guide } from "@/src/gp/guide/types";
import type { GuideCheckResult } from "@/src/gp/guide/checks";
import type { GuidePublished } from "@/src/gp/guide/publish";
import type { GPRunReport } from "@/src/gp/types";

export interface GuideState {
  guide: Guide | null;
  published: GuidePublished | null;
  /** Case ID -> what its automated check does */
  automated: Record<string, string>;
  /** Unpublished results from this browser, by case ID */
  local: Record<string, GuideCheckResult>;
  running: boolean;
  publishing: boolean;
  message?: { tone: "good" | "bad"; text: string };
}

const LS_PREFIX = "bhr_gp_guide_checks";
const localKey = () => {
  const env = getSelectedEnv();
  return `${LS_PREFIX}__${env}__${getCompanyOverride(env)?.companySlug || "none"}`;
};

function loadLocalChecks(): Record<string, GuideCheckResult> {
  try {
    const parsed = JSON.parse(localStorage.getItem(localKey()) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalChecks(byId: Record<string, GuideCheckResult>) {
  try {
    localStorage.setItem(localKey(), JSON.stringify(byId));
  } catch {
    // Unavailable storage: results still show until the page reloads
  }
}

export function useGPGuide() {
  const [state, setState] = useState<GuideState>({ guide: null, published: null, automated: {}, local: {}, running: false, publishing: false });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gp/guide/published", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setState((s) => ({ ...s, guide: data.guide, published: data.published, automated: data.automated || {} }));
    } catch (err) {
      setState((s) => ({ ...s, message: { tone: "bad", text: `Couldn't load the testing guide: ${(err as Error).message}` } }));
    }
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, local: loadLocalChecks() }));
    load();
  }, [load]);

  /** Run the automated checks with the connected company and its test employees (ids: a subset, e.g. the flow checks) */
  const run = useCallback(async (employments: Record<string, string>, ids?: string[]) => {
    setState((s) => ({ ...s, running: true, message: undefined }));
    try {
      const res = await fetch("/api/gp/guide/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCompanyHeaders(), ...getEnvironmentHeaders() },
        body: JSON.stringify(ids ? { employments, ids } : { employments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const results = (data.results || []) as GuideCheckResult[];
      setState((s) => {
        const local = { ...s.local, ...Object.fromEntries(results.map((r) => [r.caseId, r])) };
        saveLocalChecks(local);
        const differs = results.filter((r) => r.outcome === "differs").map((r) => r.caseId);
        const observed = results.filter((r) => r.outcome === "observed").map((r) => r.caseId);
        const newText = observed.length ? ` New behaviour to review: ${observed.join(", ")}.` : "";
        return {
          ...s, local, running: false,
          message: differs.length
            ? { tone: "bad", text: `Ran ${results.length} checks. Differs from the guide: ${differs.join(", ")}.${newText}` }
            : { tone: "good", text: `Ran ${results.length} checks. Nothing differs from the guide.${newText}` },
        };
      });
    } catch (err) {
      setState((s) => ({ ...s, running: false, message: { tone: "bad", text: `Checks failed: ${(err as Error).message}` } }));
    }
  }, []);

  /**
   * Publish this browser's results (on top of what's already published) and the country report.
   * Live at once with Vercel Blob set up; otherwise saved to data/gp-guide/published.json to commit.
   */
  const publish = useCallback(async (report: GPRunReport | null) => {
    setState((s) => ({ ...s, publishing: true, message: undefined }));
    try {
      // The server merges onto what's already published, so only this browser's results are sent
      const res = await fetch("/api/gp/guide/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, checks: Object.values(state.local) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      saveLocalChecks({});
      setState((s) => ({
        ...s, local: {}, publishing: false, published: data.published ?? s.published,
        message: {
          tone: "good",
          text: data.storage === "blob"
            ? `Published ${data.checks} checks and ${data.countries} countries. Partners see them now.`
            : `Saved ${data.checks} checks and ${data.countries} countries to data/gp-guide/published.json. No results store is set up yet, so commit and deploy that file to share it.`,
        },
      }));
    } catch (err) {
      setState((s) => ({ ...s, publishing: false, message: { tone: "bad", text: `Publish failed: ${(err as Error).message}` } }));
    }
  }, [state.local]);

  return { state, run, publish, reload: load };
}
