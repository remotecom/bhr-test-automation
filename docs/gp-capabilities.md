# Global Payroll capability report

The **Payroll (GP)** tab reports which Global Payroll onboarding forms the Remote API publishes for each country. It also shows whether the connected company has a GP-enabled legal entity in each country, and flags anything that has drifted from the last accepted baseline.

It supports two audiences (from the Mohit / James 1:1 on 2026-10-05):

- **External (partner enablement):** a capability matrix and test cases you can hand to a partner, such as BambooHR, during SDK onboarding. The test cases use the same columns as the *Global Payroll SDK Testing Guide* sheet, which follows the layout of the EOR Company Creation Testing Guide. The guide is partner-neutral: keep partner names and partner-specific notes out of it, so the same guide can go to every GP partner.
- **Internal (regression):** `npm run gp:capabilities -- --strict` exits 1 when coverage drifts. You can use it as a CI gate before merging a new SDK version.

## What it does (read-only)

| Step | Call | Notes |
|---|---|---|
| Entities | `GET /v1/companies/{slug}/legal-entities` | Reads `global_payroll_enabled` and `country_code` |
| Catalog | `GET /v1/countries` | Reads `supported_json_schemas` (it is recorded whether GP forms are advertised there) |
| Forms | `GET /v1/countries/{cc}/global_payroll_{form}` | Probes basic_information, contract_details, administrative_details, personal_details and bank_account_details. federal_taxes is probed for USA only |

A 200 response with a schema means the form is published. A 404 or 422 (`Form not available for requested country`) means it is not available. Any other response is an error. Responses of 429 and 5xx are retried with backoff.

Without an employee in the country, `global_payroll_contract_details` returns `400 missing required query parameter: employment_id` instead of the schema. Unsupported countries get the 422 before that parameter check (checked 21 Oct on MLT), so this 400 counts as **published, schema needs an employment** (the dashed pill in the tab). Remote also refuses an `employment_id` from another country (`400 employment_id belongs to an employment outside {cc}`), so only an employee in that country can read it. As a safety net the report cross-checks the 400 against `GET /v1/countries`: the form stays published only if the country's `supported_json_schemas` lists it (`confirmAgainstCatalog` in `src/gp/evaluate.ts`). The report also records each country's `global_payroll_supported` flag. Runs saved before this rule existed are re-read with it when loaded.

The report itself creates nothing and changes no sandbox state, so it is safe to run against a shared or partner company. Test employees (below) are the one exception, and only when someone clicks the button.

**Coverage** is *Full* when both contract details (the employer flow) and personal details (the employee flow) are published. It is *Employer only* or *Employee only* when just one of them is (for example HUN). Otherwise it is *Not supported*.

**Schema signals.** Each published schema is scanned for:

- **required** fields: the top-level `required` list
- **hidden** fields: `x-jsf-presentation.inputType: "hidden"`
- **skipped fields** (shown as "Form skips X: may be required"): fields the form never asks for, because the schema only requires them under a switched-off rule, `{ if: false, then: { required: [...] } }`

The GBR `overtime_eligible` 422 (API-BEHAVIOUR-2, TASA-1667, fixed in PBYR-4962) followed this pattern: the form never asked for the field, but the backend still required it. A skipped field is something to check, not a confirmed bug. Only submitting the form without it for a real GP employment tells you whether the API enforces it (422) or not (200).

## Test employees

Some forms can only be read for a specific employee. Contract details returns `400 missing required query parameter: employment_id` without one, in both the partners and the Remote sandbox. Other forms can change per employee. The **Test employees** section of the tab fixes this:

1. Pick a country and click **Create test employee**. You can also click the button that appears on a row whose contract details can't be read yet, or the one in the row's detail panel.
2. The app makes sure the company has a GP-enabled legal entity in that country:
   - It reuses one that already has GP on.
   - If the company has an entity there with GP off, it switches GP on (`POST /v1/sandbox/companies/{id}/legal-entities/{entity_id}/activate-global-payroll`).
   - If there's no entity in the country, it creates one first (`POST /v1/sandbox/companies/{id}/legal-entities`).
3. It creates the employee the same way the remote-flows `PayrollAdminOnboarding` flow does: `POST /v1/employments` with `type: "global_payroll_employee"`, `engaged_by_legal_entity_id` and `basic_information`. `basic_information` uses `personal_email` with `login_email: "personal"`. Sending the older `email` field alongside them returns `422 email is not accepted`.
4. That country is re-checked straight away. Contract, administrative, personal and bank details are then fetched with `?employment_id=`, and the row shows **Checked with test employee**.

Every later run uses the saved employees too. They are kept in the browser per environment and company, like the last run. Clicking × stops using an employee; the employee itself stays in the sandbox company.

Sandbox only. Creating an employee changes the connected company (it may add a legal entity and switch GP on), and the tab says what it changed.

## Checking skipped fields

A skipped field only matters if the API still requires it. With a test employee in the country, each "skips X: may be required" note has a **Check** button:

1. Read the form for that employee: `GET /v1/countries/{cc}/{form}?employment_id={id}`.
2. Fill every field the form requires with test values (choices prefer "no" so extra sections stay closed; addresses, hours and national IDs such as SIN, CURP, RFC and personnummer get realistic, check-digit-valid values), leaving the skipped fields out.
3. Submit it the way remote-flows 1.59.0 does: `PUT /v2/employments/{id}/contract-details` with `{ contract_details: {...} }`, or `PUT /v2/employments/{id}/administrative-details` with `{ administrative_details: {...} }`.

| Result | Meaning |
|---|---|
| **not enforced** | The API accepted the form, so the skipped fields aren't required in practice |
| **API requires skipped X** | Rejected, naming a skipped field: a client following the form can't submit it (shown in red, counts as needs attention) |
| **inconclusive** | Rejected for a different field, usually a test value; the tooltip names it and has the request ID |
| **no skipped fields** | That employee's version of the form doesn't skip anything |

It writes test values to that test employee only, and refuses to run outside the two sandboxes. Results are kept in the browser per environment and company, and included in all exports. Every result has a **Re-check** button, so an inconclusive check can be run again after the filler is fixed. In development, each submission's body and response are logged to the server console as `[gp field-check]`, for writing up findings.

Settled results live in `data/gp-field-checks.ts` and show until a live check replaces them. Administrative details, partners sandbox, 15 Oct 2026: **not enforced** for GBR (`tax_code`, `wm_indicator`; also the GP SDK harness on 30 Sep), CAN (`qpip_exempt`; the test employee had no province, so a Quebec employee may differ), MEX (`has_imss_movement`, `integrated_daily_wage`) and SWE (`se_pension_employee_contribution_rate`).

## Testing guide (Test cases)

The Payroll tab opens on **Test cases**: the *Global Payroll SDK Testing Guide*, one row per case (Setup, Admin onboarding, Employee onboarding, Bank details, Tokens & auth), plus Country coverage. Each row shows the guide's status, how the case is tested, when it was last checked and, where one exists, the latest automated check.

- **Source of truth:** `data/gp-guide/guide.json`. It is partner-facing: no ticket IDs, tracker links or internal notes (the importer and a unit test refuse them). Track tickets in the sheet's internal tab or in Linear.
- **Spreadsheet round trip:** `npm run gp:guide:export -- guide.xlsx` writes the same tabs and columns as the Google Sheet (status dropdown and colours included), plus *Last checked* and *How tested*. Edit it in Excel or Google Sheets, download as .xlsx, then `npm run gp:guide:import -- guide.xlsx` and review `git diff data/gp-guide/guide.json`. Tabs the guide doesn't know are ignored. **Download .xlsx** on the tab gives the same file with a *Latest automated check* column, which import ignores.
- **Automated checks** (`src/gp/guide/checks.ts`): S7, A1, A3, A4, A5, A6, A7. Each compares the API with what the guide records: *Matches the guide* (or *Behaves as expected* for an untested row), *Differs from the guide*, *Inconclusive*, *Not run* (usually a missing test employee) or *Check failed*. A check never changes a status; update the row when one differs. A1, A3, A4 and A7 need test employees in GBR, DEU/DNK/IRL/SWE and CAN; A3 and A4 save contract details to them.

### Partners view, James publishes

Runs use the deployer's client credentials and write to a sandbox, so only local runs can run anything:

| Build | Runs | Shows |
|---|---|---|
| `npm run dev` | Report, test employees, skipped-field checks, guide checks, Publish | Your last run, plus unpublished results |
| Production (Vercel) | None. The routes return 403 (`gpRunsRefused` in `lib/features.ts`) | The published report and checks only |

Set `NEXT_PUBLIC_GP_RUNS=true` to allow runs in a production build (not for a partner deploy).

To publish: run the report and the guide checks locally, then click **Publish** on Test cases. Publish adds to what is already published (new checks replace old ones per case; the report is kept if you don't send a new one) and is sanitized: no company slug, legal entities or employment IDs (request IDs stay).

Where it goes (`src/gp/guide/published-store.ts`):

- **Vercel Blob (the normal setup).** Create a **private** Blob store in the Vercel project (Storage > Blob > connect to the project), which sets `BLOB_READ_WRITE_TOKEN` on the deploy, and put the same token in your local `.env`. Publish then goes live for partners straight away; each publish also keeps a dated copy in `gp-guide/history/`. Reads bypass the CDN cache.
- **No store yet.** Publish writes `data/gp-guide/published.json`; commit and deploy it to share. The deploy also falls back to this bundled copy if the store is empty or unreadable.

## Functional checks (errors and blocked steps)

Guide rows A9–A20 ask what Remote returns, and whether a step is blocked, as an employer goes through GP onboarding: inviting before the forms are saved, saving the forms out of order, a missing field, an invalid option, an entity without GP, a reused email address, a start date less than 2 working days away, and, when creating the employee, a missing basic-information field or a repeated `external_employment_id` (A19, A20; the GP counterparts of the EOR guide's creation rows). A21, a rehire after offboarding, is manual. `src/gp/guide/flow.ts` runs each as a short scenario in GBR, with a fresh test employee per scenario, and observes every step: the status, the message, the fields named, and whether it was blocked.

- **Run them** with **Run flow checks** on the Test cases view (local runs only). A full run creates about 6 GP test employees in the connected test company and sends invites to `@example.com` addresses. Scenarios share employees where it changes no answer: A20's two employees are only created, and one whose every step Remote refused (A9, A15) goes to the next scenario, A12 repeats A11's invite, and A17 reuses an email from the run. Each result notes what it reused. **Run checks** doesn't include them.
- **Expectations** live in `data/gp-guide/functional-expectations.ts`. A step with an expectation is compared (*as recorded* or *differs*). A step without one is reported as **observed**, meaning new behaviour for a person to review.
- **To record a behaviour:** after reviewing an observed result, add the step's expectation there, and update the row's Remote Response and Status in `guide.json`. A check never changes a status.
- **Setup steps** (creating the employee, saving the forms a scenario needs) have to succeed. If one fails, the result is an error rather than a finding, with the request ID.

## Employee self-onboarding checks

Rows E1, E3, E4, E7 and E8 call the `/v1/employee/*` endpoints the way the SDK's `PayrollEmployeeOnboardingFlow` does: as the employee, with an employee assertion token (`urn:remote-api:employee:employment:<id>`, jwt-bearer grant, `RemoteClient.asAssertion`) and the SDK's envelopes (`{ personal_details }`, `{ bank_account_details }`). They act as an invited GBR GP employee already in the company (the flow checks leave several, so run those once first), create no employees, and save personal and bank details to that one employee. They run with **Run checks**. Code: `src/gp/guide/employee-checks.ts`. E2 (a country that doesn't require `name`) would need an employee in such a country, and E5/E6 are about what the SDK shows, so those stay manual.

## Token checks

Rows T5 and T8 request assertion tokens (jwt-bearer grant) that should be refused, and compare Remote's status and `error_description` with the guide: an employment ID that doesn't exist (T5), and a wrong or rotated client secret (T8, after a control request with the right secret for the company owner). They keep no token and change nothing, so they run with **Run checks**. Code: `src/gp/guide/token-checks.ts`, using `RemoteClient.assertionGrant`. T6 (a company this client doesn't manage) needs a second client, and T7/T9 need an integration setting switched off, so those stay manual.

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
- **Export:** choose Markdown (for Notion), Test cases CSV (Testing Guide columns), Matrix CSV or JSON.
- **Last run:** kept in your browser only, one per environment and company. Nothing is stored on the server, so company and entity IDs never leave your browser, and you only ever see runs against the company you're connected to. To share a run, use an export.
- **CLI / CI:** run `npm run gp:capabilities -- --countries GBR,DEU --env partners --out data/gp-reports --strict`. It uses the `.env` credentials. Set `COMPANY_SLUG` and `REFRESH_TOKEN` as well if you want the entity column filled in.
- **Unit tests:** `npm run test:gp-unit` makes no network calls.

## Limits and next steps

- Without a test employee, contract details can't be read at all, and the other forms show their generic version. Add a test employee to see the forms for a specific employee and entity.
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
src/gp/cli.ts                         CLI / CI entry point
src/gp/guide/                         Testing guide: types, sheet <-> JSON, xlsx, automated checks, publish
data/gp-guide/guide.json              The testing guide (source of truth)
data/gp-guide/published.json          Bundled fallback for published results (written by Publish when no Blob store is set up)
src/gp/guide/published-store.ts       Where published results live: Vercel Blob or the repo file
components/payroll/GuideView.tsx      Test cases view
app/api/gp/guide/*                    published (GET), xlsx (GET), run and publish (local only)
src/gp/test-employee.ts               Create a GP test employee (entity + GP switch-on if needed)
app/api/gp/capabilities/run/route.ts   SSE run endpoint (stores nothing)
app/api/gp/test-employee/route.ts      Create-test-employee endpoint
hooks/useGPCapabilities.ts
components/payroll/PayrollView.tsx
tests/gp-capabilities.unit.test.ts
```
