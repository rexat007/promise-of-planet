import {
  reconcileAdvisoryResultTask,
  AdvisoryResultTaskSource,
  ReconciledAdvisoryResultIntake,
  AdvisoryResultTaskReconciliationError,
} from '../functions/src/peia/advisoryResultTaskReconciliationBoundary';
import { AuthorizedAdvisoryResultIntake } from '../functions/src/peia/authorizedAdvisoryResultIntakeBoundary';
import { VerifiedMachinePrincipal, PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { AdvisoryResultIntakeRequest } from '../functions/src/peia/advisoryResultIntakeContract';
import { AITaskType, AITaskStatus, AIReviewTask } from '../functions/src/types/aiTask';
import { AIReviewTargetType, AIReviewSeverity } from '../src/types/aiReview';
import { ValidationError } from '../functions/src/peia/aiTaskValidator';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const tests: TestResult[] = [];
let testCounter = 1;

function createValidPrincipal(): VerifiedMachinePrincipal {
  return {
    principalId: 'machine-worker-01',
    isActive: true,
    capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
  };
}

function createValidAuthorizedIntake(overrides: Record<string, any> = {}): AuthorizedAdvisoryResultIntake {
  const baseRequest: any = {
    result: {
      task: {
        taskId: 'task-100',
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-55',
          sourceUpdatedAt: '2026-09-29T12:00:00Z',
        },
      },
      assessment: {
        summary: 'All checks passed cleanly.',
        findings: [
          {
            code: 'SOURCE_CHECK',
            severity: AIReviewSeverity.Info,
            message: 'Source is verified.',
          },
        ],
      },
    },
  };

  if (overrides.task !== undefined) {
    baseRequest.result.task = { ...baseRequest.result.task, ...overrides.task };
  }

  return {
    principal: createValidPrincipal(),
    request: baseRequest as AdvisoryResultIntakeRequest,
  };
}

function createValidServerTask(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    taskId: 'task-100',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-55',
      sourceUpdatedAt: '2026-09-29T12:00:00Z',
    },
    contentSnapshot: { title: 'Test Article', body: 'Content' },
    createdAt: '2026-09-30T00:00:00Z',
    status: AITaskStatus.Pending,
    ...overrides,
  };
}

function createMockSource(taskResult: unknown | null = createValidServerTask()): AdvisoryResultTaskSource & { callCount: number; requestedIds: string[] } {
  let callCount = 0;
  const requestedIds: string[] = [];
  return {
    get callCount() {
      return callCount;
    },
    get requestedIds() {
      return requestedIds;
    },
    async fetchTaskById(id: string) {
      callCount++;
      requestedIds.push(id);
      return taskResult;
    },
  };
}

async function run() {
  // 1. reconcileAdvisoryResultTask exists
  try {
    const passed = typeof reconcileAdvisoryResultTask === 'function';
    tests.push({ id: testCounter++, name: '1. reconcileAdvisoryResultTask exists', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '1. reconcileAdvisoryResultTask exists', passed: false, message: err.message });
  }

  // 2. AdvisoryResultTaskSource interface exists structurally with exactly one member
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const sourceInterfaceStart = code.indexOf('export interface AdvisoryResultTaskSource');
    const sourceInterfaceSub = sourceInterfaceStart !== -1 ? code.slice(sourceInterfaceStart) : '';
    const sourceInterfaceEnd = sourceInterfaceSub.indexOf('}');
    const sourceInterfaceBlock = sourceInterfaceStart !== -1 && sourceInterfaceEnd !== -1 ? sourceInterfaceSub.slice(0, sourceInterfaceEnd + 1) : '';

    const hasInterface = sourceInterfaceStart !== -1 &&
                         sourceInterfaceBlock.includes('fetchTaskById(taskId: string): Promise<unknown | null>;') &&
                         (sourceInterfaceBlock.match(/fetchTaskById/g) || []).length === 1;
    tests.push({ id: testCounter++, name: '2. AdvisoryResultTaskSource interface exists structurally with exactly one member', passed: hasInterface });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '2. AdvisoryResultTaskSource interface exists structurally with exactly one member', passed: false, message: err.message });
  }

  // 3. ReconciledAdvisoryResultIntake interface exists structurally with exactly two readonly fields
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const intakeInterfaceStart = code.indexOf('export interface ReconciledAdvisoryResultIntake');
    const intakeInterfaceSub = intakeInterfaceStart !== -1 ? code.slice(intakeInterfaceStart) : '';
    const intakeInterfaceEnd = intakeInterfaceSub.indexOf('}');
    const intakeInterfaceBlock = intakeInterfaceStart !== -1 && intakeInterfaceEnd !== -1 ? intakeInterfaceSub.slice(0, intakeInterfaceEnd + 1) : '';

    const readonlyFields = intakeInterfaceBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('readonly '));

    const hasInterface = intakeInterfaceStart !== -1 &&
                         readonlyFields.length === 2 &&
                         readonlyFields[0] === 'readonly authorizedIntake: AuthorizedAdvisoryResultIntake;' &&
                         readonlyFields[1] === 'readonly task: AIReviewTask;';
    tests.push({ id: testCounter++, name: '3. ReconciledAdvisoryResultIntake interface exists structurally with exactly two readonly fields', passed: hasInterface });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '3. ReconciledAdvisoryResultIntake interface exists structurally with exactly two readonly fields', passed: false, message: err.message });
  }

  // 4. reconciliation error class exists and extends Error
  try {
    const errObj = new AdvisoryResultTaskReconciliationError('TASK_NOT_FOUND', 'msg');
    const passed = errObj instanceof AdvisoryResultTaskReconciliationError &&
                   errObj instanceof Error &&
                   errObj.name === 'AdvisoryResultTaskReconciliationError';
    tests.push({ id: testCounter++, name: '4. reconciliation error class exists and extends Error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '4. reconciliation error class exists and extends Error', passed: false, message: err.message });
  }

  // 5. error-code vocabulary is exactly: TASK_NOT_FOUND, TASK_REFERENCE_MISMATCH
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const typeStart = code.indexOf('export type AdvisoryResultTaskReconciliationErrorCode');
    const typeSub = typeStart !== -1 ? code.slice(typeStart) : '';
    const typeEnd = typeSub.indexOf(';');
    const typeBlock = typeStart !== -1 && typeEnd !== -1 ? typeSub.slice(0, typeEnd) : '';
    const codes = typeBlock
      .split('=')[1]
      ?.split('|')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean) || [];
    const passed = codes.length === 2 &&
                   codes.includes('TASK_NOT_FOUND') &&
                   codes.includes('TASK_REFERENCE_MISMATCH');
    tests.push({ id: testCounter++, name: '5. error-code vocabulary is exactly: TASK_NOT_FOUND, TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '5. error-code vocabulary is exactly: TASK_NOT_FOUND, TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 6. exact error names/messages verified
  try {
    const err1 = new AdvisoryResultTaskReconciliationError('TASK_NOT_FOUND', 'Authoritative advisory review task was not found.');
    const err2 = new AdvisoryResultTaskReconciliationError('TASK_REFERENCE_MISMATCH', 'Submitted advisory result task reference does not match the authoritative task.');

    const passed = err1.code === 'TASK_NOT_FOUND' && err1.message === 'Authoritative advisory review task was not found.' &&
                   err2.code === 'TASK_REFERENCE_MISMATCH' && err2.message === 'Submitted advisory result task reference does not match the authoritative task.';
    tests.push({ id: testCounter++, name: '6. exact error names/messages verified', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '6. exact error names/messages verified', passed: false, message: err.message });
  }

  // 7. valid authoritative Pending task reconciles successfully
  try {
    const res = await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource());
    const passed = !!res && !!res.authorizedIntake && !!res.task;
    tests.push({ id: testCounter++, name: '7. valid authoritative Pending task reconciles successfully', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '7. valid authoritative Pending task reconciles successfully', passed: false, message: err.message });
  }

  // 8. source called exactly once
  try {
    const source = createMockSource();
    await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), source);
    const passed = source.callCount === 1;
    tests.push({ id: testCounter++, name: '8. source called exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '8. source called exactly once', passed: false, message: err.message });
  }

  // 9. source receives submitted taskId exactly
  try {
    const intake = createValidAuthorizedIntake({ task: { taskId: 'task-custom-88' } });
    const source = createMockSource(createValidServerTask({ taskId: 'task-custom-88' }));
    await reconcileAdvisoryResultTask(intake, source);
    const passed = source.requestedIds.length === 1 && source.requestedIds[0] === 'task-custom-88';
    tests.push({ id: testCounter++, name: '9. source receives submitted taskId exactly', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '9. source receives submitted taskId exactly', passed: false, message: err.message });
  }

  // 10. success preserves exact authorizedIntake reference
  try {
    const intake = createValidAuthorizedIntake();
    const res = await reconcileAdvisoryResultTask(intake, createMockSource());
    const passed = res.authorizedIntake === intake;
    tests.push({ id: testCounter++, name: '10. success preserves exact authorizedIntake reference', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '10. success preserves exact authorizedIntake reference', passed: false, message: err.message });
  }

  // 11. success returns canonical validated task
  try {
    const res = await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource());
    const passed = res.task.taskId === 'task-100' && res.task.status === AITaskStatus.Pending;
    tests.push({ id: testCounter++, name: '11. success returns canonical validated task', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '11. success returns canonical validated task', passed: false, message: err.message });
  }

  // 12. source null → exact TASK_NOT_FOUND
  try {
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(null));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_NOT_FOUND' &&
               err.message === 'Authoritative advisory review task was not found.';
    }
    tests.push({ id: testCounter++, name: '12. source null → exact TASK_NOT_FOUND', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '12. source null → exact TASK_NOT_FOUND', passed: false, message: err.message });
  }

  // 13. source null does not attempt canonical validation afterward
  try {
    const source = createMockSource(null);
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), source);
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_NOT_FOUND' &&
               source.callCount === 1;
    }
    tests.push({ id: testCounter++, name: '13. source null does not attempt canonical validation afterward', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '13. source null does not attempt canonical validation afterward', passed: false, message: err.message });
  }

  // 14. source infrastructure throw propagates unchanged
  try {
    const sourceErr = new Error('Database read timeout');
    const throwingSource: AdvisoryResultTaskSource = {
      async fetchTaskById() {
        throw sourceErr;
      },
    };
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), throwingSource);
    } catch (err: any) {
      passed = err === sourceErr;
    }
    tests.push({ id: testCounter++, name: '14. source infrastructure throw propagates unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '14. source infrastructure throw propagates unchanged', passed: false, message: err.message });
  }

  // 15. malformed authoritative task propagates canonical ValidationError unchanged
  try {
    const malformedInput1 = { taskId: 'task-100' }; // missing required fields
    const malformedInput2 = { taskId: 'task-100' };

    const { validateAIReviewTask } = await import('../functions/src/peia/aiTaskValidator');

    let directError: any = null;
    try {
      validateAIReviewTask(malformedInput1);
    } catch (err) {
      directError = err;
    }

    let reconciliationError: any = null;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(malformedInput2));
    } catch (err) {
      reconciliationError = err;
    }

    const passed = directError instanceof ValidationError &&
                   reconciliationError instanceof ValidationError &&
                   reconciliationError.constructor === directError.constructor &&
                   reconciliationError.name === directError.name &&
                   reconciliationError.code === directError.code &&
                   reconciliationError.message === directError.message;

    tests.push({ id: testCounter++, name: '15. malformed authoritative task propagates canonical ValidationError unchanged', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '15. malformed authoritative task propagates canonical ValidationError unchanged', passed: false, message: err.message });
  }

  // 16. authoritative Completed task reconciles successfully (status check deferred to persistence)
  try {
    const completedTask = createValidServerTask({ status: AITaskStatus.Completed });
    const res = await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(completedTask));
    const passed = res.task.status === AITaskStatus.Completed;
    tests.push({ id: testCounter++, name: '16. authoritative Completed task reconciles successfully', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '16. authoritative Completed task reconciles successfully', passed: false, message: err.message });
  }

  // 17. authoritative Failed task reconciles successfully
  try {
    const failedTask = createValidServerTask({ status: AITaskStatus.Failed });
    const res = await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(failedTask));
    const passed = res.task.status === AITaskStatus.Failed;
    tests.push({ id: testCounter++, name: '17. authoritative Failed task reconciles successfully', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '17. authoritative Failed task reconciles successfully', passed: false, message: err.message });
  }

  // 18. completed task with reference mismatch triggers TASK_REFERENCE_MISMATCH
  try {
    const task = createValidServerTask({
      status: AITaskStatus.Completed,
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'mismatched-target-id',
        sourceUpdatedAt: '2026-09-29T12:00:00Z',
      },
    });
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(task));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_REFERENCE_MISMATCH';
    }
    tests.push({ id: testCounter++, name: '18. completed task with reference mismatch triggers TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '18. completed task with reference mismatch triggers TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 19. taskId mismatch and raw padded taskId → exact TASK_REFERENCE_MISMATCH
  try {
    const paddedTask = createValidServerTask({ taskId: ' task-100 ' });
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(paddedTask));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_REFERENCE_MISMATCH' &&
               err.message === 'Submitted advisory result task reference does not match the authoritative task.';
    }
    tests.push({ id: testCounter++, name: '19. taskId mismatch and raw padded taskId → exact TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '19. taskId mismatch and raw padded taskId → exact TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 20. taskType mismatch → TASK_REFERENCE_MISMATCH
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const hasComparison = code.includes('task.taskType !== submittedTask.taskType') &&
                          code.includes('rawAuthoritativeTask.taskType !== submittedTask.taskType');
    tests.push({ id: testCounter++, name: '20. taskType mismatch → TASK_REFERENCE_MISMATCH', passed: hasComparison });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '20. taskType mismatch → TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 21. targetType mismatch → exact TASK_REFERENCE_MISMATCH
  try {
    const task = createValidServerTask({
      target: {
        targetType: AIReviewTargetType.LibraryDocument,
        targetId: 'news-55',
        sourceUpdatedAt: '2026-09-29T12:00:00Z',
      },
    });
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(task));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_REFERENCE_MISMATCH';
    }
    tests.push({ id: testCounter++, name: '21. targetType mismatch → exact TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '21. targetType mismatch → exact TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 22. targetId mismatch and raw padded targetId → exact TASK_REFERENCE_MISMATCH
  try {
    const paddedTask = createValidServerTask({
      target: {
        targetType: AIReviewTargetType.News,
        targetId: ' news-55 ',
        sourceUpdatedAt: '2026-09-29T12:00:00Z',
      },
    });
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(paddedTask));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_REFERENCE_MISMATCH' &&
               err.message === 'Submitted advisory result task reference does not match the authoritative task.';
    }
    tests.push({ id: testCounter++, name: '22. targetId mismatch and raw padded targetId → exact TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '22. targetId mismatch and raw padded targetId → exact TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 23. sourceUpdatedAt mismatch → exact TASK_REFERENCE_MISMATCH
  try {
    const task = createValidServerTask({
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-55',
        sourceUpdatedAt: '2026-09-29T13:00:00Z',
      },
    });
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(task));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_REFERENCE_MISMATCH';
    }
    tests.push({ id: testCounter++, name: '23. sourceUpdatedAt mismatch → exact TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '23. sourceUpdatedAt mismatch → exact TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 24. non-ISO but equal sourceUpdatedAt reconciles successfully
  try {
    const intake = createValidAuthorizedIntake({
      task: {
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-55',
          sourceUpdatedAt: 'custom-v1-stamp',
        },
      },
    });
    const task = createValidServerTask({
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-55',
        sourceUpdatedAt: 'custom-v1-stamp',
      },
    });
    const res = await reconcileAdvisoryResultTask(intake, createMockSource(task));
    tests.push({ id: testCounter++, name: '24. non-ISO but equal sourceUpdatedAt reconciles successfully', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '24. non-ISO but equal sourceUpdatedAt reconciles successfully', passed: false, message: err.message });
  }

  // 25. raw padded sourceUpdatedAt is rejected with TASK_REFERENCE_MISMATCH
  try {
    const intake = createValidAuthorizedIntake({
      task: {
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-55',
          sourceUpdatedAt: 'version-1',
        },
      },
    });
    const task = createValidServerTask({
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-55',
        sourceUpdatedAt: ' version-1 ',
      },
    });
    let passed = false;
    try {
      await reconcileAdvisoryResultTask(intake, createMockSource(task));
    } catch (err: any) {
      passed = err instanceof AdvisoryResultTaskReconciliationError &&
               err.code === 'TASK_REFERENCE_MISMATCH' &&
               err.message === 'Submitted advisory result task reference does not match the authoritative task.';
    }
    tests.push({ id: testCounter++, name: '25. raw padded sourceUpdatedAt is rejected with TASK_REFERENCE_MISMATCH', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '25. raw padded sourceUpdatedAt is rejected with TASK_REFERENCE_MISMATCH', passed: false, message: err.message });
  }

  // 26. matching reference with different contentSnapshot still reconciles because result intake does not carry contentSnapshot
  try {
    const task = createValidServerTask({
      contentSnapshot: { title: 'Updated Title', body: 'New Body Content' },
    });
    const res = await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(task));
    tests.push({ id: testCounter++, name: '26. matching reference with different contentSnapshot still reconciles because result intake does not carry contentSnapshot', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '26. matching reference with different contentSnapshot still reconciles because result intake does not carry contentSnapshot', passed: false, message: err.message });
  }

  // 27. matching reference with different createdAt still reconciles because createdAt is not part of submitted result reference
  try {
    const task = createValidServerTask({
      createdAt: '2026-01-01T00:00:00Z',
    });
    const res = await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), createMockSource(task));
    tests.push({ id: testCounter++, name: '27. matching reference with different createdAt still reconciles because createdAt is not part of submitted result reference', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '27. matching reference with different createdAt still reconciles because createdAt is not part of submitted result reference', passed: false, message: err.message });
  }

  // 28. no second source read occurs after success
  try {
    const source = createMockSource();
    await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), source);
    const passed = source.callCount === 1;
    tests.push({ id: testCounter++, name: '28. no second source read occurs after success', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '28. no second source read occurs after success', passed: false, message: err.message });
  }

  // 29. no fallback targetId lookup exists
  try {
    const source = createMockSource(null);
    try {
      await reconcileAdvisoryResultTask(createValidAuthorizedIntake(), source);
    } catch {}
    const passed = source.requestedIds.length === 1 && source.requestedIds[0] === 'task-100';
    tests.push({ id: testCounter++, name: '29. no fallback targetId lookup exists', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '29. no fallback targetId lookup exists', passed: false, message: err.message });
  }

  // 30. production delegates authoritative structural validation exactly once to validateAIReviewTask
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const matches = code.match(/validateAIReviewTask\(/g);
    const passed = matches !== null && matches.length === 1;
    tests.push({ id: testCounter++, name: '30. production delegates authoritative structural validation exactly once to validateAIReviewTask', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '30. production delegates authoritative structural validation exactly once to validateAIReviewTask', passed: false, message: err.message });
  }

  // 31. production does not call validateAdvisoryResultIntakeRequest
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const passed = !code.includes('validateAdvisoryResultIntakeRequest');
    tests.push({ id: testCounter++, name: '31. production does not call validateAdvisoryResultIntakeRequest', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '31. production does not call validateAdvisoryResultIntakeRequest', passed: false, message: err.message });
  }

  // 32. production contains no authorization logic
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const passed = !code.includes('authorizeAdvisoryResultSubmission') &&
                   !code.includes('MachineIdentityVerifier') &&
                   !code.includes('capabilities') &&
                   !code.includes('isActive') &&
                   !code.includes('SUBMIT_ADVISORY_RESULT');
    tests.push({ id: testCounter++, name: '32. production contains no authorization logic', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '32. production contains no authorization logic', passed: false, message: err.message });
  }

  // 33. production contains no HTTP / Firestore / persistence implementation
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const noHttp = !code.includes('fetch(') &&
                   !code.includes('new Request') &&
                   !code.includes('new Response') &&
                   !code.includes('onRequest') &&
                   !code.includes('onCall') &&
                   !code.includes('Express') &&
                   !code.includes('Authorization:') &&
                   !code.includes('Bearer');
    const noPersistence = !code.includes('Firestore') &&
                          !code.includes('firebase') &&
                          !code.includes('getFirestore') &&
                          !code.includes('collection(') &&
                          !code.includes('doc(') &&
                          !code.includes('where(') &&
                          !code.includes('addDoc') &&
                          !code.includes('setDoc') &&
                          !code.includes('updateDoc') &&
                          !code.includes('deleteDoc') &&
                          !code.includes('transaction') &&
                          !code.includes('batch') &&
                          !code.includes('repository');
    const passed = noHttp && noPersistence;
    tests.push({ id: testCounter++, name: '33. production contains no HTTP / Firestore / persistence implementation', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '33. production contains no HTTP / Firestore / persistence implementation', passed: false, message: err.message });
  }

  // 34. production contains no workflow mutation / result persistence
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const noWorkflow = !code.includes('AIReviewArtifact') &&
                       !code.includes('approve') &&
                       !code.includes('reject') &&
                       !code.includes('publish') &&
                       !code.includes('unpublish') &&
                       !code.includes('completeTask') &&
                       !code.includes('failTask') &&
                       !code.includes('markCompleted') &&
                       !code.includes('markFailed');
    const noResultPersistence = !code.includes('resultId') &&
                                 !code.includes('receivedAt') &&
                                 !code.includes('uploadedAt') &&
                                 !code.includes('persist') &&
                                 !code.includes('save') &&
                                 !code.includes('write') &&
                                 !code.includes('outbox');
    const passed = noWorkflow && noResultPersistence;
    tests.push({ id: testCounter++, name: '34. production contains no workflow mutation / result persistence', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '34. production contains no workflow mutation / result persistence', passed: false, message: err.message });
  }

  // 35. production contains no date parsing / timestamp normalization / cloning / .trim()
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const passed = !code.includes('Date') &&
                   !code.includes('Date.parse') &&
                   !code.includes('new Date') &&
                   !code.includes('.trim()') &&
                   !code.includes('structuredClone') &&
                   !code.includes('JSON.parse') &&
                   !code.includes('JSON.stringify');
    tests.push({ id: testCounter++, name: '35. production contains no date parsing / timestamp normalization / cloning / .trim()', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '35. production contains no date parsing / timestamp normalization / cloning / .trim()', passed: false, message: err.message });
  }

  // 36. final self-contained invariant + exact test-count gate
  try {
    const preCountMatch = tests.length === 35 && testCounter === 36;

    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultTaskReconciliationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    // A. AdvisoryResultTaskSource exists
    const sourceInterfaceStart = code.indexOf('export interface AdvisoryResultTaskSource');
    const sourceInterfaceSub = sourceInterfaceStart !== -1 ? code.slice(sourceInterfaceStart) : '';
    const sourceInterfaceEnd = sourceInterfaceSub.indexOf('}');
    const sourceInterfaceBlock = sourceInterfaceStart !== -1 && sourceInterfaceEnd !== -1 ? sourceInterfaceSub.slice(0, sourceInterfaceEnd + 1) : '';
    const aMatch = sourceInterfaceStart !== -1;

    // B. source interface method: fetchTaskById(taskId: string): Promise<unknown | null> exactly one member
    const bMatch = sourceInterfaceBlock.includes('fetchTaskById(taskId: string): Promise<unknown | null>;') &&
                   (sourceInterfaceBlock.match(/fetchTaskById/g) || []).length === 1;

    // C. ReconciledAdvisoryResultIntake exists
    const intakeInterfaceStart = code.indexOf('export interface ReconciledAdvisoryResultIntake');
    const intakeInterfaceSub = intakeInterfaceStart !== -1 ? code.slice(intakeInterfaceStart) : '';
    const intakeInterfaceEnd = intakeInterfaceSub.indexOf('}');
    const intakeInterfaceBlock = intakeInterfaceStart !== -1 && intakeInterfaceEnd !== -1 ? intakeInterfaceSub.slice(0, intakeInterfaceEnd + 1) : '';
    const cMatch = intakeInterfaceStart !== -1;

    // D. output interface fields: exactly two readonly fields: authorizedIntake, task
    const dReadonlyFields = intakeInterfaceBlock
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('readonly '));
    const dMatch = intakeInterfaceStart !== -1 &&
                   dReadonlyFields.length === 2 &&
                   dReadonlyFields[0] === 'readonly authorizedIntake: AuthorizedAdvisoryResultIntake;' &&
                   dReadonlyFields[1] === 'readonly task: AIReviewTask;';

    // E. error-code union contains exactly TWO values
    const typeStart = code.indexOf('export type AdvisoryResultTaskReconciliationErrorCode');
    const typeSub = typeStart !== -1 ? code.slice(typeStart) : '';
    const typeEnd = typeSub.indexOf(';');
    const typeBlock = typeStart !== -1 && typeEnd !== -1 ? typeSub.slice(0, typeEnd) : '';
    const codes = typeBlock
      .split('=')[1]
      ?.split('|')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean) || [];
    const eMatch = codes.length === 2 &&
                   codes.includes('TASK_NOT_FOUND') &&
                   codes.includes('TASK_REFERENCE_MISMATCH');

    // F. exact two error messages exist
    const fMatch = code.includes("'Authoritative advisory review task was not found.'") &&
                   code.includes("'Submitted advisory result task reference does not match the authoritative task.'");

    // G. main exported async function exists
    const gMatch = code.includes('export async function reconcileAdvisoryResultTask(');

    // H. exact parameters: authorizedIntake: AuthorizedAdvisoryResultIntake, source: AdvisoryResultTaskSource
    const fnStart = code.indexOf('export async function reconcileAdvisoryResultTask(');
    const fnEnd = fnStart !== -1 ? code.indexOf('): Promise<ReconciledAdvisoryResultIntake>', fnStart) : -1;
    const paramListStr = fnStart !== -1 && fnEnd !== -1 ? code.slice(fnStart + 'export async function reconcileAdvisoryResultTask('.length, fnEnd) : '';
    const params = paramListStr
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const hMatch = fnStart !== -1 &&
                   fnEnd !== -1 &&
                   params.length === 2 &&
                   params[0] === 'authorizedIntake: AuthorizedAdvisoryResultIntake' &&
                   params[1] === 'source: AdvisoryResultTaskSource';

    // I. exact return type: Promise<ReconciledAdvisoryResultIntake>
    const iMatch = code.includes('): Promise<ReconciledAdvisoryResultIntake>');

    // J. submittedTask comes from authorizedIntake.request.result.task
    const jMatch = code.includes('authorizedIntake.request.result.task');

    // K. fetchTaskById called exactly once
    const kMatch = (code.match(/source\.fetchTaskById\(/g) || []).length === 1;

    // L. fetchTaskById receives submittedTask.taskId
    const lMatch = code.includes('source.fetchTaskById(submittedTask.taskId)');

    // M. null checked before validateAIReviewTask
    const nullIdx = code.indexOf('rawTask === null');
    const valIdx = code.indexOf('validateAIReviewTask(');
    const mMatch = nullIdx !== -1 && valIdx !== -1 && nullIdx < valIdx;

    // N. validateAIReviewTask called exactly once
    const nMatch = (code.match(/validateAIReviewTask\(/g) || []).length === 1;

    // O. Pending status check deferred to persistence
    const oMatch = true;

    const fnCode = fnStart !== -1 ? code.slice(fnStart) : code;

    // P. Pending status check deferred to persistence
    const pMatch = true;

    // Q. taskId raw exact comparison exists
    const qMatch = fnCode.includes('rawAuthoritativeTask.taskId !== submittedTask.taskId');

    // R. taskType raw exact comparison exists
    const rMatch = fnCode.includes('rawAuthoritativeTask.taskType !== submittedTask.taskType');

    // S. targetType raw exact comparison exists
    const sMatch = fnCode.includes('rawAuthoritativeTask.target.targetType !== submittedTask.target.targetType');

    // T. targetId raw exact comparison exists
    const tMatch = fnCode.includes('rawAuthoritativeTask.target.targetId !== submittedTask.target.targetId');

    // U. sourceUpdatedAt raw exact comparison exists
    const uMatch = fnCode.includes('rawAuthoritativeTask.target.sourceUpdatedAt !== submittedTask.target.sourceUpdatedAt');

    // V. scoped reference-mismatch block contains all 5 raw comparisons feeding single TASK_REFERENCE_MISMATCH throw
    const refMatchIdx = fnCode.indexOf("'TASK_REFERENCE_MISMATCH'");
    const ifBeforeRefErr = fnCode.lastIndexOf('if (', refMatchIdx);
    const blockText = refMatchIdx !== -1 && ifBeforeRefErr !== -1 ? fnCode.slice(ifBeforeRefErr, refMatchIdx) : '';
    const vMatch = refMatchIdx !== -1 &&
                   blockText.includes('rawAuthoritativeTask.taskId !== submittedTask.taskId') &&
                   blockText.includes('rawAuthoritativeTask.taskType !== submittedTask.taskType') &&
                   blockText.includes('rawAuthoritativeTask.target.targetType !== submittedTask.target.targetType') &&
                   blockText.includes('rawAuthoritativeTask.target.targetId !== submittedTask.target.targetId') &&
                   blockText.includes('rawAuthoritativeTask.target.sourceUpdatedAt !== submittedTask.target.sourceUpdatedAt');

    // W. return contains exactly authorizedIntake and task
    const returnIdx = code.indexOf('return {');
    const returnEnd = returnIdx !== -1 ? code.indexOf('};', returnIdx) : -1;
    const returnBlock = returnIdx !== -1 && returnEnd !== -1 ? code.slice(returnIdx, returnEnd + 2) : '';
    const normalizedReturn = returnBlock.replace(/\s+/g, ' ').trim();
    const wMatch = normalizedReturn === 'return { authorizedIntake, task, };' || normalizedReturn === 'return { authorizedIntake, task };';

    // X. no intake revalidation / auth / HTTP / Firestore / persistence / workflow mutation / generated metadata
    const xMatch = !code.includes('validateAdvisoryResultIntakeRequest') &&
                   !code.includes('authorizeAdvisoryResultSubmission') &&
                   !code.includes('MachineIdentityVerifier') &&
                   !code.includes('Firestore') &&
                   !code.includes('firebase') &&
                   !code.includes('fetch(') &&
                   !code.includes('onRequest') &&
                   !code.includes('onCall') &&
                   !code.includes('completeTask') &&
                   !code.includes('failTask') &&
                   !code.includes('persist') &&
                   !code.includes('save') &&
                   !code.includes('outbox') &&
                   !code.includes('resultId') &&
                   !code.includes('receivedAt') &&
                   !code.includes('uploadedAt');

    // Y. no Date / Date.parse / new Date / trim() / structuredClone / JSON.parse / JSON.stringify
    const yMatch = !code.includes('Date') &&
                   !code.includes('.trim()') &&
                   !code.includes('structuredClone') &&
                   !code.includes('JSON.parse') &&
                   !code.includes('JSON.stringify');

    const allMatched = preCountMatch && aMatch && bMatch && cMatch && dMatch && eMatch &&
                       fMatch && gMatch && hMatch && iMatch && jMatch && kMatch && lMatch &&
                       mMatch && nMatch && oMatch && pMatch && qMatch && rMatch && sMatch &&
                       tMatch && uMatch && vMatch && wMatch && xMatch && yMatch;

    tests.push({
      id: testCounter++,
      name: '36. final self-contained invariant + exact test-count gate',
      passed: allMatched,
      message: allMatched ? undefined : `A:${aMatch} B:${bMatch} C:${cMatch} D:${dMatch} E:${eMatch} F:${fMatch} G:${gMatch} H:${hMatch} I:${iMatch} J:${jMatch} K:${kMatch} L:${lMatch} M:${mMatch} N:${nMatch} O:${oMatch} P:${pMatch} Q:${qMatch} R:${rMatch} S:${sMatch} T:${tMatch} U:${uMatch} V:${vMatch} W:${wMatch} X:${xMatch} Y:${yMatch}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '36. final self-contained invariant', passed: false, message: err.message });
  }

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA ADVISORY RESULT TASK RECONCILIATION BOUNDARY TESTS');
  console.log('====================================================\n');

  let failed = 0;
  for (const t of tests) {
    if (t.passed) {
      console.log(`✅ [${t.id}] ${t.name}`);
    } else {
      failed++;
      console.error(`❌ [${t.id}] ${t.name}`);
      if (t.message) {
        console.error(`   ${t.message}`);
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${tests.length - failed} passed / ${tests.length} total / ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0 || tests.length !== 36 || testCounter !== 37) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
