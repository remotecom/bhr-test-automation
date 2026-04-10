/**
 * POST /api/webhooks/capture — Receives webhook events from Remote sandbox.
 *
 * Registered via POST /v1/webhook-callbacks during lifecycle test setup.
 * Stores events in Vercel Blob (production) or in-memory (local).
 * Returns 200 immediately — fire-and-forget from Remote's perspective.
 */

import { recordWebhook, type CapturedWebhook } from "@/src/webhooks/capture";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Remote webhook envelope: { event_type, data, ... }
    const eventType = body.event_type as string;
    if (!eventType) {
      return Response.json({ error: "missing event_type" }, { status: 400 });
    }

    // Extract employment_id from webhook data (nested under data.employment or data.employment_id)
    const employmentId =
      body.data?.employment?.id ||
      body.data?.employment_id ||
      body.data?.id ||
      "unknown";

    // Run ID comes from a custom header set by the lifecycle runner when registering
    const runId = request.headers.get("X-Run-Id") || body.run_id || "default";

    const event: CapturedWebhook = {
      event_type: eventType,
      employment_id: employmentId,
      payload: body,
      received_at: new Date().toISOString(),
    };

    await recordWebhook(runId, event);

    return Response.json({ received: true });
  } catch (err) {
    console.error("Webhook capture error:", err);
    return Response.json({ received: true }, { status: 200 });
  }
}
