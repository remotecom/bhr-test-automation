"use client";

import { useState, useEffect, useCallback } from "react";
import { getEnvironmentHeaders, getSelectedEnv } from "./EnvironmentSelector";

const LS_SLUG_BASE = "bhr_company_slug";
const LS_TOKEN_BASE = "bhr_refresh_token";
const LS_NAME_BASE = "bhr_company_name";

function lsKey(base: string, gatewayEnv: string) {
  return `${base}__${gatewayEnv}`;
}

/**
 * One-shot migration: if legacy unprefixed keys exist and no partners-scoped
 * keys have been written yet, copy them under the partners namespace. This
 * preserves users who connected a company before env namespacing landed.
 */
function migrateLegacyKeys() {
  if (typeof window === "undefined") return;
  const legacySlug = localStorage.getItem(LS_SLUG_BASE);
  const legacyToken = localStorage.getItem(LS_TOKEN_BASE);
  if (!legacySlug || !legacyToken) return;
  const alreadyMigrated = localStorage.getItem(lsKey(LS_SLUG_BASE, "partners"));
  if (alreadyMigrated) {
    localStorage.removeItem(LS_SLUG_BASE);
    localStorage.removeItem(LS_TOKEN_BASE);
    localStorage.removeItem(LS_NAME_BASE);
    return;
  }
  localStorage.setItem(lsKey(LS_SLUG_BASE, "partners"), legacySlug);
  localStorage.setItem(lsKey(LS_TOKEN_BASE, "partners"), legacyToken);
  const legacyName = localStorage.getItem(LS_NAME_BASE);
  if (legacyName) localStorage.setItem(lsKey(LS_NAME_BASE, "partners"), legacyName);
  localStorage.removeItem(LS_SLUG_BASE);
  localStorage.removeItem(LS_TOKEN_BASE);
  localStorage.removeItem(LS_NAME_BASE);
}

export interface CompanyOverride {
  companySlug: string;
  refreshToken: string;
  companyName?: string;
}

/** Read company override from localStorage for the given (or currently selected) gateway env */
export function getCompanyOverride(gatewayEnv?: string): CompanyOverride | null {
  if (typeof window === "undefined") return null;
  migrateLegacyKeys();
  const env = gatewayEnv || getSelectedEnv();
  const slug = localStorage.getItem(lsKey(LS_SLUG_BASE, env));
  const token = localStorage.getItem(lsKey(LS_TOKEN_BASE, env));
  if (!slug || !token) return null;
  return {
    companySlug: slug,
    refreshToken: token,
    companyName: localStorage.getItem(lsKey(LS_NAME_BASE, env)) || slug,
  };
}

/** Build headers for API calls when company override is active (env-scoped) */
export function getCompanyHeaders(gatewayEnv?: string): Record<string, string> {
  const override = getCompanyOverride(gatewayEnv);
  if (!override) return {};
  return {
    "X-Company-Slug": override.companySlug,
    "X-Refresh-Token": override.refreshToken,
  };
}

function saveOverride(env: string, slug: string, token: string, name?: string) {
  localStorage.setItem(lsKey(LS_SLUG_BASE, env), slug);
  localStorage.setItem(lsKey(LS_TOKEN_BASE, env), token);
  if (name) localStorage.setItem(lsKey(LS_NAME_BASE, env), name);
}

function clearOverride(env: string) {
  localStorage.removeItem(lsKey(LS_SLUG_BASE, env));
  localStorage.removeItem(lsKey(LS_TOKEN_BASE, env));
  localStorage.removeItem(lsKey(LS_NAME_BASE, env));
}

interface CompanySelectorProps {
  onCompanyChange?: () => void;
  gatewayEnv?: string;
}

export default function CompanySelector({ onCompanyChange, gatewayEnv }: CompanySelectorProps) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState<CompanyOverride | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [currentEnv, setCurrentEnv] = useState<string>("partners");

  useEffect(() => {
    const env = gatewayEnv || getSelectedEnv();
    setCurrentEnv(env);
    const current = getCompanyOverride(env);
    setOverride(current);
    if (!current) setOpen(true);
  }, [gatewayEnv]);

  const refresh = useCallback(() => {
    setOverride(getCompanyOverride(currentEnv));
    onCompanyChange?.();
  }, [onCompanyChange, currentEnv]);

  async function handleCreateCompany() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company/create", { method: "POST", headers: getEnvironmentHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      saveOverride(currentEnv, data.company_slug, data.refresh_token, data.name);
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
        headers: { "Content-Type": "application/json", ...getEnvironmentHeaders() },
        body: JSON.stringify({ refresh_token: tokenInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      saveOverride(currentEnv, data.company_slug, tokenInput.trim(), data.company_name);
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

  function handleDisconnect() {
    clearOverride(currentEnv);
    refresh();
    setOpen(true);
  }

  const isConnected = override !== null;
  const label = isConnected
    ? override.companyName || override.companySlug
    : "No company connected";
  const dotColor = isConnected ? "#3fb950" : "#d29922";
  const borderColor = isConnected ? "#30363d" : "#d29922";
  const textColor = isConnected ? "#8b949e" : "#d29922";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: `1px solid ${borderColor}`,
          borderRadius: "6px",
          padding: "4px 10px",
          fontFamily: "inherit",
          fontSize: "11px",
          color: textColor,
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
            background: dotColor,
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
            {isConnected ? (
              <>
                Using: <strong style={{ color: "#d29922" }}>{override.companyName || override.companySlug}</strong>
                <br />
                <span style={{ fontSize: "10px", color: "#484f58" }}>
                  {override.companySlug}
                </span>
              </>
            ) : (
              "Pick one to get started"
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

          {isConnected && (
            <button
              onClick={handleDisconnect}
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
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
