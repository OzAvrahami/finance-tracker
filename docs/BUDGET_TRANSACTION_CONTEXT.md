# Budget transaction review context (#50)

Implemented on `feat/budget-context-50` from
`ede60ae0eff5161e642199ef35e697bfd2319353`. Extends #51's existing
[navigation contract](../client/src/utils/transactionsNavigation.js); no additional
editor-return mechanism, accounting change or persistent filter preference.

## Eight decisions

| Decision | Implemented contract |
| --- | --- |
| 1. Context transport | Explicit URL fields `origin=budget`, `budgetMonth=YYYY-MM`, `budgetSection=unbudgeted`, `budgetCategory=<positive safe integer or uncategorized>`. All four must be present exactly once. Ordinary month/category filters never imply origin. |
| 2. Month restoration | Origin month is independent of editable list dates. Filter changes/reset serialize the same validated origin. The return link always targets `/budget?month=<origin>&section=unbudgeted&category=<origin category>`. |
| 3. Budget URL month | URL is the sole selected-month source. A valid single `month` survives refresh/direct entry/history. Missing/invalid/duplicate month uses the existing current Asia/Jerusalem calendar month. Switching months pushes a URL and removes the old target; a keyed month view resets month-local dialogs/previews on UI and browser navigation. This is the only expansion of Budget state ownership. |
| 4. Category restoration | Retain the originating category ID or explicit `uncategorized` independently of list filters. IDs are restoration hints, not proof a category still exists. Unknown/deleted/resolved rows fall back to the section or page. No name matching or arbitrary selectors. |
| 5. Section restoration | Only `unbudgeted` is supported. Stable IDs identify the section and rows. After fresh Budget loading finishes, focus/scroll once per navigation to row, then section, then page. A resolved section returns safely to the same month's Budget. Scroll margin allows room for the application header. |
| 6. Editor propagation | Existing desktop/mobile edit links embed the extended Transactions URL in #51's `returnTo`. Its parser retains valid origin while still allowing only `/transactions` and known keys. Save, Cancel and Back use the same existing hook destination. Returned lists reload a fresh first batch; no cursor/cache replay. A shared notice also offers direct Budget return from the ordinary editor. |
| 7. Invalid/stale context | Calendar validation rejects impossible months; duplicate/incomplete origin, invalid category, unsupported section or wrong origin removes the entire Budget context, preserving otherwise-valid list/Savings criteria. Invalid ordinary return criteria still use #51's normal fallback. Arbitrary paths, hashes and unknown editor-return keys remain rejected. Browser Back/Forward restores URL state. Normal same-route entry removes origin immediately; there is no retained component/global origin state. |
| 8. UI reuse | One small `BudgetOriginNotice` uses the existing React Router Link, Hebrew month formatter and theme tokens. Hebrew RTL, wrapping layout, semantic named navigation and visible keyboard focus; no separate screen or generic navigation framework. |

Examples:

```text
/transactions?month=2026-08&categoryId=7&origin=budget&budgetMonth=2026-08&budgetSection=unbudgeted&budgetCategory=7
/transactions?month=2026-08&uncategorized=1&origin=budget&budgetMonth=2026-08&budgetSection=unbudgeted&budgetCategory=uncategorized
/budget?month=2026-08&section=unbudgeted&category=7
```

A valid explicit URL restores context even in a new tab. It describes a navigation
workflow, not a claim that a click can be authenticated. Bare `/transactions` remains
the ordinary current-month list. Saving may move a row outside restored filters;
that is a legitimate fresh-data result, not a reason to relax the filters.

## Verification (2026-09-28)

- Focused Budget, Transactions, AddTransaction, #51 and new navigation tests:
  **186/186 passed** across six files before four final edge/keyboard cases were added.
- Final `BudgetNavigation.test.jsx` and `transactionsNavigation.test.js`:
  **48/48 passed**, including those four additions. Uses real MemoryRouter routes
  and actual page/editor/hook components, with mocked API data/mutations and a
  September 2026 clock; no production transaction is changed.
- Covers Save/Cancel/Back for categorized and uncategorized August origins, changed
  list dates/search/payment/Savings criteria, fresh results, direct/refresh editor
  URLs, browser Back/Forward, same-route normal entry, invalid/duplicate context,
  missing rows/sections and keyboard activation/focus.
- Full client suite: **606 passed / 4 failed** before the four final additions.
  All four failures reproduce in the Import suite extracted from the exact starting
  commit: **9 passed / 4 failed**. These tests query portaled category options/create
  actions within the table. No Import code or assertion was changed.
- Client build passed (existing large-chunk advisory); targeted ESLint passed.
- Git whitespace, UTF-8, local Markdown file links and unchanged seven product
  version fields are checked at handoff.

Browser tool inventory exposes no browsers/tabs. No normal local frontend/backend
was listening on the standard 5173/5050 ports when checked. No synthetic preview or
environment setup was created. DOM/router checks do **not** establish desktop/mobile
geometry, theme contrast, real scrolling or device behavior; these remain owner review.

## Owner review

With the normal local application configured for safe local/test data, start its
existing workflow in separate terminals from the repository root:

```powershell
npm run dev --prefix server
npm run dev --prefix client
```

Open `http://localhost:5173/budget?month=2026-08` (confirm the displayed Vite port).
For Save tests, use isolated test data, not a backend connected to production data.

1. Review an unbudgeted category, then an uncategorized row. Confirm the Hebrew
   August origin notice and intended filters.
2. Change list dates/filters, then edit. Try Save, Cancel and Back separately. The
   returned list keeps its current criteria; Back to Budget still targets August.
3. Refresh, use browser Back/Forward, and enter Transactions through normal navigation.
   Confirm ordinary entry has no Budget notice.
4. Return after the originating row/section is absent. Confirm August is retained,
   with focus falling back safely. Check keyboard, narrow/desktop widths and both themes.

## Release / Version gate

- Release impact: **Yes** — user-visible contextual navigation.
- SemVer impact: **Minor**, retaining the initial assessment: additive workflow capability.
- Candidate release: **Pending / TBD**, follow up on #50 during release preparation.
- Grouping / included candidate: **Pending / TBD on #50**; no APY/FlowLink assignment.
- CHANGELOG: **Updated under Unreleased**, focused #50 entry.
- Version bump: **Deferred** to owner-coordinated release preparation; seven fields unchanged.
- Publication: **Out of scope / not performed**.
- Owner verification / acceptance: **Pending review**, including browser appearance/behavior.
- Commit/push/deployment/production operations: **Not performed**.
