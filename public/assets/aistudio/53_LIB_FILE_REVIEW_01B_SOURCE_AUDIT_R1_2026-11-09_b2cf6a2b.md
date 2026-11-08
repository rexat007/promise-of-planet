# Promise of Planet — LIB-FILE-REVIEW-01B Source Audit / R1 Decision

**Reviewed:** 2026-11-09 (Asia/Riyadh)  
**Repository:** `rexat007/promise-of-planet`  
**Pushed baseline (checked from GitHub):** `08501a44c5f68d9d414b090cfc8294c7d7889288`  
**Unit:** `LIB-FILE-REVIEW-01B`  
**Decision:** `SOURCE_REVIEWED / R1_CORRECTION_REQUIRED / NO_PUSH`.

## Proven source identity

Three uploaded Studio source files have CRLF newline endings. Normalizing CRLF to LF produces byte-for-byte Git Blob SHA-1 matches with the Studio implementation report:

| Studio file (relative repository path) | Normalized LF bytes | SHA-1 | Result |
|---|---:|---|---|
| `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` | 41,677 | `669327eb5338755ccca30d41c89b55bcf354c3fb` | MATCH |
| `functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts` | 42,256 | `f7aae9853a5f86bc62af653a3e923a2bee6ae6dc` | MATCH |
| `scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts` | 71,387 | `b9eacdbaea7233f150c42f36354175e6c16c2ee9` | MATCH |

GitHub `main` has none of these files at the stated baseline; no 01B Push was verified. Unit tests `7/7`, 01A `7/7`, inbox `7/7`, TypeScript, build, lint are **Studio-reported PASS**, not independently rerun as the real repository test environment.

## Confirmed functional strengths

- Source and draft document point-reads occur before a single Firestore transaction `create` and source envelope/revision/GCS generation are rechecked (store lines ~985–1197).
- GCS generation-pinned readback and nine attestation fields are checked before transaction (service ~983–1094).
- Existing exact draft is idempotently reused; corrupt/mismatched drafts fail closed; 15-field persisted record excludes GCS path, generation, URL and bytes.
- `Quarantined` does not mean sanitized, safe, rights-approved, published or ready for PEIA; those flags remain false. GCS→Firestore TOCTOU is accurately disclosed. No route/UI wiring observed.

## R1 blocking findings

### F-01 — Caller-controlled `auth.uid` is mistaken for authenticated identity

**Source:** Service input interface ~122–129; `ALLOWED_AUTH_CONTEXT_KEYS` ~189–192; `const rawUid = auth.uid` ~697; then `authorizeHumanLibraryReviewer(rawUid)` ~762. Service resolves an administrative record and permission but has **no verification that the supplied UID is the request's authenticated Firebase principal**. A supplied `auth.token` is inspected for AI flags but not cryptographically verified.

**Evidence:** A minimal isolated execution of the real TypeScript service transpiled to JS (with dependency fakes) supplied `{receiptId, auth:{uid:'admin_owner_01'}}` with no verified identity. A repository fake returning an active Owner allowed execution to proceed to the receipt point-read (`SOURCE_RECEIPT_NOT_FOUND_HOLD`), rather than stopping with `UNAUTHORIZED_REVIEWER_HOLD`. This is a **future wiring trust-boundary flaw**, not evidence of an exploitable public endpoint today: 01B is not wired to an endpoint.

**Required fix:** caller input is only `{receiptId}`. Introduce a required, server-only **request-scoped trusted principal provider** injected at construction/operation from authenticated server context (not `rawInput`). Resolve UID/claims from that provider, then use existing AdminRepository + permission checks. Do not wire an endpoint or invent an authentication bypass. Tests must reject forged `auth`/`uid`, including a Viewer claiming an Owner UID, before any storage access.

### F-02 — Dependency exception strings can be echoed in client-visible `errorMessage`

**Source:** `sanitizeServiceMessage` ~255–289; receipt read catch ~817–830; GCS catch ~991–1004; draft store catch ~1095–1113; store `sanitizeStoreDiagnosticText` ~323–358 and catch paths ~751–761/~1198–1212. Regex redaction of known path/token forms does **not** make arbitrary backend exception messages safe for a result DTO.

**Evidence:** Isolated execution of the actual service with a fake `receiptStore.getReceiptById` throwing `Error('INTERNAL_SECRET_MARKER_2026__NOT_FOR_CLIENT')` returned a HOLD whose public `errorMessage` contained that exact sentinel. This demonstrates a real exception-content echo in the service (not an assertion that any real user secret was exposed).

**Required fix:** Treat external dependency exception bodies as untrusted; use constant allowlisted user-safe messages + stable error codes for service/store failures. Do not interpolate raw SDK or storage exception strings, arbitrary keys or object contents into returned result messages. Add tests injecting arbitrary secret sentinels from admin repository, receipt store, GCS port, draft store and Firestore SDK; assert no serialization leakage.

### F-03 — `draftCreated:false` incorrectly asserts a known outcome on ambiguous post-commit failure

**Source:** `LibraryQuarantineReviewDraftPersistenceHold.draftCreated: false` ~159–178 and `makeHoldResult` hardcoded `draftCreated:false` ~292–320. Any store exception is mapped into a HOLD ~1095–1113. Test PASS 6 / scenario 6B (~1828–1865) deliberately throws after persistence commit and before response, then replays to get `IDEMPOTENT_EXISTING`.

**Impact:** The first reply claims `draftCreated: false` even though the draft **could already be durably created**. This conflates "not confirmed" with "did not happen" and can mislead operators or future UI/client retry logic. This is a **certainty/receipt contract** defect; idempotent replay is already implemented.

**Required fix:** For ambiguous transaction outcome return a type-safe `UNKNOWN`/null state (for example, explicit `draftCreationOutcome: 'NOT_CREATED'|'UNKNOWN'`; preserve accurate `draftCreated` semantics). Pre-write failures may assert `NOT_CREATED`, but post-transaction exception or failed post-validation may only claim `UNKNOWN` unless absence is proven. Update fault-injection test to assert ambiguous first receipt and idempotent replay.

## Allowed R1 correction boundary

**Only these three Studio-local 01B code files may be edited:**

1. `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts`
2. `functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts`
3. `scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts`

The ten preflight-protected prior files remain READ ONLY at their pinned SHA-1 values in `51_LIB_FILE_REVIEW_01B_DURABLE_LINK_SPEC_2026-11-08.md`. The retained 01B specification under `public/assets/aistudio/` is standard documentation, not a code change. No other file changes, no packages, no Git CLI in Studio, no Firebase deployment, no Push. If the trusted principal boundary truly requires changing an existing endpoint, handler, auth implementation, receipt schema, or SDK wiring, STOP for a separate design decision.

## Status

`LIB_FILE_REVIEW_01B_R1_CORRECTION_REQUIRED_BEFORE_PUSH`

After R1, review actual corrected source + GitHub Sync before owner push. Reported Studio tests do not substitute for source verification.
