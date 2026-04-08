/**
 * Step: Nationality status (BHR, SAU, KWT, OMN, QAT contractors)
 *
 * POST /v1/contractors/employments/:id/contract-documents — set nationality
 *
 * Only BHR gates CM+/COR on this field (non_national → reject, missing → reject).
 * SAU/KWT/OMN/QAT accept the field but no longer block products on it.
 *
 * Body: { contract_document: { nationality: "national" | "non_national" } }
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export type NationalityStatus = "national" | "non_national";

/** Countries where the contract-documents endpoint accepts nationality */
export const NATIONALITY_COUNTRIES = ["BHR", "SAU", "KWT", "OMN", "QAT"];

/** Set nationality on an employment via contract-documents endpoint */
export async function setNationality(
  client: RemoteClient,
  employmentId: string,
  nationality: NationalityStatus
): Promise<void> {
  const { status, data } = await client.post(
    `/v1/contractors/employments/${employmentId}/contract-documents`,
    {
      contract_document: {
        nationality,
      },
    }
  );

  if (status !== 201 && status !== 200) {
    throw new Error(
      `POST contract-documents nationality failed (${status}): ${JSON.stringify(data)}`
    );
  }
  trace.nationality(employmentId, nationality);
}
