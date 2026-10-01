# Transaction source review (#83)

Local implementation on top of #82 commit `e4dbf0118987d1ecee105a74f724e9e1074eb2f4`.
Owner acceptance and deployment remain pending. This UI does not enable ingestion,
retry phone captures, register CAL accounts or change the producer contract.

Owner acceptance update (2026-10-01): the refined interface was accepted as clearer
and better; the synthetic ILS 10 link succeeded without increasing the ILS 22 total.
This limited acceptance does not establish all mobile/concurrency/production-phone
checks. See [#84 integrated readiness](APY_06_RELEASE_READINESS.md) for the remaining
CAL coverage gate and deferred proposed v1.6.0 preparation.

## What the owner sees

Transactions remain the canonical expense list. Compact source buttons appear only
for transactions with server APY evidence:

| Status | Financial meaning |
| --- | --- |
| Apple Pay awaiting CAL | Active canonical expense already included in totals. |
| Supported by both sources | One canonical expense with Apple Pay and CAL evidence. |
| CAL only | Canonical expense with CAL evidence only. |
| Cancelled | Preserved history; not resurrected by source review. |
| Pending source evidence | May have no linked expense. Saving/importing evidence is not another expense. |

The `התאמת עסקאות` button opens pending observations across all dates, independently
of current transaction filters, including observations without a cash row. Nothing
reads phone-local held captures. Financial Data Bridge 3.0.3 treats any 2xx as sent;
its pending response therefore means evidence was saved, not that cash was posted.

Details preserve the canonical description and show Wallet/CAL merchant text separately.
Source transaction date, supplied purchase timestamp (if any), charge date and server
observation time have distinct labels. Date-only evidence never becomes a purchase
timestamp. Card context is method plus a validated masked last4; source credentials,
raw payloads, provider references and unrelated internal identifiers are not exposed.

## Compact review and amount presentation

The queue uses one compact merchant/amount/date/source/card row per report, with a
plain review action and an explicit all-periods scope. Primary controls do not expose
observation IDs, raw payment-method enums, currency codes or ingestion timestamps.
The decision dialog asks whether this is the same purchase and compares the incoming
report against selectable existing expenses, side by side on desktop and stacked on
mobile. Provider names and canonical descriptions remain distinct in either arrival
order. Radio controls and their full labels form one selectable option; none is
preselected. One primary action is disabled until a valid choice and then names the
actual link/separate consequence. Exact lost-response replay remains available even
if the observation has already become linked when reopening the dialog.

Optional details retain report IDs, independent charge/purchase/ingestion evidence.
Calendar dates use the existing date formatter; offset-bearing timestamps display in
Hebrew using Asia/Jerusalem without fractional seconds. An unzoned purchase timestamp
is explicitly labelled as having no supplied timezone, never assigned an inferred one.

Formatting root cause: PostgreSQL numeric values arrive as strings such as
`6.0000000000000000`; MoneyAmount preserves up to 20 decimal places by default.
A shared Transactions row renderer now requests exactly two decimals from the existing
BigInt-based decimal formatter in both desktop and mobile views. Amount transport and
financial calculations are untouched. MoneyAmount shows unavailable data as a dash,
not zero, and determines the sign after display rounding. Other currencies retain
existing precision defaults; no native String Amount contract is changed.

## Review and retry contract

No candidate is preselected. Explicit linking adds provenance, not cash. Explicit
separate-purchase confirmation creates a canonical expense only when the existing APY
command permits it; the dialog explains that effect before submission. Cancel/Escape
without submission changes nothing. Protected/cancelled candidates are unavailable.
Linked observations needing amendment remain inspectable; this screen does not add
an amendment, cancellation or protected-history override workflow.

The browser persists the exact non-secret command in sessionStorage before sending:
UUID, observation revision, chosen action/target and the complete candidate fingerprint
snapshot. Double clicks are blocked. A lost response, reload or dialog reopening retries
that command with the same UUID. Successful decisions clear it and emit the existing
`FINANCE_CHANGED` event to refresh transactions and financial readers. Stale/conflicting
decisions clear the selection, refresh evidence and require renewed owner choice.
Unavailable session storage prevents submission instead of sending an unrecorded command.
No receipt/capture identity or frozen producer payload is changed.

## API and authorization

[Router](../../server/routes/reconciliationRoutes.js) is mounted after the existing
Supabase JWT `requireAuth`. It additionally requires the existing strict server-only
`FLOWLINK_OWNER_USER_IDS` JSON-array allowlist. Missing/malformed configuration fails
closed (503); authenticated non-owners receive 403. Device credentials and external
import API keys do not authorize this API. No new owner identity system is introduced.

| Authenticated route under `/api/reconciliation` | Result |
| --- | --- |
| `GET /summary?ids=1,2` | Up to 100 distinct transaction IDs; authoritative status and global pending count. |
| `GET /pending?before=123` | 50 pending observations, descending stable observation ID, next cursor. |
| `GET /transaction/:id` | Canonical description and safe source evidence. |
| `GET /observation/:id` | Revision, candidates, fingerprints and permitted actions. |
| `POST /observation/:id/resolve` | Shared APY owner decision, never a direct transaction INSERT. |

POST accepts only `request_key` (UUIDv4), `expected_revision` (decimal string), `action`
(`link`/`separate`), `expected_candidate_fingerprints` (ID-to-fingerprint object), and,
for link only, `transaction_id` and `expected_transaction_fingerprint`. IDs are decimal
strings; fingerprints are 32 hex characters. Actor and reason are server-assigned.
Unknown fields/invalid IDs reject. Responses are no-store, rate limit 120/minute,
JSON decision body at most 16 KiB. The normal global JSON parser also bounds parsing.
Missing evidence returns 404; stale decisions 409; disallowed decisions 422; unavailable
service 503. SQL details and input are not returned. More than 100 candidate fingerprints
hold the observation for investigation; no truncated set can authorize a decision.

## Migration and shared financial boundary

[046](../../server/migrations/046_reconciliation_review.sql) adds four private functions:
`apy_ui_observation`, `apy_ui_transaction`, `read_reconciliation`, `review_reconciliation`.
No tables, financial backfill, sources, credentials or data migration. Anonymous and
authenticated database roles cannot execute them; service_role can execute only the
read/review entry points. The server JWT + owner gate is mandatory because service-role
database access bypasses ordinary RLS.

Read projection is a single stable database snapshot. Review retains APY's transaction
table EXCLUSIVE lock first, checks existing command replay, validates the full current
candidate fingerprint set for linking as well as separating, then calls the existing
`resolve_observation`. That command owns revisions, protected-history guards, atomicity,
events and financial effects. There is no new matching algorithm. Identical UUID replay
returns the recorded result before stale checks; changed UUID content rejects safely.

Migrations 001–045 are unchanged. The schema reference appends 046 only. Later deployment
requires 045 followed by 046, schema-cache reload, reviewed owner allowlist and matching
backend before frontend. Snapshot/verify financial data using the existing APY runbook;
neither migration is authorization to enable ingestion. Retain APY schema/provenance on
failure and forward-fix. The #82 simple-ILS/FX coverage activation gate remains intact.

## Local review using the existing isolated application

Automated tests use fresh disposable PostgreSQL containers. The existing normal local
app is at `http://localhost:5173`, backend `http://127.0.0.1:5050`, isolated Supabase API
`http://127.0.0.1:55421`, database container `supabase_db_finance-shopping92` (host port
55422). Local setup completed on 2026-10-01: migrations 045 then 046 applied, schema
cache refreshed, and the sole existing local user's UUID added to the isolated owner
allowlist. Only the isolated backend was restarted. Normal environment files,
credentials, other settings and both disabled ingestion flags were preserved.

Before/after checks verified every pre-existing public-table row was preserved and
all Shopping tables (including saved receipts/corrections) remained exactly unchanged.
The fixture ran once: three synthetic expenses totaling ILS 22 and three unresolved
CAL observations, with two distinct ILS 6 expenses. The owner subsequently linked the ILS 10 observation. Its reconciled state is
preserved; both distinct ILS 6 expenses and their two unresolved CAL observations
remain for review. This UX refinement does not reset or reseed the fixtures.

Open [the filtered local Transactions page](http://localhost:5173/transactions?month=2026-09&paymentSourceId=2)
and choose `התאמת עסקאות`. Payment source 2 is the local `APY83 — synthetic local review`
fixture, not a production mapping. Authenticated pending/summary/detail endpoints and
the payment-source list returned 200; unauthenticated review returned 401. Served Vite
modules were checked for the loopback backend/Supabase targets. Health and frontend
returned 200. The single browser initialization retry still failed on the missing
bundled browser-service dependency: visual, responsive/theme and interactive browser
checks remain unverified; prior automated behavioral evidence is unchanged.

The following records the setup procedure for reproducibility; the owner does **not**
need to repeat it for this prepared instance. Never run these commands against a remote
database or blindly rerun migrations/fixtures.

1. Verify that the named container is the existing isolated database, and that the
   ignored `server/shopping92.env.local` still targets the loopback API above. Preserve
   every existing setting/credential. Verify its migration baseline is through 044.
2. Apply only the missing local migrations, with explicit error stops:

   ```powershell
   $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
   Get-Content -Raw -Encoding UTF8 server/migrations/045_cal_reconciliation.sql | docker exec -i supabase_db_finance-shopping92 psql -U postgres -d postgres -v ON_ERROR_STOP=1
   if ($LASTEXITCODE -ne 0) { throw 'Stop: local 045 failed' }
   Get-Content -Raw -Encoding UTF8 server/migrations/046_reconciliation_review.sql | docker exec -i supabase_db_finance-shopping92 psql -U postgres -d postgres -v ON_ERROR_STOP=1
   if ($LASTEXITCODE -ne 0) { throw 'Stop: local 046 failed' }
   docker exec supabase_db_finance-shopping92 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"
   ```

3. In that **ignored isolated env file only**, set `FLOWLINK_OWNER_USER_IDS` to the JSON
   array containing the UUID of the existing local signed-in Supabase user. Inspect
   local `auth.users` to identify it; do not copy production identities or credentials.
   Both ingestion flags stay false. Restart the existing isolated launcher:

   ```powershell
   powershell -NoProfile -File "$env:TEMP/finance-shopping92/restart-server.ps1"
   ```

4. Optional synthetic review fixtures create **three local expenses totaling ILS 22**
   and three unlinked CAL observations, under their own labelled payment source.
   They contain no real capture IDs and do not run the importer. The opt-in script is
   repeatable without extra cash, but must never be used in production:

   ```powershell
   $fixture = "SET apy83.local_review='yes';`n" + (Get-Content -Raw -Encoding UTF8 server/test/fixtures/reconciliationReview.sql)
   $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
   $fixture | docker exec -i supabase_db_finance-shopping92 psql -U postgres -d postgres -v ON_ERROR_STOP=1
   if ($LASTEXITCODE -ne 0) { throw 'Stop: isolated fixture failed' }
   ```

5. Open Transactions, choose September 2026 and the synthetic payment source. Inspect
   the Apple Pay buttons: these three cash rows are already counted. Open source review:
   the three CAL observations are unlinked, not three more expenses. Link the ILS 10
   Ninja evidence explicitly; its canonical owner description stays unchanged. The two
   ILS 6 candidates remain separate legitimate purchases; choose each only after review.
   No Israel Post/Nayax alias is created. Cancellation changes nothing.
6. In two tabs review the same observation, resolve in one, then submit in the other;
   require refreshed evidence/new choice. Test keyboard Tab/Escape/focus restoration,
   light/dark themes and narrow/mobile widths. Separate-purchase choice explains its
   extra expense and is for intentionally separate synthetic purchases only.

## Verification boundaries

- HTTP authorization/validation and safe envelopes:
  [tests](../../server/test/reconciliationReview.test.js).
- Actual SQL/HTTP persistence, both arrival orders, concurrent decisions, identical
  replay, separate cash once, owner fields, void protection, grants, upgrade/rerun and
  unchanged financial snapshot: [disposable suite](../../server/test/reconciliationReviewPostgres.local.test.js).
- UI choices, pending versus cash, provider/canonical text, stale refresh, duplicate
  clicks/lost response, focus and safe authorization failure:
  [behavioral suite](../../client/src/pages/Transactions/Reconciliation.test.jsx).
- #82 financial regressions remain applicable. Its two independently reproduced
  v1.5.0 baseline failures are not new #83 results; no unrelated assertions were changed.
- Actual desktop/mobile visual review remains pending: browser runtime initialization
  failed with a missing bundled `browser-service.mjs`. No screenshots or production/
  physical-device checks are claimed. Exact final counts are in the #83 handoff.

Release impact Yes; anticipated SemVer Minor (new backward-compatible owner workflow).
Candidate TBD; grouping follows APY #78, subject to #84 revalidation against published
1.5.0. CHANGELOG updated under Unreleased. Version bump deferred to owner-coordinated
release preparation; all seven fields stay 1.5.0. Publication out of scope; owner
acceptance pending. No deployment or ingestion activation was performed.
