# Promise of Planet — N2-A Categories C1: Editorial Selector Convergence

**Date:** 2026-10-20  
**Status:** Engineering proposal; NOT binding until owner-approved implementation in Google AI Studio.  
**Repository:** `rexat007/promise-of-planet`  
**Verified uploaded baseline:** `afe25dd74068ae016bba7c11303f948ff146c34e`.  
**Studio state:** 15 modified files, 0 added, 0 deleted per owner GitHub Sync screenshot. No Push/Deploy.

## 1. Problem and factual evidence

- `src/types/news.ts` defines an old five-item `NEWS_CATEGORIES` table using Arabic labels as values. The administrative editor imports and writes these strings into `NewsItem.category`.
- `functions/src/shared/contentContract.ts` defines seven canonical keys: `Climate`, `Water`, `Biodiversity`, `Pollution`, `Energy`, `Agriculture`, `EnvironmentalPolicy`, with localized labels in `CANONICAL_CATEGORY_DEFINITIONS` and guard `isCanonicalCategory`.
- Public news filters compare against canonical keys. `src/services/newsDomainAdapter.ts` currently maps unrecognized strings to `Climate`, silently falsifying categories. That hazard will be fixed in a *separate* fail-closed backend/domain unit; C1 must not claim full category convergence.
- Existing real Draft has category `الاستجابة والطوارئ البيئية` (legacy, not a canonical key). No forced migration, no automatic interpretation as Climate, no deletion or substitution. Owner decides its category explicitly.
- `src/components/content/contentFormatters.ts` has another presentation label table with different category wording. Review later; do not modify in C1.

## 2. C1 intended small scope

Authorized file edit allowlist (subject to local SHA and usage preflight):
1. `src/components/news/AdminNewsManagement.tsx`, current local blob SHA `a837d62f2b4d7dcc05f1260f30744e73670c7968`.
2. `src/types/news.ts`, current local blob SHA `c8020d34927a350e3a2a2bdf8d3797e88eb1a458`.

The old constant may only be removed when a read-only workspace search confirms no callers other than the admin component. If other callers exist, STOP and request a scoped redesign.

## 3. Target behavior

- Use the existing shared canonical `CANONICAL_CATEGORY_DEFINITIONS` and `isCanonicalCategory` from `src/types.ts`; do not duplicate the seven keys or labels.
- All administrative category choices and category filters use canonical `.value` keys, with `.labelAr` / `.labelEn` presentation; do not store display text.
- Newly created Draft starts with `category: ''`, requiring explicit category selection to save. Do not silently choose `Climate`.
- For an existing legacy category, preserve the raw value in edit state and on saving other fields. Show a clearly identified, nonselectable legacy value in the editor selector, rather than quietly displaying the first canonical option; require explicit selection before future publication in a separate backend/public guard unit.
- Show existing legacy categories truthfully in the admin list; do not translate them to a canonical category or hide existing news when the category filter is set to All.
- Preserve journalistic type selection (`Interview` = `مقابلة`), kicker controls, R4 layout, RBAC, Draft-only edits, and all other fields.

## 4. Deferred, blocking category work

- C2: Backend enforcement of canonical category on NEW drafts and editorial publication, with legacy-safe update policy; no mutation/migration of historical Firestore items.
- C3: Remove fail-open `Climate` fallback in public projection, harmonize category labels from shared definitions, test public category filters / zero ambiguity. Coordinate compatible handling of published legacy documents.
- C4: Confirm editor/public functional behavior and visual states; decide owner-approved classification of real legacy Draft.
- Separate media track: image upload, cover selection, rights/provenance, secure Storage rules and workflows. No attempt to implement in C1.

## 5. Verification and governance

- Preflight local SHA for both targets and `src/types.ts`; inspect actual live usages and current data-flow before changes.
- Only two allowlisted files can change. No Git commands in Studio, no package installs, no broad cleanup, no Firebase requests, no generated documents, no Push/Deploy.
- Run `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` and report the exit code. Existing isolated news tests optional; do not claim they test UI rendering if they do not.
- Verify no accidental category migration and never claim a live Firebase result before backend Push/Deploy.
- Expected GitHub Sync after C1: **15 Modified, 0 Added, 0 Deleted** because both authorized files are already Modified in the owner-verified 15-file Sync snapshot; confirm from owner screenshot.
- STOP if actual local preconditions differ or migration/extra write paths are required.

## 6. Direct pinned GitHub baseline references (historical, not replacements)

- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/components/news/AdminNewsManagement.tsx
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/src/types/news.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/afe25dd74068ae016bba7c11303f948ff146c34e/functions/src/shared/contentContract.ts

Pinned baseline sources are older than Studio's unpushed changes. Do NOT restore from them. If Studio attempts HTTP fetch, it must verify status and full body first; otherwise STOP, not guess.
