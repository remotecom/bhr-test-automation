/**
 * OAuth2 HTTP client for the Remote partner gateway.
 *
 * Supports two auth modes:
 * 1. refresh_token grant — company-scoped token (for employments, subscriptions, etc.)
 * 2. client_credentials grant — partner-level token (for countries, sandbox operations)
 *
 * The refresh_token is preferred when available because it gives company-scoped access.
 */

const ENVIRONMENTS: Record<string, string> = {
  local: "http://localhost:4000/api/eor",
  sandbox: "https://gateway.remote-sandbox.com",
  partners: "https://gateway.partners.remote-sandbox.com",
  staging: "https://gateway.niceremote.com",
  production: "https://gateway.remote.com",
};

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
  ): Promise<{ status: number; data: T }> {
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

    const data = (await res.json().catch(() => null)) as T;
    if (process.env.VERBOSE_LOG) {
      console.error(`\n--- ${method} ${this.url(path)} ---`);
      console.error(`Status: ${res.status}`);
      console.error(`Response: ${JSON.stringify(data, null, 2)}`);
      console.error(`---\n`);
    }
    return { status: res.status, data };
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
