/**
 * COR + IR35 product path (UK contractors via non-UK entity).
 *
 * Flow: eligibility → countries → employment → IR35 → subscriptions → questionnaire → COR → cleanup
 * Tests: D1, D5, D6
 */

import type { RemoteClient } from "../client";
import { getCountries, findCountry, getCountryProducts } from "../steps/countries";
import { trace } from "../trace";
import { createEmployment, cancelEmployment } from "../steps/employment";
import { setIR35Status, type IR35Status } from "../steps/ir35";
import {
  getSubscriptions,
  getAvailableProducts,
  selectCORSubscription,
} from "../steps/subscriptions";
import {
  getQuestionnaireSchema,
  submitQuestionnaire,
  buildPassingAnswers,
} from "../steps/questionnaire";
import { getContractorEligibility, type EligibilityResult } from "../steps/eligibility";

export interface CORIR35PathContext {
  client: RemoteClient;
  companyId: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
  ir35Status: IR35Status;
}

export async function runCORIR35Path(ctx: CORIR35PathContext) {
  const { client, companyId, contractor, legalEntityId, ir35Status } = ctx;
  const countryCode = "GBR";

  const eligibility = await getContractorEligibility(client, companyId, legalEntityId);

  const countries = await getCountries(client);
  const country = findCountry(countries, countryCode);
  if (country) trace.countryEligibility(country.code, getCountryProducts(country));

  const employment = await createEmployment(client, {
    company_id: companyId,
    country_code: countryCode,
    ...contractor,
  });

  // Set IR35 via contract-documents endpoint (response discarded, refetch subs to see effect)
  await setIR35Status(client, employment.id, ir35Status);

  // Refetch subscriptions — back-end now filters by IR35 status
  const subscriptions = await getSubscriptions(client, employment.id);
  const availableProducts = getAvailableProducts(subscriptions);

  // Questionnaire first, then select COR (API requires this order)
  let corSelected = false;
  let questionnaire = null;
  let questionnaireResult = null;

  if (availableProducts.includes("COR")) {
    try {
      questionnaire = await getQuestionnaireSchema(client, employment.id);
      const answers = buildPassingAnswers(questionnaire);
      questionnaireResult = await submitQuestionnaire(client, employment.id, answers);
    } catch {
      // Questionnaire may not exist for all countries
    }

    await selectCORSubscription(client, employment.id);
    corSelected = true;
  }

  return {
    eligibility,
    countries,
    country,
    employment,
    ir35Status,
    availableProducts,
    corSelected,
    questionnaire,
    questionnaireResult,
  };
}

export async function cleanupCORIR35Path(
  client: RemoteClient,
  employmentId: string
): Promise<void> {
  await cancelEmployment(client, employmentId);
}
