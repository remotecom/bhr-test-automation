"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import PlaygroundView from "@/components/playground/PlaygroundView";
import SuiteView from "@/components/suite/SuiteView";

type Tab = "suite" | "playground";

interface Country {
  code: string;
  name: string;
  eor_onboarding: boolean;
  contractor_products_available: boolean;
}

export default function MainPage() {
  const [activeTab, setActiveTab] = useState<Tab>("suite");
  const [status, setStatus] = useState<{
    name?: string;
    connected: boolean;
    error?: string;
  }>({ connected: false });
  const [countries, setCountries] = useState<Country[]>([]);
  const [contractors, setContractors] = useState<Record<string, { contractor?: { full_name?: string; email?: string; job_title?: string } }>>({});
  const [currentEntityName, setCurrentEntityName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setStatus({ connected: false, error: data.error });
        } else {
          setStatus({ connected: true, name: data.name });
        }
      })
      .catch(() => setStatus({ connected: false, error: "Connection failed" }));

    fetch("/api/countries")
      .then((r) => r.json())
      .then((data) => setCountries(data.data || []))
      .catch(() => {});

    fetch("/api/contractors")
      .then((r) => r.json())
      .then((data) => setContractors(data || {}))
      .catch(() => {});
  }, []);

  const handleTabChange = useCallback((tab: Tab) => setActiveTab(tab), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header status={status} activeTab={activeTab} onTabChange={handleTabChange} currentEntityName={currentEntityName} />

      {activeTab === "suite" && <SuiteView />}
      {activeTab === "playground" && (
        <PlaygroundView countries={countries} contractors={contractors} onEntityChange={setCurrentEntityName} />
      )}
    </div>
  );
}
