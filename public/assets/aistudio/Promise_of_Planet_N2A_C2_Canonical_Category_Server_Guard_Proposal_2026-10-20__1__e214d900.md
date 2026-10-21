# Promise of Planet — N2-A / C2: Canonical News Category Integrity

**Document type:** engineering proposal (non-binding; keep outside AI Studio/repository)  
**Date:** 2026-10-20  
**Repository:** `rexat007/promise-of-planet`  
**GitHub reference:** `afe25dd74068ae016bba7c11303f948ff146c34e`  
**Status:** C1 accepted by owner; C2 proposed and unimplemented; Push and Deploy prohibited.

## 1. Background and source evidence

The admin editor now uses the seven canonical environmental category keys and explicitly preserves old category strings for existing drafts. The publicly uploaded baseline still exposes several historical risks:

- `src/services/newsAdminClient.ts` contains a new-draft fallback `payload.category = payload.category || 'Climate'` in the uploaded baseline. Verify whether this persists in the unpushed local version before writing.
- `functions/src/news/newsValidator.ts` historically validates Arabic title/author but not canonical category.
- `functions/src/news/newsApplicationService.ts` constructs new drafts, updates existing drafts, and performs workflow transitions. No canonical-category guard appears in the uploaded baseline.
- `functions/src/shared/contentContract.ts` declares `CANONICAL_CATEGORIES` and `isCanonicalCategory`; this is the sole allowed truth source.
- Test fixtures in `src/services/newsFunctionalTests.ts` include old category strings even for synthetic newly-created drafts. Such fixtures must use canonical keys when testing new draft creation, while separate historical fixtures deliberately exercise legacy compatibility.

Pinned baseline references, for comparison only (never restore local source from them):

1. https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/services/newsAdminClient.ts
2. https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/functions/src/news/newsValidator.ts
3. https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/functions/src/news/newsApplicationService.ts
4. https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/services/newsFunctionalTests.ts
5. https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/functions/src/shared/contentContract.ts

**GitHub** is authoritative for uploaded code. **AI Studio workspace** is authoritative for its still-unpushed local implementation. Direct HTTPS references are historical and not automatic retrieval instructions.

## 2. Decision and strict scope

- Exactly seven canonical keys: `Climate`, `Water`, `Biodiversity`, `Pollution`, `Energy`, `Agriculture`, `EnvironmentalPolicy`.
- Newly created drafts must have an explicitly supplied canonical key. No client/backend default to Climate.
- Existing historical drafts with noncanonical category values remain readable and editable without changing their existing value, provided the value is omitted or remains **exactly equal** to the stored original value.
- Any attempted change to an invalid/new legacy value is rejected. A historical draft may be deliberately reclassified to one of the seven canonical keys, without any invented migration.
- Historical drafts must not advance to `InReview`, `Approved`, or `Published` while their category is noncanonical. Rejection must happen before any repository save, publication timestamp or audit-history mutation. Remedial transitions (`InReview → ChangesRequested`, `ChangesRequested → Draft`) must remain available when otherwise authorized.
- Previously published legacy records remain untouched. C3 will remove fallback-to-Climate projection separately.
- Preserve Draft-only edit rules, RBAC, bilingual editorial data, rich-text content, human approval and existing image fields.

## 3. Source write allowlist (4 existing files)

| Target | Expected unpushed local Git blob SHA-1 | Role |
|---|---|---|
| `src/services/newsAdminClient.ts` | `f872afdc704fee1b1bcb2c7dce5eae0ca3c6a893` | Remove implicit new-draft Climate category fallback only if still present |
| `functions/src/news/newsValidator.ts` | `b16a96dc6d0f148ca84461552c27cc4127ebb2c3` | Add narrowly scoped canonical validation using existing shared guard |
| `functions/src/news/newsApplicationService.ts` | `19f8db331ea869d912075cdb94cc8cbae43cbb77` | Enforce creation/update/forward-transition behavior |
| `src/services/newsFunctionalTests.ts` | `9f42782a31a35907ed8c053ec8896f9ad84a2550` | Add isolated `REQ-17`; minimally adjust synthetic new-creation fixtures to canonical categories |

Preflight: verify all four local SHAs, existing REQ-01..16, `src/types.ts` and `functions/src/shared/contentContract.ts` (expected latter `d356422d026b59631423662e0967d68e0a219af2`). STOP on mismatch, unexpected callers, or dependencies outside allowlist.

## 4. Technical contract

- Use `isCanonicalCategory` from the shared contract, not a copied union or localized display label comparison.
- On `createDraft`, reject missing, whitespace, translated, unknown, or otherwise noncanonical category inputs prior to `repo.save`.
- On `updateDraft`, after loading existing record and verifying Draft state, compute proposed category: if missing retain existing, if explicit use supplied raw value. Accept only if canonical **or** the exact original legacy category is retained on an already existing historical Draft. Reject new unknown values, including explicit blanks. No trim/coercion/mapping on persisted values.
- On `transitionWorkflow`, after existing authorized transition validation, require canonical category before transitioning to `InReview`, `Approved`, or `Published`. Keep remediation transitions available. Do not change permissions.
- Avoid a new broad `validateNewsPayload` rule that accidentally blocks harmless edits of historical drafts.
- In test fixtures, replace noncanonical category strings *only for simulated newly created news*, keeping assertions intact; seed historical records in memory directly to verify nonmigration.
- One new `REQ-17` verifies rejection of invalid new categories, explicit canonical-only creation, exact historical preservation, rejection of attempted invalid reassignment, successful explicit reclassification, all prohibited forward workflow transitions for legacy values, absence of repository writes on invalid operations, and unchanged metadata/history/state.
- Check that `REQ-01..16` still pass; existing new-draft fixture categories may require minimum-value changes, never broad assertion rewrites.

## 5. Out of scope

Public DTO category normalization C3; category migration; media upload and cover images; news UI changes; changes to workflow authorization; Firestore or Storage rules; Firebase deployment; Push; Git commands; builds generating artifacts; new specs/reports in Studio; directory cleanup; non-allowlisted changes.

## 6. Test and acceptance

1. Run existing safety-gated isolated functional suite (expected `17/17 PASS`, zero network/Firebase writes).
2. Run local no-emit TypeScript checks for frontend and functions, and state that the functional test file is excluded from app tsconfig.
3. Compute post-edit Git blob SHAs for only the four allowed files.
4. Confirm protected dependencies and N2-A UI SHA are untouched.
5. Expected GitHub Sync remains **15 Modified, 0 Added, 0 Deleted**, subject to owner screenshot. No owner content may be silently changed.
6. No Push or Deploy. Owner reviews report and decides acceptance of C2 before C3.

**Implementation note:** The associated execution prompt is standalone and must be pasted as plain text. Do not attach this Markdown document to AI Studio: attachments have repeatedly been materialized into `public/assets/aistudio/` and changed GitHub Sync.
