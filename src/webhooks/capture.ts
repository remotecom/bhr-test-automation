/**
 * Webhook event capture for lifecycle test runs.
 *
 * On Vercel: persists events to Vercel Blob so they survive across function instances.
 * Locally: uses in-memory Map (works only within same process, i.e. vitest).
 *
 * The webhook capture route (app/api/webhooks/capture) writes events here.
 * The lifecycle runner reads them back to assert expected webhooks fired.
 */

import { put, list } from "@vercel/blob";

export interface CapturedWebhook {
  event_type: string;
  employment_id: string;
  payload: Record<string, unknown>;
  received_at: string;
}

// In-memory fallback for local/test runs
const memoryStore = new Map<string, CapturedWebhook[]>();

function isVercel(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function blobKey(runId: string, event: CapturedWebhook): string {
  return `webhooks/${runId}/${event.employment_id}/${event.event_type}/${Date.now()}.json`;
}

/** Start a new capture session (clears any stale in-memory data) */
export function startCapture(runId: string): void {
  memoryStore.set(runId, []);
}

/** Record a webhook event */
export async function recordWebhook(
  runId: string,
  event: CapturedWebhook
): Promise<void> {
  if (isVercel()) {
    await put(blobKey(runId, event), JSON.stringify(event), {
      access: "public",
      addRandomSuffix: true,
    });
  } else {
    const events = memoryStore.get(runId) || [];
    events.push(event);
    memoryStore.set(runId, events);
  }
}

/** Get all captured webhooks for a run + employment */
export async function getCapturedWebhooks(
  runId: string,
  employmentId: string
): Promise<CapturedWebhook[]> {
  if (isVercel()) {
    const prefix = `webhooks/${runId}/${employmentId}/`;
    const { blobs } = await list({ prefix });

    const events: CapturedWebhook[] = [];
    for (const blob of blobs) {
      const res = await fetch(blob.url);
      if (res.ok) {
        events.push(await res.json());
      }
    }
    return events;
  }

  const events = memoryStore.get(runId) || [];
  return events.filter((e) => e.employment_id === employmentId);
}

/** Assert expected webhook events arrived (with polling for async ones) */
export async function assertWebhooks(
  runId: string,
  employmentId: string,
  expectedEvents: string[],
  timeoutSec = 15
): Promise<{ passed: boolean; missing: string[]; extra: string[]; received: string[] }> {
  const deadline = Date.now() + timeoutSec * 1000;
  const interval = 2000;

  let received: CapturedWebhook[] = [];

  while (Date.now() < deadline) {
    received = await getCapturedWebhooks(runId, employmentId);
    const receivedTypes = received.map((e) => e.event_type);
    const missing = expectedEvents.filter((e) => !receivedTypes.includes(e));

    if (missing.length === 0) {
      const extra = receivedTypes.filter((e) => !expectedEvents.includes(e));
      return { passed: true, missing: [], extra, received: receivedTypes };
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  // Final check
  received = await getCapturedWebhooks(runId, employmentId);
  const receivedTypes = received.map((e) => e.event_type);
  const missing = expectedEvents.filter((e) => !receivedTypes.includes(e));
  const extra = receivedTypes.filter((e) => !expectedEvents.includes(e));

  return { passed: missing.length === 0, missing, extra, received: receivedTypes };
}

/** Check if webhook capture is available */
export function isWebhookCaptureAvailable(): boolean {
  return isVercel() || memoryStore.size > 0;
}
