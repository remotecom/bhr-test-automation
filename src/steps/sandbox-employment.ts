/**
 * PUT /v1/sandbox/employments/{id} — force employment status in sandbox.
 *
 * Supports all 11 status values:
 *   created, created_awaiting_reserve, created_reserve_paid, invited,
 *   initiated, pending, review, active, archived, deleted, job_title_review
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export type SandboxEmploymentStatus =
  | "created"
  | "created_awaiting_reserve"
  | "created_reserve_paid"
  | "invited"
  | "initiated"
  | "pending"
  | "review"
  | "active"
  | "archived"
  | "deleted"
  | "job_title_review";

/** Force an employment to a specific status in sandbox */
export async function setSandboxEmploymentStatus(
  client: RemoteClient,
  employmentId: string,
  status: SandboxEmploymentStatus
): Promise<void> {
  const { status: httpStatus, data } = await client.put(
    `/v1/sandbox/employments/${employmentId}`,
    { status }
  );

  if (httpStatus !== 200 && httpStatus !== 204) {
    throw new Error(
      `PUT /v1/sandbox/employments/${employmentId} failed (${httpStatus}): ${JSON.stringify(data)}`
    );
  }

  trace.lifecycleSandboxSet(employmentId, status);
}
