# Promise of Planet — IMG-F3-08B: Recovery Read-back & Decision Gate (Engineering Specification)

**Status:** PROPOSED — NOT IMPLEMENTED / NOT ACCEPTED / NO DEPLOYMENT  
**Date:** 2026-10-22  
**Repository:** `rexat007/promise-of-planet`  
**Pinned GitHub baseline:** `d53c2119d919d5e1b95536e15f2c177f45832653`  
**Continuity basis:** `Promise_of_Planet_Continuity_2026-10-22_IMG-F3-08A_ACCEPTED.zip`, particularly `02_CURRENT_STATE_HANDOFF.md`, `33_IMG-F3-08A_FINAL_ACCEPTANCE_CLOSEOUT.md`, `37_IMG-F3-08B_SAFE_RECOVERY_DESIGN_GATE.md`.

## 1. Launch-related objective and decisions

Close the **decision-information gap**, not the deletion/repair gap: combine durable intake-session read-back, authoritative canonical image-asset repository read-back, and the accepted bounded GCS metadata discovery to produce a strictly read-only recovery assessment. This step avoids writing speculative cleanup/recovery behavior into accepted production services. It is a **bounded first part of IMG-F3-08B**, not full acceptance of IMG-F3-08B and not proof that image uploads work.

Owner acceptance of IMG-F3-08A is final and not reopened. IMG-F3-05, IMG-F3-06, IMG-F3-07 remain accepted without changes. This step does not require Google AI Studio to fetch any GitHub content: Studio MUST operate on its current local files and verify preflight fingerprints, then STOP on any mismatch.

## 2. Verified source observations

| Source / Git blob SHA-1 | Review finding |
|---|---|
| `functions/src/news/editorialBinaryIntakeService.ts` / `61c13c7878112a6a0cd075df094478449c97d5b2` | `EditorialBinaryIntakeSession` and `IntakeSessionStore` contracts; `reconcileIntake` returns immediately for terminal `Completed` / clean `Failed`, without discovery; `cleanupTrackedObjects` does not retain generation/ownership mismatch objects as pending. Write-to-GCS then update-session is not atomic. |
| `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` / `027efedf05779e1758b55793c2f2302b511cb4fb` | `getSessionById` returns a validated persisted session; `updateSession` uses transaction and revision CAS but does not serialize GCS I/O. |
| `functions/src/news/editorialImageAssetRepository.ts` / `e83b6bd42c00558b0d8c2147f8d17e64a7e1a965` | `EditorialImageAssetRepository.getById` returns explicit `FOUND` or `NOT_FOUND`; exceptions are not equivalent to NOT_FOUND. The asset record does not prove the originating `intakeId` just from shared uid/checksum. |
| `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` / `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` | Live `readMetadata` validates ownership; deletes carry conditional generation precondition, but read-then-delete alone is not a cross-Firestore/GCS transaction. |
| `functions/src/news/editorialUntrackedImageObjectDiscovery.ts` / `69db080f657b7d142483ca5e37035fcfad0fd6e2` | Owner-accepted read-only helper checks ≤18 deterministic image paths, validates metadata, identifies owned-untracked objects and conflicts; does not mutate or decide deletion. |

**Proven concurrency issue:** A session revision check alone cannot prevent an independent ingest worker from creating a GCS object or registering the canonical asset after read-back. Any read-only assessment is observational/non-authoritative; a later mutation requires a new coordination/CAS/claim design.

**Special terminal case:** A `Failed` session with no recorded cleanup items may still have a GCS orphan after the receipt-loss crash; the new read-back must **not skip terminal sessions**. `Completed` might also coexist with untracked objects; report rather than silently claim clean.

## 3. Restricted implementation scope

**Create exactly two files:**

1. `functions/src/news/editorialImageReceiptRecoveryReadback.ts`
2. `functions/src/news/editorialImageReceiptRecoveryReadback.test.ts`

All existing source, tests, config, package manifests, lockfiles, Firestore indexes/rules, GCS adapters, accepted IMG implementations, web UI and GitHub Actions are READ ONLY. No dependencies, Firebase CLI, Git commands or repo cleanup.

### Read-only orchestration contract

Use existing type interfaces (`IntakeSessionStore`, `EditorialImageAssetRepository`, `EditorialBinaryStorageAdapter` `readMetadata`) and invoke **the accepted** `discoverUntrackedEditorialImageObjects` exactly once.

Input: validated `intakeId` and three injected read dependencies. No client-supplied storage paths or arbitrary GCS bucket listings.

Process:

1. `getSessionById(intakeId)`; reject missing/invalid or rights-evidence target; fail closed on corrupted session or repository error.
2. `assetRepository.getById(session.assetId)`; distinguish FOUND / NOT_FOUND / thrown error. Treat exceptions and ambiguous response as UNKNOWN/HOLD, **never** as authoritative absence. A FOUND record with conflicting assetId, uploader or binary SHA must be labeled CONFLICT/PRESERVE, not treated as matching by shared fields alone. A FOUND record is **not proof of intakeId association**.
3. Call `discoverUntrackedEditorialImageObjects(session, storageReader)` **once**, preserving its ≤18 metadata lookups, conflict validation and rejection of foreign ownership.
4. Re-read session via `getSessionById` and canonical repository via `getById`, or fail closed on any error. If session revision, immutable identity, status or tracked receipt arrays changed, or canonical state/revision changed, emit `STALE_OBSERVATION_HOLD`, never actionable recovery. This is detection of observed races, **not** a lease or concurrency lock.
5. Return a frozen, internal, read-only assessment. Distinguish at minimum: `NO_OWNED_UNTRACKED_OBJECTS`, `CONFLICT_HOLD`, `CANONICAL_FOUND_PRESERVE_HOLD`, `CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE`, `TERMINAL_SESSION_WITH_UNTRACKED_OBJECTS_HOLD`, and `UNKNOWN_OR_STALE_HOLD`. Precedence: validation/read errors fail closed; stale or conflict first; a terminal session with lost receipts never reported as completed; any canonical FOUND means **no deletion** and avoid claiming intake ownership; NOT_FOUND+nonterminal+valid owned untracked is only a **candidate for a separate authorized CAS reattachment**, never a permission to cleanup.
6. Return metadata counts, session revision, canonical observation status, and reason codes only. No object bytes, private payloads, user-provided URLs or personally identifying content in logs. Do not expose as callable.

**Absolute prohibited outputs/actions:** `shouldDelete=true`, `safeToDelete`, deletion plan, update instruction ready for execution, automatic `reconcileIntake`, Firestore/GCS writes, public URLs, rights decisions, background jobs. Include `requiresFreshAtomicVerification=true` for any future candidate. Do not claim entire receipt crash window is closed.

## 4. Minimum deterministic tests

- Missing/invalid intake; wrong `rights_evidence_binary` target; corrupt session; repository error vs legitimate NOT_FOUND.
- Lost quarantine and lost private receipt with canonical NOT_FOUND in active session => candidate only; `readMetadata` ≤18 total; no writes/deletes.
- Canonical FOUND matching uid/hash => PRESERVE, not verified belonging to this exact intake; conflicting hash/uploader => hold; canonical read exceptions => hold/throw, not NOT_FOUND.
- `Failed`/`Completed` with untracked metadata => terminal hold, no false clean.
- Foreign ownership and conflicting duplicate receipts => conflict hold.
- Session revision/receipt/status changed between first and second `getSessionById` => stale hold. Canonical changes between first and second read => stale hold.
- No untracked metadata => no-action only when no conflicts; repeat invocation deterministic and idempotent read-only.
- Data returned immutable and no storage bytes/public URL.
- Eight owner-accepted suites previously **166 tests according to Studio report** must all still run; add focused tests for this unit. Isolated strict TypeScript verification; full-build diagnostics separately classified as pre-existing or new.

## 5. Verification / STOP gates

- Before write, verify exact local Git blob SHA-1 values for the 5 source files in §2; ensure both target paths absent, no unexpected deletion/delta in GitHub Sync. Verify root/Functions package files and both Oxlint files unchanged.
- If source shape, interfaces or assumptions differ from pinned baseline, STOP without writing (never use a GitHub path-only retrieval instruction).
- If an implementation needs a new session field, lease, composite index, edits to existing accepted code, or external storage writes, STOP and document the required design decision instead.
- After Studio reports tests, owner reviews GitHub Sync (expected two ADDED code files, optional archived spec only when explicitly approved), then manually pushes, assistant checks pushed blob SHAs/source; owner explicitly accepts the bounded unit. No Firebase deployment.

## 6. Open blockers and next authorized design gate

`GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`, `UPLOAD_NOT_WIRED`, `PUBLIC_IMAGE_RIGHTS_GATE_NOT_WIRED`, `FULL_BUILDS_NON_GREEN_REPORTED`, `NO_FIREBASE_PRODUCTION_VERIFICATION`.

After this read-back, design a **single-owner recovery claim / lease or equivalent transactionally safe coordination** that covers live ingest, the session receipt reattachment and canonical registration read-back. A cleanup mutator MUST NOT be authorized until it can prove safe behavior with concurrent workers and termination between every write. Also remedy the existing `cleanupTrackedObjects` case where ownership/generation mismatches are not retained in pending cleanup (do not silently treat as cleaned). This will require a separate bounded allowlist and owner review. Then prioritize actual editor upload wiring and end-to-end image preview/rights gating; do not interpret this planning unit as platform launch readiness.
