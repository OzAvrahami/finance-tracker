# Development and operational entry points

Run commands from the repository root unless stated otherwise. Use the normal
frontend/backend for owner review, with safe isolated test data for mutations.

## Install and run

The root, client and server manifests require Node `^20.19.0 || >=22.12.0`.
Client and server have committed lockfiles; there is no root lockfile.

```powershell
npm ci --prefix server
npm ci --prefix client
```

Configure local `server/.env` and `client/.env` from their examples without changing
production configuration. Then use separate terminals:

```powershell
npm run dev --prefix server
npm run dev --prefix client
```

Vite defaults to port 5173. Express defaults to 5050 (`PORT` overrides it).
`npm start` at the root delegates to the server; root `postinstall` invokes
`npm install --prefix server`. Prefer explicit locked installation above for a
reproducible local checkout. `npm run preview --prefix client` serves a previously
built client, not an independent backend or synthetic data environment.

Starting the application does not create tables or apply migrations. See the
[database boundary](DATABASE.md) before configuring a fresh development database.

## Configuration authority

Use [client/.env.example](../../client/.env.example),
[server/.env.example](../../server/.env.example) and their source validators.
This guide does not reproduce every field and thereby create a second config schema.

- Client: `VITE_API_URL` defaults to `http://localhost:5050/api` in
  [api.js](../../client/src/services/api.js). Supabase URL/anon key serve browser Auth.
- Server startup requires `SUPABASE_URL`, privileged `SUPABASE_KEY`,
  `EXTERNAL_API_KEY` and `LOAN_JOB_SECRET` in [index.js](../../server/index.js).
  Never put privileged keys in `VITE_*` values.
- Optional Rebrickable, Savings scheduler, Apple and FlowLink boundaries have their
  own validators. The Savings job uses `SAVINGS_JOB_SECRET` and
  `SAVINGS_JOB_ENABLED` in
  [savingsJobAuth.js](../../server/middleware/savingsJobAuth.js).
- Apple and native FlowLink ingestion have independent disabled-by-default flags.
  Enrollment/status availability does not imply money-write enablement. Use the
  [native owner rollout](FLOWLINK_OWNER_ROLLOUT.md) and binding guide, not the
  superseded complex Shortcut setup, for separately authorized native operations.

Missing startup configuration, CORS failure and an intentionally disabled adapter
are different conditions. Do not change authentication or point tests at production
to make a local preview work.

## Checks and their scope

```powershell
npm test --prefix server
npm test --prefix client
npm run lint --prefix client
npm run build --prefix client
git diff --check
```

[server/test/run-tests.js](../../server/test/run-tests.js) recursively discovers
`*.test.js` and excludes `*.local.test.js`; [setup.js](../../server/test/setup.js)
supplies fake test configuration. Client Vitest discovery/setup is in
[vite.config.js](../../client/vite.config.js). Native checks require Xcode on macOS;
see [FlowLink](../../ios/FlowLink/README.md).

Disposable PostgreSQL tests are explicit separate commands, not part of the ordinary
server suite. Their fixtures, Docker requirements and migration stage matter; see
[database verification](DATABASE.md#verification-consumers). Do not execute the
networked Supabase diagnostic scripts as if they were offline unit tests.

No general test/build CI workflow is present. Select checks appropriate to the diff
and record actual results. Historical four-Import-test failures are evidence at
their recorded baseline, not permission to assume any future failure is pre-existing.

## Deployment and scheduled work

[client/vercel.json](../../client/vercel.json) owns the SPA fallback.
Root `npm start` / server `index.js` are backend entry points. Provider deployment
triggers are externally configured; a main push may deploy. This repository does not
prove Railway/Vercel trigger settings or current environment values.

For the prepared v1.5.0 candidate, root [railway.json](../../railway.json) selects
[Dockerfile.backend](../../Dockerfile.backend): repository-root context, locked
server-only installation and the shared calculation modules. Changing the existing
provider source root requires a controlled owner cutover. Follow the
[Shopping packaging/settings and hold runbook](SHOPPING_RECEIPTS.md#packaging-correction-and-provider-settings),
including unresolved Vercel preview isolation, before pushing or merging. Use
`python docs/operations/verify_deployment_package.py` for clean local artifact checks.

Express trusts the first proxy; its explicit general CORS list includes localhost:5173
and one Vercel origin. Dedicated Apple/FlowLink routers apply their own narrow
authentication and request controls before the general middleware. Do not broaden
those boundaries during setup.

[process-due-loans.yml](../../.github/workflows/process-due-loans.yml) declares daily
07:15 Asia/Jerusalem scheduling and manual dispatch, calling the protected internal
endpoint with `LOAN_JOB_URL` / `LOAN_JOB_SECRET`. It processes due occurrences, not
future bank activity. No separate Savings scheduler workflow is checked in; an API
and configuration existing do not prove a scheduler is enabled.

Deployment success is not runtime/device acceptance. Preserve the distinction between
database migration, application deployment, credential provisioning, flag enablement
and owner acceptance in every operator handoff.
