"use client";

/**
 * Test cases view on the Payroll tab: the GP SDK testing guide (data/gp-guide), with the latest
 * automated check per row.
 *
 *   toolbar     Run checks / Publish (local runs only) · published date · Download .xlsx
 *   status bar  count per status; each one is a filter
 *   tabs        the sheet's tabs, plus Country coverage
 *   table       one row per case; click to expand evidence, notes and the automated check
 *
 * A row's status is the guide's (a person's call). An automated check is shown beside it:
 * green when the API still matches what the guide records, red when it differs.
 */

import React, { useMemo, useState } from "react";
import { useGPGuide } from "@/hooks/useGPGuide";
import { GUIDE_METHODS, GUIDE_STATUSES, GUIDE_TABS, type GuideCase, type GuideStatus, type GuideTabKey } from "@/src/gp/guide/types";
import type { GuideCheckResult } from "@/src/gp/guide/checks";
import type { GPRunReport } from "@/src/gp/types";

type TabKey = GuideTabKey | "coverage";

const STATUS_CLASS: Record<GuideStatus, string> = {
  Verified: "gg-st-verified",
  "Known issue": "gg-st-known",
  "Fixed, re-verify": "gg-st-reverify",
  Untested: "gg-st-untested",
  "Requires Remote": "gg-st-remote",
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** Badge text and tone for an automated check, worded against the row it belongs to */
function checkBadge(c: GuideCase, r: GuideCheckResult): { text: string; cls: string } {
  switch (r.outcome) {
    case "as_recorded":
      return { text: c.status === "Untested" ? "Behaves as expected" : "Matches the guide", cls: "gg-chk-good" };
    case "differs":
      return { text: "Differs from the guide", cls: "gg-chk-bad" };
    case "inconclusive":
      return { text: "Inconclusive", cls: "gg-chk-warn" };
    case "skipped":
      return { text: "Not run", cls: "gg-chk-muted" };
    default:
      return { text: "Check failed", cls: "gg-chk-bad" };
  }
}

function Field({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="gg-field">
      <div className="gp-detail-title">{label}</div>
      <div className="gg-field-text">{text}</div>
    </div>
  );
}

function CaseDetail({ c, check, automatedLabel, unpublished }: { c: GuideCase; check?: GuideCheckResult; automatedLabel?: string; unpublished: boolean }) {
  return (
    <div className="gg-detail">
      <div className="gg-detail-col">
        <Field label="Input data" text={c.input} />
        <Field label="Expected outcome" text={c.expected} />
        <Field label="Remote response" text={c.response} />
      </div>
      <div className="gg-detail-col">
        <Field label="Blocking logic / notes" text={c.notes} />
        <Field label="Comments" text={c.comments} />
        {automatedLabel && (
          <div className="gg-field">
            <div className="gp-detail-title">Automated check</div>
            <div className="gg-field-text gp-muted">{automatedLabel}.</div>
            {check ? (
              <div className="gg-field-text">
                <span className={checkBadge(c, check).cls}>{checkBadge(c, check).text}</span>
                <span className="gp-muted"> · {fmtDate(check.checkedAt)}{unpublished ? " · not published yet" : ""}</span>
                <div>{check.summary}</div>
                {check.details.map((d, i) => <div key={i} className="gp-muted">{d}</div>)}
                {check.requestIds?.length ? <div className="gp-muted">Request IDs: {check.requestIds.join(", ")}</div> : null}
              </div>
            ) : (
              <div className="gg-field-text gp-muted">Not run yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GuideView({ runsEnabled, employments, report }: {
  runsEnabled: boolean;
  /** Test employees by country (employment IDs), from the Countries view */
  employments: Record<string, string>;
  /** The current country report, published along with the checks */
  report: GPRunReport | null;
}) {
  const { state, run, publish } = useGPGuide();
  const { guide, published, automated, local, running, publishing, message } = state;
  const [tab, setTab] = useState<TabKey>("admin");
  const [statusFilter, setStatusFilter] = useState<GuideStatus | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Latest result per case: this browser's unpublished ones (local runs) over the published ones
  const checks = useMemo(() => {
    const byId: Record<string, GuideCheckResult> = Object.fromEntries((published?.checks || []).map((c) => [c.caseId, c]));
    if (runsEnabled) Object.assign(byId, local);
    return byId;
  }, [published, local, runsEnabled]);

  const counts = useMemo(() => {
    const out = Object.fromEntries(GUIDE_STATUSES.map((s) => [s, 0])) as Record<GuideStatus, number>;
    for (const c of guide?.cases || []) out[c.status]++;
    return out;
  }, [guide]);
  const differs = Object.values(checks).filter((r) => r.outcome === "differs").map((r) => r.caseId);

  if (!guide) {
    return <div className="gp-empty">{message?.text || "Loading the testing guide…"}</div>;
  }

  const sdk = guide.overview.find((r) => r.label === "SDK version")?.value;
  const env = guide.overview.find((r) => r.label === "Environment")?.value;
  const rows = guide.cases.filter((c) => (statusFilter ? c.status === statusFilter : c.tab === tab));
  const unpublishedCount = runsEnabled ? Object.keys(local).length : 0;
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="gg-view">
      <div className="suite-toolbar">
        {runsEnabled && (
          <>
            <button
              className="btn-run-suite"
              disabled={running || publishing}
              onClick={() => run(employments)}
              title={`Runs the automated checks (${Object.keys(automated).join(", ")}) against your test company. Some save forms to your test employees.`}
            >
              {running ? "Running checks…" : "Run checks"}
            </button>
            <button
              className="gg-btn"
              disabled={running || publishing || (unpublishedCount === 0 && !report)}
              onClick={() => publish(report)}
              title="Writes data/gp-guide/published.json with these results and the current country report (no company, entity or employee IDs). Commit it and deploy to share it with partners."
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          </>
        )}
        <span className="suite-status">
          {published?.publishedAt ? `Results published ${fmtDate(published.publishedAt)}` : "No automated results published yet"}
          {unpublishedCount > 0 && <span className="gp-note-warn"> · {unpublishedCount} unpublished</span>}
          {differs.length > 0 && <span className="gp-note-bad"> · differs from the guide: {differs.join(", ")}</span>}
        </span>
        <div className="gp-exports">
          <a className="gp-link-btn gg-link" href="/api/gp/guide/xlsx" title="The testing guide as an Excel file, the same layout as the Google Sheet, with the latest automated check per row">
            Download .xlsx
          </a>
        </div>
      </div>
      {message && <div className={`gg-msg ${message.tone === "bad" ? "gp-note-bad" : "gp-note-good"}`}>{message.text}</div>}

      <div className="gg-intro gp-muted">
        <strong className="gg-title">{guide.title}</strong> · {guide.subtitle}
        {sdk && <div>SDK: {sdk}</div>}
        {env && <div>{env}</div>}
      </div>

      <div className="gg-statuses">
        {GUIDE_STATUSES.map((s) => (
          <button
            key={s}
            className={`gg-status ${STATUS_CLASS[s]} ${statusFilter === s ? "gg-status-active" : ""}`}
            onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
            disabled={counts[s] === 0}
            title={guide.statusLegend.find((l) => l.status === s)?.meaning}
          >
            <span className="gg-status-n">{counts[s]}</span> {s}
          </button>
        ))}
      </div>

      {!statusFilter && (
        <div className="gg-tabs">
          {GUIDE_TABS.map((t) => (
            <button key={t.key} className={`gg-tab ${tab === t.key ? "gg-tab-active" : ""}`} onClick={() => setTab(t.key)}>
              {t.short} <span className="gp-muted">{guide.cases.filter((c) => c.tab === t.key).length}</span>
            </button>
          ))}
          <button className={`gg-tab ${tab === "coverage" ? "gg-tab-active" : ""}`} onClick={() => setTab("coverage")}>Country coverage</button>
        </div>
      )}
      {statusFilter && (
        <div className="gg-tabs">
          <span className="gp-muted">Showing every case marked “{statusFilter}”.</span>{" "}
          <button className="gp-link-btn" onClick={() => setStatusFilter(null)}>Show all</button>
        </div>
      )}

      <div className="table-wrap">
        {tab === "coverage" && !statusFilter ? (
          <div className="gg-coverage">
            <div className="gp-muted gg-coverage-intro">{guide.coverage.intro}</div>
            <table className="gp-table gg-table">
              <thead>
                <tr><th className="gg-w-measure">Measure</th><th className="gg-w-count">Count</th><th>Countries</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {guide.coverage.rows.map((r) => (
                  <tr key={r.measure}>
                    <td>{r.measure}</td>
                    <td>{r.count ?? ""}</td>
                    <td className="gg-wrap">{r.countries}</td>
                    <td className="gg-wrap gp-muted">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <table className="gp-table gg-table">
            <thead>
              <tr>
                <th className="gg-w-id">#</th>
                <th>Scenario</th>
                <th className="gg-w-status">Status</th>
                <th className="gg-w-check gp-hide-sm">Automated check</th>
                <th className="gg-w-how gp-hide-md">How tested</th>
                <th className="gg-w-date gp-hide-md">Last checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const open = expanded.has(c.id);
                const check = checks[c.id];
                const badge = check ? checkBadge(c, check) : null;
                return (
                  <React.Fragment key={c.id}>
                    <tr className={`gp-row ${check?.outcome === "differs" ? "gp-row-attention" : ""}`} onClick={() => toggle(c.id)}>
                      <td><span className="gp-caret">{open ? "▾" : "▸"}</span><span className="gp-code">{c.id}</span></td>
                      <td className="gg-wrap">
                        {c.scenario}
                        <div className="gg-expected gp-muted">{c.expected}</div>
                      </td>
                      <td><span className={`gg-pill ${STATUS_CLASS[c.status]}`}>{c.status}</span></td>
                      <td className="gp-hide-sm gg-wrap">
                        {badge ? (
                          <span className={badge.cls} title={`${check!.summary}\n${fmtDate(check!.checkedAt)}`}>{badge.text}</span>
                        ) : automated[c.id] ? (
                          <span className="gp-muted">Not run yet</span>
                        ) : (
                          <span className="gp-muted">Manual</span>
                        )}
                      </td>
                      <td className="gp-hide-md gp-muted">{c.method ? GUIDE_METHODS[c.method] : ""}</td>
                      <td className="gp-hide-md gp-muted">{fmtDate(c.lastChecked)}</td>
                    </tr>
                    {open && (
                      <tr className="gp-detail-row">
                        <td colSpan={6}>
                          <CaseDetail c={c} check={check} automatedLabel={automated[c.id]} unpublished={runsEnabled && !!local[c.id]} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
