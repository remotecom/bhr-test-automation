/**
 * EOR Fallback path tests — when no contractor products are available.
 *
 * Test IDs: B3, F1, G2
 *
 * Entity rounds:
 *   Round 4 (India Entity): B3, F1
 *   Round 2 (USA Entity): G2
 */

import { describe, test, expect, beforeAll } from "vitest";
import { createClientFromEnv, type RemoteClient } from "@/src/client";
import { runEORFallbackPath } from "@/src/paths/eor-fallback";
import { swapDefaultEntity, type LegalEntity } from "@/src/setup/entity-swap";
import { assertProductsAbsent } from "@/src/assertions/products";
import IND from "../data/IND.json";
import PRT from "../data/PRT.json";

let client: RemoteClient;
const companySlug = process.env.COMPANY_SLUG!;

beforeAll(() => {
  client = createClientFromEnv();
});

describe("EOR Fallback — Round 4 (India Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "IND");
  });

  test("B3: India entity + India contractor — no products, EOR fallback", async () => {
    const result = await runEORFallbackPath({
      client,
      companyId: companySlug,
      countryCode: IND.country_code,
      contractor: IND.contractor,
      legalEntityId: entity.legal_entity_id,
    });

    assertProductsAbsent(
      result.availableProducts,
      ["CM", "CM+", "COR"],
      "B3"
    );
    expect(result.availableProducts).toHaveLength(0);

    // Eligibility endpoint returns all true (30-country rule enforced at subscription level)
    expect(result.eligibility.standard).toBe(true);
    expect(result.eligibility.plus).toBe(true);
    expect(result.eligibility.cor).toBe(true);
  });

  test("F1: India entity + PRT contractor — only COR (30-country rule blocks CM/CM+)", async () => {
    const result = await runEORFallbackPath({
      client,
      companyId: companySlug,
      countryCode: PRT.country_code,
      contractor: { ...PRT.contractor, email: "f1.test@example.com" },
      legalEntityId: entity.legal_entity_id,
    });

    // Eligibility endpoint returns all true (30-country rule enforced at subscription level)
    expect(result.eligibility.standard).toBe(true);
    expect(result.eligibility.plus).toBe(true);
    expect(result.eligibility.cor).toBe(true);

    // Stage 3: Only COR in subscriptions (30-country rule blocks CM/CM+ at subscription level)
    expect(result.availableProducts).toContain("COR");
    assertProductsAbsent(result.availableProducts, ["CM", "CM+"], "F1");
  });
});

describe("EOR Fallback — Round 2 (USA Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "USA");
  });

  test("G2: COR blocked by questionnaire — blocking answers → is_blocking=true", async () => {
    const result = await runEORFallbackPath({
      client,
      companyId: companySlug,
      countryCode: PRT.country_code,
      contractor: { ...PRT.contractor, email: "g2.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      blockViaQuestionnaire: true,
    });

    expect(result.questionnaireResult).toBeTruthy();
    expect(result.questionnaireResult!.is_blocking).toBe(true);
  });
});
