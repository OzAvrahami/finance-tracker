# Finance Tracker v1.3.1 — release notes

**Prepared / unpublished — 2026-09-18.** The owner accepted #49, #51 and #47
and finalized this single Patch candidate, coordinated by #49. These notes do
not establish a commit, push, deployment, tag or published GitHub Release.

## Fixed

- **#49 — Category selection:** Long category lists in Add Transaction scroll
  internally, fit the available viewport and keep the active keyboard option
  visible. Hebrew RTL and both themes are preserved.
- **#51 — Return after editing:** Save, Cancel and Back restore the originating
  Transactions date range, filters, visible search and sorting, while loading
  fresh results. Existing Savings account filters preserve their exact bigint IDs.
- **#47 — Budget deficit allocation:** Category deficits use the compact,
  contextual allocation interface with progressive funding-source selection and
  clear full/partial coverage previews. The existing deficit accounting operation
  remains separate from upper unbudgeted allocation; spending is unchanged.

## Scope and evidence

No dependency updates, backend implementation changes or database migrations.
The final v1.3.0 schema through migration 035 supports these fixes. Temporary
preview-harness repairs are not product-release changes.

Existing focused frontend/controller checks, real final-schema PostgreSQL checks,
and synthetic browser checks are detailed in the [review record](PATCH_1_3_1_REVIEW.md).
Owner acceptance is explicit; it does not imply additional device, browser,
authenticated-backend or production testing. Those documented evidence limitations
remain. Version metadata is synchronized to **1.3.1**; publication is deferred to
the owner's separate release step. [GitHub Releases](https://github.com/OzAvrahami/finance-tracker/releases)
remains authoritative for publication status.
