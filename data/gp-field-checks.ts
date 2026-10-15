/**
 * Skipped-field checks already settled, shown to everyone.
 *
 * Shown in the Payroll tab until a live check replaces them. Add an entry when a check
 * (in this app or elsewhere, e.g. the GP SDK harness) has a result worth keeping.
 */

import type { FieldCheckResult } from "../src/gp/types";

export const RECORDED_FIELD_CHECKS: FieldCheckResult[] = [
  {
    countryCode: "GBR",
    form: "administrative_details",
    skippedFields: ["tax_code", "wm_indicator"],
    outcome: "not_enforced",
    enforcedFields: [],
    otherRejected: [],
    sentFields: ["country_of_citizenship", "worker_status", "is_veteran", "employee_freeport", "employee_director", "is_foreign_national", "tax_code_position", "p_11_d_benefits_received", "company_car_provided", "private_medical_insurance", "expense_claims_enabled", "employment_type", "apprentice", "under_21", "timesheet_required", "clock_in_required"],
    httpStatus: 200,
    employmentId: "34d71ac0-7dd8-4f28-960b-a329a707d375",
    checkedAt: "2026-10-15T18:15:31Z",
    source: "recorded",
    sourceNote:
      "Payroll tab skipped-field check, partners sandbox: PUT /v2/employments/{id}/administrative-details " +
      "returned 200 without the skipped fields (employment updated_at 2026-10-15T18:15:31)" +
      ". Same result as the GP SDK harness on 30 Sep 2026 (employment 15c7e409-2916-40d2-9eb0-095ce5e68239, FINDINGS.md)",
  },
  {
    countryCode: "MEX",
    form: "administrative_details",
    skippedFields: ["has_imss_movement", "integrated_daily_wage"],
    outcome: "not_enforced",
    enforcedFields: [],
    otherRejected: [],
    sentFields: ["birthplace", "curp", "marital_status", "rfc", "ssn", "has_infonavit_credit", "has_credit_deduction", "fiscal_zip_code", "has_pension_deduction", "worker_type_imss"],
    httpStatus: 200,
    employmentId: "c7b6d1bd-ea0c-4a32-8857-d685278b34da",
    checkedAt: "2026-10-15T18:15:37Z",
    source: "recorded",
    sourceNote:
      "Payroll tab skipped-field check, partners sandbox: PUT /v2/employments/{id}/administrative-details " +
      "returned 200 without the skipped fields (employment updated_at 2026-10-15T18:15:37)",
  },
  {
    countryCode: "SWE",
    form: "administrative_details",
    skippedFields: ["se_pension_employee_contribution_rate"],
    outcome: "not_enforced",
    enforcedFields: [],
    otherRejected: [],
    sentFields: ["country_of_citizenship", "ssn", "id_number", "has_special_tax_treatment", "company_car_provided"],
    httpStatus: 200,
    employmentId: "55393b70-8dbf-42a4-9e25-c8ac95a4cc4d",
    checkedAt: "2026-10-15T18:15:41Z",
    source: "recorded",
    sourceNote:
      "Payroll tab skipped-field check, partners sandbox: PUT /v2/employments/{id}/administrative-details " +
      "returned 200 without the skipped fields (employment updated_at 2026-10-15T18:15:41)",
  },
  {
    countryCode: "CAN",
    form: "administrative_details",
    skippedFields: ["qpip_exempt"],
    outcome: "not_enforced",
    enforcedFields: [],
    otherRejected: [],
    sentFields: ["is_rehire", "union_code", "occupation_group", "pay_group", "sin", "has_ssn", "citizenship", "language", "marital_status", "dependents", "cpp_qpp_exempt", "ei_exempt", "fed_prov_tax_exempt", "wcb_wsib_cnesst_exempt", "manitoba_het_exempt", "quebec_qhsf_exempt", "status_indian", "employer_offered_dental_benefits"],
    httpStatus: 200,
    employmentId: "3d10c2fa-6dee-4bdf-a2b9-0e76c32d6fef",
    checkedAt: "2026-10-15T18:17:06Z",
    source: "recorded",
    sourceNote:
      "Payroll tab skipped-field check, partners sandbox: PUT /v2/employments/{id}/administrative-details " +
      "returned 200 without the skipped fields (employment updated_at 2026-10-15T18:17:06)" +
      ". QPIP applies only in Quebec; this test employee has no province yet (contract details not submitted), so a Quebec employee may differ",
  },
];
