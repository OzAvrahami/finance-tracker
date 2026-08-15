# Changelog

All notable changes to Finance Tracker will be documented in this file.

Formal release tracking begins with the upcoming **v0.9.0** baseline. That baseline has not yet been tagged or released, and no earlier semantic releases are implied.

This format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and will use semantic-version-style tracking for formal releases.

## [Unreleased]

### Added

- Canonical project documentation for architecture, current status, roadmap, decisions, and release history.

### Changed

- No recorded product changes yet.

### Fixed

- No recorded fixes yet.

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
