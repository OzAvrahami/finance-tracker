# Savings implementation handoffs

## Current integrated Savings handoff — 2026-09-15

The owner approved the SAV-08 integrated-verification and release-preparation handoff. #37–#44 are completed / Done; #44 is independently verified Closed / Completed / Done with P2 — Medium and its existing metadata and relationships preserved. This uses the recorded technical evidence and actual owner confirmations, without inferring additional numerical/device or production checks. Parent #36 and milestone v1.3.0 remain open. The separate seven-field version step is now prepared at **1.3.0** on `feat/savings-v1.3.0`; the reviewed work is prepared for an owner-operated commit and remains uncommitted/unpublished at this handoff. Production migrations030–035 and deployment are not executed. The [canonical runbook and transfer instructions](RELEASE_1_3_0.md) record the inventory, existing verification, recovery limits and remaining owner-controlled workflow.

Earlier stage-status and acceptance notes below are historical; this current handoff supersedes their pending-review wording without changing the recorded test evidence.

## Historical acceptance and SAV-07 status — 2026-09-14

The owner confirmed “הכל נראה תקין גם המשימות האחרות”, covering #40 realized interest, #41 funded Budget-surplus transfers and #42 monthly deposits. Together with the implementation and executed technical evidence in their handoffs below, this completes those stages. This records that the features look correct; it does not invent specific owner test executions, production checks or deployment acceptance. Earlier pending/deferred-review notes below describe the state at those historical handoffs and are superseded by this confirmation.

Independent GitHub readback: #40 Closed / Completed / Done / P2 — Medium; #41 Closed / Completed / Done / P1 — High; #42 Closed / Completed / Done / P2 — Medium. Existing membership, labels, assignees, milestone v1.3.0, parent #36 and native dependencies remain. #43 is Open / Verify / P2 — Medium for owner review. #44 has not started. Work remains local/uncommitted; production rollout remains owner-controlled.


Local implementation for [#38](https://github.com/OzAvrahami/finance-tracker/issues/38), 2026-09-12. The approved contract is [SAVINGS_V1_3_0_SPEC.md](SAVINGS_V1_3_0_SPEC.md); its incoming SAV-01 handoff hash was `d03d510a1791e9135440d495de2465a17c4c3f71a32a6cffb1c92fa501ce6b70`. This work is uncommitted and not deployed. On 2026-09-13 the owner explicitly accepted SAV-02: “בנוגע לחסכון מאושר אפשר להתקדם”. This is owner-reported acceptance, not a claim about individual checks performed. #38 was independently read back as Closed / Completed / Done, P1 — High, with its existing milestone and relationships preserved. Production installation and deployment remain pending. Package versions remain 1.2.0; v1.3.0 is a milestone, not a published version.

Historical SAV-07 preview: http://127.0.0.1:5182/savings. SAV-07 and SAV-08 have since been accepted and completed; see the current handoff above. Windows preview processes and disposable persistence do not transfer through Git.

## SAV-02 delivered behavior (historical scope; SAV-03 additions below)

Savings navigation opens a Finance v3 account page with four all-time summary cards, active/archived collections, goals, account details and immutable event history. Create/edit dialogs store provider, product/reference, purpose, optional goal/rate/terms/liquidity, notes and monthly settings. Money remains decimal text through PostgreSQL, PostgREST, Node and React; BIGINT identifiers/revisions are cast to text before JSON decoding. Ratios are approximate display values only.

Creation requires an independently confirmed opening amount and explicit legacy-overlap amount, including zero. The opening is at the beginning of the tracking day; included earlier cash must not be relinked later. Configuration edits cannot change either opening date or the ledger. Archive preserves balances/history, disables automation and prevents new ordinary postings. Reaching a goal is informational. Monthly plans are stored with clipped calendar due dates and revisions, but automatic processing remains disabled. A plan with an outstanding due occurrence cannot silently move that occurrence; settling/skipping it belongs to later commands.

At the SAV-02 handoff, these authenticated Express endpoints existed (mounted after `requireAuth`):

| API | Database operation |
| --- | --- |
| `GET /api/savings` | Paginated service-only SELECT of `savings_account_summary`; full collection, text IDs |
| `POST /api/savings` | `create_savings_account(UUID,JSONB,TEXT,TEXT,TEXT)` |
| `GET /api/savings/:id` | `get_savings_account(BIGINT,DATE,DATE,BIGINT,INTEGER)`; optional `from`, `to`, `before`, `limit` |
| `PATCH /api/savings/:id` | `update_savings_account(BIGINT,BIGINT,UUID,JSONB)` |

Create payload: `request_key`, `account`, `opening_amount`, `legacy_overlap_amount`, optional `overlap_reason`. PATCH: `request_key`, `expected_revision`, partial `account`. Omitted configuration fields persist; explicit null clears optional fields. Exact nonnegative monetary strings have at most two decimals; goals/monthly amounts must be positive. Dates use strict calendar strings. New reference selections must be active. Malformed inputs and stale revisions return actionable Hebrew errors. Same request retries are idempotent; conflicting reuse is rejected. Config receipts retain the last accepted request, as specified, rather than pretending to provide a separate permanent configuration ledger.

At the SAV-02 handoff no downstream command endpoint or callable placeholder existed. SAV-03 now implements the manual subset below; #39 owns deposits, withdrawals, corrections, cancellation and detached-cash void; #40 owns realized interest; #41 owns transfers, policy activation and Budget overloads; #42 owns monthly processing; #43 owns expanded reporting. Descriptive interest and monthly settings do not execute those operations. SAV-02 withheld these categories; SAV-03 now exposes only deposit and withdrawal through its dedicated dispatch.

## Migration and actual inventory

The next available migration was [030_savings_foundation.sql](../server/migrations/030_savings_foundation.sql). The identical migration is appended to [full_schema.sql](../server/full_schema.sql). Historical migrations 001–029 are unchanged.

| Object group | Actual #38 change |
| --- | --- |
| New physical tables | Exactly `savings_accounts`, `savings_entries`, with their two identity sequences |
| New view | Exactly `savings_account_summary`, ordinary/nonmaterialized |
| Existing tables with structural changes | `categories`, `transactions`, `budget_unused_balance_policies`, `budget_operations`, `budget_operation_items`, `budget_savings_entries` |
| Guard-only existing tables | `transaction_items`, `loan_payments`; no Loan columns, grants, calculations or existing functions/triggers changed |
| Existing views replaced | `budget_category_composition`, `budget_month_category_actuals`, `budget_unused_balance_policies_read` |
| New function signatures | Three account RPCs above and nine foundation helpers in specification §9: 12 total |
| Existing functions replaced | The 17 Budget actuals readers below, five general cash readers and five structural Budget validators: 27 distinct names |
| New trigger attachments | All 11 named attachments in specification §9; old attachments retained |

The full initiative's 10 public Savings RPCs, two Budget overloads, 11 helpers and 31 existing function replacements remain the complete **future** inventory, not a claim that all are implemented here. No goal, provider, schedule, job, earnings or cached-balance table was added. The existing Budget boundary stays 11 physical tables / 9 views; on the inspected application baseline the total changes from 26/9 to 28/10.

The foundation reserves new Budget operation/item types, destination FK and event provenance; named-account transfer/policy execution is explicitly rejected until #41. Opening-overlap retirement is implemented now using the existing operation/item/reserve history. It changes neither cash nor funded envelope amounts. Example: declared account opening 1,200, old reserve 500, proven overlap 300 produces held Savings 1,200 and retained reserve 200; union value is 1,400, not 1,700. Insufficient/unknown overlap or invalid account configuration rolls the whole operation back. Future same-month and cross-month transfer examples remain design cases in the canonical specification, not delivered transfer commands.

New tables have RLS and no browser/service direct mutation grants, including TRUNCATE. RPC/trigger functions use qualified relations and fixed `pg_catalog,public,pg_temp` search paths; untrusted public CREATE is removed/checked. Existing transaction table-wide UPDATE grants are converted to old-column grants for each existing grantee, preserving ordinary writes while protecting all four void fields. At the SAV-02 boundary only the three account RPCs and the read-only `budget_actual_transactions(DATE,DATE)` helper have service EXECUTE; the summary view has service SELECT. Mutating helpers are not API entry points. Existing single-user authentication remains the boundary; this does not introduce tenant isolation.

Account commands require READ COMMITTED, take the transaction serialization lock first, then receipt/legacy-reserve locks and ordered referenced rows. The deferred foundation validator inspects the final ledger, follows original-post replacement roots, locks related cash and checks account prefixes/signed totals. Its conservative complete-ledger scan is deliberate for this compact single-user foundation; optimize only with equivalent reverse-link/concurrency coverage. The additional Loan-side guard locks cash and then rereads the relationship, protecting both link orders without invoking Savings mutations. Prefix example: opening 0, deposit 100, withdrawal 80; replacing that deposit with 150 gives 70 at its original same-day position, replacing it with 70 fails, then replacing 150 with 160 gives 80. Fixtures exercise these guards without exposing #39 commands.

## Baseline transaction-reader audit

| Reader / path | Classification and delivered handling |
| --- | --- |
| `transactions_filtered`, `transactions_page` | Live lists, cursor pages and totals exclude `voided_at` rows before sorting/counting. SAV-03 extends the two signatures with optional account filtering and historical detail lookup; existing calls and transaction-date semantics remain supported. |
| `dashboard_summary`, `dashboard_monthly_series`, `get_unique_tags` | Live aggregates/tag choices filter tombstones. Dashboard controller consumes these RPCs. |
| Budget composition/month actuals views; Budget/Annual controller direct reads | All actuals route through service-executable, read-only `budget_actual_transactions`. Ordinary live amounts are unchanged; validated funded-transfer exclusion remains #41. |
| 17 Budget functions listed below | Every actuals input uses the same helper, including finiteness and eligibility reads; transaction serialization locks stay intact. |
| `transactionController.getTransactionById` | Historical detail intentionally retains the record, adds `read_only`, and includes immutable cancellation reason. The edit route renders cancelled history without form/save controls. |
| `taskController` nested `transactions(...)` in list/create/update | Historical relationship retains transaction identity and `voided_at`; task cards label cancelled cash as read-only and link to historical detail. |
| External v1 `external_id` lookup, including unique-key race reread | Tombstones retain identity; 409 `cancelled_record_exists` prevents reimport. Dry-run preserves duplicate/cancelled evidence. No amount/date deduplication was added. |
| `loanController` related transactions, Loan payment functions/summaries | Invariant-based exclusion: Loan-linked cash cannot have Savings role/history/tombstones, enforced from both directions. Existing Loan functions, privileges, schedules and calculations remain unchanged. |
| `settingsController` source-usage transaction count | Deliberate historical reference count, not a live financial aggregate; tombstones must continue to prevent unsafe source removal. |
| Import and checkout transaction paths | Direct transaction accesses are inserts, not unfiltered live readers; existing DB guards reject invalid Savings-role use. No external-ID lookup exists in the spreadsheet import path. Checkout/nested rich records cannot be linked Savings cash. |
| Transaction creation inserts/installments; existing edit/delete RPCs | Writes, not reader omissions. Existing ordinary behavior is preserved; protected fields cannot be supplied through ordinary UPDATE privileges. New-row and immutable-history guards reject prevoid inserts/hard deletion. SAV-03 now adds the explicit dispatch described below. |

The 17 direct Budget functions are `get_funded_budget_month`, `set_funded_budget_amount`, `remove_funded_budget`, `reverse_funded_budget_operation`, `copy_funded_budget_month`, `budget_carryover_candidate_rows`, `reverse_budget_carryover`, `set_budget_month_override`, `remove_budget_month_override`, `budget_month_disposition_candidate_rows`, `get_budget_month_disposition_preview`, `get_budget_reallocation_preview`, `get_budget_deficit_resolution_preview`, `reverse_budget_funding_action`, `budget_funding_source_rows`, `get_budget_unbudgeted_resolution_preview`, and `reverse_budget_unbudgeted_resolution`.

Five structural validators are `validate_budget_operation_tree`, `validate_budget_operation_item`, `validate_budget_savings_entry`, `validate_budget_unused_balance_policy`, and `prevent_category_type_with_unused_balance_policy`. They reserve downstream shapes, validate opening retirement and reject premature named-account policy execution. #41 extends them together with complete transfer provenance; no hidden dependency on #43 exists for safe #39 rollout.

## SAV-02 verification and owner rollout (historical evidence)

Executed locally: 11 targeted real PostgreSQL tests using newly created, labelled PostgreSQL 16 containers with no published database ports; each target was inspected before DDL and removed afterward. Tests cover clean full-schema installation and 029 upgrade; +2 tables/+1 view; unchanged financial fingerprints and Loan definitions/grants; zero/exact large openings and goals; atomic 1200/500/300 retirement and rollback; invalid values/references/dates; archive/config revisions; original-root repeated corrections; service Budget reads and denied helper/void writes; detached/voided reader behavior and reserved identities; immutable occurrence claims/reinstatement; same-key/config concurrency; and both Loan/Savings link contention orders using two connections. Privileged future-event fixtures are isolated test data, not exposed business commands. Owner-run preflight/postflight artifacts were executed only against disposable databases.

Application verification uses the repository client/server scripts and focused account/reader/navigation tests. Browser checks use actual Savings components and shared styles through a loopback-only Express/PostgREST preview and a disposable PostgreSQL database, with no production credentials: desktop 1440×1000 and mobile 390×844, both themes, long Hebrew names, create/edit/clear/refetch, details/history, archive/reactivate, overflow checks, keyboard Escape and focus restoration. This is agent-performed isolated preview verification, not owner acceptance or deployed-app testing. Final gate counts and GitHub readback are recorded in #38 and PROJECT_STATUS.

Reproduce automated checks:

```powershell
npm --prefix server test
node --test server/test/savingsPostgres.local.test.js
npm --prefix client test
npm --prefix client run lint
npm --prefix client run build
git diff --check
```

Owner production order, after review/commit under the owner's workflow:

1. Confirm the production schema is through 029 and quiesce writes for comparable evidence. Run [MIGRATION_030_PRODUCTION_PREFLIGHT.sql](MIGRATION_030_PRODUCTION_PREFLIGHT.sql); save its single JSON result. Every check must be true. Resolve seed-name conflicts explicitly; do not reinterpret an existing category or infer overlap.
2. Apply only Migration 030, not full_schema or old migrations.
3. Run [MIGRATION_030_PRODUCTION_POSTFLIGHT.sql](MIGRATION_030_PRODUCTION_POSTFLIGHT.sql) immediately, before account creation. Save its single JSON result. Compare **all** financial-history counts/fingerprints, reserve and Budget fingerprint to preflight; expect +2 tables/+1 view and empty new tables. A structural PASS alone does not prove the before/after comparison. Later accounts intentionally fail the installation-empty check; never delete them to obtain PASS.
4. Deploy compatible readers before allowing any voided history. SAV-02 owner acceptance is already granted as recorded above; the listed isolated tests are agent evidence, not a claim that the owner performed each check.
5. #38 acceptance is now recorded; follow the SAV-03 rollout below for Migration 031 and its cash commands. Interest, transfers, monthly processing and expanded reports retain their separate gates. Automation stays off.

No production migration, database access, deployment, commit, push, release or version bump was performed. Recovery after Savings data exists requires compatible readers and a forward fix; do not drop the ledgers, unvoid historical cash or blindly restore retired reserve.


## Files changed by SAV-02

This list is relative to the recorded initial working tree, including the previously uncommitted design files intentionally reconciled here. The unrelated docs/github-development-standard.md modification is byte-for-byte preserved and excluded.


client/

- `client/src/App.jsx`
- `client/src/components/shell/navigation.js`
- `client/src/components/shell/navigation.test.js`
- `client/src/hooks/useTransactionForm.js`
- `client/src/pages/AddTransaction/AddTransaction.jsx`
- `client/src/pages/AddTransaction/AddTransaction.test.jsx`
- `client/src/pages/Savings/Savings.css`
- `client/src/pages/Savings/Savings.jsx`
- `client/src/pages/Savings/Savings.test.jsx`
- `client/src/pages/Savings/SavingsAccountDialog.jsx`
- `client/src/pages/Savings/savingsForm.js`
- `client/src/pages/Tasks/TaskCard.jsx`
- `client/src/services/api.js`

server/

- `server/controllers/savingsController.js`
- `server/controllers/taskController.js`
- `server/controllers/transactionController.js`
- `server/controllers/v1/transactionController.js`
- `server/full_schema.sql`
- `server/index.js`
- `server/migrations/030_savings_foundation.sql`
- `server/routes/savingsRoutes.js`
- `server/services/savingsService.js`
- `server/test/externalTransactionContract.test.js`
- `server/test/savingsAccounts.test.js`
- `server/test/savingsPostgres.local.test.js`

docs/

- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/MIGRATION_030_PRODUCTION_POSTFLIGHT.sql`
- `docs/MIGRATION_030_PRODUCTION_PREFLIGHT.sql`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md`
- `docs/SAVINGS_FOUNDATION.md`
- `docs/SAVINGS_V1_3_0_SPEC.md`

CHANGELOG.md

- `CHANGELOG.md`

## SAV-03 manual transaction handoff — 2026-09-13

The owner accepted SAV-02 with “בנוגע לחסכון מאושר אפשר להתקדם”. #38 is Completed / Done; this does not imply production installation. SAV-03 (#39) is implemented locally and independently read back Open / Verify / P1 — High, awaiting its own owner acceptance. Both issues retain parent #36, milestone v1.3.0, their labels/assignees and native dependencies; unrelated Project items are unchanged. The normal application already had the Savings route, menu and page header; these were retained and verified through the complete App/Layout rather than the earlier separately mounted preview.

### Delivered workflows and API boundary

The existing transaction form reveals an account selector for the stable deposit/withdrawal category roles. Savings account cards open that same form with account/type defaults. Deposits create one expense and positive Savings post; withdrawals create one income and negative post. No extra cash ledger exists. Exact decimal strings and text BIGINT IDs/revisions reach SQL without floating-point writes. Same-day cutoff cash requires explicit confirmation that it was excluded from the opening. New cash rejects archived accounts, inactive references, future dates and insufficient historical prefixes. Archived links remain readable and auditable historical corrections are allowed.

Editing an eligible ordinary/imported transaction deliberately links that exact transaction with its fingerprint; it never creates another cash row. Changing amount/date/account appends reversal/replacement history and preserves original-post ordering. Selecting an ordinary category explicitly detaches while retaining live cash. The accepted 030 event-identity guard does not convert a deposit into a withdrawal through replacement: cancel the wrong-direction event and record the intended event separately; the API returns that guidance. Existing detached cash can be explicitly reinstated using the same ID, or edited as restricted ordinary scalar cash. Cancelling linked cash reverses Savings once and stores a tombstone; cancelling detached cash only records its protected void receipt. Cancelled detail is read-only and offers explicit reinstatement through a new cash row. History is never erased or unvoided.

| Implemented API | Operation |
| --- | --- |
| `POST /api/transactions`, `PUT /api/transactions/:id` with `savings_handling` | Shared validated dispatch to post/correct; ordinary cash paths remain supported |
| `DELETE /api/transactions/:id` with explicit Savings reason/receipt | Active cancellation or dedicated detached-cash void |
| `POST /api/savings/events` | `post_savings_event(UUID,JSONB)` |
| `POST /api/savings/events/:id/correct` | `correct_savings_event(UUID,BIGINT,BIGINT,JSONB,TEXT)` |
| `POST /api/savings/events/:id/cancel` | `cancel_savings_event(UUID,BIGINT,BIGINT,TEXT,TEXT)` |
| `POST /api/savings/transactions/:id/void-detached` | `void_detached_savings_transaction(UUID,INTEGER,TEXT,TEXT)` |
| Existing transaction list/detail reads | Account metadata, optional `savingsAccountId` filter before paging/totals, exact cash fingerprint, cancelled history |

All routes retain existing authenticated application boundaries. Request UUID replay precedes stale-state validation; changed payloads require a new UUID. Account revisions and existing-cash fingerprints reject stale financial commands. SQL takes the transaction serialization lock first and then ordered references/accounts/cash, so concurrent withdrawals cannot partially commit or overdraw. Both directions of Loan linkage remain protected by the accepted guards without changing Loan calculations, functions or grants.

The canonical `cancel_savings_event` signature has no ordinary-category parameter. Therefore explicit detach uses `correct_savings_event` with `action: "detach"`, a reason and selected ordinary category; cancellation accepts `void`. This is a transport clarification, not a new accounting decision. `none` for noncash interest remains #40. The engine also implements audited opening correction/overlap compensation, but the account edit dialog never exposes opening changes. Interest, Budget transfers, monthly execution and successful placeholders for them are absent.

### Migration 031 inventory

[031_savings_manual_transactions.sql](../server/migrations/031_savings_manual_transactions.sql) is appended identically to [full_schema.sql](../server/full_schema.sql). Migration 030 and all historical migrations remain immutable.

| Object group | Exact change |
| --- | --- |
| Tables, views, columns, sequences, trigger attachments | None added; Savings still has exactly two physical tables and one summary view |
| New public functions | The four manual RPC signatures above; fixed-path SECURITY DEFINER, service EXECUTE only |
| New private function | `savings_post_event_locked(UUID,JSONB)`; no service/browser EXECUTE |
| Existing reader signatures replaced | `transactions_filtered(DATE,DATE,BIGINT,BIGINT,BOOLEAN,TEXT,BIGINT,INTEGER)` and `transactions_page(DATE,DATE,BIGINT,BIGINT,BOOLEAN,TEXT,INTEGER,TEXT,TEXT,BIGINT,DATE,NUMERIC,TEXT,BOOLEAN,BOOLEAN,BIGINT)`; new trailing arguments default to NULL; old overloads removed to avoid ambiguity |
| Existing trigger function replaced | `savings_guard_transaction()` additionally protects captured Budget history for detached edits/voids; existing trigger reused |
| Privileges | Filter is fixed-path service-only SECURITY DEFINER for protected Savings metadata; page stays SECURITY INVOKER. Budget read-only helper exception and protected void fields remain intact |

Cumulative delivered Savings public RPCs: seven of the approved ten; private helpers: ten of eleven. Three surplus RPCs, one surplus helper and two Budget overloads remain #41. #40 extends the manual engine for interest; #42 adds orchestration without new physical tables. No extra Loan objects or accounting authorities are introduced.

### Transaction write-path and reader coverage

| Path | Current enforcement |
| --- | --- |
| Interactive transaction create/edit/delete; Savings shortcuts | One `savings_handling` boundary before Number/pricing, items, keyword, installment, LEGO or Loan work; SQL guards also reject bare cash-only Savings rows |
| Existing/imported ordinary cash | Explicit link with authoritative amount/date/source fingerprint; reject items, installments/parent totals, FX, discounts, Loan, checkout and LEGO relationships |
| Spreadsheet import preview and bulk save | Keyword suggestions exclude Savings roles; bulk save rejects Savings categories/payloads before inserts; import normally, then deliberately link |
| External v1 create/dry-run/idempotent external-ID lookup | Reject Savings payload/category, exclude role keyword suggestions; retain tombstone identity and actionable cancelled-record conflict |
| Shopping checkout | Reject Savings role before financial side effects; rich checkout cash cannot become Savings cash |
| Loan manual/automatic repayment and existing Loan RPCs | Existing accounting retained; transaction and Loan-side guards reject shared Savings role/history/void links in either lock order |
| Tasks | Link existing transactions; there is no separate task cash-generation path. Nested cancelled records retain read-only history |
| Existing scheduler | Loan repayment processing and task occurrence orchestration retained; no Savings runner or automatic cash execution is enabled |
| Direct ordinary SQL/service inserts/updates | Existing valid transaction privileges remain; ledger/history pairing guards reject cash-only role changes and protected void fields are denied |
| Detached scalar edit | Existing ordinary transaction RPC with exact amount, restricted shape and historical Budget guard; does not post/reverse Savings again |

The baseline reader inventory above remains applicable. Extended filter/page functions exclude voids before cursor selection and totals; historical single-record lookup is explicit. Account filters include archived historical names. Dashboard, Budget, Annual Summary and Transactions/Savings use local invalidation/refetch after mutations. No reporting safety work is deferred to #43. Cash changes touching closed months or captured carryover/disposition/funded-transfer provenance are conservatively rejected; changing a date cannot silently rewrite those historical approvals.

### Executed verification and owner preview

- Complete application gates: 491 client tests across 30 files and 336 server tests passed. After browser-driven restoration/error-feedback fixes, 30 affected form tests (including the new restoration regression) and 47 Transactions tests passed. Real PostgreSQL manual suite: 12/12 passed; owner-artifact preservation and category/direction/installment validation passed separately (14 distinct cases). No mocked test is counted as PostgreSQL evidence.
- PostgreSQL 16 containers were uniquely named, labelled disposable and inspected before DDL, without published database ports. Clean full schema and upgrade from 030 preserve table/view counts, prior financial rows, Loan definitions/grants and empty-install behavior. Tests cover exact money/retries/rollback, existing cash, cutoff/archive/references, same-day/repeated/account/date corrections, reserve correction, detached and linked cancellation/reinstatement, live/cancelled readers, privileges, two concurrent withdrawals and both Loan/Savings contention orders. The owner pre/postflight JSON evidence matched exactly around 031 with an existing opening account.
- Full-application Chromium checks used real Express controllers, PostgREST and disposable PostgreSQL: normal menu/navigation, account setup, both cash entry points, amount correction, explicit detach/void with no second reversal, existing-cash linking, historical cancelled detail and insufficient-balance feedback. Desktop/mobile RTL and both themes were rendered, checked for overflow and captured; category Escape and account-history focus restoration passed. This is agent verification, not owner acceptance. The connected in-app browser was unavailable; isolated local Chromium was used.
- Client lint and production build passed after the final UI fix; the build retains the existing large-chunk advisory. Strict UTF-8/local links, exact schema/migration suffix, unchanged historical migrations and seven 1.2.0 version fields, unchanged HEAD/index and git diff --check passed. The prior SAV-02 suite evidence above remains historical and was not substituted for these new manual-flow checks.

Owner preview: **http://127.0.0.1:5180/savings**. This mounts actual `App`/shared layout with an external loopback-only test identity, not a replacement Savings UI or mocked persistence. The normal menu exposes Savings; on mobile use “עוד”. No production authentication configuration was changed. Temporary runner, fixtures, browser tooling and logs remain outside the repository in `C:\Users\ozavr\AppData\Local\Temp\finance-sav03-20260913`. Express is on 55449, PostgREST on 55448, database `sav03_preview` in labelled container `finance-sav03-development`; database has no host port. Only these disposable services contain test writes. The preview intentionally remains running for owner review.

בדיקת בעלים ל־#39: היכנסו דרך תפריט האפליקציה לחסכונות. בחשבון בדיקה הפקידו ומשכו דרך החיסכון וגם דרך טופס התנועות; ודאו שינוי יחיד בכסף וביתרה. קשרו תנועה רגילה קיימת, תקנו סכום/תאריך/חשבון, נתקו לקטגוריה רגילה ובטלו — בלי שינוי נוסף ביתרת החיסכון לאחר הניתוק. בדקו היסטוריה מבוטלת, סינון לפי חשבון, דחיית משיכה גבוהה מדי ורענון לאחר שמירה, גם בנייד ובשתי ערכות הנושא. ריבית, העברות מתקציב וביצוע אוטומטי שייכים להמשך.

### Owner deployment order (not executed)

1. Complete owner review/commit workflow. If production is only through 029, install 030 with its existing pre/postflight first. If 030 is already installed, verify its state and do not reapply it or demand empty existing Savings tables.
2. Pause application/import/scheduler writes for comparable evidence; run [031 preflight](MIGRATION_031_PRODUCTION_PREFLIGHT.sql) and save the consolidated JSON. Apply only Migration 031, then [031 postflight](MIGRATION_031_PRODUCTION_POSTFLIGHT.sql). Every check must pass and all evidence fingerprints/counts, reserve, Budget state and table/view counts must match exactly. Do not execute the schema snapshot as a migration.
3. Deploy the compatible server/client together before allowing Savings cash cancellation; old pre-foundation readers cannot safely consume voided history. Keep automatic Savings execution off. Verify authenticated full-application flows and direct Budget/Annual reads in the owner's deployment workflow.
4. A failure after data exists requires disabling new writes and a compatible forward fix, never deleting entries, unvoiding tombstones or restoring retired reserve blindly. #40–#43 remain separate work.

No production SQL/access, deployment, version bump, stage, commit or push occurred. This historical SAV-03 handoff preceded the owner confirmation recorded below; the user-owned production/release workflow remains outstanding.

### Files changed by SAV-03

Relative to the initial SAV-03 working-tree hash snapshot, preserving the existing uncommitted SAV-01/SAV-02 work. The unrelated development standard is excluded and byte-for-byte unchanged.

The subsequent visual-review correction additionally changes `client/src/components/ui/Button.jsx`; its separate evidence and file list follow this original inventory.

- `CHANGELOG.md`
- `client/src/hooks/useTransactionForm.js`
- `client/src/pages/AddTransaction/AddTransaction.jsx`
- `client/src/pages/AddTransaction/AddTransaction.test.jsx`
- `client/src/pages/AddTransaction/SavingsTransaction.test.jsx`
- `client/src/pages/AnnualSummary/AnnualSummary.jsx`
- `client/src/pages/Budget/Budget.jsx`
- `client/src/pages/Dashboard/Dashboard.jsx`
- `client/src/pages/Savings/Savings.css`
- `client/src/pages/Savings/Savings.jsx`
- `client/src/pages/Savings/Savings.test.jsx`
- `client/src/pages/Transactions/Transactions.css`
- `client/src/pages/Transactions/Transactions.jsx`
- `client/src/pages/Transactions/Transactions.test.jsx`
- `client/src/pages/Transactions/TransactionsFilters.jsx`
- `client/src/pages/Transactions/TransactionsList.jsx`
- `client/src/services/api.js`
- `client/src/utils/financeInvalidation.js`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/MIGRATION_031_PRODUCTION_POSTFLIGHT.sql`
- `docs/MIGRATION_031_PRODUCTION_PREFLIGHT.sql`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md`
- `docs/SAVINGS_FOUNDATION.md`
- `docs/SAVINGS_V1_3_0_SPEC.md`
- `server/controllers/importController.js`
- `server/controllers/savingsController.js`
- `server/controllers/shoppingController.js`
- `server/controllers/transactionController.js`
- `server/controllers/v1/transactionController.js`
- `server/full_schema.sql`
- `server/migrations/031_savings_manual_transactions.sql`
- `server/routes/savingsRoutes.js`
- `server/services/savingsTransactionService.js`
- `server/test/savingsAccounts.test.js`
- `server/test/savingsManualPostgres.local.test.js`
- `server/test/savingsTransactions.test.js`
- `server/test/shoppingListFields.test.js`
- `server/test/transactionLoanPayments.test.js`

## SAV-03 owner visual-review correction — 2026-09-13

The owner reported differences in both Savings and ordinary expense entry. This feedback is not acceptance of #39. SAV-02 remains accepted / Completed / Done. #39 moved to In Progress for the correction and was independently read back Open / Verify after the checks below, preserving its existing P1 priority and relationships. Both existing Project memberships and all unrelated Project items were verified unchanged.

### Comparison findings and corrections

The published v1.2.0 GitHub Release and annotated tag were independently resolved to `e5dec682a6c18df7d52da6cb77180f8438d63830`. Its client was extracted outside the checkout for a parallel, isolated full-application comparison using the same backend/test data. No released file was restored over the local bundle.

1. **Product form bug:** absent `savingsRole` yields null. SAV-03's category lookup matched an ordinary category with `savings_role: null`, then applied Savings shortcut defaults: Income, an unsolicited category and today's charge date. The hook now applies shortcut defaults only for explicit `deposit`/`withdrawal` roles. Ordinary expense/category/charge-date defaults and income selection follow the released behavior. New regression cases include actual nullable API roles and invalid shortcut values; the earlier mocks had omitted the property and therefore missed this bug.
2. **Preview typography bug:** the temporary preview supplied synthetic HTML without the application's Google Fonts links. At equal viewport/device scale and zoom 1, the original preview had zero registered font faces while the released HTML loaded Heebo/Inter. Computed font-family names alone had hidden the fallback. The runner now reads actual `client/index.html`, replacing only the module entry, and matches main.jsx's stylesheet order, Theme/Toast providers and StrictMode. Its external isolated AuthContext remains the sole intentional provider substitution; production authentication is unchanged. This was not a zoom diagnosis.
3. **Product Savings actions:** plain Link elements and a rule using undefined `--border-subtle` left blue underlined anchors without the Finance v3 control presentation. SecondaryButton now supports opt-in `as={Link}` while retaining native buttons by default. Deposit, withdrawal and transaction navigation use it, preserving href, keyboard Enter and open-in-new-tab semantics. Card padding/radius, 12px gaps, 15.5px title and 24px bold balance follow existing LoanCard patterns; long Savings names still wrap. No global CSS override or decorative overlay was added.

`AddTransaction.jsx`, `TransactionForm.css`, receipt/item/discount/installment components, Layout, global styles/tokens, fonts in product HTML and the accepted Dashboard #27 rules were inspected and remain unchanged by this correction. Existing Savings context, audit/cancel/restore and financial dispatch remain implemented. The ordinary form's layout was verified against the release rather than blanket-restored.

### Executed comparison and verification

- Twelve matched comparisons: ordinary expense creation, income, itemized entry, ordinary editing, installments and Loan repayment context, each at desktop 1440×1000/dark and mobile 390×844/light, device scale 1 and zoom 1. Full visible form geometry, field order/values, typography, colors and control dimensions matched the released baseline exactly after equivalent interactions. Neither ordinary create nor edit exposed Savings controls.
- Full-app Savings screenshots cover desktop/mobile and both themes. Actual link keyboard navigation and category Escape passed. All four deposit/withdrawal entry combinations saved through real isolated Express/PostgREST/PostgreSQL persistence and refreshed; paired writes preserved net test-account balance. Insufficient-balance feedback passed. Ordinary expense, income, itemized creation and editing also saved successfully through the actual API without Savings payloads.
- Dashboard, Budget, Loans and Transactions were captured from both baseline and current application; shared tokens, loaded font families and zoom matched. Existing aurora backgrounds/page-specific treatments remain intact. Comparison screenshots, measurement JSON and temporary baseline files are outside the repository under `C:\Users\ozavr\AppData\Local\Temp\finance-sav03-visual-20260913`. Ordinary expense: `baseline-expense-desktop-dark.png`, `before-expense-desktop-dark.png`, `after-expense-desktop-dark.png`; Savings: `before-savings-desktop-dark.png`, `after-savings-desktop-dark.png`; matched mobile/edit/item/Loan images are alongside them.
- **125/125 UI tests across eight files passed**, covering the transaction form, Savings and shared UI. Client lint and production build passed; only the existing large-chunk advisory remains. No backend/database suite was rerun for this presentation/default-initialization correction. Strict UTF-8, preserved versions/migrations/server files/unrelated modifications and git diff --check were checked against the initial visual-review hash snapshot.
- The connected browser was unavailable; installed isolated Chromium performed these checks. These are agent checks against disposable data, not production testing or owner acceptance.

Files changed in this correction: `client/src/hooks/useTransactionForm.js` (explicit shortcut guard), `client/src/components/ui/Button.jsx` (opt-in navigation rendering), `client/src/pages/Savings/Savings.jsx` and `Savings.css` (Finance v3 actions/cards), the existing `SavingsTransaction.test.jsx` and `Savings.test.jsx` (meaningful regressions), `CHANGELOG.md` and this handoff. Preview runner/entry changes and screenshots remain outside the repository. Financial accounting, all migrations including 030/031, schema, versions and unrelated development-standard changes are preserved.

Corrected full-app preview remains **http://127.0.0.1:5180/savings**; ordinary entry is **http://127.0.0.1:5180/add**. Use the normal menu, or “עוד” on mobile. The existing loopback Express/PostgREST connection was inspected and reused with labelled disposable database `sav03_preview`, without resetting existing preview data. No production SQL, stage, commit, push, version bump or deployment occurred. At that visual-correction handoff, #39 awaited owner visual acceptance and no #40 work had started. The subsequent acceptance and SAV-04 work are recorded below.


## SAV-03 completion and owner appearance acceptance — 2026-09-13

The owner confirmed “אוקי עכשיו נראה סבבה” after reviewing the corrected full-app preview. This accepts the corrected appearance and resolves the reported Savings/transaction-form visual concerns. It does not assert additional owner-performed functional checks. Together with the documented SAV-03 implementation, PostgreSQL and application verification, this authorizes finalizing #39 as Closed / Completed / Done, P1 — High; #38 remains accepted / Closed / Done. The work remains local/uncommitted and undeployed.

The original visual feedback above was a correction request, not acceptance. This later confirmation resolves those concerns without requesting repeat visual acceptance. Existing labels, assignees, v1.3.0 milestone, parent and completed native dependencies remain intact.

## SAV-04 realized-interest implementation — 2026-09-13

[#40](https://github.com/OzAvrahami/finance-tracker/issues/40) implements actual net interest only, through the full application Savings page and the explicit interest-payout category in normal income entry. The account action opens a Finance v3 dialog with account, exact net amount, date, explicit destination and an effect confirmation. Payout may create one income or deliberately select an eligible existing income from paginated history; existing amount/date/source/fingerprint remain authoritative. SQL revalidates richer cash/Loan/item/reference restrictions. The descriptive annual rate/terms never calculate interest or tax and no bank transfer is executed. Ordinary expense/income initialization and layout remain unchanged.

| Operation | Existing API / command | Effect |
| --- | --- | --- |
| Capitalize actual interest | POST /api/savings/events → post_savings_event; interest_capitalized, action=noncash | Held +amount; earnings +amount; no cash |
| Pay interest into checking | Same API/RPC; interest_payout, create_cash or link_cash | One income; earnings +amount; held unchanged |
| Correct amount/date/account/destination | POST /api/savings/events/:id/correct → correct_savings_event | Reverse/replace, preserve original ordering, validate both account histories |
| Cancel interest | POST /api/savings/events/:id/cancel → cancel_savings_event | Reverse once; cash_action=none for capitalized, void for payout |
| Restore cancelled interest | Correct command with reinstate=true and original destination | New replacement, no second reversal; live detached cash explicitly reused, voided cash replaced |

Payout editing/cancellation from Transactions dispatches through the same existing audited boundary. Changing its category to ordinary income deliberately detaches it and removes earnings without cancelling cash; the existing dedicated detached-void command later cancels cash without another Savings effect. Destination correction is available in Savings history and explained in the linked-income form. A cancelled noncash history row has an explicit restore action; history-reader eligibility covers the complete replacement chain rather than guessing from a page. Archived accounts reject new postings/restoration and retain historical corrections/cancellation.

| Original → corrected destination | Cash | Held / earnings for equal amount 40 |
| --- | --- | --- |
| Capitalized → capitalized | None | Held unchanged; earnings unchanged |
| Payout → payout | Update same income ID | Held unchanged; earnings unchanged |
| Payout → capitalized | Void original income with protected receipt | Held +40; earnings unchanged |
| Capitalized → payout | Create one explicitly supplied income | Held −40; earnings unchanged |

All changes are atomic and preserve expected revisions, original-post prefix solvency, opening cutoff, exact money, source/category rules and idempotency. Removing capitalization already consumed by a withdrawal fails with complete rollback. Manual deposit↔withdrawal changes are still rejected. Noncash-only historical corrections touch no Budget cash period; corrections involving income check both actual old/new cash months. The existing coarse-to-fine locking and Loan relationship guard remain unchanged.

Numerical contract executed in PostgreSQL and the full-app preview:

| Step | Held balance | Deposits | Realized earnings |
| --- | --- | --- | --- |
| Opening 10,000; deposit 500; capitalize 40 | 10,540.00 | 500.00 | 40.00 |
| Separate payout 40, one linked income | 10,540.00 | 500.00 | 80.00 |
| Ordinary withdrawal 40 | 10,500.00 | 500.00 | 80.00 |

### SAV-04 database inventory and rollout

[032_savings_realized_interest.sql](../server/migrations/032_savings_realized_interest.sql) is the inspected next migration, appended identically to full_schema.sql. It replaces exactly savings_post_event_locked(UUID,JSONB) and get_savings_account(BIGINT,DATE,DATE,BIGINT,INTEGER). It creates no object signatures, tables, views, columns, indexes or triggers, changes no Loan definitions/grants, and performs no row migration/backfill. The initiative remains exactly savings_accounts, savings_entries and savings_account_summary; seven of ten public Savings RPCs and ten of eleven helper/trigger functions (ten private plus the read-only Budget exception) are delivered. The existing read-only service_role Budget-helper exception remains; mutating helpers and protected void fields remain private.

Owner order (not executed in production): install missing 030/031 in order with their existing checks; pause writes; run [032 preflight](MIGRATION_032_PRODUCTION_PREFLIGHT.sql), apply only 032, run [032 postflight](MIGRATION_032_PRODUCTION_POSTFLIGHT.sql), compare every evidence field exactly, then deploy compatible server/client before enabling interest. Each artifact returns one consolidated JSON result and checks the expected function bodies/grants. Compare preserved row counts/fingerprints, table/view counts, unaffected function/grant fingerprint, Budget state and legacy reserve. A PASS without matching evidence is insufficient. Keep automation disabled. Recovery is a compatible forward fix, never ledger deletion/unvoiding or a destructive down migration.

### SAV-04 executed verification

- Full client: **501/501 across 31 files**; subsequently added explicit payout-shortcut regression and reran its focused file **8/8**, preserving ordinary defaults. Full server: **337/337**. Client lint and production build passed; the existing chunk-size advisory remains. No dependency/version changes.
- Real disposable PostgreSQL 16: **15 distinct interest cases passed**, comprising the complete 13-case run, the improved targeted 031-upgrade/pre/postflight case and additional captured-Budget-history and exact earnings-range cases. Coverage includes both destinations, exact numerical contract, existing income/retry/duplicate protection, four correction combinations, same-day/repeated ordering, rollback/consumed capitalization, date/account moves, cutoff/invalid/inactive/archive rules, cancellation/restore/detached void, earnings range guard, private permissions and concurrent cancellation/withdrawal plus duplicate payout requests. Schema-snapshot clean installation agrees with the upgraded function definitions and adds no data.
- Existing **14/14 SAV-03 real PostgreSQL cases passed with Migration 032 appended** using an external runner; this includes concurrent withdrawals, both Loan/Savings link-contention orders, unchanged ordinary Loan behavior, live/cancelled readers, opening/reserve correction and cash historical boundaries. No mocks are counted as database verification.
- Full-app isolated Chromium: persisted capitalized and payout interest, payout↔capitalized conversion, cancellation and restoration, paginated existing-income linkage, linked-income amount edit through the accepted transaction form, and explicit payout-category income creation. The numerical demo finishes at held 10,500.00 / deposits 500.00 / earnings 80.00. Screenshots cover desktop 1440×1000 and mobile 390×844, Hebrew RTL, light/dark, no horizontal overflow, Escape/focus return and invalid-money feedback. Twelve comparisons of ordinary expense/income/itemized/edit/installment/Loan forms against the released v1.2.0 baseline retained identical visible geometry, values and styling at equivalent viewport/theme/data. No new owner-performed checks are claimed.
- The connected browser remained unavailable; installed isolated Chromium ran the actual application, not static UI/mock responses. Preview HTML/fonts/styles/providers follow the accepted correction. Express/PostgREST connection and labelled no-host-port PostgreSQL database were verified before applying 032 only to sav03_preview; pre/postflight proved existing fixture preservation. Temporary tooling, logs and screenshots: C:\Users\ozavr\AppData\Local\Temp\finance-sav04-20260913.

Full-app preview remains **http://127.0.0.1:5180/savings**, with a loopback-only test identity. Use normal navigation (“עוד” on mobile); no login or production credentials are required. Account “בדיקת SAV-04 — ריבית בפועל” is isolated test data, including retained audited corrections/cancellations. The previous preview fixtures remain available. Deposit/withdrawal are implemented; funded Budget transfer, recurring execution and extended reporting remain #41–#43.

בדיקת בעלים ל־#40: בחשבון בדיקה בחרו “רישום ריבית”. רשמו סכום נטו שנשאר בחיסכון וודאו שהיתרה והרווח עולים ללא הכנסה. רשמו ריבית ששולמה לעו״ש, או קשרו הכנסה קיימת, וודאו הכנסה אחת ורווח נוסף ללא גידול ביתרה. בהיסטוריה תקנו סכום/תאריך/יעד, בדקו המרה בשני הכיוונים, ובטלו רישום שגוי; ודאו שהרווח אינו נספר פעמיים ושההיסטוריה נשמרת. נסו החזרה מפורשת של ריבית שבוטלה ודחיית פעולה שיוצרת יתרה שלילית. בדקו גם בנייד ובשתי ערכות הנושא.

SAV-04 remains Open for owner verification; no owner interest acceptance is claimed. #39 is completed / Done and #38 remains completed / Done. No production SQL/access, migration/deployment, stage/commit/push, release or version bump occurred.


### SAV-04 final tracking and changed files

Independent GitHub/Project readback: #38 and #39 are Closed / Completed / Done / P1 — High; #40 is Open / Verify / P2 — Medium. All eight #40 implementation criteria are checked with the handoff evidence; owner acceptance remains pending. Existing unique Project items, labels, assignees, milestone v1.3.0, parent #36 and native dependencies are preserved. The milestone remains open. All unrelated Project items were compared and unchanged.

Final local checks passed: strict UTF-8 and local documentation links, git diff --check (plus whitespace checks for new files), exact 032 snapshot suffix and preserved pre-032 snapshot hash. HEAD/index, all seven version fields, 030/031 and unrelated local files, including docs/github-development-standard.md, match the initial task snapshot.

Files changed relative to this task’s initial working tree (earlier SAV-01–03 changes remain separate):

- `client/src/pages/AddTransaction/SavingsTransaction.test.jsx`
- `client/src/pages/Savings/Savings.jsx`
- `client/src/pages/Savings/SavingsInterestDialog.jsx`
- `client/src/pages/Savings/SavingsInterestDialog.test.jsx`
- `docs/MIGRATION_032_PRODUCTION_POSTFLIGHT.sql`
- `docs/MIGRATION_032_PRODUCTION_PREFLIGHT.sql`
- `docs/SAVINGS_FOUNDATION.md`
- `docs/SAVINGS_V1_3_0_SPEC.md`
- `server/migrations/032_savings_realized_interest.sql`
- `server/routes/savingsRoutes.js`
- `server/services/savingsTransactionService.js`
- `server/test/savingsInterestPostgres.local.test.js`
- `server/test/savingsTransactions.test.js`
- `CHANGELOG.md`
- `client/src/hooks/useTransactionForm.js`
- `client/src/pages/AddTransaction/AddTransaction.jsx`
- `client/src/services/api.js`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md`
- `server/full_schema.sql`


## SAV-05 funded-surplus implementation — 2026-09-13

The owner said “בוא נתקדם אני לא אבדוק עכשיו את הריבית”. Interest verification is deferred, not accepted; #40 stays Open / Verify / P2 — Medium. SAV-05 depends on completed #39 and proceeded under this authorization. SAV-02/SAV-03 acceptance and closure remain intact. No new owner acceptance is inferred from the agent's checks below.

### Delivered workflows and accounting

- Settings → Budget stores a named active Savings destination using the existing policy row. Legacy `savings` remains a separately named, noncash Budget reserve policy. No automatic conversion, opening/backfill account or reserve retirement occurs during 033.
- Budget → “העברת עודף לחיסכון” selects source category/month, amount, named destination, cash payment source and actual date. It previews funded surplus, funding/allocation before/after and held Savings before/after. Controls wait for reference loading and freeze during preview/apply; edits discard the preview, confirmation is explicit and duplicate clicks are guarded.
- Month close retains existing blockers and requires a complete cash confirmation for every named destination. All candidate previews are validated before any posting; multiple candidates to one account show cumulative held-balance effects. One candidate creates one expense and one deposit under the single atomic close root.
- An explicit transfer writes source funding −X, source allocation movement out X, one exact expense and one linked `budget_surplus` Savings deposit. Source month and actual cash date remain separate. The generated expense is excluded only from Budget envelope actuals through valid typed provenance; it remains in cash totals. Ordinary manual Savings deposits still count in the envelope. Budget and Annual display the reconciliation and manual-deposit subtotal; transfer-only cash years are not hidden as empty.
- Budget history provides a fingerprinted whole-transfer cancellation when eligible. It restores source funding/allocation, reverses Savings and voids that exact cash row together. Corrections require cancellation plus a new preview/apply. Closed cash-linked month batches cannot be reversed; consumed Savings or later protected history blocks reversal with rollback. Funded cash is read-only in transaction details, and generic cash/Savings/Budget commands reject edits/detach/reversal that could bypass provenance.
- Table-level transaction/policy serialization precedes ordered month/budget/category/payment-source/account locks. Preview fingerprints include cash, funding, account revisions and policy. Durable request receipts remain in existing Budget operations; Savings event/void receipt UUIDs are deterministically derived. An explicit transfer alone does not close a month or disable later ordinary manual Savings activity.

### API and exact object inventory

| API | Public RPC / responsibility |
| --- | --- |
| POST `/api/savings/surplus/preview` | `get_savings_surplus_preview(TEXT,BIGINT,BIGINT,TEXT,BIGINT,DATE)` |
| POST `/api/savings/surplus` | `apply_savings_surplus(UUID,TEXT,JSONB)`; command has exactly six string fields: source_month, category_id, account_id, amount, payment_source_id, cash_date |
| POST `/api/savings/surplus/:id/reverse` | `reverse_savings_surplus(UUID,BIGINT,TEXT,TEXT)`; request key, operation ID, current history fingerprint, reason |
| Existing Settings policy PUT | New `set_budget_unused_balance_policy(BIGINT,TEXT,BIGINT)` overload; explicit nullable destination. Legacy two-argument callers cannot silently erase an existing named destination. |
| Existing Budget month-close POST | New `apply_budget_month_disposition(TEXT,UUID,TEXT,TEXT,JSONB)` overload; complete `cash_confirmations`. The four-argument wrapper cannot execute named transfers without confirmations. |

[033_savings_funded_surplus.sql](../server/migrations/033_savings_funded_surplus.sql) adds **six function signatures**: three public Savings RPCs, two Budget overloads and private `savings_apply_surplus_locked(UUID,JSONB)`. Its internal read-only `reverse_preview` branch is reached through the existing funded-month reader; service_role has no direct helper EXECUTE grant.

It replaces **15 existing function signatures**: `validate_budget_unused_balance_policy`, `validate_budget_operation_tree`, `validate_budget_operation_item`, `savings_assert_links`, `budget_actual_transactions`, `budget_month_disposition_candidate_rows`, `get_budget_month_disposition_preview`, the two-argument `set_budget_unused_balance_policy`, the four-argument `apply_budget_month_disposition`, `savings_post_event_locked`, `reverse_budget_month_disposition`, `savings_guard_transaction`, `group_budget_posting_operation`, `get_funded_budget_month`, and `transactions_filtered`. The existing `budget_category_composition` view is replaced to classify the typed transfer movement. No new physical table, view, column, index, trigger, sequence or migration backfill is added. Existing trigger attachments are reused.

Cumulative Savings objects remain exactly `savings_accounts`, `savings_entries`, `savings_account_summary`, ten public Savings RPCs and eleven helper/trigger functions (ten private plus the read-only Budget exception). Existing Budget remains 11 tables/9 views. 030–032 are unchanged. Narrow grants, protected void columns, RLS, Budget reader EXECUTE exception and Loan definitions/grants are preserved. No recurring execution, expanded Savings reporting, bank balance, cleanup or unrelated Budget-dialog redesign is included.

### Executed verification

- Real disposable PostgreSQL 16: **16 distinct SAV-05 cases passed** (12-case full run plus four added focused cases). Covered clean/032 upgrade, no new relations/backfill, unchanged complete financial history and prior opening-retirement fingerprint, pre/postflight JSON equality, exact same/cross-month posting, whole reversal, retries, duplicate requests, insufficient/invalid inputs, archived accounts, stale spending/funding/account/policy previews, parallel competing transfers and waiting spending, negative Savings history rollback, generic-path rejection, manual-deposit envelope treatment, multi-candidate atomic close, carry-forward, return-to-unallocated, legacy reserve use ordinary manual correction after transfer, whole-reversal/new-transfer correction and exact amounts beyond JavaScript integer precision.
- Same month: F=A=1,000 and E=700 → transfer300 → F=A=700, E=700, cash expenses1,000, held +300. Whole reversal restores F=A=1,000, cash700 and held0. Cross-month fixtures use August source/September cash because these are the actual previous/current business months; source funding falls300 while cash-month funding is unchanged. The canonical September→October example remains the same design contract, not a claim of future cash execution.
- Legacy fixture: reserve500 and confirmed opening1,200 with overlap300 gives Savings1,200/reserve200; 033 preserves every prior row and exactly one retirement, without inventing cash. The isolated zero-spend fixture row is separately retained.
- **28 prior manual/interest PostgreSQL regression cases passed against the 033 chain**, including exact money, all interest destinations/corrections, detached void/reuse, historical solvency, concurrency and both Loan/Savings link orders. The old 032-only upgrade assertion was explicitly skipped in that adapted external runner; the SAV-05 upgrade/clean-snapshot test supplies the authoritative 032→033 gate. These are real database tests, not mock evidence.
- Complete client suite: **508/508 passed** across32 files; the subsequently added multi-candidate close display/confirmation regression passed with the complete **6/6** focused transfer UI tests (509 distinct client tests covered). Complete server suite: **339/339 passed**. Client lint and production build passed; only the existing large-chunk advisory remains. No dependency or version change was made.
- Real full application on isolated Express/PostgREST/PostgreSQL: persisted Settings destination; preview/post/reverse; exact account/source readback; funded transaction read-only details; explicit month-close cash confirmation and protected closed history; successful Annual cash bridge. Desktop1440×1000/mobile390×844, Hebrew RTL, both settled themes, scrolling, keyboard checkbox/Escape/focus return and ordinary entry without Savings controls were checked. Savings, Transactions, Dashboard, Loans, Annual and ordinary `/add` were inspected for shared-style regressions. No global CSS/token/font change occurred. The loading race and Annual PostgREST projection error found during these checks were corrected and rechecked.
- The connected in-app browser was unavailable; installed isolated Chromium was used. Screenshots, runtime/SQL tooling and logs remain under `C:\Users\ozavr\AppData\Local\Temp\finance-sav05-20260913`. These checks are agent verification, not owner acceptance or production evidence.

### Owner preview and deployment handoff

Full-app preview: **http://127.0.0.1:5182/budget**. It uses a separate `sav05_preview` copy of the labelled disposable Savings database, loopback Express55459/PostgREST55458, the actual App shell, HTML/fonts/providers and real APIs. Production authentication is unchanged. The prior accepted5180 preview and its data were preserved. No login is required in this isolated preview; use the normal menu (mobile “עוד”).

Current-month owner fixture: category **“בדיקת בעלים SAV-05 — עודף 300”**, funding1,000/spending700; destination **“חיסכון בדיקת בעלים SAV-05”**, initial held balance0. September is the current fixture month. The earlier August browser-test close remains protected history.

1. בהגדרות → תקציב, בדקו שקטגוריית הבדיקה מפנה לחשבון החיסכון הנבחר.
2. בתקציב ספטמבר, פתחו “העברת עודף לחיסכון”, בחרו את קטגוריית הבדיקה, סכום300, אמצעי תשלום ותאריך אמיתי. בסקירה ודאו מימון1,000→700 וחיסכון0→300.
3. אשרו פעם אחת ובדקו הוצאה אחת, הפקדה אחת, הוצאות מעטפת ללא כפל ורענון החיסכון/התקציב/התנועות. ב“ביטול מלא” ודאו החזרה ליתרות המקור והיסטוריה שמורה.
4. בדקו מובייל/מחשב, RTL, שתי ערכות נושא ומקלדת. בסגירת חודש נדרש אישור תשלום לכל יעד; חודש סגור אינו נפתח מחדש.

Interest owner review remains deferred; this checklist does not request it again.

Owner production order (not executed): install missing030→031→032 with their own checks, pause application/import/scheduler writes, save [033 preflight](MIGRATION_033_PRODUCTION_PREFLIGHT.sql), apply033 once, save [033 postflight](MIGRATION_033_PRODUCTION_POSTFLIGHT.sql), compare every evidence count/fingerprint, reload PostgREST schema cache, then deploy the compatible server/client before enabling transfers. Each artifact emits one consolidated JSON result and was exercised only against disposable databases. Never apply full_schema.sql to production. Actual production installation, deployment and owner acceptance remain pending.

Only the new preview processes may be stopped: the PID in `C:\Users\ozavr\AppData\Local\Temp\finance-sav05-20260913\preview.pid` (verify its command line ends with that directory's preview.mjs before Stop-Process), and Docker container `finance-sav05-postgrest`. Do not stop the older Savings preview, shared disposable PostgreSQL container or unrelated containers. No stage, commit, push, version bump, release or deployment occurred.


### SAV-05 files changed relative to the initial working tree

- [CHANGELOG.md](../CHANGELOG.md)
- [client/src/pages/AddTransaction/AddTransaction.jsx](../client/src/pages/AddTransaction/AddTransaction.jsx)
- [client/src/pages/AnnualSummary/AnnualSummary.jsx](../client/src/pages/AnnualSummary/AnnualSummary.jsx)
- [client/src/pages/AnnualSummary/AnnualSummary.test.jsx](../client/src/pages/AnnualSummary/AnnualSummary.test.jsx)
- [client/src/pages/Budget/Budget.jsx](../client/src/pages/Budget/Budget.jsx)
- [client/src/pages/Budget/Budget.test.jsx](../client/src/pages/Budget/Budget.test.jsx)
- [client/src/pages/Budget/BudgetSavingsTransfers.jsx](../client/src/pages/Budget/BudgetSavingsTransfers.jsx)
- [client/src/pages/Budget/BudgetSavingsTransfers.test.jsx](../client/src/pages/Budget/BudgetSavingsTransfers.test.jsx)
- [client/src/pages/Budget/BudgetStates.jsx](../client/src/pages/Budget/BudgetStates.jsx)
- [client/src/pages/Budget/BudgetSummary.jsx](../client/src/pages/Budget/BudgetSummary.jsx)
- [client/src/pages/Settings/BudgetSettingsTab.jsx](../client/src/pages/Settings/BudgetSettingsTab.jsx)
- [client/src/pages/Settings/Settings.test.jsx](../client/src/pages/Settings/Settings.test.jsx)
- [client/src/services/api.js](../client/src/services/api.js)
- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/DECISIONS.md](DECISIONS.md)
- [docs/MIGRATION_033_PRODUCTION_POSTFLIGHT.sql](MIGRATION_033_PRODUCTION_POSTFLIGHT.sql)
- [docs/MIGRATION_033_PRODUCTION_PREFLIGHT.sql](MIGRATION_033_PRODUCTION_PREFLIGHT.sql)
- [docs/PROJECT_STATUS.md](PROJECT_STATUS.md)
- [docs/ROADMAP.md](ROADMAP.md)
- [docs/SAVINGS_FOUNDATION.md](SAVINGS_FOUNDATION.md)
- [docs/SAVINGS_V1_3_0_SPEC.md](SAVINGS_V1_3_0_SPEC.md)
- [server/controllers/budgetController.js](../server/controllers/budgetController.js)
- [server/controllers/savingsController.js](../server/controllers/savingsController.js)
- [server/controllers/settingsController.js](../server/controllers/settingsController.js)
- [server/full_schema.sql](../server/full_schema.sql)
- [server/migrations/033_savings_funded_surplus.sql](../server/migrations/033_savings_funded_surplus.sql)
- [server/routes/savingsRoutes.js](../server/routes/savingsRoutes.js)
- [server/services/budgetService.js](../server/services/budgetService.js)
- [server/services/savingsService.js](../server/services/savingsService.js)
- [server/test/budgetController.test.js](../server/test/budgetController.test.js)
- [server/test/savingsSurplus.test.js](../server/test/savingsSurplus.test.js)
- [server/test/savingsSurplusPostgres.local.test.js](../server/test/savingsSurplusPostgres.local.test.js)


### SAV-05 final tracking and preservation readback

Independent GitHub/Project readback: #41 Open / Verify / P1 — High; #40 Open / Verify / P2 — Medium with owner review deferred; #38/#39 Closed / Completed / Done / P1 — High. All retain v1.3.0, parent #36, native completed dependencies, labels, assignees and one existing Project item. Milestone v1.3.0 remains open; all other Project items matched the initial snapshot. The ten #41 implementation acceptance notes are checked with the evidence above; owner acceptance is still pending. Final UTF-8/local-link/whitespace checks passed; all seven version fields remain1.2.0, original HEAD/index and unrelated file hashes are unchanged, including docs/github-development-standard.md.

## SAV-06 monthly deposits — 2026-09-14

[#42](https://github.com/OzAvrahami/finance-tracker/issues/42) implements the approved monthly occurrence contract, continuing the current local SAV-02–05 work. #38/#39 remain completed. #40 remains Open/Verify/P2 with owner interest review deferred; #41 remains Open/Verify/P1 with owner review pending. Continuing implementation is not acceptance of either feature. No production or Git publication operation is performed; versions remain1.2.0.

### Delivered behavior and calendar rules

- Account setup/edit stores the exact monthly amount, nominal day, plan start and source. It preserves automation state; first creation is disabled. A separate confirmed action enables/pauses automation. Archive disables it, restoration leaves it off, and both preserve the outstanding due date. Goals remain informational.
- The separate worker captures all due active/enabled accounts before mutation and processes at most one oldest occurrence per account per invocation. PostgreSQL derives cash amount/source/category from the locked plan and cash date from Asia/Jerusalem today. It records one expense and one Savings deposit atomically with the permanent nominal-month claim and next-date advancement. No real bank transfer or future cash is created.
- Day31 produces Jan31 → Feb28 → Mar31; in leap year2024 it produces Jan31 → Feb29 → Mar31. December advances into January without changing the day. Missed January processed February3 would record February3 cash with January occurrence/due snapshots; the executed delayed fixtures used the actual current business date, not a fabricated February3. Another overdue month waits for another invocation.
- Financial plan changes/clearing reject unclaimed overdue work until explicit fulfillment or a reasoned zero-valued skip. Changes to an existing settled plan apply to the first future unclaimed date; a first plan can deliberately represent past outstanding work. Schedule revisions do not redefine identity.
- The Savings monthly dialog explicitly creates a deposit or selects existing ordinary/imported cash. Eligible already-linked manual deposits can also fulfill the occurrence without another cash row or balance increase: the engine appends a same-snapshot reversal/replacement with the first claim, preserving original ordering. Amount/source differences require an explicit override and reason; dates/amounts alone never imply fulfillment.
- Corrections, detach, cancellation and explicit restoration retain the occurrence root/month/due/revision. Cancellation never makes a month eligible for automation again. History offers explicit restoration of a skip; it posts a deposit and reverses the skip once. Detached live cash is explicitly reused, voided cash gets a new audited transaction. Account moves, invalid links, Loan/funded-transfer conflicts and negative historical prefixes are rejected atomically.
- Normal transaction entry, Finance v3 styles/fonts, navigation, existing Loan scheduling and Budget actuals remain intact. Recurring deposits are ordinary Savings-category envelope expenses, not provenance-exempt funded transfers. Existing financial invalidation refreshes Savings, Transactions and affected summaries after interactive writes; scheduler effects appear on the next normal fetch/reload.

### APIs, scheduler authorization and database objects

| Entry point | Behavior |
| --- | --- |
| Existing POST/PATCH `/api/savings` account endpoints | Store plan; PATCH `auto_deposit_enabled` only on explicit owner action; expected revision and retry receipt retained |
| Existing POST `/api/savings/events` | `post_savings_event(UUID,JSONB)` supports `due`, `skip`, and explicit occurrence fields on `create_cash`/`link_cash` |
| Existing correction/cancellation endpoints | Preserve occurrence identity through audited replacement, detach, void and reinstatement |
| POST `/api/internal/jobs/process-due-savings` | Separate `processDueSavingsDeposits` service; requires `SAVINGS_JOB_ENABLED=true` plus `Authorization: Bearer <SAVINGS_JOB_SECRET>`; absent/disabled503, invalid token401 |

The due payload is account_id, occurrence_month, expected_due_date and plan_revision with action=due; SQL selects all cash facts. Manual fulfillment also supplies expected account revision and the established exact cash fields/fingerprint. `plan_override=true` and reason explicitly authorize a different actual amount/source. Skip has only the due tuple, expected revision and reason, without financial fields. IDs/revisions remain text across JSON, and new write amounts remain exact decimal strings.

The scheduler reads the existing summary view in complete pages, captures the candidate set once, then calls the existing atomic posting RPC. Reports contain processed/alreadyClaimed/skipped/failed and bounded identifiers/codes, not upstream connection errors or secrets. A transient serialization/deadlock retry uses the same request UUID and is bounded to one retry. Database claim uniqueness remains authoritative across invocations, concurrency and manual races. No workflow has been scheduled or enabled by this task, and the existing Loan workflow/endpoint/authentication is unchanged.

[034_savings_monthly_deposits.sql](../server/migrations/034_savings_monthly_deposits.sql) replaces exactly:

1. `savings_validate_account()` — configuration validation and claim-based next due.
2. `update_savings_account(BIGINT,BIGINT,UUID,JSONB)` — explicit automation flag and old/new source locks before the account.
3. `savings_post_event_locked(UUID,JSONB)` — due/skip/fulfillment and occurrence-aware audited operations.
4. `savings_assert_links()` — narrowly validated same-snapshot fulfillment replacement.
5. `get_savings_account(BIGINT,DATE,DATE,BIGINT,INTEGER)` — explicit skip-restoration eligibility.

There are **no new function signatures, tables, views, columns, indexes, sequences, trigger attachments or grants**, and no data backfill. Existing two Savings tables/one summary view, ten public RPCs/eleven helpers, partial permanent-claim indexes, narrow privileges/RLS, protected void fields and the service-only read Budget exception remain. Migration034 is appended identically to full_schema.sql; 030–033 and all historical migrations remain unchanged. Loan definitions/grants and all unrelated financial history are preserved.

### Executed verification and limitations

- **12 distinct real disposable PostgreSQL cases passed**: initial seven, four additional calendar/upgrade/integrity cases, and final cancelled-skip/detached-occurrence restoration case. After the final lock/skip refinement, the affected pause/archive race, upgrade/clean/artifact gate and restoration case passed again (3/3); no complete successful suite was repeated unnecessarily.
- Coverage includes due/future/disabled plans; short months/year/leap dates; actual-date missed posting; duplicate jobs/manual races; imported cash and already-linked fulfillment; exact money/override; stale config; rollback/retry after source repair; pause/archive serialization; corrections/cancellation/reinstatement; account-move rejection and historical solvency. PostgreSQL16 containers were newly created, labelled disposable, inspected and had no host database ports. No mocked test is described as database evidence.
- **28 manual/interest plus15 funded-surplus PostgreSQL regressions passed against034**, including both Loan/Savings link-contention directions, ordinary Loan behavior, interest conversions, reserve history, transfer provenance, cash/tombstone reads, concurrency and rollback. Two old stage-specific upgrade assertions were intentionally skipped in adapted external runners; the new authoritative033→034 upgrade/clean-schema test and both034 JSON artifacts passed. Nothing skipped is counted as passed.
- **513/513 client tests (33 files), 343/343 server tests**, client lint and production build passed. Existing chunk-size advisory and jsdom chart-dimension warnings remain; no new dependency/version change. A focused UI test caught unintended form submission from the enable button, which was corrected with an explicit button type before the complete successful suite.
- Full application with actual HTML, Heebo/Inter fonts, providers, styles, Express controllers, PostgREST and disposable PostgreSQL: plan persistence; explicit enable without cash; a real protected job posting; explicit existing-expense fulfillment; resulting balance/history/refetch; future-date feedback; keyboard Escape/focus return; desktop1440×1000/mobile390×844 RTL and both themes. A future-plan amount edit retained the balance and enabled state. Ordinary expense entry retains its accepted empty description/default Savings-free context and responsive presentation. This is agent browser evidence, not owner acceptance.
- Connected browser discovery returned none; installed isolated Chromium was used. Temporary fixture-route/option-visibility locator mistakes were corrected; they were not product or database failures. Screenshots/logs/tooling remain outside the checkout under `C:\Users\ozavr\AppData\Local\Temp\finance-sav06-20260914`. No production checks, deployment or owner functional checks are claimed.
- Strict UTF-8, local documentation links, migration/schema consistency, git diff --check, all seven unchanged1.2.0 versions, unchanged HEAD/index and preserved initial unrelated file hashes are verified in the final preservation record. The old development-standard modification is excluded from this task.

### Owner preview and rollout

**http://127.0.0.1:5182/savings** remains running in the normal application shell, with a loopback-only test identity and no login required. Normal navigation and mobile “עוד” expose Savings. It reuses the inspected disposable `sav05_preview` database, PostgreSQL container `finance-sav03-development`, PostgREST55458 and Express55459; earlier preview data and the separate5180 preview remain intact. The loopback runner enables only its isolated job endpoint for agent tests; no timer is running and production configuration is unchanged.

Prepared account: **“בדיקת בעלים SAV-06 — הפקדה חודשית 100”**, id11, opening1,200, monthly100, nominal day14, due2026-09-14, source1, automationoff and explicit zero legacy overlap. Agent demonstration account9 holds1,300 after one automated100 deposit, next due2026-10-01; account10 holds75 from explicitly linked existing cash. Their audit histories remain available.

1. פתחו את חשבון בדיקת הבעלים דרך חסכונות. בדקו תוכנית100₪ ביום14 ורישום אוטומטי כבוי; שמירת פרטים אינה מפעילה אותו.
2. ב״תוכנית חודשית״ אשרו הפעלה או השהיה במפורש. השינוי לבדו אינו יוצר כסף או משנה יתרה, והמערכת אינה מבצעת העברה בנקאית.
3. הסדירו את המועד פעם אחת: צפו להוצאה אחת, הפקדה אחת ויתרה1,300₪; המועד הבא14/10. לחלופין קשרו הפקדה קיימת במפורש בלי כפל כסף/יתרה.
4. בדקו רענון, היסטוריה, דילוג עם סיבה והחזרה מפורשת; ביטול הפקדה אינו פותח מחדש את המועד לאוטומציה. בדקו נייד/מחשב, שתי ערכות נושא ומקלדת.

Owner-controlled production order, **not executed**: complete review/commit workflow, install any missing030→031→032→033 with their own checks, disable Savings jobs and pause application/import writes, save [034 preflight](MIGRATION_034_PRODUCTION_PREFLIGHT.sql), apply only034 once, save [034 postflight](MIGRATION_034_PRODUCTION_POSTFLIGHT.sql), and compare every evidence count/fingerprint exactly. Each script returns one consolidated JSON result; both require automation off during installation and support existing Savings history. They passed on the disposable upgrade fixture. The later running preview intentionally has enabled test plans, so its final function-only revision check compared history and function hashes separately rather than calling that active-demo state an installation PASS.

Reload PostgREST schema cache, deploy compatible server/client and verify authenticated manual/read/cancellation paths. Only then configure a dedicated Savings job secret, explicitly enable the server gate and intended account plans, and arrange an owner-controlled daily authenticated invocation of `/api/internal/jobs/process-due-savings`. Rehearse first against isolated data; inspect per-account failures before retrying. No new GitHub scheduled workflow is activated here. Rollback after activity means stop the job/new writes and deliver a compatible forward fix, never drop history or release permanent occurrence claims.

To stop only the reused current preview, read `C:\Users\ozavr\AppData\Local\Temp\finance-sav05-20260913\preview.pid`, verify that PID's command line points to that directory's preview.mjs, then stop that process. Do not stop the older preview, shared PostgreSQL container or unrelated processes. Owner acceptance of #42 and deployment/scheduler activation remain pending; #43 was not started.

### SAV-06 changed files and final tracking

Files changed relative to the recorded initial working tree; earlier Savings work and the unrelated development standard remain separate:

- `client/src/pages/Savings/Savings.jsx`
- `client/src/pages/Savings/SavingsAccountDialog.jsx`
- `client/src/pages/Savings/SavingsMonthlyDialog.jsx`
- `client/src/pages/Savings/SavingsMonthlyDialog.test.jsx`
- `docs/MIGRATION_034_PRODUCTION_POSTFLIGHT.sql`
- `docs/MIGRATION_034_PRODUCTION_PREFLIGHT.sql`
- `docs/SAVINGS_FOUNDATION.md`
- `docs/SAVINGS_V1_3_0_SPEC.md`
- `server/controllers/savingsJobController.js`
- `server/middleware/savingsJobAuth.js`
- `server/migrations/034_savings_monthly_deposits.sql`
- `server/services/dueSavingsDepositService.js`
- `server/test/dueSavingsDeposits.test.js`
- `server/test/savingsMonthlyPostgres.local.test.js`
- `CHANGELOG.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP.md`
- `server/full_schema.sql`
- `server/routes/internalJobRoutes.js`

Independent GitHub readback confirms #42 Open / Verify / P2 — Medium, one existing Project item, milestone v1.3.0, parent36 and the retained completed dependency39. Its nine implementation criteria are checked with the evidence above, and one final handoff comment is recorded. #40 remains Open / Verify / P2, #41 Open / Verify / P1, and #38/#39 Closed / Completed / Done. All other Project items, labels, assignees and membership counts are preserved; milestone v1.3.0 remains open. Owner review remains pending.

## SAV-07 reporting implementation — 2026-09-14

[#43](https://github.com/OzAvrahami/finance-tracker/issues/43) delivers read-only Savings reporting in the normal full application. The owner acceptance at the top of this document completes #40–#42 only. SAV-07 remains Open / Verify for its own owner review. All implementation/documentation remain local, uncommitted and unavailable on remote main; no production execution or acceptance is claimed.

### Delivered surfaces and date semantics

- Dashboard adds one secondary report below the existing monthly summary, following its selected month. Existing KPI totals and independent charts/widgets retain their meanings. The month helper text now includes Savings period flows and distinguishes current holdings.
- Savings adds a selectable month report alongside existing all-time cards, goals, no-target state, next planned amount/date, automation state and active/archived accounts. Account links open details even when already on the Savings route; archive/restore and financial mutations refetch the report. Expanded detail and account selection survive a period refresh.
- Annual Summary adds the same report for its selected calendar year, including years with Savings-only activity even if the Budget report is empty. Budget/Annual bridge wording includes all deposits not sourced from funded surplus, including recurring deposits, without relabelling them as manual-only.
- Transactions adds a flow filter for ordinary expenses, Savings deposits, returned Savings funds, paid-out interest and other income. It combines with existing account/category/source/date/search filters and resets cursor/totals together. SQL classifies before all six sort branches and pagination/totals. Report links preserve inclusive period bounds; linked rows show the account and cash role. Account-association filtering retains historical detached associations with their explicit historical label; the report's optional account cash scope uses active links only.
- Current held balance always means current all-time holdings, including archived accounts. Period ledger flows use effective_date of current unreversed posts, excluding opening/skip entries. Replacements supersede originals in the corrected account/date; cancellations contribute zero. Cash uses live transactions.transaction_date and total_amount only. No linked ledger amount is added to cash. This is not #45's bank-balance/settlement-date capability.
- Capitalized interest contributes held assets/earnings, never cash. Paid-out interest contributes cash/earnings, never held assets. Withdrawals return existing funds without another earnings recognition. Legacy Budget reserve is not a held asset. Only the already-approved funded-transfer provenance is excluded from envelope actuals; ordinary and recurring deposits retain their Budget treatment.

### API and database inventory

GET /api/savings/report?from=YYYY-MM-DD&to=YYYY-MM-DD&accountId=optional-exact-id is authenticated through the existing Savings route. It validates dates and exact identifiers, returning decimal text, current held balance, period deposits/withdrawals/capitalized and paid-out interest, cash classification/reconciliation, and per-account flows/current summaries.

[035_savings_reporting.sql](../server/migrations/035_savings_reporting.sql) adds one read-only get_savings_report(DATE,DATE,BIGINT DEFAULT NULL) RPC. One STABLE statement supplies a consistent snapshot from savings_account_summary, current ledger posts and transactions_filtered; there is no per-account history download or Node arithmetic.

It replaces transactions_filtered with a ninth optional p_savings_flow TEXT argument and transactions_page with a seventeenth optional p_savings_flow TEXT argument. Earlier positional/named calls remain valid through defaults. The old signatures are dropped and recreated atomically to avoid RPC ambiguity. Default cash totals and cursor ordering are unchanged. Both new signatures retain service_role EXECUTE only; the filtered/report readers use SECURITY DEFINER and pinned search paths, while pagination remains SECURITY INVOKER. Existing private mutation helpers remain denied.

No other database object changes: **zero tables/views/columns/indexes/triggers/sequences added**, and no financial backfill or write-function changes. Cumulative Savings remains exactly savings_accounts, savings_entries and savings_account_summary: two tables/one view, eleven public Savings RPCs including this new read-only reader, eleven helper/trigger functions (ten private plus the read-only Budget exception). Existing Budget remains eleven tables/nine views. Loan functions/calculations, the Budget actuals reader exception and protected void fields are unchanged. Historical migrations030–034 remain byte-for-byte intact.

### Executed verification and limits

- **Seven distinct real disposable PostgreSQL reporting cases passed.** New labelled PostgreSQL16 containers had no host ports, and target identity was verified before DDL. Coverage: the exact fixture below; current-vs-period/year semantics; cross-month funded transfer; archived/no-target/exceeded-target accounts; six-sort pre-pagination classification and whole-filter totals; correction across periods; detached live cash and protected cancellation; payout-to-capitalized replacement; ordinary withdrawal without repeated earnings; cancelled payouts; exact amounts beyond JS integer precision; invalid dates/account; service-only reader grants; direct Budget views; 034→035 upgrade and clean full_schema equivalence. Successful cases were retained and only failed/newly extended cases rerun. Initial fixture assertion mistakes (existing numeric scale and required correction fingerprint) were corrected; no write engine was altered.
- Fixture: opening1200 + ordinary deposit100 + funded deposit300 − withdrawal50 + capitalized10 = held1560. Period deposits400, withdrawals50, earnings15 (10 capitalized +5 paid out); Savings cash out400/in55. Ordinary source spending700 makes total cash expenses1100; Budget envelope actuals800 includes ordinary deposit100 and excludes only funded300. Opening is absent from period deposits/earnings. Cross-month August-source/September-cash verification leaves cash in September and source funding reduction in August. No future cash or production data was used.
- Full required gates: **518 client tests across34 files and 345 server tests passed**. After the scoped loading/navigation/refetch/helper-copy corrections, **35 affected report/Savings/Dashboard tests** passed, as did the six affected Budget transfer tests. Final client lint and production build passed. The build retains the existing >500kB chunk advisory; jsdom chart-size warnings are unrelated test-environment output. No version/dependency changes.
- Real full-app isolated Chromium: reports at1440×1000 and390×844, Hebrew RTL, dark/light themes, actual HTML/Heebo/Inter/providers; month/leap-month and annual/Dashboard period propagation; cash-flow links/filter changes; same-route account detail navigation; real capitalized-interest UI save and audited cancellation with report refetch; archive/restore report refetch; keyboard summary/Enter/Escape; preserved expansion/filter choice; Dashboard/Budget/Loans smoke; ordinary expense blank defaults and no irrelevant Savings controls. Representative screenshots were inspected. The connected browser was unavailable; installed isolated Chromium was used. Agent checks are separate from owner acceptance.
- Read-only035 pre/postflight artifacts passed on disposable data with exactly matching history/function/Budget fingerprints. Applying035 to the existing isolated preview preserved all existing financial rows and write definitions. No production SQL was performed. The complete historical Savings/concurrency campaign was not rerun for this read-only reporting extension; earlier evidence remains intact, and unchanged write/Loan function fingerprints are verified.
- Strict UTF-8, local documentation links, seven unchanged1.2.0 version fields, canonical schema suffix, git diff --check and preservation of all files outside the task inventory were verified against the initial snapshot. Temporary scripts/logs/screenshots are outside the checkout under C:\Users\ozavr\AppData\Local\Temp\finance-sav07-20260914.

### Owner preview and rollout

The actual full application remains **http://127.0.0.1:5182/savings**, using the existing loopback test identity, Express55459, PostgREST55458 and labelled disposable sav05_preview database. Existing preview data is preserved. Prepared account **“בדיקת בעלים SAV-07 — התאמת דוחות” (id12)** has opening1200, manual deposit100, withdrawal50, capitalized interest10 and payout5: held1260, target5000, remaining3740 and25.2% progress; September flows100/50/15. A one-unit UI refetch test was posted and audited-cancelled, leaving these values unchanged. The automated fresh-database fixture above additionally verifies funded300 and held1560. An attempted preview-only transfer from a2024 test source was correctly rejected by the existing current/previous-month rule; its labelled test funding is isolated and no transfer occurred. Do not infer a new accepted or deployed feature from these fixtures.

בדיקת בעלים קצרה: בחרו ספטמבר2026 בדוח החיסכון, פתחו פירוט ובחרו את חשבון הבדיקה; בדקו את ההפרדה בין יתרה נוכחית, הפקדות, משיכות וריבית. החליפו חודש/שנה ובדקו שזרימות התקופה משתנות והיתרה הנוכחית נשמרת. עברו מהדוח לתנועות לפי סוג תזרים ולפרטי החשבון. בדקו RTL, מובייל ושתי ערכות הנושא. זו בדיקת SAV-07 בלבד; אין צורך לחזור על קבלת SAV-04–06.

Owner-controlled upgrade: ensure030→031→032→033→034 are installed in order; pause application/import/job invocations, run [035 preflight](MIGRATION_035_PRODUCTION_PREFLIGHT.sql) →035 once → [035 postflight](MIGRATION_035_PRODUCTION_POSTFLIGHT.sql), compare evidence exactly, reload PostgREST schema, then deploy the compatible server/client. Account automation flags are preserved;035 neither enables nor invokes a scheduler. Keep production scheduler enablement under the earlier explicit owner-controlled prerequisites. No stage, commit, push, version bump, release, production migration or deployment occurred. #44 remains unstarted.

### Files changed in SAV-07 (relative to the initial local snapshot)

- client/src/components/SavingsReport.css
- client/src/components/SavingsReport.jsx
- client/src/components/SavingsReport.test.jsx
- client/src/pages/Budget/BudgetSavingsTransfers.jsx
- client/src/pages/Savings/Savings.jsx
- client/src/pages/Savings/Savings.test.jsx
- client/src/utils/savingsReporting.js
- docs/MIGRATION_035_PRODUCTION_POSTFLIGHT.sql
- docs/MIGRATION_035_PRODUCTION_PREFLIGHT.sql
- docs/SAVINGS_FOUNDATION.md
- docs/SAVINGS_V1_3_0_SPEC.md
- server/controllers/savingsController.js
- server/migrations/035_savings_reporting.sql
- server/routes/savingsRoutes.js
- server/services/savingsService.js
- server/test/savingsAccounts.test.js
- server/test/savingsReportingPostgres.local.test.js
- CHANGELOG.md
- client/src/pages/AnnualSummary/AnnualSummary.jsx
- client/src/pages/AnnualSummary/AnnualSummary.test.jsx
- client/src/pages/Dashboard/Dashboard.jsx
- client/src/pages/Dashboard/Dashboard.test.jsx
- client/src/pages/Dashboard/DashboardSections.jsx
- client/src/pages/Transactions/Transactions.jsx
- client/src/pages/Transactions/Transactions.test.jsx
- client/src/pages/Transactions/TransactionsFilters.jsx
- client/src/pages/Transactions/TransactionsList.jsx
- client/src/services/api.js
- docs/ARCHITECTURE.md
- docs/DECISIONS.md
- docs/PROJECT_STATUS.md
- docs/ROADMAP.md
- server/controllers/transactionController.js
- server/full_schema.sql
- server/test/transactionsPagination.test.js


Final independent tracking readback: #40/#41/#42 Closed / Completed / Done, priorities P2/P1/P2; #43 Open / Verify / P2 with eleven implementation checklist items checked and one handoff comment. Parent36, milestonev1.3.0 (still open), all native dependency links, labels, assignees and unique existing memberships are preserved. All unrelated Project items and Project field configuration match the initial snapshot. #38/#39 remain Closed / Completed / Done. No #43 owner acceptance is inferred.


## SAV-07 owner acceptance and SAV-08 integrated preparation — 2026-09-15

The owner reviewed SAV-07 and said “נראה טוב”. #43 is now Closed / Completed / Done / P2, based on this appearance/preview acceptance and the existing technical evidence. No numerical, device or production tests are attributed to the owner. Independent readback confirms #37–#43 completed / Done with priorities and completed native dependencies retained. The current handoff supersedes the preceding historical statement that #43 awaited acceptance and #44 was unstarted.

SAV-08 does not change application behavior or historical migrations. It adds the repeatable ordered-upgrade/restore test, a bounded final-schema scenario runner, one read-only final SQL audit, and the [canonical release preparation/operator runbook](RELEASE_1_3_0.md). The runbook contains the complete object/file inventory, migration hashes, reviewed release-note draft, exact seven later version fields and separate production/scheduler/recovery steps. No036 migration is required.

### Executed integrated matrix

| Scope | Actual evidence |
| --- | --- |
| Baseline029, existing cash/Loan/Budget history, reserve0/500 | Two ordered030–035 cases passed; all12 stage artifacts per case passed at their proper schema stage, with matching preservation evidence |
| Opening/overlap/goals/archive and invalid rollback | Opening1200/target5000 gives remaining3800; overlap300 from500 leaves200 with unchanged cash; no auto-backfill; invalid overlap leaves all rows unchanged; configuration/archive/restore preserve opening |
| Final schema and recovery | Upgraded catalog equals clean snapshot; four custom archives restored with matching rows, sequences, effective ACLs and definitions; after-write restoration includes a live Loan relationship and a Savings cash tombstone; old backup re-upgrade demonstrably lacks later Savings writes |
| Manual accounting | Nine final-schema cases: exact create/retry, imported linkage, same-day correction/order/account/date, direction/installment protection, detach/void/reuse, cancelled readers/external identity, cutoff/archive, competing withdrawals and both Loan-link contention orders |
| Interest | Nine final-schema cases: numerical contract, existing income, four destination corrections, consumed historical balance rollback, concurrent cancellation/withdrawal/duplicate payout and privileges |
| Monthly | Eight final-schema cases: oldest due, nominal31/February/leap/year, future/pause/archive, skip/reinstatement, explicit existing/already-linked fulfillment, permanent cancelled identity, job/manual races and source-failure rollback/retry |
| Funded surplus | Eight final-schema cases: same/cross month, stale preview/account/policy/spending, duplicate competing transfers, whole reversal restrictions, atomic close and ordinary legacy/carryover/reserve operations |
| Reporting | Five final-schema cases: combined1560 fixture, period/cross-month cash bridge, six-sort filtering before pagination, corrected/detached cash, archive/targets/exact money/privileges |
| Final SQL audit | All18 read-only checks pass on empty Savings, restored opening/cancelled history and the combined1560 fixture; one JSON result |
| Required application gates | Client518/518 in34 files; server345/345; lint/build passed once for this final implementation. Existing build chunk advisory and expected negative-path/jsdom warnings only |

There are **41 distinct PostgreSQL cases** (39 reused final-schema scenarios +2 integrated upgrade/recovery cases); the later targeted combined-fixture audit reruns one of those cases and is not counted as a new case. No selected assertions were skipped. Obsolete stage-only upgrade/count/hash assertions are explicitly excluded from the final-schema runner, not counted as passes; actual stage artifacts are exercised directly by the ordered rehearsal. Early harness failures concerned pg_dump expression/default-ACL serialization and overly broad synthetic sequence grants, all corrected without weakening production privileges or changing product code. The final comparison normalizes only two known equivalent CHECK spellings and effective owner-only ACLs.

### Full-application preview and evidence

Actual application HTML, Heebo/Inter fonts, providers, normal shell/navigation and the existing isolated Express55459/PostgREST55458/database sav05_preview were reused. Database container identity, disposable labels and loopback connection target were verified before preview writes. No production credentials/data or scheduler invocation was used. The connected browser was unavailable; installed isolated Chromium supplied the evidence.

Executed browser steps: create a new account/opening/goal, Savings-page deposit and normal income-form withdrawal, capitalized and payout interest, configuration persistence, explicit plan enable/pause and manual fulfillment, archive/restore, account history/navigation, report month/year/filter/refetch, mobile filter controls, keyboard Enter/Escape, Dashboard/Budget/Annual/Transactions navigation and ordinary expense/income/itemized entry. Desktop1440×1000/mobile390×844 and both themes were checked; representative screenshots were inspected. Harness waits/confirmation and hidden-mobile/duplicate-metric selectors were corrected and remaining checks continued without repeating successful writes. No visual redesign or accounting change was made. Earlier implemented Budget confirmation/reversal browser evidence remains valid; this pass reused existing Budget data and did not repeat that entire campaign.

Preview: **http://127.0.0.1:5182/savings?accountId=14**. Prepared account **בדיקת שילוב SAV-08 1789419400916**, id14: opening1200 + manual100 + explicitly fulfilled monthly25 − withdrawal50 + capitalized10 = held1285; paid-out5 makes earnings15. Target5000, remaining3715, next nominal date2026-10-14, active with automation **off**. This browser fixture is separate from the real-PG funded300/held1560 fixture. Earlier preview data is preserved. This is agent verification, not additional owner acceptance.

### Completion boundary

The owner subsequently approved this integrated-verification/release-preparation handoff. Independent readback confirms #44 Closed / Completed / Done / P2 — Medium; #36 and milestonev1.3.0 remain open. All labels, assignees, priorities, unique Project items and native dependencies remain. The separately authorized seven-field version step is prepared at1.3.0 on feat/savings-v1.3.0, and selective staging prepares the accepted bundle for the owner’s commit and Git-bundle transfer. Existing verification is reused; no new financial/database/browser campaign was run for this metadata step. Commit, production backup/restore validation, migrations030–035, deployment/smoke, explicit scheduler enablement, tag and publication remain owner-controlled and unexecuted. See the canonical runbook for Mac continuation and preservation checks. The unrelated github-development-standard.md modification is preserved and excluded. New SAV-08 files are server/test/savingsReleasePostgres.local.test.js, server/test/run-savings-release.cjs, docs/SAVINGS_RELEASE_POSTFLIGHT.sql and docs/RELEASE_1_3_0.md. Companion changes are README, CHANGELOG, ARCHITECTURE, DECISIONS, PROJECT_STATUS, ROADMAP and the canonical specification/current handoff.
