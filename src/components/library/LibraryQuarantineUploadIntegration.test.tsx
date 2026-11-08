import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build as viteBuild } from 'vite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLibraryManagement } from './AdminLibraryManagement';
import { LibraryQuarantineUploadPanel } from './LibraryQuarantineUploadPanel';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  canUploadToLibraryQuarantine,
  LibraryQuarantineUploadSessionController,
  MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES,
  resolveLibraryQuarantineUploadEndpointGate,
  uploadDocumentToLibraryQuarantine,
  validateLibraryQuarantineFileCandidate,
  validateLibraryQuarantineUploadResponse,
  type LibraryQuarantineUploadRuntimeDependencies,
} from '../../services/libraryQuarantineUploadClient';
import { AdminRole, type AdminUser } from '../../types/admin';
import {
  LibraryIntakeStatus,
  type LibraryIntakeRecord,
} from '../../../functions/src/shared/libraryContract';
import type { SanitizedLibraryQuarantineAdminReceiptDto } from '../../../functions/src/library/libraryQuarantineReceiptContract';
import { LibraryAdminClient } from '../../services/libraryAdminClient';

const VERIFIED_ENDPOINT_URL =
  'https://europe-west1-promiseofplanet-bb325.cloudfunctions.net/libraryQuarantineUploadEndpoint';
const SAMPLE_RECEIPT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SAMPLE_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function buildAdminUser(
  role: AdminRole,
  overrides: Partial<AdminUser> = {}
): AdminUser {
  const roleKey = String(role).toLowerCase();
  return {
    id: `admin-${roleKey}`,
    name: `Admin ${String(role)}`,
    email: `${roleKey}@promiseofplanet.org`,
    role,
    isActive: true,
    ...overrides,
  };
}

function buildIntakeRecord(
  overrides: Partial<LibraryIntakeRecord> = {}
): LibraryIntakeRecord {
  return {
    id: 'intake-doc-201',
    url: 'https://www.eeaa.gov.eg/laws/water-protection-2026.pdf',
    normalizedUrl: 'https://www.eeaa.gov.eg/laws/water-protection-2026.pdf',
    title: 'اللائحة التنفيذية لحماية الموارد المائية 2026',
    organizationId: 'org-eeaa',
    sourceId: 'src-gazette',
    language: 'ar',
    notes: 'مرجع خارجي للمراجعة الأولية.',
    status: LibraryIntakeStatus.PendingReview,
    submittedByAdminId: 'admin-librarycurator',
    submittedByAdminName: 'Library Curator',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...overrides,
  };
}

function buildTestFile(
  name: string,
  byteSize: number,
  mimeType: string
): File {
  const content = new Uint8Array(Math.min(byteSize, 64));
  const file = new File([content], name, { type: mimeType });
  if (file.size !== byteSize) {
    Object.defineProperty(file, 'size', {
      value: byteSize,
      writable: false,
      configurable: true,
    });
  }
  return file;
}

function buildSanitizedAdminReceipt(
  overrides: Partial<SanitizedLibraryQuarantineAdminReceiptDto> = {}
): SanitizedLibraryQuarantineAdminReceiptDto {
  return {
    receiptId: SAMPLE_RECEIPT_ID,
    uploaderUid: 'admin-librarycurator',
    originalFilename: 'climate-policy-2026.pdf',
    sanitizedFilename: 'climate-policy-2026.pdf',
    format: 'PDF',
    canonicalExtension: 'pdf',
    canonicalMimeType: CANONICAL_PDF_MIME_TYPE,
    byteSize: 4096,
    sha256: SAMPLE_SHA256,
    state: 'Quarantined',
    deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
    hasVerifiedStorageWrite: true,
    reconciliationRequired: false,
    reconciliationReason: null,
    rejectionReasonCode: null,
    createdAt: '2026-11-07T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:02.000Z',
    isQuarantinedPrivateOnly: true,
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  };
}

function buildQuarantined201Body(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    status: 'QUARANTINED',
    receiptId: SAMPLE_RECEIPT_ID,
    revision: 3,
    adminReceipt: buildSanitizedAdminReceipt(),
    isSanitized: false,
    isVerifiedSafe: false,
    isRightsApproved: false,
    isPublished: false,
    isReadyForPeia: false,
    ...overrides,
  };
}

describe('LIB-FILE-UPLOAD-02 — Admin Library PDF/DOCX Private Quarantine Upload Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Enforces strict human Library RBAC gating and shows entry CTA only in the Intake Inbox tab', () => {
    const owner = buildAdminUser(AdminRole.Owner);
    const curator = buildAdminUser(AdminRole.LibraryCurator);
    const inactiveCurator = buildAdminUser(AdminRole.LibraryCurator, {
      isActive: false,
    });
    const aiAssistant = buildAdminUser(AdminRole.AIAssistant);
    const rightsReviewer = buildAdminUser(AdminRole.RightsReviewer);
    const newsEditor = buildAdminUser(AdminRole.NewsEditor);
    const multimediaProducer = buildAdminUser(AdminRole.MultimediaProducer);
    const financeAuditor = buildAdminUser(AdminRole.FinanceAuditor);
    const translationEditor = buildAdminUser(AdminRole.TranslationEditor);

    expect(canUploadToLibraryQuarantine(owner)).toBe(true);
    expect(canUploadToLibraryQuarantine(curator)).toBe(true);

    expect(canUploadToLibraryQuarantine(inactiveCurator)).toBe(false);
    expect(canUploadToLibraryQuarantine(aiAssistant)).toBe(false);
    expect(canUploadToLibraryQuarantine(rightsReviewer)).toBe(false);
    expect(canUploadToLibraryQuarantine(newsEditor)).toBe(false);
    expect(canUploadToLibraryQuarantine(multimediaProducer)).toBe(false);
    expect(canUploadToLibraryQuarantine(financeAuditor)).toBe(false);
    expect(canUploadToLibraryQuarantine(translationEditor)).toBe(false);
    expect(canUploadToLibraryQuarantine(null)).toBe(false);
    expect(canUploadToLibraryQuarantine(undefined)).toBe(false);

    // Authorized curator in Intake tab sees the button
    const intakeHtmlAr = renderToStaticMarkup(
      <AdminLibraryManagement
        currentUser={curator}
        initialTab="intake"
        initialLoading={false}
        languageOverride="ar"
      />
    );
    expect(intakeHtmlAr).toContain('open-library-quarantine-upload-btn');
    expect(intakeHtmlAr).toContain('رفع مستند إلى الحجر الخاص');
    expect(intakeHtmlAr).toContain('إيداع مرجع خارجي للاستقبال');

    // Authorized curator in Documents tab does NOT see the button in toolbar
    const documentsHtmlAr = renderToStaticMarkup(
      <AdminLibraryManagement
        currentUser={curator}
        initialTab="documents"
        initialLoading={false}
        languageOverride="ar"
      />
    );
    expect(documentsHtmlAr).not.toContain('open-library-quarantine-upload-btn');

    // Unauthorized role in Intake tab does NOT see the button or modal
    const unauthorizedHtml = renderToStaticMarkup(
      <AdminLibraryManagement
        currentUser={rightsReviewer}
        initialTab="intake"
        initialLoading={false}
        initialQuarantineUploadOpen={true}
        languageOverride="en"
      />
    );
    expect(unauthorizedHtml).not.toContain('open-library-quarantine-upload-btn');
    expect(unauthorizedHtml).not.toContain('library-quarantine-upload-modal');
  });

  it('2. Enforces the hard deployment & endpoint origin gate (disabled by default, rejects unconfigured or unverified origins)', () => {
    // Default environment (no VITE_LIBRARY_QUARANTINE_UPLOAD_ENABLED)
    const defaultGate = resolveLibraryQuarantineUploadEndpointGate({});
    expect(defaultGate.enabled).toBe(false);
    expect(defaultGate.status).toBe('DISABLED_BY_DEFAULT');
    expect(defaultGate.endpointUrl).toBeNull();

    // Enabled flag true, but URL missing
    const unconfiguredGate = resolveLibraryQuarantineUploadEndpointGate({
      enabledFlag: 'true',
      endpointUrl: '   ',
    });
    expect(unconfiguredGate.enabled).toBe(false);
    expect(unconfiguredGate.status).toBe('ENDPOINT_UNCONFIGURED');
    expect(unconfiguredGate.endpointUrl).toBeNull();

    // Rejects non-HTTPS, third-party domain, query string, or wrong function path
    for (const badUrl of [
      'http://europe-west1-promiseofplanet-bb325.cloudfunctions.net/libraryQuarantineUploadEndpoint',
      'https://evil.example.com/libraryQuarantineUploadEndpoint',
      'https://europe-west1-promiseofplanet-bb325.cloudfunctions.net/otherEndpoint',
      'https://europe-west1-promiseofplanet-bb325.cloudfunctions.net/libraryQuarantineUploadEndpoint?token=secret',
      'https://user:pass@europe-west1-promiseofplanet-bb325.cloudfunctions.net/libraryQuarantineUploadEndpoint',
    ]) {
      const badGate = resolveLibraryQuarantineUploadEndpointGate({
        enabledFlag: 'true',
        endpointUrl: badUrl,
      });
      expect(badGate.enabled).toBe(false);
      expect(badGate.status).toBe('ENDPOINT_ORIGIN_UNVERIFIED');
      expect(badGate.endpointUrl).toBeNull();
    }

    // Accepts verified project Functions HTTPS URL when explicitly enabled
    const readyGate = resolveLibraryQuarantineUploadEndpointGate({
      enabledFlag: 'true',
      endpointUrl: `${VERIFIED_ENDPOINT_URL}/`,
    });
    expect(readyGate.enabled).toBe(true);
    expect(readyGate.status).toBe('READY');
    expect(readyGate.endpointUrl).toBe(VERIFIED_ENDPOINT_URL);

    // Disabled panel renders explanatory banner and disabled submit button
    const curator = buildAdminUser(AdminRole.LibraryCurator);
    const disabledPanelHtml = renderToStaticMarkup(
      <LibraryQuarantineUploadPanel
        currentUser={curator}
        isOpen={true}
        onClose={() => {}}
        isAr={false}
        runtimeDependencies={{
          envOverrides: { enabledFlag: 'false', endpointUrl: '' },
        }}
      />
    );
    expect(disabledPanelHtml).toContain(
      'library-quarantine-gate-disabled-banner'
    );
    expect(disabledPanelHtml).toContain('DISABLED_BY_DEFAULT');
    expect(disabledPanelHtml).toContain(
      'Upload Currently Unavailable Pending Backend Endpoint Activation'
    );
  });

  it('3. Validates PDF/DOCX file selection, exact 15,000,000-byte ceiling, 0-byte rejection, and MIME consistency', () => {
    const validPdf = buildTestFile(
      'report-2026.PDF',
      15_000_000,
      CANONICAL_PDF_MIME_TYPE
    );
    const pdfResult = validateLibraryQuarantineFileCandidate(validPdf);
    expect(pdfResult).toEqual({
      ok: true,
      format: 'pdf',
      canonicalExtension: '.pdf',
      canonicalMimeType: CANONICAL_PDF_MIME_TYPE,
      originalFilename: 'report-2026.PDF',
      byteSize: 15_000_000,
    });

    const validDocx = buildTestFile(
      'treaty-draft.docx',
      24_576,
      CANONICAL_DOCX_MIME_TYPE
    );
    const docxResult = validateLibraryQuarantineFileCandidate(validDocx);
    expect(docxResult).toEqual({
      ok: true,
      format: 'docx',
      canonicalExtension: '.docx',
      canonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
      originalFilename: 'treaty-draft.docx',
      byteSize: 24_576,
    });

    // 15,000,001 bytes rejected (decimal 15,000,000 limit, not 15 MiB)
    const oversizePdf = buildTestFile(
      'oversize.pdf',
      MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES + 1,
      CANONICAL_PDF_MIME_TYPE
    );
    const oversizeResult = validateLibraryQuarantineFileCandidate(oversizePdf);
    expect(oversizeResult.ok).toBe(false);
    if (!oversizeResult.ok) {
      expect(oversizeResult.errorCode).toBe('SIZE_LIMIT_EXCEEDED');
    }

    // 0-byte file rejected
    const emptyPdf = buildTestFile('empty.pdf', 0, CANONICAL_PDF_MIME_TYPE);
    const emptyResult = validateLibraryQuarantineFileCandidate(emptyPdf);
    expect(emptyResult.ok).toBe(false);
    if (!emptyResult.ok) {
      expect(emptyResult.errorCode).toBe('EMPTY_BINARY');
    }

    // Macro / unsupported extensions rejected
    for (const badName of [
      'macro.docm',
      'legacy.doc',
      'script.exe',
      'archive.zip',
      '.pdf',
    ]) {
      const badExtFile = buildTestFile(badName, 1024, 'application/octet-stream');
      const res = validateLibraryQuarantineFileCandidate(badExtFile);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorCode).toBe('UNSUPPORTED_EXTENSION');
      }
    }

    // Path traversal filename rejected
    const traversalFile = buildTestFile(
      '../secret.pdf',
      1024,
      CANONICAL_PDF_MIME_TYPE
    );
    const traversalRes = validateLibraryQuarantineFileCandidate(traversalFile);
    expect(traversalRes.ok).toBe(false);
    if (!traversalRes.ok) {
      expect(traversalRes.errorCode).toBe('INVALID_FILENAME');
    }

    // Claimed MIME mismatch rejected
    const mismatchedMimeFile = buildTestFile(
      'disguised.pdf',
      1024,
      CANONICAL_DOCX_MIME_TYPE
    );
    const mismatchRes = validateLibraryQuarantineFileCandidate(mismatchedMimeFile);
    expect(mismatchRes.ok).toBe(false);
    if (!mismatchRes.ok) {
      expect(mismatchRes.errorCode).toBe('CLAIMED_MIME_MISMATCH');
    }
  });

  it('4. Sends raw binary File via POST with a fresh Bearer ID token and never uses FormData, Content-Length, or callable RPCs', async () => {
    const curator = buildAdminUser(AdminRole.LibraryCurator);
    const pdfFile = buildTestFile(
      'الإطار الوطني للمناخ 2026.pdf',
      4096,
      CANONICAL_PDF_MIME_TYPE
    );

    const getFreshIdToken = vi.fn(async () => 'fresh-id-token-abc-123');
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(buildQuarantined201Body()), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await uploadDocumentToLibraryQuarantine(curator, pdfFile, {
      getFreshIdToken,
      fetchFn: fetchMock as unknown as typeof fetch,
      envOverrides: {
        enabledFlag: 'true',
        endpointUrl: VERIFIED_ENDPOINT_URL,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe('QUARANTINED');
      expect(result.receiptId).toBe(SAMPLE_RECEIPT_ID);
      expect(result.revision).toBe(3);
      expect(result.adminReceipt.format).toBe('PDF');
      expect(result.adminReceipt.canonicalExtension).toBe('pdf');
      expect(result.adminReceipt.state).toBe('Quarantined');
      expect(result.adminReceipt.hasVerifiedStorageWrite).toBe(true);
      expect(result.adminReceipt.isQuarantinedPrivateOnly).toBe(true);
      expect(result.adminReceipt.isPublished).toBe(false);
      expect(result.adminReceipt.isRightsApproved).toBe(false);
      expect(result.adminReceipt.isSanitized).toBe(false);
      expect(result.adminReceipt.isVerifiedSafe).toBe(false);
      expect(result.adminReceipt.isReadyForPeia).toBe(false);
    }

    expect(getFreshIdToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(VERIFIED_ENDPOINT_URL);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.credentials).toBe('omit');
    expect(calledInit.body).toBe(pdfFile);
    expect(calledInit.body instanceof FormData).toBe(false);

    const headers = calledInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fresh-id-token-abc-123');
    expect(headers['Content-Type']).toBe(CANONICAL_PDF_MIME_TYPE);
    expect(headers['X-Original-Filename']).toBe(
      encodeURIComponent('الإطار الوطني للمناخ 2026.pdf')
    );
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain(
      'content-length'
    );
  });

  it('5. Accepts server-shaped PDF and DOCX HTTP 201 receipts and rejects lowercase formats, mismatched extension/MIME, unverified writes, or leaked internal storage data', () => {
    // 5a. Valid server-shaped PDF HTTP 201 succeeds as QUARANTINED
    const validPdfRes = validateLibraryQuarantineUploadResponse(
      201,
      buildQuarantined201Body()
    );
    expect(validPdfRes.ok).toBe(true);
    if (validPdfRes.ok) {
      expect(validPdfRes.outcome).toBe('QUARANTINED');
      expect(validPdfRes.adminReceipt.format).toBe('PDF');
      expect(validPdfRes.adminReceipt.canonicalExtension).toBe('pdf');
      expect(validPdfRes.adminReceipt.canonicalMimeType).toBe(
        CANONICAL_PDF_MIME_TYPE
      );
      expect(validPdfRes.adminReceipt.deepInspectionStatus).toBe(
        'PDF_REQUIRES_ISOLATED_PARSER'
      );
    }

    // 5b. Valid server-shaped DOCX HTTP 201 succeeds as QUARANTINED
    const validDocxRes = validateLibraryQuarantineUploadResponse(
      201,
      buildQuarantined201Body({
        adminReceipt: buildSanitizedAdminReceipt({
          originalFilename: 'treaty-draft-2026.docx',
          sanitizedFilename: 'treaty-draft-2026.docx',
          format: 'DOCX',
          canonicalExtension: 'docx',
          canonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
          deepInspectionStatus: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
        }),
      })
    );
    expect(validDocxRes.ok).toBe(true);
    if (validDocxRes.ok) {
      expect(validDocxRes.outcome).toBe('QUARANTINED');
      expect(validDocxRes.adminReceipt.format).toBe('DOCX');
      expect(validDocxRes.adminReceipt.canonicalExtension).toBe('docx');
      expect(validDocxRes.adminReceipt.canonicalMimeType).toBe(
        CANONICAL_DOCX_MIME_TYPE
      );
      expect(validDocxRes.adminReceipt.deepInspectionStatus).toBe(
        'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'
      );
    }

    // 5c. Lowercase server receipt format ('pdf' or 'docx') is strictly rejected
    for (const lowercaseFormat of ['pdf', 'docx']) {
      const lowercaseFormatRes = validateLibraryQuarantineUploadResponse(
        201,
        buildQuarantined201Body({
          adminReceipt: {
            ...buildSanitizedAdminReceipt(),
            format: lowercaseFormat,
          },
        })
      );
      expect(lowercaseFormatRes.ok).toBe(false);
      if (!lowercaseFormatRes.ok) {
        expect(lowercaseFormatRes.outcome).toBe('UPLOAD_OUTCOME_UNCERTAIN');
        expect(lowercaseFormatRes.errorCode).toBe(
          'INVALID_QUARANTINED_RECEIPT_INVARIANT'
        );
      }
    }

    // 5d. Mismatched extension, MIME, or deepInspectionStatus is strictly rejected
    for (const mismatchedReceipt of [
      {
        ...buildSanitizedAdminReceipt(),
        format: 'PDF',
        canonicalExtension: 'docx',
      },
      {
        ...buildSanitizedAdminReceipt(),
        format: 'PDF',
        canonicalExtension: '.pdf',
      },
      {
        ...buildSanitizedAdminReceipt(),
        format: 'PDF',
        canonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
      },
      {
        ...buildSanitizedAdminReceipt(),
        format: 'PDF',
        deepInspectionStatus: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
      },
      {
        ...buildSanitizedAdminReceipt({
          format: 'DOCX',
          canonicalExtension: 'docx',
          canonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
          deepInspectionStatus: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
        }),
        canonicalExtension: 'pdf',
      },
      {
        ...buildSanitizedAdminReceipt({
          format: 'DOCX',
          canonicalExtension: 'docx',
          canonicalMimeType: CANONICAL_DOCX_MIME_TYPE,
          deepInspectionStatus: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION',
        }),
        canonicalMimeType: CANONICAL_PDF_MIME_TYPE,
      },
    ]) {
      const mismatchRes = validateLibraryQuarantineUploadResponse(
        201,
        buildQuarantined201Body({ adminReceipt: mismatchedReceipt })
      );
      expect(mismatchRes.ok).toBe(false);
      if (!mismatchRes.ok) {
        expect(mismatchRes.outcome).toBe('UPLOAD_OUTCOME_UNCERTAIN');
        expect(mismatchRes.errorCode).toBe(
          'INVALID_QUARANTINED_RECEIPT_INVARIANT'
        );
      }
    }

    // 5e. Mismatched receiptId between top-level and adminReceipt
    const mismatchedIdRes = validateLibraryQuarantineUploadResponse(
      201,
      buildQuarantined201Body({
        receiptId: 'ffffffffffffffffffffffffffffffff',
      })
    );
    expect(mismatchedIdRes.ok).toBe(false);
    if (!mismatchedIdRes.ok) {
      expect(mismatchedIdRes.outcome).toBe('UPLOAD_OUTCOME_UNCERTAIN');
    }

    // 5f. Posture flag true on 201 fails closed
    const badPostureRes = validateLibraryQuarantineUploadResponse(
      201,
      buildQuarantined201Body({
        isReadyForPeia: true,
      })
    );
    expect(badPostureRes.ok).toBe(false);
    if (!badPostureRes.ok) {
      expect(badPostureRes.outcome).toBe('UPLOAD_OUTCOME_UNCERTAIN');
    }

    // 5g. hasVerifiedStorageWrite: false on 201 fails closed
    const unverifiedWriteRes = validateLibraryQuarantineUploadResponse(
      201,
      buildQuarantined201Body({
        adminReceipt: buildSanitizedAdminReceipt({
          hasVerifiedStorageWrite: false,
        }),
      })
    );
    expect(unverifiedWriteRes.ok).toBe(false);

    // 5h. Leaked storagePath, bucket, generation, or gs:// URI fails closed
    for (const leakedPayload of [
      { ...buildQuarantined201Body(), storagePath: 'library-quarantine/uploads/x' },
      { ...buildQuarantined201Body(), bucket: 'promiseofplanet-bb325-library-quarantine' },
      { ...buildQuarantined201Body(), generation: '1730981122334455' },
      { ...buildQuarantined201Body(), signedUrl: 'https://storage.googleapis.com/x' },
      buildQuarantined201Body({
        adminReceipt: buildSanitizedAdminReceipt({
          reconciliationReason: 'gs://promiseofplanet-bb325-library-quarantine/secret',
        }),
      }),
    ]) {
      const leakRes = validateLibraryQuarantineUploadResponse(201, leakedPayload);
      expect(leakRes.ok).toBe(false);
      if (!leakRes.ok) {
        expect(leakRes.outcome).toBe('UPLOAD_OUTCOME_UNCERTAIN');
        expect(leakRes.errorCode).toBe('INVALID_SERVER_RESPONSE_CONTRACT');
      }
    }
  });

  it('6. Handles 503 NEEDS_RECONCILIATION and PERSISTENCE_UNCERTAIN (with and without receiptId) and network failure without automatic retry', async () => {
    const curator = buildAdminUser(AdminRole.LibraryCurator);
    const pdfFile = buildTestFile('policy.pdf', 2048, CANONICAL_PDF_MIME_TYPE);

    // 6a. 503 NEEDS_RECONCILIATION with receiptId
    const fetchReconcileWithId = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'NEEDS_RECONCILIATION',
          errorCode: 'FINALIZE_CAS_FAILED_RECONCILIATION_RECORDED',
          receiptId: SAMPLE_RECEIPT_ID,
          revision: 3,
          reconciliationPersisted: true,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const reconcileWithIdResult = await uploadDocumentToLibraryQuarantine(
      curator,
      pdfFile,
      {
        getFreshIdToken: async () => 'token-1',
        fetchFn: fetchReconcileWithId as unknown as typeof fetch,
        envOverrides: {
          enabledFlag: 'true',
          endpointUrl: VERIFIED_ENDPOINT_URL,
        },
      }
    );

    expect(fetchReconcileWithId).toHaveBeenCalledTimes(1);
    expect(reconcileWithIdResult.ok).toBe(false);
    if (!reconcileWithIdResult.ok) {
      expect(reconcileWithIdResult.outcome).toBe('NEEDS_RECONCILIATION');
      expect(reconcileWithIdResult.receiptId).toBe(SAMPLE_RECEIPT_ID);
      expect(reconcileWithIdResult.requiresUncertaintyAck).toBe(true);
    }

    // 6b. 503 PERSISTENCE_UNCERTAIN without receiptId
    const fetchUncertainWithoutId = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'PERSISTENCE_UNCERTAIN',
          errorCode: 'FINALIZE_AND_RECONCILIATION_UNCERTAIN',
          reconciliationPersisted: false,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const uncertainNoIdResult = await uploadDocumentToLibraryQuarantine(
      curator,
      pdfFile,
      {
        getFreshIdToken: async () => 'token-2',
        fetchFn: fetchUncertainWithoutId as unknown as typeof fetch,
        envOverrides: {
          enabledFlag: 'true',
          endpointUrl: VERIFIED_ENDPOINT_URL,
        },
      }
    );

    expect(fetchUncertainWithoutId).toHaveBeenCalledTimes(1);
    expect(uncertainNoIdResult.ok).toBe(false);
    if (!uncertainNoIdResult.ok) {
      expect(uncertainNoIdResult.outcome).toBe('PERSISTENCE_UNCERTAIN');
      expect(uncertainNoIdResult.receiptId).toBeNull();
      expect(uncertainNoIdResult.requiresUncertaintyAck).toBe(true);
    }

    // 6c. Network timeout / connection drop -> UPLOAD_OUTCOME_UNCERTAIN (never mislabelled as REJECTED, zero retries)
    const fetchNetworkError = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const networkFailureResult = await uploadDocumentToLibraryQuarantine(
      curator,
      pdfFile,
      {
        getFreshIdToken: async () => 'token-3',
        fetchFn: fetchNetworkError as unknown as typeof fetch,
        envOverrides: {
          enabledFlag: 'true',
          endpointUrl: VERIFIED_ENDPOINT_URL,
        },
      }
    );

    expect(fetchNetworkError).toHaveBeenCalledTimes(1);
    expect(networkFailureResult.ok).toBe(false);
    if (!networkFailureResult.ok) {
      expect(networkFailureResult.outcome).toBe('UPLOAD_OUTCOME_UNCERTAIN');
      expect(networkFailureResult.messageAr).toContain('نتيجة الرفع غير مؤكدة');
      expect(networkFailureResult.messageEn).toContain('Upload outcome uncertain');
      expect(networkFailureResult.requiresUncertaintyAck).toBe(true);
    }
  });

  it('7. Prevents duplicate in-flight submissions, isolates stale responses after close/switch, and preserves uncertain outcomes until acknowledged', async () => {
    const curator = buildAdminUser(AdminRole.LibraryCurator);
    const pdfFile = buildTestFile('doc-1.pdf', 2048, CANONICAL_PDF_MIME_TYPE);

    let resolveFetch!: (value: Response) => void;
    const delayedFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const deps: LibraryQuarantineUploadRuntimeDependencies = {
      getFreshIdToken: async () => 'token-inflight',
      fetchFn: delayedFetch as unknown as typeof fetch,
      envOverrides: {
        enabledFlag: 'true',
        endpointUrl: VERIFIED_ENDPOINT_URL,
      },
    };

    const controller = new LibraryQuarantineUploadSessionController(
      curator,
      deps,
      true
    );
    controller.selectFile(pdfFile);

    // Start first submission
    const firstPromise = controller.submitSelectedFile();
    expect(controller.getSnapshot().isUploading).toBe(true);

    // Second click while in-flight is ignored
    const duplicateAttempt = await controller.submitSelectedFile();
    expect(duplicateAttempt).toBeNull();
    expect(delayedFetch).toHaveBeenCalledTimes(1);

    // Close panel while request is still in flight -> invalidates sessionToken
    controller.closePanel();
    expect(controller.getSnapshot().isOpen).toBe(false);
    expect(controller.getSnapshot().isUploading).toBe(false);

    // Resolve the stale in-flight request with 201 QUARANTINED
    resolveFetch(
      new Response(JSON.stringify(buildQuarantined201Body()), { status: 201 })
    );
    const staleOutcome = await firstPromise;
    expect(staleOutcome).toBeNull();
    expect(controller.getSnapshot().lastResult).toBeNull();

    // Now test an uncertain 503 response: must remain preserved until explicitly acknowledged
    const uncertainFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'NEEDS_RECONCILIATION',
          errorCode: 'FINALIZE_CAS_FAILED_RECONCILIATION_RECORDED',
          receiptId: SAMPLE_RECEIPT_ID,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
        { status: 503 }
      );
    });

    controller.setDependencies({
      ...deps,
      fetchFn: uncertainFetch as unknown as typeof fetch,
    });
    controller.openPanel();
    controller.selectFile(pdfFile);
    await controller.submitSelectedFile();

    expect(controller.getSnapshot().unacknowledgedUncertainResult).not.toBeNull();
    expect(
      controller.getSnapshot().unacknowledgedUncertainResult?.receiptId
    ).toBe(SAMPLE_RECEIPT_ID);

    // Cannot start another upload before acknowledging the uncertain result
    controller.selectFile(pdfFile);
    const blockedSubmit = await controller.submitSelectedFile();
    expect(blockedSubmit).toBeNull();
    expect(uncertainFetch).toHaveBeenCalledTimes(1);

    // Acknowledge uncertain result clears the lock
    controller.acknowledgeUncertainResult();
    expect(controller.getSnapshot().unacknowledgedUncertainResult).toBeNull();
  });

  it('8. Renders bilingual Arabic (RTL) and English (LTR) responsive markup and does not mutate intakeRecords, documents, or PEIA', async () => {
    const curator = buildAdminUser(AdminRole.LibraryCurator);
    const initialIntake = buildIntakeRecord();
    const submitIntakeSpy = vi.spyOn(LibraryAdminClient, 'submitIntake');
    const requestPeiaSpy = vi.spyOn(
      LibraryAdminClient,
      'requestIntakePeiaPreparation'
    );

    const deps: LibraryQuarantineUploadRuntimeDependencies = {
      getFreshIdToken: async () => 'token-ui-test',
      fetchFn: vi.fn(async () => {
        return new Response(JSON.stringify(buildQuarantined201Body()), {
          status: 201,
        });
      }) as unknown as typeof fetch,
      envOverrides: {
        enabledFlag: 'true',
        endpointUrl: VERIFIED_ENDPOINT_URL,
      },
    };

    const controller = new LibraryQuarantineUploadSessionController(
      curator,
      deps,
      true
    );
    controller.selectFile(
      buildTestFile('climate-policy-2026.pdf', 4096, CANONICAL_PDF_MIME_TYPE)
    );
    await controller.submitSelectedFile();

    const htmlAr = renderToStaticMarkup(
      <AdminLibraryManagement
        currentUser={curator}
        initialTab="intake"
        initialLoading={false}
        initialIntakeRecords={[initialIntake]}
        initialQuarantineUploadOpen={true}
        quarantineUploadRuntimeDeps={deps}
        quarantineUploadController={controller}
        languageOverride="ar"
      />
    );

    expect(htmlAr).toContain('dir="rtl"');
    expect(htmlAr).toContain('max-w-xl');
    expect(htmlAr).toContain('library-quarantine-success-receipt');
    expect(htmlAr).toContain(SAMPLE_RECEIPT_ID);
    expect(htmlAr).toContain('isQuarantinedPrivateOnly: true');
    expect(htmlAr).toContain('isReadyForPeia: false');
    expect(htmlAr).toContain(initialIntake.title);

    const htmlEn = renderToStaticMarkup(
      <AdminLibraryManagement
        currentUser={curator}
        initialTab="intake"
        initialLoading={false}
        initialIntakeRecords={[initialIntake]}
        initialQuarantineUploadOpen={true}
        quarantineUploadRuntimeDeps={deps}
        quarantineUploadController={controller}
        languageOverride="en"
      />
    );

    expect(htmlEn).toContain('dir="ltr"');
    expect(htmlEn).toContain(
      'Private Quarantine Receipt Verified (QUARANTINED)'
    );
    expect(htmlEn).toContain(SAMPLE_RECEIPT_ID);

    // Zero calls to intake submission or PEIA preparation
    expect(submitIntakeSpy).not.toHaveBeenCalled();
    expect(requestPeiaSpy).not.toHaveBeenCalled();
  });

  it('9. Enforces browser/Node import boundary: zero runtime imports of server/Node modules and clean browser Rollup module graph without node:buffer externalization', async () => {
    const frontendEntryFiles = [
      'src/services/libraryQuarantineUploadClient.ts',
      'src/components/library/LibraryQuarantineUploadPanel.tsx',
      'src/components/library/AdminLibraryManagement.tsx',
    ];

    const forbiddenServerOrNodeSpecifiers = [
      'libraryQuarantineReceiptContract',
      'libraryUploadBinaryAdmission',
      'libraryUploadDeepStructure',
      'libraryQuarantineUploadEndpoint',
      'firestoreLibraryQuarantineReceiptStore',
      'gcsLibraryQuarantineStorageAdapter',
      'libraryQuarantineWriteCoordinator',
      'libraryQuarantineRecoveryCoordinator',
      'node:buffer',
      'node:crypto',
      'node:zlib',
      'firebase-admin',
    ];

    for (const relPath of frontendEntryFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      const source = fs.readFileSync(absPath, 'utf8');

      // Match all static import statements (multiline-safe)
      const importRegex =
        /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(source)) !== null) {
        const isTypeOnlyImport = Boolean(match[1]);
        const clause = match[2].trim();
        const specifier = match[3];

        const matchesForbiddenServerModule =
          forbiddenServerOrNodeSpecifiers.some((forbidden) =>
            specifier.includes(forbidden)
          );

        if (matchesForbiddenServerModule) {
          // If a forbidden server module is referenced for TypeScript types, it MUST be a pure type import
          const isPureInlineTypeImport =
            clause.startsWith('{') &&
            clause.endsWith('}') &&
            clause
              .slice(1, -1)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .every((part) => part.startsWith('type '));

          expect(
            isTypeOnlyImport || isPureInlineTypeImport,
            `Runtime import of "${specifier}" found in ${relPath}: ${match[0]}`
          ).toBe(true);
        }
      }

      // Also forbid bare side-effect imports or dynamic imports of server/Node modules
      for (const forbidden of forbiddenServerOrNodeSpecifiers) {
        expect(source).not.toMatch(
          new RegExp(`import\\s*\\(\\s*['"][^'"]*${forbidden}[^'"]*['"]\\s*\\)`)
        );
        expect(source).not.toMatch(
          new RegExp(`require\\s*\\(\\s*['"][^'"]*${forbidden}[^'"]*['"]\\s*\\)`)
        );
      }
    }

    // Verify actual Vite browser Rollup module graph for LibraryQuarantineUploadPanel + client
    const buildOutput = await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        lib: {
          entry: path.resolve(
            process.cwd(),
            'src/components/library/LibraryQuarantineUploadPanel.tsx'
          ),
          formats: ['es'],
          fileName: 'library-quarantine-panel-browser-check',
        },
        rollupOptions: {
          external: [/^react(\/|$)/, /^lucide-react(\/|$)/, /^firebase(\/|$)/],
        },
      },
    });

    const outputs = Array.isArray(buildOutput) ? buildOutput : [buildOutput];
    const bundledModuleIds: string[] = [];
    let bundledCode = '';

    for (const out of outputs) {
      if ('output' in out) {
        for (const chunk of out.output) {
          if (chunk.type === 'chunk') {
            bundledCode += chunk.code;
            bundledModuleIds.push(...Object.keys(chunk.modules));
          }
        }
      }
    }

    expect(bundledModuleIds.length).toBeGreaterThan(0);
    for (const modId of bundledModuleIds) {
      for (const forbidden of forbiddenServerOrNodeSpecifiers) {
        expect(modId).not.toContain(forbidden);
      }
    }

    expect(bundledCode).not.toContain('node:buffer');
    expect(bundledCode).not.toContain('node:crypto');
    expect(bundledCode).not.toContain('node:zlib');
    expect(bundledCode).not.toContain('__vite-browser-external');
  });
});
