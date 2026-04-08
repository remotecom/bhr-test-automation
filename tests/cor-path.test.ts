/**
 * COR product path tests.
 *
 * Test IDs: A1(COR), B4, B5, G1
 *
 * Entity rounds:
 *   Round 1 (UK entity): A1(COR), G1
 *   Round 2 (USA entity): B5
 *   Round 3 (Germany entity): B4
 */

import { describe, test, expect, beforeAll } from "vitest";
import { createClientFromEnv, type RemoteClient } from "@/src/client";
import { runCORPath } from "@/src/paths/cor";
import { swapDefaultEntity, type LegalEntity } from "@/src/setup/entity-swap";
import {
  assertProductsPresent,
  assertProductsAbsent,
} from "@/src/assertions/products";
import PRT from "../data/PRT.json";
import USA from "../data/USA.json";
import DEU from "../data/DEU.json";

let client: RemoteClient;
const companySlug = process.env.COMPANY_SLUG!;

beforeAll(() => {
  client = createClientFromEnv();
});

describe("COR Path — Round 1 (UK Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "GBR");
  });

  test("A1(COR): Happy path — COR available, flow completes for PRT contractor", async () => {
    const result = await runCORPath({
      client,
      companyId: companySlug,
      countryCode: PRT.country_code,
      contractor: PRT.contractor,
      legalEntityId: entity.legal_entity_id,
    });

    expect(result.availableProducts).toContain("COR");
    expect(result.corSelected).toBe(true);
  });

  test("G1: COR questionnaire — passes with non-blocking answers", async () => {
    const result = await runCORPath({
      client,
      companyId: companySlug,
      countryCode: PRT.country_code,
      contractor: { ...PRT.contractor, email: "g1.test@example.com" },
      legalEntityId: entity.legal_entity_id,
    });

    expect(result.corSelected).toBe(true);
    // If questionnaire exists, it should not be blocking
    if (result.questionnaireResult) {
      expect(result.questionnaireResult.is_blocking).toBe(false);
      expect(result.postQuestionnaireProducts).toContain("COR");
    }
  });
});

describe("COR Path — Round 2 (USA Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "USA");
  });

  test("B5: Same-country (USA) — COR absent (API scope: engaged_by=bill_to=default LE), CM + CM+ shown", async () => {
    const result = await runCORPath({
      client,
      companyId: companySlug,
      countryCode: USA.country_code,
      contractor: USA.contractor,
      legalEntityId: entity.legal_entity_id,
    });

    // COR correctly absent: same-country exception N/A via partner API
    // (engaged_by_legal_entity = bill_to_legal_entity = default LE)
    assertProductsAbsent(result.availableProducts, ["COR"], "B5");
    assertProductsPresent(result.availableProducts, ["CM", "CM+"], "B5");
    expect(result.corSelected).toBe(false);
  });
});

describe("COR Path — Round 3 (Germany Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "DEU");
  });

  test("B4: Same-country (DEU) — COR absent (API scope: engaged_by=bill_to=default LE), CM + CM+ shown", async () => {
    const result = await runCORPath({
      client,
      companyId: companySlug,
      countryCode: DEU.country_code,
      contractor: DEU.contractor,
      legalEntityId: entity.legal_entity_id,
    });

    // COR correctly absent: same-country exception N/A via partner API
    // (engaged_by_legal_entity = bill_to_legal_entity = default LE)
    assertProductsAbsent(result.availableProducts, ["COR"], "B4");
    assertProductsPresent(result.availableProducts, ["CM", "CM+"], "B4");
    expect(result.corSelected).toBe(false);
  });
});
