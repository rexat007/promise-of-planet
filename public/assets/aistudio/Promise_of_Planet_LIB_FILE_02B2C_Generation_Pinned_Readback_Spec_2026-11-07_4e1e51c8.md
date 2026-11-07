# Promise of Planet — LIB-FILE-02B2C
## Generation-Pinned GCS Quarantine Readback — Engineering Specification

**Status:** SPEC_READY / NOT_IMPLEMENTED  
**Repository:** `rexat007/promise-of-planet`  
**Pinned pushed baseline:** `63418f94360f29aa3b1535cf02024ab04a53fc74`  
**Unit type:** bounded correction in existing GCS adapter, with focused tests.  
**Execution:** Google AI Studio; owner approves Push manually. No deployment.

### 1. Verified source identity

| Path | Expected Git blob SHA-1 | Role |
|---|---|---|
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` | `5d25e21a25b61cfe984b18f698d59f9dcc1b02e0` | **MODIFY** |
| `scripts/runLibraryQuarantineGcsAdapterTests.ts` | `28d809822275268916c24a424076e5165222bf92` | **MODIFY** |
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | READ ONLY |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` | READ ONLY |
| `functions/src/library/libraryQuarantineWriteCoordinator.ts` | `8f0343e72eae11158d6516d1baa6af99dca5c22a` | READ ONLY |
| `functions/src/library/libraryQuarantineRecoveryCoordinator.ts` | `c2105cb5c12fc27e258943374313ad9b1f1c0e9d` | READ ONLY |

These fingerprints identify *the pushed GitHub source*. Google AI Studio local workspace must verify independently before editing. No presumed Git or GitHub access. If local content differs: **STOP**, do not restore from assumed paths.

### 2. Proven defect

In the pushed adapter, `readAndVerifyStoredObject` obtains `rawMeta.generation` from an unpinned `file.getMetadata()` but later invokes `file.createReadStream({validation:false})` on the same unpinned handle (approximately line 1055). The streaming bytes could belong to a later object generation if the object changes between metadata and stream. The reported `TrustedStorageReadbackAttestation.attestedGeneration` could therefore not be causally bound to the actual bytes hashed. The current generation regex also accepts arbitrary non-decimal tokens.

Google Cloud's streaming-read guidance calls for recording metadata generation and specifying that generation on subsequent object reads. The official Node.js Bucket.file API supports a generation-scoped file handle: `bucket.file(name, {generation})`.

External public documentation (for design reference, *not repository source*):
- https://cloud.google.com/storage/docs/streaming-reads
- https://googleapis.dev/nodejs/storage/latest/Bucket.html

### 3. Scope / allowlist

**MODIFY ONLY**:
1. `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts`
2. `scripts/runLibraryQuarantineGcsAdapterTests.ts`

No new files, no config/dependency edits. Keep established receipt lifecycle, 15 MB read budget, conditional write ifGenerationMatch=0, real-byte SHA-256, privacy and security posture flags, no public URL, no Firestore interaction.

### 4. Required change

1. Continue initial unpinned metadata read solely to determine and validate the generation and other metadata.
2. Validate GCS generation as canonical nonzero positive decimal integer string; reject malformed, fractional, negative, zero, exponent, whitespace, or representation that cannot be safely targeted by the installed Node GCS SDK. Use exact string when creating a pinned handle; do not lose precision through uncontrolled `Number(...)`. Because the current Node SDK converts a generation string to JS Number internally, fail closed for values exceeding `Number.MAX_SAFE_INTEGER` unless a verified alternate exact-generation transport exists.
3. Update the injected bucket interface to support `bucket.file(canonicalPath, {generation: exactGenerationString})`, without changing unpinned save logic.
4. **Create the generation-scoped handle after metadata checks**; validate its canonical `.name` and read capability; call `createReadStream` only on that handle. Do not silently fall back to unpinned `createReadStream` if generation scoping is unavailable or rejected.
5. Continue bounded incremental SHA-256 readback, exact size/hash verification, no unbounded `download()` and no buffering whole remote objects.
6. If the selected generation disappears or the pinned read is interrupted, report explicit `NEEDS_RECONCILIATION` rather than a verified attestation. Different-generation or inconsistent metadata and streamed bytes must never lead to success.
7. Only successful generation-scoped readback of matching bytes may construct `TrustedStorageReadbackAttestation` containing *that same* exact pinned generation.
8. Preserve existing method signatures to external coordinators: `writeQuarantineObjectIfAbsent` and `verifyExistingQuarantineObject`; no changes to current Firestore or receipt contracts.

**Important:** A fake that merely accepts a second `file` argument without actually selecting a generation is insufficient. Tests must simulate version replacement and confirm deterministic failure/verified-old-generation semantics.

### 5. Acceptance tests

Extend the existing test suite, retaining its current 14 passing cases. Add targeted cases demonstrating:
- Metadata indicates generation A, current object switches to generation B before stream; pinned handle does not read B as A even when bytes are identical.
- Generation A no longer accessible -> unresolved/readback failure, no attestation, no successful quarantine.
- Generation A remains retrievable and SHA-256 matches -> attestation explicitly records A, not B.
- Invalid generation representations are rejected; beyond MAX_SAFE_INTEGER must fail closed under the current SDK unless an independently verified precise transport exists.
- Real successful write, verify-existing, 412 existing, and recovery readback paths all use generation-scoped streaming.
- No unpinned stream fallback; no extra GCS writes, deletes, URLs, tokens, Firestore writes, or security flag promotion.
- Existing 15 MB and object ownership/content type/CRC-related checks remain unchanged; tests should not invent additional evidence of IAM privacy.

Run modified focused test suite and, if available, existing coordinator/recovery focused suites without modifying their files. Run applet compile/lint; actual Functions build is CI `AUTH-03A` after manual Push.

### 6. STOP conditions and receipt

STOP if repository fingerprints differ, if real SDK does not support accurate pinned stream reads, if the required fix extends beyond allowlist, if any regression fails, or if a verified attestation can still be produced from unpinned bytes. No package installations and no configuration changes to bypass environmental TypeScript mismatch.

Report: `PREFLIGHT`, `FILES_MODIFIED`, `POST_SHA1`, `PINNED_GENERATION_CONTRACT`, `RACE_REGRESSION`, `UNPINNED_FALLBACK`, `HASH_AND_BOUNDING_PRESERVED`, `TEST_RESULTS`, `BUILD_STATUS`, `GITHUB_SYNC_SCOPE`, `FINAL_DECISION`. Allowed decisions: `LIB_FILE_02B2C_IMPLEMENTED_PENDING_OWNER_REVIEW` or justified `STOP_*`.

**Never Push, deploy Firebase, publish documents or run live GCS in this unit.**
