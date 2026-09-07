# Finance Tracker v1.2.0 manual QA handoff

Prepared locally on 2026-09-07. The application bundle is still uncommitted, unpushed, unpublished, and undeployed. #2 is accepted by the user in manual QA; no repeat acceptance is requested. Only #10/#27 visual acceptance remains. Migration 029 is installed in production according to the user evidence below. Issues #27, #10, and #2 remain open in Verify, with their existing P3 priorities and assignments preserved, under [milestone v1.2.0](https://github.com/OzAvrahami/finance-tracker/milestone/1). #28 remains a closed duplicate of #27; completed Budget work is unchanged.

## Implemented scope

- **#27:** Dashboard GlassCards inherited `.ui-glass::after`, a fixed 200px violet corner bloom whose edge ended inside the cards. The first monthly-card-only correction left it on Tasks, Income/Expenses, and other shared Dashboard panels. The correction now suppresses this decoration throughout `.dashboard-page`, preserving the sheen, semantic/chart colors, card geometry, page background, and shared glass outside Dashboard.
- **#10:** the existing complete Loans data supplies the nearest-ending eligible active loan, including today in Asia/Jerusalem. Invalid/missing dates, past dates, paid loans, closed dates, and nonpositive balances are excluded under the existing loan rules. Equal dates use ascending ID. The original four-card grid and responsive behavior are restored. A compact full-width information row below the grid and above active loans uses the label “ההלוואה הקרובה לסיום”, a small calendar icon, the complete name, and `DD/MM/YYYY`. Its contents wrap naturally, it recalculates with loan data, and the entire row is absent when no loan qualifies. No loan accounting or automation changes.
- **#2:** optional `store`, HTTP(S) `link`, and calendar `target_date` belong to shopping-list headers. The shared create/edit dialog uses Hebrew labels and a date picker, hydrates saved values, and permits clearing. Details show only present values and safe links. Existing create requests remain valid. Partial API updates preserve omitted values; null/empty/whitespace clears a provided value. Invalid non-empty types, URLs, and calendar dates receive Hebrew 400 responses. List type/catalog mapping, items, checkout, and financial posting behavior remain unchanged.

## Verification actually performed

After the presentation corrections: **65/65 tests passed across four Dashboard/Loans files**, client lint passed, and the production build passed with its existing large-chunk advisory. No backend/database suites were rerun. The complete bundle results below were recorded before these presentation corrections:

| Gate | Result |
|---|---|
| Dashboard focused suite | 25 passed |
| Loans focused checks | 18 new summary/date tests + 2 display tests + 20 Loans tests passed |
| Shopping focused UI suite | 18 passed |
| Shopping API contracts | 18 passed |
| Full client suite | 480 passed, 28 files |
| Full server suite | 325 passed |
| Targeted real PostgreSQL | 3 passed, zero skips; own disposable PostgreSQL 16 container removed |
| Client lint | Passed |
| Client production build | Passed; existing large-chunk advisory only |
| Version consistency / dependency preservation / diff check | Passed |

The full application gates ran before the deliberate package-version and dated-changelog preparation. Those final edits change only release metadata/documentation; dependency versions and lockfile dependency trees are unchanged. No browser is connected, so no agent screenshot verification is claimed. #2 manual acceptance is user-supplied; #10/#27 need visual acceptance after the corrections. No production data was accessed by the agent. The unrelated `docs/github-development-standard.md` modification is preserved and excluded from this bundle.

## Migration 029

Migration: `server/migrations/029_shopping_list_optional_fields.sql`. It transactionally adds nullable `TEXT store`, `TEXT link`, and `DATE target_date`, without defaults or backfill. It does not alter Budget objects or existing migrations.

**Production installation completed by the user; do not reapply or modify Migration 029.** The user ran Supabase SQL Editor and supplied `MIGRATION_029_PREFLIGHT_PASS` and `MIGRATION_029_POSTFLIGHT_PASS`, with `list_count: 4`, `item_count: 27`, `checkout_count: 0`, matching `header_fingerprint: 1ba300c74d46b3d9208ed0bd2744a50a`, and postflight `nullable_columns_without_defaults = true`. These are recorded user results, not checks newly run by the agent.

The completed database order is retained below as historical installation guidance, not a request to rerun it:

1. Before any compatible server deployment, pause shopping-list writes briefly and run `docs/MIGRATION_029_PREFLIGHT.sql` in Supabase SQL Editor. Save its one JSON result; require `MIGRATION_029_PREFLIGHT_PASS`.
2. Apply the complete Migration 029 file once. Do not reapply Migrations 027/028. If preflight says STOP because the columns already exist, inspect the recorded installation and postflight rather than replaying the migration.
3. Before allowing writes, run `docs/MIGRATION_029_POSTFLIGHT.sql`. Require `MIGRATION_029_POSTFLIGHT_PASS` and equality of `list_count`, `item_count`, `checkout_count`, and `header_fingerprint` against preflight. The fingerprint excludes only the three new columns. The postflight does not infer a saved baseline or prove UI behavior.
4. Remaining: deploy the compatible server, then client, after the user performs the application Git operations. The installed additive schema is compatible with the older deployed application. Preserve the already completed #2 acceptance; the remaining visual checks are #10 and #27.

Previously completed local verification commands, retained for reference (backend/database suites were not rerun for these presentation corrections):

```powershell
Set-Location D:\code\finance-tracker
node --test server/test/shoppingListPostgres.local.test.js
node --test server/test/shoppingListFields.test.js
```

The PostgreSQL test extracts the relevant canonical Shopping DDL, exercises the legacy-to-029 upgrade and fresh-schema equivalence, and removes only its own uniquely named container. It does not execute the funded-budget suite.

## Local startup

Configure `server/.env` and `client/.env.local` for an isolated development Supabase project and its authenticated test user, using the repository `.env.example` files as the variable reference. Apply Migration 029 to that development database first. The disposable SQL-only test container does not provide Supabase Auth/PostgREST for interactive app QA. Do not point interactive QA writes at production.

Run in two PowerShell terminals:

```powershell
# Terminal 1 — server, with isolated development configuration
Set-Location D:\code\finance-tracker
$env:PORT = '5050'
npm.cmd --prefix server run dev
```

```powershell
# Terminal 2 — client, with matching development Supabase auth configuration
Set-Location D:\code\finance-tracker
$env:VITE_API_URL = 'http://localhost:5050/api'
npm.cmd --prefix client run dev -- --host localhost --port 5173 --strictPort
```

Open `http://localhost:5173`. Existing dependencies are installed; no dependency update is required.

## בדיקה ידנית קצרה

- #27 — בדסקטופ ובמובייל, ב־RTL ובשתי ערכות הנושא: ודאו שאין פסים סגולים חדים בכל כרטיסי הדשבורד, במיוחד מטלות והכנסות/הוצאות; בדקו שהצבעים, הגרף, הקישורים ובורר החודש נשמרו.
- #10 — בדקו שארבעת כרטיסי הסיכום שמרו על רוחבם, ושהשורה הקומפקטית מתחתיהם ומעל ההלוואות הפעילות מציגה שם מלא ותאריך ברור, גם במובייל ובשם ארוך, ללא גלילה אופקית. בהיעדר מועמד מתאים השורה נעלמת.

#2 אושר על ידי המשתמש בבדיקה ידנית; אין צורך לחזור על הבדיקה.

## User-owned Git operations after acceptance

Review the staged diff before committing. This explicit allowlist excludes the existing standards-document edit. No staging, commit, push, or tag was executed by the agent.

```powershell
Set-Location D:\code\finance-tracker
git add -- package.json client/package.json client/package-lock.json server/package.json server/package-lock.json CHANGELOG.md README.md docs/PROJECT_STATUS.md docs/RELEASE_1_2_0.md docs/MIGRATION_029_PREFLIGHT.sql docs/MIGRATION_029_POSTFLIGHT.sql client/src/pages/Dashboard/Dashboard.css client/src/components/LoanDashboard.jsx client/src/components/LoanDashboard.test.jsx client/src/pages/Loans/Loans.css client/src/pages/Loans/Loans.test.jsx client/src/utils/loanDisplay.js client/src/utils/calendarDate.js client/src/pages/Shopping/Shopping.css client/src/pages/Shopping/Shopping.test.jsx client/src/pages/Shopping/ShoppingLists.jsx client/src/pages/Shopping/ShoppingListDetail.jsx client/src/pages/Shopping/ShoppingListDialog.jsx client/src/pages/Shopping/shoppingListFields.js server/controllers/shoppingController.js server/utils/shoppingListFields.js server/full_schema.sql server/migrations/029_shopping_list_optional_fields.sql server/test/shoppingListFields.test.js server/test/shoppingListPostgres.local.test.js
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "Prepare v1.2.0 Dashboard, Loans, and Shopping bundle"
git push origin main
```

After acceptance, the user owns commits/pushes and the v1.2.0 annotated tag. Migration 029 is already installed. After application deployment verification and acceptance of the remaining visual corrections, complete the issues and Project items, close the milestone, and publish the explicitly authorized stable release using the tagged changelog notes. Publication remains a separate pending step.
