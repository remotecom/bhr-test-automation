# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Next.js 16 test automation platform for validating contractor onboarding flows against the Remote Partner API. It combines a web dashboard (React 19 + SSE streaming), API routes, and Vitest-based integration tests that hit a real sandbox API.

## Commands

```bash
# Development
npm run dev              # Next.js dev server (web dashboard)
npm start                # Local dashboard (tsx runner, port 3939)

# Run all tests
npm test                 # Vitest, sequential, 60s timeout per test

# Run specific path tests
npm run test:cm          # Standard product flow
npm run test:cm-plus     # Premium subscription flow
npm run test:cor         # Contractor-of-Record flow
npm run test:cor-ir35    # COR with IR35 handling
npm run test:eor         # EOR fallback
npm run test:readonly    # Read-only assertions

# Build
npm run build            # Next.js production build
```

## Architecture

### Core Flow

Tests exercise a 5-stage product funnel that narrows available products:
1. Country catalog → 2. Entity eligibility → 3. IR35/nationality rules → 4. Subscriptions → 5. Questionnaire

### Key Directories

- **`src/paths/`** — Product onboarding path implementations (cm, cm-plus, cor, cor-ir35, eor-fallback). Each executes a fixed API flow and returns available/selected products.
- **`src/steps/`** — Reusable API step modules (countries, employment, subscriptions, eligibility, questionnaire, contract-details, invite, ir35, nationality).
- **`src/client.ts`** — OAuth2 HTTP client with refresh_token and client_credentials grant support, token caching.
- **`src/trace.ts`** — Live event emitter: colored stderr output + SSE broadcast. Fire-and-forget pattern.
- **`src/setup/entity-swap.ts`** — Sandbox entity creation/swapping with caching. Tests swap the default legal entity per round.
- **`src/suite/runner.ts`** — In-process test suite runner (iterates test matrix, calls path functions directly, streams SSE). Used by Vercel API route.
- **`data/test-matrix.ts`** — 20 test cases covering 14 unique scenarios. Each specifies entity, hire country, path, IR35/nationality, and expected results.
- **`data/*.json`** — Contractor fixtures per country (PRT, GBR, DEU, USA, IND, BHR).
- **`tests/`** — Vitest test files. All follow: beforeAll creates client + swaps entity, then tests run path and assert products.

### Web Dashboard

- **`app/page.tsx`** — Two-tab dashboard: Suite (full test run) and Playground (single scenario explorer).
- **`app/api/suite/run/route.ts`** — SSE streaming endpoint, runs test matrix in-process (maxDuration 300s).
- **`app/api/playground/run/route.ts`** — Single scenario SSE endpoint (maxDuration 60s).
- **`hooks/useSuite.ts` / `usePlayground.ts`** — SSE streaming state management hooks.
- **`middleware.ts`** — JWT auth on all routes except `/login`.

### Global Payroll (GP) capability report

Read-only Payroll (GP) tab plus CLI. Probes `GET /v1/countries/{cc}/global_payroll_*` per country, reads `global_payroll_enabled` on company legal entities, and compares against `data/gp-capability-baseline.ts` (match / drift). Always use the `global_payroll_` prefixed form names; unprefixed names return EOR schemas with 200. Code lives in `src/gp/`, `src/steps/gp-forms.ts`, `app/api/gp/capabilities/*`, `components/payroll/`. See `docs/gp-capabilities.md`.

```bash
npm run gp:capabilities -- --countries GBR,DEU --strict   # CLI/CI, exits 1 on drift
npm run test:gp-unit                                      # pure unit tests, no network
```

### API Route Headers

Suite and playground API routes accept `X-Company-Slug` and `X-Refresh-Token` headers to override env defaults.

## Testing Constraints

- **Tests hit a real sandbox API** — no mocks. Requires valid `.env` credentials.
- **Tests run sequentially** (`fileParallelism: false` in vitest.config.ts) because they share sandbox state (entity swapping).
- **Entity swapping** — tests in each describe block swap the default legal entity to a specific country. Entity creation is cached to avoid redundant API calls.
- **Unique emails** — employment creation appends `+{timestamp}.{counter}` to avoid collisions.
- **Custom reporter** (`src/reporter.ts`) extracts test IDs from names (e.g., "A1(CM)") and emits SSE events.

## Related Repositories

These projects are always in context — consider cross-repo implications for any changes:
- **tiger**
- **sales-email-tool**
- **json-schema-form**
- **remote-flows**

## Environment Setup

If you use `remote.sh` (`~/.remote_creds` and `~/.remote_companies_{partners,sandbox}`), run `npm run env:sync` to fill `.env` from those files, and `npm run env:check` to check every credential against the API without changing anything. Both are in `scripts/env-sync.mjs`. It parses the files and never executes them, never prints secrets, backs up to `.env.bak`, and keeps company refresh tokens local-only.

Required in `.env` for the deployed app (see `.env.example` for details):
- `CLIENT_ID`, `CLIENT_SECRET` — Partner API OAuth client (Partners sandbox)
- `SANDBOX_CLIENT_ID`, `SANDBOX_CLIENT_SECRET` — Partner API OAuth client (Remote sandbox)
- `GATEWAY_ENV` — Default gateway (`partners` or `sandbox`)
- `JWT_SECRET` — Web dashboard session signing (app refuses to boot without it)
- `AUTH_PASSWORD` — Web UI login password

Optional — local Vitest runs only (NOT used by deployed dashboard; dashboard users connect via the CompanySelector UI):
- `COMPANY_SLUG`, `REFRESH_TOKEN`, `SANDBOX_COMPANY_SLUG`, `SANDBOX_REFRESH_TOKEN`
- `VERBOSE_LOG=1` for API response logging
