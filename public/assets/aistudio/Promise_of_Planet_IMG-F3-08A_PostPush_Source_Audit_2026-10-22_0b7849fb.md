# Promise of Planet — IMG-F3-08A Post-Push Source Audit

**Date:** 2026-10-22  
**Repository:** `rexat007/promise-of-planet`  
**Pushed HEAD:** `0c994887907a8847cd447c712eeb80222c16311b`  
**Parent:** `0799658cd5589ff47bbc93dbedde0918398761d5`  
**Assessment:** `PUSH_AUDIT_PASSED / SOURCE_REVIEW_REMEDIATION_REQUIRED / NOT_ACCEPTED`

## 1. Pushed scope

GitHub commit adds exactly four files; zero modified and zero deleted:

| Path | Status | Git blob SHA-1 |
|---|---|---|
| `functions/src/news/editorialUntrackedImageObjectDiscovery.ts` | Added | `7012de7ab89367ec3d086bcb945c87ff44fde605` |
| `functions/src/news/editorialUntrackedImageObjectDiscovery.test.ts` | Added | `70a93e5a534e20bcb44bd9e4fd0f2ca6664dd249` |
| `public/assets/aistudio/Promise_of_Planet_IMG-F3-08A_Receipt_Discovery_Studio_Prompt_2026-10-22_cf56b0d0.md` | Added | `a0dd61855a5252012c2039e2a51a8faacb548107` |
| `public/assets/aistudio/Promise_of_Planet_IMG-F3-08_Launch_Image_Upload_Source_Audit_2026-10-22_b686838d.md` | Added | `1610441ba7556d26d3efe451a413aab2e23a55f5` |

Tree scan confirms root manifests/lockfiles, Oxlint, the accepted IMG-F3-05/06/07 components, and Firebase configuration retain their baseline Git blob SHA-1 values. No GitHub push, code changes, Firebase deployment, or tests were run by the reviewer.

## 2. Passed source checks

- Exactly three canonical quarantine candidate paths and fifteen private-variant candidate paths are generated (`editorialUntrackedImageObjectDiscovery.ts` lines 120–160).
- Sequential calls to `readMetadata` are bounded by the eighteen derived paths (lines 276–300). No GCS writes/deletes/listing or Firestore mutations are implemented.
- Foreign `createdByIntakeId`, mismatched target kind, assetId, uploaderUid, and differing tracked object generations are detected (lines 374–449).
- Studio reports eight suites / **157/157** passing, and isolated TypeScript success. These were not independently rerun.

## 3. Required remediation before acceptance

The discovery reader interface is an injectable `Pick<EditorialBinaryStorageAdapter,'readMetadata'>`, so the helper must not assume every implementation silently enforces all consistency checks. Specific source gaps:

1. **Path binding (lines 345–361 and 423–469):** `metadata.storagePath` is parsed for its namespace, but is **not compared byte-for-byte to `candidatePath`**. A mismatched canonical path in a reader response could be classified as owned/tracked for the wrong candidate. The current GCS adapter returns the requested canonical path; this is an additional helper-boundary gap, not evidence of a live GCS exploit.
2. **Ownership namespace (lines 345–420):** code compares `parsedPath.namespace` to the expected namespace but **never compares `metadata.ownership.namespace`** to the expected namespace. A reader response with otherwise matching ownership and a mismatched `namespace` can be classified as owned; the GCS adapter has its own path ownership assertions.
3. **Repeated tracked paths (lines 239–270):** three arrays are merged into a `Map<string, oneRecord>` using overwrite. Conflicting recorded generations or ownership/metadata for the same path can be suppressed by the final entry. Identical duplicates are legitimate and should not be rejected just for appearing twice; conflicting duplicates need explicit fail-closed/conflict handling.
4. **Metadata completeness (lines 310–345 and 439–468):** `etag`, `contentType`, and `createdAtIso` are propagated without validating their presence/type; `metadata.contentType` is not checked for consistency with the storage filename format. Ensure malformed values are not reported as verified metadata; maintain the existing adapter contract and avoid assuming file contents were inspected merely because metadata exists.

The existing ten new tests do not cover the first three negative cases. Keep safe, read-only semantics, bound <=18, and no unauthorized cleanup decision.

## 4. Suggested bounded repair

Modify exclusively:

- `functions/src/news/editorialUntrackedImageObjectDiscovery.ts`
- `functions/src/news/editorialUntrackedImageObjectDiscovery.test.ts`

Use local byte-exact SHA-1 preflight on both paths and protected files before writing; STOP on drift. Add deterministic failing reproductions for wrong returned storagePath, ownership namespace mismatch, conflicting duplicated tracked receipts, and invalid metadata. Correct classification/fail-closed behavior and prove accepted cases still work, including identical duplicates. Run previously reported eight suites (157 baseline) plus new tests, strict TS, and report full sync scope. Do not push or deploy automatically.

## 5. Explicit open boundaries

- `GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`: discovery is not recovery and must not be used to authorize deletion.
- `UPLOAD_NOT_WIRED`: newsroom UI/backend transport not integrated.
- `PUBLIC_IMAGE_RIGHTS_GATE_NOT_WIRED`: human-approved image rights are not enforced at public display boundary.
- `NO_FIREBASE_PRODUCTION_VERIFICATION`: no live integration/deployment evidence.
- Existing unrelated full-build TypeScript errors remain disclosed; do not mark production build green.

## 6. Pinned file links

- [Commit](https://github.com/rexat007/promise-of-planet/commit/0c994887907a8847cd447c712eeb80222c16311b)
- [Discovery implementation](https://github.com/rexat007/promise-of-planet/blob/0c994887907a8847cd447c712eeb80222c16311b/functions/src/news/editorialUntrackedImageObjectDiscovery.ts)
- [Discovery tests](https://github.com/rexat007/promise-of-planet/blob/0c994887907a8847cd447c712eeb80222c16311b/functions/src/news/editorialUntrackedImageObjectDiscovery.test.ts)
