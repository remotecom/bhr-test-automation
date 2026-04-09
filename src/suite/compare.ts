/**
 * Result comparison for in-process test runner.
 *
 * Compares actual path function results against expected values
 * from the test matrix. Returns pass/fail with error details.
 */

import type { TestExpected } from "@/data/test-matrix";

export interface CompareResult {
  passed: boolean;
  errors: string[];
}

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function compareTestResult(
  actual: {
    eligibility?: { standard: boolean; plus: boolean; cor: boolean; cor_supported_country_codes?: string[] };
    availableProducts?: string[];
    countryProducts?: string[];
    questionnaireResult?: { is_blocking?: boolean } | null;
  },
  expected: TestExpected,
  hireCountry: string
): CompareResult {
  const errors: string[] = [];

  // Eligibility check
  if (expected.eligibility && actual.eligibility) {
    const e = expected.eligibility;
    const a = actual.eligibility;
    if (a.standard !== e.standard) {
      errors.push(`eligibility.standard: expected ${e.standard}, got ${a.standard}`);
    }
    if (a.plus !== e.plus) {
      errors.push(`eligibility.plus: expected ${e.plus}, got ${a.plus}`);
    }
    // COR: derive from cor_supported_country_codes, not the raw cor boolean
    const corCodes = (a.cor_supported_country_codes || []).map(c => c.toUpperCase());
    const actualCor = corCodes.includes(hireCountry.toUpperCase());
    if (actualCor !== e.cor) {
      errors.push(`eligibility.cor: expected ${e.cor}, got ${actualCor} (cor_supported_country_codes: [${corCodes.join(", ")}])`);
    }
  } else if (expected.eligibility && !actual.eligibility) {
    errors.push("eligibility: expected result but got none");
  }

  // Subscriptions check (null means skip)
  if (expected.subs !== undefined && expected.subs !== null) {
    const actualSubs = actual.availableProducts || [];
    if (!sortedEqual(actualSubs, expected.subs)) {
      errors.push(
        `subs: expected [${[...expected.subs].sort().join(", ")}], got [${[...actualSubs].sort().join(", ")}]`
      );
    }
  }

  // Country products check (null means skip)
  if (expected.country !== undefined && expected.country !== null) {
    const actualCountry = actual.countryProducts || [];
    if (!sortedEqual(actualCountry, expected.country)) {
      errors.push(
        `country: expected [${[...expected.country].sort().join(", ")}], got [${[...actualCountry].sort().join(", ")}]`
      );
    }
  }

  // Questionnaire check (null means skip)
  if (expected.questionnaire !== undefined && expected.questionnaire !== null) {
    if (actual.questionnaireResult) {
      const expectedBlocking = expected.questionnaire.isBlocking;
      const actualBlocking = actual.questionnaireResult.is_blocking;
      if (actualBlocking !== expectedBlocking) {
        errors.push(
          `questionnaire.isBlocking: expected ${expectedBlocking}, got ${actualBlocking}`
        );
      }
    } else {
      errors.push("questionnaire: expected result but got none");
    }
  }

  return { passed: errors.length === 0, errors };
}
