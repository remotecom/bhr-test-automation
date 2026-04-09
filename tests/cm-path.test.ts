/**
 * CM ("standard") product path tests.
 *
 * Test IDs: A1(CM), B2, B6, N1, N2, D4, D2
 *
 * Entity rounds:
 *   Round 1 (UK entity): A1(CM), B2, B6, N1, N2, D4
 *   Round 2 (USA entity): D2
 */

import { describe, test, expect, beforeAll } from "vitest";
import { createClientFromEnv, type RemoteClient } from "@/src/client";
import { runCMPath } from "@/src/paths/cm";
import { swapDefaultEntity, type LegalEntity } from "@/src/setup/entity-swap";
import { findCountry, getCountries } from "@/src/steps/countries";
import {
  assertProductsPresent,
  assertProductsAbsent,
} from "@/src/assertions/products";
import PRT from "../data/PRT.json";
import BHR from "../data/BHR.json";
import GBR from "../data/GBR.json";

let client: RemoteClient;
const companySlug = process.env.COMPANY_SLUG!;

beforeAll(() => {
  client = createClientFromEnv();
});

describe("CM Path — Round 1 (UK Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "GBR");
  });

  test("A1(CM): Happy path — standard product available for PRT contractor", async () => {
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: PRT.country_code,
      contractor: PRT.contractor,
      legalEntityId: entity.legal_entity_id,
    });

    expect(result.availableProducts).toContain("CM");
  });

  test("B2: Country with no COR support (BHR) — CM + CM+ on pricing, COR absent", async () => {
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: BHR.country_code,
      contractor: BHR.contractor,
      legalEntityId: entity.legal_entity_id,
    });

    // BHR has no COR CSA template
    assertProductsAbsent(result.availableProducts, ["COR"], "B2");
    // BUG: sandbox returns only CM, doc says CM + CM+ should both be available
    assertProductsPresent(result.availableProducts, ["CM", "CM+"], "B2");
  });

  test("B6: Same-country COR blocked (GBR not EU/US) — standard/plus shown, COR absent", async () => {
    // When UK entity is default, GBR contractor should NOT get COR (same-country, not EU/US)
    // IR35 "outside" required for GBR contractors to unlock CM+
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: GBR.country_code,
      contractor: GBR.contractor,
      legalEntityId: entity.legal_entity_id,
      ir35Status: "outside",
    });

    assertProductsAbsent(result.availableProducts, ["COR"], "B6");
    assertProductsPresent(result.availableProducts, ["CM", "CM+"], "B6");
  });

  test("N1: BHR contractor — nationality national — CM + CM+ available", async () => {
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: BHR.country_code,
      contractor: { ...BHR.contractor, email: "n1.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      nationalityStatus: "national",
    });

    assertProductsPresent(result.availableProducts, ["CM", "CM+"], "N1");
    assertProductsAbsent(result.availableProducts, ["COR"], "N1");
  });

  test("N2: BHR contractor — nationality non_national — only CM (CM+ blocked)", async () => {
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: BHR.country_code,
      contractor: { ...BHR.contractor, email: "n2.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      nationalityStatus: "non_national",
    });

    assertProductsPresent(result.availableProducts, ["CM"], "N2");
    assertProductsAbsent(result.availableProducts, ["CM+", "COR"], "N2");
  });

  test("D4: UK contractor — CM + IR35 inside — standard survives", async () => {
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: GBR.country_code,
      contractor: { ...GBR.contractor, email: "d4.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      ir35Status: "inside",
    });

    // IR35 inside: only standard remains
    expect(result.availableProducts).toContain("CM");
    assertProductsAbsent(result.availableProducts, ["CM+", "COR"], "D4");
  });
});

describe("CM Path — Round 2 (USA Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "USA");
  });

  test("D2: UK contractor — IR35 inside — only standard remains", async () => {
    const result = await runCMPath({
      client,
      companyId: companySlug,
      countryCode: GBR.country_code,
      contractor: { ...GBR.contractor, email: "d2.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      ir35Status: "inside",
    });

    assertProductsPresent(result.availableProducts, ["CM"], "D2");
    assertProductsAbsent(result.availableProducts, ["CM+", "COR"], "D2");
  });

});
