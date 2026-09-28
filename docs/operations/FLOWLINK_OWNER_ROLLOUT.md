# FlowLink owner rollout — capture first, review before posting

> Contract/technical reference. Dated implementation and verification notes are historical checkpoints; use the [documentation index](../README.md) for current release/acceptance boundaries and GitHub for live workflow state.

Prepared for [FLI-05 #90](https://github.com/OzAvrahami/finance-tracker/issues/90). **Instructions for later owner execution, not evidence that production was changed.** This run does not start [FLI-06 #91](https://github.com/OzAvrahami/finance-tracker/issues/91). The owner operates Git, production SQL, deployment and configuration manually after reviewing/committing/pushing the implementation.

The target ready state is deployed enrollment/bindings with **both `FLOWLINK_INGESTION_ENABLED=false` and `APPLE_PAY_INGESTION_ENABLED=false`**. Keep them false before and during the first natural purchase. No last-minute enablement is needed. The native app stores the event, receives `503 / flowlink_ingestion_disabled`, and holds it for explicit review. Enabling the server later does not release that hold. Only a confirmed manual retry sends the original receipt.


**Owner update, 2026-09-28:** main/production `f7b1e7003d1f9d272dda5cc34c0282089f62bf4a` has migrations 037/038 deployed and verified, owner authority configured and both ingestion flags false. The migration instructions below are retained for installations that have not reached that state; **do not rerun them for the QR onboarding correction**. This correction needs only a later owner-operated web/app update. No production state was inspected or changed during its implementation.

## 1. Reviewed commit, recovery point and maintenance

1. Owner reviews #90, commits with `feat(flowlink): add Wallet App Intent ingestion`, and merges to main manually. Record the resulting full SHA; do not substitute the pre-implementation SHA. Pause automatic Railway deployment **before pushing** migration-dependent code, so pushing cannot race the database steps. If pushing already occurred, inspect the current deployment before proceeding. This runbook is not permission to deploy from a dirty worktree.
2. Verify `git branch --show-current` is `main`, `git status --porcelain` is empty, and `git rev-parse HEAD`, `git rev-parse origin/main`, and `git ls-remote origin refs/heads/main` agree after the owner's push/fetch. Save `git show --no-patch --format=fuller HEAD` and `shasum -a 256 server/migrations/037_flowlink_device_enrollment.sql server/migrations/038_flowlink_card_bindings.sql` in private rollout evidence.
3. Reconfirm published stable release using `gh release view --json tagName,isDraft,isPrerelease` (expected v1.3.1), seven product fields 1.3.1 per [version inventory](../github-development-standard.md#continuous-changelog-and-coordinated-version-preparation), FlowLink 0.1.0/build 1. Proposed grouped v1.4.0 is not published; #84 finalizes it. Stop for an unexplained release/commit mismatch.
4. Confirm a recoverable Supabase backup/PITR point, its UTC time, retention and restore procedure. Rehearse on a disposable copy where available. A row fingerprint is **not a backup**. Record the existing Railway deployment SHA and recovery image; keep the additive database objects when reverting application code.
5. Arrange a bounded quiet window: owner web/mobile writes, spreadsheet/external/CAL importers, integrations, Loan job (`.github/workflows/process-due-loans.yml`), Savings/manual/internal jobs and other writers must be quiescent. Record how/when each is restored. Both ingestion flags must already be false/absent; stop if either is true. Do not inspect other secrets to do this. Fingerprints are meaningful only across a quiet window; each snapshot is internally repeatable-read, but separate snapshots do not freeze intervening writers.
6. Owner configures an existing secure libpq service called `finance_owner` using the verified production host/database and an authorized migration role (with complete table visibility), TLS `verify-full`, and a protected password file/prompt. Never put a password or full secret URL in a command line, shell history, Issue or repository. All following `psql service=finance_owner` commands are **owner-only production operations**. Confirm the connection's project/host in the Supabase dashboard before using it; no URL is inferred from repository files.

The checked-in preflight/postflight SQL is [operations/flowlink_snapshot.sql](sql/flowlink_snapshot.sql). It is READ ONLY, sets row_security=off (insufficient privilege fails rather than hiding rows), and emits JSONL catalog/security definitions and full-row SHA-256 aggregates for **every public application table/materialized view**. It covers Transactions/items, Budget, Savings, Loans, LEGO, Shopping, settings, APY sources/observations/events and other public domains. No financial row bodies or credential values are printed. Keep fingerprints private outside Git. Definitions include columns/defaults, constraints, indexes, triggers, views, functions, owners, pinned settings, RLS/policies and direct/effective grants. Extension-owned objects are excluded; they are not modified by 037/038.

## 2. Reference catalog and read-only 036 preflight

Read the actual major using `psql 'service=finance_owner' -X -qAt -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version_num')::int / 10000"`. From the reviewed clean commit, generate expected stage catalogs on **portless disposable PostgreSQL** with that same major (16 shown):

```sh
python3 docs/operations/flowlink_rehearse.py --postgres-major 16 --output /private/tmp/flowlink-reference-reviewed
```

This executes only Docker-local schema/fixture tests and produces `036.jsonl`, `037.jsonl`, `038.jsonl`. The output directory must not already exist. It verifies consolidated/full-schema parity and detects changed grants/RLS/RPCs/data. Preserve its output with the reviewed SHA. The script accepts majors 16 and 17; this implementation pass rehearsed 16 only. If production uses 17, run and verify the 17 rehearsal before proceeding; other versions require a reviewed compatibility adjustment. Never bypass the environment comparison. No production database is contacted by this script.

Prepare protected evidence storage on the owner's Mac:

```sh
umask 077
mkdir -p "$HOME/flowlink-rollout-evidence"
psql 'service=finance_owner' -X -qAt -v ON_ERROR_STOP=1 \
  -f docs/operations/sql/flowlink_snapshot.sql > "$HOME/flowlink-rollout-evidence/before-036.jsonl"
python3 docs/operations/flowlink_compare.py \
  /private/tmp/flowlink-reference-reviewed/036.jsonl \
  "$HOME/flowlink-rollout-evidence/before-036.jsonl"
```

Require every command to exit zero. The comparator is offline; it never applies SQL. This is the saved financial/APY baseline. The preflight requires **exact reviewed 036 catalog/security**, no 037/038 objects, no FlowLink sources/observations. Existing production data may differ from synthetic reference data; it is compared against its own baseline after migration. If catalog owners/grants, legacy objects, PostgreSQL major, table visibility or any definition differ, **stop and inspect**. Do not automatically reapply 036, drop objects, relax checks or assume repository migration files prove production state. If 037/038 are already wholly or partially present, investigate and establish the actual boundary separately.

## 3. Apply 037, verify; apply 038, verify

Only after backup, quiet-window and preflight approval, the owner executes each complete, unmodified migration. They contain their own BEGIN/COMMIT; do not split them into selected statements or add `--single-transaction`. Use a session lock timeout so waiting fails safely:

```sh
PGOPTIONS='-c lock_timeout=10s -c statement_timeout=120s' \
  psql 'service=finance_owner' -X -v ON_ERROR_STOP=1 \
  -f server/migrations/037_flowlink_device_enrollment.sql
psql 'service=finance_owner' -X -qAt -v ON_ERROR_STOP=1 \
  -f docs/operations/sql/flowlink_snapshot.sql > "$HOME/flowlink-rollout-evidence/after-037.jsonl"
python3 docs/operations/flowlink_compare.py \
  /private/tmp/flowlink-reference-reviewed/037.jsonl \
  "$HOME/flowlink-rollout-evidence/after-037.jsonl" \
  "$HOME/flowlink-rollout-evidence/before-036.jsonl"
```

037 adds devices, credentials, pairing capabilities, guards and seven private service RPC entry points. Require exactly those additions, empty new relations, unchanged existing objects, unchanged financial/APY/domain hashes/totals and no FlowLink source. Only then:

```sh
PGOPTIONS='-c lock_timeout=10s -c statement_timeout=120s' \
  psql 'service=finance_owner' -X -v ON_ERROR_STOP=1 \
  -f server/migrations/038_flowlink_card_bindings.sql
psql 'service=finance_owner' -X -qAt -v ON_ERROR_STOP=1 \
  -f docs/operations/sql/flowlink_snapshot.sql > "$HOME/flowlink-rollout-evidence/after-038.jsonl"
python3 docs/operations/flowlink_compare.py \
  /private/tmp/flowlink-reference-reviewed/038.jsonl \
  "$HOME/flowlink-rollout-evidence/after-038.jsonl" \
  "$HOME/flowlink-rollout-evidence/before-036.jsonl"
```

038 adds bindings/command receipts, lifecycle/immutability guards and six service RPC entry points including the atomic ingest wrapper. The combined postflight requires exact 037+038 definitions/security, RLS with no browser policies/access, private helpers, only service-role RPC execution, immutable/append-only guards, and **all original rows/totals/schema unchanged**. Five new FlowLink tables must be empty. Zero FlowLink sources/observations/events plus identical Transactions hashes prove zero FlowLink cash at this point. Existing 036 financial primitives and invariants are preserved, not replaced.

On SQL error, timeout, interrupted connection or comparison failure, **stop**. Inspect catalogs and transaction outcome before any retry; do not assume partial application or rerun blindly. Retain evidence, diagnose, and approve a forward fix separately. Never roll back by dropping provenance/security/history tables after enrollment/capture. Restoring a database backup after new writes requires a separate reconciliation/recovery decision.

If PostgREST has not discovered the new RPCs, the owner may run:

```sql
NOTIFY pgrst, 'reload schema';
```

This is a separately executed cache notification after successful commit, following [Supabase guidance](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema). It is not a migration rerun.

## 4. Deploy exact main, configure owner and keep both flags false

1. After database postflight, push the exact reviewed main if not already pushed, preserving the deployment hold until ready. In Railway, select the Finance Tracker production backend and deploy the verified latest commit. Recheck remote main immediately before deploying; stop if concurrent work moved it. Save deployment ID, commit SHA and Active state. A redeploy of an older deployment uses that older source; use the correct commit. [Railway deployment actions](https://docs.railway.com/deployments/deployment-actions).
2. Verify the deployed commit in Railway deployment metadata, and the non-secret `RAILWAY_GIT_COMMIT_SHA` for a GitHub-origin deployment if available. It must equal reviewed main. `/health` returns only `OK` and **cannot prove SHA**. Record every subsequent variable-triggered deployment ID/SHA too. [Railway variable reference](https://docs.railway.com/variables/reference).
3. Retrieve the owner's exact UUID with the authenticated procedure below, then set `FLOWLINK_OWNER_USER_IDS` to its JSON array. No email guessing, service key or native owner secret.
4. Set `FLOWLINK_INGESTION_ENABLED` to literal `false`; preserve/set `APPLE_PAY_INGESTION_ENABLED` to literal `false`. Stage/apply these with the owner config, without exposing unrelated variables. Confirm every running replica uses false and the exact intended code. Do not enable either adapter to test pairing.
5. Check health and non-posting boundaries from the owner's Mac (no browser Origin, no credential):

```sh
curl --fail --silent --show-error https://finance-tracker-production-d34c.up.railway.app/health
curl --silent --show-error --include --request POST \
  --header 'Content-Type: application/json' --data '{}' \
  https://finance-tracker-production-d34c.up.railway.app/api/flowlink/v1/wallet-transactions
curl --silent --show-error --include --request POST \
  --header 'Content-Type: application/json' --data '{}' \
  https://finance-tracker-production-d34c.up.railway.app/api/ingestion/apple-pay
```

Expect `OK`, then **503 / `flowlink_ingestion_disabled`**, then **503 / `apple_ingestion_disabled`**. These deliberately lack valid credentials and accounting payloads, so they cannot create money even if a flag was mistakenly enabled. A generic 503, owner-config error, 401, redirect, rate-limit or different code is not proof of the intended disabled state: stop. Check unauthenticated owner/device GETs reject with 401, owner authenticated lists succeed, and a non-owner JWT cannot manage devices (use an already-authorized test identity only if available; do not create accounts merely for rollout).

## 5. Exact authenticated owner UUID and owner API helper

Use the existing production Finance Tracker web login. The app uses Supabase Auth sessions (`client/src/config/supabase.js`, `client/src/context/AuthContext.jsx`); verify identity against Supabase **get-user**, not a decoded JWT or email lookup. In that signed-in web tab's developer console, owner fills the known project URL and **public anon/publishable key** from the existing client/project configuration. Never use a service-role key. The key is public; the session token stays in memory and is never printed:

```js
const flSupabaseURL = 'https://<verified-project-ref>.supabase.co';
const flPublicKey = '<existing-public-anon-or-publishable-key>';
const flProject = new URL(flSupabaseURL).hostname.split('.')[0];
const flSession = JSON.parse(localStorage.getItem(`sb-${flProject}-auth-token`) || 'null');
if (!flSession?.access_token) throw new Error('Sign in to the correct Finance Tracker project first');
const flUserResponse = await fetch(`${flSupabaseURL}/auth/v1/user`, {
  headers: { apikey: flPublicKey, Authorization: `Bearer ${flSession.access_token}` },
  redirect: 'error', cache: 'no-store'
});
if (!flUserResponse.ok) throw new Error('Authenticated identity verification failed');
const flUser = await flUserResponse.json();
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(flUser.id)) throw new Error('Invalid owner UUID');
console.log(JSON.stringify([flUser.id])); // Only this UUID JSON goes to FLOWLINK_OWNER_USER_IDS.
```

Confirm that this is the owner's intended signed-in account in the Supabase Auth Users view by the **same UUID**. Optional independent read-only SQL (owner supplies the verified UUID, not email):

```sql
SELECT id, created_at FROM auth.users WHERE id = '<verified-owner-uuid>'::uuid;
```

Expected allowlist form: `["<verified-supabase-user-uuid>"]`. Do not send it to FlowLink. Stop if project/session/storage layout differs; use the repository's Supabase client `auth.getUser()` in a trusted local development session rather than guessing another stored token. Do not paste session data, network Authorization headers or pairing secrets into Issues. Clear the developer console/session variables when finished.

For owner routes in the same web tab (after allowlist deployment), this helper uses the verified session, rejects redirects and hides unexpected server detail:

```js
const flBase = 'https://finance-tracker-production-d34c.up.railway.app/api/flowlink/v1';
async function flOwner(path, body) {
  if (!path.startsWith('/owner/')) throw new Error('Owner routes only');
  const r = await fetch(flBase + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
    headers: { Authorization: `Bearer ${flSession.access_token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Owner API failed: ${r.status}`);
  return r.json();
}
```

Do not use this helper for financial submission. Refresh an expired login rather than bypassing authorization. Only the repository's production web origin is allowed by owner CORS.

## 6. Production-connected app, pairing and approved bindings

1. Preserve existing local receipts/evidence. For the intended production-connected installation, build the **Release** iPhone configuration with existing Personal Team signing. Release ignores the saved Debug endpoint and has no custom CA dependency:

```sh
xcodebuild -project ios/FlowLink/FlowLink.xcodeproj -scheme FlowLink \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/flowlink-owner-production-device build
xcrun devicectl device install app --device '<owner-device-UDID>' \
  /private/tmp/flowlink-owner-production-device/Build/Products/Release-iphoneos/FlowLink.app
```

Its fixed API base is `https://finance-tracker-production-d34c.up.railway.app/api/flowlink/v1`. No LAN, `.local`, `.invalid` URL or custom root is used. If the owner chooses Debug instead, explicitly set `FLOWLINK_API_BASE_URL` to that production URL and launch once; merely removing the Xcode environment variable leaves the persisted Debug selection in place. Verify the intended build/configuration before pairing. Do not uninstall to switch endpoints: uninstall may lose receipts. Origin changes isolate credentials/local identity.
2. Open the app and confirm it runs. Check the actual local provisioning profile expiry and signing validity for the expected later-week capture window; Personal Team installation is not indefinite distribution. Renew the same development app before expiry without uninstalling or deleting receipts. No purchase-time flag action is required, but an expired/non-running app, insufficient storage, unavailable protected data or a Wallet automation that iOS does not execute cannot capture an event. These are not proven away by configuration-time mapping.
3. In the normal signed-in Finance Tracker web app, open **Settings → FlowLink → חיבור iPhone חדש** (Connect new iPhone). Enter a friendly unique label, e.g. “Oz iPhone” or “Noya iPhone”, and choose **יצירת QR**. The QR is generated locally, expires after ten minutes and is not displayed as raw text. No developer console, owner UUID or bearer token is involved in enrollment. Section 5's administrative identity verification is a separate initial infrastructure procedure, not household onboarding.
4. On that iPhone, open FlowLink → **Scan QR** → allow camera → scan → **Connect**. If needed, use **Having trouble scanning?** and the web **לא מצליחים לסרוק?** fallback. After a lost response use **Retry pairing** with the saved draft; do not create another device blindly. Verify Connected, expected device label/revision and **ingestion disabled**. The web polls only devices; a unique newly enrolled matching label is selected automatically. Ambiguous concurrent same-name results require explicit selection. Closing an unused QR attempts cancellation; consumed pairing refreshes devices safely.
5. In Settings → FlowLink, confirm the selected device against the label shown on its phone. Enter the binding label and **explicitly select** the intended active payment source, then Create Binding. There is no inferred/default card. On uncertain response, use the panel's same-command retry. Never remap an old binding/queued receipt to a different card.
6. Refresh FlowLink's Cards (`GET /device/bindings`). Verify the correct safe label, active status/revision and available=true even while ingestion=false. Pairing/status/binding reads and owner management remain usable while disabled. Source/payment IDs stay in owner APIs, never in the phone UI.
7. Run the read-only snapshot again, while ordinary writers are still quiet, and compare with enrollment allowances:

```sh
psql 'service=finance_owner' -X -qAt -v ON_ERROR_STOP=1 \
  -f docs/operations/sql/flowlink_snapshot.sql > "$HOME/flowlink-rollout-evidence/ready-held.jsonl"
python3 docs/operations/flowlink_compare.py \
  /private/tmp/flowlink-reference-reviewed/038.jsonl \
  "$HOME/flowlink-rollout-evidence/ready-held.jsonl" \
  "$HOME/flowlink-rollout-evidence/before-036.jsonl" --enrolled
```

This allows device/binding metadata plus new FlowLink source/configuration receipts only. It still compares all financial/domain rows, existing non-FlowLink APY rows and full catalog/security; requires zero FlowLink observations/non-configuration events. Inspect safe owner binding snapshots to confirm singleton payment-source authorization and source identity. New `source_configuration` events are expected from binding creation; **no financial event/cash is allowed**. Stop on any unexplained change.
8. Set the existing Wallet selected-card automation's FlowLink binding explicitly. Keep the verified direct Amount/Merchant/Name mappings, one FlowLink action, no Card/Pass mapping or helper actions, Show When Run off. Do not make a test purchase now.
9. Recheck both disabled probes, app disabled status and held-receipt behavior evidence. Record exact main/deployment SHA, backup point, SQL hashes/stages, comparison results, owner UUID verification, device/binding IDs (safe owner evidence), app version/build/config/signing expiry, flags and automation configuration. No credential or capability in the record. Restore ordinary writers only after review; coordinate CAL exclusion below first.

## 7. Deferred #91 checkpoint — natural purchase, then evening review

This checklist is prepared here; **#91 is not started by preparing it**.

**Before the purchase:** leave Wallet automation active and both ingestion flags false. No special action immediately before paying. Arrange exclusion/coordination of the selected card's later **legacy CAL import** now, so it cannot create an uncontrolled duplicate before review. APY-04/#82 is not implemented; FlowLink-to-legacy-CAL reconciliation is not claimed. If the importer cannot reliably exclude this purchase/card, pause its relevant import under separate owner control until the path is reviewed. Do not disable Loan/Savings behavior indefinitely as a substitute.

**When a purchase occurs naturally:** if iOS executes the intent with supported runtime values and protected storage is available, FlowLink freezes the binding label/UUID, exact amount/currency, selected merchant, local Gregorian date and one UUIDv4; commits its immutable receipt before POST; receives the explicit disabled result; stores **Held for review**. No cash is created. Held rows have no automatic retry, including on launch/foreground or later backend enablement. No guarantee of the actual Wallet runtime values or locked scheduling is claimed before observation.

**Later that evening, in #91 and with explicit owner authorization:**

1. Open FlowLink → Capture receipts. Opening cannot send held rows. Compare merchant, amount/ILS, original date and binding label against the purchase. Record actual runtime evidence and whether the event ran locked/background. Only the selected Merchant/Name result is persisted; do not claim both original raw inputs were observed from one receipt. Invalid input may fail safely without a normalized receipt—investigate without inventing evidence or generating a replacement key.
2. Confirm the held status and zero matching FlowLink observation/Finance Tracker transaction while flags are false. Read-only SQL may filter `transaction_source_observations` by the binding's source and the **existing** idempotency key; never call an ingest RPC for inspection. Check the ordinary Transactions page too and review the CAL path. If an unexpected transaction already exists, stop; do not post again assuming legacy reconciliation.
3. Review other pending/transient receipts as well before enabling. Held rows never auto-send, but genuine timeout/429 retryWait rows retain their separately documented bounded automatic retry semantics. If delivery is unknown, resolve uncertainty using the original key; do not substitute a new key or assume no server write happened.
4. If the purchase evidence is correct and CAL duplicate risk is controlled, owner explicitly authorizes setting only `FLOWLINK_INGESTION_ENABLED=true`. Keep the transitional Apple flag false. Confirm deployed SHA/config and non-posting checks first: unauthenticated `{}` Wallet POST now rejects 401 (not disabled 503), device status reports enabled, and authenticated malformed body—if tested through an approved diagnostic—rejects validation before money. Do not extract a device secret merely to run a curl check.
5. Return to FlowLink and confirm **Retry same capture** for that held receipt. It sends the exact stored bytes/key/date/binding with the current Keychain credential. It does not ask the owner to rebuild JSON or a Shortcut. A still-disabled response returns it to held state; stale/revoked authority fails closed without remapping.
6. Verify the APY outcome and exactly one intended canonical live transaction (or explicit attachment to a reviewed existing candidate), correct payment source/binding, frozen transaction_date, APY source/observation/provenance, report and Budget effect. Ambiguous/conflict means stop/review; never force a second key. A non-candidate first purchase should create exactly one transaction, not an extra transaction alongside an existing match.
7. Prove same-request replay creates zero additional cash using the **same original receipt bytes/key** in a separately authorized controlled #91 verification. The shipping UI deliberately disables resend after delivered; it has no “new ID” or force-replay button. Do not add such a button just for this check. Existing disposable PostgreSQL tests already prove backend replay behavior; any production replay harness must reuse the protected credential boundary, not copy a token into Shortcuts or an Issue.
8. Verify disabled/revoked binding behavior where agreed; preserve queued identities. Record actual locked/background behavior and any after-first-unlock limitations. Before-first-unlock may prevent execution/storage; do not claim reboot guarantees without evidence. Do not delete receipts, uninstall or remap a card to bypass a failure.
9. Coordinate/exclude the later CAL/card statement import for this purchase until reviewed reconciliation exists. Do not start #82 here. Decide explicitly whether native ingestion stays enabled permanently or returns to false after verification; that is a separate owner decision. Document all evidence and #90 acceptance/#91 status separately.

## 8. Temporary mock cleanup and scope

The local HTTPS mock/CA is no longer a completion gate. Useful fixture checks remain as temporary evidence under `/private/tmp/fli90-mock-20260926/`; no evidence/assets were deleted automatically. To stop a still-running mock, owner runs `pgrep -fl 'fli90-mock-20260926/mock.py'`, confirms the exact process, then `kill <confirmed-PID>` (SIGTERM). Do not use a broad Python kill. No mock process or custom certificate is needed for Railway HTTPS.

If **FlowLink Local Test CA - 2026-09-26** was installed on the iPhone: Settings → General → VPN & Device Management → that exact profile → Remove Profile → confirm/passcode. Confirm it disappears from Settings → General → About → Certificate Trust Settings. If it was never installed, **no iPhone CA cleanup is needed**. This run does not assume either case. [Apple profile removal instructions](https://support.apple.com/guide/personal-safety/review-and-delete-configuration-profiles-ips327569a75/1.0/web/1.0).

No commit/push/deploy/production SQL/configuration/secret/financial action is performed by preparing this document. No production devices/bindings, notification/APNs or Apple distribution are created. See [FLI-05 implementation and release gate](../../ios/FlowLink/README.md#release--version-gate).
