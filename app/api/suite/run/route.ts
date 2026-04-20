/**
 * POST /api/suite/run — Runs test suite in-process and streams events as SSE.
 *
 * Architecture:
 *   1. Iterates the test matrix
 *   2. Calls path functions directly (same as Playground)
 *   3. Compares results against expected values
 *   4. Streams SSE events to the frontend
 *   5. Persists last-run data
 *
 * Works on both local dev and Vercel.
 */

import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { runSuite } from "@/src/suite/runner";
import { readRequestOverrides, requireCompany } from "@/src/client";

export const maxDuration = 300;

let running = false;
let currentAbort: AbortController | null = null;

// Server-side state tracking (mirrors run.ts trackEvent pattern)
interface TestState {
  status?: string;
  duration?: number;
  eeId?: string;
  eeEmail?: string;
  entityId?: string;
  products?: string[];
  countryProducts?: string[];
  questionnaireResult?: boolean | null;
  ir35Status?: string;
  eligibility?: { standard: boolean; plus: boolean; cor: boolean };
  corCodes?: string[];
  error?: string | null;
}

function extractTestId(name: string): string {
  const m = name.match(/^([A-Z]\d+(?:\([^)]+\))?)/);
  return m ? m[1] : name.slice(0, 20);
}

export async function POST(request: Request) {
  const { companySlug, refreshToken, gatewayEnv } = readRequestOverrides(request);

  const gate = requireCompany({ companySlug, refreshToken }, gatewayEnv);
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: 400 });
  }

  // Abort previous run if still in progress
  if (running && currentAbort) {
    currentAbort.abort();
  }

  running = true;
  const abort = new AbortController();
  currentAbort = abort;

  // Parse optional test filter from request body
  let testFilter: string | undefined;
  try {
    const body = await request.json();
    testFilter = body?.testFilter;
  } catch {
    // No body or invalid JSON — run all tests
  }

  // State tracking for persistence
  const testState = new Map<string, TestState>();
  const eventBuffer = {
    eeId: null as string | null,
    eeEmail: null as string | null,
    products: null as string[] | null,
    countryProducts: null as string[] | null,
    questionnaireResult: null as boolean | null,
    ir35Status: null as string | null,
    eligibility: null as { standard: boolean; plus: boolean; cor: boolean } | null,
    corCodes: null as string[] | null,
  };
  let lastEntityId: string | null = null;
  let suiteSummary: { passed: number; failed: number; skipped: number; duration: number } | null = null;

  function trackEvent(event: string, data: Record<string, unknown>) {
    switch (event) {
      case "suite:start":
        testState.clear();
        Object.assign(eventBuffer, {
          eeId: null, eeEmail: null, products: null,
          countryProducts: null, questionnaireResult: null,
          ir35Status: null, eligibility: null, corCodes: null,
        });
        lastEntityId = null;
        suiteSummary = null;
        break;
      case "employment":
        eventBuffer.eeId = data.id as string;
        eventBuffer.eeEmail = data.email as string;
        break;
      case "entity:swap":
        lastEntityId = data.entityId as string;
        break;
      case "subscriptions":
        eventBuffer.products = data.products as string[];
        break;
      case "country:eligibility":
        eventBuffer.countryProducts = data.products as string[];
        break;
      case "questionnaire:result":
        eventBuffer.questionnaireResult = data.isBlocking as boolean;
        break;
      case "ir35:status":
        eventBuffer.ir35Status = data.status as string;
        break;
      case "eligibility:result":
        eventBuffer.eligibility = {
          standard: data.standard as boolean,
          plus: data.plus as boolean,
          cor: data.cor as boolean,
        };
        eventBuffer.corCodes = (data.cor_supported_country_codes as string[]) || [];
        break;
      case "test:result": {
        const id = (data.testId as string) || extractTestId(data.name as string);
        const existing = testState.get(id) || {};
        testState.set(id, {
          ...existing,
          status: data.state as string,
          duration: (data.duration as number) || 0,
          error: (data.error as string) || null,
          eeId: eventBuffer.eeId || existing.eeId,
          eeEmail: eventBuffer.eeEmail || existing.eeEmail,
          entityId: lastEntityId || existing.entityId,
          products: eventBuffer.products || existing.products,
          countryProducts: eventBuffer.countryProducts || existing.countryProducts,
          questionnaireResult:
            eventBuffer.questionnaireResult !== null
              ? eventBuffer.questionnaireResult
              : existing.questionnaireResult,
          ir35Status: eventBuffer.ir35Status || existing.ir35Status,
          eligibility: eventBuffer.eligibility || existing.eligibility,
          corCodes: eventBuffer.corCodes || existing.corCodes,
        });
        Object.assign(eventBuffer, {
          eeId: null, eeEmail: null, products: null,
          countryProducts: null, questionnaireResult: null,
          ir35Status: null, eligibility: null, corCodes: null,
        });
        break;
      }
      case "suite:end":
        suiteSummary = {
          passed: (data.passed as number) || 0,
          failed: (data.failed as number) || 0,
          skipped: (data.skipped as number) || 0,
          duration: (data.duration as number) || 0,
        };
        break;
    }
  }

  async function saveLastRun() {
    const tests: Record<string, TestState> = {};
    for (const [id, state] of testState) {
      tests[id] = state;
    }
    const payload = {
      timestamp: new Date().toISOString(),
      summary: suiteSummary,
      tests,
    };
    const json = JSON.stringify(payload, null, 2);

    // Try Vercel Blob first (works on Vercel), fall back to filesystem (local dev)
    try {
      await put("last-run.json", json, {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      });
    } catch {
      try {
        const lastRunPath = path.join(process.cwd(), "data", "last-run.json");
        fs.mkdirSync(path.dirname(lastRunPath), { recursive: true });
        fs.writeFileSync(lastRunPath, json);
      } catch {
        // Non-critical — persistence is best-effort
      }
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream may be closed
        }
      }

      // Combined broadcast: SSE + state tracking
      function broadcast(event: string, data: unknown) {
        send(event, data);
        trackEvent(event, (data || {}) as Record<string, unknown>);

        if (event === "suite:end") {
          saveLastRun();
        }
      }

      // Run the suite in-process
      runSuite(broadcast, { testFilter, signal: abort.signal, companySlug, refreshToken, gatewayEnv })
        .catch((err) => {
          if (abort.signal.aborted) return; // Silently ignore aborted runs
          const msg = err instanceof Error ? err.message : String(err);
          send("suite:process-done", { exitCode: 1, error: msg });
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
