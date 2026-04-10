"use client";

import { useState, useEffect } from "react";

const LS_ENV = "bhr_gateway_env";

type GatewayEnv = "sandbox" | "partners";

const ENV_OPTIONS: { value: GatewayEnv; label: string }[] = [
  { value: "partners", label: "Partners" },
  { value: "sandbox", label: "Remote SBX" },
];

/** Read selected env from localStorage (defaults to "partners") */
export function getSelectedEnv(): GatewayEnv {
  if (typeof window === "undefined") return "partners";
  return (localStorage.getItem(LS_ENV) as GatewayEnv) || "partners";
}

/** Build the X-Gateway-Env header for API calls */
export function getEnvironmentHeaders(): Record<string, string> {
  const env = getSelectedEnv();
  return { "X-Gateway-Env": env };
}

const DASHBOARD_URLS: Record<GatewayEnv, string> = {
  partners: "https://employ.partners.remote-sandbox.com/dashboard",
  sandbox: "https://employ.remote-sandbox.com/dashboard",
};

/** Dashboard base URL for the currently selected environment */
export function getDashboardBase(): string {
  return DASHBOARD_URLS[getSelectedEnv()];
}

interface EnvironmentSelectorProps {
  onEnvironmentChange?: () => void;
}

export default function EnvironmentSelector({ onEnvironmentChange }: EnvironmentSelectorProps) {
  const [selected, setSelected] = useState<GatewayEnv>("partners");

  useEffect(() => {
    setSelected(getSelectedEnv());
  }, []);

  function handleChange(env: GatewayEnv) {
    localStorage.setItem(LS_ENV, env);
    setSelected(env);
    onEnvironmentChange?.();
  }

  const current = ENV_OPTIONS.find((o) => o.value === selected) || ENV_OPTIONS[0];

  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {ENV_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleChange(opt.value)}
          style={{
            background: selected === opt.value ? "#0d1117" : "none",
            border: `1px solid ${selected === opt.value ? "#58a6ff" : "#30363d"}`,
            borderRadius: "6px",
            padding: "4px 8px",
            fontFamily: "inherit",
            fontSize: "11px",
            color: selected === opt.value ? "#58a6ff" : "#8b949e",
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
