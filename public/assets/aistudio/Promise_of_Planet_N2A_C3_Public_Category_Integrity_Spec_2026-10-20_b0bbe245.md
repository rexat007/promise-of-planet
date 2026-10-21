# Promise of Planet — N2-A / C3 Public Category Integrity

**Status:** proposal for one bounded Google AI Studio implementation; not executed/accepted.  
**Repository:** `rexat007/promise-of-planet`  
**GitHub main baseline:** `afe25dd74068ae016bba7c11303f948ff146c34e` (historical; Studio local is authoritative for unpushed files).  
**Prior work:** C1 accepted by owner; C2 functional tests REQ-01..17 PASS, Functions typecheck blocked by absent backend dependencies in Studio. No Push/Deploy.

## Purpose

Stop the current public adapter's heuristic classification and dangerous unknown-category → `Climate` fallback. Enforce the seven canonical category keys consistently in both public list/detail server projection and frontend list/filter/card labels. Keep real historical records unchanged; no database writes, no retroactive migration, no guesswork.

## Source findings

- `functions/src/shared/contentContract.ts`: `isCanonicalCategory`, `CANONICAL_CATEGORY_DEFINITIONS`; these are the single authority for canonical keys and bilingual labels.
- `src/services/newsDomainAdapter.ts`: `normalizeCategory()` currently guesses using Arabic/English fragments and falls back to `Climate`; it is called from `toCanonicalNews()`, `sanitizeForPublic()`, and `publicDtoToCanonicalNews()`.
- `src/services/publicNewsClient.ts`: public category filter also calls `normalizeCategory`, exposing the same fallback bug for unknown filter values.
- `functions/src/news/publicNewsRepository.ts`: currently projects raw `category: item.category` for published records in both `listPublicNews()` and `getPublicNewsById()`.
- `src/components/content/contentFormatters.ts`: `getCategoryLabel()` duplicates labels that differ from `CANONICAL_CATEGORY_DEFINITIONS`, although shared canonical category keys are already available.
- `src/components/news/PublicNewsHub.tsx`: filter buttons already use `CANONICAL_CATEGORY_DEFINITIONS` and exact equality, so **no UI modification** is required for category tabs.

## Scope and policy

**Strict write allowlist (5 files):**

1. `functions/src/news/publicNewsRepository.ts`
2. `src/services/newsDomainAdapter.ts`
3. `src/services/publicNewsClient.ts`
4. `src/components/content/contentFormatters.ts`
5. `src/services/newsFunctionalTests.ts`

All other files, including `PublicNewsHub.tsx`, `NewsCard.tsx`, `ContentCard.tsx`, C1/C2 implementations, contracts, workflow and Firebase rules, are read-only.

### Category rules

- A category is canonical only when `isCanonicalCategory(value)` is true. No substring matching, case correction, translation matching, auto-default, or normalization to another category.
- `normalizeCategory` returns `Category | null`, not a guessed value.
- For canonical model functions that must return `News`, an invalid category must raise a deterministic category-integrity error instead of forging a `News.category` key.
- `sanitizeForPublic()` returns `null` for non-Published items **and** for Published items whose category is not canonical. It does not mutate anything.
- Public server list projection includes only genuinely Published and canonical-category records; public get-by-ID returns `null` for noncanonical categories, even if historical workflow state is Published. Preserve existing privacy projections and bilingual eligibility.
- **Explicit visibility caveat:** already-Published historical items with noncanonical categories would be temporarily excluded from public reading until they undergo a separately authorized editorial correction. They remain in the underlying repository and authorized admin views. Do not call this deletion or successful migration. If Studio encounters evidence that this risks existing live published content, STOP and report rather than hiding silently. This policy requires owner review before release.
- A malformed DTO from a custom transport must fail closed with an integrity error, without mapping it to Climate or displaying fabricated category. Do not invent mock data.
- Invalid category filter requests must never fall back to Climate; return no matching records (or a deterministic validation error) without altering canonical valid query behavior. Choose one, use it consistently, and test it.
- `getCategoryLabel()` must read bilingual labels from shared `CANONICAL_CATEGORY_DEFINITIONS` rather than the old duplicate hardcoded mapping. Preserve unrelated formatters untouched.

## Mandatory exact local preflight (Git blob SHA-1)

| Path | Expected LOCAL SHA-1 |
|---|---|
| `functions/src/news/publicNewsRepository.ts` | `00358d3748874592181750e22f609c7cc9104ef2` |
| `src/services/newsDomainAdapter.ts` | `40b776c3ec0a2c61b90120c447691b659b47e8d5` |
| `src/services/publicNewsClient.ts` | `34516a8ff3f484e1a800cf5b8c06dcd19d2f409d` |
| `src/components/content/contentFormatters.ts` | `38c1cf37e5ff37032a335cd6fc09d25026bfe4c3` |
| `src/services/newsFunctionalTests.ts` | `26652fceff5bc8eafd96201011c59e06d2dff952` |

Protected prerequisites: `functions/src/shared/contentContract.ts` `d356422d026b59631423662e0967d68e0a219af2`; `src/components/news/PublicNewsHub.tsx` `2aae58d07583e206fd88375132cafc5a7c4601a9`; `src/components/content/NewsCard.tsx` `e10dc3bec85fa0862d655f9d08325db1a7a8f1d5`; `src/components/news/AdminNewsManagement.tsx` `8d06357fd78f423c9b200c987a3a1f88477418b8`; `src/services/newsAdminClient.ts` `dbffcd914e26b3618a71d40c97eb8a83d3202de2`; `functions/src/news/newsValidator.ts` `0e18d7ab6ee42aaf71ae3e9bc62fe2f83aa98e89`; `functions/src/news/newsApplicationService.ts` `dedebc1870df1e788032c48c0b587ff652ad0fd8`.

STOP before writing if expected SHAs or contracts differ, or a live `normalizeCategory` caller lies outside the allowlist and requires edits.

### Verified direct pinned historical URLs

These reference GitHub's prior uploaded state, not the unpushed Studio local content. A remote fetch is optional; if attempted, require HTTP 200, full body and SHA verification. Never use a filename alone to fetch GitHub content.

- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/functions/src/news/publicNewsRepository.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/services/newsDomainAdapter.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/services/publicNewsClient.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/components/content/contentFormatters.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/services/newsFunctionalTests.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/functions/src/shared/contentContract.ts

## Verification plan

- Add `REQ-18` only in existing `src/services/newsFunctionalTests.ts`; keep REQ-01..17 behavior and assertions intact.
- Test exact seven canonical categories both server public list and public get-by-ID, and every UI filter, bilingual labels.
- Test unknown historical category (including `الاستجابة والطوارئ البيئية`) does not map to Climate, does not appear in Climate filter, is not mutated, and is not exposed as a wrongly categorized public article.
- Confirm filtering one invalid published item leaves other eligible published items accessible; administrative record remains untouched.
- Test malformed DTO via isolated transport fails closed, and invalid requested filter never becomes Climate.
- Confirm title/kicker/journalisticType metadata, rich content, image, privacy exclusions, admin rights, workflow and no-mock behavior remain unchanged.
- Use only existing installed isolated test runner after Firebase safety gate (`isFirebaseConfigured === false`, `app === null`). Expected REQ-01..18, 18/18 PASS if compatible; do not modify tests outside the allowlist.
- Run `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` (no output artifacts). Existing Functions typecheck is **blocked** by absent `functions/node_modules`; do not install packages, change `functions/tsconfig.json`, or claim it passed.
- Report exact SHA before/after for all modified paths, fixed test counts, known skipped-public-category behavior and any errors. GitHub Sync remains owner-only to verify; current owner says 17 changes, do not assume the two extra files' identities until reviewing the actual list.

## Safety/stop

No .git assumption; no git operations; no installations, broad cleanup, generated reports, Markdown attachment in Studio, push or deploy; no Firebase live writes; no image feature; no modification of historic records; no UI redesign. STOP on missing prerequisites, new required paths, or uncertain category exposure handling. C3 is a bounded implementation, not closure of N2-A.
