# Promise of Planet — LIB-FILE-UPLOAD-02
## Minimal Admin Library Quarantine Upload UI / Transport Integration

**Mode:** restricted four-file change. **Status:** specification; not implementation or approval. **Date:** 2026-11-07.

### Source authority

Repository: `rexat007/promise-of-planet`.
Pinned baseline: `e3559b9f2ab8bbd0329a4dd505b9a663486b5f4f`.
Google AI Studio's working tree is authoritative for any unpushed changes; GitHub `main` is authoritative for pushed code. Studio must verify the listed local Git blob SHA-1 values before editing. This instruction never assumes Studio can fetch a GitHub file by path or run Git.

Read-only source identities:

- `src/components/library/AdminLibraryManagement.tsx`: `3b2f6661e978325c47cdd5f08fc3f7fc8406716c` (edit allowlist).
- `src/services/firebase.ts`: `99950b76657d051f4500b3da91c289743d354496` (read-only).
- `functions/src/library/libraryQuarantineUploadEndpoint.ts`: `0d9b75fa86054d64e2bfa7423c05edbcd4eaa091` (read-only).
- `functions/src/library/libraryQuarantineReceiptContract.ts`: `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` (read-only).
- `src/services/libraryAdminClient.ts`: `645b1755e4f18b09c377f50eb7822bbe48715889` (read-only).

New files must be absent:

1. `src/services/libraryQuarantineUploadClient.ts`
2. `src/components/library/LibraryQuarantineUploadPanel.tsx`
3. `src/components/library/LibraryQuarantineUploadIntegration.test.tsx`

### Why a distinct panel?

The existing `LibraryIntakeRecord` requires an external HTTPS URL, and the existing `submitIntake` flow stores reference metadata. A successful **private-quarantine upload** must not masquerade as a library document or an externally linked intake record. The new panel sits **inside the existing Intake Inbox** (`activeTab === 'intake'`), near `إيداع مرجع خارجي للاستقبال` but separately labelled `رفع مستند إلى الحجر الخاص` / `Upload document to private quarantine`.

The existing external-link workflow, the list and counts of `intakeRecords`, documents, PEIA, and review actions remain unchanged. The new panel displays **only the current session's sanitized receipt result**; it must not pretend to load an archive from Firestore (no listing endpoint exists yet).

### Frontend transport authority

Server endpoint is `libraryQuarantineUploadEndpoint` (`onRequest`, **not callable**). It accepts `POST` raw PDF/DOCX bytes, a single Firebase ID Bearer token obtained at click time via `auth.currentUser.getIdToken()`, canonical Content-Type and metadata headers (`X-Original-Filename` or `X-Library-Upload-Metadata`). It rejects JSON, multipart, query parameters and caller-supplied receipt IDs, object paths, bucket names, generation, SHA-256 and inspection overrides. The payload ceiling is **15,000,000 bytes (decimal)**.

The browser must never write directly to Cloud Storage or Firestore; only `fetch()` to the known HTTPS Function URL. Do not manually set `Content-Length` (browser-managed/forbidden); do not use `FormData`, `httpsCallable` or file base64. Never include access tokens in URL query strings, client logs, or local persistence.

**Hard gate:** The backend function was **not deployed** by this unit. Do not synthesize the URL from project ID or region and do not assume it is deployed. Require an explicitly configured `VITE_LIBRARY_QUARANTINE_UPLOAD_ENDPOINT_URL` and `VITE_LIBRARY_QUARANTINE_UPLOAD_ENABLED === 'true'` (or existing equivalent config if found and proven). Default to disabled / unavailable. Any configured URL must be strictly HTTPS and belong to the project's verified Functions deployment endpoint origin, not arbitrary third-party or user-provided URLs; if the exact origin has not yet been verified, keep upload disabled and report `ENDPOINT_ORIGIN_UNVERIFIED` rather than inventing it; this does not block building the disabled UI and client contract. Browser can show the panel and disabled upload CTA with a short explanatory notice before runtime enablement.

### Authentication, permissions, and data minimization

UI gating mirrors backend: `currentUser.isActive`, human role (not `AdminRole.AIAssistant`), `hasDomainResponsibility(role, AdminDomain.Library)`, and `AdminAccessService.hasPermission` for Create or Edit. The backend remains the only authority. The selected file's bytes and token must never be stored in React state beyond the current operation, in storage, or in logs. Show filename, size, receipt ID, state, and explicit private-quarantine warning only.

### Client request/response

- Validate file selected, extension `.pdf` or `.docx` (case-insensitive), size `>0 && <=15_000_000`; MIME if available must agree with filename; authoritative revalidation is server-side.
- Send one raw File/Blob as POST body, `Authorization: Bearer <fresh Firebase ID token>`, correct `Content-Type`, `X-Original-Filename` safely encoded, and no extra file/metadata fields.
- Strict response DTO validation, including `ok`, `status`, `receiptId` format, correct matching `adminReceipt.receiptId`, state, flags false, no unexpected sensitive fields. HTTP 201 alone is not success. Require `ok === true`, `status === 'QUARANTINED'`, `adminReceipt.state === 'Quarantined'`, `hasVerifiedStorageWrite === true`.
- On 503 `NEEDS_RECONCILIATION` or `PERSISTENCE_UNCERTAIN`, preserve any returned receipt ID, display unresolved state, **no automatic retry**. On timeout/network failure without a receipt, show `نتيجة الرفع غير مؤكدة` / `Upload outcome uncertain`; do not mislabel as rejected. Closing a modal after submit must not imply server cancellation.
- Rejected/invalid file errors must not dump raw server messages that might include internal fields. Response must not expose `storagePath`, `generation`, `bucket`, signed/public URLs, credentials, tokens, or raw attestations. Do not set `isReadyForPeia`, rights-approved, sanitized or published to true.

### UI requirements

- One entry point near external intake reference action; don't clutter other tabs.
- Arabic/English texts, proper RTL/LTR, responsiveness (mobile / tablet / desktop), accessible file input, disabled while in flight, unique CTA, clear state for configuration unavailable.
- No fake progress percentages, fake success or fabricated records.
- Session-safe behavior on file change, modal close and navigation; preserve last uncertain result until acknowledged, or explicitly warn before clearing.
- This new private receipt is **not** automatically entered in `LibraryIntakeRecord`, the public library, PEIA or the document metadata workflow.

### Tests and verification

Create one focused integration suite covering both client and panel with injected network/auth mocks and all gates. Test role access, enabled/disabled endpoint, PDF/DOCX and size, binary/no multipart, token freshness, successful readback contract, 503 uncertainty with and without ID, double-click prevention, stale response after close/switch, zero Firebase writes, no retry, no secret leaks, RTL/LTR render and mobile layout. Existing Library PEIA and intake tests must remain unaffected. Run focused suite, `compile_applet`, `lint_applet`. No dependency installation/config modifications.

### Allowlist

**Modify:** `src/components/library/AdminLibraryManagement.tsx` only.

**Create:** `src/services/libraryQuarantineUploadClient.ts`, `src/components/library/LibraryQuarantineUploadPanel.tsx`, `src/components/library/LibraryQuarantineUploadIntegration.test.tsx`.

**Prohibit:** changes to backend, contract models, `functions/src/index.ts`, storage rules, IAM, workflows, donations, PEIA, translation, application environment files, package files or lockfiles, Firebase deployment, real uploads, Push.

### Owner acceptance gates

1. Google AI Studio report includes exact pre/post SHA-1 and GitHub Sync file list; no unexpected scope changes or deletions.
2. Unit tests / build / lint pass.
3. Visual review: Arabic and English, desktop and mobile, authorized/unauthorized states, explicit disabled state before deployment.
4. Owner explicitly approves Push; push is manual.
5. Only after subsequent backend runtime compatibility and service-account IAM verification may a distinct deployment and live upload be considered.
