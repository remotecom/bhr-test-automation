"use client";

/**
 * Payroll (GP) tab: GP capability report.
 *
 * Layout:
 *   toolbar     run / scope / progress / export
 *   cards       Supported · Partial · Not supported · Needs attention (each one is a filter)
 *   table       supported + partial countries, with employer and employee form pills
 *   chip list   not-supported countries, compact (we already expect most countries here)
 *
 * Colour rule: red only for things someone should look at (baseline drift, probe errors).
 * "Not supported" is an expected state, so it stays neutral grey.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useGPCapabilities } from "@/hooks/useGPCapabilities";
import { getDashboardBase } from "@/components/EnvironmentSelector";
import { GP_BASELINE_COUNTRIES, GP_BASELINE_SOURCE, GP_FORMS, type GPFormDef } from "@/data/gp-capability-baseline";
import { COVERAGE_LABEL } from "@/src/gp/evaluate";
import { exportFilename, toMarkdown, toMatrixCSV, toTestCasesCSV } from "@/src/gp/export";
import type { CountryCapability, FormProbe, GPRunReport, GPScope } from "@/src/gp/types";

type View = "all" | "supported" | "partial" | "none" | "attention";

const EMPLOYER_FORMS = GP_FORMS.filter((f) => f.side === "employer");
const EMPLOYEE_FORMS = GP_FORMS.filter((f) => f.side === "employee");

const needsAttention = (c: CountryCapability) =>
  c.baseline.verdict === "drift" || c.baseline.verdict === "error" || c.coverage === "unknown";
const isPartial = (c: CountryCapability) => c.coverage === "employer_only" || c.coverage === "employee_only";
const hasInert = (c: CountryCapability) =>
  GP_FORMS.some((f) => (c.forms[f.key]?.analysis?.inertRequired.length || 0) > 0);

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function FormPill({ def, p }: { def: GPFormDef; p?: FormProbe }) {
  if (!p || p.status === "skipped") return null;
  const base = `${def.label} — ${p.form}`;
  switch (p.status) {
    case "available": {
      const inert = p.analysis?.inertRequired.length || 0;
      return (
        <span
          className={`gp-pill gp-pill-on ${inert ? "gp-pill-flag" : ""}`}
          title={`${base}\nPublished: ${p.analysis?.requiredFields.length ?? 0} required of ${p.analysis?.fieldCount ?? 0} fields${inert ? `\n${inert} inert-required field(s)` : ""}`}
        >
          {def.short}
        </span>
      );
    }
    case "requires_employment":
      return (
        <span className="gp-pill gp-pill-on gp-pill-gated" title={`${base}\nPublished. The schema can only be read for a specific employment (employment_id).`}>
          {def.short}
        </span>
      );
    case "unavailable":
      return <span className="gp-pill gp-pill-off" title={`${base}\nNot available (${p.httpStatus})`}>{def.short}</span>;
    default:
      return <span className="gp-pill gp-pill-err" title={`${base}\n${p.httpStatus ?? "ERR"} ${p.message ?? ""}`}>{def.short}</span>;
  }
}

function CoveragePill({ c }: { c: CountryCapability }) {
  const label = { full: "Full", employer_only: "Employer only", employee_only: "Employee only", none: "None", unknown: "Unknown" }[c.coverage];
  return <span className={`gp-cov gp-cov-${c.coverage}`} title={COVERAGE_LABEL[c.coverage]}>{label}</span>;
}

function EntityCell({ c }: { c: CountryCapability }) {
  const { status, entityIds } = c.entity;
  if (status === "none" || status === "unknown") return <span className="gp-muted">—</span>;
  return (
    <a
      className={status === "gp_enabled" ? "gp-entity-on" : "gp-entity-off"}
      href={`${getDashboardBase()}/legal-entities/${entityIds[0]}/?selectedTab=details`}
      target="_blank"
      rel="noopener noreferrer"
      title={status === "gp_enabled" ? "Your company has a GP-enabled entity here" : "Your company has an entity here, but GP is not enabled on it"}
      onClick={(e) => e.stopPropagation()}
    >
      {status === "gp_enabled" ? "GP on" : "GP off"}
    </a>
  );
}

function Notes({ c }: { c: CountryCapability }) {
  const items: React.ReactNode[] = [];
  if (c.baseline.verdict === "drift") {
    const failed = c.baseline.checks.filter((ch) => !ch.pass).map((ch) => ch.label.replace(" published", "")).join(", ");
    items.push(<span key="drift" className="gp-note-bad">Changed vs baseline: {failed}</span>);
  }
  if (c.baseline.verdict === "error" || c.coverage === "unknown") items.push(<span key="err" className="gp-note-bad">Probe error</span>);
  if (c.nameRequired === false) items.push(<span key="name" className="gp-note">name optional</span>);
  if (hasInert(c)) items.push(<span key="inert" className="gp-note-warn">hidden required field</span>);
  return <>{items.reduce<React.ReactNode[]>((acc, n, i) => (i ? [...acc, <span key={`s${i}`} className="gp-dot-sep"> · </span>, n] : [n]), [])}</>;
}

function FieldList({ label, fields }: { label: string; fields: string[] }) {
  if (!fields.length) return null;
  return (
    <div className="gp-fields">
      <span className="gp-fields-label">{label}:</span> {fields.map((f) => <code key={f}>{f}</code>)}
    </div>
  );
}

function Detail({ c }: { c: CountryCapability }) {
  return (
    <div className="gp-detail">
      <div className="gp-detail-col">
        <div className="gp-detail-title">Baseline</div>
        {c.baseline.checks.length === 0 && <div className="gp-muted">No baseline for {c.code}; observed only.</div>}
        {c.baseline.checks.map((ch) => (
          <div key={ch.label} className={ch.pass ? "gp-muted" : "gp-note-bad"}>
            {ch.pass ? "✓" : "✗"} {ch.label}: expected {ch.expected}, got {ch.actual}
          </div>
        ))}
        {c.baseline.note && <div className="gp-muted">{c.baseline.note}</div>}
      </div>
      <div className="gp-detail-col gp-detail-wide">
        <div className="gp-detail-title">Forms</div>
        {GP_FORMS.map((f) => {
          const p = c.forms[f.key];
          if (!p || p.status === "skipped") return null;
          return (
            <div key={f.key} className="gp-form-detail">
              <FormPill def={f} p={p} /> <code>{p.form}</code>{" "}
              <span className="gp-muted">
                {p.httpStatus ?? "ERR"}
                {p.status === "available"
                  ? ` · ${p.analysis?.requiredFields.length ?? 0} required / ${p.analysis?.fieldCount ?? 0} fields`
                  : p.message ? ` · ${p.message}` : ""}
              </span>
              {p.analysis && (
                <>
                  <FieldList label="required" fields={p.analysis.requiredFields} />
                  <FieldList label="hidden" fields={p.analysis.hiddenFields} />
                  <FieldList label="inert-required (if: false)" fields={p.analysis.inertRequired} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone, active, onClick, disabled }: {
  label: string; value: number; sub?: string; tone: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button className={`gp-card gp-card-${tone} ${active ? "gp-card-active" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="gp-card-value">{value}</span>
      <span className="gp-card-label">{label}</span>
      {sub && <span className="gp-card-sub">{sub}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function PayrollView() {
  const { state, run, cancel, loadLastRun, exportable } = useGPCapabilities();
  const { running, status, queue, results, entities, entitiesError, report, fromLastRun } = state;
  const [scope, setScope] = useState<GPScope>("baseline");
  const [custom, setCustom] = useState("GBR, DEU, ESP, HUN, LVA");
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadLastRun();
  }, [loadLastRun]);

  const all = useMemo(() => [...results.values()].sort((a, b) => a.code.localeCompare(b.code)), [results]);
  const q = search.trim().toLowerCase();
  const matchesSearch = (c: CountryCapability) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);

  const counts = useMemo(() => ({
    supported: all.filter((c) => c.coverage === "full").length,
    partial: all.filter(isPartial).length,
    none: all.filter((c) => c.coverage === "none").length,
    attention: all.filter(needsAttention).length,
  }), [all]);

  const tableRows = all.filter((c) => {
    if (!matchesSearch(c)) return false;
    switch (view) {
      case "supported": return c.coverage === "full";
      case "partial": return isPartial(c);
      case "attention": return needsAttention(c);
      case "none": return false;
      default: return c.coverage !== "none" || needsAttention(c);
    }
  });
  const unsupported = all.filter((c) => c.coverage === "none" && !needsAttention(c) && matchesSearch(c));
  const showUnsupported = view === "all" || view === "none";

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const startRun = () => {
    const codes = custom.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
    setExpanded(new Set());
    run(scope, scope === "custom" ? codes : undefined);
  };

  const doExport = (kind: "md" | "test-cases" | "matrix" | "json", r: GPRunReport) => {
    if (kind === "md") download(toMarkdown(r), exportFilename(r, "report", "md"), "text/markdown");
    else if (kind === "test-cases") download(toTestCasesCSV(r), exportFilename(r, "test-cases", "csv"), "text/csv");
    else if (kind === "matrix") download(toMatrixCSV(r), exportFilename(r, "matrix", "csv"), "text/csv");
    else download(JSON.stringify(r, null, 2), exportFilename(r, "report", "json"), "application/json");
  };

  const pick = (v: View) => setView((cur) => (cur === v ? "all" : v));
  const progress = queue.length ? Math.round((results.size / queue.length) * 100) : 0;
  const companyLine = entities.length
    ? entities.map((e) => `${e.countryCode} (GP ${e.gpEnabled ? "on" : "off"})`).join(", ")
    : entitiesError ? "not checked" : "no entities";

  return (
    <div className="suite-view">
      {/* Toolbar */}
      <div className="suite-toolbar">
        {running ? (
          <button className="btn-run-suite gp-btn-cancel" onClick={cancel}>Cancel</button>
        ) : (
          <button className="btn-run-suite" onClick={startRun}>Run GP Report</button>
        )}
        <select className="gp-select" value={scope} disabled={running} onChange={(e) => setScope(e.target.value as GPScope)}>
          <option value="baseline">Known GP countries ({GP_BASELINE_COUNTRIES.length})</option>
          <option value="all">All countries</option>
          <option value="custom">Custom list</option>
        </select>
        {scope === "custom" && (
          <input className="gp-input" value={custom} disabled={running} onChange={(e) => setCustom(e.target.value)} placeholder="GBR, DEU, ESP" />
        )}
        {running ? (
          <span className="gp-progress" title={status}>
            <span className="gp-progress-bar" style={{ width: `${progress}%` }} />
            <span className="gp-progress-text">{results.size}/{queue.length || "…"}</span>
          </span>
        ) : (
          <span className="suite-status">
            {report ? (
              <>
                {fromLastRun ? "Last run" : "Run"} {new Date(report.timestamp).toLocaleString()} · {report.gatewayEnv === "sandbox" ? "Remote sandbox" : report.gatewayEnv === "partners" ? "Partners sandbox" : report.gatewayEnv}
              </>
            ) : status}
          </span>
        )}
        <div className="gp-exports">
          {(["md", "test-cases", "matrix", "json"] as const).map((k) => (
            <button
              key={k}
              className="gp-link-btn"
              disabled={!exportable || running}
              onClick={() => exportable && doExport(k, exportable)}
              title={k === "md" ? "Markdown summary for Notion" : k === "test-cases" ? "CSV in the GP SDK Testing Guide columns" : k === "matrix" ? "CSV, one row per country" : "Raw JSON"}
            >
              {k === "md" ? "Markdown" : k === "test-cases" ? "Test cases CSV" : k === "matrix" ? "Matrix CSV" : "JSON"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="gp-cards">
        <Card label="Supported" sub="employer + employee" value={counts.supported} tone="good" active={view === "supported"} onClick={() => pick("supported")} />
        <Card label="Partial" sub="one side only" value={counts.partial} tone="warn" active={view === "partial"} onClick={() => pick("partial")} />
        <Card label="Not supported" sub="expected for most countries" value={counts.none} tone="neutral" active={view === "none"} onClick={() => pick("none")} />
        <Card
          label="Needs attention"
          sub={counts.attention ? "changed vs baseline or errored" : all.length ? "everything matches baseline" : ""}
          value={counts.attention}
          tone={counts.attention ? "bad" : "neutral"}
          active={view === "attention"}
          onClick={() => pick("attention")}
          disabled={counts.attention === 0}
        />
        <div className="gp-cards-side">
          <input className="gp-input gp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search country" />
          <div className="gp-muted gp-company" title={entitiesError || ""}>Your company: {companyLine}</div>
          <button className="gp-link-btn" onClick={() => setShowHelp((v) => !v)}>{showHelp ? "Hide" : "How to read this"}</button>
        </div>
      </div>

      {showHelp && (
        <div className="gp-help">
          <div>
            Each country is checked with <code>GET /v1/countries/&#123;cc&#125;/global_payroll_*</code> (read-only).{" "}
            <b>Supported</b> means contract details (employer) and personal details (employee) are both published.
          </div>
          <div>
            <span className="gp-pill gp-pill-on">Form</span> published ·{" "}
            <span className="gp-pill gp-pill-on gp-pill-gated">Form</span> published, schema needs an employment ·{" "}
            <span className="gp-pill gp-pill-off">Form</span> not available ·{" "}
            <span className="gp-pill gp-pill-on gp-pill-flag">Form</span> has a hidden required field ·{" "}
            <span className="gp-pill gp-pill-err">Form</span> probe error
          </div>
          <div>Baseline: {GP_BASELINE_SOURCE}. A country only turns red when it differs from the baseline or the probe fails.</div>
        </div>
      )}

      <div className="table-wrap">
        {all.length === 0 ? (
          <div className="gp-empty">
            {running ? "Probing countries…" : "No report yet. Choose a scope and click Run GP Report."}
          </div>
        ) : (
          <>
            {view !== "none" && (
              <table className="gp-table">
                <thead>
                  <tr>
                    <th className="gp-col-country">Country</th>
                    <th className="gp-col-cov">Coverage</th>
                    <th className="gp-col-forms">Employer forms</th>
                    <th className="gp-col-forms">Employee forms</th>
                    <th className="gp-col-notes">Notes</th>
                    <th className="gp-col-entity">Your entity</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 && (
                    <tr><td colSpan={6} className="gp-empty">No countries in this view.</td></tr>
                  )}
                  {tableRows.map((c) => {
                    const open = expanded.has(c.code);
                    return (
                      <React.Fragment key={c.code}>
                        <tr className={`gp-row ${needsAttention(c) ? "gp-row-attention" : ""}`} onClick={() => toggle(c.code)}>
                          <td className="gp-col-country">
                            <span className="gp-caret">{open ? "▾" : "▸"}</span>
                            <span className="gp-code">{c.code}</span> <span className="gp-name">{c.name}</span>
                          </td>
                          <td className="gp-col-cov"><CoveragePill c={c} /></td>
                          <td className="gp-col-forms">{EMPLOYER_FORMS.map((f) => <FormPill key={f.key} def={f} p={c.forms[f.key]} />)}</td>
                          <td className="gp-col-forms">{EMPLOYEE_FORMS.map((f) => <FormPill key={f.key} def={f} p={c.forms[f.key]} />)}</td>
                          <td className="gp-col-notes"><Notes c={c} /></td>
                          <td className="gp-col-entity"><EntityCell c={c} /></td>
                        </tr>
                        {open && (
                          <tr className="gp-detail-row"><td colSpan={6}><Detail c={c} /></td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}

            {showUnsupported && unsupported.length > 0 && (
              <div className="gp-unsupported">
                <div className="gp-unsupported-title">
                  Not supported ({unsupported.length}) <span className="gp-muted">· no GP contract or personal details form published</span>
                </div>
                <div className="gp-chip-list">
                  {unsupported.map((c) => (
                    <span key={c.code} className="gp-country-chip" title={`${c.name}${c.baseline.note ? `\n${c.baseline.note}` : ""}`}>
                      {c.code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
