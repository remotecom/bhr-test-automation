/**
 * POST /api/suite/run — Spawns vitest and streams test events as SSE.
 *
 * Architecture:
 *   1. Creates a temp HTTP server on a random port
 *   2. Spawns `npx vitest run` with DASHBOARD_PORT=<temp port>
 *   3. Reporter's emit() POSTs events to the temp server
 *   4. Temp server bridges events to the SSE stream
 *   5. Cleans up when vitest exits
 *
 * Local-only: returns 501 on Vercel (can't bind ports in serverless).
 */

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export const maxDuration = 300;

let running = false;

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
  if (process.env.VERCEL) {
    return Response.json(
      { error: "Test suite runs locally only. Use `npm test` on Vercel." },
      { status: 501 }
    );
  }

  if (running) {
    return Response.json(
      { error: "Test suite is already running" },
      { status: 409 }
    );
  }

  running = true;

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

  function saveLastRun() {
    const tests: Record<string, TestState> = {};
    for (const [id, state] of testState) {
      tests[id] = state;
    }
    const payload = {
      timestamp: new Date().toISOString(),
      summary: suiteSummary,
      tests,
    };
    try {
      const lastRunPath = path.join(process.cwd(), "data", "last-run.json");
      fs.mkdirSync(path.dirname(lastRunPath), { recursive: true });
      fs.writeFileSync(lastRunPath, JSON.stringify(payload, null, 2));
    } catch {
      // Non-critical — persistence is best-effort
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

      // Create temp HTTP server to receive events from the reporter
      const tempServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/events") {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try {
              const { event, data } = JSON.parse(body);
              // Track for persistence
              trackEvent(event, data || {});
              // Bridge to SSE stream
              send(event, data);
              // Save on suite:end
              if (event === "suite:end") {
                saveLastRun();
              }
            } catch {
              // Malformed JSON
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          });
          return;
        }
        res.writeHead(404);
        res.end();
      });

      // Listen on random port
      tempServer.listen(0, () => {
        const addr = tempServer.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;

        // Spawn vitest
        const args = ["vitest", "run"];
        if (testFilter) {
          // Escape regex special chars — vitest -t matches against full name (including describe)
          const escaped = testFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          args.push("-t", escaped);
        }
        const child = spawn("npx", args, {
          stdio: "inherit",
          cwd: process.cwd(),
          env: { ...process.env, DASHBOARD_PORT: String(port) },
        });

        let closed = false;
        function cleanup() {
          if (closed) return;
          closed = true;
          tempServer.close();
          running = false;
          try { controller.close(); } catch { /* already closed */ }
        }

        child.on("close", (code) => {
          send("suite:process-done", { exitCode: code });
          cleanup();
        });

        child.on("error", (err) => {
          send("suite:process-done", { exitCode: 1, error: err.message });
          cleanup();
        });
      });

      tempServer.on("error", () => {
        send("suite:process-done", { exitCode: 1, error: "Failed to start event server" });
        running = false;
        try { controller.close(); } catch { /* already closed */ }
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
