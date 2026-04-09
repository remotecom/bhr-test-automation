/**
 * Playground: run a single contractor onboarding scenario interactively.
 *
 * Reuses the same step modules that the test suite uses.
 * The step modules call trace.ts → emit.ts → POST /api/events → broadcast,
 * so the existing dashboard panels (employments, entity swaps, products)
 * update automatically. This module only adds playground:* namespace events
 * for the trace log and state management.
 *
 * When targetProduct is set, runs the full onboarding flow:
 * employment → subscriptions → [subscription selection] → contract details → sign → invite
 */

import { createClientFromEnv, createClientFromToken } from "../client";
import { getCountries, type Country } from "../steps/countries";
import { createEmployment, cancelEmployment } from "../steps/employment";
import {
  getSubscriptions,
  getAvailableProducts,
  selectPlusSubscription,
  selectCORSubscription,
  type SubscriptionSummary,
} from "../steps/subscriptions";
import { setIR35Status, type IR35Status } from "../steps/ir35";
import { setNationality, NATIONALITY_COUNTRIES, type NationalityStatus } from "../steps/nationality";
import { swapDefaultEntity } from "../setup/entity-swap";
import {
  getContractorEligibility,
  type EligibilityResult,
} from "../steps/eligibility";
import {
  getQuestionnaireSchema,
  submitQuestionnaire,
  buildPassingAnswers,
} from "../steps/questionnaire";
import {
  submitContractDetails,
  previewContract,
} from "../steps/contract-details";
import { inviteContractor, createCORReserve } from "../steps/invite";
import { trace } from "../trace";

export interface PlaygroundConfig {
  entityCountry?: string;
  contractorCountry: string;
  contractor: { full_name: string; job_title: string; email: string };
  ir35Status?: IR35Status;
  nationalityStatus?: NationalityStatus;
  targetProduct?: string; // 'CM' | 'CM+' | 'COR' | undefined
  companySlug?: string;
  refreshToken?: string;
}

export interface PlaygroundResult {
  employmentId: string;
  entityId?: string;
  products: string[];
  subscriptions: SubscriptionSummary[];
  selectedProduct?: string;
  contractDocId?: string;
  invited?: boolean;
  inviteType?: string;
  eligibility?: EligibilityResult;
  stoppedAt?: string;
  stoppedReason?: string;
}

type BroadcastFn = (event: string, data: unknown) => void;

let activeRun: { employmentId?: string } | null = null;

export function isRunning(): boolean {
  return activeRun !== null;
}

export async function runPlayground(
  config: PlaygroundConfig,
  broadcast: BroadcastFn
): Promise<PlaygroundResult> {
  if (activeRun) {
    throw new Error("A playground run is already in progress");
  }
  activeRun = {};

  const companySlug = config.companySlug || process.env.COMPANY_SLUG;
  if (!companySlug) {
    throw new Error("COMPANY_SLUG env var required");
  }

  try {
    broadcast("playground:start", {
      entityCountry: config.entityCountry,
      contractorCountry: config.contractorCountry,
      ir35Status: config.ir35Status || "none",
      targetProduct: config.targetProduct || "none",
    });

    const client = config.refreshToken
      ? createClientFromToken(config.refreshToken)
      : createClientFromEnv();
    let entityId: string | undefined;

    // Step 1: Entity swap (optional)
    if (config.entityCountry) {
      broadcast("playground:step", {
        label: `Swapping default entity to ${config.entityCountry}...`,
      });
      const entity = await swapDefaultEntity(
        client,
        companySlug,
        config.entityCountry
      );
      entityId = entity.legal_entity_id || (entity as Record<string, unknown>).id as string;
      broadcast("playground:entity-swap", {
        entityId,
        entityName: entity.name,
        countryCode: config.entityCountry,
      });
    }

    // Side-trace: fire eligibility check in parallel (only when entity is known)
    let eligibilityPromise: Promise<EligibilityResult | null> =
      Promise.resolve(null);
    if (entityId) {
      eligibilityPromise = (async () => {
        broadcast("playground:step", {
          label: "// Checking contractor eligibility...",
          side: true,
        });
        const elig = await getContractorEligibility(
          client,
          companySlug,
          entityId
        );
        broadcast("playground:eligibility", { entityId, contractorCountry: config.contractorCountry, ...elig });
        return elig;
      })().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("playground:eligibility", {
          entityId,
          error: true,
          message: msg,
        });
        return null;
      });
    }

    // Step 2: Create employment
    broadcast("playground:step", {
      label: `Creating employment in ${config.contractorCountry}...`,
    });
    const employment = await createEmployment(client, {
      company_id: companySlug,
      country_code: config.contractorCountry,
      ...config.contractor,
    });
    activeRun.employmentId = employment.id;

    // Step 3: IR35 (optional, typically GBR only)
    if (config.ir35Status) {
      broadcast("playground:step", {
        label: `Setting IR35 status: ${config.ir35Status}...`,
      });
      await setIR35Status(client, employment.id, config.ir35Status);
    }

    // Step 3b: Nationality (BHR blocks CM+ without it; SAU/KWT/OMN/QAT accept but don't gate)
    if (NATIONALITY_COUNTRIES.includes(config.contractorCountry)) {
      const natStatus = config.nationalityStatus || "national";
      broadcast("playground:step", {
        label: `Setting nationality: ${natStatus}...`,
      });
      await setNationality(client, employment.id, natStatus);
    }

    // Step 4: Fetch subscriptions / available products
    broadcast("playground:step", { label: "Fetching available products..." });
    const subscriptions = await getSubscriptions(client, employment.id);
    const products = getAvailableProducts(subscriptions);

    // If no target product, stop here (original behavior)
    if (!config.targetProduct) {
      const eligibility = await eligibilityPromise;
      const result: PlaygroundResult = {
        employmentId: employment.id,
        entityId,
        products,
        subscriptions,
        eligibility: eligibility ?? undefined,
      };
      broadcast("playground:done", result);
      return result;
    }

    // Check if target product is available
    if (!products.includes(config.targetProduct)) {
      const eligibility = await eligibilityPromise;
      const result: PlaygroundResult = {
        employmentId: employment.id,
        entityId,
        products,
        subscriptions,
        eligibility: eligibility ?? undefined,
        stoppedAt: "subscriptions",
        stoppedReason: `${config.targetProduct} not available. Available: ${products.join(", ") || "none"}`,
      };
      broadcast("playground:product-unavailable", {
        requested: config.targetProduct,
        available: products,
        employmentId: employment.id,
      });
      broadcast("playground:done", result);
      return result;
    }

    // Step 5: Select subscription based on target product
    let selectedProduct = config.targetProduct;

    if (selectedProduct === "COR") {
      // COR requires questionnaire first
      broadcast("playground:step", {
        label: "Fetching COR eligibility questionnaire...",
      });
      const schema = await getQuestionnaireSchema(client);
      const answers = buildPassingAnswers(schema);

      broadcast("playground:step", {
        label: "Submitting questionnaire (non-blocking answers)...",
      });
      await submitQuestionnaire(client, employment.id, answers);

      broadcast("playground:step", { label: "Selecting COR subscription..." });
      await selectCORSubscription(client, employment.id);
      trace.subscriptionSelected(employment.id, "COR");
    } else if (selectedProduct === "CM+") {
      broadcast("playground:step", {
        label: "Selecting CM+ subscription...",
      });
      await selectPlusSubscription(client, employment.id);
      trace.subscriptionSelected(employment.id, "CM+");
    } else {
      trace.subscriptionSelected(employment.id, "CM");
    }

    broadcast("playground:step", {
      label: `${selectedProduct} selected. Submitting contract details...`,
    });

    // Step 6: Submit contract details
    const contractDocId = await submitContractDetails(
      client,
      employment.id,
      config.contractorCountry
    );

    // Step 6b: Preview (generates contract PDF)
    broadcast("playground:step", {
      label: "Generating contract preview...",
    });
    await previewContract(client, employment.id, contractDocId);

    // Note: signing is a contractor-facing action, not available via partner API.
    // The contractor signs later when they open the contract link.

    // Step 7: Invite
    let inviteType: string;
    if (selectedProduct === "COR") {
      broadcast("playground:step", {
        label: "Creating COR risk reserve...",
      });
      await createCORReserve(client, employment.id);
      inviteType = "cor-reserve";
    } else {
      broadcast("playground:step", {
        label: "Sending contractor invite...",
      });
      await inviteContractor(client, employment.id);
      inviteType = "invited";
    }

    const eligibility = await eligibilityPromise;
    const result: PlaygroundResult = {
      employmentId: employment.id,
      entityId,
      products,
      subscriptions,
      selectedProduct,
      contractDocId,
      invited: true,
      inviteType,
      eligibility: eligibility ?? undefined,
    };

    broadcast("playground:done", result);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    broadcast("playground:error", { message });
    throw err;
  } finally {
    activeRun = null;
  }
}

/** Cancel the most recently created playground employment */
export async function cancelPlaygroundEmployment(
  employmentId: string,
  broadcast: BroadcastFn
): Promise<void> {
  const client = createClientFromEnv();
  await cancelEmployment(client, employmentId);
  broadcast("playground:cancelled", { employmentId });
}

/** Cached countries list for the playground dropdowns */
let countriesCache: { data: Country[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedCountries(): Promise<Country[]> {
  if (countriesCache && Date.now() - countriesCache.ts < CACHE_TTL) {
    return countriesCache.data;
  }
  const client = createClientFromEnv();
  const countries = await getCountries(client);
  countriesCache = { data: countries, ts: Date.now() };
  return countries;
}
