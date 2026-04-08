/**
 * Product assertion helpers.
 * "assert exactly these products present/absent"
 */

import { expect } from "vitest";

/** Assert that exactly the expected products are present (order-independent) */
export function assertProductsPresent(
  actual: string[],
  expected: string[],
  context?: string
) {
  const sorted = (arr: string[]) => [...arr].sort();
  const prefix = context ? `[${context}] ` : "";
  expect(sorted(actual), `${prefix}Expected products ${expected.join(", ")}`).toEqual(
    sorted(expected)
  );
}

/** Assert that specific products are NOT in the list */
export function assertProductsAbsent(
  actual: string[],
  absent: string[],
  context?: string
) {
  const prefix = context ? `[${context}] ` : "";
  for (const product of absent) {
    expect(actual, `${prefix}Product ${product} should be absent`).not.toContain(
      product
    );
  }
}

/** Assert that a country code IS in cor_supported_country_codes */
export function assertCORSupported(
  corCodes: string[],
  countryCode: string,
  context?: string
) {
  const prefix = context ? `[${context}] ` : "";
  expect(
    corCodes.map((c) => c.toLowerCase()),
    `${prefix}COR should be supported for ${countryCode}`
  ).toContain(countryCode.toLowerCase());
}

/** Assert that a country code is NOT in cor_supported_country_codes */
export function assertCORNotSupported(
  corCodes: string[],
  countryCode: string,
  context?: string
) {
  const prefix = context ? `[${context}] ` : "";
  expect(
    corCodes.map((c) => c.toLowerCase()),
    `${prefix}COR should NOT be supported for ${countryCode}`
  ).not.toContain(countryCode.toLowerCase());
}
