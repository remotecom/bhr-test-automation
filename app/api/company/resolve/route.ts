import { createClientFromToken } from "@/src/client";

/** Decode JWT payload without verification (we just got it from the gateway) */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const refreshToken = body?.refresh_token;

    if (!refreshToken || typeof refreshToken !== "string") {
      return Response.json(
        { error: "refresh_token is required" },
        { status: 400 }
      );
    }

    // Exchange refresh token for access token
    const client = createClientFromToken(refreshToken);
    const accessToken = await client.getToken();

    // Extract company ID from JWT payload
    const payload = decodeJwtPayload(accessToken);
    const companySlug = payload.company as string;

    if (!companySlug) {
      return Response.json(
        { error: "Token does not contain a company claim — may be a partner-level token, not company-scoped" },
        { status: 400 }
      );
    }

    // Fetch company name via company-managers endpoint
    let companyName = companySlug;
    try {
      const res = await client.get<{
        data: { company_managers: Array<{ company?: { name?: string } }> };
      }>("/v1/company-managers?page_size=1&page=1");
      const name = res.data?.data?.company_managers?.[0]?.company?.name;
      if (name) companyName = name;
    } catch {
      // Non-critical — we already have the slug from JWT
    }

    return Response.json({
      company_slug: companySlug,
      company_name: companyName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
