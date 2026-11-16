# Promise of Planet — LIB-DIRECT-FILE-01
## Publish **the uploaded PDF/DOCX file itself** and provide direct visitor download

**Repository:** `rexat007/promise-of-planet`  
**Immutable GitHub baseline:** `3e255bbc28c96de7679aa1dca6d93880cba4abce`  
**Environment:** Google AI Studio executes; owner reviews; owner manually Pushes; Firebase deploy via approved GitHub Actions only.  
**Single acceptance criterion:** A real already-uploaded PDF or DOCX, once explicitly approved and safe for release, appears in the public library and the visitor clicks **«تحميل PDF» / «تحميل Word»**, receiving the uploaded file bytes as a browser attachment. **No external publisher URL is requested, looked up or used for this workflow.**

### 0 — Current verified baseline and source-grounded diagnosis

1. Existing upload persists bytes in the private dedicated bucket `promiseofplanet-bb325-library-quarantine`, with a receipt ID, SHA-256, and storage generation. Supported formats are PDF and DOCX (not legacy `.doc`), maximum size 15,000,000 bytes.
2. `PublicLibraryHub.tsx` currently uses `versions[].referenceUrl`, an external/link-oriented path, not a binary download gateway.
3. `functions/src/library/libraryQuarantineAvWorker.ts` implements generation-pinned ClamAV and stores `AV_NO_THREAT_DETECTED`, but AV live execution was intentionally disabled. Its constant `isVerifiedSafe:false` is **not** proof of safety or of content sanitization.
4. `qcat-<receipt>` is a private Draft, excluded from `getPublicLibrary` and generic publishing. Never remove that exclusion. Existing reviewed-source `doc-qsrc-` is an **independent external-link feature**; preserve it unchanged.
5. The existing rights decision is scoped **`CATALOG_METADATA_ONLY`**. Neither `METADATA_USE_CLEARED` nor old `RESTRICTED` constitutes a grant to distribute the PDF/DOCX binary.
6. Existing incident: uploaded report `Climate change and Agriculture Sector in Sudan my report.pdf`, receipt `1183ac250d0404e921d2aeadbec1b76c`, qcat `qcat-1183ac250d0404e921d2aeadbec1b76c`, saved human case v6, aligned catalog, recorded inspection request `RECORDED_NOT_DISPATCHED`. **Do not re-upload, recreate, realign, or falsify scanning.**

### 1 — Source preflight and STOP contract

Studio has **no assumed GitHub/Git CLI access**. Confirm local source against GitHub `main` at baseline (manually if necessary) and verify each existing file by exact Git blob SHA-1 (`SHA1("blob " + byteLength + "\\0" + bytes)`). For remote fetching, use each **full HTTPS raw URL** below; require HTTP 200, non-HTML actual body, and matching hash before writing. If local content and pinned baseline do not match, or an essential source cannot be read and verified, **STOP_WITH_EVIDENCE**. Never reconstruct a missing file from its filename or assume that GitHub Sync downloaded it.

#### Exclusive write allowlist (existing files)

| Path | Baseline Git blob SHA-1 | Direct HTTPS raw URL |
|---|---|---|
| `functions/src/library/libraryAdminHandlers.ts` | `579a63009d6e9e08b5207e54702fec95426be245` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryAdminHandlers.ts |
| `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/index.ts |
| `src/components/library/LibraryQuarantineHumanReviewModal.tsx` | `dcc2e2be758a8849d606b348550643f1c3568061` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/src/components/library/LibraryQuarantineHumanReviewModal.tsx |
| `src/components/library/PublicLibraryHub.tsx` | `43fbd859178c7dd58be1f9b94e6208257c20a439` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/src/components/library/PublicLibraryHub.tsx |
| `scripts/runPublicLibraryFunctionalTests.ts` | `680ff57312c4c3ed409d963b4f1332411fece24e` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/scripts/runPublicLibraryFunctionalTests.ts |
| `.github/workflows/library-human-review-one-shot-live.yml` | `28a942caf42209221328cd4763543637f8a6e6c1` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/.github/workflows/library-human-review-one-shot-live.yml |

#### Exclusive write allowlist (new files; must not exist at pinned baseline)

- `functions/src/library/libraryPublishedBinaryReleaseService.ts`
- `functions/src/library/libraryPublishedBinaryDownloadEndpoint.ts`
- `src/services/libraryPublishedBinaryClient.ts`

**Expected exact inventory:** `MODIFIED=6, CREATED=3, DELETED=0`, provided preflight confirms no unpushed Studio modifications; otherwise STOP and report. No other files may be created, removed, renamed, or changed.

#### Required read-only reference files — exact verified source

| Path | Baseline blob SHA-1 | Direct HTTPS raw URL |
|---|---|---|
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineReceiptContract.ts |
| `functions/src/library/libraryQuarantineAvExecutionService.ts` | `fb7d89d01235f19f69980feed10f7599114f6d74` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineAvExecutionService.ts |
| `functions/src/library/libraryQuarantineAvExecutionContract.ts` | `e909ad973da54d6c327892a259e0f0957dbc9582` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineAvExecutionContract.ts |
| `functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts` | `e7acac996e3476ef7925a47f7427257a84a8b874` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts |
| `functions/src/library/libraryQuarantineRightsDecisionContract.ts` | `b96652303ae516c2ba01f7f9d52e3c8875860f1f` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineRightsDecisionContract.ts |
| `functions/src/library/libraryQuarantineCatalogHandoffService.ts` | `79e80cb3b9917ea9c0d3e15e23d5452235751b59` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineCatalogHandoffService.ts |
| `functions/src/library/libraryQuarantineUploadEndpoint.ts` | `c400d40606d9d124c377ab3e0c536278d3fb61bc` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineUploadEndpoint.ts |
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` | `4bca554dd00a5e2efc739cc166175cc63327c5ad` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/gcsLibraryQuarantineStorageAdapter.ts |
| `functions/src/library/libraryUploadDeepStructure.ts` | `7e6ba463502bc8d6c796378d6b381cdaaf01c60e` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryUploadDeepStructure.ts |
| `functions/src/library/publicLibraryRepository.ts` | `c813162307663b6fe37dc84cba9c591193f34f33` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/publicLibraryRepository.ts |
| `functions/src/shared/libraryContract.ts` | `cfb0849c0418ba7b075f7de49c3debe668adc724` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/shared/libraryContract.ts |
| `functions/src/library/libraryQuarantineAvWorker.ts` | `bf307a601f6860087a7bcbfbd87b809b284afb65` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/functions/src/library/libraryQuarantineAvWorker.ts |
| `src/services/publicLibraryClient.ts` | `0dd96c49d7e9e78a388351bc0cbb19034e98a626` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/src/services/publicLibraryClient.ts |
| `firebase.json` | `4710b1ca748bba72ca4a8a1ad93ca49332a061a9` | https://raw.githubusercontent.com/rexat007/promise-of-planet/3e255bbc28c96de7679aa1dca6d93880cba4abce/firebase.json |

### 2 — Product behavior (NON-NEGOTIABLE)

- **Upload**: reuse existing private PDF/DOCX intake, receipt, SHA-256, review, and aligned catalog. New uploads use the same flow. Never require a URL field.
- **Release**: in the existing admin review modal, add exactly one compact card labeled **«نشر الملف المرفوع للتحميل»**. Show current receipt/case/scan status, public release rights attestation ("I own the binary distribution rights" or "I have explicit permission"), citation/evidence text, and one confirmation button. Do not repeat upload, review, alignment or the external-source-link form. Never publish automatically without a human action.
- **Rights**: the previous `CATALOG_METADATA_ONLY` decision is insufficient; implement a separate explicit authenticated human **binary redistribution authorization** and immutable audit evidence, not a reinterpretation of `METADATA_USE_CLEARED`. If an older RESTRICTED decision is present, a human must explicitly resolve the contradiction with an attributable new binary-rights grant and verifiable evidence; never silently overwrite any prior rights record. Do not infer ownership from the filename or login alone.
- **Safety**: read the actual isolated AV execution terminal result for the **same receipt, SHA-256, GCS generation, and human-review revision**; require `AV_NO_THREAT_DETECTED`, not merely `RECORDED_NOT_DISPATCHED`. No download if scan is unperformed, failed, stale, malicious or uncertain. Do not change existing `isSanitized:false`/`isVerifiedSafe:false` immutable flags or claim ClamAV equals sanitization. Enforce format-specific admission: DOCX deep structure checks; PDF remains clearly marked as original, not sanitized, and is always `Content-Disposition: attachment`, never inline rendered by the platform. If the existing security policy requires an isolated PDF parser before release, **STOP WITH THAT SPECIFIC UNMET PRECONDITION** rather than weakening the policy.
- **Storage promotion**: do not expose bytes or object URLs from `library/quarantine/...`. Verify source object by generation-pinned read and SHA-256. Produce an immutable, no-token, **private released copy** under a separate `library/released/<receiptId>/...` namespace (same dedicated private bucket only if its access policy and safety separation are verified; otherwise STOP with explicit provisioning requirement). Use `ifGenerationMatch:0`/CAS, verify the released bytes/hash/generation after writing. A failed Firestore transaction may leave a private orphan, never public. Never make the bucket publicly readable or attach Firebase download tokens.
- **Public record**: in one CAS-protected Firestore transaction, write `library_documents/doc-qbin-<receiptId>` with `workflowState=Published`, accurately supported rights status (`PermissionGranted` or `OpenPubliclyAvailable` only upon human authorization), and one approved `versions[].referenceUrl` **constructed by the server** pointing ONLY to our owned HTTPS function `libraryPublishedBinaryDownload?documentId=doc-qbin-...`. Also write private immutable release manifest + audit event. Preserve `qcat-...` Draft, source bytes and existing `doc-qsrc-...` records. Handle idempotency and unknown commit outcome truthfully; no duplicate release.
- **Public download**: `libraryPublishedBinaryDownload` is a new Gen 2 `onRequest` **GET/HEAD** endpoint; anonymous visitors may request only an existing valid published `doc-qbin-...` record with a matching immutable release manifest, current rights and immutable published object identity. Deny all other IDs, draft/revoked/conflicted records, stale rights and any path parameters. Use generation-pinned GCS streaming of **released copy only**; bound size <= 15,000,000 bytes and set correct `Content-Type`, `Content-Length`, safe UTF-8 filename in `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, no public object URL, no signed GCS link, no redirect, no inline preview. Errors 404/403/503 fail closed with no private metadata.
- **Visitor UI**: for `doc-qbin-...`, replace generic **«فتح أو تحميل الوثيقة الأصلية»** with a prominent **«تحميل PDF» / «تحميل Word»** direct-download link to the owned endpoint. Preserve external-source UX separately for `doc-qsrc-...` and other external references. Layout clean in Arabic RTL and English LTR; mobile and desktop. Keep the current public `qcat-` exclusion.

### 3 — Runtime and deployment integration (same unit, not a later UI-only patch)

- Extend `functions/src/index.ts` export for the new `onRequest` endpoint.
- Extend the existing callable handler (`libraryAdminHandlers.ts`) with strict GET readiness / human Publish actions; RBAC active human Editor/Owner with `Review`, `ManageRights`, `Approve`, `Publish` as required; strict input allowlist; trust server-side user; no client authorizing storage objects.
- Modify the **existing** `.github/workflows/library-human-review-one-shot-live.yml` so CI builds the new function, runs new binary publication/download test coverage, deploys `functions:libraryPublishedBinaryDownload` with the existing `manageLibraryDocuments`, `getPublicLibrary`, and Hosting, and verifies post-deploy `GEN_2`, `ACTIVE`, region, expected flags and endpoint existence. Preserve `POP_LIBRARY_AV_EXECUTION_ENABLED=false` unless the separately approved ClamAV worker runtime has been verifiably commissioned; do not silently turn it on. Do not introduce separate Firebase CLI deployment in Studio.
- If the existing worker has not run, the UI must honestly say `WAITING_FOR_ACTUAL_SCAN` and have no enabled Publish; **this cannot be represented as successful public file publication**. Report the precise prerequisite and how the existing `library-quarantine-av-job.yml` (`verify_only` / controlled `deploy`) must be used, including required IAM/bucket configuration. No unapproved Cloud changes.
- No change to `firebase.json`, storage rules, external-source release service, PEIA, donations, GIS, or unrelated routes.

### 4 — Tests and report: finish the outcome, not merely the code

In the existing allowed `scripts/runPublicLibraryFunctionalTests.ts`, add deterministic in-memory `GCS`/Firestore injection tests exercising the actual new release and HTTP handler. Test at least:

1. Existing receipt and case v6 re-used; **no new upload** and no altered qcat draft.
2. Real deterministic PDF bytes and DOCX bytes: checksum, immutable promotion, download byte-for-byte equality and `Content-Disposition: attachment`; no external publisher URL anywhere in the new flow.
3. Download is successful for an anonymous visitor only for published released copies, and correct PDF/DOCX filename and MIME.
4. No download before human rights authorization, before genuine matching AV result, or for a stale/mismatched generation, revision, SHA or negative scan.
5. `RESTRICTED` existing decision cannot be silently reclassified; explicit documented signed binary grant/override is required if appropriate.
6. Duplicate clicks and concurrent publication are idempotent; zero duplicate public records; partial copy or uncertain transaction remains non-public.
7. Unauthorized, AI and nonexistent users cannot release; `qcat` IDs and external-source IDs cannot download files; published public DTO never includes GCS/private paths/tokens.
8. Invalid filenames, malicious control bytes, unsupported `.doc`, dangerous GCS metadata, bad HTTP verbs, download attempts after revocation/permission changes, and content size limits are denied.
9. Public hub shows **«تحميل PDF»/«تحميل Word»** on both Arabic/English and works on mobile/desktop without a popup/redirect to publisher.
10. All original 26 Public Library tests and all 15 other library preflight suites still pass; `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm --prefix functions run build` as available. Distinguish test passes vs unavailable Functions dependencies; CI must run the full Functions build.

**Operational acceptance is separate from unit tests:** after GitHub user Push and approved GitHub Actions deployment, inspect actual existing receipt; if matching scan+rights conditions truly met, publish once, visit the public library in logged-out browser, and download the existing PDF with byte checksum and correct filename. The user is the sole person who decides acceptance. No fake artifacts, fake successful scan, fake document URL, or claim of live publication without evidence.

### 5 — Prohibited and STOP conditions

No mass moves, `rm -rf`, deletions, Git CLI or Push in Studio, Firebase CLI deploy in Studio, dependency installation, direct bucket public IAM, unreviewed publishing, changing `isVerifiedSafe`/`isSanitized` to true, auto-upgrading RESTRICTED rights, silent AV bypass, external publisher URL fallbacks, or testing with fabricated production data. If an essential step requires a file not in allowlist, a different hosted deployment resource, missing signed runtime identity or new cloud IAM permissions: **STOP_WITH_EVIDENCE** before writing outside scope. Report EXACT missing file/resource/permission; do not implement an unrelated workaround.

Final Studio report must include verified preflight SHA table, scope (`MODIFIED=6, CREATED=3, DELETED=0`), post-edit SHA table, end-to-end upload→review→release→download state diagram and audit/CAS invariants, tests with actual exit codes, CI/deploy prerequisites and explicit distinction between `IMPLEMENTED_PENDING_SOURCE_REVIEW` and genuinely deployed/accepted.

**Result code:** `LIB_DIRECT_FILE_01_IMPLEMENTED_PENDING_SOURCE_REVIEW` or `STOP_WITH_EVIDENCE`.
