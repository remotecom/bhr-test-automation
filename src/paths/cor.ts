/**
 * COR (Contractor of Record) product path.
 *
 * Flow: eligibility → countries → employment → subscriptions → questionnaire → select COR → verify → cleanup
 * Tests: A1(COR), B4, B5, G1
 */

import type { RemoteClient } from "../client";
import { getCountries, findCountry, getCountryProducts, type Country } from "../steps/countries";
import { trace } from "../trace";
import { createEmployment, cancelEmployment } from "../steps/employment";
import {
  getSubscriptions,
  getAvailableProducts,
  selectCORSubscription,
  type SubscriptionSummary,
} from "../steps/subscriptions";
import {
  getQuestionnaireSchema,
  submitQuestionnaire,
  buildPassingAnswers,
  type QuestionnaireSchema,
  type QuestionnaireResult,
} from "../steps/questionnaire";
import { getContractorEligibility, type EligibilityResult } from "../steps/eligibility";
import { setNationality, NATIONALITY_COUNTRIES } from "../steps/nationality";

export interface CORPathContext {
  client: RemoteClient;
  companyId: string;
  countryCode: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
}

export async function runCORPath(ctx: CORPathContext) {
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

  // Nationality (BHR blocks CM+ without it; SAU/KWT/OMN/QAT accept but don't gate)
  if (NATIONALITY_COUNTRIES.includes(countryCode)) {
    await setNationality(client, employment.id, "national");
  }

  const subscriptions = await getSubscriptions(client, employment.id);
  const availableProducts = getAvailableProducts(subscriptions);

  // Questionnaire first, then select COR (API requires this order)
  let corSelected = false;
  let questionnaire: QuestionnaireSchema | null = null;
  let questionnaireResult: QuestionnaireResult | null = null;
  let postQuestionnaireProducts: string[] = availableProducts;

  if (availableProducts.includes("COR")) {
    // Step 1: Complete questionnaire if one exists
    try {
      questionnaire = await getQuestionnaireSchema(client, employment.id);
      const answers = buildPassingAnswers(questionnaire);
      questionnaireResult = await submitQuestionnaire(client, employment.id, answers);
    } catch {
      // Questionnaire may not exist for all countries
    }

    // Step 2: Select COR subscription
    await selectCORSubscription(client, employment.id);
    corSelected = true;

    // Step 3: Re-check subscriptions after questionnaire + selection
    const postSubs = await getSubscriptions(client, employment.id);
    postQuestionnaireProducts = getAvailableProducts(postSubs);
  }

  return {
    eligibility,
    countries,
    country,
    employment,
    subscriptions,
    availableProducts,
    corSelected,
    questionnaire,
    questionnaireResult,
    postQuestionnaireProducts,
  };
}

export async function cleanupCORPath(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  await cancelEmployment(client, employmentId);
}
