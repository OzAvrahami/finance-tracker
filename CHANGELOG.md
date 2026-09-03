# Changelog

All notable changes to Finance Tracker will be documented in this file.

Formal release tracking begins with **v0.9.0**, the first formally tracked Finance Tracker baseline. No earlier semantic releases are implied.

This format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and will use semantic-version-style tracking for formal releases.

## [Unreleased]

### Added

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

- Copy preserves destination month overrides, recurring initialization gives an exact override precedence, and pending overrides block carryover-only snapshot creation.
- The dedicated Budget settings tab lets expense categories enable, update, explicitly set to zero, or disable a recurring monthly opening amount without mixing budget controls into category metadata or rewriting established months.

- Budget compatibility `amount` and annual planned totals now represent derived final funded amounts.
- Budget removal and copy routes now preserve provenance and require destination funding rather than deleting history or inventing money.
- Funded-budget money crosses PostgreSQL, JSON, Node, and React as canonical decimal strings; authoritative mutation requests reject JSON numbers and annual compatibility aggregation uses exact minor-unit arithmetic.

### Fixed

- #20 — Serialize carryover application against transaction writes, reject stale approved previews atomically, and preserve distinct raw and effective actual-spending provenance.
- #17 / #26 — Reject non-finite funded values and transaction actuals, reserve idempotency keys for no-op adjustments, use rollback-safe sequence restart, standardize month-first locks, and narrow legacy budget privileges.

### Removed

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
