/**
 * EOR Fallback path — when no contractor products are available.
 *
 * Tests: B3 (India entity + India contractor = nothing), F1 (India entity + PRT = COR only), G2 (COR blocked by questionnaire)
 */

import type { RemoteClient } from "../client";
import { getCountries, findCountry, getCountryProducts } from "../steps/countries";
import { trace } from "../trace";
import { createEmployment, cancelEmployment } from "../steps/employment";
import {
  getSubscriptions,
  getAvailableProducts,
  selectCORSubscription,
} from "../steps/subscriptions";
import {
  getQuestionnaireSchema,
  submitQuestionnaire,
  buildBlockingAnswers,
} from "../steps/questionnaire";
import { getContractorEligibility, type EligibilityResult } from "../steps/eligibility";

export interface EORFallbackContext {
  client: RemoteClient;
  companyId: string;
  countryCode: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
  /** If true, test the "COR blocked by questionnaire" path (G2) */
  blockViaQuestionnaire?: boolean;
}

export async function runEORFallbackPath(ctx: EORFallbackContext) {
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

  // G2 path: questionnaire with blocking answers → COR should be blocked
  let questionnaireResult = null;
  if (ctx.blockViaQuestionnaire && availableProducts.includes("COR")) {
    const schema = await getQuestionnaireSchema(client, employment.id);
    const blockingAnswers = buildBlockingAnswers(schema);
    questionnaireResult = await submitQuestionnaire(
      client,
      employment.id,
      blockingAnswers
    );
  }

  return {
    eligibility,
    countries,
    country,
    employment,
    availableProducts,
    questionnaireResult,
  };
}

export async function cleanupEORFallbackPath(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  await cancelEmployment(client, employmentId);
}
