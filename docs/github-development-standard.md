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

New Issues enter Backlog. Moving work through Ready, In Progress, and Verify is a deliberate development decision. Closing an Issue does not by itself prove that its Project field changed: set and verify Done explicitly. Reopened work is reviewed and moved manually when native automation is unavailable.

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

Use the Bug, Feature, Enhancement, or Chore Issue Form. Apply the appropriate `frontend`, `backend`, or `database` scope when known, define the work clearly, deliberately set Priority when warranted, and move Status intentionally as implementation progresses.

The user authorizes development agents to maintain Finance Tracker Issue and Project status through the authenticated GitHub CLI. Agents must use the existing linked Project, discover its current IDs, fields, and Status options before editing, and must not create duplicate projects, fields, or workflow labels.

- Move defined, prioritized work through **Ready**, then **In Progress** when implementation starts.
- Move it to **Verify** after implementation and applicable automated checks pass and the [Release / Version gate](#release--version-gate) is recorded, while user acceptance remains. Deferred version preparation or publication does not block Verify.
- Move it to **Done** and close it as completed only after user acceptance and the required commit, push, and deployment are confirmed. Record deployment as Not applicable for documentation/process-only work; release preparation and publication may remain Deferred when outside the Issue's completion scope.
- Formal release publication is not required before an accepted Issue is completed unless publication is explicitly part of that Issue's completion scope.
- Preserve Priority, assignments, and unrelated Project items unless the user directs otherwise.
- Verify Issue state and Project Status independently after every change.

The owner performs Git commits. Git staging, pushes, tags, and release publication remain manual user actions unless a specific action is explicitly authorized. Production deployment and production data changes require separate explicit authorization.

## Release policy

This section is the canonical Release / Version policy for every implementation handoff, including documentation and process work. Root [AGENTS.md](../AGENTS.md) requires agents to apply it automatically; the Bug, Feature, Enhancement and Chore Issue Forms prompt for initial impact and link here. Intake may say Pending / not yet known. Before handing implementation to Verify, the implementing agent must resolve Release impact to Yes or No and SemVer impact to None, Patch, Minor or Major, with a reason, and report every gate field on the Issue and in the final handoff. Leave owner verification / acceptance Pending until explicit owner confirmation, or explain why it is Not applicable.

Enforcement is through repository agent instructions, Issue Form guidance and deliberate Project transitions. GitHub checks form structure and supports required intake responses where available (GitHub documents required-input validation for public repositories only); it cannot enforce the later handoff or prevent a manual Status change. Form Markdown guidance is displayed at intake, not submitted into the Issue body, so agents must post the completed gate explicitly. There is no executable release gate or new GitHub Action. Existing Issues receive the gate when implemented; do not retroactively migrate closed Issues.

### SemVer decisions and grouped candidates

Finance Tracker release names and tags use Semantic Versioning with a leading `v` (package metadata omits the `v`):

- `vMAJOR.MINOR.PATCH`
- `vMAJOR.MINOR.PATCH-alpha.N`
- `vMAJOR.MINOR.PATCH-beta.N`

A GitHub Release represents a meaningful published version and is authoritative for the released version. A Git tag by itself is not a published release. Generated release notes group changes by canonical type labels and exclude `duplicate`, `invalid`, and `wontfix` items.

| Impact | Decision |
| --- | --- |
| None | Documentation, process or internal-only work that does not change the released product. Release impact: No; explain why no product release is needed. |
| Patch | Backward-compatible bug fix or correction without a new user-facing capability. |
| Minor | Backward-compatible new capability or meaningful feature expansion. |
| Major | Intentional incompatible product, API, schema-contract or operational change. Document the break and required migration/upgrade expectations. |

Choose impact from the actual change, not the Issue type label. Product behavior, compatibility, security or operational corrections can be release-relevant even under a Chore label. Reassess when scope changes.

Several Issues may share a candidate: record the existing coordinating Issue/release-draft reference and its included Issue list, and link it from each member's gate. Use the highest applicable impact across the candidate (Major > Minor > Patch > None), relative to the preceding released version. Preserve each Issue's own impact and rationale; the shared candidate version reflects the combined scope. Recompute it when membership or scope changes. Do not require one version bump or one release per Issue, and do not create duplicate tracking just to fill a gate.

### Release / Version gate

Copy this section into each implementation/verification handoff and replace all choices with actual states and evidence. Pending means awaiting a decision/action; Deferred means deliberately scheduled for a later step, with a reason and the responsible owner/Issue/reference. Not applicable requires a reason. Out of scope is valid for publication. Release impact and SemVer impact cannot remain Pending at Verify; candidate selection/grouping can remain Pending (TBD) with follow-up tracked on the current Issue or an existing candidate reference.

```markdown
## Release / Version gate

- Release impact: Yes / No — reason based on the implemented scope.
- SemVer impact: None / Patch / Minor / Major — rationale.
- Candidate release: vX.Y.Z (or alpha.N/beta.N prerelease) / Pending (TBD) / Not applicable — reason or follow-up reference.
- Grouping / included release candidate: Standalone / existing candidate Issue or draft link / Pending (TBD) — membership or follow-up reference.
- CHANGELOG status: Updated under Unreleased — entry reference / Not applicable — reason.
- Version-bump status: Pending / Deferred — owner, reason and follow-up reference / Synchronized — version and all inventoried fields verified / Not applicable — reason.
- Publication status: Pending / Deferred — owner, reason and follow-up reference / Out of scope / Published — matching annotated tag, GitHub Release URL and intended Latest/prerelease state verified / Not applicable — reason.
- Owner verification / acceptance status: Pending review / Accepted — explicit owner evidence / Not applicable — reason.
```

For Release impact: Yes, CHANGELOG must already be Updated under Unreleased at implementation handoff; it cannot be deferred with the version bump. A later release-preparation handoff records the finalized release section instead. For Release impact: No / SemVer: None, use Candidate release and Version-bump status: Not applicable, with an explanation. Documentation/process-only governance such as #48 needs no product CHANGELOG entry: the Issue and reviewed documentation record the change. Product-facing documentation that changes the released contract must be assessed on that impact instead.

### Continuous changelog and coordinated version preparation

Update [CHANGELOG.md](../CHANGELOG.md) under Unreleased during release-relevant implementation, with Issue references and user/operational impact. Keep unreleased content there until candidate finalization. Move only the finalized candidate's entries to its release section; leave unrelated entries under Unreleased. A preparation date must be labelled as preparation, not claimed as publication. Preserve historical release evidence.

Version changes are a later, deliberate release-preparation action after candidate scope/version is finalized. The current authoritative application-version inventory is **seven fields across five tracked files**, reconfirmed and synchronized to prepared `1.3.1` for #49, #51 and #47 on 2026-09-18. This is preparation metadata, not evidence of publication:

| File | Synchronized fields |
| --- | --- |
| [package.json](../package.json) | `version` |
| [client/package.json](../client/package.json) | `version` |
| [client/package-lock.json](../client/package-lock.json) | top-level `version`, `packages[""].version` |
| [server/package.json](../server/package.json) | `version` |
| [server/package-lock.json](../server/package-lock.json) | top-level `version`, `packages[""].version` |

There is no tracked root lockfile or separate application version constant. Lockfile dependency versions, Node engine ranges, migration numbers, API versions and historical documentation are not product-version fields. Recheck the tracked inventory during release preparation and extend this table if a new authoritative field is introduced.

Synchronize all seven fields to the chosen version in one reviewed preparation change (without the tag's leading `v`), including both lockfile root entries. Inspect the JSON values and dependency diff afterward; a version-only step must preserve dependency versions, trees and unrelated metadata. Do not update only one manifest, regenerate dependencies unnecessarily, create a root lockfile, or invoke an automatic commit/tag as part of the bump. Align current README/release notes and the intended tag with that version; historical version references remain historical. This documentation is the inventory, not an assertion that an executable synchronization check exists.

### Implementation through publication

1. Implement the Issue, decide impact and update Unreleased when relevant.
2. Run applicable automated verification, report results/limitations and the complete gate, and move the existing Project item to Verify. Record owner acceptance separately; automated checks do not establish it.
3. Obtain and record explicit owner verification / acceptance where applicable. Confirm completion requirements before Done; a deferred candidate bump/publication remains visible in the Issue or shared candidate record even after Issue completion.
4. Finalize the candidate's membership, highest SemVer impact, version and release notes. Resolve Pending candidate/grouping fields; no unresolved member scope belongs in a finalized candidate.
5. Synchronize the full version inventory and verify the preparation diff. Update gate states with evidence; preparation does not establish a commit, deployment or publication.
6. The owner commits and pushes the reviewed changes; verify the intended remote commit SHA independently. Implementation commits may precede a later grouped release-preparation commit. Record any required deployment and owner production acceptance separately, only within authorized scope.
7. For authorized publication, create an **annotated** `vX.Y.Z` (or prerelease) tag targeting the verified intended commit, and verify both the annotation and peeled commit. Preserve existing tags.
8. Publish the GitHub Release from that matching tag and reviewed release notes. Neither a tag nor a draft Release proves publication.
9. Read back the published Release URL, tag/commit, draft/prerelease flags and intended Latest status. Stable publication should identify the intended Latest release; an alpha/beta prerelease must be marked as a prerelease and must not be claimed as the stable Latest release.

Tagging/publication and production execution require explicit scope/authorization. Issue completion must not imply any of these actions occurred. If publication is part of an Issue's completion scope, complete and verify it before Done; otherwise an explicit Deferred or Out of scope publication state is valid.
