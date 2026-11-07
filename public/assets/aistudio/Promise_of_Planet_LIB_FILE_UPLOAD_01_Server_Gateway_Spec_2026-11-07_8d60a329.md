# Promise of Planet — LIB-FILE-UPLOAD-01
## Private library quarantine upload gateway — bounded engineering specification

**Repository:** `rexat007/promise-of-planet`  
**Pinned source baseline:** `721c6964d4d3f4448c390f260b338542bfa1caf5`  
**Execution:** Google AI Studio implements locally; owner visually accepts, pushes manually; no Firebase deployment without separate authorization.

## 1. Verified infrastructure and evidence limits

Owner-provided Google Cloud Console screenshots on 2026-11-07 show the separately created bucket:

- `promiseofplanet-bb325-library-quarantine`
- `us-east1`, Standard storage
- Uniform bucket-level access enabled
- Public Access Prevention enabled at bucket level; public status Not public
- Soft delete 7 days; object versioning off; retention policy none

The screenshots also show **project-inherited** storage roles for project owners/editors and Firebase/Admin service agents. Public access is prevented, but least-privilege service-account configuration and the exact future deployed function's runtime principal have **not** been verified. This is a deployment gate, not grounds for modifying project IAM in this unit. The existing bucket `promiseofplanet-bb325.firebasestorage.app` MUST remain unchanged.

## 2. Target

Create a server-only, authenticated, bounded HTTPS request gateway that reserves a receipt, durably commits it to Firestore, and invokes the already accepted one-shot quarantine write coordinator against the *explicit new bucket*. No new storage algorithms. **Do not deploy**, and do not add browser UI in this unit. The next unit will wire the admin UI and its readback.

## 3. Strict write allowlist

- CREATE `functions/src/library/libraryQuarantineUploadEndpoint.ts`
- CREATE `scripts/runLibraryQuarantineUploadEndpointTests.ts`
- MODIFY `functions/src/index.ts` **one export only**, provided its hash matches

All other files read-only. No package, lock, rules, Firestore models, media, PEIA, translation, deployment workflow changes. No generated extra source files.

## 4. Reuse existing production contracts

- `reserveLibraryQuarantineReceipt()` from `libraryQuarantineReceiptContract.ts`
- `FirestoreLibraryQuarantineReceiptStore.createReceiptIfAbsent()` using real `getFirestore()` injected in production and fake in tests
- `LibraryQuarantineWriteCoordinator.executeReservedQuarantineWrite()`
- `GcsLibraryQuarantineStorageAdapter` with `getStorage().bucket('promiseofplanet-bb325-library-quarantine')` **explicitly**; never use the Firebase default bucket or request-supplied bucket names
- `getAuth().verifyIdToken(token, true)` and canonical `FirestoreAdminRepository` / `AdminAuthorizationService` for a human active authorized Library editor

The generator/validator of receipt ID and storage path must remain the sole source of authority. No copy-pasted implementation of admission, transaction CAS, readback, storage generation pinning, or reconciliation.

## 5. HTTP security and inputs

Use Firebase Functions v2 `onRequest` (not `onCall` for raw binary bytes) with an injection-testable core handler. Enforce:

- `POST` only; a single Authorization Bearer Firebase ID token; reject cookie-only and alternative credentials.
- Revocation-aware token verification, valid authenticated UID, canonical active AdminUser read from Firestore, Library domain responsibility and Create or Edit permission. Reject AI/automated accounts and missing/inactive users. No RBAC from client claims alone.
- Strict, fixed allowed CORS origins grounded in existing application configuration. Reject unexpected Origin rather than using `*` or reflecting arbitrary origins. Handle OPTIONS safely without privileged side effects.
- A single raw binary body (`request.rawBody`) not multipart/base64/JSON, 1..15,000,000 bytes, with declared Content-Length bounded if available and validated against actual buffer length. Reject ambiguous content encoding and unsupported content types.
- Metadata limited to original filename and claimed MIME; reject caller-controlled receiptId, UID, object path, hash, inspection verdict, generation, bucket, or lifecycle status.
- Run 01A/01B inspection via `reserveLibraryQuarantineReceipt`, persist exact `Reserved` receipt in Firestore before invoking the existing coordinator; fail closed if persistence is not confirmed.
- One write-coordinator invocation per request; no automated retries, deleting or public URLs.
- In failures after reservation, respond with sanitized receipt ID when safely known and explicit `NEEDS_RECONCILIATION` / `PERSISTENCE_UNCERTAIN` states as appropriate; do not claim `QUARANTINED` without durable successful final CAS.
- Rate/instance and payload boundaries should be explicit, not unlimited. Do not log raw bytes or bearer tokens.

## 6. Production runtime binding

Production factory MUST choose the explicit new bucket above, never infer it from `firebase-admin` default. If a test override is needed, expose it only through the testable factory dependency, and verify in tests the fixed production name. If actual @google-cloud/storage bucket.file(path,{generation}) support cannot be verified in Studio, report `SDK_RUNTIME_COMPATIBILITY_PENDING` and defer live activation. STOP only upon a proved incompatibility; never fabricate attestation or alter the accepted GCS adapter.

This unit does not grant IAM. Before live deploy, confirm the runtime service account identity and bucket-scoped access, and check inherited broad permissions. Do not modify existing IAM during implementation.

## 7. Result contract

Return only sanitized response containing status, receiptId, revision when confirmed, and permitted admin DTO; no `storagePath`, bucket name, GCS generation, token, signed URL, raw bytes, internal attestation, or unsafe error content.

`Quarantined` only means private object storage and is not equivalent to sanitized, safe, rights approved, published or PEIA-ready.

## 8. Verification and stop conditions

Run focused deterministic fake-based tests at minimum: missing auth, AI/inactive/wrong-domain roles, unauthorized origins, rejected payload, size limit, body/Content-Length conflict, no side effects on admission failure, persisted reservation ordering, reserved-CAS failure before GCS, verified success, ambiguous outcomes, explicit bucket targeting, no public or metadata leaks, and no retry/deploy. Use actual production handler/adapter contracts with injected SDK fakes.

Studio `compile_applet`/lint are supplemental. Final Functions build gate: manual GitHub Actions `AUTH-03A` on accepted pushed commit. Do not modify the repository or start a live upload from ChatGPT.

STOP if baseline mismatches, proven incompatible SDK capabilities, cross-domain authorization cannot be safely reused, unavoidable changes outside allowlist, or source must be guessed.

## 9. Acceptance checkpoint

`LIB_FILE_UPLOAD_01_IMPLEMENTED_PENDING_OWNER_REVIEW` only if scope and tests pass. Next: owner manual Push, AUTH-03A, then limited admin UI binding, then an explicitly authorized IAM/runtime gate and Firebase deployment. This document does NOT authorize a production upload.
