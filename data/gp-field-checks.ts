/**
 * Skipped-field checks already settled outside this app.
 *
 * Shown in the Payroll tab until a live check replaces them. Add an entry when a
 * check is run elsewhere (e.g. the GP SDK harness) and the result is documented.
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
    sentFields: [],
    httpStatus: 200,
    employmentId: "15c7e409-2916-40d2-9eb0-095ce5e68239",
    checkedAt: "2026-09-30T17:23:19.317Z",
    source: "recorded",
    sourceNote:
      "GP SDK harness, partners sandbox: PUT /v2/employments/{id}/administrative-details returned 200 " +
      "with no field injection (FINDINGS.md, 30 Sep 2026)",
  },
];
