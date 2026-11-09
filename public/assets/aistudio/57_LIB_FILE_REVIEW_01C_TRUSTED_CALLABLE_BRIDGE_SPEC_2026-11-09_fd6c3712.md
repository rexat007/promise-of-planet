# Promise of Planet — LIB-FILE-REVIEW-01C — Trusted Callable Bridge (internal, not deployed)

**Status:** `SPECIFIED / READY_FOR_STUDIO_EXECUTION / NOT_IMPLEMENTED`  
**Published GitHub baseline:** `7fc4f097a597644f9535a292d3a157a0d4faa11b`  
**Last closed:** `LIB-FILE-REVIEW-01B/R1 — PUSH_VERIFIED / SOURCE_CLOSED`.

## 1. One bounded objective
Build an **internal, testable Firebase Functions v2 callable bridge** for *linking an existing, verified `Quarantined` PDF/DOCX receipt to the existing durable `PENDING_HUMAN_REVIEW` draft*. The bridge must use request-scoped **Firebase callable server-verified `request.auth`**, assemble the canonical production Firestore/admin/GCS dependencies, invoke the existing `LibraryQuarantineReviewDraftPersistenceService` and return a minimal sanitized DTO. **Do not export the callable from `functions/src/index.ts`**, do not add a frontend caller or deploy. Live exposure is a later, separately approved unit.

The module may export a named callable `libraryQuarantineReviewDraftLinkCallable` *locally*, but without an `index.ts` export it must remain **not deployed/registered**. The testable `execute...` function is a trusted **SDK boundary**, not an independent cryptographic token verifier: tests with mock `request.auth` do not prove Firebase Auth live verification.

## 2. Pinned source authority: verified current GitHub `main`
Repository: `rexat007/promise-of-planet`. Each HTTPS URL below is an explicit pinned-commit raw **file URL**. GitHub connector verified the paths and Git blob SHA-1; Studio must verify HTTP 200, non-HTML body, exact blob digest before relying on any download. If Studio cannot fetch, work from locally present content **only after** its Git blob SHA-1 matches; otherwise STOP. Don't assume Git commands or `.git` are available.

| Read-only path | Expected Git blob SHA-1 | Direct HTTPS raw URL |
|---|---|---|
| `functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts` | `5709952519564cb118443fd6dd59ec9cff249bb1` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts |
| `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` | `f481a24bda7dcbf7a63a12644e5b2d91b8626318` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts |
| `functions/src/library/libraryQuarantineUploadEndpoint.ts` | `c400d40606d9d124c377ab3e0c536278d3fb61bc` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/library/libraryQuarantineUploadEndpoint.ts |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/library/firestoreLibraryQuarantineReceiptStore.ts |
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` | `4bca554dd00a5e2efc739cc166175cc63327c5ad` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/library/gcsLibraryQuarantineStorageAdapter.ts |
| `functions/src/admin/firestoreAdminRepository.ts` | `cd118b4ea9da4d66bba8185055dbc7e31537a354` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/admin/firestoreAdminRepository.ts |
| `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/functions/src/index.ts |
| `scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts` | `360a63883f1e3eb18f0ede62ee72e31e7f3a3263` | https://raw.githubusercontent.com/rexat007/promise-of-planet/7fc4f097a597644f9535a292d3a157a0d4faa11b/scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts |

GitHub check at this pinned baseline: both proposed code output paths below are ABSENT (404), and all existing reference blobs above match.

## 3. Exact code write allowlist
1. **ADD** `functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts` — small production dependency factory + request-scoped handler + unregistered v2 callable declaration.
2. **ADD** `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts` — isolated mock authorization/factory/DTO/boundary tests.

Documentation: the attached specification may be stored under `public/assets/aistudio/` as a named project specification per existing policy; no other code writes. `functions/src/index.ts` is **read-only**, not a target. No edits to 01A/01B, upload gateway, receipt store, GCS, admin repo, Firestore rules, deployment config, lockfiles or packages.

## 4. Engineering contract
- **SDK-trusted context only:** Accept callable request context at the **server adapter** boundary; only the Firebase Functions v2 `onCall` handler supplies `request.auth` to the executor. Do not read `uid`, `auth`, roles, tokens or permissions from `request.data`, query parameters, or headers. If `request.auth` is absent/invalid: `unauthenticated`, zero admin/receipt/GCS reads and zero writes. Validate the entire `request.data` as an exact plain object with only `receiptId` (32 lowercase hexadecimal); no symbols or extra keys.
- **Request scoped:** Create `TrustedQuarantineReviewerPrincipalProvider` *inside each request* using that invocation's SDK-authenticated `request.auth` (UID and token only). Never use a global mutable `currentUser` or a cached principal/provider. The existing service remains the authority for `admins/{uid}` and required human Library Review permissions. Reject AI/automated principals fail-closed.
- **Production dependencies:** Bind `getFirestore()` to existing `FirestoreAdminRepository`, `FirestoreLibraryQuarantineReceiptStore`, `FirestoreLibraryQuarantineReviewDraftStore`. Bind `getStorage().bucket('promiseofplanet-bb325-library-quarantine')` **explicitly** to `GcsLibraryQuarantineStorageAdapter`. Verify bucket handle/name; never use default Storage bucket or create a bucket or perform a GCS write. Follow the existing upload gateway's exact dedicated-bucket identifier, without modifying it. Do not cache authenticated state across requests. Runtime dependency factory can use injected test fakes.
- **One operation:** Delegate one time to `linkQuarantineReceiptToReviewDraft({receiptId})`. Do **not** implement another transaction, repeat GCS verification, grant publication, call PEIA, or modify receipts. Preserve error semantics `NOT_CREATED` and `UNKNOWN` / `draftCreated:null`; no automatic retries. No route allowing arbitrary draft lookup or download.
- **Minimal response:** On success, return only `{ok,status,receiptId,sourceRevision,reviewState:'PENDING_HUMAN_REVIEW',disposition,draftCreationOutcome,draftCreated,isSanitized:false,isVerifiedSafe:false,isRightsApproved:false,isPublished:false,isReadyForPeia:false}` (and no unreviewed fields). On failure, return/throw a fixed safe code and fixed safe message plus `draftCreationOutcome` + `draftCreated` if the chosen result protocol can represent them without leaks. No raw draft, candidate, hash, `generation`, attestation, `storagePath`, GCS bucket, URL, token, Firebase decoded token or SDK error messages. Decide one testable consistent response/error protocol and cover it with tests.
- **CORS & bounded execution:** No wildcard public CORS. Use known accepted production origins from existing upload gateway if a callable is declared. No background task or scheduled polling. Keep resource limits modest and documented. If the Firebase Functions SDK typing or runtime wiring would require modifying existing files, STOP with evidence rather than changing them.
- **Release gate:** Do not add `export { ... }` to `functions/src/index.ts`. Presence of a callable declaration in the new module is **not** live deployment. The subsequent unit must explicitly approve exporting/testing/deploying it via authorized GitHub Actions, along with production IAM/cors review. Absolutely no Firebase CLI deployment in Studio.

## 5. Required verification
- Request absent/malformed auth, AI/automated, inactive/Viewer/wrong Library permission → fail closed before receipt read/GCS and no draft write. Test no spoofed `data.auth`, `data.uid`, `data.role`, extra/symbol properties.
- Two sequential and interleaved requests for different principals: their request-scoped providers never exchange UIDs.
- Mock successful link result maps to only the strict minimal response key set; check `JSON.stringify` lacks `storagePath`, `generation`, `attestation`, `sourceSha256`, raw draft, signed URLs, tokens, private bucket and untrusted exception sentinel.
- Simulate `UNKNOWN` commit with `draftCreated:null` and safe HOLD, plus `NOT_CREATED` with false; never falsely report absence on uncertainty.
- Verify explicit quarantine bucket name and rejection of fallback/default bucket; assert zero GCS save/delete, zero receipt mutation, no extra transactions/retries introduced by bridge.
- Regression: `npx --no-install tsx scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts` (7/7), `npx --no-install tsx scripts/runLibraryQuarantineReviewDraftContractTests.ts` (7/7), `npx --no-install tsx scripts/runLibraryQuarantineAdminReadTests.ts` (7/7), isolated `tsc`, `npm run build`, `npm run lint`; report exact exit codes/warnings.
- GitHub Sync prior to owner Push: code **2 Added, 0 Modified, 0 Deleted**; any retained named spec shown separately. All protected reference file SHA unchanged. No Deploy.

## 6. STOP conditions & status
STOP without writing if baseline cannot be established, local Studio reference source mismatches and pinned raw HTTPS fetch/body verification fails, the proposed paths already exist unexpectedly, auth provenance cannot be distinguished from client-controlled data, the bucket binding is uncertain, or changes beyond allowlist would be necessary.

Successful Studio outcome: `LIB_FILE_REVIEW_01C_IMPLEMENTED_PENDING_SOURCE_AND_SYNC_REVIEW` — **not** production/live acceptance.
