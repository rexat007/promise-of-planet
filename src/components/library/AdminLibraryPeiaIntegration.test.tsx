import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AdminLibraryManagement,
  LibraryIntakePeiaPreparationController,
  canAccessLibraryIntakePeiaPreparation,
  canRequestLibraryIntakePeiaForRecord,
  type LibraryIntakePeiaModalSnapshot,
} from './AdminLibraryManagement';
import {
  AdminRole,
  type AdminUser,
} from '../../types/admin';
import {
  LibraryIntakeAIInputBasis,
  LibraryIntakeStatus,
  type LibraryIntakeRecord,
} from '../../../functions/src/shared/libraryContract';
import { LibraryDocumentType } from '../../types/library';
import {
  AIReviewSeverity,
  AIReviewTargetType,
  AITaskStatus,
  AITaskType,
  LibraryAdminClient,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
  type AIReviewTask,
  type GetLibraryIntakePeiaPreparationStatusResponseDto,
  type PEIALibraryPreparationAdvisoryPayload,
  type RequestLibraryIntakePeiaPreparationResponseDto,
  type SanitizedLibraryIntakePeiaPreparationStatusDto,
} from '../../services/libraryAdminClient';

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
    id: 'intake-doc-101',
    url: 'https://www.eeaa.gov.eg/laws/climate-framework-2026.pdf',
    normalizedUrl: 'https://www.eeaa.gov.eg/laws/climate-framework-2026.pdf',
    title: 'الإطار الوطني للتكيف المناخي وحوكمة الانبعاثات 2026',
    organizationId: 'org-eeaa',
    sourceId: 'src-gazette',
    language: 'ar',
    notes: 'وثيقة تشريعية مرجعية للمراجعة الأولية.',
    suppliedExcerpt:
      'المادة الأولى: يهدف هذا الإطار إلى خفض الانبعاثات الكربونية وتعزيز التكيف المناخي في القطاعات الحيوية.',
    status: LibraryIntakeStatus.PendingReview,
    submittedByAdminId: 'admin-curator-1',
    submittedByAdminName: 'Curator One',
    createdAt: '2026-04-10T08:00:00.000Z',
    updatedAt: '2026-04-10T09:30:00.000Z',
    ...overrides,
  };
}

function buildCanonicalLibraryPreparation(
  overrides: Partial<PEIALibraryPreparationAdvisoryPayload> = {}
): PEIALibraryPreparationAdvisoryPayload {
  return {
    inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
    suggestedTitleAr: 'الإطار الوطني للتكيف المناخي وحوكمة الانبعاثات 2026 (عنوان مقترح)',
    suggestedTitleEn: 'National Climate Adaptation and Emissions Governance Framework 2026',
    suggestedIssuingOrganization: 'جهاز شؤون البيئة المصري (EEAA)',
    suggestedDocumentType: PEIALibrarySuggestedDocumentType.Law,
    suggestedEnvironmentalDomains: ['ClimateChange', 'EnvironmentalGovernance'],
    suggestedTopicsAr: ['التكيف المناخي', 'خفض الانبعاثات'],
    suggestedTopicsEn: ['Climate Adaptation', 'Emissions Reduction'],
    suggestedSummaryAr:
      'ملخص استرشادي مستند حصراً إلى المقتطف النصي المودع حول خفض الانبعاثات والتكيف المناخي.',
    suggestedSummaryEn:
      'Advisory summary derived strictly from the stored excerpt on emissions reduction and climate adaptation.',
    provenanceObservationsAr: ['الرابط الرسمي يتبع نطاق جهاز شؤون البيئة المصري.'],
    provenanceObservationsEn: ['Official HTTPS link belongs to the Egyptian Environmental Affairs Agency domain.'],
    uncertaintyNoticesAr: ['يلزم التحقق البشري من تاريخ النشر الرسمي في الجريدة الرسمية.'],
    uncertaintyNoticesEn: ['Human verification is required for the official gazette publication date.'],
    ...overrides,
  };
}

function buildPeiaTask(
  intake: LibraryIntakeRecord,
  status: AITaskStatus,
  overrides: Partial<AIReviewTask> = {}
): AIReviewTask {
  const inputBasis =
    intake.suppliedExcerpt && intake.suppliedExcerpt.trim().length > 0
      ? PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata
      : PEIALibraryPreparationInputBasis.MetadataOnly;

  return {
    taskId: `peia_task_${intake.id}`,
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: intake.id,
      sourceUpdatedAt: intake.updatedAt,
    },
    status,
    createdAt: '2026-04-10T09:35:00.000Z',
    contentSnapshot: {
      allowSnapshotEvidence: true,
      intakeId: intake.id,
      url: intake.url,
      normalizedUrl: intake.normalizedUrl,
      title: intake.title,
      language: intake.language,
      inputBasis,
      ...(intake.suppliedExcerpt ? { suppliedExcerpt: intake.suppliedExcerpt } : {}),
    },
    ...overrides,
  };
}

function buildStatusResponse(
  intake: LibraryIntakeRecord,
  status: 'NotRequested' | AITaskStatus,
  options: {
    isStale?: boolean;
    taskSourceUpdatedAt?: string;
    libraryPreparationOverrides?: Partial<PEIALibraryPreparationAdvisoryPayload>;
  } = {}
): GetLibraryIntakePeiaPreparationStatusResponseDto {
  if (status === 'NotRequested') {
    const dto: SanitizedLibraryIntakePeiaPreparationStatusDto = {
      status: 'NotRequested',
      taskId: `peia_task_${intake.id}`,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: intake.id,
      intakeId: intake.id,
      currentSourceUpdatedAt: intake.updatedAt,
      taskSourceUpdatedAt: null,
      isStale: false,
      inputBasis: null,
      task: null,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: null,
    };
    return {
      ...dto,
      preparationStatus: dto,
      reviewStatus: dto,
    };
  }

  const taskSourceUpdatedAt = options.taskSourceUpdatedAt ?? intake.updatedAt;
  const taskRecordForSnapshot = {
    ...intake,
    updatedAt: taskSourceUpdatedAt,
  };
  const task = buildPeiaTask(taskRecordForSnapshot, status);

  const inputBasis =
    (task.contentSnapshot['inputBasis'] as PEIALibraryPreparationInputBasis) ??
    PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata;

  const libraryPreparation =
    status === AITaskStatus.Completed
      ? buildCanonicalLibraryPreparation({
          inputBasis,
          ...(inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly
            ? { suggestedSummaryAr: null, suggestedSummaryEn: null }
            : {}),
          ...options.libraryPreparationOverrides,
        })
      : null;

  const advisoryResult =
    status === AITaskStatus.Completed && libraryPreparation
      ? {
          schemaVersion: 1 as const,
          humanReviewRequired: true as const,
          task: {
            taskId: task.taskId,
            taskType: AITaskType.CONTENT_REVIEW,
            target: {
              targetType: AIReviewTargetType.LibraryIntake,
              targetId: intake.id,
              sourceUpdatedAt: taskSourceUpdatedAt,
            },
          },
          assessment: {
            summary: 'Bilingual library intake preparation advisory completed.',
            findings: [
              {
                code: 'OFFICIAL_SOURCE_MATCH',
                severity: AIReviewSeverity.Info,
                message: 'Domain matches registered environmental ministry portal.',
                evidenceIds: [`TASK_CONTENT_SNAPSHOT::intake-${intake.id}`],
              },
            ],
          },
          recommendations: ['Verify official gazette publication date before cataloging.'],
          uncertainties: ['External PDF was not fetched directly.'],
          limitations: ['Analysis grounded strictly in canonical stored intake snapshot.'],
          libraryPreparation,
        }
      : null;

  const nonAdvisoryOutcome =
    status === AITaskStatus.Failed
      ? {
          taskId: task.taskId,
          kind: 'MODEL_FAILURE' as const,
          reason: 'TIMEOUT',
          modelAttempts: 2,
          createdAt: '2026-04-10T09:36:30.000Z',
          detail: 'Deadline exceeded after 30000ms without partial advisory output.',
        }
      : null;

  const dto: SanitizedLibraryIntakePeiaPreparationStatusDto = {
    status,
    taskId: task.taskId,
    targetType: AIReviewTargetType.LibraryIntake,
    targetId: intake.id,
    intakeId: intake.id,
    currentSourceUpdatedAt: intake.updatedAt,
    taskSourceUpdatedAt,
    isStale: options.isStale ?? taskSourceUpdatedAt !== intake.updatedAt,
    inputBasis: libraryPreparation?.inputBasis ?? inputBasis,
    task,
    advisoryResult,
    libraryPreparation,
    nonAdvisoryOutcome,
  };

  return {
    ...dto,
    preparationStatus: dto,
    reviewStatus: dto,
  };
}

function buildEnqueueResponse(
  intake: LibraryIntakeRecord,
  disposition: 'CREATED' | 'ALREADY_EXISTS',
  status: AITaskStatus = AITaskStatus.Pending
): RequestLibraryIntakePeiaPreparationResponseDto {
  const statusRes = buildStatusResponse(intake, status);
  const task = statusRes.task!;
  return {
    disposition,
    documentId: task.taskId,
    taskId: task.taskId,
    intakeId: intake.id,
    inputBasis: statusRes.inputBasis ?? PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
    task,
    status,
    isStale: false,
    advisoryResult: statusRes.advisoryResult,
    libraryPreparation: statusRes.libraryPreparation,
    nonAdvisoryOutcome: statusRes.nonAdvisoryOutcome,
    preparationStatus: statusRes.preparationStatus,
    reviewStatus: statusRes.reviewStatus,
  };
}

function renderIntakeViewMarkup(params: {
  currentUser: AdminUser;
  intakeRecords: LibraryIntakeRecord[];
  modalState?: Partial<LibraryIntakePeiaModalSnapshot>;
  language?: 'ar' | 'en';
}): string {
  return renderToStaticMarkup(
    <AdminLibraryManagement
      currentUser={params.currentUser}
      initialTab="intake"
      initialLoading={false}
      initialIntakeRecords={params.intakeRecords}
      initialPeiaModalState={params.modalState}
      languageOverride={params.language ?? 'en'}
    />
  );
}

describe('AdminLibraryManagement — PEIA Unified Library Intake UI Integration (SUBUNIT-3B)', () => {
  const curatorUser = buildAdminUser(AdminRole.LibraryCurator);
  const ownerUser = buildAdminUser(AdminRole.Owner);
  const rightsReviewerUser = buildAdminUser(AdminRole.RightsReviewer);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1 & 2. Renders a single PEIA preparation action button alongside the preserved human Review Status action (no parallel AI button)', () => {
    const record = buildIntakeRecord();
    const htmlEn = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      language: 'en',
    });

    // Exactly one preparation action button for the row
    const prepMatches = htmlEn.match(/data-testid="intake-peia-prep-action-intake-doc-101"/g) ?? [];
    expect(prepMatches.length).toBe(1);
    expect(htmlEn).toContain('PEIA Preparation Assistant');
    expect(htmlEn).not.toContain('Generate AI Preparation Suggestions');

    // Existing human Review Status button is preserved intact
    const humanReviewMatches =
      htmlEn.match(/data-testid="intake-human-review-action-intake-doc-101"/g) ?? [];
    expect(humanReviewMatches.length).toBe(1);
    expect(htmlEn).toContain('Review Status');
  });

  it('3 & 17. Opening the preparation modal reads status via getIntakePeiaPreparationStatus without enqueueing a task or calling Gemini', async () => {
    const record = buildIntakeRecord();
    const getStatusSpy = vi
      .fn()
      .mockResolvedValue(buildStatusResponse(record, 'NotRequested'));
    const requestPrepSpy = vi.fn();
    const getIntakeByIdSpy = vi.fn();
    const geminiSpy = vi
      .spyOn(LibraryAdminClient, 'generateIntakeAISuggestions')
      .mockImplementation(async () => {
        throw new Error('Should never be called');
      });

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: getIntakeByIdSpy,
      getIntakePeiaPreparationStatus: getStatusSpy,
      requestIntakePeiaPreparation: requestPrepSpy,
    });

    await controller.openModal(record);

    expect(getStatusSpy).toHaveBeenCalledTimes(1);
    expect(getStatusSpy).toHaveBeenCalledWith(record.id);
    expect(requestPrepSpy).not.toHaveBeenCalled();
    expect(getIntakeByIdSpy).not.toHaveBeenCalled();
    expect(geminiSpy).not.toHaveBeenCalled();

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeIntake?.id).toBe(record.id);
    expect(snapshot.peiaStatus?.status).toBe('NotRequested');
    expect(snapshot.loadingStatus).toBe(false);
  });

  it('4 & 15. Requesting PEIA preparation fetches authoritative record via getIntakeById first and passes only (intakeId, expectedUpdatedAt) without client-supplied excerpt', async () => {
    const record = buildIntakeRecord({
      suppliedExcerpt: 'مقتطف محفوظ على الخادم فقط',
      updatedAt: '2026-04-10T11:00:00.000Z',
    });

    const getStatusSpy = vi
      .fn()
      .mockResolvedValue(buildStatusResponse(record, 'NotRequested'));
    const getIntakeByIdSpy = vi.fn().mockResolvedValue(record);
    const requestPrepSpy = vi
      .fn()
      .mockResolvedValue(buildEnqueueResponse(record, 'CREATED', AITaskStatus.Pending));
    const geminiSpy = vi.spyOn(LibraryAdminClient, 'generateIntakeAISuggestions');

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: getIntakeByIdSpy,
      getIntakePeiaPreparationStatus: getStatusSpy,
      requestIntakePeiaPreparation: requestPrepSpy,
    });

    await controller.openModal(record);
    await controller.requestPreparation();

    expect(getIntakeByIdSpy).toHaveBeenCalledTimes(1);
    expect(getIntakeByIdSpy).toHaveBeenCalledWith(record.id);
    expect(requestPrepSpy).toHaveBeenCalledTimes(1);
    expect(requestPrepSpy).toHaveBeenCalledWith(record.id, '2026-04-10T11:00:00.000Z');
    expect(requestPrepSpy.mock.calls[0]?.length).toBe(2);
    expect(geminiSpy).not.toHaveBeenCalled();

    // Verify modal markup has no editable textarea for client-supplied excerpt
    const html = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: controller.getSnapshot(),
      language: 'en',
    });
    expect(html).toContain('data-testid="peia-preparation-modal"');
    expect(html).toContain('data-testid="peia-canonical-stored-excerpt"');
    expect(html).not.toContain('<textarea');
  });

  it('5. Stale local version blocks immediate request when getIntakeById returns a newer updatedAt and pauses for user confirmation', async () => {
    const initialRecord = buildIntakeRecord({
      updatedAt: '2026-04-10T09:00:00.000Z',
      title: 'Initial Title v1',
    });
    const refreshedRecord = buildIntakeRecord({
      updatedAt: '2026-04-10T12:45:00.000Z',
      title: 'Updated Title v2',
    });

    const getStatusSpy = vi
      .fn()
      .mockResolvedValueOnce(buildStatusResponse(initialRecord, 'NotRequested'))
      .mockResolvedValueOnce(buildStatusResponse(refreshedRecord, 'NotRequested'));
    const getIntakeByIdSpy = vi.fn().mockResolvedValue(refreshedRecord);
    const requestPrepSpy = vi
      .fn()
      .mockResolvedValue(buildEnqueueResponse(refreshedRecord, 'CREATED', AITaskStatus.Pending));
    const refreshedCallback = vi.fn();

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: getIntakeByIdSpy,
      getIntakePeiaPreparationStatus: getStatusSpy,
      requestIntakePeiaPreparation: requestPrepSpy,
      onIntakeRecordRefreshed: refreshedCallback,
    });

    await controller.openModal(initialRecord);
    await controller.requestPreparation();

    // First click must NOT call requestIntakePeiaPreparation because updatedAt changed
    expect(requestPrepSpy).not.toHaveBeenCalled();
    expect(refreshedCallback).toHaveBeenCalledWith(refreshedRecord);

    const pausedSnapshot = controller.getSnapshot();
    expect(pausedSnapshot.activeIntake?.updatedAt).toBe('2026-04-10T12:45:00.000Z');
    expect(pausedSnapshot.versionMismatchNotice).toEqual({
      previousUpdatedAt: '2026-04-10T09:00:00.000Z',
      refreshedUpdatedAt: '2026-04-10T12:45:00.000Z',
    });

    const pausedHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [refreshedRecord],
      modalState: pausedSnapshot,
      language: 'en',
    });
    expect(pausedHtml).toContain('data-testid="peia-version-mismatch-notice"');
    expect(pausedHtml).toContain('Confirm PEIA Request for Updated Version');

    // Second click (user confirmation on the refreshed version) proceeds with the new updatedAt
    await controller.requestPreparation();
    expect(requestPrepSpy).toHaveBeenCalledTimes(1);
    expect(requestPrepSpy).toHaveBeenCalledWith(refreshedRecord.id, '2026-04-10T12:45:00.000Z');
    expect(controller.getSnapshot().versionMismatchNotice).toBeNull();
  });

  it('6. Prevents duplicate clicks while a PEIA preparation request is in flight', async () => {
    const record = buildIntakeRecord();
    let resolveEnqueue!: (value: RequestLibraryIntakePeiaPreparationResponseDto) => void;
    const enqueuePromise = new Promise<RequestLibraryIntakePeiaPreparationResponseDto>((resolve) => {
      resolveEnqueue = resolve;
    });

    const getStatusSpy = vi
      .fn()
      .mockResolvedValue(buildStatusResponse(record, 'NotRequested'));
    const getIntakeByIdSpy = vi.fn().mockResolvedValue(record);
    const requestPrepSpy = vi.fn().mockReturnValue(enqueuePromise);

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: getIntakeByIdSpy,
      getIntakePeiaPreparationStatus: getStatusSpy,
      requestIntakePeiaPreparation: requestPrepSpy,
    });

    await controller.openModal(record);

    const firstAttempt = controller.requestPreparation();
    expect(controller.getSnapshot().requestingPrep).toBe(true);

    // Concurrent second and third clicks while in flight
    const secondAttempt = controller.requestPreparation();
    const thirdAttempt = controller.requestPreparation();
    await Promise.all([secondAttempt, thirdAttempt]);

    resolveEnqueue(buildEnqueueResponse(record, 'CREATED', AITaskStatus.Pending));
    await firstAttempt;

    expect(getIntakeByIdSpy).toHaveBeenCalledTimes(1);
    expect(requestPrepSpy).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().requestingPrep).toBe(false);
  });

  it('7 & 8. Handles CREATED and ALREADY_EXISTS dispositions cleanly with distinct user feedback', async () => {
    const record = buildIntakeRecord();
    const getStatusSpy = vi
      .fn()
      .mockResolvedValue(buildStatusResponse(record, 'NotRequested'));
    const getIntakeByIdSpy = vi.fn().mockResolvedValue(record);
    const requestPrepSpy = vi
      .fn()
      .mockResolvedValueOnce(buildEnqueueResponse(record, 'CREATED', AITaskStatus.Pending))
      .mockResolvedValueOnce(buildEnqueueResponse(record, 'ALREADY_EXISTS', AITaskStatus.Pending));

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: getIntakeByIdSpy,
      getIntakePeiaPreparationStatus: getStatusSpy,
      requestIntakePeiaPreparation: requestPrepSpy,
    });

    await controller.openModal(record);

    // 1. CREATED disposition
    await controller.requestPreparation();
    expect(controller.getSnapshot().lastEnqueueDisposition).toBe('CREATED');
    expect(controller.getSnapshot().peiaError).toBeNull();

    const createdHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: controller.getSnapshot(),
      language: 'en',
    });
    expect(createdHtml).toContain('data-testid="peia-disposition-created"');
    expect(createdHtml).toContain('Disposition: CREATED');
    expect(createdHtml).not.toContain('data-testid="peia-error-banner"');

    // 2. ALREADY_EXISTS disposition
    await controller.requestPreparation();
    expect(controller.getSnapshot().lastEnqueueDisposition).toBe('ALREADY_EXISTS');
    expect(controller.getSnapshot().peiaError).toBeNull();

    const existingHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: controller.getSnapshot(),
      language: 'en',
    });
    expect(existingHtml).toContain('data-testid="peia-disposition-already-exists"');
    expect(existingHtml).toContain('Disposition: ALREADY_EXISTS');
    expect(existingHtml).not.toContain('data-testid="peia-error-banner"');
  });

  it('9. Displays NotRequested state accurately and disables queueing for Rejected intake records', async () => {
    const eligibleRecord = buildIntakeRecord();
    const eligibleStatus = buildStatusResponse(eligibleRecord, 'NotRequested');

    const eligibleHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [eligibleRecord],
      modalState: {
        activeIntake: eligibleRecord,
        peiaStatus: eligibleStatus.preparationStatus,
      },
      language: 'en',
    });
    expect(eligibleHtml).toContain('data-testid="peia-status-not-requested"');
    expect(eligibleHtml).toContain('PEIA Preparation Status: NotRequested');
    expect(canRequestLibraryIntakePeiaForRecord(curatorUser, eligibleRecord)).toBe(true);

    // Rejected intake record
    const rejectedRecord = buildIntakeRecord({ status: LibraryIntakeStatus.Rejected });
    const rejectedStatus = buildStatusResponse(rejectedRecord, 'NotRequested');

    const rejectedHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [rejectedRecord],
      modalState: {
        activeIntake: rejectedRecord,
        peiaStatus: rejectedStatus.preparationStatus,
      },
      language: 'en',
    });
    expect(canRequestLibraryIntakePeiaForRecord(curatorUser, rejectedRecord)).toBe(false);
    expect(rejectedHtml).toContain('data-testid="peia-rejected-intake-notice"');
    expect(rejectedHtml).toMatch(/data-testid="peia-request-prep-btn"[^>]*disabled=""/);
  });

  it('10. Displays Pending state with task ID, target version, requested timestamp, and manual Refresh Status action', async () => {
    const record = buildIntakeRecord();
    const pendingRes = buildStatusResponse(record, AITaskStatus.Pending);
    const completedRes = buildStatusResponse(record, AITaskStatus.Completed);

    const getStatusSpy = vi
      .fn()
      .mockResolvedValueOnce(pendingRes)
      .mockResolvedValueOnce(completedRes);

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakePeiaPreparationStatus: getStatusSpy,
    });

    await controller.openModal(record);

    const pendingHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: controller.getSnapshot(),
      language: 'en',
    });

    expect(pendingHtml).toContain('data-testid="peia-status-pending"');
    expect(pendingHtml).toContain(`Task ID: peia_task_${record.id}`);
    expect(pendingHtml).toContain(`Target Version: ${record.updatedAt}`);
    expect(pendingHtml).toContain('Requested At: 2026-04-10T09:35:00.000Z');
    expect(pendingHtml).toContain('data-testid="peia-refresh-status-btn"');

    // Manual refresh transitions from Pending to Completed
    await controller.refreshStatus();
    expect(getStatusSpy).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().peiaStatus?.status).toBe(AITaskStatus.Completed);
  });

  it('11. Displays Completed bilingual advisory payload (all 14 libraryPreparation fields) and mandatory human-review warning', () => {
    const record = buildIntakeRecord();
    const completedRes = buildStatusResponse(record, AITaskStatus.Completed);

    const htmlEn = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: completedRes.preparationStatus,
      },
      language: 'en',
    });

    expect(htmlEn).toContain('data-testid="peia-status-completed"');
    expect(htmlEn).toContain('data-testid="peia-advisory-only-warning"');
    expect(htmlEn).toContain(
      'Unverified PEIA Advisory Output — Requires Human Editorial Verification'
    );
    expect(htmlEn).toContain('الإطار الوطني للتكيف المناخي وحوكمة الانبعاثات 2026 (عنوان مقترح)');
    expect(htmlEn).toContain('National Climate Adaptation and Emissions Governance Framework 2026');
    expect(htmlEn).toContain('جهاز شؤون البيئة المصري (EEAA)');
    expect(htmlEn).toContain(PEIALibrarySuggestedDocumentType.Law);
    expect(htmlEn).toContain('ClimateChange');
    expect(htmlEn).toContain('EnvironmentalGovernance');
    expect(htmlEn).toContain('التكيف المناخي');
    expect(htmlEn).toContain('Climate Adaptation');
    expect(htmlEn).toContain('data-testid="peia-completed-summaries"');
    expect(htmlEn).toContain(
      'ملخص استرشادي مستند حصراً إلى المقتطف النصي المودع حول خفض الانبعاثات والتكيف المناخي.'
    );
    expect(htmlEn).toContain(
      'Advisory summary derived strictly from the stored excerpt on emissions reduction and climate adaptation.'
    );
    expect(htmlEn).toContain('الرابط الرسمي يتبع نطاق جهاز شؤون البيئة المصري.');
    expect(htmlEn).toContain(
      'Official HTTPS link belongs to the Egyptian Environmental Affairs Agency domain.'
    );
    expect(htmlEn).toContain('يلزم التحقق البشري من تاريخ النشر الرسمي في الجريدة الرسمية.');
    expect(htmlEn).toContain(
      'Human verification is required for the official gazette publication date.'
    );
  });

  it('12. Displays Failed nonAdvisoryOutcome details clearly and never presents a failed task as completed', () => {
    const record = buildIntakeRecord();
    const failedRes = buildStatusResponse(record, AITaskStatus.Failed);

    const html = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: failedRes.preparationStatus,
      },
      language: 'en',
    });

    expect(html).toContain('data-testid="peia-status-failed"');
    expect(html).not.toContain('data-testid="peia-status-completed"');
    expect(html).toContain('Outcome Kind: MODEL_FAILURE');
    expect(html).toContain('Reason Code: TIMEOUT');
    expect(html).toContain('Deadline exceeded after 30000ms without partial advisory output.');
    expect(html).toContain('Failed At: 2026-04-10T09:36:30.000Z');
    expect(html).toContain('Model Attempts: 2');
  });

  it('13. Labels historical stale PEIA results clearly when isStale === true while keeping findings readable and allowing a fresh request', () => {
    const record = buildIntakeRecord({
      updatedAt: '2026-04-10T15:00:00.000Z',
    });
    const staleCompletedRes = buildStatusResponse(record, AITaskStatus.Completed, {
      isStale: true,
      taskSourceUpdatedAt: '2026-04-10T08:00:00.000Z',
    });

    const html = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: staleCompletedRes.preparationStatus,
      },
      language: 'en',
    });

    expect(html).toContain('data-testid="peia-stale-warning-banner"');
    expect(html).toContain('2026-04-10T08:00:00.000Z');
    expect(html).toContain('2026-04-10T15:00:00.000Z');
    // Historical completed advisory remains readable for audit context
    expect(html).toContain('data-testid="peia-status-completed"');
    expect(html).toContain('National Climate Adaptation and Emissions Governance Framework 2026');
    // Button prompts to request fresh preparation for the current version
    expect(html).toContain('Request Fresh PEIA Preparation');
  });

  it('14. Displays MetadataOnly explanation when suppliedExcerpt is absent and preserves null summary truthfulness notice', () => {
    const metadataOnlyRecord = buildIntakeRecord({
      suppliedExcerpt: undefined,
    });
    const completedMetadataOnlyRes = buildStatusResponse(
      metadataOnlyRecord,
      AITaskStatus.Completed,
      {
        libraryPreparationOverrides: {
          inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
          suggestedSummaryAr: null,
          suggestedSummaryEn: null,
        },
      }
    );

    const html = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [metadataOnlyRecord],
      modalState: {
        activeIntake: metadataOnlyRecord,
        peiaStatus: completedMetadataOnlyRes.preparationStatus,
      },
      language: 'en',
    });

    expect(html).toContain('data-testid="peia-metadata-only-basis-notice"');
    expect(html).not.toContain('data-testid="peia-canonical-stored-excerpt"');
    expect(html).toContain('data-testid="peia-completed-metadata-only-summary-notice"');
    expect(html).not.toContain('data-testid="peia-completed-summaries"');
    expect(html).toContain(
      'Both suggestedSummaryAr and suggestedSummaryEn are null because inputBasis is MetadataOnly'
    );
  });

  it('16. Preserves existing historical Gemini aiSuggestion data as a clearly labeled Read-Only Legacy section alongside PEIA status', () => {
    const recordWithLegacy = buildIntakeRecord({
      aiSuggestion: {
        modelId: 'gemini-2.5-flash',
        generatedAt: '2026-03-15T10:00:00.000Z',
        generatedByAdminId: 'admin-legacy',
        generatedByAdminName: 'Legacy Curator',
        inputBasis: LibraryIntakeAIInputBasis.MetadataOnly,
        suggestedTitleAr: 'عنوان قديم محفوظ من جيميني',
        suggestedTitleEn: 'Legacy Stored Gemini Title',
        suggestedIssuingOrganization: 'Legacy Ministry',
        suggestedDocumentType: LibraryDocumentType.Report,
        suggestedEnvironmentalDomains: ['Biodiversity'],
        suggestedTopicsAr: ['التنوع الحيوي'],
        suggestedTopicsEn: ['Biodiversity'],
        provenanceObservationsAr: ['ملاحظة سابقة'],
        provenanceObservationsEn: ['Legacy provenance observation'],
        uncertaintyNoticesAr: ['تنبيه سابق'],
        uncertaintyNoticesEn: ['Legacy uncertainty notice'],
        verificationWarningAr: 'تحذير قديم',
        verificationWarningEn: 'Legacy warning',
      },
    });

    const completedRes = buildStatusResponse(recordWithLegacy, AITaskStatus.Completed);

    const html = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [recordWithLegacy],
      modalState: {
        activeIntake: recordWithLegacy,
        peiaStatus: completedRes.preparationStatus,
      },
      language: 'en',
    });

    // Both canonical PEIA section and Read-Only Legacy Gemini section are clearly distinguished
    expect(html).toContain('data-testid="peia-status-completed"');
    expect(html).toContain('data-testid="legacy-gemini-suggestion-readonly"');
    expect(html).toContain('READ-ONLY LEGACY');
    expect(html).toContain('Legacy Stored Gemini Title');
    expect(html).toContain('National Climate Adaptation and Emissions Governance Framework 2026');
  });

  it('18. Enforces strict role & permission gating so unauthorized roles cannot see or trigger PEIA preparation', async () => {
    const record = buildIntakeRecord();

    // Authorized roles
    expect(canAccessLibraryIntakePeiaPreparation(ownerUser)).toBe(true);
    expect(canAccessLibraryIntakePeiaPreparation(curatorUser)).toBe(true);
    expect(canAccessLibraryIntakePeiaPreparation(rightsReviewerUser)).toBe(true);

    // Unauthorized roles (canonical non-Library roles, cross-domain role strings, AIAssistant, and inactive admins)
    const unauthorizedUsers: AdminUser[] = [
      buildAdminUser(AdminRole.ContentEditor),
      buildAdminUser(AdminRole.TrainingManager),
      buildAdminUser(AdminRole.Trainer),
      buildAdminUser(AdminRole.CitizenModerator),
      buildAdminUser(AdminRole.Viewer),
      buildAdminUser(AdminRole.AIAssistant),
      buildAdminUser('NewsEditor' as AdminRole),
      buildAdminUser('ManagingEditor' as AdminRole),
      buildAdminUser('Analyst' as AdminRole),
      buildAdminUser('TechnicalAdmin' as AdminRole),
      buildAdminUser(AdminRole.LibraryCurator, { isActive: false }),
      buildAdminUser(AdminRole.Owner, { isActive: false }),
    ];

    for (const unauthorizedUser of unauthorizedUsers) {
      expect(canAccessLibraryIntakePeiaPreparation(unauthorizedUser)).toBe(false);

      const html = renderIntakeViewMarkup({
        currentUser: unauthorizedUser,
        intakeRecords: [record],
        language: 'en',
      });
      expect(html).not.toContain(`data-testid="intake-peia-prep-action-${record.id}"`);

      // Controller also blocks programmatic open/request calls for unauthorized users
      const getStatusSpy = vi.fn();
      const requestPrepSpy = vi.fn();
      const controller = new LibraryIntakePeiaPreparationController(unauthorizedUser, {
        getIntakePeiaPreparationStatus: getStatusSpy,
        requestIntakePeiaPreparation: requestPrepSpy,
      });
      await controller.openModal(record);
      expect(getStatusSpy).not.toHaveBeenCalled();
      expect(controller.getSnapshot().activeIntake).toBeNull();
    }
  });

  it('19. Isolates cross-record late responses when switching from Intake A to Intake B or closing the modal', async () => {
    const intakeA = buildIntakeRecord({
      id: 'intake-doc-A',
      title: 'Intake Record Alpha',
      updatedAt: '2026-04-10T08:00:00.000Z',
    });
    const intakeB = buildIntakeRecord({
      id: 'intake-doc-B',
      title: 'Intake Record Beta',
      updatedAt: '2026-04-10T09:00:00.000Z',
    });

    let resolveStatusA!: (res: GetLibraryIntakePeiaPreparationStatusResponseDto) => void;
    const statusPromiseA = new Promise<GetLibraryIntakePeiaPreparationStatusResponseDto>(
      (resolve) => {
        resolveStatusA = resolve;
      }
    );

    const statusBResponse = buildStatusResponse(intakeB, AITaskStatus.Pending);

    const getStatusSpy = vi.fn((intakeId: string) => {
      if (intakeId === intakeA.id) {
        return statusPromiseA;
      }
      return Promise.resolve(statusBResponse);
    });

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakePeiaPreparationStatus: getStatusSpy,
    });

    // Open Intake A (status request A stays in flight)
    const openAPromise = controller.openModal(intakeA);
    expect(controller.getSnapshot().activeIntake?.id).toBe('intake-doc-A');

    // Switch immediately to Intake B before A resolves
    await controller.openModal(intakeB);
    expect(controller.getSnapshot().activeIntake?.id).toBe('intake-doc-B');
    expect(controller.getSnapshot().peiaStatus?.intakeId).toBe('intake-doc-B');
    expect(controller.getSnapshot().peiaStatus?.status).toBe(AITaskStatus.Pending);

    // Late resolution for Intake A arrives now — must be ignored
    resolveStatusA(buildStatusResponse(intakeA, AITaskStatus.Completed));
    await openAPromise;

    expect(controller.getSnapshot().activeIntake?.id).toBe('intake-doc-B');
    expect(controller.getSnapshot().peiaStatus?.intakeId).toBe('intake-doc-B');
    expect(controller.getSnapshot().peiaStatus?.status).toBe(AITaskStatus.Pending);
  });

  it('20. Shows a clear user-visible error banner on backend failure and never fabricates a completed/pending or false NotRequested state', async () => {
    const record = buildIntakeRecord();
    const getStatusSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('PERMISSION_DENIED: Firestore rules rejected status read'));
    const getIntakeByIdSpy = vi.fn().mockResolvedValue(record);
    const requestPrepSpy = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('FAILED_PRECONDITION: STALE_SOURCE_VERSION detected on server')
      );

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: getIntakeByIdSpy,
      getIntakePeiaPreparationStatus: getStatusSpy,
      requestIntakePeiaPreparation: requestPrepSpy,
    });

    // 1. Status read failure on open
    await controller.openModal(record);
    expect(controller.getSnapshot().peiaStatus).toBeNull();
    expect(controller.getSnapshot().peiaError).toContain('PERMISSION_DENIED');

    const statusErrHtml = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: controller.getSnapshot(),
      language: 'en',
    });
    expect(statusErrHtml).toContain('data-testid="peia-error-banner"');
    expect(statusErrHtml).not.toContain('data-testid="peia-status-not-requested"');
    expect(statusErrHtml).not.toContain('data-testid="peia-status-completed"');

    // 2. Request preparation failure
    await controller.requestPreparation();
    expect(controller.getSnapshot().peiaError).toContain('STALE_SOURCE_VERSION');
    expect(controller.getSnapshot().lastEnqueueDisposition).toBeNull();
    expect(requestPrepSpy).toHaveBeenCalledTimes(1); // No automatic retry
  });

  it('21. Does not automatically mutate editorial intake status or invoke updateIntakeStatus during PEIA status/request operations', async () => {
    const record = buildIntakeRecord({ status: LibraryIntakeStatus.PendingReview });
    const updateIntakeStatusSpy = vi.spyOn(LibraryAdminClient, 'updateIntakeStatus');

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakeById: vi.fn().mockResolvedValue(record),
      getIntakePeiaPreparationStatus: vi
        .fn()
        .mockResolvedValue(buildStatusResponse(record, 'NotRequested')),
      requestIntakePeiaPreparation: vi
        .fn()
        .mockResolvedValue(buildEnqueueResponse(record, 'CREATED', AITaskStatus.Pending)),
    });

    await controller.openModal(record);
    await controller.requestPreparation();

    expect(updateIntakeStatusSpy).not.toHaveBeenCalled();
    expect(controller.getSnapshot().activeIntake?.status).toBe(LibraryIntakeStatus.PendingReview);
  });

  it('22. Preserves RTL/LTR directional alignment and responsive layout classes in both Arabic and English modes', () => {
    const record = buildIntakeRecord();
    const completedRes = buildStatusResponse(record, AITaskStatus.Completed);

    const htmlAr = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: completedRes.preparationStatus,
      },
      language: 'ar',
    });

    const htmlEn = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: completedRes.preparationStatus,
      },
      language: 'en',
    });

    // RTL/LTR directional classes and responsive container classes
    expect(htmlAr).toContain('rtl:text-right ltr:text-left');
    expect(htmlAr).toContain('max-w-3xl w-full p-4 sm:p-6');
    expect(htmlAr).toContain('grid-cols-1 sm:grid-cols-2');
    expect(htmlAr).toContain('break-all');
    expect(htmlAr).toContain('مساعد التحضير الاسترشادي الموحد (PEIA — مراجعة بشرية إلزامية)');

    expect(htmlEn).toContain('rtl:text-right ltr:text-left');
    expect(htmlEn).toContain('max-w-3xl w-full p-4 sm:p-6');
    expect(htmlEn).toContain('PEIA Unified Intake Preparation Assistant (Mandatory Human Review)');
  });

  it('23. Renders dual responsive presentations: preserved desktop table (hidden lg:block) and mobile vertical cards (block lg:hidden) from single filtered data source', () => {
    const record = buildIntakeRecord();
    const htmlEn = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      language: 'en',
    });

    // Desktop table container preservation
    expect(htmlEn).toContain('data-testid="intake-desktop-table"');
    expect(htmlEn).toContain('hidden lg:block');

    // Mobile cards container
    expect(htmlEn).toContain('data-testid="intake-mobile-cards"');
    expect(htmlEn).toContain('block lg:hidden');

    // Exactly one desktop preparation button and one mobile preparation button
    const desktopPrepMatches =
      htmlEn.match(/data-testid="intake-peia-prep-action-intake-doc-101"/g) ?? [];
    expect(desktopPrepMatches.length).toBe(1);

    const mobilePrepMatches =
      htmlEn.match(/data-testid="intake-peia-prep-action-mobile-intake-doc-101"/g) ?? [];
    expect(mobilePrepMatches.length).toBe(1);

    // Exactly one desktop review button and one mobile review button
    const desktopReviewMatches =
      htmlEn.match(/data-testid="intake-human-review-action-intake-doc-101"/g) ?? [];
    expect(desktopReviewMatches.length).toBe(1);

    const mobileReviewMatches =
      htmlEn.match(/data-testid="intake-human-review-action-mobile-intake-doc-101"/g) ?? [];
    expect(mobileReviewMatches.length).toBe(1);
  });

  it('24. Mobile card presentation protects against narrow viewport squashing, character stacking, and horizontal overflow', () => {
    const record = buildIntakeRecord({
      title: 'تقرير التقييم البيئي الاستراتيجي الموسع لمنظومة الطاقة المتجددة في الشرق الأوسط وشمال أفريقيا 2026',
      url: 'https://ministry.environment.gov.eg/very/long/nested/path/to/environmental-assessment-report-2026-final.pdf',
      normalizedUrl: 'https://ministry.environment.gov.eg/very/long/nested/path/to/environmental-assessment-report-2026-final.pdf',
      notes: 'ملاحظات تدقيق موسعة لبيان مطابقة المعايير الفنية والتنظيمية للوثيقة.',
      reviewNotes: 'تمت مراجعة الوثيقة من قبل المحرر الأول وتنتظر التحضير الاسترشادي.',
      aiSuggestion: {
        suggestedTitle: 'عنوان مقترح قديم من جيميني',
        suggestedOrganization: 'جهة قديمة',
        suggestedDocumentType: 'LAW',
        suggestedTopics: ['طاقة', 'بيئة'],
        summary: 'ملخص تراثي قديم للقراءة فقط.',
        confidence: 0.85,
        model: 'gemini-1.5-pro',
      },
    });

    const htmlAr = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      language: 'ar',
    });

    // Mobile card container presence
    expect(htmlAr).toContain(`data-testid="intake-mobile-card-${record.id}"`);

    // Anti-squashing and overflow protection classes
    expect(htmlAr).toContain('break-words');
    expect(htmlAr).toContain('break-all');

    // Title and URL rendered within card
    expect(htmlAr).toContain('تقرير التقييم البيئي الاستراتيجي الموسع لمنظومة الطاقة المتجددة');
    expect(htmlAr).toContain('https://ministry.environment.gov.eg/very/long/nested/path/to/environmental-assessment-report-2026-final.pdf');

    // Editorial notes and review notes rendered
    expect(htmlAr).toContain('ملاحظات تدقيق موسعة لبيان مطابقة المعايير');
    expect(htmlAr).toContain('تمت مراجعة الوثيقة من قبل المحرر الأول');

    // Legacy AI suggestion rendered as read-only badge
    expect(htmlAr).toContain('مقترحات آلية (غير موثقة)');

    // Single mobile PEIA prep button rendered
    expect(htmlAr).toContain(`data-testid="intake-peia-prep-action-mobile-${record.id}"`);
    expect(htmlAr).toContain('تحضير ومراجعة PEIA الاسترشادية');
  });

  it('25. Mobile card actions strictly adhere to RBAC permissions across all admin roles', () => {
    const record = buildIntakeRecord();

    const unauthorizedUsers: AdminUser[] = [
      buildAdminUser(AdminRole.ContentEditor),
      buildAdminUser(AdminRole.Viewer),
      buildAdminUser(AdminRole.CitizenModerator),
      buildAdminUser(AdminRole.Trainer),
      buildAdminUser(AdminRole.AIAssistant),
      buildAdminUser(AdminRole.LibraryCurator, { isActive: false }),
      buildAdminUser(AdminRole.Owner, { isActive: false }),
    ];

    for (const unauthorizedUser of unauthorizedUsers) {
      expect(canAccessLibraryIntakePeiaPreparation(unauthorizedUser)).toBe(false);

      const html = renderIntakeViewMarkup({
        currentUser: unauthorizedUser,
        intakeRecords: [record],
        language: 'en',
      });

      // Neither desktop nor mobile PEIA prep action should exist in DOM
      expect(html).not.toContain(`data-testid="intake-peia-prep-action-${record.id}"`);
      expect(html).not.toContain(`data-testid="intake-peia-prep-action-mobile-${record.id}"`);
    }

    // Authorized roles: Curator, Owner, and active RightsReviewer have PEIA preparation access
    for (const authorizedUser of [curatorUser, ownerUser, rightsReviewerUser]) {
      expect(canAccessLibraryIntakePeiaPreparation(authorizedUser)).toBe(true);

      const html = renderIntakeViewMarkup({
        currentUser: authorizedUser,
        intakeRecords: [record],
        language: 'en',
      });

      expect(html).toContain(`data-testid="intake-peia-prep-action-${record.id}"`);
      expect(html).toContain(`data-testid="intake-peia-prep-action-mobile-${record.id}"`);
    }
  });

  it('26. Displays Completed + ABSTAINED in English and Arabic with task ID, outcome kind, reason, timestamp, model attempts, and optional detail without fabricated advisory findings or Failed label', () => {
    const record = buildIntakeRecord();
    const task = buildPeiaTask(record, AITaskStatus.Completed);
    const abstainedDto: SanitizedLibraryIntakePeiaPreparationStatusDto = {
      status: AITaskStatus.Completed,
      taskId: task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: record.id,
      intakeId: record.id,
      currentSourceUpdatedAt: record.updatedAt,
      taskSourceUpdatedAt: record.updatedAt,
      isStale: false,
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      task,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: {
        taskId: task.taskId,
        kind: 'ABSTAINED',
        reason: 'INVALID_MODEL_OUTPUT',
        modelAttempts: 2,
        createdAt: '2026-04-10T09:37:00.000Z',
        detail: 'Local model output did not conform to canonical preparation schema.',
      },
    };

    const htmlEn = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: abstainedDto,
      },
      language: 'en',
    });

    expect(htmlEn).toContain('data-testid="peia-status-completed-abstained"');
    expect(htmlEn).toContain('PEIA Processing Completed — No Advisory Produced (Abstained)');
    expect(htmlEn).toContain(`Task ID: ${task.taskId}`);
    expect(htmlEn).toContain('Outcome Kind: ABSTAINED');
    expect(htmlEn).toContain('Reason Code: INVALID_MODEL_OUTPUT');
    expect(htmlEn).toContain('Completed At: 2026-04-10T09:37:00.000Z');
    expect(htmlEn).toContain('Model Attempts: 2');
    expect(htmlEn).toContain('data-testid="peia-abstained-detail"');
    expect(htmlEn).toContain('Local model output did not conform to canonical preparation schema.');
    expect(htmlEn).not.toContain('data-testid="peia-status-completed"');
    expect(htmlEn).not.toContain('data-testid="peia-completed-summaries"');
    expect(htmlEn).not.toContain('data-testid="peia-status-failed"');

    const htmlAr = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: abstainedDto,
      },
      language: 'ar',
    });

    expect(htmlAr).toContain('data-testid="peia-status-completed-abstained"');
    expect(htmlAr).toContain('اكتملت معالجة المهمة دون إنتاج مقترحات استشارية — امتناع PEIA');
    expect(htmlAr).toContain(`Task ID: ${task.taskId}`);
    expect(htmlAr).toContain('Outcome Kind: ABSTAINED');
    expect(htmlAr).toContain('Reason Code: INVALID_MODEL_OUTPUT');
    expect(htmlAr).toContain('Completed At: 2026-04-10T09:37:00.000Z');
    expect(htmlAr).toContain('Model Attempts: 2');
    expect(htmlAr).toContain('Local model output did not conform to canonical preparation schema.');
    expect(htmlAr).not.toContain('data-testid="peia-status-completed"');
    expect(htmlAr).not.toContain('data-testid="peia-status-failed"');
  });

  it('27. Preserves stale warning, legacy Gemini read-only section, refresh action, desktop/mobile compatibility, and RBAC under Completed + ABSTAINED', () => {
    const record = buildIntakeRecord({
      updatedAt: '2026-04-10T16:00:00.000Z',
      aiSuggestion: {
        modelId: 'gemini-2.5-flash',
        generatedAt: '2026-03-15T10:00:00.000Z',
        generatedByAdminId: 'admin-legacy',
        generatedByAdminName: 'Legacy Curator',
        inputBasis: LibraryIntakeAIInputBasis.MetadataOnly,
        suggestedTitleAr: 'عنوان قديم محفوظ من جيميني',
        suggestedTitleEn: 'Legacy Stored Gemini Title',
        suggestedIssuingOrganization: 'Legacy Ministry',
        suggestedDocumentType: LibraryDocumentType.Report,
        suggestedEnvironmentalDomains: ['Biodiversity'],
        suggestedTopicsAr: ['التنوع الحيوي'],
        suggestedTopicsEn: ['Biodiversity'],
        provenanceObservationsAr: ['ملاحظة سابقة'],
        provenanceObservationsEn: ['Legacy provenance observation'],
        uncertaintyNoticesAr: ['تنبيه سابق'],
        uncertaintyNoticesEn: ['Legacy uncertainty notice'],
        verificationWarningAr: 'تحذير قديم',
        verificationWarningEn: 'Legacy warning',
      },
    });
    const staleTaskVersion = '2026-04-10T09:30:00.000Z';
    const task = buildPeiaTask(
      { ...record, updatedAt: staleTaskVersion },
      AITaskStatus.Completed
    );
    const abstainedStaleDto: SanitizedLibraryIntakePeiaPreparationStatusDto = {
      status: AITaskStatus.Completed,
      taskId: task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: record.id,
      intakeId: record.id,
      currentSourceUpdatedAt: record.updatedAt,
      taskSourceUpdatedAt: staleTaskVersion,
      isStale: true,
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      task,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: {
        taskId: task.taskId,
        kind: 'ABSTAINED',
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: '2026-04-10T09:38:00.000Z',
      },
    };

    const htmlEn = renderIntakeViewMarkup({
      currentUser: curatorUser,
      intakeRecords: [record],
      modalState: {
        activeIntake: record,
        peiaStatus: abstainedStaleDto,
      },
      language: 'en',
    });

    expect(htmlEn).toContain('data-testid="peia-stale-warning-banner"');
    expect(htmlEn).toContain('data-testid="peia-status-completed-abstained"');
    expect(htmlEn).toContain('Reason Code: NO_EVIDENCE');
    expect(htmlEn).toContain('Model Attempts: 0');
    expect(htmlEn).not.toContain('data-testid="peia-abstained-detail"');
    expect(htmlEn).toContain('data-testid="legacy-gemini-suggestion-readonly"');
    expect(htmlEn).toContain('data-testid="peia-refresh-status-btn"');
    expect(htmlEn).toContain('Request Fresh PEIA Preparation');
    expect(htmlEn).toContain('data-testid="intake-desktop-table"');
    expect(htmlEn).toContain('data-testid="intake-mobile-cards"');
  });

  it('28. Controller transitions cleanly from Pending to Completed + ABSTAINED on refreshStatus without mutating intake status', async () => {
    const record = buildIntakeRecord();
    const pendingRes = buildStatusResponse(record, AITaskStatus.Pending);
    const completedTask = buildPeiaTask(record, AITaskStatus.Completed);
    const abstainedDto: SanitizedLibraryIntakePeiaPreparationStatusDto = {
      status: AITaskStatus.Completed,
      taskId: completedTask.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: record.id,
      intakeId: record.id,
      currentSourceUpdatedAt: record.updatedAt,
      taskSourceUpdatedAt: record.updatedAt,
      isStale: false,
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      task: completedTask,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: {
        taskId: completedTask.taskId,
        kind: 'ABSTAINED',
        reason: 'INVALID_MODEL_OUTPUT',
        modelAttempts: 2,
        createdAt: '2026-04-10T09:37:00.000Z',
      },
    };
    const abstainedRes: GetLibraryIntakePeiaPreparationStatusResponseDto = {
      ...abstainedDto,
      preparationStatus: abstainedDto,
      reviewStatus: abstainedDto,
    };

    const getStatusSpy = vi
      .fn()
      .mockResolvedValueOnce(pendingRes)
      .mockResolvedValueOnce(abstainedRes);

    const controller = new LibraryIntakePeiaPreparationController(curatorUser, {
      getIntakePeiaPreparationStatus: getStatusSpy,
    });

    await controller.openModal(record);
    expect(controller.getSnapshot().peiaStatus?.status).toBe(AITaskStatus.Pending);

    await controller.refreshStatus();
    expect(getStatusSpy).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().peiaStatus?.status).toBe(AITaskStatus.Completed);
    expect(controller.getSnapshot().peiaStatus?.advisoryResult).toBeNull();
    expect(controller.getSnapshot().peiaStatus?.libraryPreparation).toBeNull();
    expect(controller.getSnapshot().peiaStatus?.nonAdvisoryOutcome?.kind).toBe('ABSTAINED');
    expect(controller.getSnapshot().peiaError).toBeNull();
    expect(controller.getSnapshot().activeIntake?.status).toBe(LibraryIntakeStatus.PendingReview);
  });
});
