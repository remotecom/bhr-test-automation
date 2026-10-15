/**
 * Create a Global Payroll test employee in the connected sandbox company.
 *
 * Some GP forms (contract details in the Remote sandbox) can only be read for a specific
 * employment, and others change per employment. A test employee lets the capability report
 * fetch those forms exactly as a partner integration sees them.
 *
 * Steps (sandbox only):
 *   1. Find a GP-enabled legal entity in the country. If the company has an entity there with
 *      GP switched off, switch it on. If it has none, create one, then switch GP on.
 *        POST /v1/sandbox/companies/{id}/legal-entities
 *        POST /v1/sandbox/companies/{id}/legal-entities/{entity_id}/activate-global-payroll
 *   2. Create the employment, the same way the remote-flows PayrollAdminOnboarding flow does:
 *        POST /v1/employments { type: "global_payroll_employee", engaged_by_legal_entity_id, basic_information }
 *
 * basic_information starts from the fields every country asks for, then fills any other required
 * field that has fixed options with its first option, read from global_payroll_basic_information.
 */

import type { RemoteClient } from "../client";
import { getCompanyEntities, type LegalEntity } from "../setup/entity-swap";
import { entityCode } from "./evaluate";
import { unwrapSchema } from "./schema-analysis";

export interface GPTestEmployee {
  countryCode: string;
  employmentId: string;
  legalEntityId: string;
  name: string;
  email: string;
  createdAt: string;
  /** What was changed in the company to make this possible, in plain language */
  changes: string[];
}

type Json = Record<string, unknown>;

function entityId(e: LegalEntity): string {
  const r = e as Record<string, unknown>;
  return String(r.id || r.slug || e.legal_entity_id || "");
}

function apiReason(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Json;
  return [typeof d.message === "string" ? d.message : "", d.errors ? JSON.stringify(d.errors) : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

function fail(what: string, status: number, data: unknown): never {
  const reason = apiReason(data);
  throw new Error(`${what} failed (${status})${reason ? `: ${reason}` : ""}`);
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** First fixed option of a schema property (oneOf/anyOf const, or enum), if it has one */
function firstOption(prop: unknown): unknown {
  if (!prop || typeof prop !== "object") return undefined;
  const p = prop as Json;
  for (const k of ["oneOf", "anyOf"]) {
    const arr = p[k];
    if (Array.isArray(arr)) {
      const hit = arr.find((o) => o && typeof o === "object" && (o as Json).const != null);
      if (hit) return (hit as Json).const;
    }
  }
  if (Array.isArray(p.enum)) return p.enum.find((v) => v != null);
  return undefined;
}

/** basic_information for a test employee, filled out against the country's schema */
export function buildBasicInformation(schema: Json | null, name: string, email: string): Json {
  // The schema's login fields only: sending the older `email` alongside them returns 422 "email is not accepted"
  const info: Json = {
    name,
    personal_email: email,
    login_email: "personal",
    job_title: "Software Engineer",
    has_seniority_date: "no",
    provisional_start_date: futureDate(30),
  };
  const props = (schema?.properties as Json | undefined) || {};
  const required = Array.isArray(schema?.required) ? (schema!.required as string[]) : [];
  for (const field of required) {
    if (field in info) continue;
    const option = firstOption(props[field]);
    if (option !== undefined) info[field] = option;
  }
  return info;
}

/** Make sure the company has a GP-enabled legal entity in the country, creating or enabling one if needed */
async function ensureGPEntity(
  client: RemoteClient,
  companySlug: string,
  countryCode: string,
  changes: string[]
): Promise<string> {
  const entities = await getCompanyEntities(client, companySlug);
  const inCountry = entities.filter((e) => entityCode(e) === countryCode);
  const enabled = inCountry.find((e) => (e as Record<string, unknown>).global_payroll_enabled === true);
  if (enabled) return entityId(enabled);

  let id: string;
  if (inCountry.length > 0) {
    id = entityId(inCountry[0]);
  } else {
    const { status, data } = await client.post<{ data: LegalEntity }>(
      `/v1/sandbox/companies/${companySlug}/legal-entities`,
      { country_code: countryCode }
    );
    if (status !== 200 && status !== 201) fail(`Creating a ${countryCode} legal entity`, status, data);
    id = entityId(data.data);
    if (!id) throw new Error(`Created a ${countryCode} legal entity, but the response had no ID`);
    changes.push(`Added a ${countryCode} legal entity to your test company`);
  }

  const { status, data } = await client.post(
    `/v1/sandbox/companies/${companySlug}/legal-entities/${id}/activate-global-payroll`
  );
  if (status !== 200 && status !== 201) fail(`Switching on Global Payroll for the ${countryCode} entity`, status, data);
  changes.push(`Switched on Global Payroll for your ${countryCode} legal entity`);
  return id;
}

let counter = 0;

export async function createGPTestEmployee(
  client: RemoteClient,
  companySlug: string,
  countryCode: string
): Promise<GPTestEmployee> {
  const code = countryCode.toUpperCase();
  const changes: string[] = [];
  const legalEntityId = await ensureGPEntity(client, companySlug, code, changes);

  const schemaRes = await client.get(`/v1/countries/${code}/global_payroll_basic_information`);
  if (schemaRes.status === 422 || schemaRes.status === 404) {
    throw new Error(`${code} has no Global Payroll basic information form, so GP employees can't be created there`);
  }
  const schema = schemaRes.status === 200 ? unwrapSchema(schemaRes.data) : null;

  const stamp = `${Date.now()}.${++counter}`;
  const name = `GP Test ${code}`;
  const email = `gp-test+${code.toLowerCase()}-${stamp}@example.com`;

  const { status, data } = await client.post<{ data: { employment: { id: string } } }>("/v1/employments", {
    type: "global_payroll_employee",
    country_code: code,
    engaged_by_legal_entity_id: legalEntityId,
    basic_information: buildBasicInformation(schema, name, email),
  });
  if (status !== 200 && status !== 201) fail(`Creating the ${code} test employee`, status, data);
  const employmentId = data?.data?.employment?.id;
  if (!employmentId) throw new Error("The employee was created, but the response had no employment ID");

  return { countryCode: code, employmentId, legalEntityId, name, email, createdAt: new Date().toISOString(), changes };
}
