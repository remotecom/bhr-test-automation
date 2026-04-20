/**
 * POST /api/lifecycle/run — Runs lifecycle test suite and streams SSE events.
 *
 * Mirrors /api/suite/run — same SSE format, same header conventions.
 * Lifecycle-specific events: lifecycle:start, lifecycle:transition, lifecycle:webhook.
 */

import { runLifecycleSuite } from "@/src/suite/lifecycle-runner";
import { readRequestOverrides, requireCompany } from "@/src/client";

export const maxDuration = 300;

let running = false;
let currentAbort: AbortController | null = null;

export async function POST(request: Request) {
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);

  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: 400 });
  }

  if (running && currentAbort) {
    currentAbort.abort();
  }

  running = true;
  const abort = new AbortController();
  currentAbort = abort;

  let testFilter: string | undefined;
  try {
    const body = await request.json();
    testFilter = body?.testFilter;
  } catch {
    // No body — run all tests
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function broadcast(event: string, data: unknown) {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream may be closed
        }
      }

      runLifecycleSuite(broadcast, { testFilter, signal: abort.signal, companySlug, refreshToken, gatewayEnv })
        .catch((err) => {
          if (abort.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          broadcast("lifecycle:process-done", { exitCode: 1, error: msg });
        })
        .finally(() => {
          running = false;
          currentAbort = null;
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
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
