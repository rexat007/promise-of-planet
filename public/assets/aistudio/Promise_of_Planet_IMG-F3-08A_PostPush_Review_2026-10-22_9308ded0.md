# Promise of Planet — IMG-F3-08A Post-Push Source Review

**Date:** 2026-10-22  
**Repository:** `rexat007/promise-of-planet`  
**Audited commit:** `a14e609da84b903fafbadf6312f3ad0c9daaa3d5`  
**Direct parent:** `0c994887907a8847cd447c712eeb80222c16311b`  
**Assessment:** `PUSH_AUDIT_PASSED — SOURCE_REVIEW_ONE_TARGETED_REMEDIATION_REQUIRED — NOT_ACCEPTED`

## 1. Push evidence

The pushed commit has exactly three changes: the two allowed source/test files modified and one source-audit Markdown added under `public/assets/aistudio/`; no deletions.

| Path | Status | Git blob SHA-1 |
|---|---|---|
| `functions/src/news/editorialUntrackedImageObjectDiscovery.ts` | Modified | `72d550b728ff9afbf59088e552237187c993f56b` |
| `functions/src/news/editorialUntrackedImageObjectDiscovery.test.ts` | Modified | `37343b7c2b144b6db8f665a5a3585b4ca4898989` |
| `public/assets/aistudio/Promise_of_Planet_IMG-F3-08A_PostPush_Source_Audit_2026-10-22_0b7849fb.md` | Added | `a2682ae466d085344ac04eef79c740774871a79b` |

Root and Functions package/lockfiles, `bun.lock`, both Oxlint files, GCS adapter, session store, intake service, image processor and Firebase settings all match the prior known blobs.

## 2. Verified source improvements

* Exact returned storage path matches requested candidate path, or `STORAGE_FAILURE` is thrown.
* Ownership namespace is compared against the canonical path namespace; mismatches are conflicts.
* Duplicates are retained for comparison rather than silently overwritten.
* Validated `etag`, `contentType`, canonical `createdAtIso`, expected MIME/extension compatibility, checksum format, size and generation format.
* Strict finite bound of 18 sequential `readMetadata` calls, zero write/delete functionality.
* Studio reports 162/162 passing across eight suites and isolated strict TypeScript passing. These commands were **not re-executed independently** in this audit.

## 3. Remaining source defect — contradictory duplicate receipts with the same generation

At `functions/src/news/editorialUntrackedImageObjectDiscovery.ts` around lines 484–526, a set of duplicate records for the same storage path is treated as agreeing if **only `generation`** matches:

```ts
const firstGen = trackedEntries[0].tracked.generation;
const allGenerationsAgree = trackedEntries.every(
  (e) => e.tracked.generation === firstGen
);
```

It then classifies the storage object as `tracked` when the generation equals live metadata. Two session records can have the same generation but conflicting `sha256Checksum`, `sizeBytes`, `contentType`, `etag`, `namespace`, or `createdByIntakeId`; these are **not identical receipts**. A conflicting record can be silently marked healthy. The previous source-review instruction specifically allowed **identical** duplicate receipts and required conflicting ones to be flagged. The new test only verifies equal-generation *identical* duplicates and differing-generation duplicates, not same-generation metadata disagreement.

**Minimal follow-up:** limit edits to the same two files. Preserve the read-only interface. Before reporting a tracked result, require all duplicate receipts for a candidate path to agree on the canonical receipt identity fields (`storagePath`, `namespace`, `generation`, `etag`, `sha256Checksum`, `sizeBytes`, `contentType`, `createdByIntakeId`). On disagreement return an explicit safe conflict (new conflict code is acceptable), never `tracked` or `untrackedOwned`. Add a regression fixture where generation matches but checksum or size differs, and a case where ownership fields disagree; preserve legitimate exact duplicates. Keep 18 bound. No production wiring, GCS mutation, Firebase deploy or package edits.

Note: this is a source-level contract consistency finding, **not evidence that deployed GCS was compromised**.

## 4. State/gates

**Unit IMG-F3-08A not accepted.** It remains a read-only diagnostic helper, not durable recovery or user-visible upload. Open blockers remain `GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`, `UPLOAD_NOT_WIRED`, `PUBLIC_IMAGE_RIGHTS_GATE_NOT_WIRED`, and `NO_FIREBASE_PRODUCTION_VERIFICATION`. Full Functions/frontend build has previously reported unrelated baseline TypeScript errors.

**Source links:**

* [Pushed commit](https://github.com/rexat007/promise-of-planet/commit/a14e609da84b903fafbadf6312f3ad0c9daaa3d5)
* [Discovery source lines 484–526](https://github.com/rexat007/promise-of-planet/blob/a14e609da84b903fafbadf6312f3ad0c9daaa3d5/functions/src/news/editorialUntrackedImageObjectDiscovery.ts#L484-L526)
* [Duplicate-receipt tests](https://github.com/rexat007/promise-of-planet/blob/a14e609da84b903fafbadf6312f3ad0c9daaa3d5/functions/src/news/editorialUntrackedImageObjectDiscovery.test.ts#L489-L597)
