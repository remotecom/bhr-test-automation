/**
 * POST /v1/contractors/employments/:id/contractor-plus-subscription
 *
 * CM ↔ CM+ upgrade/downgrade.
 * Body: { "operation": "upgrade" | "downgrade" }
 * Webhook: employment.contractor_management_plan.updated
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export type PlanOperation = "upgrade" | "downgrade";

/** Change employment plan between CM and CM+ */
export async function changePlan(
  client: RemoteClient,
  employmentId: string,
  operation: PlanOperation
): Promise<void> {
  const { status, data } = await client.post(
    `/v1/contractors/employments/${employmentId}/contractor-plus-subscription`,
    { operation }
  );

  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST contractor-plus-subscription failed (${status}): ${JSON.stringify(data)}`
    );
  }

  trace.lifecyclePlanChange(employmentId, operation);
}
