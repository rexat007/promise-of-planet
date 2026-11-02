import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, existsSync } from 'node:fs';
import {
  AITaskType,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
} from '../src/types/aiReview';
import {
  PEIA_ADVISORY_RESULT_SCHEMA_VERSION,
  type PEIAAdvisoryResult,
  type AdvisoryResultTaskReference,
} from '../peia-worker/src/advisoryResultContract';
import {
  type LocalAdvisoryResultOutboxRepository,
  type StoredAdvisoryResultRecord,
  LocalAdvisoryResultOutboxState,
} from '../peia-worker/src/localAdvisoryResultOutboxContract';
import {
  SqliteAdvisoryResultOutboxRepository,
} from '../peia-worker/src/sqliteAdvisoryResultOutboxRepository';
import {
  convertAdvisoryReadyToPEIAAdvisoryResult,
  persistLocalAnalysisResult,
  type LocalAnalysisToAdvisoryPersistenceResult,
} from '../peia-worker/src/localAnalysisToAdvisoryPersistence';
import {
  type AdvisoryReadyResult,
  type AbstainedResult,
  type ModelFailureResult,
  type LocalModelTrace,
} from '../peia-worker/src/localAnalysisRuntime';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${totalTests}. ${name}`);
  } catch (err: unknown) {
    console.error(`FAILED Test ${totalTests}: ${name}`);
    console.error(err);
    throw err;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

class MockOutboxRepository implements LocalAdvisoryResultOutboxRepository {
  public savedRecords: StoredAdvisoryResultRecord[] = [];
  public saveCallCount = 0;
  public failNextSave = false;

  async save(record: StoredAdvisoryResultRecord): Promise<void> {
    this.saveCallCount++;
    if (this.failNextSave) {
      throw new Error('Database write failure');
    }
    this.savedRecords.push(record);
  }

  async findByTaskId(taskId: string): Promise<StoredAdvisoryResultRecord | null> {
    return this.savedRecords.find((r) => r.result.task.taskId === taskId) || null;
  }

  async listPendingUpload(): Promise<readonly StoredAdvisoryResultRecord[]> {
    return this.savedRecords;
  }
}

let tempCounter = 0;
function getTempDbPath(): string {
  tempCounter++;
  return join(tmpdir(), `peia_bridge_test_${Date.now()}_${tempCounter}.sqlite`);
}

function cleanupDb(path: string): void {
  try {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  } catch {
    // best-effort cleanup
  }
}

const sampleTaskRef: AdvisoryResultTaskReference = {
  taskId: 'task-test-bridge-001',
  taskType: AITaskType.CONTENT_REVIEW,
  target: {
    targetType: AIReviewTargetType.News,
    targetId: 'news-item-42',
    sourceUpdatedAt: '2026-10-06T12:00:00.000Z',
  },
};

const sampleModelTrace: LocalModelTrace = {
  modelName: 'Qwen3-4B-Q4_K_M.gguf',
  contextSize: 4096,
  temperature: 0.1,
  maxTokens: 1024,
  ngl: 0,
  timeoutMs: 600000,
  cpuThreads: null,
  promptChars: 1200,
  executionDurationMs: 45000,
  contextItemsSupplied: 2,
  contextItemsRetained: 2,
  contextItemsExcluded: 0,
  modelOutputChars: 500,
};

const sampleReadyResult: AdvisoryReadyResult = {
  kind: 'ADVISORY_READY',
  taskRef: sampleTaskRef,
  advisory: {
    summary: 'Discharge runoff confirmed in coastal zone.',
    findings: [
      {
        claim: 'Runoff exceeds statutory thresholds.',
        evidenceIds: ['EPA::cwa-sec-402', 'EPA::cwa-sec-404'],
        severity: AIReviewSeverity.Warning,
      },
      {
        claim: 'Sea surface temperatures are elevated.',
        evidenceIds: ['NOAA::buoy-sst-01'],
        // severity intentionally omitted
      },
    ],
    recommendations: ['Perform on-site inspection.', 'Notify regional council.'],
    uncertainties: ['Sampling was performed during high tide.'],
  },
  usedEvidenceIds: ['EPA::cwa-sec-402', 'EPA::cwa-sec-404', 'NOAA::buoy-sst-01'],
  limitations: ['Context restricted to 2 highest priority evidence items.'],
  humanReviewRequired: true,
  modelTrace: sampleModelTrace,
};

const sampleAbstainedResult: AbstainedResult = {
  kind: 'ABSTAINED',
  taskRef: sampleTaskRef,
  reason: 'INSUFFICIENT_EVIDENCE',
  detail: 'Available evidence is insufficient to verify claim.',
  limitations: ['Zero evidence items matching query.'],
  humanReviewRequired: true,
  modelTrace: sampleModelTrace,
};

const sampleModelFailureResult: ModelFailureResult = {
  kind: 'MODEL_FAILURE',
  taskRef: sampleTaskRef,
  code: 'TIMEOUT',
  message: 'Local model execution timed out after 600000ms.',
  exitCode: null,
  humanReviewRequired: true,
  modelTrace: sampleModelTrace,
};

async function runAllBridgeTests() {
  console.log('--- RUNNING PEIA LOCAL ANALYSIS TO ADVISORY PERSISTENCE BRIDGE TESTS ---');

  // 1. convertAdvisoryReadyToPEIAAdvisoryResult produces valid canonical schemaVersion 1
  await test('1. convertAdvisoryReadyToPEIAAdvisoryResult produces valid canonical schemaVersion 1', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    assert(advisory.schemaVersion === PEIA_ADVISORY_RESULT_SCHEMA_VERSION, 'schemaVersion must be 1');
    assert(advisory.humanReviewRequired === true, 'humanReviewRequired must be true');
    assert(advisory.assessment.summary === sampleReadyResult.advisory.summary, 'summary matches');
  });

  // 2. exact task reference preserved verbatim
  await test('2. exact task reference preserved verbatim', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    assert(advisory.task.taskId === sampleTaskRef.taskId, 'taskId matches');
    assert(advisory.task.taskType === sampleTaskRef.taskType, 'taskType matches');
    assert(advisory.task.target.targetType === sampleTaskRef.target.targetType, 'targetType matches');
    assert(advisory.task.target.targetId === sampleTaskRef.target.targetId, 'targetId matches');
    assert(advisory.task.target.sourceUpdatedAt === sampleTaskRef.target.sourceUpdatedAt, 'sourceUpdatedAt matches');
  });

  // 3. deterministic ordered finding codes PEIA_FINDING_001, PEIA_FINDING_002...
  await test('3. deterministic ordered finding codes PEIA_FINDING_001, PEIA_FINDING_002...', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    assert(advisory.assessment.findings.length === 2, '2 findings');
    assert(advisory.assessment.findings[0].code === 'PEIA_FINDING_001', 'First code is PEIA_FINDING_001');
    assert(advisory.assessment.findings[1].code === 'PEIA_FINDING_002', 'Second code is PEIA_FINDING_002');
  });

  // 4. claim maps to message and evidenceIds are preserved
  await test('4. claim maps to message and evidenceIds are preserved', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    const f0 = advisory.assessment.findings[0];
    assert(f0.message === 'Runoff exceeds statutory thresholds.', 'message matches claim');
    assert(f0.evidenceIds.length === 2, 'evidenceIds preserved');
    assert(f0.evidenceIds[0] === 'EPA::cwa-sec-402', 'evidenceId 0 matches');
    assert(f0.evidenceIds[1] === 'EPA::cwa-sec-404', 'evidenceId 1 matches');
  });

  // 5. severity when present is preserved, when absent remains absent (no default inserted)
  await test('5. severity when present is preserved, when absent remains absent (no default inserted)', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    const f0 = advisory.assessment.findings[0];
    const f1 = advisory.assessment.findings[1];
    assert(f0.severity === AIReviewSeverity.Warning, 'severity Warning preserved');
    assert(f1.severity === undefined, 'severity absent when not provided');
    assert(!('severity' in f1), 'severity property not present on object');
  });

  // 6. recommendations, uncertainties, limitations preserved
  await test('6. recommendations, uncertainties, limitations preserved', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    assert(advisory.recommendations.length === 2, 'recommendations length 2');
    assert(advisory.recommendations[0] === 'Perform on-site inspection.', 'recommendation 0 matches');
    assert(advisory.uncertainties.length === 1, 'uncertainties length 1');
    assert(advisory.uncertainties[0] === 'Sampling was performed during high tide.', 'uncertainty matches');
    assert(advisory.limitations.length === 1, 'limitations length 1');
    assert(advisory.limitations[0] === 'Context restricted to 2 highest priority evidence items.', 'limitation matches');
  });

  // 7. usedEvidenceIds is not present on PEIAAdvisoryResult
  await test('7. usedEvidenceIds is not present on PEIAAdvisoryResult', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    assert(!('usedEvidenceIds' in advisory), 'usedEvidenceIds must not be present');
    assert(!('modelTrace' in advisory), 'modelTrace must not be present');
  });

  // 8. persistLocalAnalysisResult with ADVISORY_READY stores record and returns PERSISTED_ADVISORY
  await test('8. persistLocalAnalysisResult with ADVISORY_READY stores record and returns PERSISTED_ADVISORY', async () => {
    const repo = new MockOutboxRepository();
    const outcome = await persistLocalAnalysisResult(sampleReadyResult, repo);

    assert(outcome.kind === 'PERSISTED_ADVISORY', 'outcome kind is PERSISTED_ADVISORY');
    if (outcome.kind === 'PERSISTED_ADVISORY') {
      assert(outcome.taskRef.taskId === sampleTaskRef.taskId, 'taskRef matches');
      assert(outcome.advisoryResult.schemaVersion === 1, 'advisoryResult schemaVersion is 1');
      assert(outcome.storedRecord.localState === LocalAdvisoryResultOutboxState.PendingUpload, 'PendingUpload state');
      assert(repo.saveCallCount === 1, 'save called exactly once');
      assert(repo.savedRecords.length === 1, '1 record saved');
      assert(outcome.modelTrace?.modelName === 'Qwen3-4B-Q4_K_M.gguf', 'modelTrace returned locally');
    }
  });

  // 9. persistLocalAnalysisResult with ABSTAINED returns NOT_PERSISTED_ABSTAINED and zero repository writes
  await test('9. persistLocalAnalysisResult with ABSTAINED returns NOT_PERSISTED_ABSTAINED and zero repository writes', async () => {
    const repo = new MockOutboxRepository();
    const outcome = await persistLocalAnalysisResult(sampleAbstainedResult, repo);

    assert(outcome.kind === 'NOT_PERSISTED_ABSTAINED', 'outcome kind is NOT_PERSISTED_ABSTAINED');
    if (outcome.kind === 'NOT_PERSISTED_ABSTAINED') {
      assert(outcome.taskRef.taskId === sampleTaskRef.taskId, 'taskRef matches');
      assert(outcome.reason === 'INSUFFICIENT_EVIDENCE', 'reason matches');
      assert(outcome.detail === sampleAbstainedResult.detail, 'detail matches');
      assert(repo.saveCallCount === 0, 'save NOT called');
      assert(repo.savedRecords.length === 0, '0 records saved');
    }
  });

  // 10. persistLocalAnalysisResult with MODEL_FAILURE returns NOT_PERSISTED_MODEL_FAILURE and zero repository writes
  await test('10. persistLocalAnalysisResult with MODEL_FAILURE returns NOT_PERSISTED_MODEL_FAILURE and zero repository writes', async () => {
    const repo = new MockOutboxRepository();
    const outcome = await persistLocalAnalysisResult(sampleModelFailureResult, repo);

    assert(outcome.kind === 'NOT_PERSISTED_MODEL_FAILURE', 'outcome kind is NOT_PERSISTED_MODEL_FAILURE');
    if (outcome.kind === 'NOT_PERSISTED_MODEL_FAILURE') {
      assert(outcome.taskRef.taskId === sampleTaskRef.taskId, 'taskRef matches');
      assert(outcome.code === 'TIMEOUT', 'code matches');
      assert(outcome.message === sampleModelFailureResult.message, 'message matches');
      assert(repo.saveCallCount === 0, 'save NOT called');
      assert(repo.savedRecords.length === 0, '0 records saved');
    }
  });

  // 11. Real SQLite persistence round-trip
  await test('11. Real SQLite persistence round-trip', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      const outcome = await persistLocalAnalysisResult(sampleReadyResult, repo);
      assert(outcome.kind === 'PERSISTED_ADVISORY', 'Persisted successfully');

      const retrieved = await repo.findByTaskId(sampleTaskRef.taskId);
      assert(retrieved !== null, 'Found in SQLite');
      assert(retrieved!.result.schemaVersion === 1, 'schemaVersion round-trip 1');
      assert(retrieved!.result.humanReviewRequired === true, 'humanReviewRequired round-trip true');
      assert(retrieved!.result.assessment.summary === sampleReadyResult.advisory.summary, 'summary round-trip');
      assert(retrieved!.result.assessment.findings.length === 2, '2 findings round-trip');
      assert(retrieved!.result.assessment.findings[0].code === 'PEIA_FINDING_001', 'code round-trip');
      assert(retrieved!.result.assessment.findings[0].evidenceIds.length === 2, 'evidenceIds round-trip');
      assert(retrieved!.result.assessment.findings[0].severity === AIReviewSeverity.Warning, 'severity round-trip');
      assert(retrieved!.result.assessment.findings[1].severity === undefined, 'missing severity preserved round-trip');
      assert(retrieved!.result.recommendations.length === 2, 'recommendations round-trip');
      assert(retrieved!.result.uncertainties.length === 1, 'uncertainties round-trip');
      assert(retrieved!.result.limitations.length === 1, 'limitations round-trip');
      repo.close();
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 12. SQLite idempotent save for identical ADVISORY_READY
  await test('12. SQLite idempotent save for identical ADVISORY_READY', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      await persistLocalAnalysisResult(sampleReadyResult, repo);
      // second identical invocation must succeed idempotently
      await persistLocalAnalysisResult(sampleReadyResult, repo);
      const list = await repo.listPendingUpload();
      assert(list.length === 1, 'Still exactly 1 record in outbox');
      repo.close();
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 13. SQLite conflict for divergent ADVISORY_READY with same taskId
  await test('13. SQLite conflict for divergent ADVISORY_READY with same taskId', async () => {
    const dbPath = getTempDbPath();
    try {
      const repo = new SqliteAdvisoryResultOutboxRepository(dbPath);
      await persistLocalAnalysisResult(sampleReadyResult, repo);

      const divergentReady: AdvisoryReadyResult = {
        ...sampleReadyResult,
        advisory: {
          ...sampleReadyResult.advisory,
          summary: 'Divergent summary content',
        },
      };

      let threwConflict = false;
      try {
        await persistLocalAnalysisResult(divergentReady, repo);
      } catch (err: unknown) {
        threwConflict = true;
        assert((err as { code?: string }).code === 'RESULT_CONFLICT', 'Throws RESULT_CONFLICT');
      }
      assert(threwConflict, 'Must throw RESULT_CONFLICT for divergent record');
      repo.close();
    } finally {
      cleanupDb(dbPath);
    }
  });

  // 14. Persistence failure is fail-closed
  await test('14. Persistence failure is fail-closed', async () => {
    const repo = new MockOutboxRepository();
    repo.failNextSave = true;

    let threw = false;
    try {
      await persistLocalAnalysisResult(sampleReadyResult, repo);
    } catch {
      threw = true;
    }
    assert(threw, 'Fails closed and re-throws when repository fails');
  });

  // 15. News conversion backward-compatibility: libraryPreparation is absent on converted News PEIAAdvisoryResult
  await test('15. News conversion backward-compatibility: libraryPreparation is absent on converted News PEIAAdvisoryResult', () => {
    const advisory = convertAdvisoryReadyToPEIAAdvisoryResult(sampleReadyResult);
    assert(advisory.libraryPreparation === undefined, 'libraryPreparation must be undefined for News');
    assert(!('libraryPreparation' in advisory), 'libraryPreparation property must not exist on News result');
  });

  // 16. LibraryIntake MetadataOnly conversion preserves all 14 canonical libraryPreparation fields and validates via validatePEIAAdvisoryResult
  await test('16. LibraryIntake MetadataOnly conversion preserves all 14 canonical libraryPreparation fields', async () => {
    const libraryTaskRef: AdvisoryResultTaskReference = {
      taskId: 'task-lib-bridge-101',
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.LibraryIntake,
        targetId: 'intake-item-101',
        sourceUpdatedAt: '2026-10-06T12:00:00.000Z',
      },
    };

    const libReadyMetadataOnly: AdvisoryReadyResult = {
      kind: 'ADVISORY_READY',
      taskRef: libraryTaskRef,
      advisory: {
        summary: 'Prepared bibliographic proposal from supplied metadata and EPA reference.',
        findings: [
          {
            claim: 'Intake metadata aligns with Clean Water Act stormwater provisions.',
            evidenceIds: ['SNAPSHOT::intake-snapshot-1', 'EPA::cwa-sec-402'],
            severity: AIReviewSeverity.Info,
          },
        ],
        recommendations: ['Confirm publication year against official gazette.'],
        uncertainties: ['Full PDF document was not inspected.'],
        libraryPreparation: {
          inputBasis: 'MetadataOnly',
          suggestedTitleAr: 'لائحة تصريف مياه الأمطار ٢٠٢٦',
          suggestedTitleEn: 'Stormwater Discharge Regulation 2026',
          suggestedIssuingOrganization: 'Ministry of Environment',
          suggestedDocumentType: 'ExecutiveRegulation',
          suggestedEnvironmentalDomains: ['Water Quality', 'Urban Runoff'],
          suggestedTopicsAr: ['مياه الأمطار', 'حماية البيئة المائية'],
          suggestedTopicsEn: ['Stormwater', 'Aquatic Protection'],
          suggestedSummaryAr: null,
          suggestedSummaryEn: null,
          provenanceObservationsAr: ['مقترح مبني على البيانات الوصفية فقط مع إسناد من وكالة حماية البيئة.'],
          provenanceObservationsEn: ['Prepared from supplied metadata only with EPA reference corroboration.'],
          uncertaintyNoticesAr: ['لم يتم الاطلاع على النص الكامل للوثيقة.'],
          uncertaintyNoticesEn: ['Full document text was not available for inspection.'],
        },
      },
      usedEvidenceIds: ['SNAPSHOT::intake-snapshot-1', 'EPA::cwa-sec-402'],
      limitations: ['Metadata-only preparation.'],
      humanReviewRequired: true,
      modelTrace: sampleModelTrace,
    };

    const converted = convertAdvisoryReadyToPEIAAdvisoryResult(libReadyMetadataOnly);
    assert(converted.task.target.targetType === AIReviewTargetType.LibraryIntake, 'targetType is LibraryIntake');
    assert(converted.libraryPreparation !== undefined, 'libraryPreparation present');
    const prep = converted.libraryPreparation!;
    assert(Object.keys(prep).length === 14, 'All 14 canonical keys preserved');
    assert(prep.inputBasis === 'MetadataOnly', 'inputBasis preserved');
    assert(prep.suggestedTitleAr === 'لائحة تصريف مياه الأمطار ٢٠٢٦', 'suggestedTitleAr preserved');
    assert(prep.suggestedTitleEn === 'Stormwater Discharge Regulation 2026', 'suggestedTitleEn preserved');
    assert(prep.suggestedIssuingOrganization === 'Ministry of Environment', 'suggestedIssuingOrganization preserved');
    assert(prep.suggestedDocumentType === 'ExecutiveRegulation', 'suggestedDocumentType preserved');
    assert(prep.suggestedEnvironmentalDomains.length === 2, 'suggestedEnvironmentalDomains preserved');
    assert(prep.suggestedTopicsAr.length === 2, 'suggestedTopicsAr preserved');
    assert(prep.suggestedTopicsEn.length === 2, 'suggestedTopicsEn preserved');
    assert(prep.suggestedSummaryAr === null, 'suggestedSummaryAr null preserved');
    assert(prep.suggestedSummaryEn === null, 'suggestedSummaryEn null preserved');
    assert(prep.provenanceObservationsAr.length === 1, 'provenanceObservationsAr preserved');
    assert(prep.provenanceObservationsEn.length === 1, 'provenanceObservationsEn preserved');
    assert(prep.uncertaintyNoticesAr.length === 1, 'uncertaintyNoticesAr preserved');
    assert(prep.uncertaintyNoticesEn.length === 1, 'uncertaintyNoticesEn preserved');

    const repo = new MockOutboxRepository();
    const persisted = await persistLocalAnalysisResult(libReadyMetadataOnly, repo);
    assert(persisted.kind === 'PERSISTED_ADVISORY', 'Persists to outbox repository');
    if (persisted.kind === 'PERSISTED_ADVISORY') {
      assert(
        persisted.storedRecord.result.libraryPreparation?.suggestedDocumentType === 'ExecutiveRegulation',
        'Stored record preserves libraryPreparation'
      );
    }
  });

  // 17. LibraryIntake SuppliedExcerptAndMetadata conversion preserves all 14 canonical fields including bilingual summaries
  await test('17. LibraryIntake SuppliedExcerptAndMetadata conversion preserves all 14 canonical fields including bilingual summaries', () => {
    const libraryTaskRef: AdvisoryResultTaskReference = {
      taskId: 'task-lib-bridge-102',
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.LibraryIntake,
        targetId: 'intake-item-102',
        sourceUpdatedAt: '2026-10-06T12:00:00.000Z',
      },
    };

    const libReadyExcerpt: AdvisoryReadyResult = {
      kind: 'ADVISORY_READY',
      taskRef: libraryTaskRef,
      advisory: {
        summary: 'Prepared bibliographic proposal from supplied excerpt and metadata.',
        findings: [
          {
            claim: 'Supplied excerpt defines marine sanctuary boundaries.',
            evidenceIds: ['NOAA::buoy-sst-01'],
          },
        ],
        recommendations: ['Review coordinates in annex.'],
        uncertainties: ['Annex tables were not included in excerpt.'],
        libraryPreparation: {
          inputBasis: 'SuppliedExcerptAndMetadata',
          suggestedTitleAr: 'قرار إنشاء المحمية البحرية ٢٠٢٦',
          suggestedTitleEn: 'Marine Sanctuary Establishment Decision 2026',
          suggestedIssuingOrganization: 'National Marine Authority',
          suggestedDocumentType: 'Decision',
          suggestedEnvironmentalDomains: ['Marine Biodiversity'],
          suggestedTopicsAr: ['المحميات البحرية'],
          suggestedTopicsEn: ['Marine Sanctuaries'],
          suggestedSummaryAr: 'ملخص مستند إلى المقتطف المقدم يحدد نطاق المحمية البحرية.',
          suggestedSummaryEn: 'Excerpt-grounded summary defining the marine sanctuary scope.',
          provenanceObservationsAr: ['مشتق من المقتطف المقدم وبيانات الإدارة الوطنية للمحيطات والغلاف الجوي.'],
          provenanceObservationsEn: ['Derived from supplied excerpt and corroborated by NOAA reference.'],
          uncertaintyNoticesAr: ['المقتطف لا يشمل الجداول الملحقة.'],
          uncertaintyNoticesEn: ['Supplied excerpt excludes annex tables.'],
        },
      },
      usedEvidenceIds: ['NOAA::buoy-sst-01'],
      limitations: [],
      humanReviewRequired: true,
    };

    const converted = convertAdvisoryReadyToPEIAAdvisoryResult(libReadyExcerpt);
    assert(converted.libraryPreparation?.inputBasis === 'SuppliedExcerptAndMetadata', 'inputBasis preserved');
    assert(
      converted.libraryPreparation?.suggestedSummaryAr ===
        'ملخص مستند إلى المقتطف المقدم يحدد نطاق المحمية البحرية.',
      'suggestedSummaryAr preserved'
    );
    assert(
      converted.libraryPreparation?.suggestedSummaryEn ===
        'Excerpt-grounded summary defining the marine sanctuary scope.',
      'suggestedSummaryEn preserved'
    );
  });

  // 18. Conversion fails closed when LibraryIntake is missing libraryPreparation or when News includes libraryPreparation
  await test('18. Conversion fails closed when LibraryIntake is missing libraryPreparation or when News includes libraryPreparation', () => {
    const libraryTaskRef: AdvisoryResultTaskReference = {
      taskId: 'task-lib-bridge-103',
      taskType: AITaskType.CONTENT_REVIEW,
      target: {
        targetType: AIReviewTargetType.LibraryIntake,
        targetId: 'intake-item-103',
        sourceUpdatedAt: '2026-10-06T12:00:00.000Z',
      },
    };

    const libMissingPrep: AdvisoryReadyResult = {
      ...sampleReadyResult,
      taskRef: libraryTaskRef,
    };

    let threwMissing = false;
    try {
      convertAdvisoryReadyToPEIAAdvisoryResult(libMissingPrep);
    } catch {
      threwMissing = true;
    }
    assert(threwMissing, 'LibraryIntake without libraryPreparation must fail closed');

    const newsWithPrep: AdvisoryReadyResult = {
      ...sampleReadyResult,
      advisory: {
        ...sampleReadyResult.advisory,
        libraryPreparation: {
          inputBasis: 'MetadataOnly',
          suggestedTitleAr: 'عنوان',
          suggestedTitleEn: 'Title',
          suggestedIssuingOrganization: 'Org',
          suggestedDocumentType: 'Law',
          suggestedEnvironmentalDomains: ['Water'],
          suggestedTopicsAr: ['موضوع'],
          suggestedTopicsEn: ['Topic'],
          suggestedSummaryAr: null,
          suggestedSummaryEn: null,
          provenanceObservationsAr: ['ملاحظة'],
          provenanceObservationsEn: ['Observation'],
          uncertaintyNoticesAr: ['تنبيه'],
          uncertaintyNoticesEn: ['Notice'],
        },
      },
    };

    let threwNewsWithPrep = false;
    try {
      convertAdvisoryReadyToPEIAAdvisoryResult(newsWithPrep);
    } catch {
      threwNewsWithPrep = true;
    }
    assert(threwNewsWithPrep, 'News with libraryPreparation must fail closed');
  });

  console.log('------------------------------------------------------------');
  console.log(`BRIDGE TESTS: ${passedTests}/${totalTests} PASSED`);
}

runAllBridgeTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
