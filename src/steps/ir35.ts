/**
 * Step 4: IR35 status + SDS document upload (UK contractors only)
 *
 * POST /v1/contractors/employments/:id/contract-documents — set IR35 status
 *
 * IR35 is NOT part of basic_information or any JSON schema.
 * The SDK hardcodes it and sends it via the contract-documents endpoint
 * with body: { contract_document: { ir_35: "inside" | "outside" | "exempt" } }
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export type IR35Status = "outside" | "inside" | "exempt";

/** Set IR35 status on a UK employment via contract-documents endpoint */
export async function setIR35Status(
  client: RemoteClient,
  employmentId: string,
  ir35Status: IR35Status
): Promise<void> {
  const { status, data } = await client.post(
    `/v1/contractors/employments/${employmentId}/contract-documents`,
    {
      contract_document: {
        ir_35: ir35Status,
      },
    }
  );

  if (status !== 201 && status !== 200) {
    throw new Error(
      `POST contract-documents IR35 failed (${status}): ${JSON.stringify(data)}`
    );
  }
  trace.ir35Status(employmentId, ir35Status);
}
