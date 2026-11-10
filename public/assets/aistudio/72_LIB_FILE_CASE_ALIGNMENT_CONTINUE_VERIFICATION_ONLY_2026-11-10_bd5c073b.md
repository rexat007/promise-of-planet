# Promise of Planet — RESUME #3 / FINISH EXISTING LOCAL WORK ONLY

**Unit:** `LIB-FILE-CASE-ALIGNMENT-01`  
**Repository:** `rexat007/promise-of-planet`  
**Pushed baseline (reference only):** `79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c`  
**Authoritative state for this request:** **the current unpushed Google AI Studio workspace, including both prior interrupted runs.**  
**Mode:** `STRICT_LOCAL_CONTINUATION → VERIFY_AND_CLOSE`; **NOT** `IMPLEMENT_FROM_SCRATCH`, **NOT** `SOURCE_RECOVERY`.

## Executive instruction — highest priority

**Do not restart, regenerate, recreate, rewrite, or restore any implementation.** You are resuming a nearly completed, unpushed implementation after a Google AI Pro quota interruption. The user's concern is that previous continuation prompts wasted quota by repeating implementation. Your job is to preserve the current local implementation, check only what is unverified after the **last edits**, fix a **demonstrated failing line** if necessary, and issue an accurate closeout report. Do not perform new broad feature work or reconstruct the original architecture.

**Important:** Do not invoke the original 69/70 prompt as a fresh job and do not run its original "local source must match baseline" preflight. Expected modified files now have different hashes and all 5 ADD files exist locally; this is **evidence of progress, not corruption**. Do not fetch GitHub and overwrite them. GitHub HEAD is pushed-baseline authority, *not* the state of this pending unit.

## Proven checkpoint from the second interrupted run

Read this as past evidence, **not a task to repeat**:

- `scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts` **7/7 PASS**.
- `scripts/runLibraryQuarantineCatalogCaseAlignmentClientTests.ts` **6/6 PASS**.
- `scripts/runLibraryQuarantineRightsDecisionBackendTests.ts` **8/8 PASS**.
- `scripts/runLibraryQuarantineRightsDecisionClientTests.ts` **6/6 PASS**.
- Previously run catalog handoff backend/client and human review backend/client regressions **PASS**.
- Root `npx --no-install tsc --noEmit` returned no reported error in the log, but post-interruption changes need final verification.
- `cd functions && npx --no-install tsc --noEmit` emitted `TS5107` (`moduleResolution=node10` deprecated under current TypeScript) from **read-only** `functions/tsconfig.json`. This is an environment/configuration issue that must be classified carefully; do **not** edit `tsconfig.json` or install packages. A later generic quality-control/build step reported exit 2, without a final complete passing build report.
- **Last observed activity:** further edits to `src/services/libraryQuarantineCatalogCaseAlignmentClient.ts` and `src/components/library/LibraryQuarantineCatalogCaseAlignmentPanel.tsx` after earlier 6/6, followed by quota exhaustion. Those exact final edits have **not been re-tested** according to the provided log.

## Step 0 — zero-write local fingerprint, not reimplementation

Before any edit, inspect **only** this list and print `path | exists | bytes | git-blob-SHA1`. Do not create a tracking file. For the 8 MODIFY paths the local sha may differ from GitHub; preserve the local bytes. For the 5 ADD paths, they should **exist** (do not demand absence).

### Exclusive MODIFY allowlist (8)

1. `functions/src/library/libraryAdminHandlers.ts`
2. `functions/src/library/firestoreLibraryQuarantineRightsDecisionStore.ts`
3. `functions/src/library/libraryQuarantineRightsDecisionService.ts`
4. `src/services/libraryQuarantineRightsDecisionClient.ts`
5. `src/components/library/LibraryQuarantineRightsDecisionPanel.tsx`
6. `src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx`
7. `scripts/runLibraryQuarantineRightsDecisionBackendTests.ts`
8. `scripts/runLibraryQuarantineRightsDecisionClientTests.ts`

### Exclusive ADD allowlist (5 — **already locally created; preserve**)

1. `functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts`
2. `src/services/libraryQuarantineCatalogCaseAlignmentClient.ts`
3. `src/components/library/LibraryQuarantineCatalogCaseAlignmentPanel.tsx`
4. `scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts`
5. `scripts/runLibraryQuarantineCatalogCaseAlignmentClientTests.ts`

Expected scope after completion: **8 MODIFIED + 5 ADDED + 0 DELETED**, plus no other unexpected files. Files originally read-only under specification 69 remain read-only, including `functions/src/library/libraryQuarantineRightsDecisionContract.ts`, `functions/src/library/libraryQuarantineCatalogHandoffService.ts`, `src/components/library/LibraryQuarantineHumanReviewModal.tsx`, `functions/src/shared/adminContract.ts`, `src/services/firebase.ts`, `functions/src/index.ts`, `package.json`, lockfiles, tsconfigs, `.env*`, and build/deploy workflows.

If any one of the 13 allowlisted files is now missing or apparently reset to baseline, **STOP and report the exact absence/mismatch**. Do not reconstruct it automatically. If Studio does not preserve the existing unpushed workspace, **STOP** (no guessing and no GitHub-based reset).

## Step 1 — minimal final verification, no rewrites

Since the previous run reached a completed implementation and tests, **do not rewrite tests or production logic proactively**. Execute the following in order, read only outputs, and repair **only an actual, localized failure**:

```bash
npx --no-install tsx scripts/runLibraryQuarantineCatalogCaseAlignmentClientTests.ts
npx --no-install tsx scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineRightsDecisionClientTests.ts
npx --no-install tsx scripts/runLibraryQuarantineRightsDecisionBackendTests.ts
npx --no-install tsc --noEmit
```

These validate the **latest local edits**; do not count older PASS results as current if a later edit has touched the tested code. If they pass, **do not inspect or revise those files again**.

Next, run **only any regression suites not definitively closed in the latest log**, using the commands in §9 of original spec 69 (workbench, persistence/bridge, upload integration), followed by the final project build and lint exactly as defined in `package.json`, without adding dependencies or editing scripts. Reuse previously observed PASS results for unchanged suites when clearly supported, but report that evidence as **prior run PASS**, not as freshly executed.

### `functions/tsconfig.json` TS5107 — do not spend quota on a forbidden edit

The observed error is:

```text
TS5107: Option 'moduleResolution=node10' is deprecated ...
```

Do **not** modify `functions/tsconfig.json`, root `tsconfig.json`, `package.json`, any lockfile, or global TypeScript version. For diagnostic separation only, you may run this *non-mutating command-line override* once, if supported by installed TypeScript:

```bash
cd functions && npx --no-install tsc --noEmit --ignoreDeprecations 6.0
```

If it passes, report `FUNCTIONS_TS: BASE_COMMAND_BLOCKED_TS5107; DIAGNOSTIC_OVERRIDE_PASS` (not clean unqualified PASS). If it fails for unrelated **real source type errors** inside the allowlist, correct those errors only; if fixing requires an out-of-scope path, STOP and report. Never label a failed check as passed or silence hidden tests.

### If something fails

- First read **only** the failing output, file and small surrounding range; compare against the source contract and tests. No full-file rewrite, no speculative patch, no mass rename, no unnecessary rereading every file.
- Distinguish `FAIL_REAL_IMPLEMENTATION`, `FAIL_TEST_FIXTURE`, and `ENVIRONMENT_BLOCKED`. A test fixture may be updated only when source contract demonstrably requires it. Do not loosen assertions to make red tests green.
- After a correction, rerun **the specific failing test once**, then only impacted checks; re-run final quality gates once when stable.
- Preserve security posture: `qcat-` stays Draft, no public entry, download URL, GCS path, `generation`, raw bytes, auto approval, or rights escalation; metadata-only rights remain human-controlled. `UNKNOWN` requires read-only verification and no automatic retry. Keep correct CAS and append-only audit behavior.
- No permission to edit other files. No push, PR, merge, Firebase CLI, GitHub Actions deploy, or environment flag activation.

## Step 2 — concise final report; no more development

Return **one** final report, with:

1. `RESUMED_FROM_EXISTING_LOCAL_WORKSPACE: YES/NO` and whether any local code was lost/reset.
2. `FILES: 8 MODIFIED + 5 ADDED + 0 DELETED` (or actual deviations) and **all 13 final git-blob SHA1** values, plus protected read-only mismatch count.
3. Exact **new** changes made in this continuation (prefer `0`, or the smallest actual set). Do not report earlier implementation as new work.
4. For every test/check run this time: command + exit status + counts; distinguish older PASS evidence. Mention any `TS5107` override transparently.
5. `GITHUB_SYNC_SCOPE: expected/actual`, including unintentional changes, deletions or conflicts; if Studio UI cannot be accessed, explicitly say `NOT_VERIFIED` and request owner visual verification rather than inventing a result.
6. `STATUS: IMPLEMENTED_PENDING_SOURCE_AND_VISUAL_REVIEW` only if checks are supported; otherwise `VERIFICATION_BLOCKED` with precise blocker.
7. `PUSH: NOT_PERFORMED; FIREBASE_DEPLOY: NOT_PERFORMED`.

**Stop immediately after the report. Do not initiate another unit.**

## No fetching or restoring needed

No network access is needed to continue the local implementation. Original pinned GitHub reference, when read-only comparison is absolutely essential and HTTP fetch is genuinely available, is `rexat007/promise-of-planet`, commit `79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c`; the original spec 69 already includes complete direct HTTPS raw URLs and expected SHA-1 values for each reference. Never assume a relative path or GitHub Sync can fetch content. **If the local files are absent, STOP instead of restoring.**
