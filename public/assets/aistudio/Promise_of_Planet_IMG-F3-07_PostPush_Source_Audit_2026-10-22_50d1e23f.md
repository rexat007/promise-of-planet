# Promise of Planet — IMG-F3-07 Post-Push Source Audit

**Date:** 2026-10-22  
**Repository:** `rexat007/promise-of-planet`  
**Pushed HEAD:** `72e29b957b2fcf6b2a8ccb57b00eb7e67ecd9e83`  
**Parent:** `71e4d883b9ac6fb5c42dbcc19d2ba074b35cf7d4`  
**Assessment:** `PUSH_AUDIT_PASSED__SOURCE_REVIEW_ONE_REMEDIATION_REQUIRED__NOT_ACCEPTED`

## 1. Verifiable pushed diff

GitHub commit contains seven paths, zero deletions:

| Path | Status | Git blob SHA-1 |
|---|---|---|
| `functions/package.json` | Modified | `420e933933f4f582a4ded415727152021faf5400` |
| `functions/package-lock.json` | Modified | `99415d41bad872f581731b1cdca04340c390a103` |
| `functions/src/news/editorialImageVariantProcessor.ts` | Added | `f8518ed7bb6f249d5a60dff79e9e22aa727865a6` |
| `src/services/editorialImageVariantProcessor.test.ts` | Added | `bfde583e309406b1b63f57e9940b04a72547dea8` |
| `public/assets/aistudio/Promise_of_Planet_IMG-F3-07_Image_Upload_Processor_Spec_2026-10-22_1be86b74.md` | Added | `5297ad23d5775bcbc5727061d0ef7cdcdb2ea37e` |
| `public/assets/aistudio/Promise_of_Planet_IMG-F3-07_Npm_Scope_Recovery_and_Resume_2026-10-22_5777cd18.md` | Added | `23d13be804c0a97c742d728839bce7c87b22c77a` |
| `public/assets/aistudio/Promise_of_Planet_IMG-F3-07_Studio_Execution_Prompt_2026-10-22_79ab3cd3.md` | Added | `1050c6c64ca4ee2136140e775842847b1f7d266c` |

Pushed protected blob SHA-1: root `package.json` `34cb668d837d342c9b5367461cca2ad9dd8a18e7`; root `package-lock.json` `bbeb2e14de4250608e825d1640818feedc4dc297`; `bun.lock` `987bd0d55d3d377725c03516c3f139f56a6265b9`; `app/applet/.oxlintignore` `6c0d0f5ea142a0cdfc37fdc59451358ea4873e91`; `app/applet/.oxlintrc.json` `58fc9f117568bca7a93b4ad87bc3e37dfdfeff7e`. IMG-F3-05/06 accepted source files inspected by tree SHA remain unchanged.

## 2. Source-reviewed functionality

`functions/src/news/editorialImageVariantProcessor.ts` imports the existing preliminary inspector and uses Sharp decoding/re-encoding with five WebP variants, canonical asset paths, SHA-256 over real output buffers, capped input size and pixel budget, EXIF auto-orientation, metadata stripping, no upscaling, and rejection rather than partial returns. It contains no Firebase/GCS production wiring.

`functions/package.json` and its lock add `sharp@0.35.5` to the **Functions** package; optional native packages for Linux are represented in the lock. Studio reported Node 22/Linux Sharp runtime and 147/147 Vitest tests; these are **reported** results, not independently rerun during this review.

## 3. Required source-review correction: test module resolution / clean-checkout reproducibility

`src/services/editorialImageVariantProcessor.test.ts` directly executes `import sharp from 'sharp'` at file top. But `sharp` is declared only under `functions/package.json`, not the root `package.json`; the root lock has no `node_modules/sharp` entry. Since the test sits under `src/services`, normal Node/Vite module-resolution parent traversal does **not** search the sibling `functions/node_modules` directory. The passing Studio test may therefore depend on locally retained root Sharp from the earlier mis-scoped npm install or other machine-global dependency; its success does not establish reproducibility after clean root/Functions `npm ci`. Additionally, `tsconfig.app.json` includes `src` and does not exclude `*.test.ts` names, potentially making the frontend TypeScript build depend on a package not in root lock.

Recommended minimal repair: **relocate this one test file** from `src/services/editorialImageVariantProcessor.test.ts` to `functions/src/news/editorialImageVariantProcessor.test.ts`, update its two relative source imports, leave its bare `import sharp from 'sharp'`. The test then resolves Sharp from `functions/node_modules`, `functions/tsconfig.json` already excludes `src/**/*.test.ts`, and `tsconfig.app.json` no longer includes the test. This intentionally records one test-file deletion and one test-file addition (or one recognized rename). Do **not** alter root manifests or falsely add Sharp as a root dependency. A test-only relocation is sufficient to address this concern; do not change the accepted processor.

Verification gates: unchanged original test blob SHA before move, destination absent, all other files unchanged; run existing six suites plus relocated tests (reported total 147), Functions isolated strict typecheck, Functions build, root frontend `tsc -b`/`npm run build` with baseline failure classification, and `require.resolve('sharp',{paths:[process.cwd()+'/functions/src/news']})` resolving under `functions/node_modules`. Verify no unexpected deletions in GitHub Sync before any push.

## 4. Known unresolved items

- `UPLOAD_NOT_WIRED`: frontend/editorial upload not connected to processor.
- `GCS_WRITE_SESSION_RECEIPT_CRASH_GAP_OPEN`: GCS/Firestore crash gap not remediated.
- `NO_FIREBASE_PRODUCTION_VERIFICATION`: no production deployment or live tests.
- `HUMAN_RIGHTS_APPROVAL_REQUIRED`: approval remains a human editorial boundary.
- Root/frontend clean-install source test reproducibility unproven until the narrow repair passes.

## 5. Gate

**Push audit:** PASS.  
**Source review:** ONE NARROW TEST-LOCATION REMEDIATION REQUIRED.  
**Owner acceptance / unit closeout:** NOT YET.  
**Push / Deploy from this review:** NONE.

[GitHub commit](https://github.com/rexat007/promise-of-planet/commit/72e29b957b2fcf6b2a8ccb57b00eb7e67ecd9e83) · [processor](https://github.com/rexat007/promise-of-planet/blob/72e29b957b2fcf6b2a8ccb57b00eb7e67ecd9e83/functions/src/news/editorialImageVariantProcessor.ts) · [test](https://github.com/rexat007/promise-of-planet/blob/72e29b957b2fcf6b2a8ccb57b00eb7e67ecd9e83/src/services/editorialImageVariantProcessor.test.ts) · [tsconfig.app.json](https://github.com/rexat007/promise-of-planet/blob/72e29b957b2fcf6b2a8ccb57b00eb7e67ecd9e83/tsconfig.app.json) · [functions/tsconfig.json](https://github.com/rexat007/promise-of-planet/blob/72e29b957b2fcf6b2a8ccb57b00eb7e67ecd9e83/functions/tsconfig.json).
