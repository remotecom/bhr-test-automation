/**
 * Unit tests for the testing guide (data/gp-guide) and its spreadsheet round trip. No network calls.
 * Run with: npx vitest run tests/gp-guide.unit.test.ts
 */

import { describe, expect, it } from "vitest";
import { GUIDE } from "../data/gp-guide";
import { caseGrid, cellText, findInternalRefs, guideFromSheets, type Grid } from "../src/gp/guide/sheet";
import { readGuideXlsx, writeGuideXlsx } from "../src/gp/guide/xlsx";
import { GUIDE_STATUSES, GUIDE_TABS, type Guide } from "../src/gp/guide/types";
import { buildPublished, mergePublished, sanitizeReport } from "../src/gp/guide/publish";
import { GUIDE_CHECKS, runGuideChecks, type GuideCheckResult } from "../src/gp/guide/checks";
import type { RemoteClient } from "../src/client";
import type { GPRunReport } from "../src/gp/types";

describe("GP testing guide: data", () => {
  it("GP-G1 has every tab's cases, unique IDs and known statuses", () => {
    for (const t of GUIDE_TABS) expect(GUIDE.cases.some((c) => c.tab === t.key)).toBe(true);
    const ids = GUIDE.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GUIDE.cases) expect(GUIDE_STATUSES).toContain(c.status);
  });

  it("GP-G2 contains nothing internal: no ticket IDs, tracker links or merge requests", () => {
    expect(findInternalRefs(GUIDE)).toEqual([]);
  });
});

describe("GP testing guide: spreadsheet", () => {
  it("GP-G3 reads cells as a person would see them", () => {
    expect(cellText(200)).toBe("200");
    expect(cellText("200.0")).toBe("200");
    expect(cellText(new Date("2026-10-07T00:00:00Z"))).toBe("2026-10-07");
    expect(cellText({ formula: 'HYPERLINK("https://x.test","Company Creation Testing Guide")' })).toBe("Company Creation Testing Guide");
    expect(cellText({ formula: "B6-B8", result: 56 })).toBe("56");
  });

  it("GP-G4 ignores internal tabs and refuses internal references in partner tabs", () => {
    const sheets: Record<string, Grid> = {
      Overview: [["Title"], ["Subtitle"]],
      "Known Issues (internal)": [["Ticket"], ["PBYR-4925"]],
      ...Object.fromEntries(GUIDE_TABS.map((t) => [t.title, caseGrid([])])),
    };
    sheets["GP Admin Onboarding"] = caseGrid([
      { id: "A1", tab: "admin", scenario: "s", input: "i", expected: "e", response: "r", notes: "See PBYR-4962", status: "Verified", comments: "" },
    ]);
    const { guide, problems } = guideFromSheets(sheets);
    expect(guide.cases.map((c) => c.id)).toEqual(["A1"]);
    expect(problems.join("\n")).toMatch(/A1 notes: Linear ticket ID/);
    expect(problems.join("\n")).not.toMatch(/Known Issues/);
  });

  it("GP-G5 flags unknown statuses and malformed dates instead of guessing", () => {
    const sheets: Record<string, Grid> = Object.fromEntries(GUIDE_TABS.map((t) => [t.title, caseGrid([])]));
    sheets.Overview = [["T"], ["S"]];
    const grid = caseGrid([{ id: "S1", tab: "setup", scenario: "", input: "", expected: "", response: "", notes: "", status: "Verified", comments: "" }]);
    grid[1][6] = "Done";
    grid[1][8] = "7 Oct";
    sheets.Setup = grid;
    const { problems } = guideFromSheets(sheets);
    expect(problems).toContain('S1: unknown status "Done"');
    expect(problems.some((p) => p.includes('"Last checked" should be YYYY-MM-DD'))).toBe(true);
  });

  it("GP-G6 export then import gives back the same guide", async () => {
    const xlsx = await writeGuideXlsx(GUIDE);
    const { guide, problems } = await readGuideXlsx(xlsx);
    expect(problems).toEqual([]);
    expect(guide).toEqual(GUIDE as Guide);
  });
});

describe("GP testing guide: publishing", () => {
  const report = {
    timestamp: "2026-10-15T18:00:00Z", gatewayEnv: "partners", companySlug: "fede1c28-secret", scope: "baseline", baselineSource: "x",
    catalogAdvertisesGP: true, entitiesError: "e",
    entities: [{ id: "ent-1", name: "BHR Test Co", countryCode: "GBR", gpEnabled: true }],
    summary: { total: 1, full: 1, employerOnly: 0, employeeOnly: 0, none: 0, errors: 0, match: 1, drift: 0, noBaseline: 0, gpEntityCountries: 1, duration: 1 },
    countries: [{
      code: "GBR", name: "United Kingdom", employmentId: "emp-1",
      forms: { contract_details: { form: "global_payroll_contract_details", status: "available", httpStatus: 200, employmentId: "emp-1" } },
      coverage: "full", nameRequired: true, entity: { status: "gp_enabled", entityIds: ["ent-1"] },
      catalog: { inCatalog: true, gpSchemasAdvertised: [] }, baseline: { verdict: "match", checks: [] }, durationMs: 1,
      fieldChecks: [{ countryCode: "GBR", form: "administrative_details", skippedFields: [], outcome: "not_enforced", enforcedFields: [], otherRejected: [], sentFields: [], employmentId: "emp-1", requestId: "req-1", checkedAt: "2026-10-15", source: "live" }],
    }],
  } as unknown as GPRunReport;

  it("GP-G7 published reports carry no company, entity or employment identifiers", () => {
    const out = JSON.stringify(sanitizeReport(report));
    for (const secret of ["fede1c28-secret", "ent-1", "BHR Test Co", "emp-1"]) expect(out).not.toContain(secret);
    expect(out).toContain("req-1"); // request IDs stay: Remote can look them up
  });

  it("GP-G8 the publish payload keeps well-formed checks only, and needs something to publish", () => {
    const p = buildPublished({ report, checks: [{ caseId: "A5", outcome: "as_recorded", summary: "ok", details: ["x", 3], checkedAt: "t" }, { bogus: true }] }, new Date("2026-10-15T19:00:00Z"));
    expect(p.publishedAt).toBe("2026-10-15T19:00:00.000Z");
    expect(p.checks).toEqual([{ caseId: "A5", outcome: "as_recorded", summary: "ok", details: ["x"], checkedAt: "t" }]);
    expect(p.report?.companySlug).toBeUndefined();
    expect(buildPublished({}).checks).toEqual([]);
  });

  // 15 Oct 2026: a second Publish on top of a stale copy dropped every published check
  it("GP-G13 publishing again never loses results: checks merge per case, the report is kept", () => {
    const a5 = { caseId: "A5", outcome: "as_recorded" as const, summary: "ok", details: [], checkedAt: "t1" };
    const a1 = { caseId: "A1", outcome: "skipped" as const, summary: "no GBR", details: [], checkedAt: "t1" };
    const first = mergePublished({ publishedAt: null, checks: [] }, buildPublished({ checks: [a5, a1] }));
    const reportOnly = mergePublished(first, buildPublished({ report }));
    expect(reportOnly.checks.map((c) => c.caseId)).toEqual(["A1", "A5"]);
    expect(reportOnly.report?.countries).toHaveLength(1);
    const rerun = mergePublished(reportOnly, buildPublished({ checks: [{ ...a1, outcome: "as_recorded", checkedAt: "t2" }] }));
    expect(rerun.checks.find((c) => c.caseId === "A1")?.outcome).toBe("as_recorded");
    expect(rerun.checks.find((c) => c.caseId === "A5")?.checkedAt).toBe("t1");
    expect(rerun.report?.countries).toHaveLength(1);
  });

  it("GP-G9 the automated-check column is exported but never imported", async () => {
    const checks: GuideCheckResult[] = [{ caseId: "A5", outcome: "as_recorded", summary: "LVA: 422", details: [], checkedAt: "2026-10-15T18:00:00Z" }];
    const { guide, problems } = await readGuideXlsx(await writeGuideXlsx(GUIDE, { generatedNote: "note", checks }));
    expect(problems).toEqual([]);
    expect(guide).toEqual(GUIDE as Guide);
  });
});

describe("GP testing guide: automated checks against a fake client", () => {
  const fake = (routes: Record<string, { status: number; data: unknown }>) =>
    ({
      get: async (path: string) => {
        const hit = Object.entries(routes).find(([k]) => path.includes(k));
        return hit ? hit[1] : { status: 404, data: { message: "not found" } };
      },
      put: async () => ({ status: 200, data: {} }),
    }) as unknown as RemoteClient;

  it("GP-G10 every automated check is attached to a case in the guide", () => {
    for (const id of Object.keys(GUIDE_CHECKS)) expect(GUIDE.cases.some((c) => c.id === id)).toBe(true);
  });

  it("GP-G11 compares with what the guide records: matches, differs, or skipped without a test employee", async () => {
    const ctx = (client: RemoteClient) => ({ client, companySlug: "co", employments: {} });
    const needsEmployee = { status: 400, data: { message: "missing required query parameter: employment_id" } };
    const unavailable = { status: 422, data: { message: "Form not available for requested country" } };
    /** GET /v1/countries with MLT and HUN as recorded, plus per-form replies */
    const catalog = (countries: unknown[], forms: Record<string, { status: number; data: unknown }> = {}) =>
      ({
        get: async (path: string) => {
          if (path === "/v1/countries") return { status: 200, data: { data: countries } };
          const hit = Object.entries(forms).find(([k]) => path.includes(k));
          return hit ? hit[1] : needsEmployee;
        },
      }) as unknown as RemoteClient;
    const MLT = { code: "MLT", name: "Malta", global_payroll_supported: false, supported_json_schemas: ["contract_details"] };
    const HUN = { code: "HUN", name: "Hungary", global_payroll_supported: false, supported_json_schemas: ["global_payroll_contract_details", "global_payroll_administrative_details"] };
    const asRecorded = catalog([MLT, HUN], { "MLT/global_payroll_contract_details": unavailable, "HUN/global_payroll_personal_details": unavailable });

    const [a5, a6, a1] = await runGuideChecks(ctx(asRecorded), ["A5", "A6", "A1"]);
    expect(a5).toMatchObject({ caseId: "A5", outcome: "as_recorded", summary: "MLT: global_payroll_supported false, no GP forms listed, form 422" });
    expect(a5.details).toContain("GET MLT/global_payroll_contract_details: 422 Form not available for requested country");

    // The form answering 400 (it exists, needs an employee) is a change even if the catalog still says no
    const [c5] = await runGuideChecks(ctx(catalog([MLT, HUN])), ["A5"]);
    expect(c5).toMatchObject({ outcome: "differs", summary: "MLT's contract-details form now returns 400 (requires_employment)" });
    expect(a6).toMatchObject({ caseId: "A6", outcome: "as_recorded" });
    expect(a1).toMatchObject({ caseId: "A1", outcome: "skipped", summary: "Needs a GBR test employee" });

    // MLT gains GP; HUN gains the personal-details form
    const changed = catalog(
      [{ ...MLT, global_payroll_supported: true, supported_json_schemas: ["global_payroll_contract_details", "global_payroll_personal_details"] },
       { ...HUN, supported_json_schemas: [...HUN.supported_json_schemas, "global_payroll_personal_details"] }],
      { "HUN/global_payroll_personal_details": { status: 200, data: { data: { schema: { type: "object", properties: {} } } } } }
    );
    const [b5, b6] = await runGuideChecks(ctx(changed), ["A5", "A6"]);
    expect(b5).toMatchObject({ outcome: "differs", summary: "MLT now supports GP in GET /v1/countries" });
    expect(b6).toMatchObject({ outcome: "differs", summary: "HUN now publishes the personal-details form too" });
  });

  it("GP-G12 a failing check reports an error instead of stopping the run", async () => {
    const client = { get: async () => { throw new Error("network down"); } } as unknown as RemoteClient;
    const results = await runGuideChecks({ client, companySlug: "co", employments: { GBR: "emp-123456" } }, ["A1", "A5"]);
    expect(results.map((r) => r.outcome)).toEqual(["error", "error"]);
  });
});
