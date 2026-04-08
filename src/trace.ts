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
};
