"use client";

import { useRouter } from "next/navigation";
import CompanySelector from "../CompanySelector";

type Tab = "suite" | "playground" | "lifecycle";

interface HeaderProps {
  status: {
    name?: string;
    connected: boolean;
    error?: string;
  };
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  currentEntityName?: string | null;
  onCompanyChange?: () => void;
}

const tabs: { mode: Tab; label: string }[] = [
  { mode: "suite", label: "Test Suite" },
  { mode: "playground", label: "Playground" },
  { mode: "lifecycle", label: "Lifecycle" },
];

export default function Header({ status, activeTab, onTabChange, currentEntityName, onCompanyChange }: HeaderProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 20px",
        background: "#161b22",
        borderBottom: "1px solid #30363d",
      }}
    >
      <h1 style={{ fontSize: "15px", fontWeight: 600, color: "#58a6ff" }}>
        Test Contractor Demo App
      </h1>

      <div style={{ display: "flex", gap: "4px" }}>
        {tabs.map((t) => (
          <button
            key={t.mode}
            onClick={() => onTabChange(t.mode)}
            style={{
              background: activeTab === t.mode ? "#0d1117" : "none",
              border: `1px solid ${activeTab === t.mode ? "#30363d" : "transparent"}`,
              borderRadius: "6px",
              padding: "4px 12px",
              fontFamily: "inherit",
              fontSize: "13px",
              color: activeTab === t.mode ? "#58a6ff" : "#8b949e",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <CompanySelector onCompanyChange={onCompanyChange} />
        {currentEntityName ? (
          <span style={{ fontSize: "11px", color: "#d29922" }}>
            Def. LE: {currentEntityName}
          </span>
        ) : (
          <span style={{ fontSize: "12px", color: "#8b949e" }}>
            {status.connected && status.name}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: status.connected ? "#3fb950" : "#484f58",
            }}
          />
          <span style={{ color: "#8b949e" }}>
            {status.connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: "none",
            border: "1px solid #30363d",
            borderRadius: "6px",
            padding: "4px 12px",
            fontFamily: "inherit",
            fontSize: "13px",
            color: "#8b949e",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
