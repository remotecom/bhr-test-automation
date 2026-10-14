/**
 * POST /api/gp/capabilities/run: GP capability report, streamed as SSE.
 *
 * Body (optional): { scope?: "baseline" | "all" | "custom", countryCodes?: string[] }
 * Headers: X-Company-Slug, X-Refresh-Token, X-Gateway-Env (same as the suite)
 *
 * Read-only: probes global_payroll_* form schemas and lists legal entities. Creates nothing,
 * and stores nothing on the server; the browser keeps the last report.
 */

import { readRequestOverrides, requireCompany } from "@/src/client";
import { runGPCapabilities } from "@/src/gp/capability-runner";
import type { GPScope } from "@/src/gp/types";

export const maxDuration = 300;

let currentAbort: AbortController | null = null;

const SCOPES: GPScope[] = ["baseline", "all", "custom"];

export async function POST(request: Request) {
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);
  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: 400 });
  }

  let scope: GPScope = "baseline";
  let countryCodes: string[] | undefined;
  try {
    const body = await request.json();
    if (SCOPES.includes(body?.scope)) scope = body.scope;
    if (Array.isArray(body?.countryCodes)) {
      countryCodes = body.countryCodes
        .filter((c: unknown): c is string => typeof c === "string" && /^[A-Za-z]{3}$/.test(c.trim()))
        .map((c: string) => c.trim().toUpperCase());
    }
  } catch {
    // No body: default scope
  }
  if (scope === "custom" && (!countryCodes || countryCodes.length === 0)) {
    return Response.json({ error: "Custom scope needs at least one ISO alpha-3 country code" }, { status: 400 });
  }

  // One run at a time per instance: a new run aborts the previous one
  currentAbort?.abort();
  const abort = new AbortController();
  currentAbort = abort;
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
        { signal: abort.signal, companySlug: gate.slug, refreshToken: gate.refreshToken, gatewayEnv, scope, countryCodes }
      )
        .then(() => send("gp:process-done", { exitCode: abort.signal.aborted ? 130 : 0 }))
        .catch((err) => {
          if (abort.signal.aborted) return;
          send("gp:process-done", { exitCode: 1, error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          if (currentAbort === abort) currentAbort = null;
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
