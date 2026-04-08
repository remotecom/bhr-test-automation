/**
 * CM+ ("plus") product path tests.
 *
 * Test ID: A1(CM+)
 * Entity round: Round 1 (UK Entity)
 */

import { describe, test, expect, beforeAll } from "vitest";
import { createClientFromEnv, type RemoteClient } from "@/src/client";
import { runCMPlusPath } from "@/src/paths/cm-plus";
import { swapDefaultEntity, type LegalEntity } from "@/src/setup/entity-swap";
import PRT from "../data/PRT.json";

let client: RemoteClient;
const companySlug = process.env.COMPANY_SLUG!;

beforeAll(() => {
  client = createClientFromEnv();
});

describe("CM+ Path — Round 1 (UK Entity)", () => {
  let entity: LegalEntity;

  beforeAll(async () => {
    entity = await swapDefaultEntity(client, companySlug, "GBR");
  });

  test("A1(CM+): Happy path — plus product available for PRT contractor", async () => {
    const result = await runCMPlusPath({
      client,
      companyId: companySlug,
      countryCode: PRT.country_code,
      contractor: PRT.contractor,
      legalEntityId: entity.legal_entity_id,
    });
    expect(result.availableProducts).toContain("CM+");
  });
});
