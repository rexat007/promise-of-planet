import type { AdminRepository } from '../admin/adminRepository';
import { AdminAuthorizationService } from '../admin/adminAuthorizationService';
import { AdminRole, AdminPermission } from '../types/admin';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from './firestoreLibraryQuarantineReceiptStore';
import {
  LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION,
  type LibraryQuarantinePersistedReviewDraft,
} from './firestoreLibraryQuarantineReviewDraftStore';
import {
  LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION,
  type LibraryQuarantinePersistedHumanReviewCase,
} from './firestoreLibraryQuarantineHumanReviewCaseStore';
import {
  LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION,
  type LibraryQuarantinePersistedCatalogHandoff,
} from './libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_DOCUMENTS_COLLECTION,
} from './libraryQuarantineCatalogHandoffService';
import {
  LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION,
  type LibraryQuarantinePersistedCatalogCaseAlignment,
} from './libraryQuarantineCatalogCaseAlignmentService';
import {
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION,
  type LibraryQuarantineBinarySafetyCaseStorePort,
  type LibraryQuarantineBinarySafetyCaseFirestoreDatabase,
} from './firestoreLibraryQuarantineBinarySafetyCaseStore';
import {
  LibraryQuarantinePersistedBinarySafetyCase,
  LibraryQuarantinePersistedBinarySafetyCaseEvent,
  SanitizedLibraryQuarantineBinarySafetyCaseDto,
  LibraryQuarantineReadinessIndicatorsDto,
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
  LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION,
  validateSaveLibraryQuarantineBinarySafetyCaseInput,
} from './libraryQuarantineBinarySafetyCaseContract';
import {
  isValidLibraryQuarantineReceiptId,
  isValidUploaderUid,
} from './libraryQuarantineReceiptContract';

class ServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface LibraryQuarantineBinarySafetyCaseServiceDependencies {
  readonly trustedPrincipalProvider: {
    readonly resolveAuthenticatedPrincipal: () => {
      readonly uid: string;
      readonly token?: Record<string, unknown>;
    };
  };
  readonly adminRepository: AdminRepository;
  readonly db: LibraryQuarantineBinarySafetyCaseFirestoreDatabase;
  readonly clock?: () => string;
}

export type GetLibraryQuarantineBinarySafetyCaseOutcome =
  | 'READY'
  | 'NOT_FOUND'
  | 'HOLD';

export type SaveLibraryQuarantineBinarySafetyCaseOutcome =
  | 'SAVED'
  | 'CONFLICT'
  | 'HOLD'
  | 'UNKNOWN';

export interface GetLibraryQuarantineBinarySafetyCaseSuccessDto {
  readonly ok: true;
  readonly outcome: 'READY';
  readonly receiptId: string;
  readonly documentId: string;
  readonly currentRevision: number;
  readonly isCaseCurrent: boolean;
  readonly requiresFreshEvidence: boolean;
  readonly sourceFormat: string;
  readonly deepInspectionStatus: string;
  readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
  readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
}

export interface GetLibraryQuarantineBinarySafetyCaseHoldDto {
  readonly ok: false;
  readonly outcome: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface GetLibraryQuarantineBinarySafetyCaseNotFoundDto {
  readonly ok: false;
  readonly outcome: 'NOT_FOUND';
  readonly errorCode: 'QUARANTINE_RECEIPT_NOT_FOUND';
  readonly errorMessage: string;
}

export type GetLibraryQuarantineBinarySafetyCaseResponseDto =
  | GetLibraryQuarantineBinarySafetyCaseSuccessDto
  | GetLibraryQuarantineBinarySafetyCaseHoldDto
  | GetLibraryQuarantineBinarySafetyCaseNotFoundDto;

export interface SaveLibraryQuarantineBinarySafetyCaseSuccessDto {
  readonly ok: true;
  readonly outcome: 'SAVED';
  readonly receiptId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto;
}

export interface SaveLibraryQuarantineBinarySafetyCaseConflictDto {
  readonly ok: false;
  readonly outcome: 'CONFLICT';
  readonly errorCode: 'BINARY_SAFETY_REVISION_CONFLICT';
  readonly errorMessage: string;
  readonly currentRevision: number;
  readonly currentBinarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
}

export interface SaveLibraryQuarantineBinarySafetyCaseHoldDto {
  readonly ok: false;
  readonly outcome: 'HOLD';
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface SaveLibraryQuarantineBinarySafetyCaseUnknownDto {
  readonly ok: false;
  readonly outcome: 'UNKNOWN';
  readonly errorCode: 'TRANSACTION_COMMIT_UNCERTAIN';
  readonly errorMessage: string;
  readonly caseSaved: null;
}

export type SaveLibraryQuarantineBinarySafetyCaseResponseDto =
  | SaveLibraryQuarantineBinarySafetyCaseSuccessDto
  | SaveLibraryQuarantineBinarySafetyCaseConflictDto
  | SaveLibraryQuarantineBinarySafetyCaseHoldDto
  | SaveLibraryQuarantineBinarySafetyCaseUnknownDto;

export class LibraryQuarantineBinarySafetyCaseService {
  constructor(private readonly deps: LibraryQuarantineBinarySafetyCaseServiceDependencies) {}

  private nowIso(): string {
    return this.deps.clock ? this.deps.clock() : new Date().toISOString();
  }

  private async assertOwnerPrincipal(): Promise<string> {
    const principal = this.deps.trustedPrincipalProvider.resolveAuthenticatedPrincipal();
    const uid = typeof principal?.uid === 'string' ? principal.uid.trim() : '';
    if (!isValidUploaderUid(uid)) {
      throw new ServiceError('unauthenticated', 'UNAUTHENTICATED: Valid authenticated principal required.');
    }

    const adminUser = await this.deps.adminRepository.getAdminByUid(uid);
    if (!adminUser || !adminUser.isActive) {
      throw new ServiceError('permission-denied', 'UNAUTHORIZED_BINARY_SAFETY_ACTOR: Admin user not found or inactive.');
    }

    if (
      adminUser.role !== AdminRole.Owner ||
      !AdminAuthorizationService.hasPermission(adminUser, AdminPermission.Review)
    ) {
      throw new ServiceError(
        'permission-denied',
        `INSUFFICIENT_PERMISSION: Role ${adminUser.role} lacks Owner role and Review permission required for binary safety cases.`
      );
    }

    return uid;
  }

  private async perform7PointReads(receiptId: string): Promise<{
    readonly envelope: LibraryQuarantinePersistedReceiptEnvelope;
    readonly draft: LibraryQuarantinePersistedReviewDraft;
    readonly humanCase: LibraryQuarantinePersistedHumanReviewCase;
    readonly handoff: LibraryQuarantinePersistedCatalogHandoff;
    readonly catalogDoc: any;
    readonly alignment: LibraryQuarantinePersistedCatalogCaseAlignment | null;
    readonly safetyCase: LibraryQuarantinePersistedBinarySafetyCase | null;
  }> {
    const db = this.deps.db;
    const receiptRef = db.collection(LIBRARY_QUARANTINE_RECEIPT_COLLECTION).doc(receiptId);
    const draftRef = db.collection(LIBRARY_QUARANTINE_REVIEW_DRAFT_COLLECTION).doc(receiptId);
    const caseRef = db.collection(LIBRARY_QUARANTINE_HUMAN_REVIEW_CASES_COLLECTION).doc(receiptId);
    const handoffRef = db.collection(LIBRARY_QUARANTINE_CATALOG_HANDOFFS_COLLECTION).doc(receiptId);
    const documentId = `qcat-${receiptId}`;
    const docRef = db.collection(LIBRARY_DOCUMENTS_COLLECTION).doc(documentId);
    const alignmentRef = db.collection(LIBRARY_QUARANTINE_CATALOG_CASE_ALIGNMENTS_COLLECTION).doc(receiptId);
    const safetyRef = db.collection(LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION).doc(receiptId);

    const [receiptSnap, draftSnap, caseSnap, handoffSnap, docSnap, alignmentSnap, safetySnap] = await Promise.all([
      receiptRef.get(),
      draftRef.get(),
      caseRef.get(),
      handoffRef.get(),
      docRef.get(),
      alignmentRef.get(),
      safetyRef.get(),
    ]);

    if (!receiptSnap.exists) {
      throw new ServiceError('not-found', `QUARANTINE_RECEIPT_NOT_FOUND: Receipt ${receiptId} not found.`);
    }
    const envelope = receiptSnap.data() as LibraryQuarantinePersistedReceiptEnvelope;

    if (!draftSnap.exists) {
      throw new ServiceError('failed-precondition', `REVIEW_DRAFT_NOT_FOUND: Review draft for ${receiptId} not found.`);
    }
    const draft = draftSnap.data() as LibraryQuarantinePersistedReviewDraft;

    if (!caseSnap.exists) {
      throw new ServiceError('failed-precondition', `HUMAN_REVIEW_CASE_NOT_FOUND: Human review case for ${receiptId} not found.`);
    }
    const humanCase = caseSnap.data() as LibraryQuarantinePersistedHumanReviewCase;

    if (!handoffSnap.exists) {
      throw new ServiceError('failed-precondition', `CATALOG_HANDOFF_NOT_CREATED: Catalog handoff for ${receiptId} not found.`);
    }
    const handoff = handoffSnap.data() as LibraryQuarantinePersistedCatalogHandoff;

    if (!docSnap.exists) {
      throw new ServiceError('failed-precondition', `CATALOG_DOCUMENT_MISSING: Catalog document for ${receiptId} not found.`);
    }
    const catalogDoc = docSnap.data();

    const alignment = alignmentSnap.exists ? (alignmentSnap.data() as LibraryQuarantinePersistedCatalogCaseAlignment) : null;
    const safetyCase = safetySnap.exists ? (safetySnap.data() as LibraryQuarantinePersistedBinarySafetyCase) : null;

    return { envelope, draft, humanCase, handoff, catalogDoc, alignment, safetyCase };
  }

  public async getQuarantineBinarySafetyCase(
    input: { readonly receiptId: string }
  ): Promise<GetLibraryQuarantineBinarySafetyCaseResponseDto> {
    await this.assertOwnerPrincipal();

    const receiptId = typeof input?.receiptId === 'string' ? input.receiptId.trim() : '';
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      throw new ServiceError('invalid-argument', 'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hex string.');
    }

    try {
      const records = await this.perform7PointReads(receiptId);
      const { envelope, humanCase, handoff, safetyCase } = records;

      const sourceFormat = envelope.receipt.sourceFormat || 'unknown';
      const deepInspectionStatus = envelope.receipt.deepInspectionStatus || 'PENDING';

      if (humanCase.status !== 'METADATA_RECORDED') {
        return {
          ok: false,
          outcome: 'HOLD',
          errorCode: 'CASE_NOT_METADATA_RECORDED',
          errorMessage: 'Human review case is not in METADATA_RECORDED status.',
        };
      }

      if (envelope.revision !== handoff.sourceRevision || envelope.updatedAt !== handoff.sourceUpdatedAt) {
        return {
          ok: false,
          outcome: 'HOLD',
          errorCode: 'HANDOFF_SOURCE_MISMATCH',
          errorMessage: 'Catalog handoff source revision or updated timestamp does not match receipt.',
        };
      }

      const currentRevision = safetyCase ? safetyCase.revision : 0;
      const isCaseCurrent = safetyCase
        ? safetyCase.sourceRevision === envelope.revision &&
          safetyCase.sourceUpdatedAt === envelope.updatedAt &&
          safetyCase.effectiveHumanCaseRevision === humanCase.revision
        : true;

      const requiresFreshEvidence = safetyCase ? !isCaseCurrent : false;

      return {
        ok: true,
        outcome: 'READY',
        receiptId,
        documentId: `qcat-${receiptId}`,
        currentRevision,
        isCaseCurrent,
        requiresFreshEvidence,
        sourceFormat,
        deepInspectionStatus,
        readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
        binarySafetyCase: safetyCase ? Object.freeze({
          schemaVersion: safetyCase.schemaVersion,
          receiptId: safetyCase.receiptId,
          documentId: safetyCase.documentId,
          revision: safetyCase.revision,
          sourceRevision: safetyCase.sourceRevision,
          sourceUpdatedAt: safetyCase.sourceUpdatedAt,
          sourceFormat: safetyCase.sourceFormat,
          deepInspectionStatus: safetyCase.deepInspectionStatus,
          effectiveHumanCaseRevision: safetyCase.effectiveHumanCaseRevision,
          effectiveHumanCaseUpdatedAt: safetyCase.effectiveHumanCaseUpdatedAt,
          catalogUpdatedAt: safetyCase.catalogUpdatedAt,
          disposition: safetyCase.disposition,
          evidenceReference: safetyCase.evidenceReference,
          evidenceNotes: safetyCase.evidenceNotes,
          reviewNotes: safetyCase.reviewNotes,
          createdAt: safetyCase.createdAt,
          updatedAt: safetyCase.updatedAt,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }) : null,
      };
    } catch (err: any) {
      if (err instanceof ServiceError) {
        if (err.code === 'not-found') {
          return {
            ok: false,
            outcome: 'NOT_FOUND',
            errorCode: 'QUARANTINE_RECEIPT_NOT_FOUND',
            errorMessage: err.message,
          };
        }
        return {
          ok: false,
          outcome: 'HOLD',
          errorCode: err.code.toUpperCase(),
          errorMessage: err.message,
        };
      }
      throw err;
    }
  }

  public async saveQuarantineBinarySafetyCase(input: {
    readonly receiptId: string;
    readonly expectedRevision: number;
    readonly acknowledgedHumanCaseRevision?: number;
    readonly input: unknown;
  }): Promise<SaveLibraryQuarantineBinarySafetyCaseResponseDto> {
    const actorUid = await this.assertOwnerPrincipal();

    const receiptId = typeof input?.receiptId === 'string' ? input.receiptId.trim() : '';
    if (!isValidLibraryQuarantineReceiptId(receiptId)) {
      throw new ServiceError('invalid-argument', 'INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hex string.');
    }

    const expectedRevision = input.expectedRevision;
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ServiceError('invalid-argument', 'INVALID_EXPECTED_REVISION: expectedRevision must be a non-negative integer.');
    }

    const validationResult = validateSaveLibraryQuarantineBinarySafetyCaseInput(input.input);
    if (!validationResult.ok) {
      throw new ServiceError('invalid-argument', `${validationResult.errorCode}: ${validationResult.errorMessage}`);
    }

    const editorialInput = validationResult.value;
    const documentId = `qcat-${receiptId}`;

    let records: Awaited<ReturnType<typeof this.perform7PointReads>>;
    try {
      records = await this.perform7PointReads(receiptId);
    } catch (err: any) {
      if (err instanceof ServiceError && err.code === 'not-found') {
        return {
          ok: false,
          outcome: 'HOLD',
          errorCode: 'QUARANTINE_RECEIPT_NOT_FOUND',
          errorMessage: err.message,
        };
      }
      if (err instanceof ServiceError) {
        return {
          ok: false,
          outcome: 'HOLD',
          errorCode: err.code.toUpperCase(),
          errorMessage: err.message,
        };
      }
      throw err;
    }

    const { envelope, humanCase, handoff, safetyCase } = records;

    if (humanCase.status !== 'METADATA_RECORDED') {
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'CASE_NOT_METADATA_RECORDED',
        errorMessage: 'Human review case is not in METADATA_RECORDED status.',
      };
    }

    if (envelope.revision !== handoff.sourceRevision || envelope.updatedAt !== handoff.sourceUpdatedAt) {
      return {
        ok: false,
        outcome: 'HOLD',
        errorCode: 'HANDOFF_SOURCE_MISMATCH',
        errorMessage: 'Catalog handoff source revision or updated timestamp does not match receipt.',
      };
    }

    const currentRevision = safetyCase ? safetyCase.revision : 0;
    if (currentRevision !== expectedRevision) {
      return {
        ok: false,
        outcome: 'CONFLICT',
        errorCode: 'BINARY_SAFETY_REVISION_CONFLICT',
        errorMessage: `Revision conflict: expected revision ${expectedRevision}, actual current revision is ${currentRevision}.`,
        currentRevision,
        currentBinarySafetyCase: safetyCase
          ? Object.freeze({
              schemaVersion: safetyCase.schemaVersion,
              receiptId: safetyCase.receiptId,
              documentId: safetyCase.documentId,
              revision: safetyCase.revision,
              sourceRevision: safetyCase.sourceRevision,
              sourceUpdatedAt: safetyCase.sourceUpdatedAt,
              sourceFormat: safetyCase.sourceFormat,
              deepInspectionStatus: safetyCase.deepInspectionStatus,
              effectiveHumanCaseRevision: safetyCase.effectiveHumanCaseRevision,
              effectiveHumanCaseUpdatedAt: safetyCase.effectiveHumanCaseUpdatedAt,
              catalogUpdatedAt: safetyCase.catalogUpdatedAt,
              disposition: safetyCase.disposition,
              evidenceReference: safetyCase.evidenceReference,
              evidenceNotes: safetyCase.evidenceNotes,
              reviewNotes: safetyCase.reviewNotes,
              createdAt: safetyCase.createdAt,
              updatedAt: safetyCase.updatedAt,
              isSanitized: false,
              isVerifiedSafe: false,
              isRightsApproved: false,
              isPublished: false,
              isReadyForPeia: false,
            })
          : null,
      };
    }

    const nextRevision = currentRevision + 1;
    const timestamp = this.nowIso();
    const sourceFormat = envelope.receipt.sourceFormat || 'unknown';
    const deepInspectionStatus = envelope.receipt.deepInspectionStatus || 'PENDING';

    const caseRecord: LibraryQuarantinePersistedBinarySafetyCase = Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_SCHEMA_VERSION,
      receiptId,
      documentId,
      revision: nextRevision,
      sourceRevision: envelope.revision,
      sourceUpdatedAt: envelope.updatedAt,
      sourceSha256: envelope.sha256,
      sourceFormat,
      deepInspectionStatus,
      effectiveHumanCaseRevision: humanCase.revision,
      effectiveHumanCaseUpdatedAt: humanCase.updatedAt,
      catalogUpdatedAt: handoff.createdAt,
      disposition: editorialInput.disposition,
      evidenceReference: editorialInput.evidenceReference,
      evidenceNotes: editorialInput.evidenceNotes,
      reviewNotes: editorialInput.reviewNotes,
      createdBy: safetyCase ? safetyCase.createdBy : actorUid,
      createdAt: safetyCase ? safetyCase.createdAt : timestamp,
      updatedBy: actorUid,
      updatedAt: timestamp,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });

    const eventRecord: LibraryQuarantinePersistedBinarySafetyCaseEvent = Object.freeze({
      schemaVersion: LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENT_SCHEMA_VERSION,
      eventId: `bs-evt-${receiptId}-${nextRevision}-${Date.now()}`,
      receiptId,
      documentId,
      revision: nextRevision,
      previousRevision: currentRevision,
      eventType: currentRevision === 0 ? 'CREATED' : 'UPDATED',
      sourceRevision: envelope.revision,
      sourceUpdatedAt: envelope.updatedAt,
      sourceSha256: envelope.sha256,
      sourceFormat,
      deepInspectionStatus,
      effectiveHumanCaseRevision: humanCase.revision,
      effectiveHumanCaseUpdatedAt: humanCase.updatedAt,
      catalogUpdatedAt: handoff.createdAt,
      disposition: editorialInput.disposition,
      evidenceReference: editorialInput.evidenceReference,
      evidenceNotes: editorialInput.evidenceNotes,
      reviewNotes: editorialInput.reviewNotes,
      actorUid,
      recordedAt: timestamp,
      isSanitized: false,
      isVerifiedSafe: false,
      isRightsApproved: false,
      isPublished: false,
      isReadyForPeia: false,
    });

    let writeStagedInAnyAttempt = false;
    try {
      writeStagedInAnyAttempt = true;
      const store = new (await import('./firestoreLibraryQuarantineBinarySafetyCaseStore')).FirestoreLibraryQuarantineBinarySafetyCaseStore(
        this.deps.db
      );

      const result = await store.saveBinarySafetyCaseAtomic(
        receiptId,
        expectedRevision,
        caseRecord,
        eventRecord
      );

      if (!result.saved) {
        const refreshed = await store.getBinarySafetyCase(receiptId);
        const actualCurrentRevision = refreshed ? refreshed.revision : 0;
        return {
          ok: false,
          outcome: 'CONFLICT',
          errorCode: 'BINARY_SAFETY_REVISION_CONFLICT',
          errorMessage: `Revision conflict detected during atomic commit. Expected ${expectedRevision}, current is ${actualCurrentRevision}.`,
          currentRevision: actualCurrentRevision,
          currentBinarySafetyCase: refreshed ? Object.freeze({
            schemaVersion: refreshed.schemaVersion,
            receiptId: refreshed.receiptId,
            documentId: refreshed.documentId,
            revision: refreshed.revision,
            sourceRevision: refreshed.sourceRevision,
            sourceUpdatedAt: refreshed.sourceUpdatedAt,
            sourceFormat: refreshed.sourceFormat,
            deepInspectionStatus: refreshed.deepInspectionStatus,
            effectiveHumanCaseRevision: refreshed.effectiveHumanCaseRevision,
            effectiveHumanCaseUpdatedAt: refreshed.effectiveHumanCaseUpdatedAt,
            catalogUpdatedAt: refreshed.catalogUpdatedAt,
            disposition: refreshed.disposition,
            evidenceReference: refreshed.evidenceReference,
            evidenceNotes: refreshed.evidenceNotes,
            reviewNotes: refreshed.reviewNotes,
            createdAt: refreshed.createdAt,
            updatedAt: refreshed.updatedAt,
            isSanitized: false,
            isVerifiedSafe: false,
            isRightsApproved: false,
            isPublished: false,
            isReadyForPeia: false,
          }) : null,
        };
      }

      return {
        ok: true,
        outcome: 'SAVED',
        receiptId,
        documentId,
        revision: nextRevision,
        binarySafetyCase: Object.freeze({
          schemaVersion: caseRecord.schemaVersion,
          receiptId: caseRecord.receiptId,
          documentId: caseRecord.documentId,
          revision: caseRecord.revision,
          sourceRevision: caseRecord.sourceRevision,
          sourceUpdatedAt: caseRecord.sourceUpdatedAt,
          sourceFormat: caseRecord.sourceFormat,
          deepInspectionStatus: caseRecord.deepInspectionStatus,
          effectiveHumanCaseRevision: caseRecord.effectiveHumanCaseRevision,
          effectiveHumanCaseUpdatedAt: caseRecord.effectiveHumanCaseUpdatedAt,
          catalogUpdatedAt: caseRecord.catalogUpdatedAt,
          disposition: caseRecord.disposition,
          evidenceReference: caseRecord.evidenceReference,
          evidenceNotes: caseRecord.evidenceNotes,
          reviewNotes: caseRecord.reviewNotes,
          createdAt: caseRecord.createdAt,
          updatedAt: caseRecord.updatedAt,
          isSanitized: false,
          isVerifiedSafe: false,
          isRightsApproved: false,
          isPublished: false,
          isReadyForPeia: false,
        }),
      };
    } catch (err: any) {
      if (writeStagedInAnyAttempt) {
        return {
          ok: false,
          outcome: 'UNKNOWN',
          errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
          errorMessage: `Commit uncertainty: transaction threw error after writes were staged: ${err?.message || String(err)}`,
          caseSaved: null,
        };
      }
      throw err;
    }
  }
}
