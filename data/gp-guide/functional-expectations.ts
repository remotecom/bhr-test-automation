/**
 * What the functional (flow and error) checks expect, per guide row and step.
 *
 * Each check runs a short scenario against the sandbox (create a GP test employee, save forms,
 * invite) and observes every step: HTTP status, message, field names, and whether it was blocked.
 * A step listed here is compared:   matches -> "as_recorded",  doesn't -> "differs".
 * A step NOT listed here is new:    -> "observed", with what Remote returned, for a person to review.
 *
 * To record a behaviour after reviewing an "observed" result: add the step here, and update the
 * row's Remote Response and Status in data/gp-guide/guide.json. A check never changes a status.
 */

export interface StepExpectation {
  /** Should Remote refuse this step (any 4xx)? */
  blocked: boolean;
  /** Exact HTTP status codes accepted, when they matter */
  status?: number[];
  /** Text the error message must contain (case-insensitive) */
  message?: string;
  /** Field names the error must name; "$omitted" means the field the check left out */
  fields?: string[];
}

/**
 * Guide rows backed by a functional check. They create GP test employees and send invites, so they
 * run from their own button ("Run flow checks"), not with the quick checks.
 */
export const FUNCTIONAL_CASE_IDS = ["A9", "A10", "A11", "A12", "A13", "A14", "A15", "A16", "A17"];

/** caseId -> step key -> expectation. Step keys are defined by each check in src/gp/guide/flow.ts */
export const FUNCTIONAL_EXPECTATIONS: Record<string, Record<string, StepExpectation>> = {
  // Setup steps every scenario relies on: if these fail, the scenario can't say anything
  _setup: {
    create_employee: { blocked: false },
    contract_details: { blocked: false },
    administrative_details: { blocked: false },
  },

  // A missing required field must be refused, naming the field
  A14: { contract_missing_field: { blocked: true, status: [422], fields: ["$omitted"] } },
  // A value outside the field's options must be refused
  A15: { contract_invalid_option: { blocked: true, status: [422] } },
  // GP employees can only be engaged by a GP-enabled legal entity
  A16: { create_on_non_gp_entity: { blocked: true, message: "not associated with the Global Payroll product" } },

  // Not yet known, so deliberately not listed (first run reports "observed"):
  //   A9  invite_without_forms           A10 invite_after_contract
  //   A11 invite_after_contract_and_admin A12 invite_again
  //   A13 admin_before_contract          A17 create_with_used_email
};
