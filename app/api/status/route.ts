import { createClientFromEnv, createClientFromToken } from "@/src/client";

export async function GET(request: Request) {
  try {
    // Read optional company override from headers
    const overrideSlug = request.headers.get("X-Company-Slug") || undefined;
    const overrideToken = request.headers.get("X-Refresh-Token") || undefined;

    const client = overrideToken
      ? createClientFromToken(overrideToken)
      : createClientFromEnv();

    const slug = overrideSlug || process.env.COMPANY_SLUG;
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
