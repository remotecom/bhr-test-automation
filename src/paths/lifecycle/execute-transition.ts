/**
 * Lifecycle transition executor.
 *
 * Maps LifecycleAction → step function calls + status verification.
 * Shared engine used by the lifecycle runner for all test cases.
 */

import type { RemoteClient } from "../../client";
import type { LifecycleTransition } from "@/data/lifecycle-matrix";
import { trace } from "../../trace";
import { getEmploymentStatus, pollEmploymentStatus } from "../../steps/employment-status";
import { setSandboxEmploymentStatus, type SandboxEmploymentStatus } from "../../steps/sandbox-employment";
import { submitContractDetails, previewContract, signContract } from "../../steps/contract-details";
import { selectCORSubscription, selectPlusSubscription } from "../../steps/subscriptions";
import { getQuestionnaireSchema, buildPassingAnswers, submitQuestionnaire } from "../../steps/questionnaire";
import { inviteContractor, createCORReserve } from "../../steps/invite";
import { cancelEmployment } from "../../steps/employment";
import { terminateCOREmployment } from "../../steps/cor-termination";
import { changePlan, type PlanOperation } from "../../steps/plan-change";

export interface TransitionContext {
  client: RemoteClient;
  employmentId: string;
  companyId: string;
  countryCode: string;
  contractor: { full_name: string; job_title: string; email: string };
  legalEntityId: string;
  lifecycle: "CM" | "CM+" | "COR";
  terminationRequestId?: string;
}

export interface TransitionResult {
  actualStatus: string;
  durationMs: number;
  error?: string;
}

/**
 * Execute a single lifecycle transition.
 *
 * Dispatches the action, then verifies the employment reached expectedStatus.
 * For null actions (starting state), just reads current status.
 */
export async function executeTransition(
  transition: LifecycleTransition,
  ctx: TransitionContext
): Promise<TransitionResult> {
  const start = Date.now();
  const { client, employmentId } = ctx;

  try {
    if (transition.action === null) {
      // Starting state — just verify current status
      const emp = await getEmploymentStatus(client, employmentId);
      trace.lifecycleTransition(employmentId, transition.state, "initial", emp.status);
      return { actualStatus: emp.status, durationMs: Date.now() - start };
    }

    // Dispatch action
    await dispatchAction(transition, ctx);

    // Verify expected status
    const actualStatus = await verifyStatus(
      client,
      employmentId,
      transition.expectedStatus,
      transition.pollTimeoutSec
    );

    trace.lifecycleTransition(
      employmentId,
      transition.state,
      transition.action,
      actualStatus
    );

    return { actualStatus, durationMs: Date.now() - start };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      actualStatus: "error",
      durationMs: Date.now() - start,
      error: errMsg,
    };
  }
}

async function dispatchAction(
  transition: LifecycleTransition,
  ctx: TransitionContext
): Promise<void> {
  const { client, employmentId, countryCode, contractor } = ctx;
  const params = transition.actionParams || {};

  switch (transition.action) {
    case "submit_contract": {
      // Compound: submit → preview → sign (CM/CM+ only, COR skips sign)
      const docId = await submitContractDetails(client, employmentId, countryCode);
      await previewContract(client, employmentId, docId);
      if (ctx.lifecycle !== "COR") {
        await signContract(client, employmentId, docId, contractor.full_name);
      }
      break;
    }

    case "select_subscription": {
      const product = params.product as string;
      if (product === "COR") {
        // COR requires questionnaire completion before subscription (422 otherwise)
        const schema = await getQuestionnaireSchema(client, employmentId);
        const answers = buildPassingAnswers(schema);
        await submitQuestionnaire(client, employmentId, answers);
        await selectCORSubscription(client, employmentId);
      } else {
        // CM+ uses the plus subscription endpoint
        await selectPlusSubscription(client, employmentId);
      }
      break;
    }

    case "invite":
      if (ctx.lifecycle === "COR") {
        await createCORReserve(client, employmentId);
      } else {
        await inviteContractor(client, employmentId);
      }
      break;

    case "create_reserve":
      await createCORReserve(client, employmentId);
      break;

    case "pay_reserve":
      // Use sandbox PUT to simulate reserve payment
      await setSandboxEmploymentStatus(client, employmentId, "created_reserve_paid");
      break;

    case "sandbox_set": {
      const status = params.status as SandboxEmploymentStatus;
      await setSandboxEmploymentStatus(client, employmentId, status);
      break;
    }

    case "terminate_cor": {
      const result = await terminateCOREmployment(client, employmentId);
      ctx.terminationRequestId = result.termination_request_id;
      break;
    }

    case "upgrade_plan": {
      const operation = params.operation as PlanOperation;
      await changePlan(client, employmentId, operation);
      break;
    }

    case "cancel_onboarding":
      await cancelEmployment(client, employmentId);
      break;

    default:
      throw new Error(`Unknown lifecycle action: ${transition.action}`);
  }
}

async function verifyStatus(
  client: RemoteClient,
  employmentId: string,
  expectedStatus: string,
  pollTimeoutSec?: number
): Promise<string> {
  // For 404 (cancelled employment), poll until it's gone (async in sandbox)
  if (expectedStatus === "404") {
    const timeout = pollTimeoutSec || 15;
    return (await pollEmploymentStatus(client, employmentId, "404", timeout)).status;
  }

  // If polling timeout is set, use polling
  if (pollTimeoutSec) {
    const emp = await pollEmploymentStatus(client, employmentId, expectedStatus, pollTimeoutSec);
    return emp.status;
  }

  // Small delay to let sandbox settle, then single check
  await new Promise((r) => setTimeout(r, 1000));
  const emp = await getEmploymentStatus(client, employmentId);
  return emp.status;
}
