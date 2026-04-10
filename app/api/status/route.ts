import { createClientFromEnv, createClientFromToken, readRequestOverrides, getCompanySlug } from "@/src/client";

export async function GET(request: Request) {
  try {
    const { companySlug: overrideSlug, refreshToken: overrideToken, gatewayEnv } = readRequestOverrides(request);

    const client = overrideToken
      ? createClientFromToken(overrideToken, gatewayEnv)
      : createClientFromEnv(gatewayEnv);

    const slug = overrideSlug || getCompanySlug(gatewayEnv);
    if (!slug) {
      return Response.json({ error: "COMPANY_SLUG not set" }, { status: 500 });
    }
    const result = await client.get(`/v1/companies/${slug}`);
    const body = result.data as { data: { company: Record<string, unknown> } };
    const company = body.data.company;

    return Response.json({
      name: company.name,
      slug: company.id,
      status: company.status,
      country: company.country_code,
      source: overrideToken ? "custom" : "env",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
