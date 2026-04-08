"use client";

import { useEffect, useRef } from "react";
import type { TraceEntry } from "@/hooks/usePlayground";

const SANDBOX_BASE = "https://employ.partners.remote-sandbox.com/dashboard";

/** Linkify entity/employment IDs in trace text */
function LinkifiedLabel({ text }: { text: string }) {
  // Match patterns like (entity 2f4537de...) or ee:2f4537de...
  const parts = text.split(/(entity [a-f0-9]{8}\.\.\.)/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const entityMatch = part.match(/^entity ([a-f0-9]{8})\.\.\.$/);
        if (entityMatch) {
          return (
            <a
              key={i}
              href={`${SANDBOX_BASE}/legal-entities/?search=${entityMatch[1]}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#d29922", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              entity {entityMatch[1]}...
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

interface TracePanelProps {
  trace: TraceEntry[];
}

export default function TracePanel({ trace }: TracePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trace]);

  return (
    <div
      style={{
        background: "#0d1117",
        padding: "12px 16px",
        overflowY: "auto",
      }}
    >
      <h2
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "#8b949e",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: "8px",
          position: "sticky",
          top: 0,
          background: "#0d1117",
          paddingBottom: "4px",
        }}
      >
        Live Trace
      </h2>
      <div style={{ fontSize: "12px", lineHeight: 1.6 }}>
        {trace.length === 0 && (
          <div style={{ color: "#484f58", fontStyle: "italic" }}>
            Configure inputs and click Run
          </div>
        )}
        {trace.map((entry, i) => {
          if (entry.type === "error") {
            return (
              <div key={i} style={{ color: "#f85149", padding: "1px 0" }}>
                ✗ {entry.label}
              </div>
            );
          }
          if (entry.type === "done") {
            return (
              <div key={i} style={{ color: "#3fb950", padding: "1px 0" }}>
                ✓ {entry.label}
              </div>
            );
          }
          if (entry.type === "side") {
            return (
              <div
                key={i}
                style={{ color: "#8b949e", fontStyle: "italic", padding: "1px 0" }}
              >
                <LinkifiedLabel text={entry.label} />
              </div>
            );
          }
          // step
          return (
            <div key={i} style={{ padding: "1px 0" }}>
              <span style={{ color: "#d29922" }}>→ {entry.label}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
