/**
 * Unit tests for the skipped-field check. No network calls.
 * Run with: npx vitest run tests/gp-field-check.unit.test.ts
 */

import { describe, expect, it } from "vitest";
import { buildFormPayload, checkSkippedFields, interpretSubmit, rejectedFields } from "../src/gp/field-check";
import { fieldCheckText } from "../src/gp/export";
import { RECORDED_FIELD_CHECKS } from "../data/gp-field-checks";
import type { RemoteClient } from "../src/client";
import type { CountryCapability } from "../src/gp/types";

// Shaped like global_payroll_administrative_details (GBR, Sept 2026), trimmed
const ADMIN = {
  type: "object",
  required: ["worker_status", "is_foreign_national", "country_of_citizenship", "has_student_loan"],
  properties: {
    worker_status: { type: "string", oneOf: [{ const: "entitled_worker" }, { const: "eligible_job_holder" }] },
    is_foreign_national: { type: "string", oneOf: [{ const: "yes" }, { const: "no" }] },
    has_student_loan: { type: ["string", "null"], oneOf: [{ const: "yes" }, { const: "no" }, { const: null }] },
    student_loan_plan_type: { type: "string", oneOf: [{ const: "plan-type-1" }] },
    country_of_citizenship: { type: "array", items: { type: "string", oneOf: [{ const: "Afghanistan" }, { const: "Albania" }] } },
    tax_code: { type: ["string", "null"], pattern: "^([SC]?(K[1-9][0-9]{0,4}|[0-9]{1,5}[LMNT]|BR|D[01])|SD[23]|NT)$" },
    wm_indicator: { type: ["string", "null"] },
    right_to_work: { type: "string", oneOf: [{ const: "yes" }] },
    visa_number: { type: "string", minLength: 20 },
    work_address: {
      type: "object",
      required: ["city", "postal_code"],
      properties: { city: { type: "string" }, postal_code: { type: "string" } },
    },
    hours: { type: "number", minimum: 0, maximum: 60 },
  },
  allOf: [
    { if: false, then: { required: ["wm_indicator"] } },
    { if: false, then: { required: ["tax_code"] } },
    // "yes" opens a branch; the filler prefers "no" so it stays closed
    {
      if: { properties: { has_student_loan: { const: "yes" } }, required: ["has_student_loan"] },
      then: { required: ["student_loan_plan_type"] },
      else: { properties: { student_loan_plan_type: false } },
    },
    // A live rule the filler must follow: with is_foreign_national "no", work_address and hours become required
    { if: { properties: { is_foreign_national: { const: "no" } } }, then: { required: ["work_address", "hours"] } },
  ],
};

describe("GP skipped-field check: filling the form", () => {
  it("GP-F1 fills required fields, prefers 'no', follows live rules and leaves skipped fields out", () => {
    const { values, unsure } = buildFormPayload(ADMIN, ["tax_code", "wm_indicator"], "GBR");
    expect(values).toMatchObject({
      worker_status: "entitled_worker",
      is_foreign_national: "no",
      has_student_loan: "no",
      country_of_citizenship: ["Afghanistan"],
      work_address: { city: "London", postal_code: "SW1A 1AA" },
      hours: 1,
    });
    expect(values).not.toHaveProperty("tax_code");
    expect(values).not.toHaveProperty("wm_indicator");
    expect(values).not.toHaveProperty("student_loan_plan_type"); // branch stayed closed
    expect(values).not.toHaveProperty("right_to_work"); // not required, so not sent
    expect(unsure).toEqual([]);
  });

  it("GP-F2 satisfies patterns and minimum lengths when the field is required", () => {
    const schema = { ...ADMIN, required: ["tax_code", "visa_number"], allOf: [] };
    const { values } = buildFormPayload(schema, []);
    expect(String(values.tax_code)).toMatch(new RegExp(ADMIN.properties.tax_code.pattern));
    expect(String(values.visa_number).length).toBeGreaterThanOrEqual(20);
  });

  // Rejected live in the partners sandbox, 15 Oct 2026: MEX fiscal_zip_code "Must be 5 numbers"
  // (req 5f671715…), SWE ssn "Must have a valid format. E.g. 19900101-1234" (req b96c81c1…)
  it("GP-F10 sends valid national IDs and postcodes for fields the API validates beyond the pattern", () => {
    const str = { type: "string" };
    const mex = buildFormPayload({ type: "object", required: ["fiscal_zip_code", "curp", "rfc", "ssn"], properties: { fiscal_zip_code: str, curp: str, rfc: str, ssn: str } }, [], "MEX").values;
    expect(mex.fiscal_zip_code).toMatch(/^\d{5}$/);
    expect(mex.curp).toMatch(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/);
    expect(mex.rfc).toMatch(/^[A-Z]{4}\d{6}[A-Z0-9]{3}$/);
    expect(mex.ssn).toMatch(/^\d{11}$/);
    const swe = buildFormPayload({ type: "object", required: ["ssn"], properties: { ssn: str } }, [], "SWE").values;
    expect(swe.ssn).toMatch(/^\d{8}-\d{4}$/);
    const can = buildFormPayload({ type: "object", required: ["sin"], properties: { sin: { type: "string", pattern: "^\\d{9}$" } } }, [], "CAN").values;
    expect(can.sin).toBe("046454286"); // Luhn-valid
  });

  // CAN, partners sandbox, 15 Oct 2026: sin_expiry_date "must be empty" (req 6773a203…), because a
  // pattern condition on sin was treated as holding. Only temporary-resident SINs (starting 9) expire.
  it("GP-F11 evaluates pattern conditions, so a rule keyed on the value's format stays closed", () => {
    const schema = {
      type: "object",
      required: ["sin"],
      properties: { sin: { type: "string", pattern: "^\\d{9}$" }, sin_expiry_date: { type: "string", format: "date" } },
      allOf: [{ if: { properties: { sin: { pattern: "^9" } }, required: ["sin"] }, then: { required: ["sin_expiry_date"] }, else: { properties: { sin_expiry_date: false } } }],
    };
    expect(buildFormPayload(schema, [], "CAN").values).not.toHaveProperty("sin_expiry_date");
    expect(buildFormPayload({ ...schema, properties: { ...schema.properties, sin: { const: "912345678" } } }, []).values).toHaveProperty("sin_expiry_date");
  });
});

describe("GP skipped-field check: reading the response", () => {
  const skipped = ["tax_code", "wm_indicator"];

  it("GP-F3 2xx means not enforced", () => {
    expect(interpretSubmit(200, { data: {} }, skipped).outcome).toBe("not_enforced");
  });

  it("GP-F4 a 422 naming a skipped field means enforced, in each error shape Remote uses", () => {
    const shapes = [
      { errors: { tax_code: ["can't be blank"] } },
      { errors: { administrative_details: { tax_code: ["can't be blank"] } } },
      { administrative_details: [{ tax_code: ["can't be blank"] }] },
      { message: "tax_code — can't be blank" },
    ];
    for (const body of shapes) {
      const r = interpretSubmit(422, body, skipped, "administrative_details");
      expect(r.outcome, JSON.stringify(body)).toBe("enforced");
      expect(r.enforcedFields).toEqual(["tax_code"]);
    }
  });

  it("GP-F5 a 422 naming only other fields is inconclusive, and says which", () => {
    const r = interpretSubmit(422, { message: "Unprocessable Entity", errors: { work_address: { postal_code: ["is invalid"] } } }, skipped, "administrative_details");
    expect(r.outcome).toBe("inconclusive");
    expect(r.otherRejected).toContain("postal_code");
    expect(rejectedFields({ errors: { administrative_details: { x: ["bad"] } } }, "administrative_details")).toEqual(["x"]);
  });

  it("GP-F6 other statuses are errors", () => {
    expect(interpretSubmit(500, { message: "Internal Server Error" }, skipped).outcome).toBe("error");
  });
});

describe("GP skipped-field check: end to end against a fake client", () => {
  const fake = (putStatus: number, putBody: unknown) => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const client = {
      get: async (path: string) => {
        calls.push({ method: "GET", path });
        return { status: 200, data: { data: { schema: ADMIN } } };
      },
      put: async (path: string, body: unknown) => {
        calls.push({ method: "PUT", path, body });
        return { status: putStatus, data: putBody, requestId: "req-7" };
      },
    } as unknown as RemoteClient;
    return { client, calls };
  };

  it("GP-F7 reads the employee's form, PUTs it in the SDK's envelope, and records the verdict", async () => {
    const { client, calls } = fake(422, { errors: { wm_indicator: ["can't be blank"] } });
    const r = await checkSkippedFields(client, "can", "administrative_details", "emp-123456");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v1/countries/CAN/global_payroll_administrative_details?employment_id=emp-123456" });
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].path).toBe("/v2/employments/emp-123456/administrative-details");
    expect(Object.keys(calls[1].body as object)).toEqual(["administrative_details"]);
    expect(r).toMatchObject({ countryCode: "CAN", outcome: "enforced", enforcedFields: ["wm_indicator"], skippedFields: ["tax_code", "wm_indicator"], requestId: "req-7", source: "live" });
    expect(r.sentFields).toContain("worker_status");
  });

  it("GP-F8 a form with nothing skipped isn't submitted at all", async () => {
    const calls: string[] = [];
    const client = {
      get: async () => ({ status: 200, data: { data: { schema: { required: ["a"], properties: { a: { type: "string" } } } } } }),
      put: async (p: string) => { calls.push(p); return { status: 200, data: {} }; },
    } as unknown as RemoteClient;
    const r = await checkSkippedFields(client, "GBR", "contract_details", "emp-123456");
    expect(r.outcome).toBe("nothing_to_check");
    expect(calls).toEqual([]);
  });
});

describe("GP skipped-field check: recorded results and export", () => {
  it("GP-F9 the admin-details results from the partners sandbox are recorded as not enforced", () => {
    const admin = (cc: string) => RECORDED_FIELD_CHECKS.find((r) => r.countryCode === cc && r.form === "administrative_details");
    expect(admin("GBR")).toMatchObject({ outcome: "not_enforced", skippedFields: ["tax_code", "wm_indicator"], source: "recorded" });
    expect(admin("CAN")).toMatchObject({ outcome: "not_enforced", skippedFields: ["qpip_exempt"] });
    expect(admin("MEX")).toMatchObject({ outcome: "not_enforced", skippedFields: ["has_imss_movement", "integrated_daily_wage"] });
    expect(admin("SWE")).toMatchObject({ outcome: "not_enforced", skippedFields: ["se_pension_employee_contribution_rate"] });
    const c = { code: "GBR", fieldChecks: [admin("GBR")!] } as unknown as CountryCapability;
    expect(fieldCheckText(c)).toEqual(["Admin: skips tax_code, wm_indicator: not enforced (200, recorded 2026-10-15)"]);
  });
});
