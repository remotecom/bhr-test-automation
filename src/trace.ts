/**
 * Live trace logger for test runs.
 *
 * Writes directly to process.stderr.write() to bypass Vitest's console capture.
 * Also emits events to the dashboard SSE server (fire-and-forget).
 */

import { emit } from "./dashboard/emit";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function write(msg: string) {
  process.stderr.write(msg + "\n");
}

export const trace = {
  employment(id: string, countryCode: string, email: string) {
    write(
      `  ${CYAN}→ Employment${RESET}  ${DIM}id=${RESET}${id}  ${DIM}country=${RESET}${countryCode}  ${DIM}email=${RESET}${email}`
    );
    emit("employment", { id, countryCode, email });
  },

  entitySwap(countryCode: string, entityId: string) {
    write(
      `  ${YELLOW}⟳ Entity swap${RESET}  ${DIM}country=${RESET}${countryCode}  ${DIM}entity=${RESET}${entityId}`
    );
    emit("entity:swap", { countryCode, entityId });
  },

  entityCreated(countryCode: string, entityId: string, name: string) {
    write(
      `  ${GREEN}+ Entity created${RESET}  ${DIM}country=${RESET}${countryCode}  ${DIM}id=${RESET}${entityId}  ${DIM}name=${RESET}${name}`
    );
    emit("entity:created", { countryCode, entityId, name });
  },

  subscriptions(employmentId: string, products: string[]) {
    write(
      `  ${DIM}  Products: [${products.join(", ")}]  ${RESET}${DIM}ee=${employmentId}${RESET}`
    );
    emit("subscriptions", { employmentId, products });
  },

  step(label: string) {
    write(`  ${DIM}  ${label}${RESET}`);
    emit("step", { label });
  },

  countryEligibility(countryCode: string, products: string[]) {
    write(
      `  ${DIM}  Country eligibility: [${products.join(", ")}]  country=${countryCode}${RESET}`
    );
    emit("country:eligibility", { countryCode, products });
  },

  questionnaireResult(employmentId: string, isBlocking: boolean) {
    write(
      `  ${DIM}  Questionnaire: ${isBlocking ? "BLOCKING" : "non-blocking"}  ee=${employmentId}${RESET}`
    );
    emit("questionnaire:result", { employmentId, isBlocking });
  },

  ir35Status(employmentId: string, status: string) {
    write(
      `  ${DIM}  IR35: ${status}  ee=${employmentId}${RESET}`
    );
    emit("ir35:status", { employmentId, status });
  },

  nationality(employmentId: string, status: string) {
    write(
      `  ${DIM}  Nationality: ${status}  ee=${employmentId}${RESET}`
    );
    emit("nationality:status", { employmentId, status });
  },

  subscriptionSelected(employmentId: string, product: string) {
    write(
      `  ${GREEN}✓ Subscription${RESET}  ${DIM}product=${RESET}${product}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("subscription:selected", { employmentId, product });
  },

  contractDetails(employmentId: string, status: string) {
    write(
      `  ${DIM}  Contract details: ${status}  ee=${employmentId}${RESET}`
    );
    emit("contract-details:status", { employmentId, status });
  },

  contractSigned(employmentId: string) {
    write(
      `  ${GREEN}✓ Contract signed${RESET}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("contract:signed", { employmentId });
  },

  invite(employmentId: string, type?: string) {
    write(
      `  ${GREEN}✓ Invite${RESET}  ${DIM}type=${RESET}${type || "standard"}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("invite:sent", { employmentId, type: type || "standard" });
  },

  eligibility(legalEntityId: string, result: { standard: boolean; plus: boolean; cor: boolean; cor_supported_country_codes?: string[] }) {
    const products = [
      result.standard && "CM",
      result.plus && "CM+",
      result.cor && "COR",
    ].filter(Boolean);
    write(
      `  ${DIM}  Eligibility: [${products.join(", ")}]  entity=${legalEntityId}${RESET}`
    );
    emit("eligibility:result", { legalEntityId, ...result });
  },

  // ── Lifecycle trace methods ─────────────────────────────────

  lifecycleStatus(employmentId: string, status: string) {
    write(
      `  ${DIM}  Status: ${status}  ee=${employmentId}${RESET}`
    );
    emit("lifecycle:status", { employmentId, status });
  },

  lifecycleSandboxSet(employmentId: string, status: string) {
    write(
      `  ${YELLOW}⟳ Sandbox set${RESET}  ${DIM}status=${RESET}${status}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("lifecycle:sandbox-set", { employmentId, status });
  },

  lifecycleTransition(employmentId: string, step: string, action: string, actualStatus: string) {
    write(
      `  ${CYAN}→ Transition${RESET}  ${DIM}step=${RESET}${step}  ${DIM}action=${RESET}${action}  ${DIM}status=${RESET}${actualStatus}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("lifecycle:transition-trace", { employmentId, step, action, actualStatus });
  },

  lifecycleTermination(employmentId: string, terminationRequestId: string) {
    write(
      `  ${YELLOW}✕ COR Termination${RESET}  ${DIM}request=${RESET}${terminationRequestId}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("lifecycle:termination", { employmentId, terminationRequestId });
  },

  lifecyclePlanChange(employmentId: string, operation: string) {
    write(
      `  ${GREEN}↕ Plan change${RESET}  ${DIM}op=${RESET}${operation}  ${DIM}ee=${RESET}${employmentId}`
    );
    emit("lifecycle:plan-change", { employmentId, operation });
  },

  lifecycleWebhook(eventType: string, employmentId: string) {
    write(
      `  ${DIM}  Webhook: ${eventType}  ee=${employmentId}${RESET}`
    );
    emit("lifecycle:webhook", { eventType, employmentId });
  },
};
