import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetFunctions, mockHttpsCallable, mockCallableInvoke, mockFirebaseState } =
  vi.hoisted(() => {
    const callableInvoke = vi.fn();
    return {
      mockGetFunctions: vi.fn(() => ({ name: 'mock-functions-instance' })),
      mockHttpsCallable: vi.fn(() => callableInvoke),
      mockCallableInvoke: callableInvoke,
      mockFirebaseState: {
        isFirebaseConfigured: true,
        app: { name: '[DEFAULT]' } as unknown,
        auth: {
          currentUser: {
            uid: 'curator_uid_01',
            email: 'curator@promiseofplanet.org',
          },
        } as {
          currentUser: {
            uid: string;
            email?: string;
          } | null;
        } | null,
      },
    };
  });

vi.mock('firebase/functions', () => ({
  getFunctions: mockGetFunctions,
  httpsCallable: mockHttpsCallable,
}));

vi.mock('./firebase', () => ({
  get isFirebaseConfigured() {
    return mockFirebaseState.isFirebaseConfigured;
  },
  get app() {
    return mockFirebaseState.app;
  },
  get auth() {
    return mockFirebaseState.auth;
  },
}));

import {
  AIReviewSeverity,
  AIReviewTargetType,
  AITaskStatus,
  AITaskType,
  LibraryAdminClient,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
  type AdvisoryResultIntakeResult,
  type AIReviewTask,
  type CanonicalNonAdvisoryOutcome,
  type GetLibraryIntakePeiaPreparationStatusResponseDto,
  type PEIALibraryPreparationAdvisoryPayload,
  type RequestLibraryIntakePeiaPreparationResponseDto,
  type SanitizedLibraryIntakePeiaPreparationStatusDto,
} from './libraryAdminClient';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
} from '../types/library';
import {
  LibraryIntakeStatus,
  type LibraryIntakeRecord,
} from '../../functions/src/shared/libraryContract';
import { WorkflowState } from '../types/workflow';

const SAMPLE_INTAKE_ID = 'intake-lib-2026-001';
const SAMPLE_UPDATED_AT = '2026-10-30T09:15:00.000Z';
const SAMPLE_TASK_ID = 'peia-task-0123456789abcdef0123456789abcdef';
const SAMPLE_DOC_ID =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const CANONICAL_14_PREPARATION_KEYS = [
  'inputBasis',
  'suggestedTitleAr',
  'suggestedTitleEn',
  'suggestedIssuingOrganization',
  'suggestedDocumentType',
  'suggestedEnvironmentalDomains',
  'suggestedTopicsAr',
  'suggestedTopicsEn',
  'suggestedSummaryAr',
  'suggestedSummaryEn',
  'provenanceObservationsAr',
  'provenanceObservationsEn',
  'uncertaintyNoticesAr',
  'uncertaintyNoticesEn',
] as const;

function createSampleTask(
  overrides: Partial<AIReviewTask> = {}
): AIReviewTask {
  return {
    taskId: SAMPLE_TASK_ID,
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: SAMPLE_INTAKE_ID,
      sourceUpdatedAt: SAMPLE_UPDATED_AT,
    },
    contentSnapshot: {
      allowSnapshotEvidence: true,
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'تقرير حالة البيئة الساحلية والبحرية في السودان 2026',
      issuingOrganization: 'المجلس الأعلى للبيئة والموارد الطبيعية',
      language: 'ar',
    },
    createdAt: '2026-10-30T09:20:00.000Z',
    status: AITaskStatus.Pending,
    ...overrides,
  };
}

function createSampleLibraryPreparation(
  overrides: Partial<PEIALibraryPreparationAdvisoryPayload> = {}
): PEIALibraryPreparationAdvisoryPayload {
  return {
    inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
    suggestedTitleAr: 'تقرير حالة البيئة الساحلية والبحرية في السودان 2026',
    suggestedTitleEn:
      'State of the Coastal and Marine Environment Report in Sudan 2026',
    suggestedIssuingOrganization:
      'المجلس الأعلى للبيئة والموارد الطبيعية (HCENR)',
    suggestedDocumentType:
      PEIALibrarySuggestedDocumentType.InstitutionalReport,
    suggestedEnvironmentalDomains: ['MarineEnvironment', 'Biodiversity'],
    suggestedTopicsAr: ['البيئة البحرية', 'البحر الأحمر'],
    suggestedTopicsEn: ['Marine Environment', 'Red Sea'],
    suggestedSummaryAr: null,
    suggestedSummaryEn: null,
    provenanceObservationsAr: [
      'مرتكز على لقطة البيانات الوصفية المعتمدة لسجل الاستقبال فقط.',
    ],
    provenanceObservationsEn: [
      'Grounded strictly in the authoritative intake metadata snapshot.',
    ],
    uncertaintyNoticesAr: [
      'لم تتم قراءة أو جلب الملف الخارجي الكامل للوثيقة.',
    ],
    uncertaintyNoticesEn: [
      'Full remote document was not fetched or inspected.',
    ],
    ...overrides,
  };
}

function createSampleAdvisoryResult(
  libraryPreparation: PEIALibraryPreparationAdvisoryPayload = createSampleLibraryPreparation(),
  taskOverrides: Partial<AdvisoryResultIntakeResult['task']> = {}
): AdvisoryResultIntakeResult {
  return {
    schemaVersion: 1,
    humanReviewRequired: true,
    task: {
      taskId: SAMPLE_TASK_ID,
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.LibraryIntake,
        targetId: SAMPLE_INTAKE_ID,
        sourceUpdatedAt: SAMPLE_UPDATED_AT,
      },
      ...taskOverrides,
    },
    assessment: {
      summary: 'تم إعداد مقترحات الفهرسة الأولية استناداً إلى البيانات الوصفية فقط.',
      findings: [
        {
          code: 'METADATA_ONLY_PREPARATION',
          severity: AIReviewSeverity.Info,
          message: 'المقترحات استشارية وتحتاج إلى مراجعة بشرية قبل الاعتماد.',
          evidenceIds: [`TASK_CONTENT_SNAPSHOT::intake-${SAMPLE_INTAKE_ID}`],
        },
      ],
    },
    recommendations: ['مراجعة النص الأصلي للوثيقة قبل إنشاء سجل المكتبة.'],
    uncertainties: ['الاستنتاجات مبنية على البيانات الوصفية دون مقتطف نصي.'],
    limitations: ['تحليل مقتصر على البيانات الوصفية المسجلة.'],
    libraryPreparation,
  };
}

function createSampleStatusDto(
  overrides: Partial<SanitizedLibraryIntakePeiaPreparationStatusDto> = {}
): SanitizedLibraryIntakePeiaPreparationStatusDto {
  const task = createSampleTask();
  return {
    status: AITaskStatus.Pending,
    taskId: SAMPLE_TASK_ID,
    targetType: AIReviewTargetType.LibraryIntake,
    targetId: SAMPLE_INTAKE_ID,
    intakeId: SAMPLE_INTAKE_ID,
    currentSourceUpdatedAt: SAMPLE_UPDATED_AT,
    taskSourceUpdatedAt: SAMPLE_UPDATED_AT,
    isStale: false,
    inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
    task,
    advisoryResult: null,
    libraryPreparation: null,
    nonAdvisoryOutcome: null,
    ...overrides,
  };
}

function createSampleRequestResponseDto(
  statusOverrides: Partial<SanitizedLibraryIntakePeiaPreparationStatusDto> = {},
  topOverrides: Partial<RequestLibraryIntakePeiaPreparationResponseDto> = {}
): RequestLibraryIntakePeiaPreparationResponseDto {
  const statusDto = createSampleStatusDto(statusOverrides);
  const task = statusDto.task ?? createSampleTask();
  return {
    disposition: 'CREATED',
    documentId: SAMPLE_DOC_ID,
    taskId: statusDto.taskId,
    intakeId: statusDto.intakeId,
    inputBasis:
      statusDto.inputBasis ?? PEIALibraryPreparationInputBasis.MetadataOnly,
    task,
    status: statusDto.status,
    isStale: statusDto.isStale,
    advisoryResult: statusDto.advisoryResult,
    libraryPreparation: statusDto.libraryPreparation,
    nonAdvisoryOutcome: statusDto.nonAdvisoryOutcome,
    preparationStatus: statusDto,
    reviewStatus: statusDto,
    ...topOverrides,
  };
}

function createSampleStatusResponseDto(
  statusOverrides: Partial<SanitizedLibraryIntakePeiaPreparationStatusDto> = {}
): GetLibraryIntakePeiaPreparationStatusResponseDto {
  const statusDto = createSampleStatusDto(statusOverrides);
  return {
    ...statusDto,
    preparationStatus: statusDto,
    reviewStatus: statusDto,
  };
}

describe('PEIA-UNIFIED-ADMIN / SUBUNIT-3A / CONTRACT-REPAIR-01 — LibraryAdminClient PEIA Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFirebaseState.isFirebaseConfigured = true;
    mockFirebaseState.app = { name: '[DEFAULT]' };
    mockFirebaseState.auth = {
      currentUser: {
        uid: 'curator_uid_01',
        email: 'curator@promiseofplanet.org',
      },
    };
  });

  it('1. Exact request payload: sends { action: "requestIntakePeiaPreparation", intakeId, expectedUpdatedAt } and validates input arguments', async () => {
    const serverDto = createSampleRequestResponseDto();
    mockCallableInvoke.mockResolvedValueOnce({ data: serverDto });

    const response = await LibraryAdminClient.requestIntakePeiaPreparation(
      SAMPLE_INTAKE_ID,
      SAMPLE_UPDATED_AT
    );

    expect(mockGetFunctions).toHaveBeenCalledTimes(1);
    expect(mockHttpsCallable).toHaveBeenCalledTimes(1);
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'manageLibraryDocuments'
    );
    expect(mockCallableInvoke).toHaveBeenCalledTimes(1);

    const sentPayload = mockCallableInvoke.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(sentPayload)).toEqual([
      'action',
      'intakeId',
      'expectedUpdatedAt',
    ]);
    expect(sentPayload).toEqual({
      action: 'requestIntakePeiaPreparation',
      intakeId: SAMPLE_INTAKE_ID,
      expectedUpdatedAt: SAMPLE_UPDATED_AT,
    });
    expect(response.disposition).toBe('CREATED');
    expect(response.documentId).toBe(SAMPLE_DOC_ID);
    expect(response.taskId).toBe(SAMPLE_TASK_ID);
    expect(response.intakeId).toBe(SAMPLE_INTAKE_ID);
    expect(response.status).toBe(AITaskStatus.Pending);

    // Reject invalid intakeId and expectedUpdatedAt before invoking httpsCallable
    vi.clearAllMocks();
    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation('', SAMPLE_UPDATED_AT)
    ).rejects.toThrow(/INVALID_ARGUMENT: intakeId/);
    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation(
        ' intake-1 ',
        SAMPLE_UPDATED_AT
      )
    ).rejects.toThrow(/INVALID_ARGUMENT: intakeId/);
    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation(
        SAMPLE_INTAKE_ID,
        'not-an-iso-timestamp'
      )
    ).rejects.toThrow(/INVALID_ARGUMENT: expectedUpdatedAt/);
    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation(SAMPLE_INTAKE_ID, '')
    ).rejects.toThrow(/INVALID_ARGUMENT: expectedUpdatedAt/);
    expect(mockHttpsCallable).not.toHaveBeenCalled();
  });

  it('2. Exact status payload: sends { action: "getIntakePeiaPreparationStatus", intakeId } without undefined taskId key when omitted', async () => {
    const pendingDto = createSampleStatusResponseDto();
    mockCallableInvoke
      .mockResolvedValueOnce({ data: pendingDto })
      .mockResolvedValueOnce({ data: pendingDto });

    await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);
    await LibraryAdminClient.getIntakePeiaPreparationStatus(
      SAMPLE_INTAKE_ID,
      undefined
    );

    expect(mockCallableInvoke).toHaveBeenCalledTimes(2);
    for (const call of mockCallableInvoke.mock.calls) {
      const sentPayload = call[0] as Record<string, unknown>;
      expect(Object.keys(sentPayload)).toEqual(['action', 'intakeId']);
      expect('taskId' in sentPayload).toBe(false);
      expect(sentPayload).toEqual({
        action: 'getIntakePeiaPreparationStatus',
        intakeId: SAMPLE_INTAKE_ID,
      });
    }
  });

  it('3. NotRequested with non-null deterministic taskId: preserves server deterministic taskId and null task/result fields', async () => {
    const notRequestedDto = createSampleStatusResponseDto({
      status: 'NotRequested',
      taskId: SAMPLE_TASK_ID,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: SAMPLE_INTAKE_ID,
      intakeId: SAMPLE_INTAKE_ID,
      currentSourceUpdatedAt: SAMPLE_UPDATED_AT,
      taskSourceUpdatedAt: null,
      isStale: false,
      inputBasis: null,
      task: null,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: null,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: notRequestedDto });

    const response =
      await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);

    expect(response.status).toBe('NotRequested');
    expect(response.taskId).toBe(SAMPLE_TASK_ID);
    expect(response.targetType).toBe(AIReviewTargetType.LibraryIntake);
    expect(response.targetId).toBe(SAMPLE_INTAKE_ID);
    expect(response.intakeId).toBe(SAMPLE_INTAKE_ID);
    expect(response.currentSourceUpdatedAt).toBe(SAMPLE_UPDATED_AT);
    expect(response.taskSourceUpdatedAt).toBeNull();
    expect(response.isStale).toBe(false);
    expect(response.inputBasis).toBeNull();
    expect(response.task).toBeNull();
    expect(response.advisoryResult).toBeNull();
    expect(response.libraryPreparation).toBeNull();
    expect(response.nonAdvisoryOutcome).toBeNull();
    expect(response.preparationStatus.status).toBe('NotRequested');
    expect(response.reviewStatus.status).toBe('NotRequested');
  });

  it('4. Pending with actual task object: preserves top-level status, AIReviewTask, and null outcome artifacts', async () => {
    const pendingTask = createSampleTask({
      status: AITaskStatus.Pending,
      contentSnapshot: {
        allowSnapshotEvidence: true,
        inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        title: 'تقرير حالة البيئة الساحلية والبحرية في السودان 2026',
        suppliedExcerpt: 'مقتطف نصي من التقرير المرجعي.',
      },
    });
    const pendingDto = createSampleStatusResponseDto({
      status: AITaskStatus.Pending,
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      task: pendingTask,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome: null,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: pendingDto });

    const response =
      await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);

    expect(response.status).toBe(AITaskStatus.Pending);
    expect(response.taskId).toBe(SAMPLE_TASK_ID);
    expect(response.inputBasis).toBe(
      PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata
    );
    expect(response.task).toEqual(pendingTask);
    expect(response.advisoryResult).toBeNull();
    expect(response.libraryPreparation).toBeNull();
    expect(response.nonAdvisoryOutcome).toBeNull();
  });

  it('5. Completed with actual 14-field libraryPreparation: preserves advisoryResult and exact 14-field PEIALibraryPreparationAdvisoryPayload', async () => {
    const completedTask = createSampleTask({
      status: AITaskStatus.Completed,
      contentSnapshot: {
        allowSnapshotEvidence: true,
        inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        title: 'تقرير حالة البيئة الساحلية والبحرية في السودان 2026',
        suppliedExcerpt: 'مقتطف نصي معتمد من الوثيقة.',
      },
    });
    const libraryPreparation = createSampleLibraryPreparation({
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      suggestedDocumentType: PEIALibrarySuggestedDocumentType.PolicyPaper,
      suggestedSummaryAr: 'ملخص استشاري أولي مرتكز على المقتطف المرفق.',
      suggestedSummaryEn:
        'Preliminary advisory summary grounded in the supplied excerpt.',
    });
    const advisoryResult = createSampleAdvisoryResult(libraryPreparation);
    const completedDto = createSampleStatusResponseDto({
      status: AITaskStatus.Completed,
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      task: completedTask,
      advisoryResult,
      libraryPreparation,
      nonAdvisoryOutcome: null,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: completedDto });

    const response =
      await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);

    expect(response.status).toBe(AITaskStatus.Completed);
    expect(response.advisoryResult).toEqual(advisoryResult);
    expect(response.advisoryResult?.humanReviewRequired).toBe(true);
    expect(response.libraryPreparation).toEqual(libraryPreparation);
    expect(Object.keys(response.libraryPreparation!)).toEqual(
      CANONICAL_14_PREPARATION_KEYS
    );
    expect(response.nonAdvisoryOutcome).toBeNull();
    expect('approved' in response).toBe(false);
    expect('published' in response).toBe(false);
    expect('applied' in response).toBe(false);
  });

  it('6. Failed with actual CanonicalNonAdvisoryOutcome: preserves nonAdvisoryOutcome and null advisory fields', async () => {
    const failedTask = createSampleTask({ status: AITaskStatus.Failed });
    const nonAdvisoryOutcome: CanonicalNonAdvisoryOutcome = {
      taskId: SAMPLE_TASK_ID,
      kind: 'MODEL_FAILURE',
      reason: 'TIMEOUT',
      modelAttempts: 2,
      createdAt: '2026-10-30T09:25:00.000Z',
      detail: 'Local worker inference timed out.',
    };
    const failedDto = createSampleStatusResponseDto({
      status: AITaskStatus.Failed,
      task: failedTask,
      advisoryResult: null,
      libraryPreparation: null,
      nonAdvisoryOutcome,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: failedDto });

    const response =
      await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);

    expect(response.status).toBe(AITaskStatus.Failed);
    expect(response.task).toEqual(failedTask);
    expect(response.advisoryResult).toBeNull();
    expect(response.libraryPreparation).toBeNull();
    expect(response.nonAdvisoryOutcome).toEqual(nonAdvisoryOutcome);
  });

  it('7. CREATED and ALREADY_EXISTS via disposition: preserves canonical disposition field without requiring creationOutcome', async () => {
    const createdDto = createSampleRequestResponseDto(
      {},
      { disposition: 'CREATED' }
    );
    const existingDto = createSampleRequestResponseDto(
      {},
      { disposition: 'ALREADY_EXISTS' }
    );
    mockCallableInvoke
      .mockResolvedValueOnce({ data: createdDto })
      .mockResolvedValueOnce({ data: existingDto });

    const firstRes = await LibraryAdminClient.requestIntakePeiaPreparation(
      SAMPLE_INTAKE_ID,
      SAMPLE_UPDATED_AT
    );
    const secondRes = await LibraryAdminClient.requestIntakePeiaPreparation(
      SAMPLE_INTAKE_ID,
      SAMPLE_UPDATED_AT
    );

    expect(firstRes.disposition).toBe('CREATED');
    expect(secondRes.disposition).toBe('ALREADY_EXISTS');
    expect('creationOutcome' in firstRes).toBe(false);
    expect('creationOutcome' in secondRes).toBe(false);
  });

  it('8. Explicit historical taskId readback: forwards taskId and rejects mismatched response taskId', async () => {
    const historicalTaskId = 'peia-task-99999999999999999999999999999999';
    const historicalUpdatedAt = '2026-10-29T08:00:00.000Z';
    const historicalTask = createSampleTask({
      taskId: historicalTaskId,
      target: {
        targetType: AIReviewTargetType.LibraryIntake,
        targetId: SAMPLE_INTAKE_ID,
        sourceUpdatedAt: historicalUpdatedAt,
      },
    });
    const stalePendingDto = createSampleStatusResponseDto({
      status: AITaskStatus.Pending,
      taskId: historicalTaskId,
      currentSourceUpdatedAt: SAMPLE_UPDATED_AT,
      taskSourceUpdatedAt: historicalUpdatedAt,
      isStale: true,
      task: historicalTask,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: stalePendingDto });

    const response = await LibraryAdminClient.getIntakePeiaPreparationStatus(
      SAMPLE_INTAKE_ID,
      historicalTaskId
    );

    expect(mockCallableInvoke).toHaveBeenCalledWith({
      action: 'getIntakePeiaPreparationStatus',
      intakeId: SAMPLE_INTAKE_ID,
      taskId: historicalTaskId,
    });
    expect(response.taskId).toBe(historicalTaskId);
    expect(response.isStale).toBe(true);
    expect(response.taskSourceUpdatedAt).toBe(historicalUpdatedAt);

    // Reject response if server returns a different taskId than the caller explicitly requested
    const mismatchedTaskDto = createSampleStatusResponseDto({
      status: AITaskStatus.Pending,
      taskId: SAMPLE_TASK_ID,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: mismatchedTaskDto });
    await expect(
      LibraryAdminClient.getIntakePeiaPreparationStatus(
        SAMPLE_INTAKE_ID,
        historicalTaskId
      )
    ).rejects.toThrow(/does not match requested taskId/);
  });

  it('9. Correct stale-source metadata: preserves isStale, currentSourceUpdatedAt, and taskSourceUpdatedAt without converting stale results to current', async () => {
    const newerSourceUpdatedAt = '2026-10-30T11:00:00.000Z';
    const completedTask = createSampleTask({ status: AITaskStatus.Completed });
    const libraryPreparation = createSampleLibraryPreparation();
    const advisoryResult = createSampleAdvisoryResult(libraryPreparation);

    const staleCompletedDto = createSampleStatusResponseDto({
      status: AITaskStatus.Completed,
      currentSourceUpdatedAt: newerSourceUpdatedAt,
      taskSourceUpdatedAt: SAMPLE_UPDATED_AT,
      isStale: true,
      task: completedTask,
      advisoryResult,
      libraryPreparation,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: staleCompletedDto });

    const response = await LibraryAdminClient.getIntakePeiaPreparationStatus(
      SAMPLE_INTAKE_ID,
      SAMPLE_TASK_ID
    );

    expect(response.status).toBe(AITaskStatus.Completed);
    expect(response.isStale).toBe(true);
    expect(response.currentSourceUpdatedAt).toBe(newerSourceUpdatedAt);
    expect(response.taskSourceUpdatedAt).toBe(SAMPLE_UPDATED_AT);
    expect(response.preparationStatus.isStale).toBe(true);
    expect(response.reviewStatus.isStale).toBe(true);
  });

  it('10. Cross-target response rejection: rejects responses with non-LibraryIntake targetType or mismatched intakeId/targetId', async () => {
    const wrongTargetTypeDto = {
      ...createSampleStatusResponseDto(),
      targetType: AIReviewTargetType.News,
    };
    const wrongTargetIdDto = createSampleStatusResponseDto({
      targetId: 'other-intake-999',
    });
    const wrongIntakeIdDto = createSampleStatusResponseDto({
      intakeId: 'other-intake-999',
    });
    const wrongTaskTargetDto = createSampleStatusResponseDto({
      task: createSampleTask({
        target: {
          targetType: AIReviewTargetType.LibraryIntake,
          targetId: 'other-intake-999',
          sourceUpdatedAt: SAMPLE_UPDATED_AT,
        },
      }),
    });

    for (const badDto of [
      wrongTargetTypeDto,
      wrongTargetIdDto,
      wrongIntakeIdDto,
      wrongTaskTargetDto,
    ]) {
      mockCallableInvoke.mockResolvedValueOnce({ data: badDto });
      await expect(
        LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID)
      ).rejects.toThrow(/INVALID_PEIA_RESPONSE/);
    }
  });

  it('11. Malformed response fail-closed: rejects non-objects, invented client-only shapes, null taskId on NotRequested, and inconsistent state envelopes', async () => {
    const fabricatedClientShape = {
      intakeId: SAMPLE_INTAKE_ID,
      creationOutcome: 'CREATED',
      status: {
        state: 'Pending',
        taskId: SAMPLE_TASK_ID,
        currentIntakeUpdatedAt: SAMPLE_UPDATED_AT,
      },
    };
    const notRequestedWithNullTaskId = {
      ...createSampleStatusResponseDto({
        status: 'NotRequested',
        taskSourceUpdatedAt: null,
        isStale: false,
        inputBasis: null,
        task: null,
      }),
      taskId: null,
    };
    const notRequestedMarkedStale = {
      ...createSampleStatusResponseDto({
        status: 'NotRequested',
        taskSourceUpdatedAt: null,
        inputBasis: null,
        task: null,
      }),
      isStale: true,
    };
    const completedMissingPrep = createSampleStatusResponseDto({
      status: AITaskStatus.Completed,
      task: createSampleTask({ status: AITaskStatus.Completed }),
      advisoryResult: createSampleAdvisoryResult(),
      libraryPreparation: null,
    });
    const failedMissingOutcome = createSampleStatusResponseDto({
      status: AITaskStatus.Failed,
      task: createSampleTask({ status: AITaskStatus.Failed }),
      nonAdvisoryOutcome: null,
    });
    const inconsistentStaleFlag = createSampleStatusResponseDto({
      status: AITaskStatus.Pending,
      currentSourceUpdatedAt: '2026-10-30T12:00:00.000Z',
      taskSourceUpdatedAt: SAMPLE_UPDATED_AT,
      isStale: false,
    });

    for (const badResponse of [
      null,
      undefined,
      [],
      fabricatedClientShape,
      notRequestedWithNullTaskId,
      notRequestedMarkedStale,
      completedMissingPrep,
      failedMissingOutcome,
      inconsistentStaleFlag,
    ]) {
      mockCallableInvoke.mockResolvedValueOnce({ data: badResponse });
      await expect(
        LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID)
      ).rejects.toThrow(/INVALID_PEIA_RESPONSE/);
    }

    mockCallableInvoke.mockResolvedValueOnce({ data: fabricatedClientShape });
    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation(
        SAMPLE_INTAKE_ID,
        SAMPLE_UPDATED_AT
      )
    ).rejects.toThrow(/INVALID_PEIA_RESPONSE/);
  });

  it('12. MetadataOnly summary-null preservation: preserves null summaries for MetadataOnly and rejects fabricated non-null summaries under MetadataOnly', async () => {
    const validMetadataOnlyPrep = createSampleLibraryPreparation({
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      suggestedSummaryAr: null,
      suggestedSummaryEn: null,
    });
    const validCompletedDto = createSampleStatusResponseDto({
      status: AITaskStatus.Completed,
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      task: createSampleTask({ status: AITaskStatus.Completed }),
      advisoryResult: createSampleAdvisoryResult(validMetadataOnlyPrep),
      libraryPreparation: validMetadataOnlyPrep,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: validCompletedDto });

    const res =
      await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);
    expect(res.libraryPreparation?.inputBasis).toBe(
      PEIALibraryPreparationInputBasis.MetadataOnly
    );
    expect(res.libraryPreparation?.suggestedSummaryAr).toBeNull();
    expect(res.libraryPreparation?.suggestedSummaryEn).toBeNull();

    // Fabricated summary under MetadataOnly must fail closed
    const fabricatedMetadataSummaryPrep = createSampleLibraryPreparation({
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      suggestedSummaryAr: 'ملخص مختلق بدون مقتطف نصي.',
      suggestedSummaryEn: 'Fabricated summary without excerpt.',
    });
    const invalidCompletedDto = createSampleStatusResponseDto({
      status: AITaskStatus.Completed,
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      task: createSampleTask({ status: AITaskStatus.Completed }),
      advisoryResult: createSampleAdvisoryResult(fabricatedMetadataSummaryPrep),
      libraryPreparation: fabricatedMetadataSummaryPrep,
    });
    mockCallableInvoke.mockResolvedValueOnce({ data: invalidCompletedDto });

    await expect(
      LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID)
    ).rejects.toThrow(
      /MetadataOnly libraryPreparation must preserve null suggestedSummaryAr and suggestedSummaryEn/
    );
  });

  it('13. No invented advisory vocabulary: rejects READY_FOR_CURATION, REQUIRES_METADATA_CLARIFICATION, REQUIRES_RIGHTS_REVIEW, HOLD, extra confidence/issue fields, and non-canonical document types', async () => {
    const inventedVocabPayloads: Record<string, unknown>[] = [
      {
        ...createSampleLibraryPreparation(),
        recommendation: 'READY_FOR_CURATION',
      },
      {
        ...createSampleLibraryPreparation(),
        recommendation: 'REQUIRES_METADATA_CLARIFICATION',
      },
      {
        ...createSampleLibraryPreparation(),
        recommendation: 'REQUIRES_RIGHTS_REVIEW',
      },
      {
        ...createSampleLibraryPreparation(),
        recommendation: 'HOLD',
      },
      {
        ...createSampleLibraryPreparation(),
        confidence: 'HIGH',
        metadataIssues: [{ severity: 'WARNING', message: 'Invented issue' }],
      },
      {
        ...createSampleLibraryPreparation(),
        suggestedDocumentType: 'UnknownInventedDocType',
      },
    ];

    for (const badPrep of inventedVocabPayloads) {
      const dto = createSampleStatusResponseDto({
        status: AITaskStatus.Completed,
        task: createSampleTask({ status: AITaskStatus.Completed }),
        advisoryResult: createSampleAdvisoryResult(
          badPrep as unknown as PEIALibraryPreparationAdvisoryPayload
        ),
        libraryPreparation:
          badPrep as unknown as PEIALibraryPreparationAdvisoryPayload,
      });
      mockCallableInvoke.mockResolvedValueOnce({ data: dto });
      await expect(
        LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID)
      ).rejects.toThrow(/INVALID_PEIA_RESPONSE/);
    }
  });

  it('14. Unconfigured backend failure: rejects with BACKEND_UNCONFIGURED before calling httpsCallable', async () => {
    mockFirebaseState.isFirebaseConfigured = false;
    mockFirebaseState.app = null;

    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation(
        SAMPLE_INTAKE_ID,
        SAMPLE_UPDATED_AT
      )
    ).rejects.toThrow(/BACKEND_UNCONFIGURED:/);

    await expect(
      LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID)
    ).rejects.toThrow(/BACKEND_UNCONFIGURED:/);

    expect(mockHttpsCallable).not.toHaveBeenCalled();
    expect(mockCallableInvoke).not.toHaveBeenCalled();
  });

  it('15. Unauthenticated caller failure: rejects with UNAUTHENTICATED before calling httpsCallable', async () => {
    mockFirebaseState.auth = { currentUser: null };

    await expect(
      LibraryAdminClient.requestIntakePeiaPreparation(
        SAMPLE_INTAKE_ID,
        SAMPLE_UPDATED_AT
      )
    ).rejects.toThrow(/UNAUTHENTICATED:/);

    await expect(
      LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID)
    ).rejects.toThrow(/UNAUTHENTICATED:/);

    expect(mockHttpsCallable).not.toHaveBeenCalled();
    expect(mockCallableInvoke).not.toHaveBeenCalled();
  });

  it('16. Existing Gemini method regression: generateIntakeAISuggestions remains unchanged and PEIA methods never call fetch or Gemini', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const sampleIntakeRecord: LibraryIntakeRecord = {
      id: SAMPLE_INTAKE_ID,
      url: 'https://hcenr.gov.sd/reports/marine-2026.pdf',
      normalizedUrl: 'https://hcenr.gov.sd/reports/marine-2026.pdf',
      title: 'تقرير حالة البيئة الساحلية والبحرية في السودان 2026',
      language: 'ar',
      status: LibraryIntakeStatus.PendingReview,
      submittedByAdminId: 'curator_uid_01',
      submittedByAdminName: 'أمين المكتبة',
      createdAt: SAMPLE_UPDATED_AT,
      updatedAt: SAMPLE_UPDATED_AT,
    };

    mockCallableInvoke.mockResolvedValueOnce({
      data: { intakeRecord: sampleIntakeRecord },
    });
    const geminiRes = await LibraryAdminClient.generateIntakeAISuggestions(
      SAMPLE_INTAKE_ID,
      '  مقتطف نصي تجريبي  '
    );
    expect(geminiRes).toEqual(sampleIntakeRecord);
    expect(mockCallableInvoke).toHaveBeenLastCalledWith({
      action: 'generateIntakeAISuggestions',
      intakeId: SAMPLE_INTAKE_ID,
      suppliedExcerpt: 'مقتطف نصي تجريبي',
    });

    // Verify PEIA methods never trigger fetch or generateIntakeAISuggestions
    mockCallableInvoke
      .mockResolvedValueOnce({ data: createSampleRequestResponseDto() })
      .mockResolvedValueOnce({ data: createSampleStatusResponseDto() });

    await LibraryAdminClient.requestIntakePeiaPreparation(
      SAMPLE_INTAKE_ID,
      SAMPLE_UPDATED_AT
    );
    await LibraryAdminClient.getIntakePeiaPreparationStatus(SAMPLE_INTAKE_ID);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('17. Existing Library methods regression: listIntake, getById, create, updateMetadata, updateRights, and transitionWorkflow remain unchanged', async () => {
    const sampleIntakeRecord: LibraryIntakeRecord = {
      id: SAMPLE_INTAKE_ID,
      url: 'https://hcenr.gov.sd/reports/marine-2026.pdf',
      normalizedUrl: 'https://hcenr.gov.sd/reports/marine-2026.pdf',
      title: 'تقرير حالة البيئة الساحلية والبحرية في السودان 2026',
      language: 'ar',
      status: LibraryIntakeStatus.PendingReview,
      submittedByAdminId: 'curator_uid_01',
      submittedByAdminName: 'أمين المكتبة',
      createdAt: SAMPLE_UPDATED_AT,
      updatedAt: SAMPLE_UPDATED_AT,
    };

    mockCallableInvoke.mockResolvedValueOnce({
      data: { intakeRecords: [sampleIntakeRecord] },
    });
    const intakeList = await LibraryAdminClient.listIntake();
    expect(intakeList).toEqual([sampleIntakeRecord]);
    expect(mockCallableInvoke).toHaveBeenLastCalledWith({
      action: 'listIntake',
    });

    const sampleDoc = {
      id: 'doc-1',
      titleAr: 'عنوان',
      titleEn: 'Title',
      documentType: LibraryDocumentType.InstitutionalReport,
      organizationId: 'org-1',
      sourceId: 'src-1',
      geographyAr: 'السودان',
      geographyEn: 'Sudan',
      publicationDate: '2026-01-01',
      language: 'ar' as const,
      summaryAr: 'ملخص',
      summaryEn: 'Summary',
      topicsAr: ['مناخ'],
      topicsEn: ['Climate'],
      environmentalDomains: ['Climate'],
      rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
      workflowState: WorkflowState.Draft,
      workflowHistory: [],
      legalStatusDescriptionAr: 'ساري',
      legalStatusDescriptionEn: 'Active',
      createdAt: SAMPLE_UPDATED_AT,
      updatedAt: SAMPLE_UPDATED_AT,
      versions: [],
    };

    mockCallableInvoke.mockResolvedValueOnce({
      data: { document: sampleDoc },
    });
    const docRes = await LibraryAdminClient.getById('doc-1');
    expect(docRes?.id).toBe('doc-1');
    expect(mockCallableInvoke).toHaveBeenLastCalledWith({
      action: 'getById',
      id: 'doc-1',
    });

    mockCallableInvoke.mockResolvedValueOnce({
      data: { document: sampleDoc },
    });
    await LibraryAdminClient.transitionWorkflow(
      'doc-1',
      WorkflowState.InReview,
      'Ready for review'
    );
    expect(mockCallableInvoke).toHaveBeenLastCalledWith({
      action: 'transitionWorkflow',
      id: 'doc-1',
      targetState: WorkflowState.InReview,
      comment: 'Ready for review',
    });
  });
});
