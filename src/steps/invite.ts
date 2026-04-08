/**
 * Invite step — final step of contractor onboarding.
 *
 * CM/CM+: POST /v1/employments/:id/invite
 * COR:    POST /v1/risk-reserve  (creates reserve invoice)
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

/** Invite a CM/CM+ contractor (sends onboarding invite) */
export async function inviteContractor(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  const { status, data } = await client.post(
    `/v1/employments/${employmentId}/invite`
  );
  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST invite failed (${status}): ${JSON.stringify(data)}`
    );
  }
  trace.invite(employmentId, "invited");
}

/** Create a COR risk reserve (COR-specific invite equivalent) */
export async function createCORReserve(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  const { status, data } = await client.post(`/v1/risk-reserve`, {
    employment_slug: employmentId,
  });
  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST risk-reserve failed (${status}): ${JSON.stringify(data)}`
    );
  }
  trace.invite(employmentId, "cor-reserve");
}
