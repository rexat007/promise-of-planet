# Promise of Planet — IMG-F3-05
## Targeted Acceptance Closure — 2026-10-21

**Status:** Source audit complete; owner acceptance remains pending. No production wiring, Push or Deploy authorized.

### Evidence of corrected understanding
- Audit reported matching local Git blob SHA-1 for three IMG-F3-05 files and both canonical references.
- Accepted path generation is used (`editorial_images/private/{assetId}/{variantKey}.{ext}`).
- All five canonical variant keys are used.
- Image inspector uses decimal `15_000_000` byte limit.
- Five variants currently contain identical bytes and metadata: provisional, **not** actual resizing.
- In-memory storage and session repositories are not durable process-crash recovery.

### Exact targeted write allowlist
1. `src/services/editorialBinaryIntakeService.test.ts` — add missing regression cases only.
2. `functions/src/news/editorialBinaryIntakeService.ts` — change only the inaccurate JSDoc near `ingestRightsEvidenceBinary` that mentions `fileMimeType` and `fileSizeBytes` on the evidence record. No runtime logic edits.

`functions/src/news/editorialBinaryInspector.ts` and all previously accepted units are read-only.

### Required tests
1. Assert default image inspection policy max size is `15_000_000` bytes. Test an otherwise structurally valid image buffer **exactly** 15,000,000 bytes is eligible for preliminary verification and an otherwise equivalent valid buffer at 15,000,001 bytes fails `SIZE_LIMIT_EXCEEDED`; construct legitimate PNG ancillary chunks or another format-compliant fixture. Avoid invalid trailing padding, arbitrary buffers, changing the parser or overriding the default size policy. If fixture cannot be constructed with current tooling, STOP and report the obstacle; do not fake PASS.
2. Abandoned session TTL: controlled clock after `expiresAt` with a non-terminal quarantine/promoting intake, assert appropriate reconciliation, generation-safe cleanup and idempotence.
3. Evidence lost-commit: simulate canonical evidence registration succeeded but operation response is ambiguous, assert trusted evidence readback keeps the matching private object, clears quarantine appropriately, and does not delete canonical evidence. Where proof is unavailable, `NeedsReconciliation`, never destructive guessing.
4. Regression test no client-supplied path/identity/rights approval is trusted, existing behavior remains unchanged.

### Verification and stopping
Preflight verify Git blob SHA-1:
- inspector `8c1dbb8431de693af710c219c06538e2212107de` (read-only)
- intake service `8b580be7ca4c8fd6ec66b2a0a7b3d300426fff4c`
- tests `a0daf4f4cfb1352ca1f86adaa124d820e3a454a6`
- asset type `af587a23fc7699eae77074ac67a5f49107384171` (read-only)
- asset contract `39d89e007f21b94b59c504b0f577d84ab372859d` (read-only)

Run full relevant Vitest suites including `functions/src/shared/editorialImageAssetContract.test.ts`, and isolated strict TypeScript check; report exit codes, counts, changed files, byte sizes, hashes. Existing full Functions TS5107 issue must be reported honestly. No installations, GitHub access, Git commands, deployment, Firebase operations, wide refactors or changes to tests to bypass failures. If preconditions differ or context truncates, STOP.

### Constraints carried forward
Metadata-only evidence remains distinct from verified binary evidence. Binary inspection is preliminary, does not fully decode pixels/sanitize PDFs; duplicate bytes are provisional variants and not optimized derivatives. Real Storage and Firestore durable adapters, replay-safe lifecycle and operational authorization are separate future gates. No public delivery or auto approval.
