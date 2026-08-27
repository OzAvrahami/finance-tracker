# Finance Tracker GitHub Development Standard

Finance Tracker follows Oz GitHub Development Standard v1 for Issues, Project workflow, priority, and releases. This document describes how the standard is applied in this repository.

## Status workflow

GitHub Project Status is the source of truth for workflow state:

```text
Backlog → Ready → In Progress → Verify → Done
```

- **Backlog:** Captured work that is not currently planned for active implementation.
- **Ready:** Defined, prioritized, and ready to be started.
- **In Progress:** Currently being implemented.
- **Verify:** Implementation is complete and awaiting verification.
- **Done:** Completed and verified.

New Issues enter Backlog. Moving work through Ready, In Progress, and Verify is a deliberate development decision. Closing an Issue moves it to Done; reopened work is reviewed and moved manually when native automation is unavailable.

## Priority

Priority lives in the Finance Tracker Project, not repository labels:

- **P0 — Critical:** Immediate intervention for an outage, data-loss or corruption risk, or an equivalent critical problem.
- **P1 — High:** Important work that should be among the next items addressed.
- **P2 — Medium:** Normal planned development work and the default priority.
- **P3 — Low:** Nice-to-have work or something that can reasonably wait.

Priority may remain unset until the work is deliberately prioritized. An unset value must not be interpreted or filled automatically from title, labels, Status, age, Issue number, or estimated complexity.

## Labels

Use at most one primary type label per Issue:

- `bug`
- `feature`
- `enhancement`
- `chore`
- `documentation`

The durable Finance Tracker scope labels are `frontend`, `backend`, and `database`. The existing `mobile`, `testing`, and `ui` labels may remain as useful secondary context where applicable; they do not replace a primary type. Meta labels are `duplicate`, `invalid`, and `wontfix`.

Status and Priority must not be represented by labels. Multiple scope or secondary-context labels may apply when they add useful information.

## Default Project views

- `Development` — Board grouped by Status, used for daily flow.
- `All work` — Table used for inspection and editing.

Preferred Development card fields are Priority, Labels, and Assignees. The existing filtered Bugs view is retained as repository-specific context rather than treated as a required Standard v1 view.

## Issue lifecycle

Use the Bug, Feature, Enhancement, or Chore Issue Form. Apply the appropriate `frontend`, `backend`, or `database` scope when known, define the work clearly, deliberately set Priority when warranted, and move Status intentionally as implementation progresses. Closing an Issue represents completed work; `Verify` is used when implementation is complete but verification remains.

## Release policy

Finance Tracker versions use Semantic Versioning with a leading `v`:

- `vMAJOR.MINOR.PATCH`
- `vMAJOR.MINOR.PATCH-alpha.N`
- `vMAJOR.MINOR.PATCH-beta.N`

A GitHub Release represents a meaningful published version and is authoritative for the released version. A Git tag by itself is not a published release. Generated release notes group changes by canonical type labels and exclude `duplicate`, `invalid`, and `wontfix` items.
