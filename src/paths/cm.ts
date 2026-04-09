/**
 * CM (Contractor Management / "standard") product path.
 *
 * Flow: eligibility → countries → employment → IR35 → subscriptions → verify → cleanup
 * Tests: A1(CM), B2, B6, D2, D4
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
import { setIR35Status, type IR35Status } from "../steps/ir35";
import { setNationality, NATIONALITY_COUNTRIES, type NationalityStatus } from "../steps/nationality";
import { getContractorEligibility, type EligibilityResult } from "../steps/eligibility";

export interface CMPathContext {
  client: RemoteClient;
  companyId: string;
  countryCode: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
  ir35Status?: IR35Status;
  nationalityStatus?: NationalityStatus;
}

export interface CMPathResult {
  eligibility: EligibilityResult;
  countries: Country[];
  country: Country | undefined;
  employment: { id: string; slug: string; status: string; [key: string]: unknown };
  subscriptions: SubscriptionSummary[];
  availableProducts: string[];
}

/**
 * Run the CM product path. Does NOT select a subscription (caller asserts product availability).
 */
export async function runCMPath(ctx: CMPathContext): Promise<CMPathResult> {
  const { client, companyId, countryCode, contractor, legalEntityId } = ctx;

  // Stage 1: Entity-level eligibility
  const eligibility = await getContractorEligibility(client, companyId, legalEntityId);

  // Stage 2: Country catalog
  const countries = await getCountries(client);
  const country = findCountry(countries, countryCode);
  if (country) trace.countryEligibility(country.code, getCountryProducts(country));

  const employment = await createEmployment(client, {
    company_id: companyId,
    country_code: countryCode,
    ...contractor,
  });

  // Nationality (BHR blocks CM+ without it; SAU/KWT/OMN/QAT accept but don't gate)
  if (NATIONALITY_COUNTRIES.includes(countryCode)) {
    await setNationality(client, employment.id, ctx.nationalityStatus || "national");
  }

  // IR35 (if UK)
  if (ctx.ir35Status) {
    await setIR35Status(client, employment.id, ctx.ir35Status);
  }

  // Stage 3: Subscriptions
  const subscriptions = await getSubscriptions(client, employment.id);
  const availableProducts = getAvailableProducts(subscriptions);

  return { eligibility, countries, country, employment, subscriptions, availableProducts };
}

export async function cleanupCMPath(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  await cancelEmployment(client, employmentId);
}
