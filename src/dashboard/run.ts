/**
 * Single-command runner: starts dashboard, runs tests, keeps dashboard alive.
 *
 * Usage:
 *   npm start                          # run all tests
 *   npm start -- cm                    # run CM path
 *   npm start -- tests/cm-path.test.ts # run specific file
 *   npm start -- B1                    # run test matching "B1"
 */

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

import { createClientFromEnv } from "../client";
import {
  runPlayground,
  cancelPlaygroundEmployment,
  getCachedCountries,
  isRunning,
} from "./playground";
import {
  runMegaRun,
  isMegaRunning,
  type MegaRunConfig,
  type MegaRunResult,
} from "./mega-run";

const PORT = parseInt(process.env.DASHBOARD_PORT || "3939");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "index.html");
const LAST_RUN_PATH = path.join(__dirname, "../../data/last-run.json");
const MEGA_RUN_PATH = path.join(__dirname, "../../data/mega-run.json");

// --- SSE Server ---

const clients = new Set<http.ServerResponse>();
let suiteProcess: ReturnType<typeof spawn> | null = null;

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

// --- Server-side test state tracking (mirrors browser eventBuffer pattern) ---

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
  error?: string | null;
}

const serverTestState = new Map<string, TestState>();
const serverEventBuffer = {
  eeId: null as string | null,
  eeEmail: null as string | null,
  products: null as string[] | null,
  countryProducts: null as string[] | null,
  questionnaireResult: null as boolean | null,
  ir35Status: null as string | null,
  eligibility: null as { standard: boolean; plus: boolean; cor: boolean } | null,
};
let lastServerEntityId: string | null = null;
let suiteSummary: { passed: number; failed: number; skipped: number; duration: number } | null = null;

function extractTestId(name: string): string {
  const m = name.match(/^([A-Z]\d+(?:\([^)]+\))?)/);
  return m ? m[1] : name.slice(0, 20);
}

function trackEvent(event: string, data: Record<string, unknown>) {
  switch (event) {
    case "suite:start":
      serverTestState.clear();
      serverEventBuffer.eeId = null;
      serverEventBuffer.eeEmail = null;
      serverEventBuffer.products = null;
      serverEventBuffer.countryProducts = null;
      serverEventBuffer.questionnaireResult = null;
      serverEventBuffer.ir35Status = null;
      serverEventBuffer.eligibility = null;
      lastServerEntityId = null;
      suiteSummary = null;
      break;

    case "employment":
      serverEventBuffer.eeId = data.id as string;
      serverEventBuffer.eeEmail = data.email as string;
      break;

    case "entity:swap":
      lastServerEntityId = data.entityId as string;
      break;

    case "subscriptions":
      serverEventBuffer.products = data.products as string[];
      break;

    case "country:eligibility":
      serverEventBuffer.countryProducts = data.products as string[];
      break;

    case "questionnaire:result":
      serverEventBuffer.questionnaireResult = data.isBlocking as boolean;
      break;

    case "ir35:status":
      serverEventBuffer.ir35Status = data.status as string;
      break;

    case "eligibility:result":
      serverEventBuffer.eligibility = {
        standard: data.standard as boolean,
        plus: data.plus as boolean,
        cor: data.cor as boolean,
      };
      break;

    case "test:result": {
      const id = (data.testId as string) || extractTestId(data.name as string);
      const existing = serverTestState.get(id) || {};
      serverTestState.set(id, {
        ...existing,
        status: data.state as string,
        duration: (data.duration as number) || 0,
        error: (data.error as string) || null,
        eeId: serverEventBuffer.eeId || existing.eeId,
        eeEmail: serverEventBuffer.eeEmail || existing.eeEmail,
        entityId: lastServerEntityId || existing.entityId,
        products: serverEventBuffer.products || existing.products,
        countryProducts: serverEventBuffer.countryProducts || existing.countryProducts,
        questionnaireResult:
          serverEventBuffer.questionnaireResult !== null
            ? serverEventBuffer.questionnaireResult
            : existing.questionnaireResult,
        ir35Status: serverEventBuffer.ir35Status || existing.ir35Status,
        eligibility: serverEventBuffer.eligibility || existing.eligibility,
      });
      // Reset per-test buffer (entity persists)
      serverEventBuffer.eeId = null;
      serverEventBuffer.eeEmail = null;
      serverEventBuffer.products = null;
      serverEventBuffer.countryProducts = null;
      serverEventBuffer.questionnaireResult = null;
      serverEventBuffer.ir35Status = null;
      serverEventBuffer.eligibility = null;
      break;
    }

    case "suite:end":
      suiteSummary = {
        passed: (data.passed as number) || 0,
        failed: (data.failed as number) || 0,
        skipped: (data.skipped as number) || 0,
        duration: (data.duration as number) || 0,
      };
      saveLastRun();
      break;
  }
}

function saveLastRun() {
  const tests: Record<string, TestState> = {};
  for (const [id, state] of serverTestState) {
    tests[id] = state;
  }
  const payload = {
    timestamp: new Date().toISOString(),
    summary: suiteSummary,
    tests,
  };
  try {
    fs.mkdirSync(path.dirname(LAST_RUN_PATH), { recursive: true });
    fs.writeFileSync(LAST_RUN_PATH, JSON.stringify(payload, null, 2));
    console.log(`  Last run saved to ${LAST_RUN_PATH}`);
  } catch (err) {
    console.warn(`  Warning: failed to save last run: ${err}`);
  }
}

function saveMegaRun(result: MegaRunResult) {
  try {
    fs.mkdirSync(path.dirname(MEGA_RUN_PATH), { recursive: true });
    fs.writeFileSync(MEGA_RUN_PATH, JSON.stringify(result, null, 2));
    console.log(`  Mega run saved to ${MEGA_RUN_PATH}`);
  } catch (err) {
    console.warn(`  Warning: failed to save mega run: ${err}`);
  }
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(HTML_PATH).pipe(res);
    return;
  }

  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("event: connected\ndata: {}\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && req.url === "/api/events") {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      try {
        const { event, data, ts } = JSON.parse(body);
        broadcast(event, { ...data, ts });
        // Track server-side for persistence
        trackEvent(event, data || {});
      } catch {
        // ignore
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  // --- Last run persistence ---

  if (req.method === "GET" && req.url === "/api/last-run") {
    try {
      if (fs.existsSync(LAST_RUN_PATH)) {
        const data = fs.readFileSync(LAST_RUN_PATH, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"no previous run"}');
      }
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"failed to read last run"}');
    }
    return;
  }

  // --- Playground API routes ---

  if (req.method === "GET" && req.url === "/api/status") {
    try {
      const companySlug = process.env.COMPANY_SLUG;
      if (!companySlug) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "COMPANY_SLUG not set in .env" }));
        return;
      }
      const client = createClientFromEnv();
      const { status, data } = await client.get<{ data: unknown }>(
        `/v1/companies/${companySlug}`
      );
      if (status === 200) {
        const company = data.data as Record<string, unknown>;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: company.name || companySlug,
            slug: companySlug,
            status: company.status,
            country: (company.address as Record<string, unknown>)?.country,
          })
        );
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Company fetch failed (${status})` }));
      }
    } catch (err: unknown) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/countries") {
    try {
      const countries = await getCachedCountries();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(countries));
    } catch (err: unknown) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/contractors") {
    try {
      const dataDir = path.join(__dirname, "../../data");
      const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "last-run.json");
      const contractors: Record<string, unknown> = {};
      for (const file of files) {
        const raw = fs.readFileSync(path.join(dataDir, file), "utf-8");
        const data = JSON.parse(raw);
        const code = file.replace(".json", "");
        contractors[code] = data;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(contractors));
    } catch (err: unknown) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/playground/run") {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", async () => {
      if (isRunning()) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "A playground run is already in progress" }));
        return;
      }
      if (isMegaRunning()) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Mega run in progress, please wait" }));
        return;
      }
      try {
        const config = JSON.parse(body);
        const runId = crypto.randomUUID();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, runId }));
        // Fire and forget — results stream via SSE
        runPlayground(config, broadcast).catch(() => {});
      } catch (err: unknown) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/suite/run") {
    if (suiteProcess) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Test suite is already running" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    // Spawn vitest in background
    suiteProcess = spawn("npx", ["vitest", "run"], {
      stdio: "inherit",
      env: { ...process.env, DASHBOARD_PORT: String(PORT) },
    });
    suiteProcess.on("close", (code) => {
      console.log(`\n  Tests done (exit ${code}).`);
      suiteProcess = null;
      // Fallback: ensure browser recovers even if suite:end SSE was missed
      broadcast("suite:process-done", { exitCode: code });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/playground/cancel") {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", async () => {
      try {
        const { employmentId } = JSON.parse(body);
        if (!employmentId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "employmentId required" }));
          return;
        }
        await cancelPlaygroundEmployment(employmentId, broadcast);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: unknown) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // --- Mega Run API routes ---

  if (req.method === "POST" && req.url === "/api/mega/run") {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", async () => {
      if (isMegaRunning()) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "A mega run is already in progress" }));
        return;
      }
      if (isRunning()) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Playground run in progress, please wait" }));
        return;
      }
      if (suiteProcess) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Test suite is running, please wait" }));
        return;
      }
      try {
        const overrides = body ? JSON.parse(body) : {};
        const config: MegaRunConfig = {
          entityCountries: overrides.entityCountries || [],
          contractorCountries: overrides.contractorCountries || [],
          products: overrides.products || [],
          fullFlow: overrides.fullFlow ?? true,
          concurrency: overrides.concurrency ?? 1,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        // Fire and forget — results stream via SSE
        runMegaRun(config, broadcast)
          .then((result) => {
            saveMegaRun(result);
          })
          .catch(() => {});
      } catch (err: unknown) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/mega/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ running: isMegaRunning() }));
    return;
  }

  if (req.method === "GET" && (req.url === "/api/mega/last" || req.url?.startsWith("/api/mega/last?"))) {
    try {
      if (fs.existsSync(MEGA_RUN_PATH)) {
        const raw = fs.readFileSync(MEGA_RUN_PATH, "utf-8");
        const full = req.url?.includes("full=true");
        if (full) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(raw);
        } else {
          // Summary only — omit the large results array
          const parsed = JSON.parse(raw);
          const summary = {
            timestamp: parsed.timestamp,
            config: parsed.config,
            summary: parsed.summary,
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(summary));
        }
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"no previous mega run"}');
      }
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"failed to read mega run"}');
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// --- Start server (tests run on demand via UI button) ---

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Dashboard: ${url}`);
  console.log("  Click 'Run All Tests' in the browser to start.\n");

  if (process.platform === "darwin") {
    exec(`open ${url}`);
  }
});

process.on("SIGINT", () => {
  console.log("\n  Shutting down...");
  server.close();
  process.exit(0);
});
