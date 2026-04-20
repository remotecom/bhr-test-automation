import { createClientFromToken, readRequestOverrides, requireCompany } from "@/src/client";

export async function GET(request: Request) {
  try {
    const overrides = readRequestOverrides(request);
    const { gatewayEnv } = overrides;

    const gate = requireCompany(overrides, gatewayEnv);
    if (!gate.ok) {
      return Response.json({ error: gate.error }, { status: 400 });
    }

    const client = createClientFromToken(gate.refreshToken, gatewayEnv);
    const result = await client.get(`/v1/companies/${gate.slug}`);
    const body = result.data as { data: { company: Record<string, unknown> } };
    const company = body.data.company;

    return Response.json({
      name: company.name,
      slug: company.id,
      status: company.status,
      country: company.country_code,
      source: overrides.refreshToken ? "custom" : "env",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
