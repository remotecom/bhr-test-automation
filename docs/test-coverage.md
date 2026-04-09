# Contractor Onboarding Test Coverage

21 automated test cases cover the full contractor onboarding flow via the Remote Partner API. This document explains:

1. **The Product Funnel** ... how products get filtered at each API stage
2. **The Decision Tree** ... the business logic that produces 14 unique scenarios
3. **The Enriched Matrix** ... each test case annotated with its tree path and purpose
4. **Equivalence Classes** ... why 21 tests cover all possible country pairs

Source of truth for test specifications: [Notion](https://www.notion.so/remotecom/338cb4dadab481c0a440e38242c3867a)

---

## 1. The Product Funnel

Partners traverse five API stages to determine which contractor products are available for a given country pair. **Each stage can only remove products, never add them.** The funnel narrows.

### Example A: GBR entity, PRT contractor (happy path)

```
Stage 1  GET /v1/countries → PRT             → [standard, plus, cor]    all in catalog
Stage 2  GET /v1/contractor-eligibility       → std:✓  plus:✓  cor:✓    GBR entity, PRT in cor_supported
Stage 3  SDK: no IR35, no nationality         → (nothing changes)       PRT triggers no special rules
Stage 4  GET /v1/.../contractor-subscriptions → [CM, CM+, COR]          all survive
Stage 5  Questionnaire                        → not run (CM path)       --
Result: CM, CM+, COR all available
```

Every product makes it through. This is test **A1** (three variants: CM, CM+, COR selection paths).

### Example B: IND entity, IND contractor (everything filtered)

```
Stage 1  GET /v1/countries → IND             → [standard, plus, cor]    still in catalog
Stage 2  GET /v1/contractor-eligibility       → std:✓  plus:✓  cor:✗    IND not in cor_supported (same-country)
Stage 3  SDK: no IR35, no nationality         → (nothing changes)       IND triggers no special rules
Stage 4  GET /v1/.../contractor-subscriptions → []                       30-country rule kills CM/CM+, COR already gone
Stage 5  Questionnaire                        → not run (no COR)        --
Result: zero products, EOR fallback
```

Everything gets removed. This is test **B3**.

### Mapping to test matrix fields

| Funnel Stage | API Call | Test Matrix Field |
|---|---|---|
| Stage 1 | `GET /v1/countries` | `country` |
| Stage 2 | `GET /v1/contractor-eligibility` | `eligibility` |
| Stage 3 | SDK (IR35, nationality) | `ir35`, `nationality` |
| Stage 4 | `GET /v1/.../contractor-subscriptions` | `subs` |
| Stage 5 | Questionnaire | `questionnaire` |

---

## 2. The Decision Tree

This is the business logic. Five dimensions create all the branch points: entity location, same-country exception, IR35, nationality, and the questionnaire. Every test maps to exactly one leaf.

```
Is entity in the 30-country list? (EU-27 + USA + GBR + CAN)
|
+-- NO (e.g., IND) --> 30-country rule blocks CM/CM+ at Stage 4
|   |
|   +-- Hire == entity country?
|   |   YES --> Zero products (COR also absent: same-country exception)
|   |           Tests: B3 (IND->IND)
|   |
|   +-- Hire != entity country?
|       COR only survives
|           Tests: F1 (IND->PRT)
|
+-- YES (e.g., GBR, USA, DEU) --> CM/CM+ eligible
    |
    +-- Hire == entity country? (same-country exception: COR absent at Stage 2)
    |   |
    |   +-- YES
    |   |   |
    |   |   +-- Hire is GBR? --> IR35 applies
    |   |   |   |
    |   |   |   +-- outside/exempt --> CM + CM+
    |   |   |   |   Tests: B6 (GBR->GBR, outside)
    |   |   |   |
    |   |   |   +-- inside --> CM only
    |   |   |       Tests: D4 (GBR->GBR, inside)
    |   |   |
    |   |   +-- Hire is not GBR --> CM + CM+ (no IR35 gate)
    |   |       Tests: B4 (DEU->DEU), B5 (USA->USA)
    |   |
    |   +-- NO --> COR potentially available
    |       |
    |       +-- Hire is GBR? --> IR35 applies
    |       |   |
    |       |   +-- outside/exempt --> CM + CM+ + COR
    |       |   |   Tests: D1 (outside), D5 (exempt), D6 (outside+SDS)
    |       |   |
    |       |   +-- inside --> CM only (IR35 kills CM+/COR)
    |       |       Tests: D2, D3 (USA->GBR, inside)
    |       |
    |       +-- Hire is BHR? --> Nationality applies
    |       |   |
    |       |   +-- national --> CM + CM+ (COR not in cor_supported for BHR)
    |       |   |   Tests: B2, N1 (GBR->BHR, national)
    |       |   |
    |       |   +-- non_national --> CM only (nationality blocks CM+)
    |       |       Tests: N2 (GBR->BHR, non_national)
    |       |
    |       +-- Other hire country --> All products, no special gates
    |           Tests: A1(CM), A1(CM+), A1(COR), G1, G2 (GBR/USA->PRT)
    |
    +-- [If COR reached Stage 4]: Questionnaire gate
        |
        +-- Pass --> COR selectable
        |   Tests: G1, A1(COR), D1, D5, D6
        |
        +-- Block --> COR removed
            Tests: G2 (USA->PRT, blocking answers)

Compliance (outside the tree):
  B1 -- Sanctioned countries (IRN, CUB, PRK, SYR) absent from Stage 1
  B8 -- Country data integrity (fields present, well-formed)
```

**10 leaf nodes + 2 questionnaire outcomes + 2 compliance = 14 unique scenarios.**

Every leaf has at least one test. No leaf is uncovered. That's the completeness argument.

### Leaf-to-Test Mapping

| Leaf | Tree Path | Tests | Expected Subs |
|---|---|---|---|
| 1 | out30, same-country | B3 | [] |
| 2 | out30, cross-country | F1 | [COR] |
| 3 | 30, same-country, GBR, IR35 outside | B6 | [CM, CM+] |
| 4 | 30, same-country, GBR, IR35 inside | D4 | [CM] |
| 5 | 30, same-country, not GBR | B4, B5 | [CM, CM+] |
| 6 | 30, cross-entity, GBR, IR35 outside/exempt | D1, D5, D6 | [CM, CM+, COR] |
| 7 | 30, cross-entity, GBR, IR35 inside | D2, D3 | [CM] |
| 8 | 30, cross-entity, BHR, national | B2, N1 | [CM, CM+] |
| 9 | 30, cross-entity, BHR, non_national | N2 | [CM] |
| 10 | 30, cross-entity, other | A1(CM), A1(CM+), A1(COR), G1, G2 | [CM, CM+, COR] |
| Q+ | questionnaire pass | G1, A1(COR), D1, D5, D6 | COR selectable |
| Q- | questionnaire block | G2 | COR removed |
| C1 | compliance | B1 | sanctioned absent |
| C2 | compliance | B8 | data integrity |

Any country pair that doesn't hit a branch point (not GBR, not BHR, not same-country, entity in 30) lands at the "Other" leaf ... same outcome as A1. IND->IND and PAK->PAK land at the same leaf as B3. The tree has finite branches; the Playground lets you verify any specific point.

---

## 3. The Enriched Matrix

Tests grouped by decision tree path. Multiple tests at the same leaf have identical expected values because the same business rules apply. They test different product **selection** paths through the SDK (CM vs CM+ vs COR), not different filtering outcomes.

### Group 1: Baseline -- all products available (Leaf 10)

**Rule:** Entity in 30-country list, hire is not GBR/BHR and not same-country. No special rules triggered. All products survive.

**Tree path:** 30 ✓, same-country ✗, no special hire

| Test | Entity | Hire | Path | Subs | Quest. | What's unique | Without this test... |
|---|---|---|---|---|---|---|---|
| A1(CM) | GBR | PRT | CM | CM, CM+, COR | -- | CM selection path | No proof standard product works end-to-end |
| A1(CM+) | GBR | PRT | CM+ | CM, CM+, COR | -- | CM+ selection path | No proof plus product works end-to-end |
| A1(COR) | GBR | PRT | COR | CM, CM+, COR | pass | COR selection + questionnaire | No proof COR flow completes with questionnaire |
| G1 | GBR | PRT | COR | CM, CM+, COR | pass | Questionnaire focus | No explicit test of non-blocking questionnaire answers |

**Expected values (all four tests):**
- Eligibility: standard ✓, plus ✓, cor ✓
- Country products: [standard, plus, cor]
- Subs: [CM, CM+, COR]
- Questionnaire: null for CM/CM+; `{ isBlocking: false }` for COR paths

**Note:** A1(COR) and G1 both run GBR->PRT on the COR path with a passing questionnaire. G1 explicitly focuses on questionnaire behavior, while A1(COR) exercises the full COR selection flow. Both are needed: G1 proves the questionnaire itself works, A1(COR) proves the product selection completes.

---

### Group 2: Same-country, no IR35 (Leaf 5)

**Rule:** Entity in 30-country list, hire == entity country, hire is not GBR. COR absent via same-country exception. No IR35 gate. CM + CM+ survive.

**Tree path:** 30 ✓, same-country ✓, not GBR

| Test | Entity | Hire | Path | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| B4 | DEU | DEU | CM | CM, CM+ | EU entity (DEU) | No proof same-country works for EU countries |
| B5 | USA | USA | CM | CM, CM+ | Non-EU entity (USA) | No proof same-country works outside EU |

**Expected values (both tests):**
- Eligibility: standard ✓, plus ✓, cor ✗
- Country products: [standard, plus, cor]
- Subs: [CM, CM+]
- Questionnaire: null

---

### Group 3: Same-country, GBR, IR35 outside (Leaf 3)

**Rule:** Entity is GBR, hire is GBR. Same-country removes COR. IR35 is outside, so CM+ survives.

**Tree path:** 30 ✓, same-country ✓, GBR, IR35 outside

| Test | Entity | Hire | IR35 | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| B6 | GBR | GBR | outside | CM, CM+ | Same-country GBR + IR35 outside | No proof IR35 outside preserves CM+ in same-country |

**Expected values:**
- Eligibility: standard ✓, plus ✓, cor ✗
- Country products: [standard, plus, cor]
- Subs: [CM, CM+]
- Questionnaire: null

---

### Group 4: Same-country, GBR, IR35 inside (Leaf 4)

**Rule:** Entity is GBR, hire is GBR. Same-country removes COR. IR35 inside removes CM+. Only CM survives.

**Tree path:** 30 ✓, same-country ✓, GBR, IR35 inside

| Test | Entity | Hire | IR35 | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| D4 | GBR | GBR | inside | CM | IR35 inside in same-country | No proof IR35 inside correctly blocks CM+ |

**Expected values:**
- Eligibility: standard ✓, plus ✓, cor ✗
- Country products: [standard, plus, cor]
- Subs: [CM]
- Questionnaire: null

---

### Group 5: Cross-entity, GBR hire, IR35 outside/exempt (Leaf 6)

**Rule:** Entity in 30-country list, hire is GBR (triggers IR35), entity != GBR (no same-country exception). IR35 is outside or exempt, so all three products survive.

**Tree path:** 30 ✓, same-country ✗, GBR hire, IR35 outside/exempt

| Test | Entity | IR35 | Subs | Quest. | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| D1 | USA | outside | CM, CM+, COR | pass | COR+IR35 path, questionnaire pass | No proof IR35 outside + COR works |
| D5 | USA | exempt | CM, CM+, COR | pass | IR35 exempt variant | No proof exempt != inside |
| D6 | USA | outside | CM, CM+, COR | pass | SDS upload variant (UI-only diff) | Coverage gap for SDS flow |

**Expected values (all three tests):**
- Eligibility: standard ✓, plus ✓, cor ✓
- Country products: [standard, plus, cor]
- Subs: [CM, CM+, COR]
- Questionnaire: `{ isBlocking: false }`

**Note:** D1 and D6 have identical configuration except D6 tests the SDS (Self-Determination Statement) upload variant, a UI-only distinction the automation cannot fully capture. Both are kept for completeness against the Notion spec.

---

### Group 6: Cross-entity, GBR hire, IR35 inside (Leaf 7)

**Rule:** Entity in 30-country list, hire is GBR. IR35 inside kills CM+ and COR. Only CM survives.

**Tree path:** 30 ✓, same-country ✗, GBR hire, IR35 inside

| Test | Entity | Hire | IR35 | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| D2 | USA | GBR | inside | CM | "only standard remains" (Notion) | No proof IR35 inside blocks CM+/COR cross-entity |
| D3 | USA | GBR | inside | CM | "only CM remains" (Notion) | Same as D2, different Notion row |

**Expected values (both tests):**
- Eligibility: standard ✓, plus ✓, cor ✓
- Country products: [standard, plus, cor]
- Subs: [CM]
- Questionnaire: null

**Duplicate note:** D2 and D3 are functionally identical. They map to different Notion spec rows that describe the same outcome in different words ("only standard remains" vs "only CM remains"). Consider consolidating in a future spec revision.

---

### Group 7: BHR hire, nationality national (Leaf 8)

**Rule:** Entity in 30-country list, hire is BHR. BHR is a nationality-gated country. Nationality "national" allows CM+. COR is absent (BHR not in `cor_supported_country_codes`).

**Tree path:** 30 ✓, same-country ✗, BHR hire, national

| Test | Entity | Hire | Nationality | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| B2 | GBR | BHR | national | CM, CM+ | Framed as "country with no COR" | No proof COR-absent country + national works |
| N1 | GBR | BHR | national | CM, CM+ | Framed as "nationality national" | Same config, different section in Notion |

**Expected values (both tests):**
- Eligibility: standard ✓, plus ✓, cor ✗
- Country products: [standard, plus]
- Subs: [CM, CM+]
- Questionnaire: null

**Duplicate note:** B2 and N1 are functionally identical. B2 lives in the "CM Path" section of the Notion spec (testing COR absence), N1 in the "Nationality Path" section (testing nationality gating). Same rule, different organizational angles.

---

### Group 8: BHR hire, nationality non_national (Leaf 9)

**Rule:** Entity in 30-country list, hire is BHR. Nationality "non_national" blocks CM+. COR absent. Only CM survives.

**Tree path:** 30 ✓, same-country ✗, BHR hire, non_national

| Test | Entity | Hire | Nationality | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| N2 | GBR | BHR | non_national | CM | Only test of nationality blocking CM+ | No proof non_national correctly blocks CM+ |

**Expected values:**
- Eligibility: standard ✓, plus ✓, cor ✗
- Country products: [standard, plus]
- Subs: [CM]
- Questionnaire: null

---

### Group 9: Outside 30, same-country (Leaf 1)

**Rule:** Entity not in 30-country list, hire == entity country. 30-country rule blocks CM/CM+ at subscriptions. Same-country blocks COR. Zero products, EOR fallback.

**Tree path:** out30, same-country

| Test | Entity | Hire | Path | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| B3 | IND | IND | EOR | [] | Zero-product case | No proof EOR fallback triggers correctly |

**Expected values:**
- Eligibility: standard ✓, plus ✓, cor ✗
- Country products: [standard, plus, cor]
- Subs: []
- Questionnaire: null

---

### Group 10: Outside 30, cross-country (Leaf 2)

**Rule:** Entity not in 30-country list, hire != entity country, hire country has COR support. 30-country rule blocks CM/CM+, but COR survives.

**Tree path:** out30, cross-country

| Test | Entity | Hire | Path | Subs | What's unique | Without this test... |
|---|---|---|---|---|---|---|
| F1 | IND | PRT | EOR | COR | COR-only case | No proof COR survives alone when CM/CM+ are blocked |

**Expected values:**
- Eligibility: standard ✓, plus ✓, cor ✓
- Country products: [standard, plus, cor]
- Subs: [COR]
- Questionnaire: null

---

### Group 11: Questionnaire blocks COR (Q-)

**Rule:** All products available at Stage 4, but questionnaire returns blocking answers. COR is removed.

**Tree path:** 30 ✓, same-country ✗, other hire, questionnaire blocks

| Test | Entity | Hire | Path | Subs | Quest. | What's unique | Without this test... |
|---|---|---|---|---|---|---|---|
| G2 | USA | PRT | EOR | CM, CM+, COR | blocking | Only test of questionnaire blocking COR | No proof questionnaire can remove COR |

**Expected values:**
- Eligibility: standard ✓, plus ✓, cor ✓
- Country products: [standard, plus, cor]
- Subs: [CM, CM+, COR]
- Questionnaire: `{ isBlocking: true }`

**Note:** G2 sits at leaf 10 in the decision tree (USA->PRT, no special rules, all subs available), but the questionnaire blocks COR. The `path` is "EOR" because the test verifies the blocking behavior, not the product selection.

---

### Group 12: Compliance (C1, C2)

**Rule:** Read-only validations against the country catalog. No employment created.

| Test | What it checks | Expected |
|---|---|---|
| B1 | Sanctioned countries (IRN, CUB, PRK, SYR) are absent from `GET /v1/countries` | These country codes do not appear |
| B8 | Country data integrity: every country has required fields, well-formed data | All countries have expected fields present |

---

### Duplicate Pairs Summary

| Pair | Relationship | Why both exist |
|---|---|---|
| D2 / D3 | Identical config and expected | Different Notion rows: "only standard remains" vs "only CM remains" (same outcome) |
| B2 / N1 | Identical config and expected | B2 tests COR absence, N1 tests nationality gating. Same rule, different section organization |
| D1 / D6 | Same config except D6 mentions SDS upload | SDS is a UI-only distinction not captured by automation |
| A1(COR) / G1 | Both GBR->PRT COR with questionnaire pass | A1(COR) tests full COR flow, G1 focuses on questionnaire behavior |

### Untested Edge Cases (documented, not gaps)

| Scenario | Why it's OK | Equivalent to |
|---|---|---|
| Same-country GBR + IR35 exempt | Exempt behaves like outside (proven by D5 in cross-entity path). Same-country and IR35 rules are orthogonal | B6 |
| Outside-30 + cross-country + hire without COR (e.g., IND->BHR) | Would produce [] like B3. Different cause (BHR lacks COR in catalog), same outcome | B3 |
| Non-BHR GCC nationality (SAU/KWT/OMN/QAT) | Nationality is recorded but doesn't gate for non-BHR countries | A1 |

---

## 4. Equivalence Classes and the Playground

The 21 tests cover 14 unique scenarios. Every other possible country pair is equivalent to one of these tested scenarios. The table below shows which leaf any untested combination maps to.

| If you're testing... | Same outcome as | Why | Tree Leaf |
|---|---|---|---|
| FRA->ESP, NLD->BRA, any 30-country entity to non-special hire | A1 | No branch point triggered | 10 |
| PAK->PAK, NGA->NGA, any outside-30 same-country | B3 | Outside-30 + same-country | 1 |
| BRA->DEU, IND->FRA, any outside-30 to COR-supported hire | F1 | Outside-30 + cross-country, COR survives | 2 |
| IND->BHR, any outside-30 to hire without COR support | B3 | Cross-country but no COR in catalog, zero products | 1* |
| GBR->GBR with IR35 exempt | B6 | Exempt = outside (proven by D5), same-country rules orthogonal | 3 |
| GBR->SAU, GBR->KWT, any 30-country to non-BHR GCC | A1 | Nationality recorded but doesn't block | 10 |
| CAN->CAN, AUT->AUT, any 30-country same-country (non-GBR) | B4/B5 | Same-country blocks COR, no IR35 | 5 |
| Any GBR hire with IR35 inside (from any 30-country entity) | D2/D4 | IR35 inside always blocks CM+/COR | 7 or 4 |

*IND->BHR is technically leaf 2 (outside-30, cross-country) but BHR lacks COR in catalog, producing the same [] outcome as leaf 1. Edge case, same result.

The Playground exists for partners to verify their specific country pair. Pick entity country, pick hire country, see which leaf you land on.
