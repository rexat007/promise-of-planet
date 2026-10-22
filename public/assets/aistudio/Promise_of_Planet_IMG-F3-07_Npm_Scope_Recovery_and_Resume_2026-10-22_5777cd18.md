# Promise of Planet — IMG-F3-07 / npm Scope Recovery and Resume

**Mode:** Strict bounded recovery followed by the already-authorized processor implementation.

**Repository:** `rexat007/promise-of-planet`

**Pinned pushed baseline:** `71e4d883b9ac6fb5c42dbcc19d2ba074b35cf7d4`

**Status:** `STOP_REQUIRES_DESIGN_DECISION` — this document makes the decision to use explicit npm `--prefix` after first restoring the unintended root lockfile change. Does not authorize Git push or Firebase deploy.

## Diagnosis and decision

The first `npm install --save-exact sharp@0.35.5`, launched while inside `functions`, resolved its npm project context to the repository root in the Google AI Studio runtime, altering the root `package.json` and `package-lock.json`. Studio reports that it manually restored `package.json`, but it has **not established byte-identical restoration of the root package-lock**. npm documentation explains upward detection of package/project roots; an explicit prefix can direct an npm command to a different package directory. An isolated Node 22 / npm 10.9.2 reproduction verified that `npm --prefix functions install --package-lock-only --ignore-scripts --offline` writes only `functions/package-lock.json` in a two-package dummy project, even if root `node_modules` exists. This does not replace a Studio-specific test of the actual install.

**Chosen action:** restore the root lockfile to its pinned GitHub bytes with Git blob SHA-1 verification *before* any npm command that writes; verify the root `package.json` is back to baseline; then use `npm --prefix ./functions install --save-exact sharp@0.35.5 --include=optional --no-audit --no-fund` from `/app/applet`. Do not add workspaces, create directories manually, or run cleaning commands.

## Exact pinned references / integrity gates

| Path | Expected Git blob SHA-1 | Role |
|---|---|---|
| `package.json` | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` | Root protected, read only |
| `package-lock.json` | `bbeb2e14de4250608e825d1640818feedc4dc297` | Root restore-only if dirty |
| `functions/package.json` | `2b4278978141a9091ad90684aba1b6857c5f9bb4` | Allowed to modify |
| `functions/package-lock.json` | `fa1838b5b47529c5c70ccc5b7d21c47e8510cbbe` | Allowed to modify |
| `functions/src/news/editorialBinaryInspector.ts` | `8c1dbb8431de693af710c219c06538e2212107de` | Protected |
| `functions/src/news/editorialBinaryIntakeService.ts` | `61c13c7878112a6a0cd075df094478449c97d5b2` | Protected |
| `functions/src/shared/editorialImageAssetContract.ts` | `39d89e007f21b94b59c504b0f577d84ab372859d` | Protected |
| `functions/src/types/editorialImageAsset.ts` | `af587a23fc7699eae77074ac67a5f49107384171` | Protected |
| `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` | `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` | Protected |
| `app/applet/.oxlintignore` | `6c0d0f5ea142a0cdfc37fdc59451358ea4873e91` | Protected |
| `app/applet/.oxlintrc.json` | `58fc9f117568bca7a93b4ad87bc3e37dfdfeff7e` | Protected |

**Fully specified remote source ONLY for the root lockfile restoration:**

- Repository: `rexat007/promise-of-planet`
- Relative path: `package-lock.json`
- Pinned commit: `71e4d883b9ac6fb5c42dbcc19d2ba074b35cf7d4`
- Direct raw HTTPS URL:
  `https://raw.githubusercontent.com/rexat007/promise-of-planet/71e4d883b9ac6fb5c42dbcc19d2ba074b35cf7d4/package-lock.json`
- Verified Git blob SHA-1 of expected body: `bbeb2e14de4250608e825d1640818feedc4dc297`

A Studio fetch is **NOT ASSUMED**. It may only write that file after it has obtained the complete response body and verified HTTP 200, JSON parse, expected lockfile shape and Git blob hash *before writing*. A trusted user-supplied copy of the full pinned file is an alternative, also hash-checked first. If neither source is accessible and verified: STOP. Never reconstruct a large lockfile heuristically, undo changes by deleting package entries, or claim it is restored merely because `package.json` was reverted.

## Exclusive write allowlist

1. `package-lock.json`: **RESTORE ONLY** to the exact pinned Git blob above, never a dependency update.
2. `functions/package.json`: MODIFY — add only `sharp@0.35.5` as a runtime dependency.
3. `functions/package-lock.json`: MODIFY — controlled npm-generated lock update within Functions.
4. `functions/src/news/editorialImageVariantProcessor.ts`: CREATE — actual standalone processor.
5. `src/services/editorialImageVariantProcessor.test.ts`: CREATE — processor tests.

All others read-only. Do not create a `functions/node_modules` directory as a workaround; do not alter `bun.lock`, root `package.json`, root package dependencies, Oxlint, public docs or Firebase configs. `node_modules` effects from the scoped install are ignored for tracked-file scope but are not grounds to delete folders.

## Mandatory staged procedure

1. Read-only inventory of exact local Git blob hashes of both root package files and both Functions package files. If root `package.json` is not the expected baseline, STOP. If Functions package files are not their expected baseline, STOP. Confirm exact protected SHA-1 values, new processor/test absent, and no other unexpected modified/deleted tracked files.
2. If root `package-lock.json` differs: retrieve ONLY the pinned `package-lock.json` by direct verified source URL/user-supplied exact file. Check HTTP/body or supplied file, calculate Git blob SHA-1 on in-memory bytes (SHA-1 of `blob <byte-count>\0` + bytes), require exactly `bbeb2e14de4250608e825d1640818feedc4dc297`, then write the verified bytes to **root `package-lock.json` only**. Rehash file after write. If original is already equal, skip restoration.
3. Check `npm --prefix ./functions prefix` resolves to `/app/applet/functions`, and `npm --prefix ./functions pkg get name` resolves to `functions`. If not, STOP.
4. At repository root (`/app/applet`), run only:
   ```bash
   npm --prefix ./functions install --save-exact sharp@0.35.5 --include=optional --no-audit --no-fund
   ```
   No root install, no `npm ci` at root, no `npm init`, no workspace changes, no deletion commands.
5. Immediately rehash root `package.json` and `package-lock.json`: both MUST match the baseline hashes above. Verify root lockfile has no Sharp additions and both Functions package files contain only expected Sharp-related changes. On unexpected tracked changes or native load failure: STOP; do not try unapproved cleanups.
6. Validate runtime from `functions`: `node -e "const s=require('sharp');console.log(s.versions.sharp)"`; record actual environment Node version/architecture. Lockfile should retain supported native optional dependencies. If native packages unavailable, STOP; do not pretend a mock is equivalent.
7. Only after all gates pass, continue the **previously approved IMG-F3-07 processor specification** without altering accepted core sources. Create the two source/test files above, produce five truly decoded/reencoded WebP variants (`thumbnail` <=320, `card` <=720, `article_inline` <=1280, `article_cover` <=1920, `original_processed` <=2560), preserve aspect ratio/no upscaling, remove EXIF/GPS, reject animated/corrupt/oversized, bound resources, verify output dimensions/SHA-256/bytes and canonical paths. No Firestore/GCS writes or production endpoints.
8. Run existing 134-test regression baseline plus real Sharp processor tests; isolated strict TSC. Inspect exact GitHub Sync delta; no push or deploy.

## Required report

- Before/after hashes of **root and Functions** package files.
- Exact root lockfile restoration method and whether HTTP/body or uploaded source was verified.
- `npm --prefix` destination check and successful native Sharp version check.
- Exact five-file touched inventory (root lockfile should be byte-identical to GitHub after recovery and thus no longer appear changed).
- Processor behaviors, all tests and isolated TSC exit codes.
- Independent known limitations: `UPLOAD_NOT_WIRED`, `GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`, `NO_FIREBASE_PRODUCTION_VERIFICATION`, `HUMAN_RIGHTS_APPROVAL_REQUIRED`.
- Status either `IMG-F3-07_PROCESSOR_IMPLEMENTED_PENDING_OWNER_REVIEW` or `STOP_REQUIRES_DESIGN_DECISION`.

**STOP for owner review. No Push, Firebase deploy or acceptance claim.**
