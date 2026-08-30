# Finance Tracker

## Overview

Finance Tracker is a personal financial-management application for recording and reviewing:

- transactions, categories, and payment sources;
- monthly budgets and annual summaries;
- loans and authoritative loan-payment accounting;
- spreadsheet imports and an external transaction API;
- shopping lists, tasks, and settings; and
- a LEGO collection with acquisition and transaction-cost metadata.

The application is designed for a personal finance workflow. It is not presented as a multi-tenant SaaS product.

## Current maturity

Development began in early 2026 and the application has a broad operational feature set. Formal semantic release tracking began with v0.9.0.

**v1.0.0** is the current stable release and is suitable for regular personal use. **v0.9.0** remains the first formally tracked baseline. Stable does not mean feature-complete: architectural stabilization and new product capabilities remain active work.

See [Project Status](docs/PROJECT_STATUS.md) for current readiness and known limitations.

## Features

- Dashboard KPIs and monthly financial trends
- Searchable, keyset-paginated transactions
- Direct, itemized, installment, and loan-linked transaction workflows
- Category and payment-source management
- Monthly budgets and annual summaries
- Legacy-compatible and principal-aware loan accounting
- Manual, automatic, irregular, catch-up, adjustment, and early-payoff loan events
- Spreadsheet import profiles and API-based transaction ingestion
- Shopping lists with catalog and checkout workflows
- Tasks linked to transactions or loans
- LEGO purchase allocation, Gift/GWP tracking, collection synchronization, and Rebrickable metadata
- RTL-first Finance v3 interface with light and dark themes

## Architecture at a glance

```mermaid
flowchart LR
    Browser[Browser] --> React[React SPA]
    React -->|JWT REST API| Express[Express server]
    Express -->|Supabase service client| PostgreSQL[(Supabase PostgreSQL)]
    React -.->|Authentication| Auth[Supabase Auth]

    Actions[GitHub Actions scheduler] -->|LOAN_JOB_SECRET| Job[Internal due-loan endpoint]
    Job --> DueService[Due-loan service]
    DueService -->|Atomic RPC| PostgreSQL
```

Primary application flow:

```text
React
  -> Express REST API
    -> Supabase service client
      -> PostgreSQL
```

Node handles HTTP validation, orchestration, pricing and amortization inputs. PostgreSQL owns important atomic financial mutations, loan-summary refreshes, pagination, and dashboard aggregation.

## Repository structure

```text
client/                 React SPA, Finance v3 UI, tests, and Vercel SPA config
server/                 Express API, business services, migrations, and server tests
server/migrations/      Ordered schema history, currently 001 through 018
server/full_schema.sql  Consolidated schema reference
docs/                   Canonical documentation and a retained read-only security audit
.github/workflows/      Daily due-loan scheduler
```

## Technology stack

- React 19, React Router, Axios, Recharts, date-fns, and Lucide React
- Vite 7 with the SWC React plugin
- Plain CSS using Finance v3 design tokens and shared UI components
- Express 5 on Node.js
- Supabase Auth, Supabase JS, and PostgreSQL
- Vitest and Testing Library on the client
- Node's built-in test runner on the server
- XLSX import and Rebrickable metadata integration

## Prerequisites

- Use **Node.js 20.19+ or 22.12+**. The package engines express this as `^20.19.0 || >=22.12.0`; supported Node 24 releases also satisfy that range.
- npm
- Access to a compatible Supabase project for database-backed development

Root, client, and server package metadata use the stable `1.0.0` product version.

## Getting started

### Install

From the repository root:

```bash
npm install
npm install --prefix client
```

The root post-install script installs server dependencies. Installing within `server/` explicitly is also supported:

```bash
npm install --prefix server
```

### Client

```bash
npm run dev --prefix client
```

### Server

```bash
npm run dev --prefix server
```

The root production-style start command launches the server:

```bash
npm start
```

## Environment configuration

Do not commit secrets. Environment variables verified in source include:

| Variable | Scope | Required | Purpose |
|---|---|---:|---|
| `VITE_API_URL` | Client | No | Express API base URL; defaults to `http://localhost:5050/api` |
| `VITE_SUPABASE_URL` | Client | Yes | Supabase project URL used for browser authentication |
| `VITE_SUPABASE_ANON_KEY` | Client | Yes | Supabase anonymous browser key |
| `SUPABASE_URL` | Server | Yes | Supabase project URL |
| `SUPABASE_KEY` | Server | Yes | Privileged server-side Supabase credential expected by server database access |
| `EXTERNAL_API_KEY` | Server | Yes | Protects external transaction ingestion |
| `LOAN_JOB_SECRET` | Server/job | Yes | Protects the internal due-loan job endpoint |
| `REBRICKABLE_API_KEY` | Server | No | Enables Rebrickable metadata lookup |
| `PORT` | Server | No | Express listen port; defaults to `5050` |

Copy [client/.env.example](client/.env.example) and [server/.env.example](server/.env.example) for local configuration. Never expose server credentials in client-side `VITE_*` variables. `LOAN_JOB_URL` is a GitHub Actions secret naming the deployed protected endpoint; it is not a server process variable.

## Database and migrations

Schema history is stored in `server/migrations/`, currently from Migration 001 through Migration 018. [server/full_schema.sql](server/full_schema.sql) is a consolidated reference for the intended current schema. Migration 017 introduces the funded-budget foundation and Migration 018 adds recurring monthly defaults with explicit funded initialization. Migration 018 has not been applied to production.

Funded-budget monetary API values are exact canonical decimal strings. Authoritative mutation endpoints reject JSON numbers rather than stringifying values that may already have lost precision; PostgreSQL `NUMERIC` remains the authority. JavaScript numeric conversion is limited to non-authoritative visual geometry and percentages.

A read-only production catalog verification on 2026-08-15 confirmed the repository-era objects expected through Migration 015, plus the older `transactions.external_id`, partial unique index, and `get_unique_tags()` prerequisites. Migration 016 brought those previously unversioned prerequisites into repository history and was subsequently applied and independently verified read-only. This verifies the resulting object state, not an authoritative migration execution ledger.

Important limitations:

- The repository does not currently contain a canonical migration runner or authoritative applied-migration ledger.
- A migration file being present does **not** prove that it has been applied to a production database.
- Verify the target database and its applied migration state independently before running SQL.
- `full_schema.sql` is a reference, not a substitute for testing the ordered migration boundary.

Never apply migrations or private repair scripts without a reviewed backup, scope, and execution plan.

## Development commands

```bash
# Client development server
npm run dev --prefix client

# Server with Node watch mode
npm run dev --prefix server

# Client production build
npm run build --prefix client

# Client preview
npm run preview --prefix client
```

## Testing and quality checks

```bash
# Client tests
npm test --prefix client

# Client lint
npm run lint --prefix client

# Client production build
npm run build --prefix client

# Server tests
npm test --prefix server

# Whitespace/error check before commit
git diff --check
```

There is currently no general CI workflow that runs all test, lint, and build gates. These checks must be run and recorded manually until one is added.

The server test command recursively discovers canonical `*.test.js` files and excludes `*.local.test.js`. Local tests may depend on ignored/private operational artifacts; canonical tests use a test-only environment bootstrap with non-secret defaults and do not require `server/.env` or live services.

## Authentication and security model

- Supabase Auth supplies browser sessions.
- Normal application APIs validate the Supabase bearer token.
- The external transaction API uses `EXTERNAL_API_KEY`.
- The scheduled loan job uses `LOAN_JOB_SECRET`.
- The Express server performs privileged Supabase database access.
- Sensitive loan operations are exposed through narrowly granted PostgreSQL RPCs; internal helpers are not intended as public APIs.

The current data model is effectively single-user: financial tables do not implement per-user row ownership. Authentication should not be interpreted as proven multi-tenant isolation.

## Deployment contract

- [client/vercel.json](client/vercel.json) provides the repository-supported Vercel SPA rewrite.
- Backend hosting remains provider-neutral in repository configuration; the production Railway runtime was manually verified as Node.js 22.23.2 during the v0.9.0 release review.
- The server CORS allowlist contains localhost and one Vercel client origin. The deployed Vercel origin was manually verified to match that allowlist during the release review.

## Scheduled loan processing

[.github/workflows/process-due-loans.yml](.github/workflows/process-due-loans.yml) runs a daily job and also supports manual invocation. It calls a protected internal server endpoint, which:

1. resolves the business date in Asia/Jerusalem;
2. selects eligible active `loan_payments`-mode loans;
3. calculates the financial split in the server service; and
4. invokes an idempotent atomic PostgreSQL RPC for one due installment.

The scheduler does not generate future ledger rows. CPI-indexed loans are deliberately excluded because live CPI calculation is not implemented.

The workflow runs at `07:15` in `Asia/Jerusalem` and supports manual dispatch. It requires GitHub Actions secrets `LOAN_JOB_URL` and `LOAN_JOB_SECRET`. The latest scheduled production run was manually verified successful during the v0.9.0 release review; repository configuration still does not expose or prove secret values.

## Important architectural notes

- `transactions` is the cash/card ledger; `loan_payments` is authoritative loan accounting.
- `transactions.loan_id` is a relationship and does not by itself make a transaction an installment.
- Legacy loan calculation remains available for compatibility.
- Manual and automatic loan-payment mutations use PostgreSQL RPCs for atomicity.
- Item, LEGO, keyword, import, and shopping workflows still contain multi-call boundaries documented in [Architecture](docs/ARCHITECTURE.md).
- Import is a separate ingestion path and does not automatically inherit every Add Transaction side effect.
- External v1 requests accept tags as an array, which the server serializes to the existing comma-separated `transactions.tags` TEXT representation. Individual tag values cannot contain commas.
- Finance v3 is the current UI architecture; Finance v2 is historical/intermediate.

## Documentation

- [Project status](docs/PROJECT_STATUS.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Technical decisions](docs/DECISIONS.md)
- [Changelog](CHANGELOG.md)

## Versioning

Formal semantic-version-style tracking began with **v0.9.0**, the first finalized baseline. **v1.0.0** is the first stable release.

The private root, client, and server application packages are aligned to version `1.0.0`.

Earlier development is recorded as historical milestones rather than assigned fictional versions. Future releases should document changes under `Unreleased`, move them into a dated release section when release content is finalized, and keep repository tags, package metadata, and documentation aligned.

## License / project status

This is a private personal project considered stable for regular use. No canonical root license file currently establishes redistribution terms.
