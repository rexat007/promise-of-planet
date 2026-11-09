# Promise of Planet — LIB-FILE-WORKBENCH-01
## حزمة وظيفية متكاملة: صندوق ملفات المكتبة المحجورة → مسودة مراجعة بشرية

**Status:** `INTEGRATED_IMPLEMENTATION_SPECIFIED / NOT_IMPLEMENTED`  
**Repository:** `rexat007/promise-of-planet`  
**Pinned GitHub main:** `53fed785cff4ac39d4ce4acd41e0d1520edc967c`  
**Previous closure:** `LIB-FILE-REVIEW-01C PUSH_VERIFIED / SOURCE_CLOSED` (3 added, 0 modified, 0 deleted; two code blobs and the spec matched).  
**Supersedes:** `LIB-FILE-REVIEW-01D` specification/prompt 59/60 **without execution**; DO NOT run prompt 60 separately. Existing 01A/01B/01C stay authoritative and read-only.

## 1 — Outcome and why this is one functional unit

Deliver one coherent **back-office** experience using real pre-existing code:

1. Show a **single**, bounded, private quarantine inbox in **Admin → Knowledge Library** (existing `AdminLibraryManagement.tsx`), preserving current upload modal and existing receipt rows. Show file name, PDF/DOCX, receipt state and current *review draft* status together, not two overlapping inboxes.
2. Human reviewer with active canonical Library **Review** permission can choose **«إنشاء مسودة للمراجعة / Prepare review draft»** for a `Quarantined` receipt without an existing draft. The server delegates to the already-accepted 01B/01C services; on success UI refreshes the same receipt status to **`PENDING_HUMAN_REVIEW`**, on `IDEMPOTENT_EXISTING` handles repeat safely. No automatic link on page load/upload/refresh.
3. `NeedsReconciliation`, `Reserved`, `WritePending`, `Rejected`, broken/mismatched drafts, unauthenticated/AI/Viewer accounts: no actionable link button; explicit safe HOLD/error, not fake empty/success. Distinguish `NOT_LINKED`, `PENDING_HUMAN_REVIEW`, `NEEDS_RECONCILIATION_HOLD`, `NOT_ELIGIBLE`, and *read error*. The UI is **not** a binary preview, sanitization station or publication/rights approval UI.
4. Arabic/English RTL/LTR, narrow mobile/tablet/desktop layout, light/dark mode, one refresh control, no redundant buttons. Prevent duplicate click and stale results after account change/unmount, and never retry an `UNKNOWN` commit outcome automatically.
5. Do all of this in **one Studio implementation** with backend/auth/DTO/client/UI/integration tests, not a chain of tiny units. Feature remains gated until owner approves actual Firebase deployment.

### Verified pre-existing implementation (avoid duplication)

- `AdminLibraryManagement.tsx` already contains `LibraryQuarantineReceiptsInboxController`, `canViewLibraryQuarantineReceipts`, the current last-20 receipts table/mobile cards, and `<LibraryQuarantineUploadPanel/>` with live configuration gate.
- `LibraryAdminClient.listQuarantineReceipts()` uses existing `manageLibraryDocuments` callable; `libraryAdminHandlers.ts:~838` authorizes and routes `listQuarantineReceipts` via `listLatestSanitizedLibraryQuarantineReceipts`.
- `libraryQuarantineReviewDraftPersistenceService.ts` implements trusted principal, GCS generation-pinned readback, transaction source guard and `CREATED | IDEMPOTENT_EXISTING | UNKNOWN`; `libraryQuarantineReviewDraftCallableBridge.ts` supplies a request-scoped callable-principal adapter and sanitized result, but its standalone callable is **not exported in `index.ts`**.
- Existing public `PublicLibraryHub.tsx` must remain unchanged. The `LibraryIntakeRecord` URL-based legacy path must not be used as a substitute for private quarantined GCS files.

## 2 — Direct pinned source references, sha-verified on connected GitHub

These are **complete immutable HTTPS raw URL references**, not relative-path retrieval instructions. Studio MUST inspect its **own local** files first, verifying Git *blob* SHA-1 and full body. GitHub has a different authority: it is authoritative ONLY for pushed baseline, not unpushed Studio modifications. Studio must not assume `.git`, Git CLI, or GitHub Sync means source download works. If a local mismatch requires fetching, verify each URL returns HTTP 200, complete non-HTML body, and the expected Git blob SHA-1 **before ANY write**; otherwise STOP. Never write from guessed source.

| Path / role | Pinned Git blob SHA-1 | Direct URL |
|---|---|---|
| `functions/src/library/libraryAdminHandlers.ts` **MODIFY** | `33ef17394a9a0172cd38cc0eaed8db1fe5d3efb6` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/libraryAdminHandlers.ts |
| `src/components/library/AdminLibraryManagement.tsx` **MODIFY** | `f1e1928772c5dc0533134658f9c77c0ca87dfae8` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/src/components/library/AdminLibraryManagement.tsx |
| `functions/src/library/libraryQuarantineAdminReadService.ts` READ | `fc59ce7350c24ee76f5bd0d6b358196ce48ebc45` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/libraryQuarantineAdminReadService.ts |
| `functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts` READ | `1edb4f3dbfd58a2ebe0604c3b8412ef47e18b7ee` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts |
| `functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts` READ | `5709952519564cb118443fd6dd59ec9cff249bb1` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts |
| `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` READ | `f481a24bda7dcbf7a63a12644e5b2d91b8626318` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` READ | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/firestoreLibraryQuarantineReceiptStore.ts |
| `functions/src/library/libraryQuarantineReceiptContract.ts` READ | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/libraryQuarantineReceiptContract.ts |
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` READ | `4bca554dd00a5e2efc739cc166175cc63327c5ad` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/gcsLibraryQuarantineStorageAdapter.ts |
| `functions/src/library/libraryQuarantineUploadEndpoint.ts` READ | `c400d40606d9d124c377ab3e0c536278d3fb61bc` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/library/libraryQuarantineUploadEndpoint.ts |
| `src/services/libraryAdminClient.ts` READ | `bf5804a703614327e76845de4fe1b4c3958920b8` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/src/services/libraryAdminClient.ts |
| `src/components/library/LibraryQuarantineUploadPanel.tsx` READ | `8f51737335da3e213791c6bad35bc9f422243d91` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/src/components/library/LibraryQuarantineUploadPanel.tsx |
| `src/components/layout/AdminLayout.tsx` READ | `f1527e1e6feace45029e5e88030d58c296b37edc` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/src/components/layout/AdminLayout.tsx |
| `src/services/firebase.ts` READ | `99950b76657d051f4500b3da91c289743d354496` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/src/services/firebase.ts |
| `functions/src/index.ts` READ/RELEASE GATE | `5a14cada5dad8e764f8cc3092f40c386f6b09616` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/functions/src/index.ts |
| `scripts/runLibraryQuarantineAdminReadTests.ts` READ | `9d2812b4374f5fb207a872869e2f7dab088e7a8f` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/scripts/runLibraryQuarantineAdminReadTests.ts |
| `scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts` READ | `360a63883f1e3eb18f0ede62ee72e31e7f3a3263` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts |
| `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts` READ | `3c32ef07e26604a4e09e421c46979a4cdfdbc067` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts |
| `package.json` READ | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` | https://raw.githubusercontent.com/rexat007/promise-of-planet/53fed785cff4ac39d4ce4acd41e0d1520edc967c/package.json |

The four new paths below were not part of accepted 01A–01C. Before implementation Studio must verify **all 4 are absent locally**; if any exists, STOP and describe its content/ownership without overwriting. Also stop if an earlier `01D` experiment exists locally; do not combine two divergent unpushed implementations.

## 3 — Exact code write allowlist: 6 files total

**MODIFY exactly these two existing files, only within narrow Library Workbench integration blocks:**
1. `functions/src/library/libraryAdminHandlers.ts`
2. `src/components/library/AdminLibraryManagement.tsx`

**ADD exactly these four files:**
3. `functions/src/library/libraryQuarantineReviewWorkbenchService.ts`
4. `src/services/libraryQuarantineReviewWorkbenchClient.ts`
5. `scripts/runLibraryQuarantineReviewWorkbenchBackendTests.ts`
6. `scripts/runLibraryQuarantineReviewWorkbenchClientTests.ts`

The attached spec may be **retained as ordinary documentation** under `public/assets/aistudio/61_LIB_FILE_REVIEW_WORKBENCH_INTEGRATED_SPEC_2026-11-09.md`; report it separately. All other files are PROTECTED/READ-ONLY, especially index exports, 01A/01B/01C, GCS, Firestore rules, old upload panel/client, news/media, PEIA, donations, package/lock/config, hosting/deploy workflows. No installs, mass move/cleanup, `rm -rf`, PR, Push or Firebase CLI deployment.

## 4 — Backend implementation (one coherent workflow)

**4.1 Read composition** — new `libraryQuarantineReviewWorkbenchService.ts`:
- Inject existing `listLatestSanitizedLibraryQuarantineReceipts(db)` reader and `Pick<LibraryQuarantineReviewDraftStore, 'getReviewDraftByReceiptId'>`. Read at most **20** latest receipts once, no unbounded collection queries and no GCS reads for list. For each eligible `Quarantined` receipt, make at most **one** point lookup of draft. `NeedsReconciliation` and non-Quarantined states must not read drafts. Fail the *entire response* on malformed/corrupt/mismatched/unreadable drafts or source: no silent skip, no fake `NOT_LINKED` on infrastructure errors.
- For found drafts validate 15-field schema and exact receipt ID/revision/updatedAt/SHA256/format/uploaderUid/state and five false safety/rights/publication flags against sanitized receipt. A validated existing draft means **`PENDING_HUMAN_REVIEW`**, never content approved.
- Return `ok:true,{receipts:[{revision,adminReceipt,draftStatus}]}` keeping existing *already sanitized* admin receipt DTO for private authorized admin UI, or `ok:false,{errorCode,errorMessage}` with **fixed non-sensitive messages only**, never exception strings/IDs/URLs. Allowed draft status: `NOT_LINKED | PENDING_HUMAN_REVIEW | NEEDS_RECONCILIATION_HOLD | NOT_ELIGIBLE`. No raw persisted draft or `createdBy`, GCS metadata/generation/path, signed URL, binary, new public routes or PEIA.

**4.2 Authorized actions in existing `manageLibraryDocuments` server handler** — surgical extension ONLY of `executeManageLibraryDocumentsRequest` in `libraryAdminHandlers.ts`:
- `action:'listQuarantineReviewWorkbench'`: exact payload `{action}`, requires real callable `requestContext.auth` **from SDK request.auth** and canonical active non-AI human Library View permission via existing `authenticateHumanAdminForLibraryPeiaAction`. Server-only workbench read composition; no writes. Never authorize by client UI alone.
- `action:'linkQuarantineReviewDraft',receiptId`: strict exact payload `{action,receiptId}`; requires canonical active human Library **Review** permission, delegates **once** to accepted `executeLibraryQuarantineReviewDraftCallableBridge` or direct 01B persistence with trusted provider **derived exclusively from verified SDK request.auth** (NOT `requestContext.data`); preserve all generation-pinned GCS + atomic Firestore guards, idempotence and `UNKNOWN` outcome. Return the existing sanitized 13-key 01C bridge DTO; no raw draft, candidate, storage path or digest.
- **RELEASE GATE:** both new actions are explicitly disabled unless `process.env.POP_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'` on the **server**. When not enabled they return a fixed safe `failed-precondition/WORKBENCH_NOT_RELEASED` without calling data stores, GCS or transaction. This is defense in depth if a GitHub Action deploys code before formal authorization. Do not set/change env in Studio and do not export standalone `libraryQuarantineReviewDraftLinkCallable` via `index.ts`.
- For tests use dependency injection or isolated server env controls while preserving existing function signatures/callers. Do not modify old `listQuarantineReceipts` or other actions; no new callable names or `index.ts` edits.

## 5 — Client & UI: integrate existing inbox, not a duplicate

**5.1 New typed client module** — `src/services/libraryQuarantineReviewWorkbenchClient.ts`:
- Call the existing `manageLibraryDocuments` callable with only the exact action payload; never read Firestore/GCS from browser, and never invent a deployment URL.
- Validate result envelope, hard 20 bound, unique valid receipt IDs, existing sanitized `adminReceipt` contract (reuse validator from `libraryAdminClient.ts`), allowed draftStatus, permitted transitions, and 13-key bridge DTO including `UNKNOWN/null` vs `NOT_CREATED/false`. Reject extra keys, private fields/URLs, and malformed/server-failure results; fixed safe UI errors.
- No automatic retries, no browser persistence of raw receipt/identity, no AI or publication writes.

**5.2 Existing `AdminLibraryManagement.tsx`**:
- Reuse existing receipts inbox section and `LibraryQuarantineReceiptsInboxController`; keep current upload modal, receipt list, receipt row test IDs, search/filter and all unrelated management. **Do not create a second receipts panel.** Add draft status in the same desktop table + mobile cards; one intentional action per eligible row: **Prepare review draft**; review status for already-linked entries, and hold notices for `NeedsReconciliation`.
- Maintain **old receipt-only view** as genuine fallback when new workbench server action is unavailable; status shows “Review link status unavailable” (not `NOT_LINKED`), and action disabled. UI should not pretend the new backend is deployed. Use controlled UI enable flag `VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED === 'true'` (default disabled); when disabled do not call the new endpoint. Preserve old live receipts display. No new env file or config edit; only read current `import.meta.env` in the client.
- On eligible manual click, disable concurrent click for same receipt and while operation pending; result `CREATED` or `IDEMPOTENT_EXISTING` => refresh once manually, `UNKNOWN` => clear explicit uncertainty notice and stop, never immediately retry. On account change/signout/unmount discard stale responses. Post-action status must come from **fresh server read**; never synthesize a persisted `PENDING_HUMAN_REVIEW` value from click response.
- AR/EN localized inline strings (or existing translation mechanism without modifying unrelated locales); RTL/LTR, mobile cards, tablet/desktop table, dark/light text contrast, accessible disabled reason, no duplicate refresh controls. Do not expose raw GCS bytes/links or promise in-browser preview. Do not claim review approval exists.

## 6 — Verification (one functional acceptance gate)

Run and report exact counts/exits:
1. `npx --no-install tsx scripts/runLibraryQuarantineReviewWorkbenchBackendTests.ts` (backend read composition + auth action gating + genuine 01C bridge integration under mocked trustworthy SDK auth, mocked GCS and Firestore; no service-fake-only test for success).
2. `npx --no-install tsx scripts/runLibraryQuarantineReviewWorkbenchClientTests.ts` (payloads, DTO validator, `UNKNOWN`, stale session, duplicate click, responsive/UI wiring static or test renderer if available; no new packages).
3. Existing `npx --no-install tsx scripts/runLibraryQuarantineAdminReadTests.ts`, `...ReviewDraftPersistenceTests.ts`, `...ReviewDraftCallableBridgeTests.ts`; existing library upload/inbox client tests if script names are discoverable locally (do not invent commands, document exact).
4. Isolated strict `tsc --noEmit` for affected TypeScript files; `npm run build`; `npm run lint`; `git diff --check` **only if real `.git` exists**; manual Studio GitHub Sync scope inspection.
5. Manual visual checklist from owner: AR/EN, desktop 1440px / tablet 768px / mobile 390px, light/dark, one inbox, upload preserved, reviewer-only action, error/empty/uncertain and logout transitions. Studio test harness is **not** evidence that Firebase was deployed or that real reviewer approval occurred.
6. SHA after write on the 2 modified + 4 new files; all baseline protected SHA matches; GitHub Sync expectation **4 Added code / 2 Modified code / 0 Deleted code**, plus retained spec separate; no unintended `New/Deleted` or lockfile change.

## 7 — STOP & release decision

STOP immediately before writing if pinned Studio-local modified baseline diverges from GitHub and cannot be reconciled byte-for-byte, any new code path already exists in Studio, wrong API/props/DTO contract, existing unpushed 01D code is present, or work would demand changing any file outside allowlist. STOP after testing if tests fail; report exact blocker, do not widen scope automatically.

**No Push in Studio, no Firebase CLI, no new GitHub Action or environment change.** Since existing `manageLibraryDocuments` is already exported and its code is changing, inspect release consequences before the owner pushes; **a Push is not blanket authorization for Firebase deployment**. If GitHub Actions would auto-deploy the changed function, obtain explicit owner approval for that release or keep deployment gated. Server/client workbench functionality stays disabled until the owner chooses release. Verified source/visual acceptance and production deployment are separate gates.

**Required end state:** `LIB_FILE_WORKBENCH_01_IMPLEMENTED_PENDING_SOURCE_VISUAL_AND_SYNC_REVIEW` (or `STOP_REQUIRES_DESIGN_DECISION`). One unit; do not propose 01D/01E microsteps afterward.
