"use client";

interface Country {
  code: string;
  name: string;
  eor_onboarding: boolean;
  contractor_products_available: boolean;
}

interface ConfigPanelProps {
  countries: Country[];
  config: {
    entityCountry: string;
    contractorCountry: string;
    fullName: string;
    email: string;
    jobTitle: string;
    ir35Status: string;
    nationalityStatus: string;
    targetProduct: string;
  };
  onChange: (field: string, value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  running: boolean;
  canCancel: boolean;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#8b949e",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginTop: "10px",
  marginBottom: "3px",
};

const firstLabelStyle: React.CSSProperties = { ...labelStyle, marginTop: 0 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: "4px",
  color: "#c9d1d9",
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: "13px",
  outline: "none",
};

export default function ConfigPanel({
  countries,
  config,
  onChange,
  onRun,
  onCancel,
  running,
  canCancel,
}: ConfigPanelProps) {
  const entityCountries = countries.filter((c) => c.eor_onboarding);
  const hireCountries = countries
    .filter((c) => c.contractor_products_available)
    .sort((a, b) => a.name.localeCompare(b.name));

  const isGBR = config.contractorCountry === "GBR";
  const NATIONALITY_COUNTRIES = ["BHR", "SAU", "KWT", "OMN", "QAT"];
  const showNationality = NATIONALITY_COUNTRIES.includes(config.contractorCountry);

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
        Configuration
      </h2>

      <label style={firstLabelStyle} htmlFor="pg-entity">Entity Country</label>
      <select
        id="pg-entity"
        style={inputStyle}
        value={config.entityCountry}
        onChange={(e) => onChange("entityCountry", e.target.value)}
      >
        <option value="">(use current entity)</option>
        {entityCountries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} ({c.code})
          </option>
        ))}
      </select>

      <label style={labelStyle} htmlFor="pg-hire">Country of Hire</label>
      <select
        id="pg-hire"
        style={inputStyle}
        value={config.contractorCountry}
        onChange={(e) => onChange("contractorCountry", e.target.value)}
      >
        <option value="">Select country...</option>
        {hireCountries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} ({c.code})
          </option>
        ))}
      </select>

      <label style={labelStyle} htmlFor="pg-name">Full Name</label>
      <input
        type="text"
        id="pg-name"
        style={inputStyle}
        value={config.fullName}
        onChange={(e) => onChange("fullName", e.target.value)}
      />

      <label style={labelStyle} htmlFor="pg-email">Email</label>
      <input
        type="text"
        id="pg-email"
        style={inputStyle}
        value={config.email}
        onChange={(e) => onChange("email", e.target.value)}
      />

      <label style={labelStyle} htmlFor="pg-job">Job Title</label>
      <input
        type="text"
        id="pg-job"
        style={inputStyle}
        value={config.jobTitle}
        onChange={(e) => onChange("jobTitle", e.target.value)}
      />

      <label style={labelStyle}>IR35 Status</label>
      <span style={{ fontSize: "11px", color: "#484f58", display: "block", marginTop: "2px" }}>UK (GBR) only</span>
      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginTop: "4px",
        }}
      >
        {[
          { value: "", label: "None" },
          { value: "outside", label: "Outside" },
          { value: "inside", label: "Inside" },
          { value: "exempt", label: "Exempt" },
        ].map((opt) => (
          <label
            key={opt.value}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
              color: !isGBR && opt.value ? "#484f58" : "#c9d1d9",
              cursor: !isGBR && opt.value ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="radio"
              name="ir35"
              checked={config.ir35Status === opt.value}
              onChange={() => onChange("ir35Status", opt.value)}
              disabled={!isGBR && opt.value !== ""}
              style={{ accentColor: "#58a6ff" }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <label style={labelStyle}>Nationality</label>
      <span style={{ fontSize: "11px", color: "#484f58", display: "block", marginTop: "2px" }}>Required for BHR, SAU, KWT, OMN, QAT. Only BHR affects product availability (non-national blocks CM+/COR).</span>
      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginTop: "4px",
        }}
      >
        {[
          { value: "", label: "None" },
          { value: "national", label: "National" },
          { value: "non_national", label: "Non-National" },
        ].map((opt) => (
          <label
            key={opt.value}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
              color: !showNationality && opt.value ? "#484f58" : "#c9d1d9",
              cursor: !showNationality && opt.value ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="radio"
              name="nationality"
              checked={config.nationalityStatus === opt.value}
              onChange={() => onChange("nationalityStatus", opt.value)}
              disabled={!showNationality && opt.value !== ""}
              style={{ accentColor: "#d29922" }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <label style={labelStyle} htmlFor="pg-product">Target Product</label>
      <select
        id="pg-product"
        style={inputStyle}
        value={config.targetProduct}
        onChange={(e) => onChange("targetProduct", e.target.value)}
      >
        <option value="">(just show available)</option>
        <option value="CM">CM (standard)</option>
        <option value="CM+">CM+ (plus)</option>
        <option value="COR">COR</option>
      </select>

      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button
          onClick={onRun}
          disabled={running || !config.contractorCountry}
          style={{
            flex: 1,
            background: running || !config.contractorCountry ? "#21262d" : "#238636",
            border: `1px solid ${running || !config.contractorCountry ? "#30363d" : "#2ea043"}`,
            borderRadius: "6px",
            color: running || !config.contractorCountry ? "#484f58" : "#fff",
            padding: "8px 16px",
            fontFamily: "inherit",
            fontSize: "13px",
            fontWeight: 600,
            cursor: running || !config.contractorCountry ? "not-allowed" : "pointer",
          }}
        >
          {running ? "Running..." : "Run Scenario"}
        </button>
        <button
          onClick={onCancel}
          disabled={!canCancel}
          style={{
            background: "none",
            border: `1px solid ${canCancel ? "#30363d" : "#21262d"}`,
            borderRadius: "6px",
            color: canCancel ? "#f85149" : "#484f58",
            padding: "8px 12px",
            fontFamily: "inherit",
            fontSize: "12px",
            cursor: canCancel ? "pointer" : "not-allowed",
          }}
        >
          Cancel EE
        </button>
      </div>
    </div>
  );
}
