/**
 * Mega Run: for every default LE possible, create every possible contractor product.
 *
 * Flow per entity:
 *   1. Swap default entity to target country (reuses existing if available)
 *   2. For each contractor country, create employment
 *   3. Fetch subscriptions → available products
 *   4. For each available product, run full flow:
 *      - CM: contract details → preview → invite
 *      - CM+: select plus → contract details → preview → invite
 *      - COR: questionnaire → select COR → contract details → preview → risk-reserve
 *   5. Record result for each combination
 *
 * Results stream via SSE (mega:* events) so the dashboard updates live.
 */

import { createClientFromEnv, type RemoteClient } from "../client";
import { getCountries, type Country } from "../steps/countries";
import { swapDefaultEntity } from "../setup/entity-swap";
import { createEmployment, cancelEmployment } from "../steps/employment";
import {
  getSubscriptions,
  getAvailableProducts,
  selectPlusSubscription,
  selectCORSubscription,
} from "../steps/subscriptions";
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
import { isRunning as isPlaygroundRunning } from "./playground";

// ── Types ──

export interface MegaRunConfig {
  /** Entity countries to test (ISO alpha-3). Empty = all eor_onboarding countries. */
  entityCountries: string[];
  /** Contractor countries to test. Empty = all with contractor_products_available. */
  contractorCountries: string[];
  /** Products to attempt when available. Empty = all. */
  products: string[];
  /** Run the full flow (contract+invite) or just check product availability */
  fullFlow: boolean;
  /** Parallel contractor flows per entity. Default 1. */
  concurrency: number;
}

export interface MegaCellResult {
  entityCountry: string;
  contractorCountry: string;
  product: string;
  employmentId?: string;
  entityId?: string;
  availableProducts: string[];
  status: "success" | "skipped" | "unavailable" | "error";
  step?: string; // last step completed
  error?: string;
  duration: number;
}

export interface MegaRunResult {
  timestamp: string;
  config: MegaRunConfig;
  results: MegaCellResult[];
  summary: {
    total: number;
    success: number;
    skipped: number;
    unavailable: number;
    error: number;
    duration: number;
  };
}

type BroadcastFn = (event: string, data: unknown) => void;

let activeMegaRun = false;

export function isMegaRunning(): boolean {
  return activeMegaRun;
}

// ── Helpers ──

/** Map API product names to display names */
const PRODUCT_MAP: Record<string, string> = {
  standard: "CM",
  plus: "CM+",
  cor: "COR",
};

function normalizeProduct(p: string): string {
  return PRODUCT_MAP[p] || p;
}

/** Push an error result for a specific cell and broadcast it */
function recordResult(
  results: MegaCellResult[],
  broadcast: BroadcastFn,
  result: MegaCellResult
): void {
  results.push(result);
  broadcast("mega:result", {
    entityCountry: result.entityCountry,
    contractorCountry: result.contractorCountry,
    product: result.product,
    employmentId: result.employmentId,
    status: result.status,
    step: result.step,
    error: result.error,
    availableProducts: result.availableProducts,
  });
}

/** Simple semaphore for concurrency control */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let active = 0;
  let idx = 0;

  return new Promise((resolve, reject) => {
    function next() {
      while (active < concurrency && idx < items.length) {
        const item = items[idx++];
        active++;
        fn(item)
          .catch(reject)
          .finally(() => {
            active--;
            next();
          });
      }
      if (active === 0 && idx >= items.length) {
        resolve();
      }
    }
    next();
  });
}

// ── Main runner ──

export async function runMegaRun(
  config: MegaRunConfig,
  broadcast: BroadcastFn
): Promise<MegaRunResult> {
  if (activeMegaRun) throw new Error("A mega run is already in progress");
  if (isPlaygroundRunning()) throw new Error("Playground run in progress, please wait");
  activeMegaRun = true;

  const companySlug = process.env.COMPANY_SLUG;
  if (!companySlug) throw new Error("COMPANY_SLUG env var required");

  const startTime = Date.now();
  const results: MegaCellResult[] = [];
  const client = createClientFromEnv();
  const concurrency = config.concurrency || 1;

  try {
    broadcast("mega:start", { config });

    // Fetch all countries from API for discovery
    const allCountries = await getCountries(client);
    const countryMap = new Map(allCountries.map((c) => [c.code, c]));

    // Resolve country lists
    const entityList = config.entityCountries.length
      ? config.entityCountries
      : allCountries.filter((c) => c.eor_onboarding).map((c) => c.code);

    const contractorList = config.contractorCountries.length
      ? config.contractorCountries
      : allCountries
          .filter((c) => (c.contractor_products_available || []).length > 0)
          .map((c) => c.code);

    const productFilter = new Set(
      config.products.length ? config.products : ["CM", "CM+", "COR"]
    );

    // Broadcast country product availability for pre-flight UI
    const countryProducts: Record<string, string[]> = {};
    for (const c of allCountries) {
      countryProducts[c.code] = (c.contractor_products_available || []).map(normalizeProduct);
    }
    broadcast("mega:country-products", { countryProducts });

    broadcast("mega:plan", {
      entities: entityList,
      contractors: contractorList,
      products: [...productFilter],
      totalCombinations: entityList.length * contractorList.length * productFilter.size,
    });

    for (const entityCC of entityList) {
      // Swap entity
      broadcast("mega:entity", { country: entityCC, status: "swapping" });
      let entityId: string;
      try {
        const entity = await swapDefaultEntity(client, companySlug, entityCC);
        entityId = entity.legal_entity_id;
        broadcast("mega:entity", {
          country: entityCC,
          status: "ready",
          entityId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("mega:entity", {
          country: entityCC,
          status: "error",
          error: msg,
        });
        // Record error for all contractors under this entity
        for (const ccHire of contractorList) {
          for (const product of productFilter) {
            recordResult(results, broadcast, {
              entityCountry: entityCC,
              contractorCountry: ccHire,
              product,
              availableProducts: [],
              status: "error",
              step: "entity-swap",
              error: msg,
              duration: 0,
            });
          }
        }
        continue;
      }

      // Process contractor countries with concurrency control
      await runWithConcurrency(contractorList, concurrency, async (ccHire) => {
        const cellStart = Date.now();
        broadcast("mega:cell", {
          entityCountry: entityCC,
          contractorCountry: ccHire,
          status: "checking",
        });

        // Use contractor_products_available from countries API (no employment needed)
        const country = countryMap.get(ccHire);
        const availableProducts = (country?.contractor_products_available || []).map(normalizeProduct);

        if (!config.fullFlow) {
          // ── Availability scan: just check country-level product availability ──
          for (const product of productFilter) {
            recordResult(results, broadcast, {
              entityCountry: entityCC,
              contractorCountry: ccHire,
              product,
              entityId,
              availableProducts,
              status: availableProducts.includes(product) ? "success" : "unavailable",
              step: "country-products",
              duration: Date.now() - cellStart,
            });
          }
          return;
        }

        // ── Full flow: create employment and run through each product ──
        let employmentId: string | undefined;

        try {
          const emp = await createEmployment(client, {
            company_id: companySlug,
            country_code: ccHire,
            full_name: `Mega ${entityCC}-${ccHire}`,
            job_title: "Test Engineer",
            email: `mega.${entityCC.toLowerCase()}.${ccHire.toLowerCase()}.${Date.now()}@example.com`,
          });
          employmentId = emp.id;

          // Get subscription-level products (may differ from country-level)
          const subs = await getSubscriptions(client, emp.id);
          const subsProducts = getAvailableProducts(subs);

          broadcast("mega:cell", {
            entityCountry: entityCC,
            contractorCountry: ccHire,
            employmentId,
            availableProducts: subsProducts,
            status: "products-fetched",
          });

          for (const product of productFilter) {
            if (!subsProducts.includes(product)) {
              recordResult(results, broadcast, {
                entityCountry: entityCC,
                contractorCountry: ccHire,
                product,
                employmentId,
                entityId,
                availableProducts: subsProducts,
                status: "unavailable",
                step: "subscriptions",
                duration: Date.now() - cellStart,
              });
              continue;
            }

            // Full flow — need a fresh employment per product
            // (reuse the first one only for the first product)
            let eeId = employmentId;
            if (product !== subsProducts[0]) {
              const newEmp = await createEmployment(client, {
                company_id: companySlug,
                country_code: ccHire,
                full_name: `Mega ${entityCC}-${ccHire} ${product}`,
                job_title: "Test Engineer",
                email: `mega.${entityCC.toLowerCase()}.${ccHire.toLowerCase()}.${product.toLowerCase().replace("+", "plus")}.${Date.now()}@example.com`,
              });
              eeId = newEmp.id;
            }

            try {
              await runProductFlow(client, eeId, ccHire, product, broadcast);
              recordResult(results, broadcast, {
                entityCountry: entityCC,
                contractorCountry: ccHire,
                product,
                employmentId: eeId,
                entityId,
                availableProducts: subsProducts,
                status: "success",
                step: "invited",
                duration: Date.now() - cellStart,
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              recordResult(results, broadcast, {
                entityCountry: entityCC,
                contractorCountry: ccHire,
                product,
                employmentId: eeId,
                entityId,
                availableProducts: subsProducts,
                status: "error",
                error: msg,
                duration: Date.now() - cellStart,
              });
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          for (const product of productFilter) {
            recordResult(results, broadcast, {
              entityCountry: entityCC,
              contractorCountry: ccHire,
              product,
              employmentId,
              entityId,
              availableProducts,
              status: "error",
              step: "employment",
              error: msg,
              duration: Date.now() - cellStart,
            });
          }
          broadcast("mega:cell-error", {
            entityCountry: entityCC,
            contractorCountry: ccHire,
            error: msg,
          });
        }
      });
    }

    const duration = Date.now() - startTime;
    const summary = {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      unavailable: results.filter((r) => r.status === "unavailable").length,
      error: results.filter((r) => r.status === "error").length,
      duration,
    };

    const megaResult: MegaRunResult = {
      timestamp: new Date().toISOString(),
      config,
      results,
      summary,
    };

    broadcast("mega:done", { summary });
    return megaResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcast("mega:error", { message: msg });
    throw err;
  } finally {
    activeMegaRun = false;
  }
}

// ── Per-product full flow ──

async function runProductFlow(
  client: RemoteClient,
  employmentId: string,
  countryCode: string,
  product: string,
  broadcast: BroadcastFn
): Promise<void> {
  broadcast("mega:step", { employmentId, product, step: "selecting" });

  if (product === "COR") {
    // COR: questionnaire → select COR → contract → preview → reserve
    const schema = await getQuestionnaireSchema(client);
    const answers = buildPassingAnswers(schema);
    await submitQuestionnaire(client, employmentId, answers);
    await selectCORSubscription(client, employmentId);
  } else if (product === "CM+") {
    await selectPlusSubscription(client, employmentId);
  }
  // CM: no selection needed

  broadcast("mega:step", { employmentId, product, step: "contract-details" });
  const docId = await submitContractDetails(client, employmentId, countryCode);

  broadcast("mega:step", { employmentId, product, step: "preview" });
  await previewContract(client, employmentId, docId);

  if (product === "COR") {
    broadcast("mega:step", { employmentId, product, step: "risk-reserve" });
    await createCORReserve(client, employmentId);
  } else {
    broadcast("mega:step", { employmentId, product, step: "invite" });
    await inviteContractor(client, employmentId);
  }
}
