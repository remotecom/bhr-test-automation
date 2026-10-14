# Global Payroll capability report

The **Payroll (GP)** tab reports which Global Payroll onboarding forms the Remote API publishes for each country. It also shows whether the connected company has a GP-enabled legal entity in each country, and flags anything that has drifted from the last accepted baseline.

It supports two audiences (from the Mohit / James 1:1 on 2026-10-05):

- **External (partner enablement):** a capability matrix and test cases you can hand to a partner, such as BambooHR, during SDK onboarding. The test cases use the same columns as the *Global Payroll SDK Testing Guide (BambooHR)* sheet.
- **Internal (regression):** `npm run gp:capabilities -- --strict` exits 1 when coverage drifts. You can use it as a CI gate before merging a new SDK version.

## What it does (read-only)

| Step | Call | Notes |
|---|---|---|
| Entities | `GET /v1/companies/{slug}/legal-entities` | Reads `global_payroll_enabled` and `country_code` |
| Catalog | `GET /v1/countries` | Reads `supported_json_schemas` (it is recorded whether GP forms are advertised there) |
| Forms | `GET /v1/countries/{cc}/global_payroll_{form}` | Probes basic_information, contract_details, administrative_details, personal_details and bank_account_details. federal_taxes is probed for USA only |

A 200 response with a schema means the form is published. A 404 or 422 (`Form not available for requested country`) means it is not available. Any other response is an error. Responses of 429 and 5xx are retried with backoff.

In the Remote sandbox, `global_payroll_contract_details` returns `400 missing required query parameter: employment_id` instead of the schema. Unsupported countries get the 422 before that parameter check, so this 400 counts as **published, schema needs an employment** (the dashed pill in the tab). Runs saved before this rule existed are re-read with it when loaded.

The report creates nothing and changes no sandbox state, so it is safe to run against a shared or partner company.

**Coverage** is *Full* when both contract details (the employer flow) and personal details (the employee flow) are published. It is *Employer only* or *Employee only* when just one of them is (for example HUN). Otherwise it is *Not supported*.

**Schema signals.** Each published schema is scanned for:

- **required** fields: the top-level `required` list
- **hidden** fields: `x-jsf-presentation.inputType: "hidden"`
- **inert-required** fields: fields required only under `{ if: false, then: { required: [...] } }`

The GBR `overtime_eligible` 422 (API-BEHAVIOUR-2, TASA-1667, fixed in PBYR-4962) followed this pattern: the form never asked for the field, but the backend still required it. Treat an inert-required field as something to check, not as a confirmed bug.

## Baseline

The baseline lives in `data/gp-capability-baseline.ts`. It is built from two sources:

- **May 2026 gaps analysis:** 42 full-coverage countries.
- **30 Sep 2026 partners-sandbox sweep:** edge cases that override the May list:
  - HUN publishes the employer form only.
  - LVA, KEN, NGA, PER and URY publish no GP forms.
  - `name` is not required in ESP, FRA, IDN, IRL, ITA or USA.

When you accept a new sweep as the truth, update that file.

The verdict for each country is one of:

- `match`: the result agrees with the baseline (exported status: *Verified*).
- `drift`: the result differs from the baseline.
- `error`: the probe failed.
- `no_baseline`: there is no baseline for this country (exported status: *Observed*).

## Running it

- **Dashboard:** open the Payroll (GP) tab, pick a scope and click **Run GP Report**. The scopes are:
  - Baseline countries plus the company's entity countries (the default)
  - All catalog countries
  - A custom list of countries
- **Export:** choose Markdown (for Notion), Test cases CSV (Testing Guide columns), Matrix CSV or JSON. `GET /api/gp/capabilities/export?format=md|test-cases|matrix|json` serves the last saved run.
- **CLI / CI:** run `npm run gp:capabilities -- --countries GBR,DEU --env partners --out data/gp-reports --strict`. It uses the `.env` credentials. Set `COMPANY_SLUG` and `REFRESH_TOKEN` as well if you want the entity column filled in.
- **Unit tests:** `npm run test:gp-unit` makes no network calls.

## Limits and next steps

- Contract details is fetched without `employment_id`, so it returns the generic schema. Field visibility that depends on the entity (for example TT2.0) is not reflected.
- A published form means the schema exists. It does not prove that a submission will succeed.
- **Next:**
  - Admin onboarding scenarios (A1–A8): create the employment, then `PUT /v2/employments/{id}/contract-details` and `/administrative-details`.
  - Employee self-onboarding (E1–E8, B1–B16). This needs the jwt-bearer assertion grant ("Create assertion tokens") enabled for the integration.
  - Token checks (T1–T9).

## Files

```
data/gp-capability-baseline.ts        GP form list + baseline expectations
src/steps/gp-forms.ts                 Form probe (GET /v1/countries/{cc}/{form})
src/gp/schema-analysis.ts             Required / hidden / inert-required analysis (pure)
src/gp/evaluate.ts                    Coverage, entity status, baseline verdicts (pure)
src/gp/capability-runner.ts           Orchestration + SSE events
src/gp/export.ts                      CSV / Markdown builders (pure)
src/gp/store.ts                       Last-run persistence (Vercel Blob → data/ fallback)
src/gp/cli.ts                         CLI / CI entry point
app/api/gp/capabilities/{run,last-run,export}/route.ts
hooks/useGPCapabilities.ts
components/payroll/PayrollView.tsx
tests/gp-capabilities.unit.test.ts
```
