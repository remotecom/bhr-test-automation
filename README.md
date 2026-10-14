# Test Contractor Demo App

Explore contractor product availability (CM, CM+, COR) across countries, legal entities, and products using Remote's partner API. Run onboarding scenarios interactively without writing code.

## Prerequisites

- Node.js 18+ and npm
- Remote Partner API client credentials (client ID and secret) for the partners sandbox and/or the Remote sandbox

## Setup

```bash
npm install
npm run env:sync      # creates .env from .env.example and generates JWT_SECRET
```

Then fill in `.env`:

| Variable | What it is |
|----------|-----------|
| `CLIENT_ID`, `CLIENT_SECRET` | Client credentials for the partners sandbox |
| `SANDBOX_CLIENT_ID`, `SANDBOX_CLIENT_SECRET` | Client credentials for the Remote sandbox |
| `AUTH_PASSWORD` | Password for the dashboard login page |

Run `npm run env:check` to test every credential against both gateways (read-only). It tells you which one fails and why.

**Companies:** the dashboard doesn't need one in `.env`. Open the company selector in the header and click **Create Fresh Company**, or paste a refresh token. `COMPANY_SLUG` / `REFRESH_TOKEN` (and the `SANDBOX_` versions) are only used by `npm test` and the GP command-line report. Never add them to Vercel.

### Optional: import from remote.sh

If you already use `remote.sh` (the Remote API toolkit on Notion), `npm run env:sync` also copies your client credentials from `~/.remote_creds` and a saved company from `~/.remote_companies_partners` / `~/.remote_companies_sandbox`, so you don't paste anything:

```bash
npm run env:sync -- --partners ACME --sandbox ACME   # choose which saved companies to use
```

It's not worth setting up remote.sh just for this app: filling in `.env` by hand is quicker. Your other `.env` lines are kept, and the previous file is saved as `.env.bak`.

## Run

```bash
npm run dev           # dashboard at http://localhost:3000
```

`npm start` runs the older local dashboard on port 3939, which has its own copy of the test cases.

## Tabs

### Playground

Run a single contractor onboarding scenario interactively:
1. Select an entity country (legal entity location)
2. Select a contractor country (where the contractor is based)
3. Optionally pick a target product (CM, CM+, or COR)
4. Click "Run Scenario"

The live trace shows each API call as it happens. The result panel shows available products, subscription pricing, and a parallel eligibility check from the entity-level API.

### Test Suite

Automated test paths that validate contractor onboarding flows:
- CM path (standard contractor management)
- CM+ path (plus subscription)
- COR path (contractor of record)
- COR + IR35 path (UK-specific)
- EOR fallback path
- Read-only API checks

Click "Run All Tests" to execute the full suite. Results stream live.

## Architecture

```
src/
├── client.ts              # OAuth2 API client (dual grant types, token caching)
├── trace.ts               # Live event emitter for dashboard
├── dashboard/
│   ├── run.ts             # HTTP server + API routes + SSE
│   ├── playground.ts      # Interactive scenario runner
│   └── index.html         # Dashboard UI
├── setup/
│   └── entity-swap.ts     # Sandbox entity creation/swapping
└── steps/                 # Reusable API step modules
    ├── countries.ts       # Country catalog
    ├── employment.ts      # Create/cancel employments
    ├── subscriptions.ts   # Product subscriptions
    ├── eligibility.ts     # Entity-level eligibility check
    ├── questionnaire.ts   # COR questionnaire
    ├── contract-details.ts# Contract submission
    └── invite.ts          # Contractor invite / COR reserve
```
