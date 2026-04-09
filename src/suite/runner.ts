/**
 * In-process test suite runner (v2).
 *
 * Replaces the vitest subprocess approach so tests can run on Vercel.
 * Iterates the test matrix, calls path functions directly (same ones
 * the Playground uses), compares results, and streams SSE events.
 *
 * The frontend (hooks/useSuite.ts) is unchanged — same event contract.
 */

import { createClientFromEnv, type RemoteClient } from "../client";
import { TEST_MATRIX, type TestCase } from "@/data/test-matrix";
import { swapDefaultEntity } from "../setup/entity-swap";
import { runCMPath } from "../paths/cm";
import { runCMPlusPath } from "../paths/cm-plus";
import { runCORPath } from "../paths/cor";
import { runCORIR35Path } from "../paths/cor-ir35";
import { runEORFallbackPath } from "../paths/eor-fallback";
import { getCountries, findCountry, getCountryProducts } from "../steps/countries";
import { cancelEmployment } from "../steps/employment";
import { compareTestResult } from "./compare";
import type { IR35Status } from "../steps/ir35";
import type { NationalityStatus } from "../steps/nationality";

// Contractor fixtures
import PRT from "@/data/PRT.json";
import GBR from "@/data/GBR.json";
import DEU from "@/data/DEU.json";
import USA from "@/data/USA.json";
import IND from "@/data/IND.json";
import BHR from "@/data/BHR.json";

type BroadcastFn = (event: string, data: unknown) => void;

const CONTRACTORS: Record<string, { contractor: { full_name: string; job_title: string; email: string } }> = {
  PRT, GBR, DEU, USA, IND, BHR,
};

const SANCTIONED_CODES = ["IRN", "CUB", "PRK", "SYR"];

export interface RunSuiteOptions {
  testFilter?: string;
  signal?: AbortSignal;
}

export async function runSuite(
  broadcast: BroadcastFn,
  options?: RunSuiteOptions
): Promise<void> {
  const companySlug = process.env.COMPANY_SLUG;
  if (!companySlug) {
    throw new Error("COMPANY_SLUG env var required");
  }

  const client = createClientFromEnv();

  // Filter test matrix: remove section headers, apply optional filter
  let tests = TEST_MATRIX.filter(
    (tc): tc is TestCase & { id: string } => !!tc.id
  );

  if (options?.testFilter) {
    const filter = options.testFilter;
    tests = tests.filter((tc) => tc.id === filter);
  }

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // suite:start
  broadcast("suite:start", { time: startTime });

  // suite:collected
  broadcast("suite:collected", {
    total: tests.length,
    files: 1,
    tests: tests.map((tc) => ({ testId: tc.id, name: tc.id })),
  });

  // Run tests top-to-bottom as they appear in the matrix.
  // Swap entity only when the entity country changes from the previous test.
  let currentEntity: string | null = null;
  let entityId: string | undefined;

  for (const tc of tests) {
    if (options?.signal?.aborted) break;

    const testStart = Date.now();
    let employmentId: string | undefined;

    try {
      if (tc.path === "Read-only") {
        // Read-only tests: no employment, just check countries
        await runReadOnlyTest(client, tc, broadcast);
        passed++;
        broadcast("test:result", {
          name: tc.id,
          testId: tc.id,
          state: "pass",
          duration: Date.now() - testStart,
          error: null,
        });
        continue;
      }

      // Swap entity if needed (only when entity country changes)
      const entityCode = tc.entity || "GBR";
      if (entityCode !== currentEntity) {
        const entity = await swapDefaultEntity(client, companySlug, entityCode);
        entityId = entity.legal_entity_id || (entity as Record<string, unknown>).id as string;
        currentEntity = entityCode;
        broadcast("entity:swap", { countryCode: entityCode, entityId });
        // Small delay after swap to let sandbox settle
        await new Promise((r) => setTimeout(r, 500));
      }

      // Resolve contractor data
      const hireCountry = tc.hire || "PRT";
      const fixture = CONTRACTORS[hireCountry];
      if (!fixture) {
        throw new Error(`No contractor fixture for country: ${hireCountry}`);
      }

      // Unique email per test run
      const contractor = {
        ...fixture.contractor,
        email: `${tc.id.toLowerCase().replace(/[^a-z0-9]/g, "")}.run${Date.now()}@example.com`,
      };

      if (!entityId) {
        throw new Error("No entity ID available");
      }

      // Dispatch to path function
      const result = await dispatchPathFunction(client, tc, {
        companyId: companySlug,
        countryCode: hireCountry,
        contractor,
        legalEntityId: entityId,
      });

      employmentId = result.employmentId;

      // Emit intermediate events for frontend
      emitIntermediateEvents(broadcast, tc, result);

      // Compare results
      if (tc.expected) {
        const comparison = compareTestResult(
          {
            eligibility: result.eligibility,
            availableProducts: result.availableProducts,
            countryProducts: result.countryProducts,
            questionnaireResult: result.questionnaireResult,
          },
          tc.expected,
          hireCountry
        );

        if (comparison.passed) {
          passed++;
          broadcast("test:result", {
            name: tc.id,
            testId: tc.id,
            state: "pass",
            duration: Date.now() - testStart,
            error: null,
          });
        } else {
          failed++;
          broadcast("test:result", {
            name: tc.id,
            testId: tc.id,
            state: "fail",
            duration: Date.now() - testStart,
            error: comparison.errors.join("; "),
          });
        }
      } else {
        // No expected values — just check it ran without error
        passed++;
        broadcast("test:result", {
          name: tc.id,
          testId: tc.id,
          state: "pass",
          duration: Date.now() - testStart,
          error: null,
        });
      }
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      broadcast("test:result", {
        name: tc.id,
        testId: tc.id,
        state: "fail",
        duration: Date.now() - testStart,
        error: errMsg,
      });
    } finally {
      // Cleanup: cancel employment if one was created
      if (employmentId) {
        try {
          await cancelEmployment(client, employmentId);
        } catch {
          // Non-critical — best-effort cleanup
        }
      }
    }
  }

  // suite:end
  broadcast("suite:end", {
    passed,
    failed,
    skipped,
    duration: Date.now() - startTime,
  });

  // suite:process-done
  broadcast("suite:process-done", { exitCode: failed > 0 ? 1 : 0 });
}

// ─── Path dispatch ───────────────────────────────────────────────

interface PathInput {
  companyId: string;
  countryCode: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
}

interface PathResult {
  employmentId?: string;
  eligibility?: { standard: boolean; plus: boolean; cor: boolean; cor_supported_country_codes?: string[] };
  availableProducts?: string[];
  countryProducts?: string[];
  questionnaireResult?: { is_blocking?: boolean } | null;
  ir35Status?: string;
  country?: { code: string; contractor_products_available?: string[] };
}

async function dispatchPathFunction(
  client: RemoteClient,
  tc: TestCase & { id: string },
  input: PathInput
): Promise<PathResult> {
  const { companyId, countryCode, contractor, legalEntityId } = input;
  const path = tc.path || "CM";

  switch (path) {
    case "CM": {
      const r = await runCMPath({
        client,
        companyId,
        countryCode,
        contractor,
        legalEntityId,
        ir35Status: tc.ir35 ? (tc.ir35 as IR35Status) : undefined,
        nationalityStatus: tc.nationality ? (tc.nationality as NationalityStatus) : undefined,
      });
      return {
        employmentId: r.employment.id,
        eligibility: r.eligibility,
        availableProducts: r.availableProducts,
        countryProducts: r.country ? getCountryProducts(r.country) : undefined,
        country: r.country,
      };
    }

    case "CM+": {
      const r = await runCMPlusPath({
        client,
        companyId,
        countryCode,
        contractor,
        legalEntityId,
      });
      return {
        employmentId: r.employment.id,
        eligibility: r.eligibility,
        availableProducts: r.availableProducts,
        countryProducts: r.country ? getCountryProducts(r.country) : undefined,
        country: r.country,
      };
    }

    case "COR": {
      const r = await runCORPath({
        client,
        companyId,
        countryCode,
        contractor,
        legalEntityId,
      });
      return {
        employmentId: r.employment.id,
        eligibility: r.eligibility,
        availableProducts: r.availableProducts,
        countryProducts: r.country ? getCountryProducts(r.country) : undefined,
        questionnaireResult: r.questionnaireResult,
        country: r.country,
      };
    }

    case "COR+IR35": {
      const r = await runCORIR35Path({
        client,
        companyId,
        contractor,
        legalEntityId,
        ir35Status: (tc.ir35 || "outside") as IR35Status,
      });
      return {
        employmentId: r.employment.id,
        eligibility: r.eligibility,
        availableProducts: r.availableProducts,
        countryProducts: r.country ? getCountryProducts(r.country) : undefined,
        questionnaireResult: r.questionnaireResult,
        ir35Status: r.ir35Status,
        country: r.country,
      };
    }

    case "EOR": {
      const r = await runEORFallbackPath({
        client,
        companyId,
        countryCode,
        contractor,
        legalEntityId,
        blockViaQuestionnaire: tc.blockQuestionnaire,
      });
      return {
        employmentId: r.employment.id,
        eligibility: r.eligibility,
        availableProducts: r.availableProducts,
        countryProducts: r.country ? getCountryProducts(r.country) : undefined,
        questionnaireResult: r.questionnaireResult,
        country: r.country,
      };
    }

    default:
      throw new Error(`Unknown path: ${path}`);
  }
}

// ─── Intermediate SSE events ─────────────────────────────────────

function emitIntermediateEvents(
  broadcast: BroadcastFn,
  tc: TestCase & { id: string },
  result: PathResult
): void {
  if (result.employmentId) {
    broadcast("employment", {
      id: result.employmentId,
      countryCode: tc.hire,
      email: `${tc.id}.run@example.com`,
    });
  }

  if (result.eligibility) {
    broadcast("eligibility:result", {
      legalEntityId: undefined,
      standard: result.eligibility.standard,
      plus: result.eligibility.plus,
      cor: result.eligibility.cor,
      cor_supported_country_codes: result.eligibility.cor_supported_country_codes || [],
    });
  }

  if (result.countryProducts) {
    broadcast("country:eligibility", {
      countryCode: tc.hire,
      products: result.countryProducts,
    });
  }

  if (result.availableProducts) {
    broadcast("subscriptions", {
      employmentId: result.employmentId,
      products: result.availableProducts,
    });
  }

  if (result.ir35Status) {
    broadcast("ir35:status", {
      employmentId: result.employmentId,
      status: result.ir35Status,
    });
  }

  if (result.questionnaireResult) {
    broadcast("questionnaire:result", {
      employmentId: result.employmentId,
      isBlocking: result.questionnaireResult.is_blocking ?? false,
    });
  }
}

// ─── Read-only tests ─────────────────────────────────────────────

async function runReadOnlyTest(
  client: RemoteClient,
  tc: TestCase & { id: string },
  broadcast: BroadcastFn
): Promise<void> {
  const countries = await getCountries(client);

  if (tc.id === "B1") {
    // Check sanctioned countries are absent
    const found = countries.filter((c) =>
      SANCTIONED_CODES.includes(c.code)
    );
    if (found.length > 0) {
      throw new Error(
        `Sanctioned countries found in list: ${found.map((c) => c.code).join(", ")}`
      );
    }
  } else if (tc.id === "B8") {
    // Check countries have required fields and PRT has products
    const prt = findCountry(countries, "PRT");
    if (!prt) {
      throw new Error("PRT not found in countries list");
    }
    const products = getCountryProducts(prt);
    if (products.length === 0) {
      throw new Error("PRT has no contractor products available");
    }
    // Verify all countries have basic fields
    for (const c of countries.slice(0, 10)) {
      if (!c.code || !c.name) {
        throw new Error(`Country missing required fields: ${JSON.stringify(c)}`);
      }
    }
  }

  broadcast("country:eligibility", {
    countryCode: "ALL",
    products: ["read-only check passed"],
  });
}
