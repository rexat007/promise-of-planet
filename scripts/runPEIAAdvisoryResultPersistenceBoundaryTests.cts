import {
  persistReconciledAdvisoryResult,
  AdvisoryResultRepository,
  ReconciledAdvisoryResultPersistenceRecord,
  AdvisoryResultPersistenceError,
} from '../functions/src/peia/advisoryResultPersistenceBoundary';
import { ReconciledAdvisoryResultIntake } from '../functions/src/peia/advisoryResultTaskReconciliationBoundary';
import { AIReviewTask, AITaskStatus, AITaskType } from '../functions/src/types/aiTask';
import { AIReviewTargetType, AIReviewSeverity } from '../src/types/aiReview';
import { PEIAMachineCapability, VerifiedMachinePrincipal } from '../functions/src/peia/machineAuthorizationBoundary';
import { AdvisoryResultIntakeResult } from '../functions/src/peia/advisoryResultIntakeContract';

// Helpers
const createMockTask = (taskId: string, targetId: string = 't1'): AIReviewTask => ({
  taskId,
  taskType: AITaskType.CONTENT_REVIEW,
  status: AITaskStatus.Pending,
  createdAt: '2026-10-01T00:00:00Z',
  target: { targetType: AIReviewTargetType.News, targetId, sourceUpdatedAt: '2026-10-01T00:00:00Z' },
  contentSnapshot: { key: 'value' },
});

const createMockPrincipal = (principalId: string = 'm1', caps: PEIAMachineCapability[] = [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT]): VerifiedMachinePrincipal => ({
  principalId,
  isActive: true,
  capabilities: caps,
});

const createMockResult = (taskId: string, targetId: string = 't1'): AdvisoryResultIntakeResult => ({
  task: { taskId, taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId, sourceUpdatedAt: '2026-10-01T00:00:00Z' } },
  assessment: { summary: 's1', findings: [{ code: 'C1', severity: AIReviewSeverity.Info, message: 'm1' }] },
});

const createMockIntake = (taskId: string, targetId: string = 't1', principal: VerifiedMachinePrincipal = createMockPrincipal()): ReconciledAdvisoryResultIntake => ({
  task: createMockTask(taskId, targetId),
  authorizedIntake: { principal, request: { result: createMockResult(taskId, targetId) } },
});

interface MockRepository extends AdvisoryResultRepository {
    stored: unknown;
    findCount: number;
    saveCount: number;
    lastFindTaskId: string;
}

const createMockRepository = (initialRecord: unknown = null): MockRepository => {
  let stored = initialRecord;
  let findCount = 0;
  let saveCount = 0;
  let lastFindTaskId = '';
  return {
    get stored() { return stored; },
    get findCount() { return findCount; },
    get saveCount() { return saveCount; },
    get lastFindTaskId() { return lastFindTaskId; },
    findByTaskId: async (taskId: string) => {
       findCount++;
       lastFindTaskId = taskId;
       return stored;
    },
    save: async (record) => {
       saveCount++;
       stored = record;
    },
  };
};

const runTest = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}`, e);
    process.exit(1);
  }
};

const expectPersistenceErrorCode = async (fn: () => Promise<unknown>, code: string) => {
    try {
        await fn();
        throw new Error('Should have failed');
    } catch (e) {
        if (!(e instanceof AdvisoryResultPersistenceError) || e.code !== code) throw e;
    }
};

const checkRecursiveForForbiddenKeys = (obj: unknown, forbidden: string[]) => {
    if (typeof obj !== 'object' || obj === null) return;
    const record = obj as Record<string, unknown>;
    for (const key in record) {
        if (forbidden.some(fk => key.toLowerCase().includes(fk.toLowerCase())))
            throw new Error(`Forbidden key: ${key}`);
        checkRecursiveForForbiddenKeys(record[key], forbidden);
    }
};

// Tests
(async () => {
  await runTest('1. first valid reconciled result is stored', async () => {
    const repo = createMockRepository();
    const result = await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    if (result.disposition !== 'STORED') throw new Error('Expected STORED');
  });
  await runTest('2. returned taskId is canonical', async () => {
    const repo = createMockRepository();
    const result = await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    if (result.taskId !== '1') throw new Error('Expected 1');
  });
  await runTest('3. newly stored result reports STORED semantics', async () => {
    const repo = createMockRepository();
    const result = await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    if (result.disposition !== 'STORED') throw new Error('Expected STORED');
  });
  await runTest('4. saved record preserves canonical task', async () => {
    const repo = createMockRepository();
    await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    const stored = repo.stored as ReconciledAdvisoryResultPersistenceRecord;
    if (stored.reconciledTask.taskId !== '1') throw new Error('Mismatch');
  });
  await runTest('5. saved record preserves verified principal', async () => {
    const repo = createMockRepository();
    await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    const stored = repo.stored as ReconciledAdvisoryResultPersistenceRecord;
    if (stored.principal.principalId !== 'm1') throw new Error('Mismatch');
  });
  await runTest('6. saved record preserves full canonical advisory result', async () => {
    const repo = createMockRepository();
    const intake = createMockIntake('1', 't1');
    await persistReconciledAdvisoryResult(intake, repo);
    const stored = repo.stored as ReconciledAdvisoryResultPersistenceRecord;
    const s = stored.advisoryResult;
    if (s.task.taskId !== '1' || s.task.taskType !== AITaskType.CONTENT_REVIEW || s.task.target.targetType !== AIReviewTargetType.News || s.task.target.targetId !== 't1' || s.task.target.sourceUpdatedAt !== '2026-10-01T00:00:00Z' || s.assessment.summary !== 's1' || s.assessment.findings.length !== 1 || s.assessment.findings[0].code !== 'C1' || s.assessment.findings[0].severity !== AIReviewSeverity.Info || s.assessment.findings[0].message !== 'm1') throw new Error('Mismatch');
  });
  await runTest('7. findByTaskId called with exact canonical taskId', async () => {
    const repo = createMockRepository();
    await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    if (repo.lastFindTaskId !== '1') throw new Error('Mismatch');
  });
  await runTest('8. save called exactly once for first persistence', async () => {
    const repo = createMockRepository();
    await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    if (repo.saveCount !== 1) throw new Error('Expected 1 save');
  });
  await runTest('9. identical existing record returns idempotent success', async () => {
    const intake = createMockIntake('1');
    const record: ReconciledAdvisoryResultPersistenceRecord = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result,
    };
    const repo = createMockRepository(record);
    const result = await persistReconciledAdvisoryResult(intake, repo);
    if (result.disposition !== 'ALREADY_IDENTICAL') throw new Error('Expected ALREADY_IDENTICAL');
  });
  await runTest('10. identical existing record does not call save', async () => {
    const intake = createMockIntake('1');
    const record: ReconciledAdvisoryResultPersistenceRecord = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result,
    };
    const repo = createMockRepository(record);
    await persistReconciledAdvisoryResult(intake, repo);
    if (repo.saveCount !== 0) throw new Error('Expected 0 saves');
  });
  await runTest('11. changed advisory summary causes RESULT_CONFLICT', async () => {
    const intake = createMockIntake('1');
    const record: ReconciledAdvisoryResultPersistenceRecord = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: intake.authorizedIntake.principal,
        advisoryResult: { ...createMockResult('1'), assessment: { ...createMockResult('1').assessment, summary: 'changed' } },
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });
  await runTest('12. changed advisory finding causes RESULT_CONFLICT', async () => {
    const intake = createMockIntake('1');
    const record: ReconciledAdvisoryResultPersistenceRecord = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: intake.authorizedIntake.principal,
        advisoryResult: { ...createMockResult('1'), assessment: { ...createMockResult('1').assessment, findings: [{ code: 'C2', severity: AIReviewSeverity.Warning, message: 'm2' }] } },
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });
  await runTest('13. changed task reference causes TASK_IDENTITY_MISMATCH', async () => {
    const intake = createMockIntake('1', 't1');
    const record: ReconciledAdvisoryResultPersistenceRecord = {
        taskId: '1',
        reconciledTask: createMockTask('1', 't2'),
        principal: intake.authorizedIntake.principal,
        advisoryResult: createMockResult('1', 't1'),
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });
  await runTest('14. changed principal identity causes RESULT_CONFLICT', async () => {
    const intake = createMockIntake('1');
    const record: ReconciledAdvisoryResultPersistenceRecord = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: { ...createMockPrincipal(), principalId: 'm2' },
        advisoryResult: createMockResult('1'),
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });
  await runTest('15. malformed existing record causes INVALID_EXISTING_RECORD', async () => {
    const repo = createMockRepository({ taskId: '1' }); // missing fields
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(createMockIntake('1'), repo), 'INVALID_EXISTING_RECORD');
  });
  await runTest('16. repository read failure propagates', async () => {
    const repo: AdvisoryResultRepository = {
        findByTaskId: async () => { throw new Error('Read fail'); },
        save: async () => {},
    };
    try {
        await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
        throw new Error('Should have failed');
    } catch (e) {
        if (e instanceof Error && e.message === 'Read fail') return;
        throw e;
    }
  });
  await runTest('17. repository write failure propagates', async () => {
    const repo: AdvisoryResultRepository = {
        findByTaskId: async () => null,
        save: async () => { throw new Error('Write fail'); },
    };
    try {
        await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
        throw new Error('Should have failed');
    } catch (e) {
        if (e instanceof Error && e.message === 'Write fail') return;
        throw e;
    }
  });
  await runTest('18. input reconciled object is not mutated', async () => {
    const intake = createMockIntake('1');
    const repo = createMockRepository();
    const original = JSON.stringify(intake);
    await persistReconciledAdvisoryResult(intake, repo);
    if (JSON.stringify(intake) !== original) throw new Error('Mutated');
  });
  await runTest('19. no publication/approval/rejection/completed state is added', async () => {
    const repo = createMockRepository();
    await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    const stored = repo.stored as Record<string, unknown>;
    if (stored.hasOwnProperty('status') || stored.hasOwnProperty('approved') || stored.hasOwnProperty('rejected') || stored.hasOwnProperty('published') || stored.hasOwnProperty('completed') || stored.hasOwnProperty('humanDecision')) throw new Error('State added');
  });
  await runTest('20. persistence record contains no machine credential/secret', async () => {
    const repo = createMockRepository();
    await persistReconciledAdvisoryResult(createMockIntake('1'), repo);
    checkRecursiveForForbiddenKeys(repo.stored, ['credential', 'machineCredential', 'secret', 'token', 'authorization']);
  });
  // Required Identity/Principal tests
  await runTest('21. reconciledTask targetId mismatch', async () => {
    const intake = createMockIntake('1', 't1');
    const record = { taskId: '1', reconciledTask: createMockTask('1', 't2'), principal: intake.authorizedIntake.principal, advisoryResult: createMockResult('1', 't1') };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });
  await runTest('22. reconciledTask sourceUpdatedAt mismatch', async () => {
    const intake = createMockIntake('1');
    const record = { taskId: '1', reconciledTask: { ...createMockTask('1'), target: { ...createMockTask('1').target, sourceUpdatedAt: '2026-10-01T00:00:01Z' } }, principal: intake.authorizedIntake.principal, advisoryResult: createMockResult('1') };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });
  await runTest('23. advisoryResult.task targetId mismatch', async () => {
    const intake = createMockIntake('1', 't1');
    const record = { taskId: '1', reconciledTask: createMockTask('1', 't1'), principal: intake.authorizedIntake.principal, advisoryResult: createMockResult('1', 't2') };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });
  await runTest('24. advisoryResult.task sourceUpdatedAt mismatch', async () => {
    const intake = createMockIntake('1');
    const record = { taskId: '1', reconciledTask: createMockTask('1'), principal: intake.authorizedIntake.principal, advisoryResult: { ...createMockResult('1'), task: { ...createMockResult('1').task, target: { ...createMockResult('1').task.target, sourceUpdatedAt: '2026-10-01T00:00:01Z' } } } };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });
  await runTest('25. malformed reconciledTask', async () => {
    const repo = createMockRepository({ taskId: '1', reconciledTask: { foo: 'bar' }, principal: createMockPrincipal(), advisoryResult: createMockResult('1') });
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(createMockIntake('1'), repo), 'INVALID_EXISTING_RECORD');
  });
  await runTest('26. malformed principal', async () => {
    const repo = createMockRepository({ taskId: '1', reconciledTask: createMockTask('1'), principal: { foo: 'bar' }, advisoryResult: createMockResult('1') });
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(createMockIntake('1'), repo), 'INVALID_EXISTING_RECORD');
  });
  await runTest('27. inactive principal', async () => {
    const repo = createMockRepository({ taskId: '1', reconciledTask: createMockTask('1'), principal: { ...createMockPrincipal(), isActive: false }, advisoryResult: createMockResult('1') });
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(createMockIntake('1'), repo), 'INVALID_EXISTING_RECORD');
  });
  await runTest('28. principal missing SUBMIT_ADVISORY_RESULT', async () => {
    const repo = createMockRepository({ taskId: '1', reconciledTask: createMockTask('1'), principal: { ...createMockPrincipal(), capabilities: [] }, advisoryResult: createMockResult('1') });
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(createMockIntake('1'), repo), 'INVALID_EXISTING_RECORD');
  });

  // NEW TESTS
  await runTest('29. existing reconciledTask AND existing advisoryResult.task both use different targetId from current intake', async () => {
    const intake = createMockIntake('1', 't1');
    // Stored matches itself (t2), but intake is t1.
    const record = { 
        taskId: '1', 
        reconciledTask: createMockTask('1', 't2'), 
        principal: intake.authorizedIntake.principal, 
        advisoryResult: createMockResult('1', 't2') 
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });

  await runTest('30. existing reconciledTask AND existing advisoryResult.task both use different sourceUpdatedAt from current intake', async () => {
    const intake = createMockIntake('1');
    const storedTask = { ...createMockTask('1'), target: { ...createMockTask('1').target, sourceUpdatedAt: '2026-10-01T00:00:05Z' } };
    const storedResult = { ...createMockResult('1'), task: { ...createMockResult('1').task, target: { ...createMockResult('1').task.target, sourceUpdatedAt: '2026-10-01T00:00:05Z' } } };
    const record = { 
        taskId: '1', 
        reconciledTask: storedTask, 
        principal: intake.authorizedIntake.principal, 
        advisoryResult: storedResult 
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'TASK_IDENTITY_MISMATCH');
  });

  await runTest('31. existing principal contains unknown capability value', async () => {
    const intake = createMockIntake('1');
    const record = { 
        taskId: '1', 
        reconciledTask: createMockTask('1'), 
        principal: { 
            principalId: 'm1',
            isActive: true,
            capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT, 'UNKNOWN_CAP']
        }, 
        advisoryResult: createMockResult('1') 
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'INVALID_EXISTING_RECORD');
  });

  await runTest('32. existing record with extra top-level field causes INVALID_EXISTING_RECORD', async () => {
    const intake = createMockIntake('1');
    const record = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result,
        extraField: 'forbidden'
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'INVALID_EXISTING_RECORD');
  });

  await runTest('33. existing principal with extra secret-bearing field causes INVALID_EXISTING_RECORD', async () => {
    const intake = createMockIntake('1');
    const record = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: {
            principalId: 'm1',
            isActive: true,
            capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
            secret: 'should-not-be-here'
        },
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'INVALID_EXISTING_RECORD');
  });

  await runTest('34. same principalId but different valid capability set causes RESULT_CONFLICT', async () => {
    const intake = createMockIntake('1');
    const record = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: {
            principalId: 'm1',
            isActive: true,
            capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT, PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS]
        },
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });

  await runTest('35. structurally identical nested contentSnapshot objects are ALREADY_IDENTICAL', async () => {
    const intake = createMockIntake('1');
    const nested = { a: [1, 2, { b: 3 }] };
    intake.task = { ...intake.task, contentSnapshot: { ...nested } };
    
    const record = {
        taskId: '1',
        reconciledTask: { ...intake.task, contentSnapshot: JSON.parse(JSON.stringify(nested)) },
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    const result = await persistReconciledAdvisoryResult(intake, repo);
    if (result.disposition !== 'ALREADY_IDENTICAL') throw new Error('Expected ALREADY_IDENTICAL');
  });

  await runTest('36. nested contentSnapshot structural difference causes RESULT_CONFLICT', async () => {
    const intake = createMockIntake('1');
    intake.task = { ...intake.task, contentSnapshot: { a: [1, 2] } };
    
    const record = {
        taskId: '1',
        reconciledTask: { ...intake.task, contentSnapshot: { a: [1, 3] } },
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });

  await runTest('37. nested Date value in contentSnapshot is not treated as structurally identical', async () => {
    const intake = createMockIntake('1');
    const now = new Date();
    intake.task = { ...intake.task, contentSnapshot: { d: now } };
    const record = {
        taskId: '1',
        reconciledTask: { ...intake.task, contentSnapshot: { d: now } },
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });

  await runTest('38. nested undefined value in contentSnapshot is not treated as structurally identical', async () => {
    const intake = createMockIntake('1');
    intake.task = { ...intake.task, contentSnapshot: { u: undefined } };
    const record = {
        taskId: '1',
        reconciledTask: { ...intake.task, contentSnapshot: { u: undefined } },
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });

  await runTest('39. nested non-finite number in contentSnapshot is not treated as structurally identical', async () => {
    const intake = createMockIntake('1');
    intake.task = { ...intake.task, contentSnapshot: { n: NaN } };
    const record = {
        taskId: '1',
        reconciledTask: { ...intake.task, contentSnapshot: { n: NaN } },
        principal: intake.authorizedIntake.principal,
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'RESULT_CONFLICT');
  });

  await runTest('40. existing principal duplicate capability values causes INVALID_EXISTING_RECORD', async () => {
    const intake = createMockIntake('1');
    const record = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: {
            principalId: 'm1',
            isActive: true,
            capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT, PEIAMachineCapability.SUBMIT_ADVISORY_RESULT]
        },
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    await expectPersistenceErrorCode(() => persistReconciledAdvisoryResult(intake, repo), 'INVALID_EXISTING_RECORD');
  });

  await runTest('41. same capability set in different array order remains ALREADY_IDENTICAL', async () => {
    const intake = createMockIntake('1');
    intake.authorizedIntake.principal = {
        ...intake.authorizedIntake.principal,
        capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT, PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS]
    };
    const record = {
        taskId: '1',
        reconciledTask: intake.task,
        principal: {
            principalId: 'm1',
            isActive: true,
            capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS, PEIAMachineCapability.SUBMIT_ADVISORY_RESULT]
        },
        advisoryResult: intake.authorizedIntake.request.result
    };
    const repo = createMockRepository(record);
    const result = await persistReconciledAdvisoryResult(intake, repo);
    if (result.disposition !== 'ALREADY_IDENTICAL') throw new Error('Expected ALREADY_IDENTICAL');
  });
})();
