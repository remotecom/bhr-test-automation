/**
 * POST /api/gp/capabilities/run: GP capability report, streamed as SSE.
 *
 * Body (optional): { scope?: "baseline" | "all" | "custom", countryCodes?: string[], employments?: { GBR: "<employment id>" } }
 * Headers: X-Company-Slug, X-Refresh-Token, X-Gateway-Env (same as the suite)
 *
 * Read-only: probes global_payroll_* form schemas and lists legal entities. Creates nothing,
 * and stores nothing on the server; the browser keeps the last report.
 */

import { gpRunsRefused } from "@/lib/features";
import { readRequestOverrides, requireCompany } from "@/src/client";
import { runGPCapabilities } from "@/src/gp/capability-runner";
import type { GPScope } from "@/src/gp/types";

export const maxDuration = 300;

const SCOPES: GPScope[] = ["baseline", "all", "custom"];
const EMPLOYMENT_ID = /^[A-Za-z0-9-]{8,64}$/;

export async function POST(request: Request) {
  const refused = gpRunsRefused();
  if (refused) return refused;
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);
  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: 400 });
  }

  let scope: GPScope = "baseline";
  let countryCodes: string[] | undefined;
  let employments: Record<string, string> | undefined;
  try {
    const body = await request.json();
    if (SCOPES.includes(body?.scope)) scope = body.scope;
    if (Array.isArray(body?.countryCodes)) {
      countryCodes = body.countryCodes
        .filter((c: unknown): c is string => typeof c === "string" && /^[A-Za-z]{3}$/.test(c.trim()))
        .map((c: string) => c.trim().toUpperCase());
    }
    if (body?.employments && typeof body.employments === "object") {
      employments = Object.fromEntries(
        Object.entries(body.employments as Record<string, unknown>)
          .filter(([cc, id]) => /^[A-Za-z]{3}$/.test(cc) && typeof id === "string" && EMPLOYMENT_ID.test(id))
          .map(([cc, id]) => [cc.toUpperCase(), id as string])
      );
    }
  } catch {
    // No body: default scope
  }
  if (scope === "custom" && (!countryCodes || countryCodes.length === 0)) {
    return Response.json({ error: "Custom scope needs at least one ISO alpha-3 country code" }, { status: 400 });
  }

  // Each run belongs to its own request. Instances are shared between users on Vercel,
  // so a run must never cancel anyone else's: it stops only when its own client disconnects.
  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      };

      runGPCapabilities(
        // Nothing is stored on the server: the browser keeps the finished report (see hooks/useGPCapabilities.ts)
        (event, data) => send(event, data),
        { signal: abort.signal, companySlug: gate.slug, refreshToken: gate.refreshToken, gatewayEnv, scope, countryCodes, employments }
      )
        .then(() => send("gp:process-done", { exitCode: abort.signal.aborted ? 130 : 0 }))
        .catch((err) => {
          if (abort.signal.aborted) return;
          send("gp:process-done", { exitCode: 1, error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
