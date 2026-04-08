# Test Contractor Demo App

Explore contractor product availability (CM, CM+, COR) across countries, legal entities, and products using Remote's partner API. Run onboarding scenarios interactively without writing code.

## Prerequisites

- Node.js 18+
- npm
- Remote partner API credentials (client ID, client secret, refresh token)

## Setup

```bash
# Install dependencies
npm install

# Copy environment template and fill in your credentials
cp .env.example .env
```

Edit `.env` with your credentials from the Remote partner dashboard:

| Variable | Where to find it |
|----------|-----------------|
| `CLIENT_ID` | Partner Dashboard → Settings → API Credentials |
| `CLIENT_SECRET` | Partner Dashboard → Settings → API Credentials |
| `REFRESH_TOKEN` | Partner Dashboard → Settings → API Credentials |
| `COMPANY_SLUG` | Partner Dashboard → Companies → click company → UUID in URL |
| `GATEWAY_URL` | Use `https://gateway.partners.remote-sandbox.com` for sandbox |

## Run

```bash
npm start
```

Opens the dashboard at `http://localhost:3939`.

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
