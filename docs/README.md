# Finance Tracker documentation

This is the documentation entry point. Choose by purpose rather than by issue number.

| Need | Authoritative location |
| --- | --- |
| Local setup, commands, configuration, deployment entry points | [Development and operations](operations/DEVELOPMENT.md) |
| Runtime/domain boundaries | [Architecture](architecture/ARCHITECTURE.md) |
| Accounting design decisions | [Decision record](architecture/DECISIONS.md); domain contracts below |
| Database history, schema reference, safe checks | [Database guide](operations/DATABASE.md) |
| Agent/Issue workflow and release/version policy | [GitHub Development Standard](github-development-standard.md) |
| Published versions | [GitHub Releases](https://github.com/OzAvrahami/finance-tracker/releases) |
| Change history | [CHANGELOG](../CHANGELOG.md) |
| Work status, priority, dependencies and acceptance | [Finance Tracker Project](https://github.com/users/OzAvrahami/projects/1) and its existing issues |
| Previous verification and release checkpoints | [Historical records](history/README.md) |
| Folder responsibilities, cleanup decisions and retained uncertainties | [Repository organization audit](REPOSITORY_ORGANIZATION.md) |

## Current baseline and boundaries

[v1.7.0 is the latest published release](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.7.0).
The owner authorized [v1.8.0 preparation](history/RELEASE_1_8_0.md) on 2026-10-29,
using current main (Strategy A). Seven product-version fields read 1.8.0 locally;
the candidate is unpublished. Accepted scope is #100/#101 and reviewed Shopping/Auth
corrections. Deployed #96 is explicitly included, with full owner acceptance and
live producer activation pending; keep its Issue open.

The candidate record attributes production evidence to the owner: Railway d610a31,
one replica/standard Node startup, the confirmed Supabase project, matching key
052/053 functions and verified RLS/trigger/privilege boundaries. General API
registrations, receipts and resolutions are all zero. No new producer activation
is authorized; complete live CAL/Apple Pay acceptance is not established.

Backup unavailable — owner elected to proceed with release preparation despite the risk.
Backup/recovery verification is not Passed. This decision authorizes no destructive
database operations or new migrations. Preparation itself changes no production state.

- Historical unresolved FlowLink/#81/#90 device and real Wallet acceptance remains
  separate. Its unrelated CHANGELOG entries stay under Unreleased. Native version/build
  numbers are unchanged, and no Apple/FlowLink ingestion activation is authorized.
- Multi-user [#63](https://github.com/OzAvrahami/finance-tracker/issues/63) is deferred
  to **v2.0.0**. #64 is Backlog; its local architecture/inventory drafts are unaccepted
  and outside the release. They are not an approved replacement for current contracts.
- Notifications and app distribution remain future scope. Device enrollment and
  per-card authorization do not imply financial tenant isolation.

These are bounded release/acceptance caveats, not a second Project board. GitHub
owns live Issue state; dated handoffs below must not be interpreted as current status.

## Technical contracts

- [General transaction API: single/batch evidence, compatibility and retries](architecture/GENERAL_TRANSACTION_API.md)
- [Budget transaction navigation](architecture/BUDGET_TRANSACTION_CONTEXT.md)
- [Named Savings accounting](architecture/SAVINGS_V1_3_0_SPEC.md)
- [APY identity, time, money and reconciliation](architecture/APPLE_PAY_TRANSACTION_RECONCILIATION.md)
- [FlowLink native identity and ingestion contract](architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md)
- [FlowLink native app guide](../ios/FlowLink/README.md)

## Operator and implementation guides

- [General transaction API local review, receipt resolution and migrations 052 / 053](operations/GENERAL_TRANSACTION_API.md)
- [APY integrated readiness and CAL activation gate](operations/APY_06_RELEASE_READINESS.md)
- [Transaction source status and owner review](operations/APY_05_RECONCILIATION_REVIEW.md)
- [Shopping habits, receipt review and OCR setup](operations/SHOPPING_RECEIPTS.md)
- [Shopping UX and Settings version: owner review, commit scope and migrations 050–051](operations/SHOPPING_UX.md)
- [Database files and operational SQL checks](operations/DATABASE.md)
- [Funded Budget migration boundaries](operations/FUNDED_BUDGET_MIGRATION_RUNBOOK.md)
- [CAL / FlowLink reconciliation and producer transition](operations/APY_04_CAL_RECONCILIATION.md)
- [APY foundation, compatibility and recovery](operations/APY_02_INGESTION_FOUNDATION.md)
- [FlowLink device enrollment](operations/FLI_02_DEVICE_ENROLLMENT.md)
- [FlowLink card bindings and authorized writes](operations/FLI_03_CARD_BINDINGS.md)
- [FlowLink owner rollout and held captures](operations/FLOWLINK_OWNER_ROLLOUT.md)

Commands in a runbook still require their stated authorization, target checks and
baseline. Historical preflights are not a current all-purpose production diagnostic.
Only six old-path pointers remain for demonstrated Issue/draft links; see the
[exceptions](REPOSITORY_ORGANIZATION.md#compatibility-pointer-exceptions). Maintained
links use canonical locations. Add new guidance here, not another status copy.
