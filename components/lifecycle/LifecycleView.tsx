"use client";

import React, { useState } from "react";
import { useLifecycle, type LifecycleTestState, type TransitionState } from "@/hooks/useLifecycle";
import type { LifecycleTestCase } from "@/data/lifecycle-matrix";
import { getDashboardBase } from "@/components/EnvironmentSelector";

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

function lifecycleClass(lc?: string): string {
  if (lc === "CM") return "path-cm";
  if (lc === "CM+") return "path-cmplus";
  if (lc === "COR") return "path-cor";
  return "path-ro";
}

/** Inline progress bar: ■■■□□ */
function TransitionProgress({ transitions }: { transitions: TransitionState[] }) {
  if (transitions.length === 0) return <span style={{ color: "#8b949e" }}>...</span>;
  const passed = transitions.filter((t) => t.state === "pass").length;
  const failed = transitions.filter((t) => t.state === "fail").length;
  const total = transitions.length;

  const blocks = transitions.map((t, i) => {
    const color =
      t.state === "pass" ? "#3fb950" :
      t.state === "fail" ? "#f85149" :
      t.state === "running" ? "#58a6ff" :
      "#484f58";
    return (
      <span key={i} style={{ color }} title={`${t.step}: ${t.state}`}>
        ■
      </span>
    );
  });

  return (
    <span style={{ letterSpacing: "1px", fontSize: "11px" }}>
      {blocks}{" "}
      <span style={{ color: failed > 0 ? "#f85149" : "#3fb950", fontSize: "10px" }}>
        {passed}/{total}
      </span>
    </span>
  );
}

/** Webhook count badge */
function WebhookBadge({ ts, available }: { ts: LifecycleTestState; available: boolean }) {
  if (!available) return <span style={{ color: "#484f58", fontSize: "10px" }}>n/a</span>;
  if (!ts.webhooks) return <span style={{ color: "#8b949e" }}>...</span>;

  const { expected, received, passed } = ts.webhooks;
  const color = passed ? "#3fb950" : "#f85149";
  const icon = passed ? "✓" : "✗";
  return (
    <span style={{ color, fontSize: "11px" }}>
      {received.length}/{expected.length} {icon}
    </span>
  );
}

/** Expanded detail: transition timeline + webhook log */
function ExpandedDetail({ ts, available }: { ts: LifecycleTestState; available: boolean }) {
  return (
    <div style={{ padding: "8px 12px", display: "flex", gap: "24px", flexWrap: "wrap" }}>
      {/* Transition timeline */}
      <div style={{ flex: "1 1 300px" }}>
        <div style={{ color: "#8b949e", fontSize: "10px", marginBottom: "4px", textTransform: "uppercase" }}>
          Transitions
        </div>
        {ts.transitions.map((t, i) => {
          const color =
            t.state === "pass" ? "#3fb950" :
            t.state === "fail" ? "#f85149" :
            t.state === "running" ? "#58a6ff" :
            "#484f58";
          return (
            <div key={i} style={{ display: "flex", gap: "8px", fontSize: "11px", lineHeight: "18px" }}>
              <span style={{ color, width: "12px" }}>
                {t.state === "pass" ? "✓" : t.state === "fail" ? "✗" : t.state === "running" ? "●" : "○"}
              </span>
              <span style={{ color: "#c9d1d9", minWidth: "140px" }}>{t.step}</span>
              <span style={{ color: "#8b949e" }}>{t.action || "initial"}</span>
              {t.actualStatus && (
                <span style={{ color: t.actualStatus === t.expectedStatus ? "#3fb950" : "#f85149" }}>
                  {t.actualStatus}
                  {t.actualStatus !== t.expectedStatus && (
                    <span style={{ color: "#8b949e" }}> (want: {t.expectedStatus})</span>
                  )}
                </span>
              )}
              {t.durationMs !== undefined && (
                <span style={{ color: "#484f58" }}>{(t.durationMs / 1000).toFixed(1)}s</span>
              )}
              {t.error && (
                <span style={{ color: "#f85149", fontSize: "10px" }}>{t.error}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Webhook log */}
      <div style={{ flex: "1 1 200px" }}>
        <div style={{ color: "#8b949e", fontSize: "10px", marginBottom: "4px", textTransform: "uppercase" }}>
          Webhooks
        </div>
        {!available ? (
          <div style={{ color: "#484f58", fontSize: "11px" }}>
            Webhook capture unavailable (local)
          </div>
        ) : !ts.webhooks ? (
          <div style={{ color: "#484f58", fontSize: "11px" }}>No webhooks expected</div>
        ) : (
          <>
            {ts.webhooks.expected.map((evt, i) => {
              const received = ts.webhooks!.received.includes(evt);
              return (
                <div key={i} style={{ fontSize: "11px", lineHeight: "18px" }}>
                  <span style={{ color: received ? "#3fb950" : "#f85149", width: "12px", display: "inline-block" }}>
                    {received ? "✓" : "✗"}
                  </span>
                  <span style={{ color: "#c9d1d9" }}>{evt}</span>
                </div>
              );
            })}
            {ts.webhooks.extra.length > 0 && (
              <>
                {ts.webhooks.extra.map((evt, i) => (
                  <div key={`extra-${i}`} style={{ fontSize: "11px", lineHeight: "18px" }}>
                    <span style={{ color: "#d29922", width: "12px", display: "inline-block" }}>?</span>
                    <span style={{ color: "#d29922" }}>{evt} (extra)</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Employment/Entity links */}
      {(ts.eeId || ts.entityId) && (
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ color: "#8b949e", fontSize: "10px", marginBottom: "4px", textTransform: "uppercase" }}>
            Links
          </div>
          {ts.eeId && (
            <div style={{ fontSize: "11px" }}>
              <span style={{ color: "#8b949e" }}>EE: </span>
              <a
                href={`${getDashboardBase()}/people/${ts.eeId}/?selectedTab=profile`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#58a6ff" }}
              >
                {ts.eeId.slice(0, 8)}...
              </a>
              <CopyButton text={ts.eeId} />
            </div>
          )}
          {ts.entityId && (
            <div style={{ fontSize: "11px" }}>
              <span style={{ color: "#8b949e" }}>LE: </span>
              <a
                href={`${getDashboardBase()}/legal-entities/${ts.entityId}/?selectedTab=details`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#d29922" }}
              >
                {ts.entityId.slice(0, 8)}...
              </a>
              <CopyButton text={ts.entityId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LifecycleView() {
  const { state, runAll, runTest, lifecycleMatrix } = useLifecycle();
  const { running, status, testState, summary, webhooksAvailable } = state;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const COL_COUNT = 7;

  return (
    <div className="suite-view">
      <div className="suite-toolbar">
        <button
          className="btn-run-suite"
          disabled={running}
          onClick={runAll}
        >
          Run Lifecycle Tests
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
        {!webhooksAvailable && running && (
          <span style={{ color: "#d29922", fontSize: "11px", marginLeft: "8px" }}>
            Webhooks: local mode (skipped)
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="col-st"></th>
              <th className="col-id">ID</th>
              <th className="col-desc">Description</th>
              <th className="col-route">Product / Route</th>
              <th style={{ width: "120px" }}>Transitions</th>
              <th style={{ width: "70px" }}>Webhooks</th>
              <th className="col-time">Time</th>
            </tr>
          </thead>
          <tbody>
            {lifecycleMatrix.map((tc: LifecycleTestCase, i: number) => {
              if (tc.section) {
                return (
                  <tr key={`section-${i}`} className="section-header">
                    <td colSpan={COL_COUNT}>{tc.section}</td>
                  </tr>
                );
              }

              const ts = testState.get(tc.id!) || { transitions: [] };
              const hasDetail = ts.transitions.length > 0 || ts.webhooks || ts.error;

              return (
                <React.Fragment key={tc.id}>
                  <tr
                    className={hasDetail ? "has-error" : ""}
                    style={{ cursor: hasDetail ? "pointer" : "default" }}
                    onClick={hasDetail ? () => toggleExpand(tc.id!) : undefined}
                  >
                    <td className="col-st">
                      <StatusIcon status={ts.status} />
                    </td>
                    <td className="col-id">
                      <span className="tid">{tc.id}</span>
                    </td>
                    <td className="col-desc">{tc.desc}</td>
                    <td className="col-route">
                      <span className={lifecycleClass(tc.lifecycle)}>{tc.lifecycle}</span>
                      <span style={{ color: "#8b949e", margin: "0 4px" }}>
                        {tc.entity} → {tc.hire}
                      </span>
                      {tc.ir35 && <span className="ir35-badge">{tc.ir35}</span>}
                    </td>
                    <td>
                      <TransitionProgress transitions={ts.transitions} />
                    </td>
                    <td>
                      <WebhookBadge ts={ts} available={webhooksAvailable} />
                    </td>
                    <td className="col-time">
                      {ts.duration ? `${(ts.duration / 1000).toFixed(1)}s` : ""}
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
                  </tr>
                  {hasDetail && expanded.has(tc.id!) && (
                    <tr key={`${tc.id}-detail`} className="error-detail-row">
                      <td colSpan={COL_COUNT}>
                        <ExpandedDetail ts={ts} available={webhooksAvailable} />
                        {ts.error && (
                          <pre className="error-detail">{ts.error}</pre>
                        )}
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
