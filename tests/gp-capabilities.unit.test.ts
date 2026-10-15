/**
 * Unit tests for the GP capability report. No network calls.
 * Run with: npm run test:gp-unit
 */

import { describe, expect, it } from "vitest";
import { analyzeSchema, isNameRequired, unwrapSchema } from "../src/gp/schema-analysis";
import { classifyCoverage, entityStatusFor, evaluateBaseline, normalizeReport, summarize } from "../src/gp/evaluate";
import { probeGPForm } from "../src/steps/gp-forms";
import type { RemoteClient } from "../src/client";
import { toMarkdown, toMatrixCSV, toTestCasesCSV, TEST_GUIDE_COLUMNS } from "../src/gp/export";
import { GP_BASELINE } from "../data/gp-capability-baseline";
import type { CountryCapability, FormProbe, GPRunReport } from "../src/gp/types";
import { employeesKey, loadEmployees, loadLocal, saveLocal, storageKey } from "../hooks/useGPCapabilities";
import { buildBasicInformation, createGPTestEmployee } from "../src/gp/test-employee";

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

describe("GP probe: forms that need an employment", () => {
  const fakeClient = (status: number, data: unknown) =>
    ({ get: async () => ({ status, data }) }) as unknown as RemoteClient;

  it("GP-U10 400 'missing required query parameter: employment_id' counts as published", async () => {
    const p = await probeGPForm(fakeClient(400, { message: "missing required query parameter: employment_id" }), "GBR", "global_payroll_contract_details");
    expect(p.status).toBe("requires_employment");
    expect(classifyCoverage({ contract_details: p, personal_details: avail("p") })).toBe("full");
    expect(evaluateBaseline("GBR", { contract_details: p, personal_details: avail("p", analyzeSchema({ required: ["name"], properties: {} })) }, true).verdict).toBe("match");
  });

  it("GP-U11 other 400s are still errors; 422 is still unavailable", async () => {
    expect((await probeGPForm(fakeClient(400, { message: "bad form" }), "GBR", "x")).status).toBe("error");
    expect((await probeGPForm(fakeClient(422, { message: "Form not available for requested country" }), "LVA", "x")).status).toBe("unavailable");
  });

  it("GP-U12 normalizeReport upgrades runs saved before the fix", () => {
    const old: CountryCapability = {
      code: "GBR", name: "United Kingdom", nameRequired: true, coverage: "unknown",
      forms: {
        contract_details: { form: "global_payroll_contract_details", status: "error", httpStatus: 400, message: "missing required query parameter: employment_id" },
        personal_details: avail("global_payroll_personal_details", analyzeSchema({ required: ["name"], properties: {} })),
      },
      entity: { status: "none", entityIds: [] },
      catalog: { inCatalog: true, gpSchemasAdvertised: [] },
      baseline: { verdict: "error", checks: [] },
      durationMs: 1,
    };
    const r = normalizeReport({
      timestamp: "t", gatewayEnv: "sandbox", scope: "baseline", baselineSource: "", catalogAdvertisesGP: false,
      entities: [], summary: summarize([old], 1), countries: [old],
    });
    expect(r.countries[0].coverage).toBe("full");
    expect(r.countries[0].baseline.verdict).toBe("match");
    expect(r.summary).toMatchObject({ full: 1, errors: 0, match: 1 });
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
    expect(md).toContain("Fields the form skips");
  });
});

describe("GP last run is kept per browser, environment and company", () => {
  const store: Record<string, string> = {};
  const g = globalThis as unknown as Record<string, unknown>;
  const connect = (env: string, slug: string) => {
    store["bhr_gateway_env"] = env;
    store[`bhr_company_slug__${env}`] = slug;
    store[`bhr_refresh_token__${env}`] = "rt";
  };
  const reportFor = (slug: string): GPRunReport => ({
    timestamp: "2026-10-14T12:00:00.000Z", gatewayEnv: "x", companySlug: slug, scope: "baseline",
    baselineSource: "", catalogAdvertisesGP: false, entities: [], summary: summarize([], 0), countries: [],
  });

  g.window = globalThis;
  g.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  };

  it("GP-U13 a run is only loaded back for the same environment and company", () => {
    store["bhr_company_slug__partners"] = "migrated"; // skip the legacy-key migration
    connect("sandbox", "company-c");
    saveLocal(reportFor("company-c"), storageKey());
    expect(loadLocal()?.companySlug).toBe("company-c");

    connect("sandbox", "company-a");          // different company, same environment
    expect(loadLocal()).toBeNull();

    connect("partners", "company-c");         // same company ID, other environment
    expect(loadLocal()).toBeNull();

    connect("sandbox", "company-c");          // back to the original
    expect(loadLocal()?.companySlug).toBe("company-c");
  });

  it("GP-U14 storage failures are swallowed", () => {
    const realSet = (g.localStorage as { setItem: unknown }).setItem;
    (g.localStorage as { setItem: unknown }).setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => saveLocal(reportFor("x"), "k")).not.toThrow();
    (g.localStorage as { setItem: unknown }).setItem = realSet;
    store[storageKey()] = "{not json";
    expect(loadLocal()).toBeNull();
  });

  it("GP-U18 test employees are kept per environment and company", () => {
    connect("partners", "company-e");
    store[employeesKey()] = JSON.stringify({ GBR: { countryCode: "GBR", employmentId: "emp-1" } });
    expect(loadEmployees().GBR?.employmentId).toBe("emp-1");
    connect("partners", "company-f");
    expect(loadEmployees()).toEqual({});
    connect("sandbox", "company-e");
    expect(loadEmployees()).toEqual({});
    store[employeesKey()] = "{not json";
    expect(loadEmployees()).toEqual({});
  });
});

describe("GP test employees", () => {
  it("GP-U15 the probe reads a form for a test employee when given one", async () => {
    const paths: string[] = [];
    const client = { get: async (path: string) => { paths.push(path); return { status: 200, data: { data: GBR_CONTRACT } }; } } as unknown as RemoteClient;
    const p = await probeGPForm(client, "GBR", "global_payroll_contract_details", { employmentId: "emp-123" });
    expect(paths[0]).toBe("/v1/countries/GBR/global_payroll_contract_details?employment_id=emp-123");
    expect(p.status).toBe("available");
    expect(p.employmentId).toBe("emp-123");
    const generic = await probeGPForm(client, "GBR", "global_payroll_contract_details");
    expect(paths[1]).toBe("/v1/countries/GBR/global_payroll_contract_details");
    expect(generic.employmentId).toBeUndefined();
  });

  it("GP-U16 basic information covers the common fields and fills other required options from the schema", () => {
    const schema = {
      required: ["name", "job_title", "has_seniority_date", "provisional_start_date", "login_email", "department", "free_text"],
      properties: {
        has_seniority_date: { oneOf: [{ const: "yes" }, { const: "no" }] },
        department: { oneOf: [{ const: null }, { const: "engineering" }, { const: "sales" }] },
        free_text: { type: "string" },
      },
    };
    const info = buildBasicInformation(schema, "GP Test GBR", "t@example.com");
    expect(info.has_seniority_date).toBe("no");      // our default wins over the first option
    expect(info.login_email).toBe("personal");
    expect(info.personal_email).toBe("t@example.com");
    expect(info).not.toHaveProperty("email");        // rejected next to login_email/personal_email
    expect(info.department).toBe("engineering");     // first non-null option
    expect(info).not.toHaveProperty("free_text");    // no options: left for the API to report
    expect(info.provisional_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /** Fake client that records POSTs and serves a fixed entity list */
  const companyClient = (entities: Record<string, unknown>[]) => {
    const posts: { path: string; body: unknown }[] = [];
    const client = {
      get: async (path: string) =>
        path.endsWith("/legal-entities")
          ? { status: 200, data: { data: { legal_entities: entities } } }
          : { status: 200, data: { data: { required: ["name"], properties: {} } } },
      post: async (path: string, body?: unknown) => {
        posts.push({ path, body });
        if (path.endsWith("/legal-entities")) return { status: 201, data: { data: { id: "new-ent", country_code: "DEU" } } };
        if (path === "/v1/employments") return { status: 201, data: { data: { employment: { id: "emp-9" } } } };
        return { status: 200, data: { data: { status: "ok" } } };
      },
    } as unknown as RemoteClient;
    return { client, posts };
  };

  it("GP-U17a uses a GP-enabled entity as is, and creates the employment like the SDK does", async () => {
    const { client, posts } = companyClient([{ id: "ent-gbr", country_code: "GBR", global_payroll_enabled: true }]);
    const emp = await createGPTestEmployee(client, "co-1", "gbr");
    expect(emp).toMatchObject({ countryCode: "GBR", employmentId: "emp-9", legalEntityId: "ent-gbr", changes: [] });
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe("/v1/employments");
    expect(posts[0].body).toMatchObject({ type: "global_payroll_employee", country_code: "GBR", engaged_by_legal_entity_id: "ent-gbr" });
  });

  it("GP-U17b switches GP on for an existing entity that has it off", async () => {
    const { client, posts } = companyClient([{ id: "ent-gbr", country_code: "GBR", global_payroll_enabled: false }]);
    const emp = await createGPTestEmployee(client, "co-1", "GBR");
    expect(posts.map((p) => p.path)).toEqual([
      "/v1/sandbox/companies/co-1/legal-entities/ent-gbr/activate-global-payroll",
      "/v1/employments",
    ]);
    expect(emp.changes).toEqual(["Switched on Global Payroll for your GBR legal entity"]);
  });

  it("GP-U17c adds an entity in a new country, then switches GP on", async () => {
    const { client, posts } = companyClient([{ id: "ent-gbr", country_code: "GBR", global_payroll_enabled: true }]);
    const emp = await createGPTestEmployee(client, "co-1", "DEU");
    expect(posts.map((p) => p.path)).toEqual([
      "/v1/sandbox/companies/co-1/legal-entities",
      "/v1/sandbox/companies/co-1/legal-entities/new-ent/activate-global-payroll",
      "/v1/employments",
    ]);
    expect(emp.legalEntityId).toBe("new-ent");
    expect(emp.changes).toHaveLength(2);
  });

  it("GP-U17d surfaces the API's reason when creation fails", async () => {
    const client = {
      get: async (path: string) => path.endsWith("/legal-entities")
        ? { status: 200, data: { data: { legal_entities: [{ id: "e", country_code: "GBR", global_payroll_enabled: true }] } } }
        : { status: 200, data: { data: { required: [], properties: {} } } },
      post: async () => ({ status: 422, data: { message: "Unprocessable Entity", errors: { login_email: ["is invalid"] } }, requestId: "req-42" }),
    } as unknown as RemoteClient;
    await expect(createGPTestEmployee(client, "co-1", "GBR")).rejects.toThrow(/422.*login_email.*request ID req-42/);
  });
});
