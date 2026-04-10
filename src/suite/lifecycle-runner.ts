/**
 * Lifecycle test suite runner.
 *
 * Mirrors runner.ts for onboarding tests. Iterates the lifecycle matrix,
 * creates employments, walks transition chains, and streams SSE events.
 */

import { createClientFromEnv, createClientFromToken, getCompanySlug, type RemoteClient } from "../client";
import { LIFECYCLE_MATRIX, type LifecycleTestCase, type LifecycleTransition } from "@/data/lifecycle-matrix";
import { swapDefaultEntity } from "../setup/entity-swap";
import { createEmployment } from "../steps/employment";
import { setSandboxEmploymentStatus } from "../steps/sandbox-employment";
import { setIR35Status, type IR35Status } from "../steps/ir35";
import { setNationality, NATIONALITY_COUNTRIES } from "../steps/nationality";
import { executeTransition, type TransitionContext } from "../paths/lifecycle/execute-transition";
import { startCapture, assertWebhooks, isWebhookCaptureAvailable } from "../webhooks/capture";

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

export interface RunLifecycleOptions {
  testFilter?: string;
  signal?: AbortSignal;
  companySlug?: string;
  refreshToken?: string;
  gatewayEnv?: string;
}

export async function runLifecycleSuite(
  broadcast: BroadcastFn,
  options?: RunLifecycleOptions
): Promise<void> {
  const companySlug = options?.companySlug || getCompanySlug(options?.gatewayEnv);
  if (!companySlug) {
    throw new Error("COMPANY_SLUG env var required");
  }

  const client = options?.refreshToken
    ? createClientFromToken(options.refreshToken, options?.gatewayEnv)
    : createClientFromEnv(options?.gatewayEnv);

  // Filter: remove section headers, apply optional test filter
  let tests = LIFECYCLE_MATRIX.filter(
    (tc): tc is LifecycleTestCase & { id: string; transitions: LifecycleTransition[] } =>
      !!tc.id && !!tc.transitions
  );

  if (options?.testFilter) {
    const filter = options.testFilter;
    tests = tests.filter((tc) => tc.id === filter);
  }

  const startTime = Date.now();
  const runId = `lifecycle-${Date.now()}`;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const webhooksAvailable = isWebhookCaptureAvailable();
  if (webhooksAvailable) {
    startCapture(runId);
  }

  broadcast("lifecycle:start", { time: startTime, runId, webhooksAvailable });

  broadcast("lifecycle:collected", {
    total: tests.length,
    tests: tests.map((tc) => ({ testId: tc.id, name: tc.id })),
  });

  // Entity swapping — same pattern as onboarding runner
  let currentEntity: string | null = null;
  let entityId: string | undefined;

  for (const tc of tests) {
    if (options?.signal?.aborted) break;

    const testStart = Date.now();
    let employmentId: string | undefined;

    try {
      // Swap entity if needed
      const entityCode = tc.entity || "GBR";
      if (entityCode !== currentEntity) {
        const entity = await swapDefaultEntity(client, companySlug, entityCode);
        entityId = entity.legal_entity_id || (entity as Record<string, unknown>).id as string;
        currentEntity = entityCode;
        broadcast("entity:swap", { countryCode: entityCode, entityId });
        await new Promise((r) => setTimeout(r, 500));
      }

      // Resolve contractor fixture
      const hireCountry = tc.hire || "PRT";
      const fixture = CONTRACTORS[hireCountry];
      if (!fixture) throw new Error(`No contractor fixture for country: ${hireCountry}`);

      const contractor = {
        ...fixture.contractor,
        email: `${tc.id.toLowerCase().replace(/[^a-z0-9]/g, "")}.lc${Date.now()}@example.com`,
      };

      if (!entityId) throw new Error("No entity ID available");

      // Create employment
      const employment = await createEmployment(client, {
        company_id: companySlug,
        country_code: hireCountry,
        ...contractor,
      });
      employmentId = employment.id;

      broadcast("employment", {
        id: employmentId,
        countryCode: hireCountry,
        email: contractor.email,
      });

      // Setup: IR35 if needed (before transitions)
      if (tc.ir35) {
        await setIR35Status(client, employmentId, tc.ir35 as IR35Status);
      }

      // Setup: nationality if needed
      if (tc.nationality && NATIONALITY_COUNTRIES.includes(hireCountry)) {
        await setNationality(client, employmentId, tc.nationality as "national" | "non_national");
      }

      // Walk transition chain
      const ctx: TransitionContext = {
        client,
        employmentId,
        companyId: companySlug,
        countryCode: hireCountry,
        contractor,
        legalEntityId: entityId,
        lifecycle: tc.lifecycle!,
      };

      let allTransitionsPassed = true;
      const transitionResults: Array<{
        step: string;
        action: string | null;
        expectedStatus: string;
        actualStatus: string;
        durationMs: number;
        passed: boolean;
        error?: string;
      }> = [];

      for (let i = 0; i < tc.transitions.length; i++) {
        if (options?.signal?.aborted) break;

        const transition = tc.transitions[i];

        broadcast("lifecycle:transition", {
          testId: tc.id,
          step: transition.state,
          action: transition.action,
          index: i,
          total: tc.transitions.length,
          status: "running",
        });

        const result = await executeTransition(transition, ctx);

        const stepPassed =
          !result.error && result.actualStatus === transition.expectedStatus;

        transitionResults.push({
          step: transition.state,
          action: transition.action,
          expectedStatus: transition.expectedStatus,
          actualStatus: result.actualStatus,
          durationMs: result.durationMs,
          passed: stepPassed,
          error: result.error,
        });

        broadcast("lifecycle:transition", {
          testId: tc.id,
          step: transition.state,
          action: transition.action,
          index: i,
          total: tc.transitions.length,
          expectedStatus: transition.expectedStatus,
          actualStatus: result.actualStatus,
          durationMs: result.durationMs,
          status: stepPassed ? "pass" : "fail",
          error: result.error,
        });

        if (!stepPassed) {
          allTransitionsPassed = false;
          break; // Stop chain on first failure
        }
      }

      // Webhook assertions (if available and test has expected webhooks)
      let webhookResult: { passed: boolean; missing: string[]; extra: string[]; received: string[] } | null = null;
      if (webhooksAvailable) {
        const allExpectedWebhooks = tc.transitions
          .flatMap((t) => t.expectedWebhooks || []);

        if (allExpectedWebhooks.length > 0 && employmentId) {
          webhookResult = await assertWebhooks(
            runId,
            employmentId,
            allExpectedWebhooks,
            20
          );

          broadcast("lifecycle:webhook", {
            testId: tc.id,
            employmentId,
            expected: allExpectedWebhooks,
            received: webhookResult.received,
            missing: webhookResult.missing,
            extra: webhookResult.extra,
            passed: webhookResult.passed,
          });
        }
      }

      // Overall test result
      const testPassed = allTransitionsPassed && (webhookResult?.passed !== false);

      if (testPassed) {
        passed++;
        broadcast("test:result", {
          name: tc.id,
          testId: tc.id,
          state: "pass",
          duration: Date.now() - testStart,
          error: null,
          transitions: transitionResults,
        });
      } else {
        failed++;
        const errors: string[] = [];
        for (const tr of transitionResults) {
          if (!tr.passed) {
            errors.push(
              tr.error ||
                `${tr.step}: expected "${tr.expectedStatus}" got "${tr.actualStatus}"`
            );
          }
        }
        if (webhookResult && !webhookResult.passed) {
          errors.push(`Webhooks missing: ${webhookResult.missing.join(", ")}`);
        }
        broadcast("test:result", {
          name: tc.id,
          testId: tc.id,
          state: "fail",
          duration: Date.now() - testStart,
          error: errors.join("; "),
          transitions: transitionResults,
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
      // Cleanup: try sandbox delete, fall back to cancel
      if (employmentId) {
        try {
          await setSandboxEmploymentStatus(client, employmentId, "deleted");
        } catch {
          // Non-critical
        }
      }
    }
  }

  broadcast("lifecycle:end", {
    passed,
    failed,
    skipped,
    duration: Date.now() - startTime,
  });

  broadcast("lifecycle:process-done", { exitCode: failed > 0 ? 1 : 0 });
}
