# Promise of Planet — IMG-F3-08A Bounded GCS Orphan Receipt Discovery

MODE: STRICT TWO-FILE ADDITION — NO PRODUCTION WIRING / NO DELETE

Repository: `rexat007/promise-of-planet`
Pinned pushed baseline: `0799658cd5589ff47bbc93dbedde0918398761d5`

Objective: develop a **read-only bounded discovery proof** for GCS objects belonging to an interrupted editorial image intake whose generation metadata was not persisted in the Firestore session. This is the first safe prerequisite to actual news image upload. It is **not** recovery integration or an upload endpoint.

## 1. Preflight — STOP before writing if mismatch

Read CURRENT LOCAL Studio source, no Git commands and no automatic GitHub retrieval. Compute Git blob SHA-1 locally and compare:

- `functions/src/news/editorialBinaryIntakeService.ts`: `61c13c7878112a6a0cd075df094478449c97d5b2`
- `functions/src/news/gcsEditorialBinaryStorageAdapter.ts`: `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e`
- `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts`: `027efedf05779e1758b55793c2f2302b511cb4fb`
- `functions/src/news/editorialImageVariantProcessor.ts`: `f8518ed7bb6f249d5a60dff79e9e22aa727865a6`
- `functions/src/shared/editorialImageAssetContract.ts`: `39d89e007f21b94b59c504b0f577d84ab372859d`
- `functions/src/types/editorialImageAsset.ts`: `af587a23fc7699eae77074ac67a5f49107384171`
- `functions/package.json`: `420e933933f4f582a4ded415727152021faf5400`
- `functions/package-lock.json`: `99415d41bad872f581731b1cdca04340c390a103`
- `package.json`: `34cb668d837d342c9b5367461cca2ad9dd8a18e7`
- `package-lock.json`: `bbeb2e14de4250608e825d1640818feedc4dc297`
- `bun.lock`: `987bd0d55d3d377725c03516c3f139f56a6265b9`
- `app/applet/.oxlintignore`: `6c0d0f5ea142a0cdfc37fdc59451358ea4873e91`
- `app/applet/.oxlintrc.json`: `58fc9f117568bca7a93b4ad87bc3e37dfdfeff7e`

Verify target files do not exist locally. STOP if any local prerequisite diverges, unexpected deletion exists, or the solution needs changes beyond the allowlist.

## 2. EXCLUSIVE WRITE ALLOWLIST — CREATE ONLY

1. `functions/src/news/editorialUntrackedImageObjectDiscovery.ts`
2. `functions/src/news/editorialUntrackedImageObjectDiscovery.test.ts`

**Zero changes** to any existing file, IMG-F3-05/06/07 implementations, index.ts, interfaces, Firestore/Storage rules, package manifests/lockfiles, root docs, GitHub Actions, or UI. No dependency installation.

## 3. Read-only discovery contract

Implement an injectable, typed helper that accepts an `EditorialBinaryIntakeSession` with `targetKind='editorial_image_asset'` and storage metadata reader using the current `EditorialBinaryStorageAdapter.readMetadata`. Validate session binding and identity using existing canonical validators; do not mutate input or session.

Generate a **finite known set** of canonical GCS paths, never a bucket listing:

- Quarantine: `buildQuarantineImageStoragePath(intakeId, ext)` for `png`, `jpg`, `webp` (3 possible paths).
- Private images: all five accepted keys `thumbnail`, `card`, `article_inline`, `article_cover`, `original_processed` via `buildEditorialImageVariantStoragePath(assetId,key,mime)` for `image/png`, `image/jpeg`, `image/webp` (15 possible paths).
- Upper bound exactly **18 path metadata lookups** per attempt. De-duplicate; do not read image bytes; no getFiles(), pagination, loops over arbitrary buckets or user-supplied paths.

On discovered object, verify ALL ownership fields against session: `createdByIntakeId`, `targetKind`, `namespace`, `assetId`, `uploaderUid`. Validate generation/etag/SHA-256/byte count/content-type via existing adapter contracts and independently check canonical path/namespace consistency. Compare to all three session lists: `createdQuarantineObjects`, `createdPrivateObjects`, `pendingCleanupObjects`.

Return an **internal frozen/read-only report** distinguishing (a) matching already-tracked objects, (b) matching untracked owned objects with generation, and (c) ownership/path/generation conflicts. Never classify a foreign-owned object as owned; never return a public URL. Fail closed on malformed ownership/metadata or read failure; do not silently report empty success. No mutation or deletion occurs under any circumstance.

**Crucial:** This helper MUST NOT decide whether objects can be cleaned. Preservation vs deletion requires separate canonical asset read-back, CAS/lease/fencing, generation checked deletion and owner-authorized design. Do not claim the GCS crash gap closed.

## 4. Tests

Write realistic isolated tests for:

- GCS quarantine `writeIfAbsent` succeeded but session missed receipt -> bounded reader discovers exactly the owned untracked object and generation.
- One private image variant write succeeded, receipt missed -> discovered without treating another variant as the same object.
- Previously tracked object is not returned as untracked.
- Foreign-owned object at deterministic path is flagged fail-closed, never claimed.
- Metadata corruption or read failure propagates failure, not empty success.
- Exactly 18 or fewer metadata lookups, no bucket-wide listing, zero delete/write calls.
- Session of rights-evidence kind or invalid identity refused.
- Conflicting generation for already-tracked path does not yield a deletion recommendation.

Use in-memory fakes; do not simulate successful real Firebase writes. All existing 7 test suites (reported baseline 147) must still pass. Run new tests plus isolated strict TypeScript; report known full-build failures separately if they persist. Do not alter old files to make builds green.

## 5. Hard NOs / STOP

No Firebase connection, no onCall, no GCS write/delete, no Firestore update, no session status transition, no published URL, no UI, no mock photo exposed. Do not modify approved intake/reconciliation implementation. Never execute git, push, Firebase CLI, `rm -rf`, package installation, or sweep unrelated files.

If safe discovery cannot be expressed under these two new files and accepted contracts, report `STOP_REQUIRES_DESIGN_DECISION` with exact incompatible API/contract — no speculative workaround.

## 6. Output

Report preflight SHA checks; exact 2 new paths + Git blob SHA and byte sizes; evidence of 18-lookup bound; test counts/exit codes; fail-closed behavior; protected file comparison; and blocker states:

- `GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`
- `UPLOAD_NOT_WIRED`
- `PUBLIC_IMAGE_RIGHTS_GATE_NOT_WIRED`
- `NO_FIREBASE_PRODUCTION_VERIFICATION`

Final status: `IMG-F3-08A_DISCOVERY_IMPLEMENTED_PENDING_SOURCE_REVIEW` or `STOP_REQUIRES_DESIGN_DECISION`.

**STOP for owner review. No Push/Deploy, no acceptance claim.**
