import { createPartnerClient, readRequestOverrides, type RemoteClient } from "@/src/client";
import { unwrapSchema } from "@/src/gp/schema-analysis";

const FALLBACK_GBR_STATE = "England";

/**
 * GBR company addresses now require `state` (422: address_details.state can't be blank).
 * Read the allowed values from the country's address form so this keeps working if they
 * change, preferring England. Falls back to the country catalog's subdivisions, then "England".
 */
async function resolveGbrState(client: RemoteClient): Promise<string> {
  type Option = { const?: unknown; title?: unknown };
  try {
    const { status, data } = await client.get("/v1/countries/GBR/address_details");
    const state = status === 200 ? (unwrapSchema(data)?.properties as Record<string, Record<string, unknown>> | undefined)?.state : undefined;
    const options: string[] = [
      ...(((state?.oneOf || state?.anyOf) as Option[] | undefined) || []).map((o) => o.const),
      ...((state?.enum as unknown[] | undefined) || []),
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    if (options.length) return options.find((v) => /england|eng\b/i.test(v)) || options[0];
  } catch {
    // Fall through
  }
  try {
    const { status, data } = await client.get<{ data: Array<{ code: string; country_subdivisions?: Array<{ code: string; name: string }> }> }>("/v1/countries");
    const subs = status === 200 ? data.data.find((c) => c.code === "GBR")?.country_subdivisions || [] : [];
    const eng = subs.find((s) => /england/i.test(s.name)) || subs[0];
    if (eng?.name) return eng.name;
  } catch {
    // Fall through
  }
  return FALLBACK_GBR_STATE;
}

export async function POST(request: Request) {
  try {
    const { gatewayEnv } = readRequestOverrides(request);
    const client = createPartnerClient(gatewayEnv);
    const ts = Date.now();
    const state = await resolveGbrState(client);

    // Create sandbox company with get_oauth_access_tokens action to receive refresh token
    // (singular `action=`, as in the Remote docs and remote.sh)
    const createRes = await client.post<{
      data: {
        tokens: { refresh_token: string; access_token: string };
        company: { id: string; name: string; status: string; country_code: string };
      };
    }>("/v1/companies?action=get_oauth_access_tokens", {
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
        state,
      },
    });

    if (createRes.status >= 400) {
      // Surface the API's reason (e.g. "not allowed to use the `get_oauth_access_tokens` action")
      const d = createRes.data as unknown as { message?: string; errors?: unknown } | null;
      // Include both: the message can be generic ("Unprocessable Entity") while errors names the field
      const reason = [d?.message, d?.errors ? JSON.stringify(d.errors) : ""].filter(Boolean).join(" ");
      return Response.json(
        { error: `Company creation failed (${createRes.status})${reason ? `: ${reason}` : ""}`, details: createRes.data },
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
