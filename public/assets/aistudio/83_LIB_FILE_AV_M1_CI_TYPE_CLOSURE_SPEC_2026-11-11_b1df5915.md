# 83 — LIB-FILE-ISOLATED-AV-EXECUTION-M1 / CI-TYPE-CLOSURE

- Project: Promise of Planet — وعد الكوكب
- Repo: `rexat007/promise-of-planet`
- Verified immutable baseline: `5f7a25cfc916756881a392d1f014ba1f6480f699`
- Trigger: GitHub Actions `library-quarantine-av-job.yml`, `verify_only`, on `5f7a25cfc916756881a392d1f014ba1f6480f699`; `npm ci` and `npm --prefix functions ci` succeeded, `npm --prefix functions run build` failed on TypeScript diagnostics **before** Docker build.
- Classification: `CI_TYPECHECK_BLOCKED / AV_RUNTIME_NOT_ACCEPTED / NO_DEPLOY`.
- This is a **single bounded corrective slice within M1**, not a new product stage or a new AV feature.

## Verified root-cause families (source + CI log)

1. Error message type drift: `JUSTIFICATION_NOTES_REQUIRED` is inherited via human-case error codes but absent in `BINARY_SAFETY_STORE_SAFE_MESSAGES`; `AV_EXECUTION_SAFE_MESSAGES` does not cover all inherited store codes. `INSPECTION_REQUEST_INCOMPATIBLE_WITH_SOURCE` and `TIMESTAMP_BEFORE_SAFETY_CASE_HOLD` are referenced but absent in AV service's error-code union.
2. Wrong symbol import: `LIBRARY_UPLOAD_MAX_BYTES` is not exported by `libraryUploadBinaryAdmission.ts`; actual canonical exported limit: `MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES` (= 15,000,000). Two consumers import the nonexistent constant.
3. Source generation nullability: receipt.generation is `string | null`; AV execution provenance and GCS `bucket.file(..., { generation })` require a verified generation string. `verifyQuarantineIsolatedInspectionChainEligibility()` already returns an `eligibleChain.sourceGeneration: string`, validated by `parseCanonicalSafeGcsGeneration`.
4. Firestore transaction typing mismatch: AV execution calls `tx.set` but its transaction callback is typed as `LibraryQuarantineReviewDraftFirestoreTransaction`, which deliberately does not allow `.set`. Use a **locally typed, runtime-checked AV set operation**, not a global loosening of review-draft write permissions.
5. AdminUser identity casts: redundant direct casts to a required `uid` conflict with canonical `AdminUser` interface; preserve UID equality and fail-closed authorization using a safely narrowed optional field or the canonical `id`.
6. Optional `docRef.get` from the common point-document interface is invoked unguarded seven times in read-only catalog alignment. Add a fail-closed point-get guard/helper within the existing service; **no queries/writes**.
7. A final isolated-inspection store-result branch can remain `RECORDED | ALREADY_RECORDED | HOLD` under TS control-flow analysis; explicitly narrow `status === 'HOLD'` and fail closed otherwise without assuming `.reasonCode` is always present.

## Allowed modifications (9 existing files / 0 new code / 0 deleted)

| Path | Git blob SHA-1 at baseline |
|---|---|
| `functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore.ts` | `d790b208205ca96a00ec3a021125ae9297c6b2b0` |
| `functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore.ts` | `69ce04538a86113f41e62f25c7f0a22b1d2d6bee` |
| `functions/src/library/libraryQuarantineIsolatedInspectionRequestContract.ts` | `6d7cbe070a8faa5a48a916e774606fa55e9db294` |
| `functions/src/library/libraryQuarantineIsolatedInspectionRequestService.ts` | `102b9138da33ee9522ed7cdbb5ed27ef59f3fb05` |
| `functions/src/library/libraryQuarantineBinarySafetyCaseService.ts` | `ea8bc12a224d8ec3b9810d8923b1597f53c8d17a` |
| `functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts` | `bfce0d697eb6b433ec109f3be4a92be274f82062` |
| `functions/src/library/libraryQuarantineAvExecutionService.ts` | `560287f1ecaebc4b8c107c368c538ac617b05394` |
| `functions/src/library/libraryQuarantineAvWorker.ts` | `8a6038d6e9517b72f4fcae58369a774efd5bb55a` |
| `scripts/runLibraryQuarantineAvExecutionBackendTests.ts` | `6812f92dfd203d3a250de9505425f6fe70d4a69e` |

## Protected read-only references (13)

| Path | Git blob SHA-1 at baseline |
|---|---|
| `functions/src/library/libraryUploadBinaryAdmission.ts` | `c479007641d799afb145436bf91e661a7c2d5611` |
| `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` | `cb679848608d7000b564ad3863ee23f7c888b970` |
| `functions/src/library/libraryQuarantineAvExecutionContract.ts` | `e909ad973da54d6c327892a259e0f0957dbc9582` |
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` |
| `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts` | `8fe5f352736faddd3f95c0a09106a79b7bec5c89` |
| `functions/src/library/libraryQuarantineAvJobInvoker.ts` | `15a462b427f3e3c49de7d1aa5376328f9782265e` |
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` | `4bca554dd00a5e2efc739cc166175cc63327c5ad` |
| `functions/src/types/admin.ts` | `8064d1393b6e519f9df4be13ad35ece6d07907c0` |
| `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` |
| `functions/library-av-worker.Dockerfile` | `7d15c7f825169a7d78d71345e1e1046509b0cd00` |
| `.github/workflows/library-quarantine-av-job.yml` | `4ae529cd83e3fa22d9e5616e4b05178626bf7270` |
| `functions/package.json` | `420e933933f4f582a4ded415727152021faf5400` |
| `functions/tsconfig.json` | `eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6` |

## Required code behavior

- Repair these compile blockers as one coherent set; preserve exact persisted schemas, revision/CAS fences, Firestore read/write budgets, generation and SHA-256 checks, private GCS bucket, OpenAPI/CORS/Owner release gates, and all five false readiness flags.
- Do not change AV scan results, Docker, IAM, GitHub Actions, public library, Firestore/Storage rules, environments, dependencies, package-lock, or publishing. No `as any`, `@ts-ignore`, `ts-nocheck`, disabling strictness, or weakening error-code unions or security validators.
- For sourceGeneration, use the authoritative `eligibleChain.sourceGeneration` (already validated non-null) while checking it is consistent with receipt/request where appropriate; malformed/null source must HOLD, not fabricate generation or silently continue.
- For AV transaction `set`, preserve overwrite semantics exactly and validate at runtime that the transaction exposes a function. Keep this capability **local to the AV execution store** and restricted to its own ledger collection.
- Update the existing backend suite with regression checks for the repaired families; do not introduce a separate test framework or unrelated tests.
- CI must run **both** root `npx tsc --noEmit` and `npm --prefix functions run build`, plus existing M1 backend/client and dependent isolated-inspection, binary-safety, and alignment tests; no Docker or production release while compile is red.

## STOP conditions and deliverables

1. Preflight: `https://api.github.com/repos/rexat007/promise-of-planet/commits/main` must report baseline `5f7a25cfc916756881a392d1f014ba1f6480f699`. Fetch **every listed file** from its full pinned raw HTTPS URL with `HTTP 200`, nonempty non-HTML body, compare Git blob SHA-1 (SHA1 of `blob <bytes>\0<raw body>`), compare Studio-local bytes. If any mismatch, fetch fail, untrusted drift, or missing file: STOP without edits.
2. No assumption Studio supports git or GitHub auto-fetch. Read from actual HTTPS bodies, not path names.
3. Before reporting complete: list exact changed paths and new blob SHA-1; report test commands and exit codes honestly. If `functions/node_modules` is unavailable in Studio, record `FUNCTIONS_BUILD_ENV_BLOCKED` rather than claiming build PASS; let GitHub Actions perform the authoritative Functions build after owner push. **Do not install packages in Studio without user authorization.**
4. GitHub Sync: exactly 9 intended code MODIFIED, 0 ADDED, 0 DELETED unless the actual needed subset is smaller. Temporary `.md` documents inside `public/assets/aistudio/` are allowed exception, no piecemeal deletion, no secrets.
5. Owner alone authorizes Push and, in a separate decision, verify/deploy; Studio must not push, start Cloud Run, run firebase CLI or edit secrets/IAM.
6. If a compile error remains in an unrelated file, provide exact evidence and STOP rather than expanding scope.
