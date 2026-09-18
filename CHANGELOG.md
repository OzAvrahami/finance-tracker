# Changelog

All notable changes to Finance Tracker will be documented in this file.

Formal release tracking begins with **v0.9.0**, the first formally tracked Finance Tracker baseline. No earlier semantic releases are implied.

This format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and will use semantic-version-style tracking for formal releases.

## [Unreleased]

## [1.3.1] - Prepared (unpublished)

Prepared on 2026-09-18 after explicit owner acceptance of #49, #51 and #47. One Patch candidate, coordinated by #49, including the #51 bigint Savings-ID correction. All seven application-version fields are synchronized to 1.3.1. Commit, push, deployment, annotated tag and GitHub Release publication remain pending; this preparation date is not a publication date. Temporary preview-harness repairs are excluded. See [release notes](docs/RELEASE_1_3_1.md) and [verification evidence](docs/PATCH_1_3_1_REVIEW.md).

### Fixed

- #49: Keep long category dropdowns bounded above or below the field, with internal wheel/touch scrolling and visible keyboard selection in Add Transaction.
- #51: Restore the originating Transactions date range, filters (including bigint Savings account IDs), visible search and sorting after Save, Cancel or Back from editing, while loading fresh results.
- #47: Use the compact, contextual allocation interface for Budget deficits, preserving full/partial coverage and the separate deficit-resolution accounting operation.

## [1.3.0] - Prepared (unpublished)

Version metadata and release content prepared on 2026-09-15; this is a preparation date, not a publication date. The owner accepted SAV-01–08 and #37–#44 are completed / Done. The branch is prepared for an owner-operated commit; production migrations030–035, deployment, tagging and publication remain pending. Parent #36 and milestone v1.3.0 remain open. [GitHub Releases](https://github.com/OzAvrahami/finance-tracker/releases) is authoritative for publication state.

### Added

- SAV-08 (#44): Integrated final-schema accounting/concurrency matrix, representative029→030–035 upgrade and clean-install comparison, binary backup/restore rehearsal, one-result final SQL audit, canonical production/recovery runbook and reviewed v1.3.0 release-note draft. No new runtime behavior or migration was needed for integrated verification. SAV-07 preview and SAV-08 handoff acceptance are recorded; the separate seven-field 1.3.0 version step is now prepared. Production/publication remain unexecuted.

- SAV-07 (#43): Dashboard, Savings monthly reports and Annual Summary now separate current held Savings from period deposits, withdrawals and realized interest. Cash reconciliation distinguishes ordinary expenses, Savings deposits, returned funds and paid-out interest, with authoritative transaction filters and account navigation. Migration 035 adds one read-only aggregate RPC and extends two existing reader signatures; no new tables/views or financial write changes. Archived accounts and corrected history remain included; opening balances and capitalized interest never inflate period cash. SAV-04–06 owner acceptance is recorded; SAV-07 subsequently received owner appearance/preview acceptance; production rollout is still pending.

- SAV-06 (#42): Monthly Savings plans now support explicit automation enable/pause, due-only processing, one permanent account/nominal-month claim, manual/imported fulfillment, audited skips and restoration. Migration 034 replaces five existing functions without new relations or backfill. Cash uses the actual Jerusalem processing date; short months retain the nominal day and each invocation handles only the oldest outstanding month. The separately protected scheduler is disabled by default; no production activation or bank transfer is performed. The owner subsequently accepted SAV-04–06 on 2026-09-14; production rollout remains pending.

- SAV-05 (#41): Added named Savings destinations to Budget policies, exact funded-surplus preview/apply and explicitly confirmed month-close deposits. Migration 033 atomically records source funding/allocation out, one expense and one Savings deposit per candidate; provenance-only Budget exclusion prevents double consumption. Protected whole-transfer reversal, stale-preview/idempotency/locking checks, a cash/envelope bridge in Budget and Annual, and explicit legacy-reserve terminology preserve existing accounting. No new tables/views, automation, version bump or deployment. The owner subsequently accepted SAV-04–06; production execution remains pending.

- SAV-04 (#40): Record actual net interest inside Savings or as one new/explicitly linked checking income. Audited amount/date/account/destination corrections, all four cash/noncash conversions, cancellation and explicit restoration preserve exact earnings and historical solvency. Migration 032 replaces only the existing event engine and history reader; no new tables/views or estimated-interest execution. Savings uses the accepted Finance v3 controls; ordinary entry retains its released design. Local verification and subsequent owner appearance confirmation are recorded separately from pending production deployment.

- SAV-03 (#39): Added manual Savings deposits/withdrawals through the normal transaction form and Savings page, explicit existing-cash linkage, audited corrections/detach/reinstatement and idempotent linked/detached cancellation. Migration 031 preserves the two-table/one-view boundary; live paging/totals, account filters and basic financial refetch support the commands. SAV-02 owner acceptance is recorded separately from local automated checks. Realized interest is added by SAV-04 above; funded transfers are added by SAV-05 above; automation is added by SAV-06 above.

- SAV-01 (#37): Completed design review and integrated the canonical Savings v1.3.0 specification: two tables/one view, ten public RPCs, explicit Budget read privileges, stable correction ordering, Loan-side link protection, idempotent detached-cash cancellation, interest-conversion rules, recurrence and reserve/funded-transfer reconciliation. This SAV-01 entry records design work only; its foundation implementation is recorded separately below.

- SAV-02 (#38): Added Savings account setup, exact-money opening/summary/history APIs, Loans-based active/archive management and stored monthly settings. Migration 030 adds exactly two tables and one summary view, protected immutable history/void receipts, original-post correction ordering, Loan link integrity and explicit atomic legacy-reserve overlap retirement. Cash commands, realized-interest actions, transfers and automation remain with their later issue owners; no version bump or deployment is included.

### Changed

- SAV-02 (#38): Delivered baseline live-transaction and Budget/Annual reader filtering, service-only Budget helper privileges, read-only cancelled details and retained external-ID conflicts before cancellation commands can be enabled. Ordinary Loan/transaction accounting and historical migrations remain unchanged.

### Fixed

- SAV-03 (#39) visual review: ordinary transaction creation retains the released expense/category/charge-date defaults when category Savings roles are null. Savings actions now use shared Finance v3 controls with real navigation links; account-card spacing and typography follow Loans. The isolated full-app preview now reuses the application's HTML/font loading. Ordinary form styling, global backgrounds and the accepted Dashboard treatment are preserved. The owner subsequently accepted the corrected appearance; SAV-03 completion uses this confirmation and its existing implementation/verification evidence.

### Removed

## [1.2.0] - 2026-09-07

Application commit [c7129c5cbe016177b5c0ccac0d93d72d8fd54b4a](https://github.com/OzAvrahami/finance-tracker/commit/c7129c5cbe016177b5c0ccac0d93d72d8fd54b4a) was committed and pushed by the user; GitHub readback confirmed remote main at that SHA and successful Vercel and Railway deployment statuses. The user accepted #2 with “2 סבבה” and accepted the final #10/#27 corrections with “אושר”. All three issues are CLOSED / COMPLETED, their existing Project items are Done with P3 preserved, and milestone v1.2.0 is closed. Acceptance is user-performed, not agent browser testing. Migration 029 was separately installed and verified by the user through Supabase SQL Editor; passing preflight/postflight evidence is recorded in [the release handoff](docs/RELEASE_1_2_0.md). Annotated tagging and GitHub Release publication follow the user-owned workflow after this final documentation commit is pushed and its remote SHA verified. [GitHub Releases](https://github.com/OzAvrahami/finance-tracker/releases) is authoritative for publication state; this acceptance record does not require another documentation-only commit after publication.

### Added

- #2 — Added optional shopping-list store, HTTP(S) link, and calendar target date in create/edit and details, with nullable header columns in Migration 029, Hebrew validation, and omission-preserving partial updates.
- #10 — Added the nearest-ending active loan in a compact information row below the original four Loans summary cards, excluding paid loans and invalid or past end dates, using Jerusalem business dates and a stable tie-break.

### Fixed

- #27 — Removed the fixed-size violet corner bloom across Dashboard glass cards, including the monthly summary, Tasks, and Income/Expenses, preserving the sheen, semantic colors, and shared glass styling outside Dashboard.

## [1.1.1] - 2026-09-07

Finance Tracker 1.1.1 corrects the unbudgeted-expense allocation workflow so the recorded expense is a useful starting suggestion rather than a ceiling on the monthly category budget.

### Changed

- #22 — Reworked allocation around the selected category and one requested monthly amount, with an automatic proposal from available unallocated funding and progressive, explicitly selected category or Savings alternatives instead of the previous all-category input grid.

### Fixed

- #22 — Removed the expense-derived allocation ceiling. A user may now create a selected-month category budget above recorded spending when the chosen sources provide sufficient authoritative capacity; preview reports the amount needed to cover spending separately, and validation errors use actionable Hebrew copy.
- Migration 028 was applied by the user through Supabase SQL Editor on 2026-09-07. User-supplied preflight and postflight results both passed with 12 reconciled months, zero maximum delta, the corrected preview contract present, the old cap/field absent, and the consolidated 11-table/9-view boundary intact. Separately, application commit `968c6d0` deployed successfully through Vercel and Railway, and the user accepted the production behavior with “עובד נהדר”; this functional acceptance was user-performed rather than automated browser testing.

### Removed

- Removed the misleading `maximum_allocation` response field and `UNBUDGETED_RESOLUTION_EXCEEDS_ACTUAL` constraint from the current unbudgeted-allocation contract.

## [1.1.0] - 2026-09-06

Finance Tracker 1.1.0 delivers the funded-budget initiative as one coherent, exact-money monthly planning and close workflow. It adds funded envelopes, recurring and month-specific planning, carryover, Savings disposition, reallocation, deficit and unbudgeted-expense resolution, and a consolidated auditable Budget model and presentation.

### Added

- #30 — Migration 026 adds one bounded, fingerprinted command for atomically applying the current-month base override and the same recurring default through the consolidated operation/item model.

- Budget Schema Consolidation — Migration 024 adds universal root/child operation grouping, typed append-only `budget_operation_items`, a direct `budget_category_composition` read model, and operation history without changing funded balances.

- #22 — Migration 023 explicit resolution of transaction-authoritative unbudgeted expenses through zero-opening late snapshots or explicit inactive-snapshot reactivation.
- Atomic partial/full multi-source allocation from unallocated funds, eligible categories, and Savings, plus Budget-to-Transactions correction deep links.
- #23 — Migration 022 provenance-aware current-month reallocation and atomic multi-source deficit resolution, including bounded Savings withdrawals and close-preparation support for the immediately completed unclosed month.
- Budget actions for moving funded money and resolving deficits fully or partially without rewriting opening, override, carryover, disposition, or transaction history.
- #21 — Migration 021 unified unused-balance policies, explicit atomic month close, cross-month return-to-unallocated transfers, and one application-wide retained Savings reserve.
- A bounded Budget month-close panel with read-only review, deficit/unbudgeted blockers, exact per-policy totals, explicit apply, and immutable disposition history.
- #19 — Migration 020 month-specific base overrides with mutable planning configuration, immutable funded provenance, override-aware initialization, exact release safety, and current/future Asia/Jerusalem policy.
- Budget month-base editing that keeps recurring defaults, incoming carryover, other adjustments, and final funded amounts visibly separate.
- #20 — Migration 019 balanced category carryover: explicit current-month application, immutable linked source/destination provenance, exact read-only preview, bounded compensating reversal, and centralized Settings → Budget configuration.
- Budget carryover presentation that keeps the immutable base separate from incoming prior-month funds and reports blocked categories without mutating on read.
- #18 — Migration 018 recurring monthly budget defaults, a dedicated Settings → Budget configuration area, exact read-only month previews, and explicit idempotent funded initialization.
- Budget UI guidance for pending recurring defaults, exact required/unallocated/shortfall values, and a user-invoked “Apply recurring budgets” action; loading a month never applies them.

- #17 / #26 — Migration 017 funded-budget foundation: canonical ILS months, immutable category opening snapshots, append-only funding/movement/lifecycle provenance, reconciled reads, and atomic idempotent RPC commands.
- Minimum funded-budget API and client compatibility showing available, allocated, unallocated, all actual spending, and category deficits.
- Disposable PostgreSQL migration/RPC verification and a production migration review runbook.

### Changed

- #25 — Redesigned the monthly Budget presentation around four funded summary metrics, separate non-netted balances/deficits/Savings, readable category rows, and an accessible on-demand composition breakdown without changing financial contracts. The financial summary precedes the actionable unbudgeted-expense panel on desktop and mobile.
- Budget schema cleanup — Migration 025 rewrites all funded-Budget commands against consolidated operations/items and removes the eight feature-table compatibility views plus five obsolete intermediate read views. The final read layer is nine canonical views; public RPC behavior and financial values are unchanged.
- Consolidated override, carryover, month-close, reallocation, deficit-resolution, and unbudgeted-resolution provenance onto `budget_operations` and typed operation items while keeping funding, allocation, Savings, lifecycle, configuration, and transactions as separate authorities.
- Flattened `get_funded_budget_month(text)` onto the consolidated composition layer and made residual adjustments a direct classification of otherwise-unclassified movements.
- Adopted the repository's structured GitHub issue templates, release-note categories, and development workflow guidance.

- Canonical funded reads distinguish incoming/outgoing unbudgeted-resolution funding from base, carryover, reallocation/deficit resolution, and residual adjustments.
- Canonical funded reads now expose incoming/outgoing reallocation and resolution separately from base, carryover, and residual adjustments.
- Replaced the overlapping carryover toggle with one Settings → Budget policy: carry forward, move to Savings, return to next-month unallocated funds, or unconfigured. Existing enabled carryover settings migrate deterministically to carry forward.
- Carry-forward now participates in the unified close workflow while retaining Migration 019 transfer mechanics and historical provenance.
- Copy preserves destination month overrides, recurring initialization gives an exact override precedence, and pending overrides block carryover-only snapshot creation.
- The dedicated Budget settings tab lets expense categories enable, update, explicitly set to zero, or disable a recurring monthly opening amount without mixing budget controls into category metadata or rewriting established months.

- Budget compatibility `amount` and annual planned totals now represent derived final funded amounts.
- Budget removal and copy routes now preserve provenance and require destination funding rather than deleting history or inventing money.
- Funded-budget money crosses PostgreSQL, JSON, Node, and React as canonical decimal strings; authoritative mutation requests reject JSON numbers and annual compatibility aggregation uses exact minor-unit arithmetic.

### Fixed

- #30 — Migration 027 makes “this month and future” propagate through existing inherited/default future snapshots while preserving explicit month overrides and immutable openings.
- Budget inline editing now distinguishes “this month only” from “this month and future”; the latter changes both states atomically and no longer reports a recurring-only update as a changed current month.
- Restored the mobile “More” sheet above the application shell so its navigation remains visible and usable.

- #20 — Serialize carryover application against transaction writes, reject stale approved previews atomically, and preserve distinct raw and effective actual-spending provenance.
- #17 / #26 — Reject non-finite funded values and transaction actuals, reserve idempotency keys for no-op adjustments, use rollback-safe sequence restart, standardize month-first locks, and narrow legacy budget privileges.

### Removed

- Retired the eight empty feature-specific Budget write tables and the five historical canonical-reader wrapper generations. Runtime compatibility adapters preserve deployed RPC contracts without restoring independent physical ledgers.

## [1.0.0] - 2026-08-15

Finance Tracker's first stable release. It promotes the fully verified v0.9.0 baseline to stable status without introducing new product functionality solely for this release. Core personal-finance workflows are considered stable for regular use.

### Stable product surface

- Dashboard reporting, transactions, categories, payment sources, monthly budgets, and annual summaries.
- Loans and authoritative loan-payment accounting, including manual and scheduled due-loan processing.
- Spreadsheet import, the protected external transaction API, tasks, shopping lists, and Settings.
- LEGO collection and acquisition accounting with transaction synchronization and Rebrickable metadata.
- The Finance v3 RTL interface, Supabase authentication, and the verified Vercel/Railway production deployment contract.

### Changed

- Promoted the verified v0.9.0 baseline to the stable `1.0.0` product and package version.

## [0.9.0] - 2026-08-15

Finance Tracker's first formally tracked baseline, consolidating the mature pre-versioning application and its release-readiness work.

### Added

- Canonical project documentation for architecture, current status, roadmap, decisions, and release history.
- Migration 016 to canonicalize the external transaction API's `external_id` column, partial unique index, and tag-autocomplete function in repository schema history.
- Focused external-ingestion regression coverage for tag serialization, dry runs, and external-ID duplicate handling.
- Portable server test discovery and test-only non-secret environment bootstrap.
- Complete client and server example environment files.

### Changed

- External v1 tag arrays are explicitly serialized to the application's comma-separated TEXT representation before persistence.
- The canonical `get_unique_tags()` privilege boundary is service-role only rather than broadly executable through the exposed schema.
- Root, client, and server package metadata now share the `0.9.0` baseline version and the Node.js `^20.19.0 || >=22.12.0` engine contract.
- Deployment documentation now distinguishes the Vercel client configuration, provider-neutral backend hosting, and GitHub scheduler secrets.

### Fixed

- Added previously unversioned production prerequisites for the external transaction API to `full_schema.sql` and ordered migration history.
- Canonical server tests no longer discover ignored `*.local.test.js` files or require private environment secrets.
- External v1 request logging no longer emits complete financial request bodies or raw external IDs.

### Removed

- No recorded removals yet.

## Pre-versioning development history

These milestones are reconstructed from Git history and migrations. They are not releases and do not have semantic version numbers.

- **January 2026 — Application foundation.** Initial server and client foundations were established (`128dcb9`, `3646122`).
- **January–February 2026 — Transactions, import, and early LEGO support.** Core transaction entry, initial collection tracking, Rebrickable lookup, and spreadsheet import were introduced.
- **February 2026 — Major personal-finance modules.** Initial loans, Supabase authentication, budgeting, payment sources, and shopping workflows were added.
- **March 2026 — Filtering and schema evolution.** Current-month transaction filtering, loan schedule fields, future installment behavior, and broader schema references evolved.
- **May–June 2026 — Product breadth and administration.** Tasks, an external transaction API, Settings, annual summaries, shopping improvements, and richer LEGO acquisition metadata were added. Migrations 001–002 formalized category state and initial LEGO acquisition types.
- **July 2026 — Finance v2 shell.** A responsive application shell and navigation redesign became the intermediate UI architecture.
- **August 5, 2026 — Pagination and aggregation.** Migration 003 and `0887b27` introduced database-backed keyset transaction pagination and dashboard summaries.
- **August 6–10, 2026 — Finance v3 rollout.** Routed pages moved to the current tokenized glass/RTL design system.
- **August 10–11, 2026 — LEGO accounting and synchronization.** Migrations 004–007 added purchase-cost allocation, canonical Purchase/Gift/GWP semantics, images, item metadata, and transaction-to-collection synchronization.
- **August 13, 2026 — Principal-aware loan accounting.** Migrations 008–011 separated the cash ledger from authoritative loan accounting and added atomic RPCs, automatic due payments, early payoff, and corrected component reconciliation.
- **August 14, 2026 — Irregular and indexed loan history.** Migrations 012–014 added catch-up payments, provider balance snapshots, CPI metadata, and irregular historical cash events.
- **August 15, 2026 — Manual repayment workflow.** Migration 015 and `c34209a` added manual transaction-based loan repayments with reversible schedule transitions; `657e22a` prevented paid loans from appearing as new-activity options while preserving historical edit links.
