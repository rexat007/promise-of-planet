# Promise of Planet — LIB-FILE-02B2B2
## Server-internal, readback-only quarantine recovery coordinator

**Date:** 2026-11-07  
**Repository:** `rexat007/promise-of-planet`  
**Pinned accepted base:** `778ada2af7e8307fe7215f549d7b2db65e6849f6`  
**Status:** Specification — no implementation or deployment

## 1. Purpose and boundary

Implement one server-internal, dependency-injected recovery coordinator for previously persisted `WritePending`, `NeedsReconciliation` and potentially already `Quarantined` receipt states. It must **never call GCS `save`, upload, delete, or create a new receipt**. It reads the existing authoritative Firestore receipt and verifies the existing GCS object through `verifyExistingQuarantineObject`. It may perform only a single documented CAS transition, with explicit uncertainty when CAS may have committed but the response was lost.

No user-facing endpoint, automation, scheduler, Firebase integration, content extraction, PDF sanitization, LibraryIntake change, PEIA access, or deployment in this unit.

## 2. Verified source references

| Path | Git blob SHA-1 | Functionality |
|---|---|---|
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | Validated receipt contract and transitions |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` | `getReceiptById`, CAS/revision, sanitized DTO |
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` | `5d25e21a25b61cfe984b18f698d59f9dcc1b02e0` | `verifyExistingQuarantineObject`, bounded actual-byte readback |
| `functions/src/library/libraryQuarantineWriteCoordinator.ts` | `8f0343e72eae11158d6516d1baa6af99dca5c22a` | Existing Reserved → WritePending → GCS write → quarantine coordinator |
| `scripts/runLibraryQuarantineWriteCoordinatorTests.ts` | `bbca4339d56c38f0feb08a202ef16b3cd71bfd49` | Existing tests; read-only |

The SHA-1s above were verified against the pinned GitHub reference in the conversation. They **must** also be verified against Studio-local bytes before changing anything. The local workspace could contain unpushed changes and is not presumed identical to GitHub.

## 3. Exclusive file scope

Create only:

1. `functions/src/library/libraryQuarantineRecoveryCoordinator.ts`
2. `scripts/runLibraryQuarantineRecoveryCoordinatorTests.ts`

All existing source/test/config files: read-only. If either target path already exists, stop. No Git use in Studio. No GitHub fetch by file path or assumed sync. No dependency installs.

## 4. Interface

Server-internal operation, e.g. `recoverExistingLibraryQuarantineReceipt({receiptId, actorUid})`. Both fields are validated and all additional supplied fields rejected. `actorUid` is an internal, supposedly authenticated identity supplied by a **future trusted boundary**; the coordinator cannot itself authenticate a string. Require equality with persisted `uploaderUid`. No caller-supplied receipt, state, path, bytes, generation, attestation or storage verdict.

Inject `LibraryQuarantineReceiptStore`, a **readback-only port** exposing only `verifyExistingQuarantineObject(...)` from the existing GCS adapter, and optionally a trusted clock. The port type must not expose `writeQuarantineObjectIfAbsent` or `save`.

## 5. Recovery decision matrix

| Persisted state | Verified existing object | Missing / uncertain / mismatched object |
|---|---|---|
| `Reserved` | STOP / `NOT_RECOVERABLE_STATE` (no GCS probe) | Same: no implicit upload or promotion |
| `WritePending` | `confirmLibraryQuarantineWriteWithAttestation` then CAS to `Quarantined` | Attempt at most one CAS to `NeedsReconciliation` using `markLibraryQuarantineWriteNeedsReconciliation`; if CAS uncertain, report `PERSISTENCE_UNCERTAIN` |
| `NeedsReconciliation` | `reconcileLibraryQuarantineReceiptWithAttestation` then CAS to `Quarantined` | Preserve `NeedsReconciliation`, report unresolved without new CAS/retry; no automatic `Rejected` |
| `Quarantined` | Verify readback and exact **generation** against saved receipt, then return idempotent confirmed outcome without CAS | Report explicit integrity/verification problem, never claim freshly verified success or rewrite terminal receipt |
| `Rejected` | STOP / read-only terminal result (no GCS probe) | Same |

No automatic rejection merely because readback did not find an object: a previous writer may still be running or visibility may be temporarily uncertain. No automatic deletion or cleanup. A verified existing object means the *real existing GCS adapter* performed a bounded read of actual bytes and checked SHA-256, ownership, MIME, path, generation and privacy-related visible metadata; it does **not** mean the bucket IAM configuration has been verified or the PDF/DOCX has been sanitized.

## 6. CAS and uncertainty

- Load the authoritative Firestore revision and exact current receipt; use only that snapshot for transition input.
- Perform at most one mutation CAS per invocation, never any storage write.
- A successful CAS response must match receiptId, resulting state, expected revision increment and the attested generation.
- If CAS throws, times out or returns an uncertain failure, read the authoritative receipt **once more only for classification**. If the new state is `Quarantined` and matches the verified attested generation/identity, it can be reported as already converged. Otherwise report `PERSISTENCE_UNCERTAIN` or `CONCURRENT_STATE_CHANGE`; do not do a second mutation or claim success.
- Do not turn a competing incompatible state into success. Idempotency never means bypassing stored generation checks.
- Timestamps must be server-controlled, ISO UTC, monotonic and consistent with existing contract transition methods.
- Return sanitized receipt DTO, receiptId, state, revision and machine-readable result. Never return internal storage path, stored object generation string, raw bytes, token, signed URL, credentials, raw exception, or complete attestation.

## 7. Safety

- All outputs retain `bucketIamPrivacyVerified:false`, `isSanitized:false`, `isVerifiedSafe:false`, `isRightsApproved:false`, `isPublished:false`, `isReadyForPeia:false`.
- This recovery step must not elevate a stored object to public, content-reviewed, extraction-ready or PEIA-ready.
- No GCS `save`/delete/overwrite, no new ID, no new Firestore document, no collection scan, no background retry or automatic scheduler.
- Confirm use of the actual production GCS readback implementation in fake-backed tests; do not replace its verification with forged success tuples.
- **Separate deployment prerequisite:** verify bucket-level IAM and object-generation binding of GCS byte streaming before any live upload endpoint. Existing adapter has `createReadStream({validation:false})` without an explicit generation pin; this unit cannot overstate generation-race guarantees or silently change the read adapter.

## 8. Tests

Run new focused tests covering valid WritePending recovery, valid NeedsReconciliation recovery, already Quarantined same/different generation, Reserved/Rejected denial, owner mismatch, fake/untrusted fields, no object, conflicting object, interrupted stream, malformed receipt, stale revision, CAS failure after actual commit, CAS failure without commit, concurrent competing terminal state, sanitized outputs, monotonic clock, no GCS write/delete, no ID rotation, and no network/Firebase calls. Avoid replaying all previous suites unless necessary to diagnose a discovered failure. Use the fake Firestore/GCS implementations with the **real new coordinator and existing contract/adapters**.

Use app compile/lint where available and report Functions full-build status separately. The established authoritative Functions gate is the manual `AUTH-03A` GitHub Actions workflow on a new owner-approved pushed commit. No Push or Deploy within Studio.

## 9. Stop and acceptance

STOP on SHA mismatches, unexpected file additions/deletions, missing generation/ownership validation, unsafe state escalation, storage writes in recovery, unbounded reads, or any requirement for a third source file. Report exact issue; don't improvise broader remediation.

Accept as `LIB_FILE_02B2B2_IMPLEMENTED_PENDING_OWNER_REVIEW` only if tests pass, no unexpected source changes, and all unsafe/ambiguous branches preserve uncertainty.
