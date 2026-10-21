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
 * run from their own button ("Run flow checks"), not with the quick checks. Listed in run order: A15
 * before A14, so A14 can reuse the employee whose save A15 had refused (see flow.ts).
 */
export const FUNCTIONAL_CASE_IDS = ["A9", "A10", "A11", "A12", "A13", "A15", "A14", "A16", "A17", "A18"];

/** caseId -> step key -> expectation. Step keys are defined by each check in src/gp/guide/flow.ts */
export const FUNCTIONAL_EXPECTATIONS: Record<string, Record<string, StepExpectation>> = {
  // Setup steps every scenario relies on: if these fail, the scenario can't say anything
  _setup: {
    create_employee: { blocked: false },
    contract_details: { blocked: false },
    administrative_details: { blocked: false },
  },

  // Recorded from the runs on 21 Oct (GBR, partners sandbox)

  // No invite until contract details are saved
  A9: { invite_without_forms: { blocked: true, status: [409], message: "missing contract details" } },
  // Contract details alone unlock the invite; administrative details are an employee step
  A10: { invite_after_contract: { blocked: false } },
  A11: { invite_after_contract_and_admin: { blocked: false } },
  // A repeated invite is accepted, as a resend
  A12: { invite_first: { blocked: false }, invite_again: { blocked: false } },
  // The employer forms can be saved in either order
  A13: { admin_before_contract: { blocked: false } },
  // Not refused: a missing wage_type is stored as "salary" (the backend's default) and the invite goes through
  A14: { contract_missing_field: { blocked: false }, invite_after_incomplete_contract: { blocked: false } },
  // A value outside the field's options is refused, naming the field
  A15: { contract_invalid_option: { blocked: true, status: [422], fields: ["$omitted"] } },
  // GP employees can only be engaged by a GP-enabled legal entity
  A16: { create_on_non_gp_entity: { blocked: true, status: [422], message: "Global Payroll is not enabled on given legal entity" } },
  // Not refused: email isn't unique across GP employments (Remote links same-email profiles instead)
  A17: { create_with_used_email: { blocked: false } },
  // The invite is refused when the start date is less than 2 working days away (seen 30 Sep in the GP SDK harness)
  A18: { invite_near_start_date: { blocked: true, status: [409], message: "at least 2 working days" } },
};
