"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useGPCapabilities } from "@/hooks/useGPCapabilities";
import { getDashboardBase } from "@/components/EnvironmentSelector";
import { GP_BASELINE_COUNTRIES, GP_BASELINE_SOURCE, GP_FORMS } from "@/data/gp-capability-baseline";
import { COVERAGE_LABEL } from "@/src/gp/evaluate";
import {
  exportFilename,
  toMarkdown,
  toMatrixCSV,
  toTestCasesCSV,
} from "@/src/gp/export";
import type { CountryCapability, FormProbe, GPRunReport, GPScope } from "@/src/gp/types";

type Filter = "all" | "drift" | "full" | "partial" | "none" | "entity" | "signals";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "drift", label: "Drift / errors" },
  { key: "full", label: "Full" },
  { key: "partial", label: "Partial" },
  { key: "none", label: "Not supported" },
  { key: "entity", label: "Has company entity" },
  { key: "signals", label: "Schema signals" },
];

const COVERAGE_SHORT: Record<string, string> = {
  full: "Full",
  employer_only: "Employer",
  employee_only: "Employee",
  none: "None",
  unknown: "Unknown",
};

function hasSignals(c: CountryCapability): boolean {
  return GP_FORMS.some((f) => (c.forms[f.key]?.analysis?.inertRequired.length || 0) > 0);
}

function matchesFilter(c: CountryCapability, f: Filter): boolean {
  switch (f) {
    case "drift": return c.baseline.verdict === "drift" || c.baseline.verdict === "error";
    case "full": return c.coverage === "full";
    case "partial": return c.coverage === "employer_only" || c.coverage === "employee_only";
    case "none": return c.coverage === "none";
    case "entity": return c.entity.status === "gp_enabled" || c.entity.status === "entity_no_gp";
    case "signals": return hasSignals(c);
    default: return true;
  }
}

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

function VerdictIcon({ c, pending }: { c?: CountryCapability; pending: boolean }) {
  if (!c) return pending ? <span className="st-running">●</span> : <span className="st-pending">○</span>;
  switch (c.baseline.verdict) {
    case "match": return <span className="st-pass" title="Matches baseline">✓</span>;
    case "drift": return <span className="st-fail" title="Differs from baseline">✗</span>;
    case "error": return <span className="st-fail" title="Probe error">!</span>;
    default: return <span className="gp-observed" title="No baseline; observed only">◆</span>;
  }
}

function FormDot({ p }: { p?: FormProbe }) {
  if (!p) return <span className="st-pending">·</span>;
  const title = `${p.form}: ${p.httpStatus ?? ""} ${p.message ?? ""}`.trim();
  switch (p.status) {
    case "available": {
      const inert = p.analysis?.inertRequired.length || 0;
      return (
        <span className="gp-form-yes" title={`${title} (${p.analysis?.requiredFields.length ?? 0} required / ${p.analysis?.fieldCount ?? 0} fields)`}>
          ●{inert > 0 && <sup className="gp-sup">!</sup>}
        </span>
      );
    }
    case "unavailable": return <span className="gp-form-no" title={title}>○</span>;
    case "skipped": return <span className="gp-form-na" title="Not probed for this country">–</span>;
    default: return <span className="gp-form-err" title={title}>!</span>;
  }
}

function EntityCell({ c }: { c: CountryCapability }) {
  const { status, entityIds } = c.entity;
  if (status === "none") return <span className="gp-muted">–</span>;
  if (status === "unknown") return <span className="gp-muted">?</span>;
  const id = entityIds[0];
  const label = status === "gp_enabled" ? "GP ✓" : "GP off";
  return (
    <a
      className={status === "gp_enabled" ? "gp-entity-on" : "gp-entity-off"}
      href={`${getDashboardBase()}/legal-entities/${id}/?selectedTab=details`}
      target="_blank"
      rel="noopener noreferrer"
      title={entityIds.join(", ")}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}

function FieldList({ label, fields }: { label: string; fields: string[] }) {
  if (!fields.length) return null;
  return (
    <div className="gp-fields">
      <span className="gp-fields-label">{label}:</span>{" "}
      {fields.map((f) => <code key={f}>{f}</code>)}
    </div>
  );
}

function DetailRow({ c, colSpan }: { c: CountryCapability; colSpan: number }) {
  return (
    <tr className="gp-detail-row">
      <td colSpan={colSpan}>
        <div className="gp-detail">
          <div className="gp-detail-col">
            <div className="gp-detail-title">Baseline</div>
            {c.baseline.checks.length === 0 && <div className="gp-muted">No baseline for {c.code}. Results are observed only.</div>}
            {c.baseline.checks.map((ch) => (
              <div key={ch.label} className={ch.pass ? "out-match" : "out-mismatch"}>
                {ch.pass ? "✓" : "✗"} {ch.label}: expected {ch.expected}, got {ch.actual}
              </div>
            ))}
            {c.baseline.note && <div className="gp-muted">{c.baseline.note}</div>}
            <div className="gp-detail-title" style={{ marginTop: 8 }}>Catalog</div>
            <div className="gp-muted">
              {c.catalog.inCatalog ? "In /v1/countries" : "Not in /v1/countries"}
              {c.catalog.eorOnboarding !== undefined && ` · eor_onboarding: ${c.catalog.eorOnboarding}`}
              {` · supported_json_schemas GP: ${c.catalog.gpSchemasAdvertised.join(", ") || "none"}`}
            </div>
          </div>
          <div className="gp-detail-col gp-detail-wide">
            <div className="gp-detail-title">Forms</div>
            {GP_FORMS.map((f) => {
              const p = c.forms[f.key];
              if (!p || p.status === "skipped") return null;
              return (
                <div key={f.key} className="gp-form-detail">
                  <div>
                    <FormDot p={p} /> <code>{p.form}</code>{" "}
                    <span className="gp-muted">
                      {p.httpStatus ?? "ERR"}
                      {p.status === "available"
                        ? ` · ${p.analysis?.requiredFields.length ?? 0} required / ${p.analysis?.fieldCount ?? 0} fields`
                        : p.message ? ` · ${p.message}` : ""}
                    </span>
                  </div>
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
      </td>
    </tr>
  );
}

export default function PayrollView() {
  const { state, run, cancel, loadLastRun, exportable } = useGPCapabilities();
  const { running, status, queue, results, entities, entitiesError } = state;
  const [scope, setScope] = useState<GPScope>("baseline");
  const [custom, setCustom] = useState("GBR, DEU, ESP, HUN, LVA");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadLastRun();
  }, [loadLastRun]);

  const summary = exportable?.summary;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter((item) => {
      if (q && !item.code.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      if (filter === "all") return true;
      const c = results.get(item.code);
      return c ? matchesFilter(c, filter) : false;
    });
  }, [queue, results, filter, search]);

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const startRun = () => {
    const codes = custom.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{3}$/.test(s));
    run(scope, scope === "custom" ? codes : undefined);
  };

  const doExport = (kind: "md" | "test-cases" | "matrix" | "json", r: GPRunReport) => {
    if (kind === "md") download(toMarkdown(r), exportFilename(r, "report", "md"), "text/markdown");
    else if (kind === "test-cases") download(toTestCasesCSV(r), exportFilename(r, "test-cases", "csv"), "text/csv");
    else if (kind === "matrix") download(toMatrixCSV(r), exportFilename(r, "matrix", "csv"), "text/csv");
    else download(JSON.stringify(r, null, 2), exportFilename(r, "report", "json"), "application/json");
  };

  const gpEntities = entities.filter((e) => e.gpEnabled);
  const otherEntities = entities.filter((e) => !e.gpEnabled);
  const COLS = 7 + GP_FORMS.length;

  return (
    <div className="suite-view">
      <div className="suite-toolbar">
        {running ? (
          <button className="btn-run-suite gp-btn-cancel" onClick={cancel}>Cancel</button>
        ) : (
          <button className="btn-run-suite" onClick={startRun}>Run GP Report</button>
        )}
        <select
          className="gp-select"
          value={scope}
          disabled={running}
          onChange={(e) => setScope(e.target.value as GPScope)}
          title="Which countries to probe"
        >
          <option value="baseline">Baseline countries ({GP_BASELINE_COUNTRIES.length}) + company entities</option>
          <option value="all">All catalog countries (slow)</option>
          <option value="custom">Custom list</option>
        </select>
        {scope === "custom" && (
          <input
            className="gp-input"
            value={custom}
            disabled={running}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="GBR, DEU, ESP"
            title="ISO alpha-3 codes, comma separated"
          />
        )}
        <span className="suite-status">{status}</span>
        {summary && (
          <div className="suite-counts">
            <span className="pass" title="Full coverage">Full {summary.full}</span>
            <span className="skip" title="Employer or employee only">Partial {summary.employerOnly + summary.employeeOnly}</span>
            <span className="time" title="Not supported">None {summary.none}</span>
            <span className="gp-sep">|</span>
            <span className="pass" title="Matches baseline">✓ {summary.match}</span>
            <span className="fail" title="Drift from baseline">✗ {summary.drift}</span>
            {summary.errors > 0 && <span className="fail" title="Probe errors">! {summary.errors}</span>}
          </div>
        )}
      </div>

      <div className="gp-subbar">
        <div className="gp-chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`gp-chip ${filter === f.key ? "gp-chip-on" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            className="gp-input gp-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country"
          />
        </div>
        <div className="gp-exports">
          <span className="gp-muted">Export:</span>
          {(["md", "test-cases", "matrix", "json"] as const).map((k) => (
            <button
              key={k}
              className="gp-chip"
              disabled={!exportable || running}
              onClick={() => exportable && doExport(k, exportable)}
              title={
                k === "md" ? "Markdown summary, for pasting into Notion"
                : k === "test-cases" ? "CSV in the GP SDK Testing Guide columns"
                : k === "matrix" ? "CSV with one row per country and every column"
                : "Raw JSON report"
              }
            >
              {k === "md" ? "Markdown" : k === "test-cases" ? "Test cases CSV" : k === "matrix" ? "Matrix CSV" : "JSON"}
            </button>
          ))}
        </div>
      </div>

      <div className="gp-info">
        <span>
          Read-only probe of <code>GET /v1/countries/&#123;cc&#125;/global_payroll_*</code>. ● published · ○ not available (404/422) · ! error · <sup className="gp-sup">!</sup> inert-required fields.
          Coverage is Full when contract details (employer) and personal details (employee) are both published. Baseline: {GP_BASELINE_SOURCE}.
        </span>
        <span>
          Company GP entities:{" "}
          {gpEntities.length ? gpEntities.map((e) => <span key={e.id} className="gp-entity-on">{e.countryCode} </span>) : <span className="gp-muted">none</span>}
          {otherEntities.length > 0 && (
            <> · GP off: {otherEntities.map((e) => <span key={e.id} className="gp-entity-off">{e.countryCode} </span>)}</>
          )}
          {entitiesError && <span className="gp-form-err"> ({entitiesError})</span>}
        </span>
      </div>

      <div className="table-wrap">
        <table className="gp-table">
          <thead>
            <tr>
              <th className="col-st"></th>
              <th className="gp-col-code">Code</th>
              <th className="gp-col-name">Country</th>
              <th className="gp-col-entity">Company</th>
              <th className="gp-col-cov">Coverage</th>
              {GP_FORMS.map((f) => (
                <th key={f.key} className="gp-col-form" title={`${f.form} (${f.side})`}>{f.short}</th>
              ))}
              <th className="gp-col-form" title="Personal details requires name">name</th>
              <th className="gp-col-base">Baseline</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS} className="gp-empty">
                  {queue.length === 0
                    ? "No report yet. Choose a scope and click Run GP Report."
                    : "No countries match this filter."}
                </td>
              </tr>
            )}
            {rows.map((item) => {
              const c = results.get(item.code);
              const open = !!c && expanded.has(item.code);
              return (
                <React.Fragment key={item.code}>
                  <tr className={c ? "has-error" : ""} onClick={c ? () => toggle(item.code) : undefined}>
                    <td className="col-st"><VerdictIcon c={c} pending={running} /></td>
                    <td className="gp-col-code"><span className="tid">{item.code}</span></td>
                    <td className="gp-col-name">{item.name}</td>
                    <td className="gp-col-entity">{c && <EntityCell c={c} />}</td>
                    <td className="gp-col-cov">
                      {c && (
                        <span className={`gp-cov gp-cov-${c.coverage}`} title={COVERAGE_LABEL[c.coverage]}>
                          {COVERAGE_SHORT[c.coverage]}
                        </span>
                      )}
                    </td>
                    {GP_FORMS.map((f) => (
                      <td key={f.key} className="gp-col-form">{c && <FormDot p={c.forms[f.key]} />}</td>
                    ))}
                    <td className="gp-col-form">
                      {c && (c.nameRequired === null ? <span className="gp-form-na">–</span> : c.nameRequired ? "req" : <span className="gp-muted">opt</span>)}
                    </td>
                    <td className="gp-col-base">
                      {c && (
                        <span className={c.baseline.verdict === "match" ? "out-match" : c.baseline.verdict === "no_baseline" ? "gp-muted" : "out-mismatch"}>
                          {c.baseline.verdict === "match" ? "match" : c.baseline.verdict === "no_baseline" ? "observed" : c.baseline.verdict}
                        </span>
                      )}
                      {c && <span className="error-hint" style={{ marginLeft: 6 }}>{open ? "▾" : "▸"}</span>}
                    </td>
                  </tr>
                  {open && c && <DetailRow c={c} colSpan={COLS} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
