# Finance Tracker

Personal finance in a Hebrew RTL web interface: transactions, funded monthly Budget,
Loans, named Savings, reporting, spreadsheet imports, Shopping, Tasks and LEGO.
React/Vite frontend, Express backend and Supabase PostgreSQL/Auth, with a native
SwiftUI FlowLink companion in the same repository.

**Start with the [documentation index](docs/README.md)** for setup, architecture,
database guidance, operator instructions and historical evidence.

[v1.8.0 is the latest published release](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.8.0).
[v2.0.0 is prepared locally and unpublished](docs/history/RELEASE_2_0_0.md).
All seven application-version fields read 2.0.0. The candidate covers #102 Shopping
hierarchy, catalog administration and JavaScript workflows, plus the integrated #99
manual-refund entry correction. Other Unreleased work retains its existing status.
Shopping production activation was verified on 2026-11-14; final owner production
acceptance remains pending. This version preparation does not redeploy that code.
The owner waived a pre-migration backup; hosted recovery remains unverified.
Real-provider/OCR flows and irreversible financial transactions were not production
smoke-tested. See the release notes for evidence and coordinated upgrade requirements.
This privately controlled application is not a tenant-isolated SaaS product; v2.0.0
does not introduce multi-user isolation. FlowLink version/build numbers are independent.

## Local development

Use Node satisfying `^20.19.0 || >=22.12.0` and npm. Configure an isolated development
backend using the checked-in environment examples; never copy production secrets
into frontend configuration. See [development setup](docs/operations/DEVELOPMENT.md).

```powershell
npm ci --prefix server
npm ci --prefix client
# Separate terminals:
npm run dev --prefix server
npm run dev --prefix client
```

The default frontend is `http://localhost:5173`; the backend is
`http://localhost:5050`. Starting them does not initialize a database.

## Repository

| Location | Responsibility |
| --- | --- |
| [client](client) | React screens, shared UI and colocated tests |
| [server](server) | HTTP/auth, financial services, database history and tests |
| [ios/FlowLink](ios/FlowLink/README.md) | Native companion and device verification guide |
| [docs](docs/README.md) | Current contracts, operations and historical records |
| [.github](.github) | Issue forms, release configuration and due-loan scheduler |

The owner performs commits and production operations. Follow [AGENTS.md](AGENTS.md)
and the canonical [development standard](docs/github-development-standard.md),
including its Release / Version gate. [CHANGELOG.md](CHANGELOG.md) records changes;
[GitHub Releases](https://github.com/OzAvrahami/finance-tracker/releases) establishes
publication. This private project has no canonical root redistribution license.
