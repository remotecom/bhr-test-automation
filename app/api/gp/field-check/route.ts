/**
 * POST /api/gp/field-check: submit an employer form to a test employee with its skipped fields
 * left out, to see whether the API still requires them (see src/gp/field-check.ts).
 *
 * Body: { countryCode: "CAN", form: "administrative_details" | "contract_details", employmentId: "<test employee>" }
 * Headers: X-Company-Slug, X-Refresh-Token, X-Gateway-Env (same as the GP report)
 *
 * Sandbox only. Writes the form's test values to that test employee; touches nothing else.
 */

import { createClientFromToken, readRequestOverrides, requireCompany } from "@/src/client";
import { checkSkippedFields, isCheckableForm } from "@/src/gp/field-check";

export const maxDuration = 60;

const EMPLOYMENT_ID = /^[A-Za-z0-9-]{8,64}$/;
// "local" is a developer's own gateway on localhost (never production)
const SANDBOX_ENVS = new Set(["partners", "sandbox", "local"]);

export async function POST(request: Request) {
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);
  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: 400 });

  // Writes to an employment: never outside the two sandboxes
  const env = gatewayEnv || process.env.GATEWAY_ENV || "partners";
  if (!SANDBOX_ENVS.has(env)) {
    return Response.json({ error: "The skipped-field check only runs against the sandboxes" }, { status: 400 });
  }

  let countryCode = "";
  let form = "";
  let employmentId = "";
  try {
    const body = await request.json();
    if (typeof body?.countryCode === "string") countryCode = body.countryCode.trim().toUpperCase();
    if (typeof body?.form === "string") form = body.form;
    if (typeof body?.employmentId === "string") employmentId = body.employmentId.trim();
  } catch {
    // Missing body: handled below
  }
  if (!/^[A-Z]{3}$/.test(countryCode)) return Response.json({ error: "countryCode must be an ISO alpha-3 code" }, { status: 400 });
  if (!isCheckableForm(form)) return Response.json({ error: "form must be contract_details or administrative_details" }, { status: 400 });
  if (!EMPLOYMENT_ID.test(employmentId)) return Response.json({ error: "employmentId is missing or invalid" }, { status: 400 });

  try {
    const client = createClientFromToken(gate.refreshToken, env);
    return Response.json(await checkSkippedFields(client, countryCode, form, employmentId));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
