/**
 * CM+ (Contractor Management Plus / "plus") product path.
 *
 * Flow: eligibility → countries → employment → subscriptions → verify → cleanup
 * Tests: A1(CM+)
 */

import type { RemoteClient } from "../client";
import { getCountries, findCountry, getCountryProducts, type Country } from "../steps/countries";
import { trace } from "../trace";
import { createEmployment, cancelEmployment } from "../steps/employment";
import {
  getSubscriptions,
  getAvailableProducts,
  type SubscriptionSummary,
} from "../steps/subscriptions";
import { getContractorEligibility, type EligibilityResult } from "../steps/eligibility";

export interface CMPlusPathContext {
  client: RemoteClient;
  companyId: string;
  countryCode: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
}

export async function runCMPlusPath(ctx: CMPlusPathContext) {
  const { client, companyId, countryCode, contractor, legalEntityId } = ctx;

  const eligibility = await getContractorEligibility(client, companyId, legalEntityId);

  const countries = await getCountries(client);
  const country = findCountry(countries, countryCode);
  if (country) trace.countryEligibility(country.code, getCountryProducts(country));

  const employment = await createEmployment(client, {
    company_id: companyId,
    country_code: countryCode,
    ...contractor,
  });

  const subscriptions = await getSubscriptions(client, employment.id);
  const availableProducts = getAvailableProducts(subscriptions);

  return { eligibility, countries, country, employment, subscriptions, availableProducts };
}

export async function cleanupCMPlusPath(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  await cancelEmployment(client, employmentId);
}
