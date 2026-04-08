/**
 * Contract details step.
 *
 * Schema: GET /v1/countries/:code/contractor-contract-details?json_schema_version=1&employment_id=:id
 * Submit: POST /v1/contractors/employments/:id/contract-documents
 * Sign:   POST /v1/contractors/employments/:id/contract-documents/:doc_id/sign
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

interface ContractDetailsSchema {
  [key: string]: unknown;
}

interface ContractDocumentResponse {
  data: {
    contract_document: {
      id: string;
      [key: string]: unknown;
    };
  };
}

/** Fetch the contract details JSON Schema for a country + employment */
export async function getContractDetailsSchema(
  client: RemoteClient,
  countryCode: string,
  employmentId: string
): Promise<ContractDetailsSchema> {
  const { status, data } = await client.get<{ data: ContractDetailsSchema }>(
    `/v1/countries/${countryCode}/contractor-contract-details?json_schema_version=1&employment_id=${employmentId}`
  );
  if (status !== 200) {
    throw new Error(
      `GET contractor-contract-details failed (${status}): ${JSON.stringify(data)}`
    );
  }
  return data.data;
}

/**
 * Two schema shapes exist (same across all countries):
 *   CM/CM+: base fields only
 *   COR:    base + invoice_payment_due_days + expiration_date + total_working_hours
 *
 * We detect COR by checking if invoice_payment_due_days exists in the schema.
 */

/** CM/CM+ defaults — works for all countries */
function buildCMDefaults(): Record<string, unknown> {
  return {
    services_and_deliverables:
      "Service and Deliverables project manager role",
    service_duration: {
      provisional_start_date: futureDate(30),
    },
    termination: {
      contractor_notice_period_amount: 15,
      company_notice_period_amount: 15,
    },
    payment_terms: {
      payment_terms_type: "pay_period",
      compensation_gross_amount: 1000,
      compensation_currency_code: "USD",
      invoicing_frequency: "weekly",
      period_unit: "hourly",
    },
  };
}

/** COR defaults — adds invoice_payment_due_days, expiration_date, total_working_hours */
function buildCORDefaults(): Record<string, unknown> {
  return {
    services_and_deliverables:
      "Service and Deliverables project manager role",
    service_duration: {
      provisional_start_date: futureDate(30),
      expiration_date: futureDate(365),
    },
    termination: {
      contractor_notice_period_amount: 15,
      company_notice_period_amount: 15,
    },
    payment_terms: {
      payment_terms_type: "pay_period",
      compensation_gross_amount: 1000,
      compensation_currency_code: "USD",
      invoicing_frequency: "weekly",
      period_unit: "hourly",
      invoice_payment_due_days: 30,
    },
  };
}

/** Build contract details from the schema — detects COR vs CM/CM+ shape */
export function buildContractDetailsFromSchema(
  schema: ContractDetailsSchema
): Record<string, unknown> {
  const inner = (schema as any).schema || schema;
  const pt = inner.properties?.payment_terms?.properties || {};
  const isCOR = !!pt.invoice_payment_due_days;
  return isCOR ? buildCORDefaults() : buildCMDefaults();
}

/** Submit contract details, creating a contract document.
 *  When details are omitted, fetches the country schema and builds defaults. */
export async function submitContractDetails(
  client: RemoteClient,
  employmentId: string,
  countryCode: string,
  details?: Record<string, unknown>
): Promise<string> {
  let contractDocument = details;
  if (!contractDocument) {
    const schema = await getContractDetailsSchema(client, countryCode, employmentId);
    contractDocument = buildContractDetailsFromSchema(schema);
  }
  const { status, data } = await client.post<ContractDocumentResponse>(
    `/v1/contractors/employments/${employmentId}/contract-documents`,
    { contract_document: contractDocument, skip_ai_checks: true }
  );
  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST contract-documents failed (${status}): ${JSON.stringify(data)}`
    );
  }
  const docId = data.data.contract_document.id;
  trace.contractDetails(employmentId, "submitted");
  return docId;
}

/** Fetch contract document preview — triggers PDF generation and moves status to awaiting_signatures */
export async function previewContract(
  client: RemoteClient,
  employmentId: string,
  contractDocId: string
): Promise<void> {
  const { status } = await client.get(
    `/v1/contractors/employments/${employmentId}/contract-documents/${contractDocId}`
  );
  if (status !== 200) {
    throw new Error(`GET contract-document preview failed (${status})`);
  }
  trace.contractDetails(employmentId, "preview");
}

/** Sign a contract document */
export async function signContract(
  client: RemoteClient,
  employmentId: string,
  contractDocId: string,
  fullName: string
): Promise<void> {
  const { status, data } = await client.post(
    `/v1/contractors/employments/${employmentId}/contract-documents/${contractDocId}/sign`,
    { signature: fullName }
  );
  if (status !== 200 && status !== 201) {
    throw new Error(
      `POST contract-documents sign failed (${status}): ${JSON.stringify(data)}`
    );
  }
  trace.contractSigned(employmentId);
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}
