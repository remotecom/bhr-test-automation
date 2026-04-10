/**
 * GET /v1/employments/{id} — read employment status.
 * Includes polling helper for async transitions.
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export interface EmploymentStatus {
  id: string;
  status: string;
  [key: string]: unknown;
}

interface EmploymentResponse {
  data: { employment: EmploymentStatus };
}

/** Fetch current employment status */
export async function getEmploymentStatus(
  client: RemoteClient,
  employmentId: string
): Promise<EmploymentStatus> {
  const { status, data } = await client.get<EmploymentResponse>(
    `/v1/employments/${employmentId}`
  );

  if (status === 404) {
    return { id: employmentId, status: "404" };
  }

  if (status !== 200) {
    throw new Error(
      `GET /v1/employments/${employmentId} failed (${status}): ${JSON.stringify(data)}`
    );
  }

  const emp = data.data.employment;
  trace.lifecycleStatus(employmentId, emp.status);
  return emp;
}

/** Poll until employment reaches target status or timeout */
export async function pollEmploymentStatus(
  client: RemoteClient,
  employmentId: string,
  targetStatus: string,
  timeoutSec = 30
): Promise<EmploymentStatus> {
  const deadline = Date.now() + timeoutSec * 1000;
  const interval = 3000;

  while (Date.now() < deadline) {
    const emp = await getEmploymentStatus(client, employmentId);
    if (emp.status === targetStatus) return emp;
    await new Promise((r) => setTimeout(r, interval));
  }

  // Final check
  const emp = await getEmploymentStatus(client, employmentId);
  if (emp.status === targetStatus) return emp;

  throw new Error(
    `Employment ${employmentId} did not reach "${targetStatus}" within ${timeoutSec}s (current: "${emp.status}")`
  );
}
