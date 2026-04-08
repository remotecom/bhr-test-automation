/**
 * Step 3: POST /v1/employments — create contractor employment
 * Step 10: POST /v1/employments/:id/onboarding/cancel — cleanup
 *
 * Employment creation requires a company-scoped token (refresh_token or JWT bearer).
 * Body format:
 *   { country_code, type: "contractor", basic_information: { full_name, job_title, email, ... } }
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export interface Employment {
  id: string;
  slug: string;
  status: string;
  [key: string]: unknown;
}

interface EmploymentResponse {
  data: { employment: Employment };
}

export interface CreateEmploymentParams {
  company_id?: string;
  country_code: string;
  full_name: string;
  job_title: string;
  email: string;
  provisional_start_date?: string;
}

/** Make email unique per run to avoid reusing existing employments */
let emailCounter = 0;
function uniqueEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local}+${Date.now()}.${++emailCounter}@${domain}`;
}

/** Create a contractor employment */
export async function createEmployment(
  client: RemoteClient,
  params: CreateEmploymentParams
): Promise<Employment> {
  const email = uniqueEmail(params.email);
  const body = {
    country_code: params.country_code,
    type: "contractor" as const,
    basic_information: {
      name: params.full_name,
      job_title: params.job_title,
      email,
      provisional_start_date:
        params.provisional_start_date || futureDate(30),
    },
  };

  const { status, data } = await client.post<EmploymentResponse>(
    "/v1/employments",
    body
  );

  if (status !== 201 && status !== 200) {
    throw new Error(
      `POST /v1/employments failed (${status}): ${JSON.stringify(data)}`
    );
  }
  const emp = data.data.employment;
  trace.employment(emp.id, params.country_code, email);
  return emp;
}

/** Cancel an employment (cleanup) — logs warning instead of throwing on failure */
export async function cancelEmployment(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  const { status } = await client.post(
    `/v1/employments/${employmentId}/onboarding/cancel`
  );

  if (status !== 200 && status !== 204) {
    console.warn(
      `Warning: failed to cancel employment ${employmentId} (status ${status}). May need manual cleanup.`
    );
  }
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}
