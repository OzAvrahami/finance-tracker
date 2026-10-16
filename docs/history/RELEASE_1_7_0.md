# Finance Tracker v1.7.0 candidate — prepared, unpublished

Prepared on **2026-10-16** with the owner's explicit approval to prepare this
candidate. This is a preparation date, not a publication or deployment date.
Branch at review: `main`; baseline HEAD:
`ad28ac9931553ac5ed93df30e902c7af4a9e4ee0`.
The owner performs staging and commit; no push, tag, formal Release, deployment,
production SQL, hosting change or GitHub write is included in this preparation.

## Finalized incremental scope

This candidate groups the current reviewed **Shopping UX + Settings version display**.
It does not move these improvements onto historical issues or change v1.6.0's
#82/#83/#84/#93/#95 grouping. The baseline contains that earlier work; this document
does not claim it was published or reassign its membership. Prior candidate notes
remain unchanged. Unrelated FlowLink Unreleased entries stay under Unreleased.

- One name-first flow for supermarket and general shopping, with bounded/debounced
  scoped catalog suggestions and preserved explicit requirements.
- Optional inline category combobox, normalized exact identity reuse, and atomic
  category/type-link/item creation at submission; neutral fallback remains optional.
- Shared controlled units next to quantity and in row editing, fractional precision,
  legacy/custom-unit preservation and no automatic package-content conversion.
- Reusable catalog saving checked by default under **להציע את הפריט גם ברשימות הבאות**;
  unchecking creates a list-only item. Failed submissions preserve the choice.
- List-specific name/notes corrections preserve catalog identity and product mappings.
- Secondary receipt access with visible pending review; snapshots, stale-review
  protection, checkmarks, receipt confirmation and financial checkout remain separate.
- General Hebrew notes copy and explicit right-aligned RTL empty placeholders.
- Settings **אודות המערכת / גרסת האפליקציה**, showing `v1.7.0` from the frontend
  package metadata embedded by Vite. The number identifies the build's metadata,
  not its publication status or whether its migrations are installed.
- Forward migrations **050_shopping_quick_entry.sql** then
  **051_shopping_entry_categories.sql**, after verified 049 prerequisites.

The [owner handoff](../operations/SHOPPING_UX.md#exact-proposed-commit-scope-35-files)
contains all **35 proposed files**, exclusions, error-checked PowerShell staging/
review/commit commands and the separate migration procedure. The original 26-file
scope grows by five version metadata files and four release-preparation documents
(root README, development standard inventory, history index and this record).
No mixed unrelated hunks were identified in the proposed paths. APY reconciliation
documentation, multi-user documents, Python cache files and ignored private files
are excluded and preserved.

## Version and verification evidence

Seven fields across five files are synchronized from 1.6.0 to **1.7.0**:
root/client/server `package.json` versions and both lockfiles' top-level and root
`packages[""].version` values. Only those metadata values changed; dependencies,
lockfile trees and all other package fields are preserved. There is no root lockfile,
extra version constant or FlowLink native build/version change.

Passed release-preparation checks: seven-field synchronization, semantic package/lockfile
comparison, frontend production build and emitted Settings version inspection,
local served package metadata, whitespace/diff checks, exact scope and documentation
consistency. Existing bundle-size warning remains. The current local frontend
serves 1.7.0 without changing environment files; reload Settings to receive it.
Actual browser visual confirmation of the 1.7.0 label is unperformed by the agent.
The documented owner PowerShell blocks parse successfully; read-only verification
confirmed the error-checking Git helper forwards explicit path arrays correctly.
The staging and commit blocks were not executed by the agent.

Unchanged implementation evidence is reused, not represented as newly rerun:
16 quick-entry UI tests, 21 list UI tests, focused Settings and habits checks,
controller/shared-unit checks, 14 disposable PostgreSQL 050/051 scenarios, receipt
regressions and authenticated isolated API smoke, as individually detailed in the
owner handoff. No new real receipt-provider or production smoke writes occurred.

**Owner acceptance is scoped:** the owner approved v1.7.0 preparation and confirmed
that the corrected Hebrew placeholders/RTL appearance look correct in their browser.
This does not assert all functional, mobile, keyboard, theme, Settings or receipt
checks were performed. Overall functional acceptance remains pending.

## Remaining limitations and migration boundary

Category names remain globally unique with separate list-type links. A name present
only in an incompatible scope is rejected at submission, preserving the form. This
exact-name limitation predates the UX changes; 051 deliberately also prevents new
normalized-equivalent duplicates. Historical collisions are not merged. This remains
documented, not resolved or redesigned during preparation.

Both 050 and 051 were applied and verified **only in isolated local/disposable
databases**. Production applied state, backup/recovery readiness and deployment
controls are unverified here. The prior backup/restore-test waiver was specifically
for the #95/049 rollout, is recorded as **waived, not passed**, and is not implicitly
extended to this candidate or 050/051.

Use the handoff's owner-operated preflight, preservation, application, postflight and
forward-recovery steps. Apply only demonstrably pending reviewed files; never use
`full_schema.sql` on production or blindly rerun applied migrations. Required order:
**050 → 051 → matching backend → matching frontend**. Commit commands contain no
immediate push; Git-triggered production rollout is a separate owner operation.

## Release / Version gate

- Release impact: **Yes** — user-facing Shopping workflow and Settings version display.
- SemVer impact: **Minor overall** — additive compatible capabilities; individual
  default/copy/RTL corrections remain Patch-level components of the bundle.
- Candidate release: **v1.7.0, prepared and unpublished** — owner-approved preparation.
- Grouping / included release candidate: Reviewed Shopping UX and Settings version-display
  scope; prior v1.6.0 grouping unchanged, no issue reassignment.
- CHANGELOG status: **Prepared v1.7.0 section**; unrelated Unreleased entries and
  historical release sections preserved.
- Version-bump status: **Synchronized — seven fields at 1.7.0**, no dependency changes.
- Publication status: **Out of scope** — no tag or formal GitHub Release created.
- Owner verification / acceptance status: Preparation approved; specific Hebrew
  placeholder/RTL visual correction accepted. Other evidence remains scoped above;
  broader functional/Settings acceptance is **Pending**.
