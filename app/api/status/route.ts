import { createClientFromEnv } from "@/src/client";

export async function GET() {
  try {
    const client = createClientFromEnv();
    const slug = process.env.COMPANY_SLUG;
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
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
