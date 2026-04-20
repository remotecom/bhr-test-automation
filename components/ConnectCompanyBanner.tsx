"use client";

export default function ConnectCompanyBanner() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        margin: "24px",
        background: "#161b22",
        border: "1px dashed #d29922",
        borderRadius: "8px",
        color: "#c9d1d9",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "28px", marginBottom: "12px" }}>🔑</div>
      <div style={{ fontSize: "15px", fontWeight: 600, color: "#d29922", marginBottom: "6px" }}>
        Connect a company to get started
      </div>
      <div style={{ fontSize: "12px", color: "#8b949e", maxWidth: "420px", lineHeight: 1.5 }}>
        Use the <strong style={{ color: "#d29922" }}>company selector</strong> in the top-right to{" "}
        <strong>create a fresh company</strong> or <strong>paste an existing refresh token</strong>.
        Everything on this page is locked until then.
      </div>
    </div>
  );
}
