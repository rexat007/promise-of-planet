# Promise of Planet — IMG-F3-07 Image Upload Processing Foundation
MODE: STRICT BOUNDED IMPLEMENTATION — PROCESSOR ONLY / NO PRODUCTION WIRING
Repository: `rexat007/promise-of-planet`
Pinned pushed baseline: `71e4d883b9ac6fb5c42dbcc19d2ba074b35cf7d4`

## Purpose and authorization
Owner explicitly authorized adding `sharp` **only because genuine image transformations are necessary to resolve the editorial image-upload problem before launch**. This step produces a REAL server-side image processor; it does not yet connect the user-facing upload endpoint or claim upload is fixed.

Do not assume Git access or the ability to fetch GitHub files. Use CURRENT LOCAL Studio files only and check byte-for-byte Git blob SHA1 before any write. Do not reconstruct from guessed remote paths.

## 1. Preflight (READ ONLY, STOP on any mismatch)
Confirm the local workspace contains these EXACT blob SHA-1 values:
- `functions/package.json` = `2b4278978141a9091ad90684aba1b6857c5f9bb4`
- `functions/package-lock.json` = `fa1838b5b47529c5c70ccc5b7d21c47e8510cbbe`
- `functions/src/news/editorialBinaryInspector.ts` = `8c1dbb8431de693af710c219c06538e2212107de`
- `functions/src/news/editorialBinaryIntakeService.ts` = `61c13c7878112a6a0cd075df094478449c97d5b2`
- `functions/src/shared/editorialImageAssetContract.ts` = `39d89e007f21b94b59c504b0f577d84ab372859d`
- `functions/src/types/editorialImageAsset.ts` = `af587a23fc7699eae77074ac67a5f49107384171`
- `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` = `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e`
- `app/applet/.oxlintignore` = `6c0d0f5ea142a0cdfc37fdc59451358ea4873e91`
- `app/applet/.oxlintrc.json` = `58fc9f117568bca7a93b4ad87bc3e37dfdfeff7e`
Confirm two new target files DO NOT exist. Confirm no unexpected deletions/conflicts in current Studio source state. STOP on any discrepancy.

## 2. Exclusive write allowlist
CREATE:
1. `functions/src/news/editorialImageVariantProcessor.ts`
2. `src/services/editorialImageVariantProcessor.test.ts`
MODIFY:
3. `functions/package.json`
4. `functions/package-lock.json`
No other source/config/document/lock file may change. Everything else is READ ONLY, including F3-05/F3-06, contracts/types, Functions index, admin UI, firebase.json and indexes/rules, root `package.json` and `package-lock.json`, `bun.lock`, Oxlint, GitHub Actions and `public/assets/aistudio` docs.

## 3. Approved dependency operation
From inside `functions` ONLY, run `npm install --save-exact sharp@0.35.5` to add the runtime dependency, updating its package.json and package-lock.json ONLY. Do not use Bun or install root packages. Keep native optional dependencies intact for Linux Node 22; validate lock consistency and explain any install barrier. Do not change existing dependency versions manually. If the installer touches any unexpected tracked file, STOP and report before proceeding. Do not run rm -rf or directory-cleaning commands.

## 4. Image processor implementation
Implement `processEditorialImageVariants` or equivalently named small, typed, standalone server function in the new file:
- Inputs: validated canonical `assetId`, `binary: Buffer`, optionally claimed MIME and filename/extension.
- First call accepted `inspectEditorialImageBinary` and reject unless PRELIMINARY_VERIFIED.
- Decode pixels with the actual Sharp native pipeline (never rely on headers alone); only static PNG/JPEG/WebP; enforce 15,000,000-byte input and 25,000,000-pixel limit; fail on warnings/corrupt images, reject multiple frames and unsupported formats. DO NOT use the Sharp raw-buffer API for user-supplied images and do not change the accepted inspector.
- Auto-orient per EXIF, maintain aspect ratio and transparency, strip EXIF/GPS/XMP/IPTC metadata by default. No `withMetadata()` or metadata-preserving options.
- Produce 5 actual *WebP* re-encodings: thumbnail max width 320; card 720; article_inline 1280; article_cover 1920; original_processed 2560; no enlargement and no cropping by default.
- For each variant, derive exact path from the EXISTING `buildEditorialImageVariantStoragePath(assetId, key, 'image/webp')`. Return `{variantKey,storagePath,mimeType,width,height,sizeBytes,sha256Checksum,bytes}` using information from the actual re-encoded bytes. Verify each output decodes as static WebP with dimensions and SHA matching returned fields, and output ≤15MB.
- Use bounded sequential transformations, `limitInputPixels:25_000_000`, `unlimited:false`, `failOn:'warning'`, `animated:false`, `pages:1`, Sharp `.timeout({seconds:15})`; these are not a hard process-memory guarantee.
- On ANY variant error, reject the entire operation without returning partial success. Do not persist any object, update canonical asset metadata or rights status, or expose download URLs. The caller owns storage transactions and future reconciliation.
- Large images should demonstrate actual different dimensions; do NOT force unequal checksums for tiny images whose resulting dimensions legitimately coincide.
- Provide sanitized, deterministic error codes, no binary content in logs/errors.

## 5. Required tests
Write REAL decoder/encoder tests in `src/services/editorialImageVariantProcessor.test.ts`, not fake Sharp stubs:
1. PNG/JPEG/WebP accepted and produce five independently validated real WebP buffers with correct paths, SHA and dimensions.
2. Large image creates meaningfully different sizes. Small image never enlarged. Transparent PNG retains alpha; EXIF orientation and metadata removal verified using safe generated sample data.
3. Reject animated images, SVG/GIF/TIFF/AVIF/PDF, wrong MIME/extension, 15 MB/pixel limit violations, corrupted pixel stream with plausible header, noncanonical assetId.
4. Inject or induce processing failure and demonstrate fail-closed, no partial success.
5. Verify a native Sharp import loads and renders under the actual environment; distinguish test environment from deployment Node22/Linux.
6. Re-run the six accepted suites (134 tests according to prior Studio report) PLUS the new tests. Report complete counts and all exit codes; run isolated strict TypeScript checking.
7. Run `npm ci` in functions for lock/runtime integrity if environment permits. STOP if native modules are unavailable, with precise diagnostics; do not substitute mock image processing.

## 6. Final report and STOP
Return exact changed paths, SHA1 blob checksums, byte sizes, package-lock delta, native Sharp version/runtime, test names/results, TypeScript results, and whether optional Linux packages are present in the lock. Explain any known environment mismatch or untested deployment details. Protect Oxlint and `bun.lock`. No Git commands, GitHub Push, Firebase CLI or Deploy. No generated reports in repo.

Final status must be `IMG-F3-07_PROCESSOR_IMPLEMENTED_PENDING_OWNER_REVIEW` or `STOP_REQUIRES_DESIGN_DECISION`.

Clearly state all remaining upload blockers: `UPLOAD_NOT_WIRED`, `GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`, `NO_FIREBASE_PRODUCTION_VERIFICATION`, and `HUMAN_RIGHTS_APPROVAL_REQUIRED`.
