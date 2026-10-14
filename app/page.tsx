"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import { LIFECYCLE_ENABLED } from "@/components/layout/Header";
import PlaygroundView from "@/components/playground/PlaygroundView";
import SuiteView from "@/components/suite/SuiteView";
import LifecycleView from "@/components/lifecycle/LifecycleView";
import PayrollView from "@/components/payroll/PayrollView";
import ConnectCompanyBanner from "@/components/ConnectCompanyBanner";
import { getCompanyHeaders, getCompanyOverride } from "@/components/CompanySelector";
import { getEnvironmentHeaders, getSelectedEnv } from "@/components/EnvironmentSelector";
import { SHOW_CM } from "@/lib/features";

type Tab = "suite" | "playground" | "payroll" | "lifecycle";

interface Country {
  code: string;
  name: string;
  eor_onboarding: boolean;
  contractor_products_available: boolean;
}

export default function MainPage() {
  const [activeTab, setActiveTab] = useState<Tab>(SHOW_CM ? "suite" : "payroll");
  const [status, setStatus] = useState<{
    name?: string;
    connected: boolean;
    error?: string;
  }>({ connected: false });
  const [countries, setCountries] = useState<Country[]>([]);
  const [contractors, setContractors] = useState<Record<string, { contractor?: { full_name?: string; email?: string; job_title?: string } }>>({});
  const [currentEntityName, setCurrentEntityName] = useState<string | null>(null);
  const [companyVersion, setCompanyVersion] = useState(0);
  const [gatewayEnv, setGatewayEnv] = useState<string>("partners");
  const [hasCompany, setHasCompany] = useState<boolean>(false);

  const handleCompanyChange = useCallback(() => {
    setGatewayEnv(getSelectedEnv());
    setHasCompany(getCompanyOverride() !== null);
    setCompanyVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    setGatewayEnv(getSelectedEnv());
    setHasCompany(getCompanyOverride() !== null);
  }, []);

  useEffect(() => {
    if (!hasCompany) {
      setStatus({ connected: false });
      setCountries([]);
      setContractors({});
      return;
    }
    const headers = { ...getCompanyHeaders(), ...getEnvironmentHeaders() };

    fetch("/api/status", { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setStatus({ connected: false, error: data.error });
        } else {
          setStatus({ connected: true, name: data.name });
        }
      })
      .catch(() => setStatus({ connected: false, error: "Connection failed" }));

    // Countries and contractor fixtures are only used by the CM Playground
    if (!SHOW_CM) return;

    fetch("/api/countries", { headers })
      .then((r) => r.json())
      .then((data) => setCountries(data.data || []))
      .catch(() => {});

    fetch("/api/contractors", { headers })
      .then((r) => r.json())
      .then((data) => setContractors(data || {}))
      .catch(() => {});
  }, [companyVersion, hasCompany]);

  const handleTabChange = useCallback((tab: Tab) => setActiveTab(tab), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header
        status={status}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        currentEntityName={currentEntityName}
        onCompanyChange={handleCompanyChange}
        onEnvironmentChange={handleCompanyChange}
        gatewayEnv={gatewayEnv}
      />

      {!hasCompany ? (
        <ConnectCompanyBanner />
      ) : (
        <>
          {SHOW_CM && activeTab === "suite" && <SuiteView />}
          {SHOW_CM && activeTab === "playground" && (
            <PlaygroundView countries={countries} contractors={contractors} onEntityChange={setCurrentEntityName} />
          )}
          {activeTab === "payroll" && <PayrollView key={`${gatewayEnv}-${companyVersion}`} />}
          {LIFECYCLE_ENABLED && activeTab === "lifecycle" && <LifecycleView />}
        </>
      )}
    </div>
  );
}
