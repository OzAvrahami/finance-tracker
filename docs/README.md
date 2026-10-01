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

For the 2026-10-01 v1.5.0 publication and proposed v1.6.0 #82/#83 checkpoint, see
[integrated readiness](operations/APY_06_RELEASE_READINESS.md). The release-preparation
and device-acceptance statements below describe the earlier checkpoint, not later acceptance.

Release-preparation checkpoint 2026-09-30: [v1.4.0](https://github.com/OzAvrahami/finance-tracker/releases/tag/v1.4.0)
is the published stable release. [v1.5.0 Shopping preparation](history/RELEASE_1_5_0.md)
synchronizes seven product-version fields to 1.5.0 locally; publication remains pending.
FlowLink retains its independent native version/build unchanged. Repository migrations
run through **044**; 039–044 were verified only in isolated/disposable databases.
File presence is not proof of an applied production migration.

- Budget-origin review and the APY/FlowLink backend foundations are in the release.
  [#81](https://github.com/OzAvrahami/finance-tracker/issues/81) and
  [#90](https://github.com/OzAvrahami/finance-tracker/issues/90) remain unaccepted.
  Real Wallet-charge/device verification is outstanding; CAL transition and review
  UI are unfinished. Publishing version metadata does not authorize enabling either
  Apple or FlowLink ingestion flag. See the owner rollout guide before any operation.
- Multi-user [#63](https://github.com/OzAvrahami/finance-tracker/issues/63) is deferred
  to **v2.0.0**. #64 is Backlog; its local architecture/inventory drafts are unaccepted
  and outside the release. They are not an approved replacement for current contracts.
- Notifications and app distribution remain future scope. Device enrollment and
  per-card authorization do not imply financial tenant isolation.

These are bounded release/acceptance caveats, not a second Project board. GitHub
owns live Issue state; dated handoffs below must not be interpreted as current status.

## Technical contracts

- [Budget transaction navigation](architecture/BUDGET_TRANSACTION_CONTEXT.md)
- [Named Savings accounting](architecture/SAVINGS_V1_3_0_SPEC.md)
- [APY identity, time, money and reconciliation](architecture/APPLE_PAY_TRANSACTION_RECONCILIATION.md)
- [FlowLink native identity and ingestion contract](architecture/FLOWLINK_NATIVE_INGESTION_CONTRACT.md)
- [FlowLink native app guide](../ios/FlowLink/README.md)

## Operator and implementation guides

- [APY integrated readiness and CAL activation gate](operations/APY_06_RELEASE_READINESS.md)
- [Transaction source status and owner review](operations/APY_05_RECONCILIATION_REVIEW.md)
- [Shopping habits, receipt review and OCR setup](operations/SHOPPING_RECEIPTS.md)
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
