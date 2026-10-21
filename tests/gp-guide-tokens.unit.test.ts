/**
 * Unit tests for the token checks (guide rows T5 and T8) and RemoteClient.assertionGrant.
 * No network calls: fetch is stubbed, and a fake client plays Remote for the checks.
 */

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteClient } from "../src/client";
import { TOKEN_CHECKS, describeGrant } from "../src/gp/guide/token-checks";
import { DEFAULT_CHECK_IDS } from "../src/gp/guide/checks";
import { GUIDE } from "../data/gp-guide";

const b64json = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

afterEach(() => vi.unstubAllGlobals());

describe("RemoteClient.assertionGrant", () => {
  it("GP-TK1 sends an HS256 assertion signed with the client secret, scope in the JWT and the body, Basic auth", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "secret-token-value", expires_in: 3600, scope: "all:write" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RemoteClient({ clientId: "cid", clientSecret: "s3cret", gatewayEnv: "partners" });

    const res = await client.assertionGrant("urn:remote-api:employee:employment:e-1", "all:write");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gateway.partners.remote-sandbox.com/auth/oauth2/token");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("cid:s3cret").toString("base64")}`);
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body.get("scope")).toBe("all:write");

    const [head, payload, sig] = body.get("assertion")!.split(".");
    expect(b64json(head)).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = b64json(payload);
    expect(claims).toMatchObject({ iss: "cid", sub: "urn:remote-api:employee:employment:e-1", aud: "https://gateway.partners.remote-sandbox.com/auth", scope: "all:write" });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(sig).toBe(createHmac("sha256", "s3cret").update(`${head}.${payload}`).digest("base64url"));

    // The token itself never leaves the method
    expect(res.status).toBe(200);
    expect(JSON.stringify(res)).not.toContain("secret-token-value");
  });

  it("GP-TK2 signWith / sendWith replace the secret for signing and for Basic auth, separately", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid client credentials" }), { status: 400, headers: { "x-request-id": "req-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RemoteClient({ clientId: "cid", clientSecret: "right", gatewayEnv: "partners" });

    const res = await client.assertionGrant("sub", "all:write", { signWith: "wrong" });

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("cid:right").toString("base64")}`);
    const [head, payload, sig] = new URLSearchParams(init.body as URLSearchParams).get("assertion")!.split(".");
    expect(sig).toBe(createHmac("sha256", "wrong").update(`${head}.${payload}`).digest("base64url"));
    expect(res).toMatchObject({ status: 400, data: { error: "invalid_grant", error_description: "Invalid client credentials" }, requestId: "req-1" });
  });
});

type Grant = { status: number; data: { error?: string; error_description?: string }; requestId?: string };

/** A fake client: assertionGrant answers from `grant`, GET /v1/companies/{slug} returns an owner */
function fakeClient(grant: (sub: string, opts: { signWith?: string; sendWith?: string }) => Grant) {
  const grants: { sub: string; opts: { signWith?: string; sendWith?: string } }[] = [];
  const client = {
    get: async () => ({ status: 200, data: { data: { company: { company_owner_user_id: "user-1" } } } }),
    assertionGrant: async (sub: string, _scope: string, opts = {}) => {
      grants.push({ sub, opts });
      return grant(sub, opts);
    },
  } as unknown as RemoteClient;
  return { grants, ctx: { client, companySlug: "co-1", employments: {} } };
}

const refused = (description?: string): Grant => ({ status: 400, data: { error: "invalid_grant", error_description: description }, requestId: "req-x" });
const issued: Grant = { status: 200, data: {} };

describe("Token checks", () => {
  it("GP-TK3 T5 and T8 have guide rows on the Tokens tab and run with the quick checks", () => {
    for (const id of ["T5", "T8"]) {
      expect(GUIDE.cases.find((c) => c.id === id), id).toMatchObject({ tab: "tokens", method: "api" });
      expect(DEFAULT_CHECK_IDS).toContain(id);
    }
  });

  it("GP-TK4 T5 asks for a random employment; Remote's description matches, a bare invalid_grant differs", async () => {
    const ok = fakeClient(() => refused("Subject not found or not managed by this client"));
    const r = await TOKEN_CHECKS.T5.run(ok.ctx);
    expect(ok.grants[0].sub).toMatch(/^urn:remote-api:employee:employment:[0-9a-f-]{36}$/);
    expect(r.outcome).toBe("as_recorded");
    expect(r.requestIds).toEqual(["req-x"]);

    expect((await TOKEN_CHECKS.T5.run(fakeClient(() => refused()).ctx)).outcome).toBe("differs");
    expect((await TOKEN_CHECKS.T5.run(fakeClient(() => issued).ctx)).outcome).toBe("differs");
  });

  it("GP-TK5 T8 checks a control with the right secret, then a rotated secret and a wrongly signed JWT", async () => {
    const f = fakeClient((_, opts) => (opts.sendWith ? refused("Invalid client credentials") : opts.signWith ? refused("Invalid JWT assertion") : issued));
    const r = await TOKEN_CHECKS.T8.run(f.ctx);
    expect(f.grants.map((g) => g.sub)).toEqual(Array(3).fill("urn:remote-api:company-manager:user:user-1"));
    expect(f.grants[0].opts).toEqual({});
    expect(f.grants[1].opts.signWith).toBeTruthy();
    expect(f.grants[1].opts.sendWith).toBe(f.grants[1].opts.signWith);
    expect(f.grants[2].opts.sendWith).toBeUndefined();
    expect(r.outcome).toBe("as_recorded");
    expect(r.details).toHaveLength(3);
  });

  it("GP-TK6 T8 differs when a wrong secret gets another answer, and is inconclusive when the control fails", async () => {
    const other = fakeClient((_, opts) => (opts.sendWith ? { status: 401, data: { error: "invalid_client" } } : opts.signWith ? refused("Invalid JWT assertion") : issued));
    const r = await TOKEN_CHECKS.T8.run(other.ctx);
    expect(r.outcome).toBe("differs");
    expect(r.summary).toMatch(/rotated secret\): 401 invalid_client/);

    // One message for both cases is a change too
    const same = await TOKEN_CHECKS.T8.run(fakeClient((_, opts) => (opts.signWith ? refused("Invalid client credentials") : issued)).ctx);
    expect(same.outcome).toBe("differs");
    expect(same.summary).toMatch(/JWT signed with a wrong one: 400 invalid_grant, "Invalid client credentials"/);

    const noControl = await TOKEN_CHECKS.T8.run(fakeClient(() => refused("Assertion grant is not enabled for this integration")).ctx);
    expect(noControl.outcome).toBe("inconclusive");
  });

  it("GP-TK7 a grant line shows the status, error and description, never a token", () => {
    expect(describeGrant("X", refused("Invalid client credentials"))).toBe('X: 400 invalid_grant, "Invalid client credentials"');
    expect(describeGrant("X", refused())).toBe("X: 400 invalid_grant, no error_description");
    expect(describeGrant("X", issued)).toBe("X: token issued (200)");
  });
});
