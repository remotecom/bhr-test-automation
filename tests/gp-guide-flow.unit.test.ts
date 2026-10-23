/**
 * Unit tests for the functional (flow and error) checks behind guide rows A9-A18. No network calls:
 * a fake client plays Remote.
 */

import { describe, expect, it } from "vitest";
import { FUNCTIONAL_CHECKS, judge } from "../src/gp/guide/flow";
import { DEFAULT_CHECK_IDS, GUIDE_CHECKS, runGuideChecks } from "../src/gp/guide/checks";
import { FUNCTIONAL_CASE_IDS } from "../data/gp-guide/functional-expectations";
import { GUIDE } from "../data/gp-guide";
import type { RemoteClient } from "../src/client";

type Reply = { status: number; data?: unknown; requestId?: string };
type Handler = (method: string, path: string, body?: unknown) => Reply | undefined;

/** A fake gateway: GBR forms, one GP-enabled GBR entity, overridable per test */
function fakeClient(override: Handler = () => undefined) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let n = 0;
  const base: Handler = (method, path) => {
    if (method === "GET" && /legal-entities$/.test(path)) {
      return { status: 200, data: { data: [{ slug: "le-gbr", country_code: "GBR", global_payroll_enabled: true }] } };
    }
    if (method === "GET" && /global_payroll_basic_information/.test(path)) {
      return { status: 200, data: { data: { schema: { required: ["name"], properties: { name: { type: "string" } } } } } };
    }
    if (method === "GET" && /global_payroll_(contract|administrative)_details\?employment_id=/.test(path)) {
      return { status: 200, data: { data: { schema: {
        required: ["work_schedule", "wage_type"],
        properties: { work_schedule: { type: "string", oneOf: [{ const: "full_time" }, { const: "part_time" }] }, wage_type: { type: "string", oneOf: [{ const: "salary" }] } },
      } } } };
    }
    if (method === "POST" && path === "/v1/employments") return { status: 201, data: { data: { employment: { id: `emp-${++n}` } } } };
    if (method === "PUT") return { status: 200, data: { data: {} } };
    if (method === "POST" && /\/invite$/.test(path)) return { status: 200, data: { data: { status: "ok" } } };
    if (method === "GET" && /onboarding-steps$/.test(path)) return { status: 200, data: { data: [{ name: "contract_details", status: "completed" }, { name: "invite", status: "pending" }] } };
    return { status: 404, data: { message: `not mocked: ${method} ${path}` } };
  };
  const call = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    return override(method, path, body) ?? base(method, path, body)!;
  };
  const client = {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown) => call("POST", p, b),
    put: (p: string, b?: unknown) => call("PUT", p, b),
  } as unknown as RemoteClient;
  return { client, calls, ctx: { client, companySlug: "co-1", employments: {} } };
}

describe("GP functional checks: wiring", () => {
  it("GP-FL1 every functional check has a guide row, and the quick checks exclude them", () => {
    expect(Object.keys(FUNCTIONAL_CHECKS).sort()).toEqual([...FUNCTIONAL_CASE_IDS].sort());
    for (const id of FUNCTIONAL_CASE_IDS) {
      expect(GUIDE.cases.find((c) => c.id === id), id).toMatchObject({ tab: "admin", method: "api" });
      expect(GUIDE_CHECKS[id]).toBeDefined();
      expect(DEFAULT_CHECK_IDS).not.toContain(id);
    }
    expect(DEFAULT_CHECK_IDS).toContain("A5");
  });

  it("GP-FL2 judging a step against an expectation", () => {
    const obs = { key: "k", label: "l", status: 422, blocked: true, message: "work_schedule can't be blank", fields: ["work_schedule"], target: "work_schedule" };
    expect(judge(obs, undefined)).toBe("new");
    expect(judge(obs, { blocked: true, status: [422], fields: ["$omitted"] })).toBe("match");
    expect(judge(obs, { blocked: false })).toBe("mismatch");
    expect(judge(obs, { blocked: true, status: [400] })).toBe("mismatch");
    expect(judge(obs, { blocked: true, message: "not associated" })).toBe("mismatch");
    expect(judge({ ...obs, status: 500, blocked: false }, { blocked: true })).toBe("server_error");
  });
});

describe("GP functional checks: scenarios", () => {
  it("GP-FL3 A9 invites before any form is saved; the recorded 409 matches, an accepted invite differs", async () => {
    const { ctx, calls } = fakeClient((m, p) =>
      m === "POST" && /\/invite$/.test(p)
        ? { status: 409, data: { message: "Can't invite employee missing contract details and pricing plan details" }, requestId: "req-9" }
        : undefined
    );
    const r = await FUNCTIONAL_CHECKS.A9.run(ctx);
    const order = calls.map((c) => `${c.method} ${c.path.replace(/\?.*$/, "")}`);
    expect(order).toContain("POST /v1/employments");
    expect(order).toContain("POST /v1/employments/emp-1/invite");
    expect(order.some((c) => c.startsWith("PUT"))).toBe(false); // no form saved
    expect(r.outcome).toBe("as_recorded");
    expect(r.summary).toMatch(/refused \(409\).*missing contract details.*as expected/);
    expect(r.requestIds).toEqual(["req-9"]);
    expect(r.details.join("\n")).toMatch(/Onboarding steps after the invite: contract_details \(completed\), invite \(pending\)/);

    const accepted = await FUNCTIONAL_CHECKS.A9.run(fakeClient().ctx);
    expect(accepted.outcome).toBe("differs");
  });

  it("GP-FL4 A11 saves contract then administrative details, in the SDK's envelopes, before inviting", async () => {
    const { ctx, calls } = fakeClient();
    const r = await FUNCTIONAL_CHECKS.A11.run(ctx);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.path)).toEqual(["/v2/employments/emp-1/contract-details", "/v2/employments/emp-1/administrative-details"]);
    expect(Object.keys(puts[0].body as object)).toEqual(["contract_details"]);
    expect(Object.keys(puts[1].body as object)).toEqual(["administrative_details"]);
    expect(r.outcome).toBe("as_recorded");
    expect(r.summary).toMatch(/Invite after contract and administrative details: accepted \(200\).*as expected/);
  });

  it("GP-FL5 A14 leaves out a required field: accepted then invited matches what Remote does; a 422 now differs", async () => {
    const accepting = fakeClient();
    const r = await FUNCTIONAL_CHECKS.A14.run(accepting.ctx);
    expect(r.outcome).toBe("as_recorded");
    expect(r.details.join("\n")).toMatch(/Left out: work_schedule/);
    expect(accepting.calls.some((c) => c.method === "POST" && /\/invite$/.test(c.path))).toBe(true);
    expect(r.details.join("\n")).toMatch(/Invite after the incomplete contract details: accepted/);

    // If Remote starts refusing the incomplete save, the check says so and doesn't invite
    const refusing = fakeClient((m, p, body) => {
      if (m !== "PUT") return undefined;
      const sent = (body as { contract_details: Record<string, unknown> }).contract_details;
      const missing = ["work_schedule", "wage_type"].find((f) => !(f in sent));
      return { status: 422, data: { errors: { contract_details: { [missing!]: ["can't be blank"] } } } };
    });
    const now = await FUNCTIONAL_CHECKS.A14.run(refusing.ctx);
    expect(now.outcome).toBe("differs");
    expect(refusing.calls.some((c) => /\/invite$/.test(c.path))).toBe(false);
  });

  it("GP-FL6 A15 sends an invalid option", async () => {
    const { ctx, calls } = fakeClient((m) => (m === "PUT" ? { status: 422, data: { errors: { work_schedule: ["is invalid"] } } } : undefined));
    const r = await FUNCTIONAL_CHECKS.A15.run(ctx);
    const sent = (calls.find((c) => c.method === "PUT")!.body as { contract_details: Record<string, unknown> }).contract_details;
    expect(sent.work_schedule).toBe("not_a_valid_option");
    expect(r.outcome).toBe("as_recorded");
  });

  it("GP-FL7 A16 uses an entity without GP; Remote's refusal message is what the guide records", async () => {
    const { ctx, calls } = fakeClient((m, p) => {
      if (m === "GET" && /legal-entities$/.test(p)) return { status: 200, data: { data: [{ slug: "le-nld", country_code: "NLD", global_payroll_enabled: false }] } };
      if (m === "POST" && p === "/v1/employments") return { status: 422, data: { message: "Global Payroll is not enabled on given legal entity" } };
      return undefined;
    });
    const r = await FUNCTIONAL_CHECKS.A16.run(ctx);
    expect((calls.find((c) => c.method === "POST" && c.path === "/v1/employments")!.body as Record<string, unknown>)).toMatchObject({ country_code: "NLD", engaged_by_legal_entity_id: "le-nld" });
    expect(r.outcome).toBe("as_recorded");
  });

  it("GP-FL8 a failed setup step makes the result an error, not a finding", async () => {
    const { ctx } = fakeClient((m, p) => (m === "PUT" && /contract-details/.test(p) ? { status: 422, data: { errors: { foo: ["bad"] } }, requestId: "req-x" } : undefined));
    const r = await FUNCTIONAL_CHECKS.A10.run(ctx);
    expect(r.outcome).toBe("error");
    expect(r.summary).toMatch(/^Setup failed before the scenario: Contract details: refused \(422\)/);
    expect(r.requestIds).toContain("req-x");
  });

  it("GP-FL9 A17 reuses the first employee's email and entity for the second", async () => {
    const { ctx, calls } = fakeClient();
    await FUNCTIONAL_CHECKS.A17.run(ctx);
    const creates = calls.filter((c) => c.method === "POST" && c.path === "/v1/employments").map((c) => c.body as { basic_information: Record<string, unknown>; engaged_by_legal_entity_id: string });
    expect(creates).toHaveLength(2);
    expect(creates[1].basic_information.personal_email).toBe(creates[0].basic_information.personal_email);
    expect(creates[1].engaged_by_legal_entity_id).toBe(creates[0].engaged_by_legal_entity_id);
  });

  it("GP-FL10 A18 starts the employee tomorrow, saves contract details, then invites; the 409 matches", async () => {
    const { ctx, calls } = fakeClient((m, p) =>
      m === "POST" && /\/invite$/.test(p)
        ? { status: 409, data: { message: "The provisional_start_date must be at least 2 working days from today" } }
        : undefined
    );
    const r = await FUNCTIONAL_CHECKS.A18.run(ctx);
    const create = calls.find((c) => c.method === "POST" && c.path === "/v1/employments")!.body as { basic_information: Record<string, unknown> };
    expect(create.basic_information.provisional_start_date).toBe(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    const order = calls.map((c) => `${c.method} ${c.path}`).filter((c) => /^(PUT|POST) .*(contract-details|invite)$/.test(c));
    expect(order).toEqual(["PUT /v2/employments/emp-1/contract-details", "POST /v1/employments/emp-1/invite"]);
    expect(r.outcome).toBe("as_recorded");

    // An accepted invite means the rule is gone or has changed
    expect((await FUNCTIONAL_CHECKS.A18.run(fakeClient().ctx)).outcome).toBe("differs");
  });

  it("GP-FL12 a full run shares employees: A20's and refused ones are reused, A12 repeats A11's invite, A17 reuses an email", async () => {
    // Remote as recorded: A9's invite, A15's invalid option, A16's entity and A19's incomplete create are refused
    let refusedCreates = 0;
    const { ctx, calls } = fakeClient((m, p, body) => {
      const emp = p.match(/employments\/([^/]+)\/invite$/)?.[1];
      if (m === "POST" && emp && !calls.some((c) => c.method === "PUT" && c.path === `/v2/employments/${emp}/contract-details`)) {
        return { status: 409, data: { message: "Can't invite employee missing contract details and pricing plan details" } };
      }
      if (m === "PUT" && Object.values((body as { contract_details?: Record<string, unknown> }).contract_details ?? {}).includes("not_a_valid_option")) {
        return { status: 422, data: { errors: { work_schedule: ["is invalid"] } } };
      }
      if (m === "GET" && /legal-entities$/.test(p)) {
        return { status: 200, data: { data: [{ slug: "le-gbr", country_code: "GBR", global_payroll_enabled: true }, { slug: "le-nld", country_code: "NLD", global_payroll_enabled: false }] } };
      }
      if (m === "POST" && p === "/v1/employments") {
        const b = body as { engaged_by_legal_entity_id?: string; basic_information?: Record<string, unknown> };
        if (b.engaged_by_legal_entity_id === "le-nld") return (refusedCreates++, { status: 422, data: { message: "Global Payroll is not enabled on given legal entity" } });
        if (b.basic_information && !("name" in b.basic_information)) return (refusedCreates++, { status: 422, data: { errors: { basic_information: { name: ["can't be blank"] } } } });
      }
      return undefined;
    });
    const results = await runGuideChecks(ctx, FUNCTIONAL_CASE_IDS);

    const created = calls.filter((c) => c.method === "POST" && c.path === "/v1/employments").length - refusedCreates;
    // A20's two (reused by A9, A10 and A11), A13, A15 (reused by A14), A17's duplicate, A18
    expect(created).toBe(6);
    const note = (id: string) => results.find((r) => r.caseId === id)!.details.join("\n");
    for (const id of ["A9", "A10", "A11"]) expect(note(id), id).toMatch(/Reused the test employee from A(20|9)/);
    expect(note("A12")).toMatch(/Reused the invited test employee from A11/);
    expect(note("A14")).toMatch(/Reused the test employee from A15/);
    expect(note("A17")).toMatch(/Reused the email of a test employee created earlier in this run/);
    expect(note("A18")).not.toMatch(/Reused/);
    // Sharing changes no answer (the fake has no start-date rule, so A18 is left to GP-FL10)
    expect(results.filter((r) => r.caseId !== "A18" && r.outcome !== "as_recorded").map((r) => `${r.caseId}: ${r.summary}`)).toEqual([]);
  });

  it("GP-FL13 A19 leaves out a required basic-information field; A20 repeats an external_employment_id", async () => {
    const a19 = fakeClient((m, p, body) =>
      m === "POST" && p === "/v1/employments" && !("name" in ((body as { basic_information: Record<string, unknown> }).basic_information))
        ? { status: 422, data: { errors: { basic_information: { name: ["can't be blank"] } } } }
        : undefined
    );
    const r19 = await FUNCTIONAL_CHECKS.A19.run(a19.ctx);
    const sent19 = a19.calls.find((c) => c.method === "POST" && c.path === "/v1/employments")!.body as { basic_information: Record<string, unknown> };
    expect(sent19.basic_information).not.toHaveProperty("name");
    expect(sent19.basic_information).toHaveProperty("login_email");
    expect(r19.outcome).toBe("as_recorded");
    expect(r19.summary).toMatch(/refused \(422\).*as expected/);
    expect(r19.details.join("\n")).toMatch(/Left out: name/);

    const a20 = fakeClient();
    const r20 = await FUNCTIONAL_CHECKS.A20.run(a20.ctx);
    const creates = a20.calls.filter((c) => c.method === "POST" && c.path === "/v1/employments").map((c) => (c.body as { basic_information: Record<string, unknown> }).basic_information);
    expect(creates).toHaveLength(2);
    expect(creates[0].external_employment_id).toBeTruthy();
    expect(creates[1].external_employment_id).toBe(creates[0].external_employment_id);
    expect(creates[1].personal_email).not.toBe(creates[0].personal_email);
    expect(r20.outcome).toBe("as_recorded");
  });

  it("GP-FL11 test employees outside A18 start 30 days out, clear of the 2-working-day rule", async () => {
    const { ctx, calls } = fakeClient();
    await FUNCTIONAL_CHECKS.A11.run(ctx);
    const create = calls.find((c) => c.method === "POST" && c.path === "/v1/employments")!.body as { basic_information: Record<string, unknown> };
    expect(create.basic_information.provisional_start_date).toBe(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  });
});
