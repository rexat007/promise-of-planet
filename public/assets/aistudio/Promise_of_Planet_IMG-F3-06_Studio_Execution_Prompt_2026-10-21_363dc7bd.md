# Promise of Planet — IMG-F3-06
## Persistent Firestore Intake Sessions & Cloud Storage Adapter

MODE: STRICT BOUNDED LOCAL IMPLEMENTATION — NO PRODUCTION WIRING.
Repository: `rexat007/promise-of-planet`. Pinned GitHub baseline: `11b2f7159075cbe57b0adcf5b125c78ae7ef87dc`.

**Work exclusively in the current LOCAL Google AI Studio workspace. Do not use Git/GitHub or assume you can download repository files by their names. Do not fetch/restore anything from GitHub.**

### A. Immutable preflight (Git blob SHA-1, `sha1("blob " + byteLength + "\0" + fileBytes)`)
- `functions/src/news/editorialBinaryIntakeService.ts`: `61c13c7878112a6a0cd075df094478449c97d5b2`
- `functions/src/news/editorialBinaryInspector.ts`: `8c1dbb8431de693af710c219c06538e2212107de`
- `src/services/editorialBinaryIntakeService.test.ts`: `abb2e1795467c300b54396a7ba00082dae59ecef`
- `functions/src/news/editorialImageAssetRepository.ts`: `e83b6bd42c00558b0d8c2147f8d17e64a7e1a965`
- `functions/src/news/firestoreEditorialImageAssetRepository.ts`: `97e74f6d6eebfc8f38ae3c3e82fd172085cb1990`
- `functions/src/news/editorialImageRightsReviewService.ts`: `beed9487636feaf918bed2dfc14c9013c17753f7`

Confirm none of the three proposed files exists. STOP if any baseline differs or if either local work or preceding unpushed edits conflict. Never silently overwrite.

### B. Exact write allowlist — CREATE only
1. `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts`
2. `functions/src/news/gcsEditorialBinaryStorageAdapter.ts`
3. `src/services/editorialPersistentBinaryAdapters.test.ts`

All existing files READ-ONLY, including `functions/src/news/editorialBinaryIntakeService.ts`, `functions/src/index.ts`, `storage.rules`, `firestore.rules`, `package.json`, `package-lock.json`, `bun.lock`, `functions/tsconfig.json`, and `public/assets/aistudio/**`.

### C. Implementation
Read the existing local exported interfaces `IntakeSessionStore`, `EditorialBinaryStorageAdapter`, `EditorialBinaryIntakeSession`, `StorageObjectMetadata`, `StorageWriteIfAbsentRequest`, `ConditionalStorageDeleteRequest`, and constructor `EditorialBinaryIntakeServiceOptions` in `editorialBinaryIntakeService.ts`. Implement EXACTLY these contracts; do not invent names.

1. Implement `FirestoreEditorialBinaryIntakeSessionStore` using an injected structural Firestore database interface with transactions; collection `editorial_binary_intake_sessions`. `createSessionIfAbsent` must be race-safe. `updateSession(session, expectedRevision)` must transactionally verify persistent revision and increment precisely once, preserve immutable identity and ownership, reject malformed records/status and conflicting mutations. Defensive copies. `listSessionsForReconciliation({nowIso,limit})` must be bounded, include NeedsReconciliation/CleanupPending/Registering/Registered and other expired unfinished sessions, deduplicate and order deterministically. Never perform an unbounded full-collection scan; if an index/query prerequisite is missing, report it explicitly and STOP instead of pretending it is available.

2. Implement `GcsEditorialBinaryStorageAdapter` using **injected structural Bucket/File interfaces compatible with Firebase Admin Storage/Google Cloud Storage**, with no SDK initialization and no unapproved package dependency. Exact Buffer SHA-256, contentType, byteLength and ownership validation. Use GCS generation precondition `ifGenerationMatch:0` on `writeIfAbsent`. Store server-owned metadata `createdByIntakeId`, `targetKind`, `namespace`, `assetId`, `evidenceId` when relevant, uploaderUid, and SHA; no public tokens/URLs. Read with strict metadata/generation verification. Delete only after verifying ownership AND applying actual server-side `ifGenerationMatch` to the delete request. Preserve generation strings. Treat 412 as conflict, 404 as missing, transient/unknown errors as failure requiring reconciliation. Reject storage paths outside the canonical private/quarantine namespaces and cross-asset/evidence mismatches. No Firebase request is allowed during tests.

3. Add isolated Vitest tests with injected fake transactional Firestore and GCS objects. Cover create conflict/CAS retry, session persistence across newly constructed adapters using shared backing fake DB, bounded expired-list, malformed document fail-closed, GCS conditional create/delete, owner/generation mismatch, lost responses, SHA mismatch, private vs quarantine separation, and current EditorialBinaryIntakeService injected into these adapters when possible. Specifically test the crash window **between a successful Storage write and persisting its generation receipt**; if it cannot be recovered under the accepted existing service contract, DOCUMENT THE OPEN GAP, do not hide it or assert full post-crash guarantees.

### D. Verification
Run relevant local Vitest suites (new test, `src/services/editorialBinaryIntakeService.test.ts`, `src/services/editorialImageRightsReviewService.test.ts`, `src/services/editorialImageAssetRepository.test.ts`, `src/services/editorialImageAssetContract.test.ts`, `functions/src/shared/editorialImageAssetContract.test.ts`), and isolated strict TypeScript checks for the 3 new files. Report exact commands and exit codes. Full Functions compilation TS5107 baseline blocker is separate; don't modify compiler settings to conceal it.

Verify that the only created/modified files are the 3 listed; no deletions. Report final SHA-1 and sizes. Identify any remaining security/durability gaps and whether actual Firebase interfaces remain unverified (likely). **No npm/bun installs, no lockfile change, no `rm -rf`, no build cleanup, no Firebase invocation, no API handler, no public image delivery, no Push/Deploy.**

### E. Mandatory documentation handoff — before owner acceptance
Return a precise structured report with: source hashes; exact diff; tests; limits; proposed updates to every living document `00`–`18` of Promise of Planet Continuity Pack (list `changed` or `reviewed-no-change` with rationale); new evidence/provenance and closing gate. Do not modify those docs in Studio since outside allowlist. The reviewer will regenerate and verify the versioned MD + SHA manifest + ZIP pack **at unit closure**, after owner's explicit acceptance. **Without documentation closeout, the unit cannot be recorded as closed.**

STOP if requirements are truncated by context compaction, current local sources differ, or SDK compatibility cannot be established within the allowed scope. Final status: IMG-F3-06 IMPLEMENTATION PENDING OWNER REVIEW; production wiring and Firebase deploy NOT AUTHORIZED.
