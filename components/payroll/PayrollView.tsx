"use client";

/**
 * Payroll (GP) tab: GP capability report.
 *
 * Layout:
 *   toolbar     run / scope / progress / export
 *   cards       Supported · Partial · Not supported · Needs attention (each one is a filter)
 *   employees   GP test employees: some forms can only be read (or change) for a specific employee
 *   table       supported + partial countries, with employer and employee form pills
 *   chip list   not-supported countries, compact (we already expect most countries here)
 *
 * Colour rule: red only for things someone should look at (baseline drift, probe errors).
 * "Not supported" is an expected state, so it stays neutral grey.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useGPCapabilities, type EmployeeState } from "@/hooks/useGPCapabilities";
import { getDashboardBase } from "@/components/EnvironmentSelector";
import { GP_BASELINE_COUNTRIES, GP_BASELINE_SOURCE, GP_FORMS, type GPFormDef } from "@/data/gp-capability-baseline";
import { COVERAGE_LABEL } from "@/src/gp/evaluate";
import { exportFilename, toMarkdown, toMatrixCSV, toTestCasesCSV } from "@/src/gp/export";
import type { CountryCapability, FormProbe, GPRunReport, GPScope } from "@/src/gp/types";
import type { GPTestEmployee } from "@/src/gp/test-employee";

type View = "all" | "supported" | "partial" | "none" | "attention";

const EMPLOYER_FORMS = GP_FORMS.filter((f) => f.side === "employer");
const EMPLOYEE_FORMS = GP_FORMS.filter((f) => f.side === "employee");

const needsAttention = (c: CountryCapability) =>
  c.baseline.verdict === "drift" || c.baseline.verdict === "error" || c.coverage === "unknown";
const isPartial = (c: CountryCapability) => c.coverage === "employer_only" || c.coverage === "employee_only";
/** Fields a form never asks for, although its schema lists them as required under a switched-off rule */
const skippedFields = (c: CountryCapability) =>
  GP_FORMS.flatMap((f) => c.forms[f.key]?.analysis?.inertRequired || []);
const SKIP_EXPLAIN =
  "The form never asks for these fields, but its schema still lists them as required under a rule that is switched off. " +
  "If the API still requires them, submitting the form fails with a 422 even though the form looked complete. Not tested yet.";
/** A form that is published but can only be read for a specific employee */
const needsEmployee = (c: CountryCapability) =>
  GP_FORMS.some((f) => c.forms[f.key]?.status === "requires_employment");
const shortId = (id: string) => id.slice(0, 8);

/** Callbacks and state each row needs for test employees */
interface EmployeeCtx {
  employees: EmployeeState;
  rechecking: string[];
  onCreate: (code: string) => void;
}

function CreateEmployeeButton({ code, ctx, label }: { code: string; ctx: EmployeeCtx; label?: string }) {
  const busy = ctx.employees.creating === code;
  return (
    <button
      className="gp-mini-btn"
      disabled={!!ctx.employees.creating}
      title={`Creates a Global Payroll test employee in ${code} in your test company, then re-checks ${code}'s forms for that employee`}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onCreate(code);
      }}
    >
      {busy ? "Creating…" : label || `Create ${code} test employee`}
    </button>
  );
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

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function FormPill({ def, p }: { def: GPFormDef; p?: FormProbe }) {
  if (!p || p.status === "skipped") return null;
  const base = `${def.label} — ${p.form}${p.employmentId ? `\nRead for test employee ${shortId(p.employmentId)}` : ""}`;
  switch (p.status) {
    case "available": {
      const inert = p.analysis?.inertRequired.length || 0;
      return (
        <span
          className="gp-pill gp-pill-on"
          title={`${base}\nPublished: ${p.analysis?.requiredFields.length ?? 0} required of ${p.analysis?.fieldCount ?? 0} fields${inert ? `\nSkips ${p.analysis!.inertRequired.join(", ")}, which the API may still require` : ""}`}
        >
          {def.short}
        </span>
      );
    }
    case "requires_employment":
      return (
        <span className="gp-pill gp-pill-on gp-pill-dashed" title={`${base}\nPublished, but the form can only be read for a specific employee. Create a test employee in this country to see it.`}>
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
      title={status === "gp_enabled" ? "Your test company has a GP-enabled entity here" : "Your test company has an entity here, but GP is not switched on for it. This doesn't affect the report."}
      onClick={(e) => e.stopPropagation()}
    >
      {status === "gp_enabled" ? "GP enabled" : "GP not enabled"}
    </a>
  );
}

function Notes({ c, ctx }: { c: CountryCapability; ctx: EmployeeCtx }) {
  const items: React.ReactNode[] = [];
  const employee = ctx.employees.byCountry[c.code];
  if (ctx.rechecking.includes(c.code)) {
    items.push(<span key="recheck" className="gp-note">Re-checking…</span>);
  } else if (employee && c.employmentId === employee.employmentId) {
    items.push(<span key="emp" className="gp-note-good" title={`Employee-specific forms were read for test employee ${employee.employmentId}`}>Checked with test employee</span>);
  } else if (needsEmployee(c)) {
    items.push(<CreateEmployeeButton key="need" code={c.code} ctx={ctx} label="Create test employee to read contract details" />);
  }
  if (c.baseline.verdict === "drift") {
    const failed = c.baseline.checks.filter((ch) => !ch.pass).map((ch) => ch.label.replace(" published", "")).join(", ");
    items.push(<span key="drift" className="gp-note-bad">Changed vs baseline: {failed}</span>);
  }
  if (c.baseline.verdict === "error" || c.coverage === "unknown") items.push(<span key="err" className="gp-note-bad">Probe error</span>);
  if (c.nameRequired === false) items.push(<span key="name" className="gp-note">name optional</span>);
  const skipped = skippedFields(c);
  if (skipped.length) {
    const names = skipped.join(", ");
    const shown = names.length <= 24 ? names : `${skipped.length} field${skipped.length > 1 ? "s" : ""}`;
    items.push(
      <span key="skip" className="gp-note-warn" title={`${skipped.join(", ")}\n\n${SKIP_EXPLAIN}`}>
        Form skips {shown}: may be required
      </span>
    );
  }
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

function Detail({ c, ctx }: { c: CountryCapability; ctx: EmployeeCtx }) {
  const employee = ctx.employees.byCountry[c.code];
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
        <div className="gp-detail-title gp-detail-gap">Test employee</div>
        {employee ? (
          <div className="gp-muted">
            {employee.name} · <code>{employee.employmentId}</code>
            <br />
            Contract, admin, personal and bank details were read for this employee.
          </div>
        ) : c.coverage === "none" ? (
          <div className="gp-muted">Not available: {c.code} has no GP forms.</div>
        ) : (
          <div className="gp-muted">
            None. Forms were read without an employee, so they show the generic version.{" "}
            <CreateEmployeeButton code={c.code} ctx={ctx} />
          </div>
        )}
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
                  <FieldList label="skipped by the form, may still be required" fields={p.analysis.inertRequired} />
                  {p.analysis.inertRequired.length > 0 && <div className="gp-fields gp-muted">{SKIP_EXPLAIN}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TestEmployees({ employees, countries, onCreate, onForget, disabled }: {
  employees: EmployeeState;
  countries: { code: string; name: string }[];
  onCreate: (code: string) => void;
  onForget: (code: string) => void;
  disabled: boolean;
}) {
  const list = Object.values(employees.byCountry).sort((a, b) => a.countryCode.localeCompare(b.countryCode));
  const available = countries.filter((c) => !employees.byCountry[c.code]);
  const [pick, setPick] = useState("");
  const selected = available.some((c) => c.code === pick) ? pick : available.find((c) => c.code === "GBR")?.code || available[0]?.code || "";

  return (
    <div className="gp-employees">
      <div className="gp-employees-head">
        <span className="gp-employees-title">Test employees</span>
        <span className="gp-muted">
          Some forms change per employee, and contract details can only be read for one. Create a test employee in a country
          and the report reads that country&apos;s forms exactly as your integration will see them during onboarding.
        </span>
      </div>
      <div className="gp-employees-row">
        <select className="gp-select" value={selected} disabled={disabled || !!employees.creating || !available.length} onChange={(e) => setPick(e.target.value)}>
          {available.length === 0 && <option value="">No countries left</option>}
          {available.map((c) => (
            <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
          ))}
        </select>
        <button
          className="gp-employees-btn"
          disabled={disabled || !!employees.creating || !selected}
          onClick={() => selected && onCreate(selected)}
          title="Creates a Global Payroll employee in your sandbox test company. If needed it also adds a legal entity in that country and switches Global Payroll on for it."
        >
          {employees.creating ? `Creating ${employees.creating} employee…` : "Create test employee"}
        </button>
        {list.map((e: GPTestEmployee) => (
          <span key={e.countryCode} className="gp-employee-chip" title={`${e.name}\nEmployment ID: ${e.employmentId}\nCreated ${new Date(e.createdAt).toLocaleString()}`}>
            {e.countryCode} <span className="gp-muted">{shortId(e.employmentId)}</span>
            <button
              className="gp-chip-x"
              disabled={disabled}
              onClick={() => onForget(e.countryCode)}
              title={`Stop using this employee. ${e.countryCode} will be read without an employee again. The employee itself stays in your sandbox company.`}
              aria-label={`Stop using the ${e.countryCode} test employee`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {employees.lastChanges && (
        <div className="gp-employees-msg gp-note-good">
          Created a {employees.lastChanges.countryCode} test employee and re-checked {employees.lastChanges.countryCode}.
          {employees.lastChanges.changes.length > 0 && ` Also: ${employees.lastChanges.changes.join("; ")}.`}
        </div>
      )}
      {employees.error && <div className="gp-employees-msg gp-note-bad">{employees.error}</div>}
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
  const { state, run, cancel, loadLastRun, exportable, employees, createEmployee, forgetEmployee, loadTestEmployees } = useGPCapabilities();
  const { running, status, queue, results, entities, entitiesError, report, fromLastRun, rechecking } = state;
  const [scope, setScope] = useState<GPScope>("baseline");
  const [custom, setCustom] = useState("GBR, DEU, ESP, HUN, LVA");
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadLastRun();
    loadTestEmployees();
  }, [loadLastRun, loadTestEmployees]);

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
  const ctx: EmployeeCtx = { employees, rechecking, onCreate: createEmployee };
  // Countries a test employee makes sense for: those with GP forms in the last report, else the known GP countries
  const employeeCountries = all.length
    ? all.filter((c) => c.coverage !== "none").map((c) => ({ code: c.code, name: c.name }))
    : GP_BASELINE_COUNTRIES.map((code) => ({ code, name: code }));
  const progress = queue.length ? Math.round((results.size / queue.length) * 100) : 0;
  const countryName = (code: string) => results.get(code)?.name || code;
  const entityLine = entitiesError
    ? "Test company entities: not checked"
    : entities.length === 0
      ? "Test company has no legal entities"
      : "Test company: " + entities
          .map((e) => `${countryName(e.countryCode)} entity, GP ${e.gpEnabled ? "enabled" : "not enabled"}`)
          .join("; ");

  return (
    <div className="suite-view gp-view">
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
              title={k === "md" ? "Markdown summary for Notion" : k === "test-cases" ? "CSV of test cases: scenario, input, expected and actual result, status" : k === "matrix" ? "CSV, one row per country" : "Raw JSON"}
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
          <div
            className="gp-muted gp-company"
            title={
              entitiesError ||
              "Whether the connected test company can onboard GP employees in a country. Only matters for onboarding tests; this report reads the country forms and works either way. " +
              "To enable GP on a sandbox entity: POST /v1/sandbox/companies/{id}/legal-entities/{entity_id}/activate-global-payroll"
            }
          >
            {entityLine}
          </div>
        </div>
      </div>


      <TestEmployees
        employees={employees}
        countries={employeeCountries}
        onCreate={createEmployee}
        onForget={forgetEmployee}
        disabled={running}
      />

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
                    <th className="gp-col-country gp-w-country">Country</th>
                    <th className="gp-col-cov gp-w-cov">Coverage</th>
                    <th className="gp-col-forms gp-w-employer" title="Forms the employer completes. Green: published for this country. Struck through: not available. Red: the check failed.">Employer forms</th>
                    <th className="gp-col-forms gp-w-employee" title="Forms the employee completes. Green: published for this country. Struck through: not available. Red: the check failed.">Employee forms</th>
                    <th className="gp-col-notes gp-w-notes gp-hide-sm">Notes</th>
                    <th className="gp-col-entity gp-w-entity gp-hide-md" title="GP status of the connected test company's entity in this country">Test company</th>
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
                            <span className="gp-code">{c.code}</span> <span className="gp-name" title={c.name}>{c.name}</span>
                            <div className="gp-notes-inline"><Notes c={c} ctx={ctx} /></div>
                          </td>
                          <td className="gp-col-cov"><CoveragePill c={c} /></td>
                          <td className="gp-col-forms">{EMPLOYER_FORMS.map((f) => <FormPill key={f.key} def={f} p={c.forms[f.key]} />)}</td>
                          <td className="gp-col-forms">{EMPLOYEE_FORMS.map((f) => <FormPill key={f.key} def={f} p={c.forms[f.key]} />)}</td>
                          <td className="gp-col-notes gp-hide-sm"><Notes c={c} ctx={ctx} /></td>
                          <td className="gp-col-entity gp-hide-md"><EntityCell c={c} /></td>
                        </tr>
                        {open && (
                          <tr className="gp-detail-row"><td colSpan={6}><Detail c={c} ctx={ctx} /></td></tr>
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
