/**
 * POST /api/gp/guide/run: run the testing guide's automated checks (src/gp/guide/checks.ts).
 *
 * Body: { employments?: { GBR: "<employment id>" }, ids?: ["A1", "A3"] }
 *   Without ids: the quick checks. The functional checks (A9-A20) only run when asked for by ID,
 *   because they create GP test employees and send invites.
 * Headers: X-Company-Slug, X-Refresh-Token, X-Gateway-Env (same as the GP report)
 *
 * Sandbox only, and only where runs are enabled (local dev). Some checks save forms to test employees.
 */

import { gpRunsRefused } from "@/lib/features";
import { createClientFromToken, readRequestOverrides, requireCompany } from "@/src/client";
import { GUIDE_CHECKS, runGuideChecks } from "@/src/gp/guide/checks";

export const maxDuration = 300;

const EMPLOYMENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const SANDBOX_ENVS = new Set(["partners", "sandbox", "local"]);

export async function POST(request: Request) {
  const refused = gpRunsRefused();
  if (refused) return refused;
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);
  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: 400 });
  const env = gatewayEnv || process.env.GATEWAY_ENV || "partners";
  if (!SANDBOX_ENVS.has(env)) return Response.json({ error: "Guide checks only run against the sandboxes" }, { status: 400 });

  let employments: Record<string, string> = {};
  let ids: string[] | undefined;
  try {
    const body = await request.json();
    if (body?.employments && typeof body.employments === "object") {
      employments = Object.fromEntries(
        Object.entries(body.employments as Record<string, unknown>).filter(
          (e): e is [string, string] => /^[A-Z]{3}$/.test(e[0]) && typeof e[1] === "string" && EMPLOYMENT_ID.test(e[1])
        )
      );
    }
    if (Array.isArray(body?.ids)) ids = body.ids.filter((x: unknown): x is string => typeof x === "string" && x in GUIDE_CHECKS);
  } catch {
    // No body: run everything without test employees
  }

  try {
    const client = createClientFromToken(gate.refreshToken, env);
    const results = await runGuideChecks({ client, companySlug: gate.slug, employments }, ids);
    return Response.json({ gatewayEnv: env, results });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
