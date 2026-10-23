/**
 * Unit tests for the employee self-onboarding checks (guide rows E1, E3, E4, E7, E8). No network
 * calls: a fake company client lists employments and serves forms, and its asAssertion() returns a
 * fake employee client that plays /v1/employee/*.
 */

import { describe, expect, it } from "vitest";
import { EMPLOYEE_CHECKS, NEEDS_INVITED } from "../src/gp/guide/employee-checks";
import { DEFAULT_CHECK_IDS, runGuideChecks } from "../src/gp/guide/checks";
import { GUIDE } from "../data/gp-guide";
import type { RemoteClient } from "../src/client";

type Reply = { status: number; data?: unknown; requestId?: string };
type Call = { method: string; path: string; body?: unknown };

const PERSONAL = { data: { schema: {
  required: ["name", "given_name", "surname", "sex", "birthdate"],
  properties: {
    name: { type: "string" }, given_name: { type: "string" }, surname: { type: "string" },
    sex: { type: "string", oneOf: [{ const: "female" }, { const: "male" }] },
    birthdate: { type: "string", format: "date" },
    title: { type: ["string", "null"], oneOf: [{ const: "mr" }, { const: "ms" }] },
  },
} } };
const BANK = { data: { schema: {
  required: ["account_holder", "account_number"],
  properties: { account_holder: { type: "string" }, account_number: { type: "string", pattern: "^\\d{8}$" } },
} } };

/** Remote as recorded for an invited employee */
function asRecorded(method: string, path: string, body?: unknown): Reply {
  if (path === "/v1/employee/personal-details") {
    const v = (body as { personal_details: Record<string, unknown> }).personal_details;
    if (!("name" in v)) return { status: 422, data: { message: "Unprocessable Entity", errors: { name: ["can't be blank"] } } };
    if (typeof v.nationality === "string") return { status: 422, data: { errors: { nationality: ["Type mismatch. Expected Array, Null but got String."] } } };
    if (v.title === "Mr") return { status: 422, data: { errors: { title: ["is invalid"] } } };
    return { status: 200, data: { data: {} } };
  }
  if (path === "/v1/employee/current") return { status: 409, data: { message: "The employment is expected to be active in order to perform this action" } };
  if (path === "/v1/employee/bank-account") return { status: 200, data: { data: {} } };
  return { status: 404, data: {} };
}

function fakes(employments: unknown[], employee: (method: string, path: string, body?: unknown) => Reply = asRecorded) {
  const calls: Call[] = [];
  const subs: string[] = [];
  const employeeClient = {
    get: async (p: string) => (calls.push({ method: "GET", path: p }), employee("GET", p)),
    put: async (p: string, b?: unknown) => (calls.push({ method: "PUT", path: p, body: b }), employee("PUT", p, b)),
  };
  const client = {
    get: async (p: string): Promise<Reply> => {
      calls.push({ method: "GET", path: p });
      if (p.startsWith("/v1/employments?page=")) return { status: 200, data: { data: { employments, total_pages: 1 } } };
      if (p.includes("global_payroll_personal_details?employment_id=")) return { status: 200, data: PERSONAL };
      if (p.includes("global_payroll_bank_account_details?employment_id=")) return { status: 200, data: BANK };
      return { status: 404, data: {} };
    },
    asAssertion: (sub: string) => (subs.push(sub), employeeClient),
  } as unknown as RemoteClient;
  return { calls, subs, ctx: { client, companySlug: "co-1", employments: {} } };
}

const INVITED = [
  { id: "c-1", type: "global_payroll_employee", status: "created", country: { code: "GBR" } },
  { id: "deu-1", type: "global_payroll_employee", status: "invited", country: { code: "DEU" } },
  { id: "gbr-inv", type: "global_payroll_employee", status: "invited", country: { code: "GBR" } },
];

describe("Employee self-onboarding checks", () => {
  it("GP-EM1 E1, E3, E4, E7 and E8 have guide rows and run with the quick checks", () => {
    for (const id of Object.keys(EMPLOYEE_CHECKS)) {
      expect(GUIDE.cases.find((c) => c.id === id), id).toMatchObject({ tab: "employee" });
      expect(DEFAULT_CHECK_IDS).toContain(id);
    }
  });

  it("GP-EM2 act as an invited GBR GP employee already in the company, one token for the whole run", async () => {
    const f = fakes(INVITED);
    const results = await runGuideChecks(f.ctx, ["E1", "E3", "E4", "E7", "E8"]);
    expect(f.subs).toEqual(["urn:remote-api:employee:employment:gbr-inv"]);
    expect(f.calls.filter((c) => c.method === "POST")).toEqual([]); // nothing created
    expect(results.map((r) => `${r.caseId} ${r.outcome}`)).toEqual(["E1 as_recorded", "E3 as_recorded", "E4 as_recorded", "E7 as_recorded", "E8 as_recorded"]);
  });

  it("GP-EM3 personal details go in the SDK's envelope; E3/E4 change only their field", async () => {
    const f = fakes(INVITED);
    await runGuideChecks(f.ctx, ["E1", "E3", "E4"]);
    const puts = f.calls.filter((c) => c.method === "PUT" && c.path === "/v1/employee/personal-details").map((c) => (c.body as { personal_details: Record<string, unknown> }).personal_details);
    expect(puts).toHaveLength(4); // E1 twice, E3, E4
    expect(puts[0]).not.toHaveProperty("name");
    expect(puts[1]).toHaveProperty("name");
    expect(puts[2].nationality).toBe("GBR");
    expect(puts[3].title).toBe("Mr");
    expect(puts[3].name).toBe(puts[1].name);
  });

  it("GP-EM4 no invited GBR employee: the checks skip and say how to get one", async () => {
    const [e1] = await runGuideChecks(fakes(INVITED.slice(0, 2)).ctx, ["E1"]);
    expect(e1).toMatchObject({ outcome: "skipped", summary: NEEDS_INVITED });
  });

  it("GP-EM5 changes are reported: name no longer required, /current works before activation, a test bank value rejected", async () => {
    const changed = fakes(INVITED, (m, p, b) => {
      if (p === "/v1/employee/personal-details") return { status: 200, data: {} };
      if (p === "/v1/employee/current") return { status: 200, data: { data: { employment: {} } } };
      if (p === "/v1/employee/bank-account") return { status: 422, data: { errors: { account_number: ["is invalid"] } } };
      return asRecorded(m, p, b);
    });
    const [e1, e7, e8] = await runGuideChecks(changed.ctx, ["E1", "E7", "E8"]);
    expect(e1).toMatchObject({ outcome: "differs", summary: "Without name: accepted (200)" });
    expect(e7.outcome).toBe("differs");
    expect(e8).toMatchObject({ outcome: "inconclusive" });
  });
});
