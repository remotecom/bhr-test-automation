/**
 * Fire-and-forget event emitter to the dashboard SSE server.
 * If the dashboard isn't running, all POSTs silently fail — zero impact on tests.
 */

const PORT = process.env.DASHBOARD_PORT || "3939";
const URL = `http://localhost:${PORT}/api/events`;

export function emit(event: string, data: Record<string, unknown>) {
  if (!process.env.DASHBOARD_PORT) return;
  fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data, ts: Date.now() }),
  }).catch(() => {});
}
