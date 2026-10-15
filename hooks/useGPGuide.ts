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

  /** Run the automated checks with the connected company and its test employees */
  const run = useCallback(async (employments: Record<string, string>) => {
    setState((s) => ({ ...s, running: true, message: undefined }));
    try {
      const res = await fetch("/api/gp/guide/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCompanyHeaders(), ...getEnvironmentHeaders() },
        body: JSON.stringify({ employments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const results = (data.results || []) as GuideCheckResult[];
      setState((s) => {
        const local = { ...s.local, ...Object.fromEntries(results.map((r) => [r.caseId, r])) };
        saveLocalChecks(local);
        const differs = results.filter((r) => r.outcome === "differs").map((r) => r.caseId);
        return {
          ...s, local, running: false,
          message: differs.length
            ? { tone: "bad", text: `Ran ${results.length} checks. Differs from the guide: ${differs.join(", ")}` }
            : { tone: "good", text: `Ran ${results.length} checks. Nothing differs from the guide.` },
        };
      });
    } catch (err) {
      setState((s) => ({ ...s, running: false, message: { tone: "bad", text: `Checks failed: ${(err as Error).message}` } }));
    }
  }, []);

  /**
   * Publish this browser's results (on top of what's already published) and the country report.
   * Writes data/gp-guide/published.json; commit it to share.
   */
  const publish = useCallback(async (report: GPRunReport | null) => {
    setState((s) => ({ ...s, publishing: true, message: undefined }));
    try {
      const current = state.published;
      const byId = { ...Object.fromEntries((current?.checks || []).map((c) => [c.caseId, c])), ...state.local };
      const res = await fetch("/api/gp/guide/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: report || current?.report, checks: Object.values(byId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      saveLocalChecks({});
      setState((s) => ({
        ...s, local: {}, publishing: false,
        message: { tone: "good", text: `Published ${data.checks} checks and ${data.countries} countries to ${data.file}. Commit that file and deploy to share it.` },
      }));
      await load();
    } catch (err) {
      setState((s) => ({ ...s, publishing: false, message: { tone: "bad", text: `Publish failed: ${(err as Error).message}` } }));
    }
  }, [state.published, state.local, load]);

  return { state, run, publish, reload: load };
}
