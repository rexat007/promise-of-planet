# 53 — وعد الكوكب | LIB-AV-FIRESTORE-AUTHORITY-ISOLATION

**Date:** 2026-11-11  
**Status:** `ARCHITECTURAL_DIRECTION_REVIEWED / CONTRACT_FIRST_NOT_IMPLEMENTED / NO_DEPLOY`  
**Repository:** `rexat007/promise-of-planet`  
**Pinned source:** `07f14b4d74228969946b55da789ba657ac3d0568` (`main`, verified during this review).  
**Unit currently authorized to propose:** `LIB-AV-AUTHORITY-PORT-C1` (pure type contract and tests only). No network, IAM, repository mutation by reviewer, cloud release, worker dispatch, or other blocks authorized by this artifact.

## 1. Evidence ledger — separate verified deployment and source

### Owner-supplied Google Cloud Shell readbacks

- `M1-INFRA-01`: Dedicated worker identity `pop-library-av-worker@promiseofplanet-bb325.iam.gserviceaccount.com` exists, not disabled. Unique ID `117181998787421567391`. `VERIFIED/CLOSED` for account creation only.
- `M1-INFRA-02`: Artifact Registry `projects/promiseofplanet-bb325/locations/us-east1/repositories/pop-quarantine-workers`, format `DOCKER`, currently `0.000 MB`. `VERIFIED/CLOSED` for repository only.
- `M1-INFRA-03A`: Storage bucket policy now directly grants `roles/storage.objectViewer` to worker on **only** `gs://promiseofplanet-bb325-library-quarantine`. `VERIFIED/CLOSED` for explicit bucket grant only; no Cloud Run runtime test.
- Firestore database: `projects/promiseofplanet-bb325/databases/(default)`, `FIRESTORE_NATIVE`, region `me-central2`. `INVENTORY_VERIFIED`.
- Quarantine bucket: `us-east1` (readback shows `US-EAST1`). Worker Artifact Registry: `us-east1`. A job was absent from `us-east1` and `us-central1` in supplied checks; lack of other-region inventory ≠ globally nonexistent.
- `manageLibraryDocuments` Gen2 runtime: `800909267220-compute@developer.gserviceaccount.com`, project IAM roles `roles/editor` and `roles/run.builder`. **Existing overly broad role is a separate security debt, not permission to remove it in this unit.**
- GitHub deployer `github-action-promise-of-plane@promiseofplanet-bb325.iam.gserviceaccount.com`: `roles/cloudfunctions.admin`, `roles/firebaseauth.admin`, `roles/firebasehosting.admin`, `roles/firebasestorage.admin`, `roles/run.viewer`, `roles/serviceusage.apiKeysViewer`, `roles/serviceusage.serviceUsageConsumer`. `iam.serviceAccounts.actAs`, registry writer, Cloud Run jobs deployment authority NOT YET VERIFIED at the required resource scope.
- Worker account: `NO_DIRECT_PROJECT_BINDING_VISIBLE`; policy on SA and Artifact Registry showed no direct bindings (these outputs do not prove lack of inherited roles). No Firestore role granted for the worker during reviewed operations.
- `M1-INFRA-03B`: Database inventory `VERIFIED`; **Firestore least-privilege design remains OPEN**. All GCP commands used for this inventory were read-only.

### Source-verified contracts (at pinned SHA)

| Path | Git blob SHA-1 | Observed anchor |
|---|---|---|
| `functions/src/library/libraryQuarantineAvWorker.ts` | `bf307a601f6860087a7bcbfbd87b809b284afb65` | Worker has direct `getFirestore()` fallback + `FirestoreLibraryQuarantineAvExecutionStore` constructor; GCS read stream pinned to generation; calls claim/record. |
| `functions/src/library/libraryQuarantineAvExecutionService.ts` | `fb7d89d01235f19f69980feed10f7599114f6d74` | `FirestoreLibraryQuarantineAvExecutionStore`; claims and commits via transactions across 9 point documents; write allowlist contains **only** `library_quarantine_av_executions`. |
| `functions/src/library/libraryQuarantineAvExecutionContract.ts` | `e909ad973da54d6c327892a259e0f0957dbc9582` | AV ledger schema; five false readiness flags. |
| `functions/src/library/libraryQuarantineAvJobInvoker.ts` | `15a462b427f3e3c49de7d1aa5376328f9782265e` | Cloud Run Jobs API invoker; `requestId` override, uncertainties remain `DISPATCH_UNKNOWN`, no blind retry. |
| `functions/src/library/libraryAdminHandlers.ts` | `4753e205d918424c92a88aabacc58599cbdc3882` | `POP_LIBRARY_AV_EXECUTION_ENABLED` default OFF; existing `manageLibraryDocuments` handler. |
| `.github/workflows/library-quarantine-av-job.yml` | `4ae529cd83e3fa22d9e5616e4b05178626bf7270` | `verify_only` versus `deploy`, deploy setting `--memory=2Gi`, `--cpu=1`, `max-retries=0`; no job deployment from latest successful verify_only. |
| `functions/tsconfig.json` | `eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6` | Functions TS strict; `src/**/*.test.ts` excluded from build. |
| `functions/package.json` | `420e933933f4f582a4ded415727152021faf5400` | No package additions authorized. |

All paths above are at a fixed commit, **not** anonymous `main`. GitHub is source of pushed bytes; Studio-local is source of unpushed edits. Never assume Studio can fetch GitHub by path. See pinned direct URLs in file 54.

## 2. Threat model and design decision

**Boundary:** The ClamAV worker processes *untrusted* PDF/DOCX bytes. A parser exploit compromising worker identity must not yield any Firestore read/write credential. The worker may have read-only quarantine object access and invoke a narrowly authenticated private authority endpoint; no general Firestore client.

**Chosen direction for architecture review:** New dedicated private **authority bridge** (e.g. private Cloud Run Service, distinct from the ClamAV Cloud Run **Job**) with a separate service identity, routing only authorized `claim` and `recordOutcome` operations to existing Firestore transactional methods. This is a **design direction**, not a deployed service; product change and cost/region/IAM must undergo later gates. Private IAM invoker binding limited to the worker identity on the exact service resource. Google-signed ID token with strict audience, HTTPS only; no shared static key, no public/unauthenticated endpoint.

**Why not direct worker IAM:** Even a custom Firestore role with `datastore.entities.get/create/update` at database scope would not constrain mutations to a particular collection/path in the shared `(default)` database. Admin SDK bypasses Firestore Rules. Local write allowlist protects correct code but not a compromised process's service account. A separate bridge moves Firestore credentials to a process that does not parse arbitrary binary files.

**Why not reuse current `manageLibraryDocuments` directly:** It is a Firebase callable designed around human admin access, currently uses the Compute default account with `roles/editor`, and is a live product surface. Treat changing it as a separate impact-assessed project; do not graft worker trust onto its public callable.

**Bridge principle:** Reuse canonical `claimAvExecutionForWorkerTransactional` and `recordWorkerAvScanOutcomeTransactional` under the existing `FirestoreLibraryQuarantineAvExecutionStore`. Do not duplicate its nine-document validator/CAS, reduce required reads, accept client-provided path/sha/generation, bypass Owner human review dispatch, or grant the worker privileged administrative roles. Limit returned claim data to strictly necessary canonical values, scrub logs. Worker may send only a deterministic request ID, worker run identity, the pinned revision, and observed scan evidence; bridge rederives trusted state independently.

## 3. Required behavior before integration

- Worker has **no** `datastore.*` permissions, no Firestore identity/token, no direct `getFirestore()` call on its production path (the old fallback must be removed ONLY in a future separately approved unit).
- Private bridge verifies invoker identity at Cloud Run IAM boundary and validates body/IDs/size/schema server-side. Firestore calls are made by its **separate** service account; its custom IAM role will still apply at database scope, so only code-level allowlist + independent runtime separation contain blast radius; document residual privilege risk.
- Claim and record remain server-transactional and authoritative. 9 point reads; only AV ledger is written; hold on stale source/revision/ownership/generation/SHA/rights. No writes to receipts, human case, rights, catalog, source documents, or public content.
- The bridge must distinguish genuine `HOLD`, `ALREADY_RUNNING`, `ALREADY_TERMINAL`, `STALE_HOLD`, `RECORDED`, and ambiguous timeout/lost response. **Never** convert uncertain network completion to clean or blindly retry a non-idempotent claim/outcome. Reconciliation must use a bounded, read-only, authorized status operation with explicit source revision; design exact endpoint later.
- Cloud Run Job is NOT equivalent to Cloud Run Service: bridge is private request/response endpoint; existing ClamAV component remains a single-task Job. No automatic scan triggers or public surface.
- Preserve `isSanitized/isVerifiedSafe/isRightsApproved/isPublished/isReadyForPeia=false` for all AV results, including clean scan. No automatic publication, download, PEIA acceptance, or GCS delete.
- The current `POP_LIBRARY_AV_EXECUTION_ENABLED=false` and client gate remain OFF. No Cloud Run deployment/execution or IAM scope widening within the C1 contract unit.

### Region considerations

- Firestore is in `me-central2`, quarantine bucket and worker registry in `us-east1`. Dedicated bridge region **not decided**: compare cross-region Firestore RPC latency, service-to-service RTT, egress, data residency, and regional policy. `us-east1` is only a plausible worker location, not authorization to replicate documents across regions. Never relocate Firestore or bucket during this unit.
- Workflows currently have `2Gi` memory setting; ClamAV memory envelope requires real validation before deploy. Existing verify_only proves local image build/signatures, not runtime memory, IAM, or security of a live file.

## 4. Single next executable unit: LIB-AV-AUTHORITY-PORT-C1

**Scope:** Pure compile-time `LibraryQuarantineAvAuthorityPort` abstraction matching the **existing** `FirestoreLibraryQuarantineAvExecutionStore` worker-facing methods, plus deterministic tests. Bridge implementation, HTTP, job runtime migration, IAM, CI workflow, GCS, Firestore, packages, user interfaces, and docs within Studio are OUT OF SCOPE.

**Create-only allowlist:**

1. `functions/src/library/libraryQuarantineAvAuthorityPort.ts` — type-only imports of `WorkerClaimAvExecutionResult`, `WorkerRecordAvScanOutcomeInput`, `WorkerRecordAvScanOutcomeResult` from current service; interface with exactly `claimAvExecutionForWorkerTransactional({requestId,workerRunId,nowIso})` and `recordWorkerAvScanOutcomeTransactional(input)`.
2. `functions/src/library/libraryQuarantineAvAuthorityPort.test.ts` — compile-time assignability, deterministic in-memory fake tests for CLAIMED/HOLD/ALREADY_RUNNING/RECORDED/record HOLD; no Firebase/GCS/network calls; no runtime imports of `firebase-admin` in new contract.

**All existing files are READ-ONLY.** If baseline mismatches, targets exist, other unpushed Studio edits obscure scope, or the proposed port requires editing existing code/contracts: **STOP before writing**.

**Gates:** Local `functions` strict TS build, isolated test command supported by installed tools, baseline M1 backend/client tests (CI previously passed at current pinned GitHub SHA), exactly two CREATE and zero MODIFY/DELETE in Studio GitHub Sync, human review of source and report, manual Push only after explicit owner acceptance. Build PASS is not proof of product integration.

**Expected classification:** `LIB-AV-AUTHORITY-PORT-C1_CONTRACT_IMPLEMENTED_PENDING_SOURCE_REVIEW`; operational isolation remains `NOT_IMPLEMENTED` until separately accepted bridge and worker adaptation.

## 5. Later units — NOT AUTHORIZED NOW

- `C2`: private bridge implementation, request authentication, strict DTOs, 9-read + CAS reuse, dedicated account permission model, tests (separate exact allowlist; may require Cloud Run Service workflow distinct from existing Job workflow).
- `C3`: change worker production to use private bridge by default; direct Firestore fallback unavailable in live worker, strict `UNKNOWN` reconciliation; tests.
- `C4`: deploy bridge with resource-scoped IAM, negative worker Firestore access probe, no public exposure, region/cost approval, readback.
- `C5`: controlled ClamAV Job deploy, first real security test (EICAR and owned clean files only after separate owner approval), independent end-to-end rights and invariant verification.

## 6. Official reference documentation

- Firestore IAM and server SDK bypass: https://cloud.google.com/firestore/native/docs/security/iam and https://cloud.google.com/firestore/native/docs/security/rules-conditions
- Firestore database IAM conditions: https://cloud.google.com/firestore/native/docs/manage-databases
- Cloud Run private service-to-service auth: https://cloud.google.com/run/docs/authenticating/service-to-service
- Cloud Run Job service identities: https://cloud.google.com/run/docs/configuring/jobs/service-identity

**No cloud state changed by creating this document.**
