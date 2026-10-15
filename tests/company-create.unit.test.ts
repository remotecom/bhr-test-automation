/**
 * Unit tests for Create Fresh Company error handling. No network calls: fetch is faked.
 * Run with: npm run test:company-unit
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteClient } from "../src/client";
import { POST as createCompany } from "../app/api/company/create/route";

type Reply = { status: number; body: string; headers?: Record<string, string> };

/** Fake fetch: token and lookup calls succeed, company creation returns the queued replies in order */
function fakeFetch(companyReplies: Reply[]) {
  const companyCalls: { name: string }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (r: Reply) => new Response(r.body, { status: r.status, headers: r.headers });
    if (url.endsWith("/auth/oauth2/token")) return reply({ status: 200, body: JSON.stringify({ access_token: "t", expires_in: 3600 }) });
    if (url.includes("/v1/companies?action=")) {
      companyCalls.push(JSON.parse(String(init?.body)));
      return reply(companyReplies.shift() ?? { status: 500, body: "" });
    }
    if (url.includes("bypass-eligibility-checks")) return reply({ status: 200, body: "{}" });
    return reply({ status: 200, body: JSON.stringify({ data: { properties: { state: { enum: ["England"] } } } }) });
  });
  return { fn, companyCalls };
}

const ok: Reply = {
  status: 201,
  body: JSON.stringify({ data: { company: { id: "co-1", name: "BHR Test Co" }, tokens: { refresh_token: "rt", access_token: "at" } } }),
};
const html500: Reply = {
  status: 500,
  body: "<html><body>Internal Server Error</body></html>",
  headers: { "x-request-id": "req-abc", "x-amz-cf-id": "cf-xyz" },
};
const call = () => createCompany(new Request("http://x/api/company/create", { method: "POST", headers: { "X-Gateway-Env": "partners" } }));

describe("Remote client keeps error evidence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("CC-U1 non-JSON error bodies and request IDs are kept", async () => {
    vi.stubGlobal("fetch", fakeFetch([html500]).fn);
    const client = new RemoteClient({ clientId: "id", clientSecret: "s", gatewayEnv: "partners" });
    const res = await client.post("/v1/companies?action=get_oauth_access_tokens", {});
    expect(res.status).toBe(500);
    expect(res.data).toBeNull();
    expect(res.rawText).toContain("Internal Server Error");
    expect(res.requestId).toBe("req-abc");
    expect(res.cdnId).toBe("cf-xyz");
  });

  it("CC-U2 successful responses carry no error fields", async () => {
    vi.stubGlobal("fetch", fakeFetch([ok]).fn);
    const client = new RemoteClient({ clientId: "id", clientSecret: "s", gatewayEnv: "partners" });
    const res = await client.post("/v1/companies?action=get_oauth_access_tokens", {});
    expect(res.status).toBe(201);
    expect(res).not.toHaveProperty("requestId");
    expect(res).not.toHaveProperty("rawText");
  });
});

describe("Create Fresh Company retries a 5xx once", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = async () => {
    const pending = call();
    await vi.runAllTimersAsync();
    return pending;
  };

  it("CC-U3 a 500 then success returns the company", async () => {
    const f = fakeFetch([html500, ok]);
    vi.stubGlobal("fetch", f.fn);
    const res = await run();
    expect(res.status).toBe(200);
    expect((await res.json()).company_slug).toBe("co-1");
    expect(f.companyCalls).toHaveLength(2);
  });

  it("CC-U4 two 500s report the request IDs and the raw body", async () => {
    vi.stubGlobal("fetch", fakeFetch([html500, html500]).fn);
    const res = await run();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/failed \(500\) twice/);
    expect(body.error).toContain("Internal Server Error");
    expect(body.error).toContain("request ID req-abc");
    expect(body.error).toContain("CloudFront ID cf-xyz");
    expect(body.requestId).toBe("req-abc");
  });

  it("CC-U5 4xx errors are not retried", async () => {
    const f = fakeFetch([{ status: 422, body: JSON.stringify({ message: "Unprocessable Entity", errors: { name: ["taken"] } }) }]);
    vi.stubGlobal("fetch", f.fn);
    const res = await run();
    expect(res.status).toBe(422);
    expect(f.companyCalls).toHaveLength(1);
    expect((await res.json()).error).toContain("taken");
  });
});
