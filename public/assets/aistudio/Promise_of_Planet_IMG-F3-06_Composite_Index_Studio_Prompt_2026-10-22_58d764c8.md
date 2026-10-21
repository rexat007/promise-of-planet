# Promise of Planet — IMG-F3-06 | Composite Index & Reconciliation Liveness Correction

MODE: STRICT FOUR-FILE BOUNDED IMPLEMENTATION. NO CLOUD OPERATIONS.
Repository: `rexat007/promise-of-planet`
Pushed GitHub reference: `769f7f1888b8b0ed74ab34d8bb0d3a438962f4a5`.
**Unpushed local Studio workspace remains the sole authority for its changes.** Do not run Git or fetch/restore files from GitHub. This prompt embeds all required baseline identifiers.

## A. Preflight: STOP BEFORE ANY WRITE if a prerequisite differs

Compute actual local Git blob SHA-1 using Node `crypto`: hash the UTF-8 bytes as `blob ${byteLength}\0` + bytes (never call `git`). Verify:

- `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts`: `6806070551641d99001f194482316f5f8bc3f4ad` **local unpushed correction**.
- `src/services/editorialPersistentBinaryAdapters.test.ts`: `0218ed6973e292235e34e492925a89d0baf3ab19` **local unpushed tests**.
- `firebase.json`: `8e63d6539278a8754a4149fab007b795c2a4201f` **pushed baseline**.
- `functions/src/news/gcsEditorialBinaryStorageAdapter.ts`: `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` **protected**.
- `functions/src/news/editorialBinaryIntakeService.ts`: `61c13c7878112a6a0cd075df094478449c97d5b2` **protected**.

`firestore.indexes.json` must be ABSENT locally; it was absent from the pinned GitHub tree. Verify Oxlint files exist unchanged. If a check fails or current paths differ: **STOP, report, no fixes or overwrites**.

## B. EXCLUSIVE WRITE ALLOWLIST — exactly 4 paths

1. MODIFY `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts`
2. MODIFY `src/services/editorialPersistentBinaryAdapters.test.ts`
3. CREATE `firestore.indexes.json`
4. MODIFY `firebase.json` ONLY to add Firestore indexes path alongside existing rules, preserving every existing configuration field.

All other paths are read-only. No extra docs or generated files in Studio.

## C. Exact bounded correction

Use the existing ten-status schema and IntakeSessionStore interface, do not change accepted IMG-F3-05.

- Direct actionable statuses (`NeedsReconciliation`, `CleanupPending`, `Registering`, `Registered`) must be queried **by status** with deterministic bounded ordering, without expiration requirement.
- Expiry-gated statuses (`Created`, `Quarantined`, `PreliminarilyVerified`, `Promoting`) must be queried server-side by **both status and `expiresAt <= nowIso`**, with `orderBy('expiresAt','asc')` and `.limit(effectiveLimit)`; NEVER load a mixed-status/future-expiry window and filter it after `.limit()`.
- Bound results to existing MAX_RECONCILIATION_LIMIT=100, perform existing stable merge/sort by expiresAt then intakeId, preserve immutable fields and revision CAS.
- Fail closed on invalid nowIso, missing index, malformed session records returned by a query, transport failures, or uncertain query semantics; do not silently return a clean empty batch.
- Inspect `Failed` sessions with nonempty `pendingCleanupObjects`: accepted `reconcileIntake` can process them, although normal transitions typically use `CleanupPending`. If the current status-only/index design could permanently miss an actionable Failed session, **STOP WITH DESIGN BLOCKER** rather than declaring complete. Do NOT quietly remove this requirement or add an unapproved persistent field.
- Preserve open GCS write-before-Firestore-receipt orphan gap. No production-ready claim.

## D. Index and Firebase config

Create exactly this root-level `firestore.indexes.json` definition (unless a demonstrable source requirement contradicts it; then STOP):

```json
{
  "indexes": [
    {
      "collectionGroup": "editorial_binary_intake_sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

`firebase.json` existing `"firestore": { "rules": "firestore.rules" }` becomes `"firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" }`; do not change other objects, keys or values.

No Firestore index is live just because these files exist. Index activation and readiness verification are **future manual deployment gates**.

## E. Regression and realistic fake queries

Update only the allowlisted test file. Fake query chain must implement `.where`, `.orderBy`, `.limit` with actual AND-filtering, sorting and server-limit behavior; fail on unsupported operations rather than silently accepting them. Add tests for:

1. 105 older `Completed` sessions plus expired `Created`.
2. 105 earlier nonexpired `Created` plus a later expired `Created` (critical remaining starvation case), with limit 50 and 100.
3. 120 eligible sessions, repeated bounded calls after updating processed sessions to terminal status: 50→50→20→0.
4. Direct actionable independent of expiry; nonexpired in-flight excluded.
5. Clean terminal `Completed` / `Failed` excluded; actionable `Failed` + pending cleanup either handled with proof or report STOP.
6. Corrupt returned records cause sanitized `STORAGE_FAILURE`, not silent skip.
7. Assert query predicates/order/limits, check `firebase.json` index path and exact index JSON structure without cloud network calls.
8. All original six regression suites (130 tests before this correction), plus new cases, and isolated strict TypeScript.

If test architecture/other paths require modification: STOP and report precise smallest required expansion.

## F. Prohibitions and result

NO edits to IMG-F3-05, GCS adapter, `firestore.rules`, `storage.rules`, `index.ts`, package files, `bun.lock`, `.oxlintignore`, `.oxlintrc.json`, `public/assets/aistudio`, or other specs. NO Git, installs, `rm -rf`, cleanup, network/cloud Firestore, Firebase CLI, Push, or Deploy. No automatic rights/content approvals.

Return: (a) preflight SHA matrix; (b) exact 4-path diff; (c) corrected server-side query shapes & index use; (d) Failed/pending reconciliation treatment; (e) tests run and exact exit codes; (f) final local Git blob SHA-1 + byte size per changed file; (g) preservation of protected files; (h) identified open orphan gap; (i) documentation impact suggestions for living continuity docs, **without editing them in Studio**.

Status **CORRECTION_IMPLEMENTED_PENDING_SOURCE_REVIEW**, or **STOP_REQUIRES_DESIGN_DECISION** if any blocker. Do not declare unit accepted or published. STOP FOR OWNER REVIEW.
