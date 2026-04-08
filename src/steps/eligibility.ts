/**
 * Eligibility step module.
 *
 * Stage 1: GET /v1/companies/:id/legal-entities/:le_id/contractor-eligibility
 *   → Pre-employment check: which products (CM/CM+/COR) the entity can use.
 *   → Returns { standard, plus, cor } booleans and cor_supported_country_codes.
 *   → This is where the 30-country rule surfaces (CM/CM+ false for non-30 entities).
 *
 * Also includes country-level and subscription-level helpers.
 */

import type { RemoteClient } from "../client";
import { trace } from "../trace";
import type { Country } from "./countries";
import type { SubscriptionSummary } from "./subscriptions";

export interface EligibilityResult {
  standard: boolean;
  plus: boolean;
  cor: boolean;
  cor_supported_country_codes: string[];
}

interface EligibilityResponse {
  data: {
    contractor_eligibility: {
      standard: boolean;
      plus: boolean;
      cor: boolean;
    };
    cor_supported_country_codes?: string[];
  };
}

/** Stage 1: Get contractor eligibility for a legal entity */
export async function getContractorEligibility(
  client: RemoteClient,
  companyId: string,
  legalEntityId: string
): Promise<EligibilityResult> {
  const { status, data } = await client.get<EligibilityResponse>(
    `/v1/companies/${companyId}/legal-entities/${legalEntityId}/contractor-eligibility`
  );
  if (status !== 200) {
    throw new Error(
      `GET contractor-eligibility failed (${status}): ${JSON.stringify(data)}`
    );
  }
  const elig = data.data.contractor_eligibility;
  const corCodes = data.data.cor_supported_country_codes || [];
  const result: EligibilityResult = {
    standard: elig.standard,
    plus: elig.plus,
    cor: elig.cor,
    cor_supported_country_codes: corCodes,
  };
  trace.eligibility(legalEntityId, result);
  return result;
}

/** Check if a product is available at the country level */
export function isProductAvailableInCountry(
  country: Country,
  product: string
): boolean {
  return (country.contractor_products_available || []).includes(product);
}

/** Get product identifiers from subscription summaries */
export function getSubscriptionProducts(
  subscriptions: SubscriptionSummary[]
): string[] {
  return subscriptions.map((s) => s.product.identifier);
}
