"use client";

import type { PlaygroundResult } from "@/hooks/usePlayground";
import { getDashboardBase } from "@/components/EnvironmentSelector";

interface ResultPanelProps {
  result: PlaygroundResult | null;
  contractorCountry: string;
}

export default function ResultPanel({ result, contractorCountry }: ResultPanelProps) {
  if (!result) {
    return (
      <div
        style={{
          gridColumn: "1 / -1",
          background: "#0d1117",
          padding: "12px 16px",
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
          }}
        >
          Result
        </h2>
        <div style={{ color: "#484f58", fontStyle: "italic" }}>No results yet</div>
      </div>
    );
  }

  // Eligibility products (entity-level)
  let eligibilityProducts: string[] = [];
  if (result.eligibility) {
    const corCodes = result.eligibility.cor_supported_country_codes || [];
    const corForCountry = contractorCountry ? corCodes.includes(contractorCountry) : false;
    eligibilityProducts = [
      result.eligibility.standard && "CM",
      result.eligibility.plus && "CM+",
      corForCountry && "COR",
    ].filter(Boolean) as string[];
  }

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        background: "#0d1117",
        padding: "12px 16px",
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
        }}
      >
        Result
      </h2>

      {/* Eligibility + Products side by side */}
      <div style={{ display: "flex", gap: "24px", marginBottom: "8px" }}>
        <div>
          <div
            style={{
              color: "#8b949e",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "2px",
            }}
          >
            Eligibility (entity)
          </div>
          {result.eligibility ? (
            <div style={{ color: "#d2a8ff", fontSize: "14px", fontWeight: 600 }}>
              {eligibilityProducts.join("  ·  ") || "None"}
            </div>
          ) : (
            <div style={{ color: "#484f58", fontSize: "14px" }}>—</div>
          )}
        </div>

        <div>
          <div
            style={{
              color: "#8b949e",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "2px",
            }}
          >
            Products (subscription)
          </div>
          <div style={{ color: "#3fb950", fontSize: "14px", fontWeight: 600 }}>
            {result.products && result.products.length
              ? result.products.join("  ·  ")
              : "None"}
          </div>
        </div>
      </div>

      {/* Stopped state */}
      {result.stoppedAt && (
        <>
          <div style={{ color: "#f85149", marginTop: "8px", fontWeight: 600 }}>
            Stopped at {result.stoppedAt}
          </div>
          {result.stoppedReason && (
            <div style={{ color: "#8b949e", fontSize: "12px", marginTop: "4px" }}>
              {result.stoppedReason}
            </div>
          )}
        </>
      )}

      {/* Flow completion checkmarks */}
      {result.invited && (
        <div style={{ marginTop: "8px" }}>
          <div style={{ color: "#3fb950" }}>✓ {result.selectedProduct || "CM"} selected</div>
          <div style={{ color: "#3fb950" }}>✓ Contract details submitted</div>
          <div style={{ color: "#3fb950" }}>✓ Contract signed</div>
          <div style={{ color: "#3fb950" }}>
            ✓ {result.inviteType === "cor-reserve" ? "COR reserve created" : "Contractor invited"}
          </div>
        </div>
      )}

      {/* Employment + Entity links */}
      <div style={{ color: "#8b949e", fontSize: "12px", marginTop: "8px" }}>
        {result.employmentId && (
          <>
            Employment:{" "}
            <a
              href={`${getDashboardBase()}/people/${result.employmentId}/?selectedTab=profile`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#58a6ff", textDecoration: "none" }}
            >
              {result.employmentId}
            </a>
          </>
        )}
        {result.entityId && (
          <>
            {" · "}Entity:{" "}
            <a
              href={`${getDashboardBase()}/legal-entities/${result.entityId}/?selectedTab=details`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#d29922", textDecoration: "none" }}
            >
              {result.entityId}
            </a>
          </>
        )}
      </div>

      {/* Subscription pricing */}
      {result.subscriptions && result.subscriptions.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          {result.subscriptions.map((s, i) => {
            const name = typeof s.product === "object" ? s.product?.short_name : s.product || "Unknown";
            const price = s.price?.amount ? (s.price.amount / 100).toFixed(2) : "?";
            return (
              <div key={i} style={{ color: "#8b949e", fontSize: "12px" }}>
                {String(name)} — ${price}/mo
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
