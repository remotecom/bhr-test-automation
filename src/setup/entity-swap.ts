/**
 * Entity swap utilities for test setup.
 *
 * Uses sandbox-only endpoints to:
 * 1. Create a legal entity in a target country
 * 2. Bypass KYB eligibility checks on it
 * 3. Reassign it as the company's default entity
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";

export interface LegalEntity {
  legal_entity_id: string;
  name: string;
  status: string;
  country?: { code: string; name?: string };
  [key: string]: unknown;
}

interface CreateEntityResponse {
  data: LegalEntity;
}

/** List all legal entities for a company */
export async function getCompanyEntities(
  client: RemoteClient,
  companySlug: string
): Promise<LegalEntity[]> {
  const { status, data } = await client.get<{ data: unknown }>(
    `/v1/companies/${companySlug}/legal-entities`
  );
  if (status !== 200) {
    throw new Error(
      `GET company legal-entities failed (${status}): ${JSON.stringify(data)}`
    );
  }
  // API may return { data: [...] } or { data: { legal_entities: [...] } }
  const inner = data.data;
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === "object" && "legal_entities" in inner) {
    return (inner as { legal_entities: LegalEntity[] }).legal_entities;
  }
  return [];
}

/** Find an existing entity for a country code */
export function findEntityByCountry(
  entities: LegalEntity[],
  countryCode: string
): LegalEntity | undefined {
  return entities.find(
    (e) => e.country?.code?.toLowerCase() === countryCode.toLowerCase()
  );
}

/** Create a new legal entity for a company in the given country */
export async function createLegalEntity(
  client: RemoteClient,
  companySlug: string,
  countryCode: string
): Promise<LegalEntity> {
  const { status, data } = await client.post<CreateEntityResponse>(
    `/v1/sandbox/companies/${companySlug}/legal-entities`,
    { country_code: countryCode }
  );

  if (status !== 201) {
    throw new Error(
      `POST create-legal-entity failed (${status}): ${JSON.stringify(data)}`
    );
  }
  return data.data;
}

/** Bypass KYB/eligibility checks for a company (sandbox only) */
export async function bypassEligibilityChecks(
  client: RemoteClient,
  companySlug: string
): Promise<void> {
  const { status, data } = await client.post(
    `/v1/sandbox/companies/${companySlug}/bypass-eligibility-checks`
  );

  if (status !== 200) {
    throw new Error(
      `POST bypass-eligibility-checks failed (${status}): ${JSON.stringify(data)}`
    );
  }
}

/** Reassign a legal entity as the company's default (with retry for transient 500s) */
export async function reassignDefaultEntity(
  client: RemoteClient,
  companySlug: string,
  entitySlug: string
): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { status, data } = await client.put(
      `/v1/sandbox/companies/${companySlug}/default-legal-entity/${entitySlug}`
    );

    if (status === 200) return;

    if (attempt < maxAttempts && status >= 500) {
      const delay = attempt * 1000;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(
      `PUT reassign-default-entity failed (${status}): ${JSON.stringify(data)}`
    );
  }
}

/**
 * Full entity swap: reuse existing entity or create new → bypass KYB → make it default.
 * Checks if the company already has an entity in the target country before creating.
 */
export async function swapDefaultEntity(
  client: RemoteClient,
  companySlug: string,
  countryCode: string
): Promise<LegalEntity> {
  // Check for existing entity in this country
  const existing = await getCompanyEntities(client, companySlug);
  const match = findEntityByCountry(existing, countryCode);

  let entity: LegalEntity;
  if (match) {
    entity = match;
  } else {
    entity = await createLegalEntity(client, companySlug, countryCode);
    trace.entityCreated(countryCode, entity.legal_entity_id, entity.name);
    await bypassEligibilityChecks(client, companySlug);
  }

  await reassignDefaultEntity(client, companySlug, entity.legal_entity_id);
  trace.entitySwap(countryCode, entity.legal_entity_id);
  return entity;
}
