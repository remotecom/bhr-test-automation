import { createPartnerClient, readRequestOverrides } from "@/src/client";

export async function POST(request: Request) {
  try {
    const { gatewayEnv } = readRequestOverrides(request);
    const client = createPartnerClient(gatewayEnv);
    const ts = Date.now();

    // Create sandbox company with get_oauth_access_tokens action to receive refresh token
    const createRes = await client.post<{
      data: {
        tokens: { refresh_token: string; access_token: string };
        company: { id: string; name: string; status: string; country_code: string };
      };
    }>("/v1/companies?actions=get_oauth_access_tokens", {
      country_code: "GBR",
      desired_currency: "GBP",
      name: `BHR Test Co ${ts}`,
      company_owner_email: `bhr-test-${ts}@remote.com`,
      company_owner_name: "BHR Test Owner",
      terms_of_service_accepted_at: new Date().toISOString(),
      registration_number: `BHR${ts}`,
      phone_number: "1234567890",
      address_details: {
        address: "1 Test St",
        city: "London",
        postal_code: "SW1A 1AA",
      },
    });

    if (createRes.status >= 400) {
      return Response.json(
        { error: `Company creation failed (${createRes.status})`, details: createRes.data },
        { status: createRes.status }
      );
    }

    const company = createRes.data?.data?.company;
    const tokens = createRes.data?.data?.tokens;

    if (!company?.id || !tokens?.refresh_token) {
      return Response.json(
        { error: "Company created but missing id or refresh_token in response", raw: createRes.data },
        { status: 500 }
      );
    }

    // Bypass eligibility checks so all products are available
    const bypassRes = await client.post(
      `/v1/sandbox/companies/${company.id}/bypass-eligibility-checks`
    );

    if (bypassRes.status >= 400) {
      console.warn(`Bypass eligibility failed (${bypassRes.status}):`, bypassRes.data);
    }

    return Response.json({
      company_slug: company.id,
      refresh_token: tokens.refresh_token,
      name: company.name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
