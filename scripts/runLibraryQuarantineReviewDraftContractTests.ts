import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SanitizedLibraryQuarantineReceiptListItemDto } from '../functions/src/library/libraryQuarantineAdminReadService';
import {
  LibraryQuarantineReceiptState,
  type SanitizedLibraryQuarantineAdminReceiptDto,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES,
  areQuarantineReviewCandidatesSameSourceVersion,
  assessLibraryQuarantineReviewCandidate,
} from '../functions/src/library/libraryQuarantineReviewDraftContract';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
} from '../functions/src/library/libraryUploadBinaryAdmission';

const SAMPLE_RECEIPT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SECOND_RECEIPT_ID = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';
const SAMPLE_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SECOND_SHA256 =
  'f4c1d55309ad2d250b0ca5d9007ac03538bf52f5750ca45db506002c8963c966';

function computeGitBlobSha1(relPath: string): {
  sha1: string;
  byteLength: number;
} {
  const absPath = path.resolve(process.cwd(), relPath);
  const bytes = fs.readFileSync(absPath);
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  const sha1 = crypto
    .createHash('sha1')
    .update(header)
    .update(bytes)
    .digest('hex');
  return { sha1, byteLength: bytes.length };
}

function buildValidQuarantinedAdminReceipt(
  overrides: Partial<SanitizedLibraryQuarantineAdminReceiptDto> = {}
): SanitizedLibraryQuarantineAdminReceiptDto {
  const format = overrides.format ?? 'PDF';
  const isPdf = format === 'PDF';
  return Object.freeze({
    receiptId: SAMPLE_RECEIPT_ID,
    uploaderUid: 'admin-curator',
    originalFilename: isPdf
      ? 'السياسة-الوطنية-للمناخ-2026.pdf'
      : 'national-water-treaty-2026.docx',
    sanitizedFilename: isPdf
      ? 'السياسة-الوطنية-للمناخ-2026.pdf'
      : 'national-water-treaty-2026.docx',
    format,
    canonicalExtension: isPdf ? 'pdf' : 'docx',
    canonicalMimeType: isPdf
      ? CANONICAL_PDF_MIME_TYPE
      : CANONICAL_DOCX_MIME_TYPE,
    byteSize: 24_576,
    sha256: SAMPLE_SHA256,
    state: LibraryQuarantineReceiptState.Quarantined,
    deepInspectionStatus: isPdf
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
    hasVerifiedStorageWrite: true,
    reconciliationRequired: false,
    reconciliationReason: null,
    rejectionReasonCode: null,
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:05.000Z',
    isQuarantinedPrivateOnly: true,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  });
}

function buildValidListItem(
  revision = 3,
  receiptOverrides: Partial<SanitizedLibraryQuarantineAdminReceiptDto> = {}
): SanitizedLibraryQuarantineReceiptListItemDto {
  return Object.freeze({
    revision,
    adminReceipt: buildValidQuarantinedAdminReceipt(receiptOverrides),
  });
}

function runAllTests(): void {
  console.log(
    'Running LIB-FILE-REVIEW-01A pure quarantine review candidate contract tests...'
  );

  // Test 1: Valid Quarantined PDF and DOCX produce deterministic PENDING_HUMAN_REVIEW candidates without private paths/URLs/bytes
  {
    const pdfInput = buildValidListItem(3, { format: 'PDF' });
    const docxInput = buildValidListItem(4, {
      receiptId: SECOND_RECEIPT_ID,
      format: 'DOCX',
      byteSize: MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
    });

    const pdfRes = assessLibraryQuarantineReviewCandidate(pdfInput);
    assert.equal(pdfRes.ok, true);
    if (pdfRes.ok) {
      assert.equal(pdfRes.status, 'ELIGIBLE_FOR_HUMAN_REVIEW_CANDIDATE');
      const c = pdfRes.candidate;
      assert.equal(c.candidateKind, 'QUARANTINE_PRIVATE_REVIEW_CANDIDATE');
      assert.equal(c.decision, 'PENDING_HUMAN_REVIEW');
      assert.equal(c.receiptId, SAMPLE_RECEIPT_ID);
      assert.equal(c.sourceRevision, 3);
      assert.equal(c.sourceCreatedAt, '2026-11-08T10:00:00.000Z');
      assert.equal(c.sourceUpdatedAt, '2026-11-08T10:00:05.000Z');
      assert.equal(c.sourceSha256, SAMPLE_SHA256);
      assert.equal(c.sourceByteSize, 24_576);
      assert.equal(c.sourceFormat, 'PDF');
      assert.equal(c.sourceCanonicalExtension, 'pdf');
      assert.equal(c.sourceCanonicalMimeType, CANONICAL_PDF_MIME_TYPE);
      assert.equal(
        c.sourceDeepInspectionStatus,
        'PDF_REQUIRES_ISOLATED_PARSER'
      );
      assert.equal(c.uploaderUid, 'admin-curator');
      assert.equal(
        c.sourceOriginalFilename,
        'السياسة-الوطنية-للمناخ-2026.pdf'
      );
      assert.equal(c.isQuarantinedPrivateOnly, true);
      assert.equal(c.isSanitized, false);
      assert.equal(c.isVerifiedSafe, false);
      assert.equal(c.isRightsApproved, false);
      assert.equal(c.isPublished, false);
      assert.equal(c.isReadyForPeia, false);
      assert.deepEqual(
        c.deferredGates,
        LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES
      );
      assert.equal(Object.isFrozen(pdfRes), true);
      assert.equal(Object.isFrozen(c), true);

      const serialized = JSON.stringify(c);
      for (const forbiddenSubstring of [
        'storagePath',
        'generation',
        'bucket',
        'signedUrl',
        'downloadUrl',
        'normalizedUrl',
        'library/quarantine/',
        'gs://',
        'http://',
        'https://',
      ]) {
        assert.equal(
          serialized.includes(forbiddenSubstring),
          false,
          `Serialized candidate leaked forbidden substring "${forbiddenSubstring}"`
        );
      }
    }

    const docxRes = assessLibraryQuarantineReviewCandidate(docxInput);
    assert.equal(docxRes.ok, true);
    if (docxRes.ok) {
      assert.equal(docxRes.candidate.sourceFormat, 'DOCX');
      assert.equal(docxRes.candidate.sourceCanonicalExtension, 'docx');
      assert.equal(
        docxRes.candidate.sourceCanonicalMimeType,
        CANONICAL_DOCX_MIME_TYPE
      );
      assert.equal(
        docxRes.candidate.sourceDeepInspectionStatus,
        'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
      );
      assert.equal(docxRes.candidate.sourceByteSize, MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES);
    }

    console.log(
      'PASS 1: Valid Quarantined PDF and DOCX produce deterministic PENDING_HUMAN_REVIEW candidates free of private storage/URL/byte fields.'
    );
  }

  // Test 2: Every non-Quarantined state is rejected, and NeedsReconciliation is held even if other flags claim verified storage
  {
    for (const nonEligibleState of [
      LibraryQuarantineReceiptState.Reserved,
      LibraryQuarantineReceiptState.WritePending,
      LibraryQuarantineReceiptState.Rejected,
      'Approved',
      'Published',
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(2, {
          state: nonEligibleState as LibraryQuarantineReceiptState,
        })
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 'REJECTED');
        assert.equal(res.reasonCode, 'RECEIPT_STATE_NOT_ELIGIBLE');
      }
    }

    // NeedsReconciliation state or reconciliation flags must always fail with NEEDS_RECONCILIATION_HOLD
    for (const reconVariant of [
      buildValidListItem(3, {
        state: LibraryQuarantineReceiptState.NeedsReconciliation,
        hasVerifiedStorageWrite: true,
        isQuarantinedPrivateOnly: true,
        reconciliationRequired: true,
        reconciliationReason: 'GCS conditional write outcome was ambiguous.',
      }),
      buildValidListItem(3, {
        state: LibraryQuarantineReceiptState.Quarantined,
        hasVerifiedStorageWrite: true,
        isQuarantinedPrivateOnly: true,
        reconciliationRequired: true,
        reconciliationReason: null,
      }),
      buildValidListItem(3, {
        state: LibraryQuarantineReceiptState.Quarantined,
        hasVerifiedStorageWrite: true,
        isQuarantinedPrivateOnly: true,
        reconciliationRequired: false,
        reconciliationReason: 'Residual reconciliation note',
      }),
    ]) {
      const reconRes = assessLibraryQuarantineReviewCandidate(reconVariant);
      assert.equal(reconRes.ok, false);
      if (!reconRes.ok) {
        assert.equal(reconRes.reasonCode, 'NEEDS_RECONCILIATION_HOLD');
      }
    }

    console.log(
      'PASS 2: Non-Quarantined states (Reserved, WritePending, Rejected) and all NeedsReconciliation variants are strictly blocked.'
    );
  }

  // Test 3: Forged storage verification or escalated security/governance posture flags fail closed
  {
    for (const unverifiedVariant of [
      buildValidListItem(3, { hasVerifiedStorageWrite: false }),
      buildValidListItem(3, { isQuarantinedPrivateOnly: false }),
      buildValidListItem(3, {
        rejectionReasonCode: 'PDF_ACTIVE_CONTENT_DETECTED',
      }),
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(unverifiedVariant);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(
          res.reasonCode,
          'UNVERIFIED_QUARANTINE_STORAGE_POSTURE'
        );
      }
    }

    for (const escalatedField of [
      'isSanitized',
      'isVerifiedSafe',
      'isRightsApproved',
      'isPublished',
      'isReadyForPeia',
    ] as const) {
      const forgedReceipt = {
        ...buildValidQuarantinedAdminReceipt(),
        [escalatedField]: true,
      };
      const res = assessLibraryQuarantineReviewCandidate({
        revision: 3,
        adminReceipt: forgedReceipt,
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(
          res.reasonCode,
          'SECURITY_POSTURE_ESCALATION_DETECTED',
          `Expected SECURITY_POSTURE_ESCALATION_DETECTED when ${escalatedField} is forged to true`
        );
      }
    }

    console.log(
      'PASS 3: Unverified quarantine storage posture and any forged true posture flag fail closed.'
    );
  }

  // Test 4: Corrupt revision, receiptId, uploaderUid, sha256, byteSize, format/MIME/inspectionStatus, timestamps, and filenames are rejected
  {
    // 4a. Invalid source revisions
    for (const badRevision of [0, -1, 2.5, Number.NaN, '3', null]) {
      const res = assessLibraryQuarantineReviewCandidate({
        revision: badRevision,
        adminReceipt: buildValidQuarantinedAdminReceipt(),
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_SOURCE_REVISION');
      }
    }

    // 4b. Invalid receiptId
    for (const badReceiptId of [
      '',
      'A1B2C3D4E5F60718293A4B5C6D7E8F90',
      'a1b2c3d4e5f60718293a4b5c6d7e8f9',
      'g1b2c3d4e5f60718293a4b5c6d7e8f90',
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, { receiptId: badReceiptId })
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_RECEIPT_ID');
      }
    }

    // 4c. Invalid uploaderUid
    for (const badUid of [
      '',
      '   ',
      '../admin',
      'admin/curator',
      'admin\u0000curator',
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, { uploaderUid: badUid })
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_UPLOADER_UID');
      }
    }

    // 4d. Invalid sha256
    for (const badSha of [
      '',
      SAMPLE_SHA256.toUpperCase(),
      SAMPLE_SHA256.slice(0, 63),
      `${SAMPLE_SHA256}0`,
      'z'.repeat(64),
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, { sha256: badSha })
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_SHA256_DIGEST');
      }
    }

    // 4e. Invalid byteSize
    for (const badSize of [
      0,
      -512,
      1024.5,
      MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1,
      Number.POSITIVE_INFINITY,
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, { byteSize: badSize })
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_BYTE_SIZE');
      }
    }

    // 4f. Mismatched format, extension, MIME, or deepInspectionStatus
    for (const badFormatOverrides of [
      { format: 'pdf' as unknown as 'PDF' },
      { format: 'DOCM' as unknown as 'DOCX' },
      { format: 'PDF' as const, canonicalExtension: 'docx' as const },
      {
        format: 'PDF' as const,
        canonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
      },
      {
        format: 'PDF' as const,
        deepInspectionStatus:
          'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION' as const,
      },
      { format: 'DOCX' as const, canonicalExtension: 'pdf' as const },
      {
        format: 'DOCX' as const,
        canonicalMimeType: CANONICAL_PDF_MIME_TYPE,
      },
      {
        format: 'DOCX' as const,
        deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' as const,
      },
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, badFormatOverrides)
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_FILE_FORMAT_OR_MIME');
      }
    }

    // 4g. Invalid timestamps (non-UTC or updatedAt < createdAt)
    for (const badTimestamps of [
      {
        createdAt: '2026-11-08 10:00:00',
        updatedAt: '2026-11-08T10:00:05.000Z',
      },
      {
        createdAt: '2026-11-08T10:00:10.000Z',
        updatedAt: '2026-11-08T10:00:05.000Z',
      },
      {
        createdAt: 'not-a-timestamp',
        updatedAt: '2026-11-08T10:00:05.000Z',
      },
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, badTimestamps)
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_SOURCE_TIMESTAMPS');
      }
    }

    // 4h. Unsafe or mismatched filenames (HTML, path traversal, control/bidi chars, wrong extension)
    for (const badFilenameOverrides of [
      { originalFilename: '' },
      { originalFilename: '.pdf' },
      { originalFilename: '../secret.pdf' },
      { originalFilename: '<script>alert(1)</script>.pdf' },
      { originalFilename: 'report\u202Efdp.pdf' },
      { originalFilename: 'mismatch.docx' },
      { sanitizedFilename: 'bad"quote.pdf' },
    ]) {
      const res = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, badFilenameOverrides)
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'INVALID_FILENAME');
      }
    }

    console.log(
      'PASS 4: Corrupt revision, receiptId, uploaderUid, sha256, byteSize, format/MIME/inspectionStatus, timestamps, and unsafe filenames are rejected.'
    );
  }

  // Test 5: Secret / internal storage keys, URLs, and binary buffers are rejected without leaking values in error messages
  {
    const secretSentinel = 'SECRET_GENERATION_9988776655';
    const leakedInputs: unknown[] = [
      {
        ...buildValidListItem(3),
        storagePath: `library/quarantine/${SAMPLE_RECEIPT_ID}/source.pdf`,
      },
      {
        ...buildValidListItem(3),
        generation: secretSentinel,
      },
      {
        ...buildValidListItem(3),
        url: 'https://www.eeaa.gov.eg/fake-intake-url.pdf',
      },
      {
        ...buildValidListItem(3),
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      },
      {
        revision: 3,
        adminReceipt: {
          ...buildValidQuarantinedAdminReceipt(),
          generation: secretSentinel,
        },
      },
      buildValidListItem(3, {
        originalFilename:
          'https://storage.googleapis.com/private-bucket/doc.pdf',
      }),
      buildValidListItem(3, {
        originalFilename: 'gs://promiseofplanet-bb325-library-quarantine/x.pdf',
      }),
    ];

    for (const leakedInput of leakedInputs) {
      const res = assessLibraryQuarantineReviewCandidate(leakedInput);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reasonCode, 'UNTRUSTED_OR_SECRET_FIELD_DETECTED');
        assert.equal(res.errorMessage.includes(secretSentinel), false);
        assert.equal(res.errorMessage.includes('gs://'), false);
        assert.equal(res.errorMessage.includes('storage.googleapis.com'), false);
      }
    }

    console.log(
      'PASS 5: Internal storage keys, URLs, gs:// paths, and raw binary buffers are rejected with zero debug/secret leakage.'
    );
  }

  // Test 6: Determinism, version/digest sensitivity, and zero side effects on inputs or workspace files
  {
    const sampleA = buildValidListItem(3, { sha256: SAMPLE_SHA256 });
    const snapshotBefore = JSON.stringify(sampleA);

    const firstEval = assessLibraryQuarantineReviewCandidate(sampleA);
    const secondEval = assessLibraryQuarantineReviewCandidate(sampleA);
    assert.equal(JSON.stringify(sampleA), snapshotBefore);

    assert.equal(firstEval.ok, true);
    assert.equal(secondEval.ok, true);
    if (firstEval.ok && secondEval.ok) {
      assert.deepEqual(firstEval.candidate, secondEval.candidate);
      assert.equal(
        areQuarantineReviewCandidatesSameSourceVersion(
          firstEval.candidate,
          secondEval.candidate
        ),
        true
      );

      // Different revision -> distinct candidate version
      const rev4Eval = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(4, { sha256: SAMPLE_SHA256 })
      );
      assert.equal(rev4Eval.ok, true);
      if (rev4Eval.ok) {
        assert.equal(
          areQuarantineReviewCandidatesSameSourceVersion(
            firstEval.candidate,
            rev4Eval.candidate
          ),
          false
        );
      }

      // Different sha256 -> distinct candidate version
      const diffShaEval = assessLibraryQuarantineReviewCandidate(
        buildValidListItem(3, { sha256: SECOND_SHA256 })
      );
      assert.equal(diffShaEval.ok, true);
      if (diffShaEval.ok) {
        assert.equal(
          areQuarantineReviewCandidatesSameSourceVersion(
            firstEval.candidate,
            diffShaEval.candidate
          ),
          false
        );
      }
    }

    // Explicit source version expectations mismatch fails closed with SOURCE_VERSION_OR_DIGEST_MISMATCH
    for (const mismatchedExpectation of [
      { expectedRevision: 4 },
      { expectedSha256: SECOND_SHA256 },
      { expectedReceiptId: SECOND_RECEIPT_ID },
      { expectedUpdatedAt: '2026-11-08T10:00:09.000Z' },
    ]) {
      const mismatchRes = assessLibraryQuarantineReviewCandidate(
        sampleA,
        mismatchedExpectation
      );
      assert.equal(mismatchRes.ok, false);
      if (!mismatchRes.ok) {
        assert.equal(
          mismatchRes.reasonCode,
          'SOURCE_VERSION_OR_DIGEST_MISMATCH'
        );
      }
    }

    // Verify all 8 preflight read-only files remain untouched at their exact Git blob SHA-1s
    const pinnedReadOnlyFiles: ReadonlyArray<readonly [string, string]> = [
      [
        'functions/src/library/libraryQuarantineReceiptContract.ts',
        '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
      ],
      [
        'functions/src/library/firestoreLibraryQuarantineReceiptStore.ts',
        'd9f4114222851c62c25574efbb0ffbeeb5c355e2',
      ],
      [
        'functions/src/library/libraryQuarantineAdminReadService.ts',
        'fc59ce7350c24ee76f5bd0d6b358196ce48ebc45',
      ],
      [
        'functions/src/shared/libraryContract.ts',
        'cfb0849c0418ba7b075f7de49c3debe668adc724',
      ],
      [
        'functions/src/library/libraryApplicationService.ts',
        '32b54a8946f3749c18b21ab7f4d0fb4c21b2ebcf',
      ],
      [
        'functions/src/library/libraryAdminHandlers.ts',
        '33ef17394a9a0172cd38cc0eaed8db1fe5d3efb6',
      ],
      [
        'scripts/runLibraryQuarantineAdminReadTests.ts',
        '9d2812b4374f5fb207a872869e2f7dab088e7a8f',
      ],
      ['package.json', '34cb668d837d342c9b5367461cca2ad9dd8a18e7'],
    ];

    for (const [relPath, expectedSha1] of pinnedReadOnlyFiles) {
      const { sha1 } = computeGitBlobSha1(relPath);
      assert.equal(
        sha1,
        expectedSha1,
        `Read-only file ${relPath} was modified! Expected ${expectedSha1}, got ${sha1}`
      );
    }

    console.log(
      'PASS 6: Deterministic evaluation, revision/hash version sensitivity, and read-only SHA-1 invariants verified.'
    );
  }

  // Test 7 (LIB-FILE-REVIEW-01A/R1): areQuarantineReviewCandidatesSameSourceVersion strictly validates all candidate invariants even when comparing an object to itself
  {
    const baseEval = assessLibraryQuarantineReviewCandidate(
      buildValidListItem(3, { format: 'PDF' })
    );
    assert.equal(baseEval.ok, true);
    if (!baseEval.ok) {
      throw new Error('Expected baseEval to succeed.');
    }

    const validCandidate = baseEval.candidate;
    const validClone = {
      ...validCandidate,
      deferredGates: [...validCandidate.deferredGates],
    };
    const snapshotBefore = JSON.stringify(validClone);

    // 7a. Valid candidate versus itself and structurally equivalent copy -> true
    assert.equal(
      areQuarantineReviewCandidatesSameSourceVersion(
        validCandidate,
        validCandidate
      ),
      true
    );
    assert.equal(
      areQuarantineReviewCandidatesSameSourceVersion(
        validCandidate,
        validClone
      ),
      true
    );

    // 7b. Invalid sourceFormat ('EXE', 'pdf'), sourceByteSize (-1, 0, over limit, float), and empty/missing/extra/duplicated deferredGates -> false even when compared to itself
    const malformedCandidates: unknown[] = [
      { ...validCandidate, sourceFormat: 'EXE' },
      { ...validCandidate, sourceFormat: 'pdf' },
      { ...validCandidate, sourceByteSize: -1 },
      { ...validCandidate, sourceByteSize: 0 },
      {
        ...validCandidate,
        sourceByteSize: MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1,
      },
      { ...validCandidate, sourceByteSize: 1024.5 },
      { ...validCandidate, deferredGates: [] },
      {
        ...validCandidate,
        deferredGates: LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES.slice(
          0,
          6
        ),
      },
      {
        ...validCandidate,
        deferredGates: [
          ...LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES,
          'EXTRA_UNKNOWN_GATE',
        ],
      },
      {
        ...validCandidate,
        deferredGates: [
          LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES[0],
          LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES[0],
          ...LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES.slice(2),
        ],
      },
      {
        ...validCandidate,
        deferredGates: [
          ...LIBRARY_QUARANTINE_REVIEW_DRAFT_DEFERRED_GATES.slice(0, 6),
          'FORGED_GATE',
        ],
      },
      // 7c. Mismatched MIME/extension/inspection, invalid owner UID, unsafe filenames, reversed timestamps, invalid checksum, wrong flags
      { ...validCandidate, sourceCanonicalExtension: 'docx' },
      {
        ...validCandidate,
        sourceCanonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
      },
      {
        ...validCandidate,
        sourceDeepInspectionStatus:
          'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
      },
      { ...validCandidate, uploaderUid: '' },
      { ...validCandidate, uploaderUid: '../admin' },
      { ...validCandidate, uploaderUid: 'admin/curator' },
      { ...validCandidate, sourceOriginalFilename: '' },
      { ...validCandidate, sourceOriginalFilename: '../secret.pdf' },
      {
        ...validCandidate,
        sourceOriginalFilename: '<script>alert(1)</script>.pdf',
      },
      { ...validCandidate, sourceOriginalFilename: 'wrong-ext.docx' },
      { ...validCandidate, sourceSanitizedFilename: 'bad"quote.pdf' },
      {
        ...validCandidate,
        sourceCreatedAt: '2026-11-08T10:00:10.000Z',
        sourceUpdatedAt: '2026-11-08T10:00:05.000Z',
      },
      { ...validCandidate, sourceSha256: 'not-a-valid-sha256' },
      { ...validCandidate, isQuarantinedPrivateOnly: false },
      { ...validCandidate, isSanitized: true },
      { ...validCandidate, isVerifiedSafe: true },
      { ...validCandidate, isRightsApproved: true },
      { ...validCandidate, isPublished: true },
      { ...validCandidate, isReadyForPeia: true },
      // Extra own key
      { ...validCandidate, extraKey: 'untrusted' },
    ];

    // Missing required own key (even if present on prototype)
    const { uploaderUid: _omittedUid, ...withoutOwnUid } = validCandidate;
    const inheritedUidCandidate = Object.assign(
      Object.create({ uploaderUid: validCandidate.uploaderUid }),
      withoutOwnUid
    );
    malformedCandidates.push(withoutOwnUid, inheritedUidCandidate);

    for (const malformed of malformedCandidates) {
      assert.equal(
        areQuarantineReviewCandidatesSameSourceVersion(malformed, malformed),
        false,
        `Expected self-comparison of malformed candidate to return false: ${JSON.stringify(malformed)}`
      );
      assert.equal(
        areQuarantineReviewCandidatesSameSourceVersion(
          validCandidate,
          malformed
        ),
        false
      );
      assert.equal(
        areQuarantineReviewCandidatesSameSourceVersion(
          malformed,
          validCandidate
        ),
        false
      );
    }

    // 7d. Changed revision, hash, or receiptId between two valid candidates remains false
    for (const validDiffItem of [
      buildValidListItem(4, { format: 'PDF' }),
      buildValidListItem(3, { format: 'PDF', sha256: SECOND_SHA256 }),
      buildValidListItem(3, { format: 'PDF', receiptId: SECOND_RECEIPT_ID }),
    ]) {
      const diffEval = assessLibraryQuarantineReviewCandidate(validDiffItem);
      assert.equal(diffEval.ok, true);
      if (diffEval.ok) {
        assert.equal(
          areQuarantineReviewCandidatesSameSourceVersion(
            validCandidate,
            diffEval.candidate
          ),
          false
        );
      }
    }

    // 7e. Zero input mutation and zero private URL/path/byte leaks
    assert.equal(JSON.stringify(validClone), snapshotBefore);

    console.log(
      'PASS 7: areQuarantineReviewCandidatesSameSourceVersion strictly rejects malformed candidates (including self-comparison) while preserving valid equality.'
    );
  }

  console.log('ALL LIB-FILE-REVIEW-01A CONTRACT TESTS PASSED (7/7).');
}

runAllTests();

