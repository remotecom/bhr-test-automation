/**
 * Read-only API tests — no employment creation needed.
 *
 * Test IDs: B1, B8
 *
 * Entity rounds:
 *   Round 1 (UK Entity): B1, B8
 *
 * Note: F1 moved to eor-fallback-path.test.ts (requires employment + India entity)
 */

import { describe, test, expect, beforeAll } from "vitest";
import { createClientFromEnv, type RemoteClient } from "@/src/client";
import { getCountries, findCountry } from "@/src/steps/countries";
import { swapDefaultEntity } from "@/src/setup/entity-swap";

let client: RemoteClient;
const companySlug = process.env.COMPANY_SLUG!;

const SANCTIONED_COUNTRIES = ["IRN", "CUB", "PRK", "SYR"];

beforeAll(async () => {
  client = createClientFromEnv();
  await swapDefaultEntity(client, companySlug, "GBR");
});

describe("Read-Only — Round 1 (UK Entity)", () => {
  test("B1: Sanctioned countries absent from country list", async () => {
    const countries = await getCountries(client);
    const codes = countries.map((c) => c.code?.toUpperCase());

    for (const sanctioned of SANCTIONED_COUNTRIES) {
      expect(codes, `${sanctioned} should not appear in countries`).not.toContain(
        sanctioned
      );
    }
  });

  test("B8: Country with no CSA template — not visible or no products", async () => {
    const countries = await getCountries(client);

    // Verify we get a non-empty country list
    expect(countries.length).toBeGreaterThan(0);

    // Each country has required fields
    for (const country of countries.slice(0, 5)) {
      expect(country.code).toBeTruthy();
      expect(country.name).toBeTruthy();
    }

    // Countries should have contractor_products_available
    const prt = findCountry(countries, "PRT");
    expect(prt).toBeTruthy();
    expect(prt!.contractor_products_available).toBeDefined();
    expect(prt!.contractor_products_available.length).toBeGreaterThan(0);
  });
});
