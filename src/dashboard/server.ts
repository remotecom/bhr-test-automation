/**
 * Dashboard SSE server — serves HTML + broadcasts events from test code.
 *
 * Routes:
 *   GET  /           — serves index.html
 *   GET  /events     — SSE stream
 *   POST /api/events — receives events from trace.ts / reporter.ts
 */

import http from "node:http";
import fs from "node:fs";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = parseInt(process.env.DASHBOARD_PORT || "3939");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, "index.html");

const clients = new Set<http.ServerResponse>();

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

const server = http.createServer((req, res) => {
  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve HTML
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(HTML_PATH).pipe(res);
    return;
  }

  // SSE endpoint
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

  // Serve last run data (persisted by run.ts)
  if (req.method === "GET" && req.url === "/api/last-run") {
    const lastRunPath = path.join(__dirname, "../../data/last-run.json");
    if (fs.existsSync(lastRunPath)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      fs.createReadStream(lastRunPath).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":"no previous run"}');
    }
    return;
  }

  // Receive events from test code
  if (req.method === "POST" && req.url === "/api/events") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { event, data, ts } = JSON.parse(body);
        broadcast(event, { ...data, ts });
      } catch {
        // Malformed JSON — ignore
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Dashboard running at ${url}\n`);

  // Auto-open browser (macOS)
  if (process.platform === "darwin") {
    exec(`open ${url}`);
  }
});
