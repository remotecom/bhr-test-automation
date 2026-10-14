/**
 * Unit tests for the GP capability report. No network calls.
 * Run with: npm run test:gp-unit
 */

import { describe, expect, it } from "vitest";
import { analyzeSchema, isNameRequired, unwrapSchema } from "../src/gp/schema-analysis";
import { classifyCoverage, entityStatusFor, evaluateBaseline, summarize } from "../src/gp/evaluate";
import { toMarkdown, toMatrixCSV, toTestCasesCSV, TEST_GUIDE_COLUMNS } from "../src/gp/export";
import { GP_BASELINE } from "../data/gp-capability-baseline";
import type { CountryCapability, FormProbe, GPRunReport } from "../src/gp/types";

// Shaped like the GBR contract details schema before PBYR-4962
const GBR_CONTRACT = {
  type: "object",
  required: ["wage_type", "work_hours_per_week"],
  properties: {
    wage_type: { type: "string" },
    work_hours_per_week: { type: "number" },
    overtime_eligible: { type: "boolean", "x-jsf-presentation": { inputType: "hidden" } },
    work_address: {
      type: "object",
      properties: { line1: { type: "string" }, legacy_code: { type: "string", "x-jsf-presentation": { inputType: "hidden" } } },
    },
  },
  allOf: [
    { if: false, then: { required: ["overtime_eligible"] } },
    { if: { properties: { wage_type: { const: "hourly" } } }, then: { required: ["work_hours_per_week"] } },
  ],
};

const avail = (form: string, analysis = analyzeSchema({ properties: {}, required: [] })): FormProbe =>
  ({ form, status: "available", httpStatus: 200, analysis });
const unavail = (form: string): FormProbe =>
  ({ form, status: "unavailable", httpStatus: 422, message: "Form not available for requested country" });

describe("GP schema analysis", () => {
  it("GP-U1 unwraps { data: { schema } } and { data } envelopes", () => {
    expect(unwrapSchema({ data: { schema: GBR_CONTRACT } })).toBe(GBR_CONTRACT);
    expect(unwrapSchema({ data: GBR_CONTRACT })).toBe(GBR_CONTRACT);
    expect(unwrapSchema({ data: { message: "x" } })).toBeNull();
  });

  it("GP-U2 flags hidden and inert-required fields (overtime_eligible pattern)", () => {
    const a = analyzeSchema(GBR_CONTRACT);
    expect(a.fieldCount).toBe(4);
    expect(a.requiredFields).toEqual(["wage_type", "work_hours_per_week"]);
    expect(a.hiddenFields).toEqual(["overtime_eligible", "work_address.legacy_code"]);
    expect(a.inertRequired).toEqual(["overtime_eligible"]);
    expect(a.inertRequired).not.toContain("work_hours_per_week");
  });

  it("GP-U3 detects whether personal details requires name", () => {
    expect(isNameRequired(analyzeSchema({ required: ["name", "birthdate"], properties: {} }))).toBe(true);
    expect(isNameRequired(analyzeSchema({ required: ["given_name"], properties: {} }))).toBe(false);
    expect(isNameRequired(undefined)).toBeNull();
  });
});

describe("GP coverage and baseline", () => {
  it("GP-U4 classifies coverage from contract + personal details", () => {
    expect(classifyCoverage({ contract_details: avail("c"), personal_details: avail("p") })).toBe("full");
    expect(classifyCoverage({ contract_details: avail("c"), personal_details: unavail("p") })).toBe("employer_only");
    expect(classifyCoverage({ contract_details: unavail("c"), personal_details: avail("p") })).toBe("employee_only");
    expect(classifyCoverage({ contract_details: unavail("c"), personal_details: unavail("p") })).toBe("none");
    expect(classifyCoverage({ contract_details: { form: "c", status: "error", httpStatus: 500 }, personal_details: avail("p") })).toBe("unknown");
  });

  it("GP-U5 baseline: HUN is employer-only, LVA has nothing", () => {
    expect(GP_BASELINE.HUN).toMatchObject({ contract_details: true, personal_details: false });
    const hun = evaluateBaseline("HUN", { contract_details: avail("c"), personal_details: unavail("p") }, null);
    expect(hun.verdict).toBe("match");
    const lvaDrift = evaluateBaseline("LVA", { contract_details: avail("c"), personal_details: unavail("p") }, null);
    expect(lvaDrift.verdict).toBe("drift");
  });

  it("GP-U6 baseline: name requirement (GBR required, ESP not)", () => {
    const named = avail("p", analyzeSchema({ required: ["name"], properties: {} }));
    expect(evaluateBaseline("GBR", { contract_details: avail("c"), personal_details: named }, true).verdict).toBe("match");
    expect(evaluateBaseline("ESP", { contract_details: avail("c"), personal_details: named }, true).verdict).toBe("drift");
    expect(evaluateBaseline("ZZZ", {}, null).verdict).toBe("no_baseline");
  });

  it("GP-U7 entity status by country", () => {
    const ents = [
      { id: "a", name: "UK", countryCode: "GBR", gpEnabled: true },
      { id: "b", name: "CA", countryCode: "CAN", gpEnabled: false },
    ];
    expect(entityStatusFor("GBR", ents).status).toBe("gp_enabled");
    expect(entityStatusFor("CAN", ents).status).toBe("entity_no_gp");
    expect(entityStatusFor("DEU", ents).status).toBe("none");
    expect(entityStatusFor("DEU", null).status).toBe("unknown");
  });
});

describe("GP export", () => {
  const forms = {
    contract_details: avail("global_payroll_contract_details", analyzeSchema(GBR_CONTRACT)),
    personal_details: avail("global_payroll_personal_details", analyzeSchema({ required: ["name"], properties: { name: {} } })),
  };
  const gbr: CountryCapability = {
    code: "GBR", name: "United Kingdom", forms, coverage: "full", nameRequired: true,
    entity: { status: "gp_enabled", entityIds: ["le-1"] },
    catalog: { inCatalog: true, eorOnboarding: true, gpSchemasAdvertised: [] },
    baseline: evaluateBaseline("GBR", forms, true),
    durationMs: 10,
  };
  const report: GPRunReport = {
    timestamp: "2026-10-14T12:00:00.000Z", gatewayEnv: "partners", companySlug: "acme", scope: "custom",
    baselineSource: "test", catalogAdvertisesGP: false,
    entities: [{ id: "le-1", name: "UK", countryCode: "GBR", gpEnabled: true }],
    summary: summarize([gbr], 1000), countries: [gbr],
  };

  it("GP-U8 test-case CSV uses the Testing Guide columns", () => {
    const csv = toTestCasesCSV(report);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(TEST_GUIDE_COLUMNS.map((c) => (c.includes(",") ? `"${c}"` : c)).join(","));
    expect(row.startsWith("GPC-GBR,")).toBe(true);
    expect(row).toContain("Verified");
    expect(row).toContain("Contract:overtime_eligible");
  });

  it("GP-U9 matrix CSV and markdown render", () => {
    expect(toMatrixCSV(report).split("\n")[1]).toContain("GBR,United Kingdom");
    const md = toMarkdown(report);
    expect(md).toContain("| GBR | United Kingdom | Full (employer + employee) |");
    expect(md).toContain("inert-required");
  });
});
