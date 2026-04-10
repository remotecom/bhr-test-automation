/**
 * POST /v1/contractors/employments/:id/terminate-cor-employment
 *
 * Two-phase async process:
 * 1. Sync: creates termination request (initiated), employment stays active
 * 2. Async: after final invoice paid/waived/21 days, employment → archived
 *
 * No request body needed.
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export interface TerminationResult {
  termination_request_id: string;
  employment_id: string;
  status: string;
  termination_date: string;
  created_at: string;
}

interface TerminationResponse {
  data: TerminationResult;
}

/** Initiate COR termination — returns termination request details */
export async function terminateCOREmployment(
  client: RemoteClient,
  employmentId: string
): Promise<TerminationResult> {
  const { status, data } = await client.post<TerminationResponse>(
    `/v1/contractors/employments/${employmentId}/terminate-cor-employment`
  );

  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST terminate-cor-employment failed (${status}): ${JSON.stringify(data)}`
    );
  }

  const result = data.data;
  trace.lifecycleTermination(employmentId, result.termination_request_id);
  return result;
}
