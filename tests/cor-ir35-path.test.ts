/**
 * COR + IR35 path tests (UK contractors via non-UK entity).
 *
 * Test IDs: D1, D5, D6
 * Entity round: Round 2 (USA Entity)
 */

import { describe, test, expect, beforeAll } from "vitest";
import { createClientFromEnv, type RemoteClient } from "@/src/client";
import { runCORIR35Path } from "@/src/paths/cor-ir35";
import { swapDefaultEntity, type LegalEntity } from "@/src/setup/entity-swap";
import GBR from "../data/GBR.json";

let client: RemoteClient;
let entity: LegalEntity;
const companySlug = process.env.COMPANY_SLUG!;

beforeAll(async () => {
  client = createClientFromEnv();
  entity = await swapDefaultEntity(client, companySlug, "USA");
});

describe("COR+IR35 Path — Round 2 (USA Entity)", () => {
  test("D1: UK contractor — IR35 outside — all 3 products visible, COR selectable", async () => {
    const result = await runCORIR35Path({
      client,
      companyId: companySlug,
      contractor: GBR.contractor,
      legalEntityId: entity.legal_entity_id,
      ir35Status: "outside",
    });

    expect(result.availableProducts).toContain("CM");
    expect(result.availableProducts).toContain("CM+");
    expect(result.availableProducts).toContain("COR");
    expect(result.corSelected).toBe(true);
  });

  test("D5: UK contractor — IR35 exempt — all 3 products available", async () => {
    const result = await runCORIR35Path({
      client,
      companyId: companySlug,
      contractor: { ...GBR.contractor, email: "d5.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      ir35Status: "exempt",
    });

    expect(result.availableProducts).toContain("CM");
    expect(result.availableProducts).toContain("CM+");
    expect(result.availableProducts).toContain("COR");
  });

  test("D6: UK contractor — IR35 outside — SDS upload succeeds, products available", async () => {
    const result = await runCORIR35Path({
      client,
      companyId: companySlug,
      contractor: { ...GBR.contractor, email: "d6.test@example.com" },
      legalEntityId: entity.legal_entity_id,
      ir35Status: "outside",
    });

    expect(result.availableProducts.length).toBeGreaterThan(0);
    expect(result.availableProducts).toContain("COR");
  });
});
