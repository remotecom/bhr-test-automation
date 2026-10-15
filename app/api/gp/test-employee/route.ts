/**
 * POST /api/gp/test-employee: create a Global Payroll test employee in the connected company.
 *
 * Body: { countryCode: "GBR" }
 * Headers: X-Company-Slug, X-Refresh-Token, X-Gateway-Env (same as the GP report)
 *
 * Sandbox only. May add a legal entity in the country and switch GP on for it (see src/gp/test-employee.ts).
 */

import { createClientFromToken, readRequestOverrides, requireCompany } from "@/src/client";
import { createGPTestEmployee } from "@/src/gp/test-employee";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);
  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: 400 });
  }

  let countryCode = "";
  try {
    const body = await request.json();
    if (typeof body?.countryCode === "string") countryCode = body.countryCode.trim().toUpperCase();
  } catch {
    // Missing body: handled below
  }
  if (!/^[A-Z]{3}$/.test(countryCode)) {
    return Response.json({ error: "countryCode must be an ISO alpha-3 code, e.g. GBR" }, { status: 400 });
  }

  try {
    const client = createClientFromToken(gate.refreshToken, gatewayEnv);
    const employee = await createGPTestEmployee(client, gate.slug, countryCode);
    return Response.json(employee);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
