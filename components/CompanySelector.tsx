"use client";

import { useState, useEffect, useCallback } from "react";

const LS_SLUG = "bhr_company_slug";
const LS_TOKEN = "bhr_refresh_token";
const LS_NAME = "bhr_company_name";

export interface CompanyOverride {
  companySlug: string;
  refreshToken: string;
  companyName?: string;
}

/** Read company override from localStorage (null = use env default) */
export function getCompanyOverride(): CompanyOverride | null {
  if (typeof window === "undefined") return null;
  const slug = localStorage.getItem(LS_SLUG);
  const token = localStorage.getItem(LS_TOKEN);
  if (!slug || !token) return null;
  return {
    companySlug: slug,
    refreshToken: token,
    companyName: localStorage.getItem(LS_NAME) || slug,
  };
}

/** Build headers for API calls when company override is active */
export function getCompanyHeaders(): Record<string, string> {
  const override = getCompanyOverride();
  if (!override) return {};
  return {
    "X-Company-Slug": override.companySlug,
    "X-Refresh-Token": override.refreshToken,
  };
}

function saveOverride(slug: string, token: string, name?: string) {
  localStorage.setItem(LS_SLUG, slug);
  localStorage.setItem(LS_TOKEN, token);
  if (name) localStorage.setItem(LS_NAME, name);
}

function clearOverride() {
  localStorage.removeItem(LS_SLUG);
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_NAME);
}

interface CompanySelectorProps {
  onCompanyChange?: () => void;
}

export default function CompanySelector({ onCompanyChange }: CompanySelectorProps) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState<CompanyOverride | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenInput, setShowTokenInput] = useState(false);

  useEffect(() => {
    setOverride(getCompanyOverride());
  }, []);

  const refresh = useCallback(() => {
    setOverride(getCompanyOverride());
    onCompanyChange?.();
  }, [onCompanyChange]);

  async function handleCreateCompany() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      saveOverride(data.company_slug, data.refresh_token, data.name);
      refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResolveToken() {
    if (!tokenInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokenInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      saveOverride(data.company_slug, tokenInput.trim(), data.company_name);
      refresh();
      setTokenInput("");
      setShowTokenInput(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    clearOverride();
    refresh();
    setOpen(false);
  }

  const isCustom = override !== null;
  const label = isCustom
    ? override.companyName || override.companySlug
    : "Default Company";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: `1px solid ${isCustom ? "#d29922" : "#30363d"}`,
          borderRadius: "6px",
          padding: "4px 10px",
          fontFamily: "inherit",
          fontSize: "11px",
          color: isCustom ? "#d29922" : "#8b949e",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: isCustom ? "#d29922" : "#3fb950",
          }}
        />
        {label.length > 20 ? label.slice(0, 18) + "..." : label}
        <span style={{ fontSize: "9px" }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "4px",
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: "8px",
            padding: "12px",
            minWidth: "280px",
            zIndex: 100,
          }}
        >
          <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "8px" }}>
            {isCustom ? (
              <>
                Using: <strong style={{ color: "#d29922" }}>{override.companyName || override.companySlug}</strong>
                <br />
                <span style={{ fontSize: "10px", color: "#484f58" }}>
                  {override.companySlug}
                </span>
              </>
            ) : (
              "Using environment default company"
            )}
          </div>

          {error && (
            <div style={{ fontSize: "11px", color: "#f85149", marginBottom: "8px", padding: "6px", background: "#1c0b0b", borderRadius: "4px" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleCreateCompany}
            disabled={loading}
            style={{
              width: "100%",
              background: "#238636",
              border: "none",
              borderRadius: "6px",
              padding: "8px 12px",
              fontFamily: "inherit",
              fontSize: "12px",
              color: "#fff",
              cursor: loading ? "wait" : "pointer",
              marginBottom: "6px",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Creating..." : "Create Fresh Company"}
          </button>

          <button
            onClick={() => setShowTokenInput(!showTokenInput)}
            style={{
              width: "100%",
              background: "none",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "6px 12px",
              fontFamily: "inherit",
              fontSize: "12px",
              color: "#8b949e",
              cursor: "pointer",
              marginBottom: "6px",
            }}
          >
            Use Custom Token
          </button>

          {showTokenInput && (
            <div style={{ marginBottom: "6px" }}>
              <input
                type="text"
                placeholder="Paste refresh token..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: "11px",
                  color: "#c9d1d9",
                  marginBottom: "4px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={handleResolveToken}
                disabled={loading || !tokenInput.trim()}
                style={{
                  width: "100%",
                  background: "#1f6feb",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px",
                  fontFamily: "inherit",
                  fontSize: "11px",
                  color: "#fff",
                  cursor: loading ? "wait" : "pointer",
                  opacity: loading || !tokenInput.trim() ? 0.6 : 1,
                }}
              >
                {loading ? "Resolving..." : "Connect"}
              </button>
            </div>
          )}

          {isCustom && (
            <button
              onClick={handleReset}
              style={{
                width: "100%",
                background: "none",
                border: "1px solid #da3633",
                borderRadius: "6px",
                padding: "6px 12px",
                fontFamily: "inherit",
                fontSize: "12px",
                color: "#da3633",
                cursor: "pointer",
              }}
            >
              Reset to Default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
