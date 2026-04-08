"use client";

import { useState, useCallback, useEffect } from "react";
import ConfigPanel from "./ConfigPanel";
import TracePanel from "./TracePanel";
import ResultPanel from "./ResultPanel";
import { usePlayground } from "@/hooks/usePlayground";

interface Country {
  code: string;
  name: string;
  eor_onboarding: boolean;
  contractor_products_available: boolean;
}

interface PlaygroundViewProps {
  countries: Country[];
  contractors: Record<string, { contractor?: { full_name?: string; email?: string; job_title?: string } }>;
  onEntityChange?: (name: string | null) => void;
}

export default function PlaygroundView({ countries, contractors, onEntityChange }: PlaygroundViewProps) {
  const [config, setConfig] = useState({
    entityCountry: "",
    contractorCountry: "",
    fullName: "Test Contractor",
    email: "test@example.com",
    jobTitle: "Software Engineer",
    ir35Status: "",
    nationalityStatus: "",
    targetProduct: "",
  });

  const { state, run, cancel } = usePlayground();

  useEffect(() => {
    onEntityChange?.(state.currentEntityName);
  }, [state.currentEntityName, onEntityChange]);

  const handleConfigChange = useCallback(
    (field: string, value: string) => {
      setConfig((c) => {
        const next = { ...c, [field]: value };
        if (field === "contractorCountry" && value) {
          const data = contractors[value];
          if (data?.contractor) {
            next.fullName = data.contractor.full_name || next.fullName;
            next.email = data.contractor.email || next.email;
            next.jobTitle = data.contractor.job_title || next.jobTitle;
          }
          // Reset IR35 when switching away from GBR
          if (value !== "GBR") next.ir35Status = "";
          // Reset nationality when switching to non-nationality country
          const NAT_COUNTRIES = ["BHR", "SAU", "KWT", "OMN", "QAT"];
          if (!NAT_COUNTRIES.includes(value)) next.nationalityStatus = "";
        }
        return next;
      });
    },
    [contractors]
  );

  const handleRun = useCallback(() => {
    const playgroundConfig: Record<string, unknown> = {
      contractorCountry: config.contractorCountry,
      contractor: {
        full_name: config.fullName,
        job_title: config.jobTitle,
        email: config.email,
      },
    };
    if (config.entityCountry) playgroundConfig.entityCountry = config.entityCountry;
    if (config.ir35Status) playgroundConfig.ir35Status = config.ir35Status;
    if (config.nationalityStatus) playgroundConfig.nationalityStatus = config.nationalityStatus;
    if (config.targetProduct) playgroundConfig.targetProduct = config.targetProduct;

    run(playgroundConfig);
  }, [config, run]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr auto",
        gap: "1px",
        background: "#30363d",
        height: "calc(100vh - 45px)",
      }}
    >
      <ConfigPanel
        countries={countries}
        config={config}
        onChange={handleConfigChange}
        onRun={handleRun}
        onCancel={cancel}
        running={state.running}
        canCancel={!!state.lastEmploymentId && !state.running}
      />

      <TracePanel trace={state.trace} />

      <ResultPanel result={state.result} contractorCountry={state.contractorCountry} />
    </div>
  );
}
