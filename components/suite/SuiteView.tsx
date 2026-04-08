"use client";

import React, { useEffect, useState } from "react";
import { useSuite, arrMatch, type TestState } from "@/hooks/useSuite";
import type { TestCase, TestExpected } from "@/data/test-matrix";

const SANDBOX_BASE = "https://employ.partners.remote-sandbox.com/dashboard";

function pathClass(p: string): string {
  if (p === "CM") return "path-cm";
  if (p === "CM+") return "path-cmplus";
  if (p === "COR") return "path-cor";
  if (p === "COR+IR35") return "path-ir35";
  if (p === "EOR") return "path-eor";
  return "path-ro";
}

function StatusIcon({ status }: { status?: string }) {
  if (status === "pass") return <span className="st-pass">✓</span>;
  if (status === "fail") return <span className="st-fail">✗</span>;
  if (status === "run") return <span className="st-running">●</span>;
  if (status === "skip") return <span className="st-skip">◌</span>;
  return <span className="st-pending">○</span>;
}

function CopyButton({ text }: { text: string }) {
  return (
    <button
      className="copy-btn"
      title="Copy full ID"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
      }}
    >
      ⧉
    </button>
  );
}

/** Employment/Entity IDs — clickable links + copy */
function EeCell({ ts }: { ts: TestState }) {
  if (!ts.eeId && !ts.entityId) return null;
  return (
    <>
      {ts.eeId && (
        <div className="ee-row">
          <span className="ee-label">EE:</span>
          <a
            href={`${SANDBOX_BASE}/people/${ts.eeId}/?selectedTab=profile`}
            target="_blank"
            rel="noopener noreferrer"
            title={ts.eeEmail || ts.eeId}
          >
            {ts.eeId.slice(0, 8)}...
          </a>
          <CopyButton text={ts.eeId} />
        </div>
      )}
      {ts.entityId && (
        <div className="ee-row">
          <span className="ee-label">LE:</span>
          <a
            href={`${SANDBOX_BASE}/legal-entities/${ts.entityId}/?selectedTab=details`}
            target="_blank"
            rel="noopener noreferrer"
            className="entity-link"
          >
            {ts.entityId.slice(0, 8)}...
          </a>
          <CopyButton text={ts.entityId} />
        </div>
      )}
    </>
  );
}

function eligToProducts(elig: { standard: boolean; plus: boolean; cor: boolean }): string[] {
  return [
    elig.standard && "std",
    elig.plus && "plus",
    elig.cor && "cor",
  ].filter(Boolean) as string[];
}

function RenderExpected({ exp }: { exp?: TestExpected }) {
  if (!exp) return null;
  if (exp.note) return <span className="exp-line">{exp.note}</span>;

  const lines: React.ReactNode[] = [];

  if (exp.eligibility) {
    const products = eligToProducts(exp.eligibility);
    lines.push(
      <span key="elig" className="exp-line">
        <span className="exp-label">elig:</span> {products.join(", ") || "none"}
      </span>
    );
  }

  if (exp.country) {
    lines.push(
      <span key="country" className="exp-line">
        <span className="exp-label">cty:</span> {exp.country.map(c => c === "standard" ? "std" : c).join(", ")}
      </span>
    );
  }
  if (exp.subs) {
    lines.push(
      <span key="subs" className="exp-line">
        <span className="exp-label">sub:</span> {exp.subs.join(", ") || "none"}
      </span>
    );
  }
  if (exp.questionnaire !== undefined && exp.questionnaire !== null) {
    lines.push(
      <span key="quiz" className="exp-line">
        <span className="exp-label">qz:</span>{" "}
        {exp.questionnaire.isBlocking ? "blocking" : "non-blocking"}
      </span>
    );
  }

  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function RenderOutcome({ ts, exp, hire }: { ts: TestState; exp?: TestExpected; hire?: string }) {
  if (!ts.status || ts.status === "skip") return null;
  if (exp?.note) {
    const cls = ts.status === "pass" ? "out-match" : "out-mismatch";
    const icon = ts.status === "pass" ? " ✓" : " ✗";
    return <span className={cls}>{exp.note}{icon}</span>;
  }

  const lines: React.ReactNode[] = [];

  if (ts.eligibility) {
    const corForHire = hire && ts.corCodes ? ts.corCodes.includes(hire) : ts.eligibility.cor;
    const actualElig = { standard: ts.eligibility.standard, plus: ts.eligibility.plus, cor: corForHire };
    const actualProducts = eligToProducts(actualElig);
    const expectedProducts = exp?.eligibility ? eligToProducts(exp.eligibility) : null;
    const match = expectedProducts ? arrMatch(expectedProducts, actualProducts) : null;
    const cls = match === null ? "out-value" : match ? "out-match" : "out-mismatch";
    const icon = match === null ? "" : match ? " ✓" : " ✗";
    lines.push(
      <span key="elig" className="out-line">
        <span className="out-label">elig:</span>{" "}
        <span className={cls}>
          {actualProducts.join(", ") || "none"}
          {icon}
        </span>
      </span>
    );
  }

  if (ts.countryProducts) {
    const match = exp?.country ? arrMatch(exp.country, ts.countryProducts) : null;
    const cls = match === null ? "out-value" : match ? "out-match" : "out-mismatch";
    const icon = match === null ? "" : match ? " ✓" : " ✗";
    lines.push(
      <span key="country" className="out-line">
        <span className="out-label">cty:</span>{" "}
        <span className={cls}>
          {ts.countryProducts.map(c => c === "standard" ? "std" : c).join(", ")}
          {icon}
        </span>
      </span>
    );
  }

  if (ts.products) {
    const match = exp?.subs ? arrMatch(exp.subs, ts.products) : null;
    const cls = match === null ? "out-value" : match ? "out-match" : "out-mismatch";
    const icon = match === null ? "" : match ? " ✓" : " ✗";
    lines.push(
      <span key="subs" className="out-line">
        <span className="out-label">sub:</span>{" "}
        <span className={cls}>
          {ts.products.join(", ") || "none"}
          {icon}
        </span>
      </span>
    );
  }

  if (ts.questionnaireResult !== undefined && ts.questionnaireResult !== null) {
    const actual = ts.questionnaireResult ? "blocking" : "non-blocking";
    const match =
      exp?.questionnaire !== null && exp?.questionnaire !== undefined
        ? exp.questionnaire.isBlocking === ts.questionnaireResult
        : null;
    const cls = match === null ? "out-value" : match ? "out-match" : "out-mismatch";
    const icon = match === null ? "" : match ? " ✓" : " ✗";
    lines.push(
      <span key="quiz" className="out-line">
        <span className="out-label">qz:</span>{" "}
        <span className={cls}>
          {actual}
          {icon}
        </span>
      </span>
    );
  }

  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export default function SuiteView() {
  const { state, runSuite, runTest, loadLastRun, testMatrix } = useSuite();
  const { running, status, testState, summary } = state;
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadLastRun();
  }, [loadLastRun]);

  const toggleError = (id: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const COL_COUNT = 9;

  return (
    <div className="suite-view">
      <div className="suite-toolbar">
        <button
          className="btn-run-suite"
          disabled={running}
          onClick={runSuite}
        >
          Run All Tests
        </button>
        <span className="suite-status">{status}</span>
        {summary && (
          <div className="suite-counts">
            <span className="pass">✓ {summary.passed}</span>
            <span className="fail">✗ {summary.failed}</span>
            <span className="skip">◌ {summary.skipped}</span>
            <span className="time">{(summary.duration / 1000).toFixed(1)}s</span>
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="col-st"></th>
              <th className="col-id">ID</th>
              <th className="col-desc">Description</th>
              <th className="col-route">Route</th>
              <th className="col-path">Path</th>
              <th className="col-expected">Expected</th>
              <th className="col-ee">Employment</th>
              <th className="col-outcome">Outcome</th>
              <th className="col-time">Time</th>
            </tr>
          </thead>
          <tbody>
            {testMatrix.map((tc: TestCase, i: number) => {
              if (tc.section) {
                return (
                  <tr key={`section-${i}`} className="section-header">
                    <td colSpan={COL_COUNT}>{tc.section}</td>
                  </tr>
                );
              }

              const ts = testState.get(tc.id!) || {};
              const hasError = ts.error && ts.status === "fail";

              return (
                <React.Fragment key={tc.id}>
                  <tr
                    className={hasError ? "has-error" : ""}
                    onClick={hasError ? () => toggleError(tc.id!) : undefined}
                  >
                    <td className="col-st">
                      <StatusIcon status={ts.status} />
                    </td>
                    <td className="col-id">
                      <span className="tid">{tc.id}</span>
                    </td>
                    <td className="col-desc">{tc.desc}</td>
                    <td className="col-route">
                      <span className="route-entity">{tc.entity}</span>
                      <span className="route-arrow"> → </span>
                      <span className="route-hire">{tc.hire}</span>
                    </td>
                    <td className="col-path">
                      <span className={pathClass(tc.path || "")}>{tc.path}</span>
                      {tc.ir35 && (
                        <span className="ir35-badge">{tc.ir35}</span>
                      )}
                    </td>
                    <td className="col-expected">
                      <RenderExpected exp={tc.expected} />
                    </td>
                    <td className="col-ee">
                      <EeCell ts={ts} />
                    </td>
                    <td className="col-outcome">
                      <RenderOutcome ts={ts} exp={tc.expected} hire={tc.hire} />
                      {hasError && !expandedErrors.has(tc.id!) && (
                        <span className="error-hint">▸ error</span>
                      )}
                      <button
                        className="btn-run-single"
                        title={`Re-run ${tc.id}`}
                        disabled={running}
                        onClick={(e) => {
                          e.stopPropagation();
                          runTest(tc.id!);
                        }}
                      >
                        ↻
                      </button>
                    </td>
                    <td className="col-time">
                      {ts.duration ? `${(ts.duration / 1000).toFixed(1)}s` : ""}
                    </td>
                  </tr>
                  {hasError && expandedErrors.has(tc.id!) && (
                    <tr key={`${tc.id}-error`} className="error-detail-row">
                      <td colSpan={COL_COUNT}>
                        <pre className="error-detail">{ts.error}</pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
