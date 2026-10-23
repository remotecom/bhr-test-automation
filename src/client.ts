/**
 * OAuth2 HTTP client for the Remote partner gateway.
 *
 * Supports two auth modes:
 * 1. refresh_token grant — company-scoped token (for employments, subscriptions, etc.)
 * 2. client_credentials grant — partner-level token (for countries, sandbox operations)
 *
 * The refresh_token is preferred when available because it gives company-scoped access.
 * 3. jwt-bearer (assertion) grant — acting as a user or employee (`asAssertion`), as a partner's server
 *    does for the SDK's employee flow.
 */

import { createHmac } from "node:crypto";

const ENVIRONMENTS: Record<string, string> = {
  local: "http://localhost:4000/api/eor",
  sandbox: "https://gateway.remote-sandbox.com",
  partners: "https://gateway.partners.remote-sandbox.com",
  staging: "https://gateway.niceremote.com",
  production: "https://gateway.remote.com",
};

export interface ApiResponse<T> {
  status: number;
  data: T;
  /** Set on errors (status >= 400): Remote's x-request-id, for the API team's logs */
  requestId?: string;
  /** Set on errors: CloudFront's x-amz-cf-id, when the failure came from the CDN rather than the API */
  cdnId?: string;
  /** Set on errors whose body was not JSON (first 500 characters) */
  rawText?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
  gatewayEnv: string;
  gatewayUrl?: string;
  refreshToken?: string;
  /** Act as this subject (jwt-bearer grant) instead of the company or the integration */
  assertion?: { sub: string; scope: string };
}

export class RemoteClient {
  private config: ClientConfig;
  private baseUrl: string;
  private token: CachedToken | null = null;

  constructor(config: ClientConfig) {
    this.config = config;
    this.baseUrl =
      config.gatewayUrl || ENVIRONMENTS[config.gatewayEnv] || ENVIRONMENTS.sandbox;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private basicAuth(): string {
    return Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");
  }

  /** Get a valid access token, refreshing if expired (60s buffer) */
  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.accessToken;
    }

    if (this.config.assertion) {
      const { sub, scope } = this.config.assertion;
      const res = await this.jwtBearer(sub, scope);
      const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
      if (!res.ok || !data.access_token) {
        throw new Error(`Assertion token for ${sub} refused (${res.status}): ${data.error ?? ""} ${data.error_description ?? ""}`.trim());
      }
      this.token = { accessToken: data.access_token, expiresAt: now + (data.expires_in ?? 300) * 1000 };
      return this.token.accessToken;
    }

    // Use refresh_token grant if available (company-scoped), otherwise client_credentials
    const body = this.config.refreshToken
      ? new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.config.refreshToken,
        })
      : new URLSearchParams({
          grant_type: "client_credentials",
        });

    const res = await fetch(this.url("/auth/oauth2/token"), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${this.basicAuth()}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      const grantType = this.config.refreshToken
        ? "refresh_token"
        : "client_credentials";
      throw new Error(
        `OAuth2 ${grantType} token request failed (${res.status}): ${text}`
      );
    }

    const data: TokenResponse = await res.json();
    this.token = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return this.token.accessToken;
  }

  /** Authenticated fetch wrapper */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Client-Name": "bhr-test-automation",
      "X-Client-Version": "1.0.0",
    };

    const res = await fetch(this.url(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Read the body as text first: 5xx responses are often not JSON, and dropping them
    // (as res.json() did) loses the only explanation the API gives
    const rawText = await res.text().catch(() => "");
    let data: T;
    try {
      data = JSON.parse(rawText) as T;
    } catch {
      data = null as T;
    }
    if (process.env.VERBOSE_LOG) {
      console.error(`\n--- ${method} ${this.url(path)} ---`);
      console.error(`Status: ${res.status}`);
      console.error(`Response: ${JSON.stringify(data, null, 2)}`);
      console.error(`---\n`);
    }
    const result: ApiResponse<T> = { status: res.status, data };
    if (res.status >= 400) {
      // IDs the API team needs to find a failure in their logs (CloudFront's, when the error came from the CDN)
      result.requestId = res.headers.get("x-request-id") || undefined;
      result.cdnId = res.headers.get("x-amz-cf-id") || undefined;
      if (data === null && rawText) result.rawText = rawText.slice(0, 500);
    }
    return result;
  }

  async get<T = unknown>(path: string) {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }

  async put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, body);
  }

  async delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }

  /** A client that acts as `sub` (e.g. an employee) through the jwt-bearer grant, with this one's credentials */
  asAssertion(sub: string, scope: string): RemoteClient {
    return new RemoteClient({ ...this.config, refreshToken: undefined, assertion: { sub, scope } });
  }

  /** POST the jwt-bearer grant: an HS256 assertion signed with the client secret, scope in the JWT and the body */
  private jwtBearer(sub: string, scope: string, opts: { signWith?: string; sendWith?: string } = {}): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    const assertion = signHS256(
      { iss: this.config.clientId, sub, aud: `${this.baseUrl}/auth`, scope, iat: now, exp: now + 5 * 60 },
      opts.signWith ?? this.config.clientSecret
    );
    const basic = Buffer.from(`${this.config.clientId}:${opts.sendWith ?? this.config.clientSecret}`).toString("base64");
    return fetch(this.url("/auth/oauth2/token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion, scope }),
    });
  }

  /**
   * Request an assertion token (jwt-bearer grant), as a partner's server would: an HS256 JWT signed
   * with the client secret, `scope` in both the JWT and the body, Basic auth. Nothing is cached and
   * the token itself is never returned or logged, only the status and Remote's error fields.
   *
   * `signWith` / `sendWith` replace the secret used to sign the JWT / in the Basic auth header, so
   * the token checks can test a wrong or rotated secret.
   */
  async assertionGrant(
    sub: string,
    scope: string,
    opts: { signWith?: string; sendWith?: string } = {}
  ): Promise<ApiResponse<{ error?: string; error_description?: string; scope?: string }>> {
    const res = await this.jwtBearer(sub, scope, opts);
    const rawText = await res.text().catch(() => "");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // not JSON: kept in rawText below
    }
    const data = { error: parsed.error as string | undefined, error_description: parsed.error_description as string | undefined, scope: parsed.scope as string | undefined };
    const result: ApiResponse<typeof data> = { status: res.status, data };
    if (res.status >= 400) {
      result.requestId = res.headers.get("x-request-id") || undefined;
      if (!parsed.error && rawText) result.rawText = rawText.slice(0, 500);
    }
    return result;
  }
}

/** HS256 JWT: base64url header and payload, HMAC-SHA256 over both with the secret */
function signHS256(payload: Record<string, unknown>, secret: string): string {
  const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
  const head = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

/** Get the company slug for the given environment */
export function getCompanySlug(gatewayEnv?: string): string | undefined {
  if (gatewayEnv === "sandbox") {
    return process.env.SANDBOX_COMPANY_SLUG || process.env.COMPANY_SLUG;
  }
  return process.env.COMPANY_SLUG;
}

/** Extract override headers from an incoming request */
export function readRequestOverrides(request: Request) {
  return {
    companySlug: request.headers.get("X-Company-Slug") || undefined,
    refreshToken: request.headers.get("X-Refresh-Token") || undefined,
    gatewayEnv: request.headers.get("X-Gateway-Env") || undefined,
  };
}

/**
 * Resolve the company slug + refresh token for a request.
 *
 * Returns `{ ok: false, error }` when nothing is available — API routes should
 * surface this as a 400 so the UI can prompt the user to connect a company.
 * Falls back to env vars for local Vitest runs that still ship a personal sandbox.
 */
export function requireCompany(
  overrides: { companySlug?: string; refreshToken?: string },
  gatewayEnv?: string
):
  | { ok: true; slug: string; refreshToken: string }
  | { ok: false; error: string } {
  const slug = overrides.companySlug || getCompanySlug(gatewayEnv);
  const refreshToken =
    overrides.refreshToken ||
    (gatewayEnv === "sandbox"
      ? process.env.SANDBOX_REFRESH_TOKEN || process.env.REFRESH_TOKEN
      : process.env.REFRESH_TOKEN);

  if (!slug || !refreshToken) {
    return { ok: false, error: "Connect a company to continue" };
  }
  return { ok: true, slug, refreshToken };
}

/**
 * Read credentials from env, selecting the right set based on gateway env.
 *
 * Unprefixed vars (CLIENT_ID, CLIENT_SECRET) are the default (partners).
 * SANDBOX_ prefixed vars override when gatewayEnv === "sandbox".
 * This keeps Vitest tests and legacy server working unchanged.
 */
function getPartnerCredentials(gatewayEnvOverride?: string) {
  const gatewayEnv = gatewayEnvOverride || process.env.GATEWAY_ENV || "partners";

  const clientId = gatewayEnv === "sandbox"
    ? (process.env.SANDBOX_CLIENT_ID || process.env.CLIENT_ID)
    : process.env.CLIENT_ID;
  const clientSecret = gatewayEnv === "sandbox"
    ? (process.env.SANDBOX_CLIENT_SECRET || process.env.CLIENT_SECRET)
    : process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing CLIENT_ID or CLIENT_SECRET. Copy .env.example to .env and fill in credentials."
    );
  }

  return { clientId, clientSecret, gatewayEnv };
}

/** Create a client from environment variables */
export function createClientFromEnv(gatewayEnvOverride?: string): RemoteClient {
  const { clientId, clientSecret, gatewayEnv } = getPartnerCredentials(gatewayEnvOverride);
  const refreshToken = gatewayEnv === "sandbox"
    ? (process.env.SANDBOX_REFRESH_TOKEN || process.env.REFRESH_TOKEN)
    : process.env.REFRESH_TOKEN;

  return new RemoteClient({
    clientId,
    clientSecret,
    gatewayEnv,
    refreshToken,
  });
}

/** Create a client with a specific refresh token (company override) */
export function createClientFromToken(refreshToken: string, gatewayEnvOverride?: string): RemoteClient {
  const { clientId, clientSecret, gatewayEnv } = getPartnerCredentials(gatewayEnvOverride);

  return new RemoteClient({
    clientId,
    clientSecret,
    gatewayEnv,
    refreshToken,
  });
}

/** Create a client using client_credentials grant only (partner-level, no company scope) */
export function createPartnerClient(gatewayEnvOverride?: string): RemoteClient {
  const { clientId, clientSecret, gatewayEnv } = getPartnerCredentials(gatewayEnvOverride);

  return new RemoteClient({
    clientId,
    clientSecret,
    gatewayEnv,
  });
}
