import {
  authorizeAndValidateAdvisoryResultIntake,
  AuthorizedAdvisoryResultIntake,
} from '../functions/src/peia/authorizedAdvisoryResultIntakeBoundary';
import {
  MachineIdentityVerifier,
  VerifiedMachinePrincipal,
  PEIAMachineCapability,
  MachineAuthorizationError,
  authorizeAdvisoryResultSubmission,
} from '../functions/src/peia/machineAuthorizationBoundary';
import {
  AdvisoryResultIntakeContractError,
} from '../functions/src/peia/advisoryResultIntakeContract';
import { AITaskType } from '../functions/src/types/aiTask';
import { AIReviewTargetType, AIReviewSeverity } from '../src/types/aiReview';
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

function createValidPrincipal(overrides: Partial<VerifiedMachinePrincipal> = {}): VerifiedMachinePrincipal {
  return {
    principalId: 'machine-worker-01',
    isActive: true,
    capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
    ...overrides,
  };
}

function createValidVerifier(principal: VerifiedMachinePrincipal | null = createValidPrincipal()): MachineIdentityVerifier {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    async verify(_credentialInput: unknown) {
      callCount++;
      return principal;
    },
  } as MachineIdentityVerifier & { callCount: number };
}

function createValidIntakeRequest(overrides: Record<string, any> = {}): Record<string, any> {
  const base: any = {
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

  if (overrides.result !== undefined) {
    if (overrides.result === null || typeof overrides.result !== 'object') {
      base.result = overrides.result;
    } else {
      if (overrides.result.task !== undefined) {
        base.result.task = overrides.result.task;
      }
      if (overrides.result.assessment !== undefined) {
        base.result.assessment = overrides.result.assessment;
      }
      const { task, assessment, ...resultRest } = overrides.result;
      base.result = { ...base.result, ...resultRest };
    }
  }

  for (const [k, v] of Object.entries(overrides)) {
    if (k !== 'result') {
      base[k] = v;
    }
  }
  return base;
}

async function run() {
  // 1. authorizeAndValidateAdvisoryResultIntake exists
  try {
    const passed = typeof authorizeAndValidateAdvisoryResultIntake === 'function';
    tests.push({ id: testCounter++, name: '1. authorizeAndValidateAdvisoryResultIntake exists', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '1. authorizeAndValidateAdvisoryResultIntake exists', passed: false, message: err.message });
  }

  // 2. AuthorizedAdvisoryResultIntake interface exists structurally
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/authorizedAdvisoryResultIntakeBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const hasInterface = code.includes('export interface AuthorizedAdvisoryResultIntake') &&
                         code.includes('readonly principal: VerifiedMachinePrincipal;') &&
                         code.includes('readonly request: AdvisoryResultIntakeRequest;');
    tests.push({ id: testCounter++, name: '2. AuthorizedAdvisoryResultIntake interface exists structurally', passed: hasInterface });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '2. AuthorizedAdvisoryResultIntake interface exists structurally', passed: false, message: err.message });
  }

  // 3. valid authorized machine + valid intake succeeds
  try {
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier());
    const passed = !!res && !!res.principal && !!res.request;
    tests.push({ id: testCounter++, name: '3. valid authorized machine + valid intake succeeds', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '3. valid authorized machine + valid intake succeeds', passed: false, message: err.message });
  }

  // 4. success returns exact principal reference
  try {
    const principal = createValidPrincipal();
    const verifier = createValidVerifier(principal);
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), verifier);
    const passed = res.principal === principal;
    tests.push({ id: testCounter++, name: '4. success returns exact principal reference', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '4. success returns exact principal reference', passed: false, message: err.message });
  }

  // 5. success returns exact intake request reference
  try {
    const intake = createValidIntakeRequest();
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', intake, createValidVerifier());
    const passed = res.request === intake;
    tests.push({ id: testCounter++, name: '5. success returns exact intake request reference', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '5. success returns exact intake request reference', passed: false, message: err.message });
  }

  // 6. verifier is called exactly once
  try {
    const verifier = createValidVerifier();
    await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), verifier);
    const passed = (verifier as any).callCount === 1;
    tests.push({ id: testCounter++, name: '6. verifier is called exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '6. verifier is called exactly once', passed: false, message: err.message });
  }

  // 7. submit-only principal succeeds
  try {
    const principal = createValidPrincipal({ capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT] });
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier(principal));
    const passed = res.principal === principal;
    tests.push({ id: testCounter++, name: '7. submit-only principal succeeds', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '7. submit-only principal succeeds', passed: false, message: err.message });
  }

  // 8. both-capabilities principal succeeds
  try {
    const principal = createValidPrincipal({
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS, PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
    });
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier(principal));
    const passed = res.principal === principal;
    tests.push({ id: testCounter++, name: '8. both-capabilities principal succeeds', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '8. both-capabilities principal succeeds', passed: false, message: err.message });
  }

  // 9. fetch-only principal is denied submission
  try {
    const principal = createValidPrincipal({ capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS] });
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier(principal));
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_CAPABILITY_DENIED' &&
               err.message === 'Machine principal is not authorized for advisory result submission.';
    }
    tests.push({ id: testCounter++, name: '9. fetch-only principal is denied submission', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '9. fetch-only principal is denied submission', passed: false, message: err.message });
  }

  // 10. principal with zero capabilities denied
  try {
    const principal = createValidPrincipal({ capabilities: [] });
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier(principal));
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_CAPABILITY_DENIED' &&
               err.message === 'Machine principal is not authorized for advisory result submission.';
    }
    tests.push({ id: testCounter++, name: '10. principal with zero capabilities denied', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '10. principal with zero capabilities denied', passed: false, message: err.message });
  }

  // 11. inactive principal denied
  try {
    const principal = createValidPrincipal({ isActive: false });
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier(principal));
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_INACTIVE' &&
               err.message === 'Machine principal has been deactivated.';
    }
    tests.push({ id: testCounter++, name: '11. inactive principal denied', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '11. inactive principal denied', passed: false, message: err.message });
  }

  // 12. blank principalId denied
  try {
    const principal = createValidPrincipal({ principalId: '   ' });
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), createValidVerifier(principal));
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_PRINCIPAL_INVALID' &&
               err.message === 'Machine principal lacks a valid stable identifier.';
    }
    tests.push({ id: testCounter++, name: '12. blank principalId denied', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '12. blank principalId denied', passed: false, message: err.message });
  }

  // 13. null verifier result denied unauthenticated
  try {
    const verifier = createValidVerifier(null);
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), verifier);
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_UNAUTHENTICATED' &&
               err.message === 'Machine principal authentication failed: Unauthenticated.';
    }
    tests.push({ id: testCounter++, name: '13. null verifier result denied unauthenticated', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '13. null verifier result denied unauthenticated', passed: false, message: err.message });
  }

  // 14. verifier throw propagates exact MACHINE_AUTHENTICATION_FAILED
  try {
    const throwingVerifier: MachineIdentityVerifier = {
      async verify() {
        throw new Error('Verifier failure');
      },
    };
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), throwingVerifier);
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_AUTHENTICATION_FAILED' &&
               err.message === 'Machine identity verification failed due to an unexpected verification error.';
    }
    tests.push({ id: testCounter++, name: '14. verifier throw propagates exact MACHINE_AUTHENTICATION_FAILED', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '14. verifier throw propagates exact MACHINE_AUTHENTICATION_FAILED', passed: false, message: err.message });
  }

  // 15. authorization boundary error type/code/message propagate unchanged through composition
  try {
    const fetchOnlyPrincipal = createValidPrincipal({ capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS] });
    const directVerifier = createValidVerifier(fetchOnlyPrincipal);
    const compositionVerifier = createValidVerifier(fetchOnlyPrincipal);

    let directError: any = null;
    try {
      await authorizeAdvisoryResultSubmission('cred', directVerifier);
    } catch (err) {
      directError = err;
    }

    let compositionError: any = null;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest(), compositionVerifier);
    } catch (err) {
      compositionError = err;
    }

    const passed =
      directError instanceof MachineAuthorizationError &&
      compositionError instanceof MachineAuthorizationError &&
      compositionError.constructor === directError.constructor &&
      compositionError.code === directError.code &&
      compositionError.message === directError.message &&
      compositionError.name === directError.name;

    tests.push({ id: testCounter++, name: '15. authorization boundary error type/code/message propagate unchanged through composition', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '15. authorization boundary error type/code/message propagate unchanged through composition', passed: false, message: err.message });
  }

  // 16. valid authorized machine + outer-null intake → exact AdvisoryResultIntakeContractError
  try {
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', null, createValidVerifier());
    } catch (err: any) {
      passed = err instanceof AdvisoryResultIntakeContractError &&
               err.code === 'INVALID_ADVISORY_RESULT_INTAKE' &&
               err.message === 'Invalid PEIA advisory result intake request.';
    }
    tests.push({ id: testCounter++, name: '16. valid authorized machine + outer-null intake → exact AdvisoryResultIntakeContractError', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '16. valid authorized machine + outer-null intake → exact AdvisoryResultIntakeContractError', passed: false, message: err.message });
  }

  // 17. valid authorized machine + missing result → intake contract error
  try {
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', {}, createValidVerifier());
    } catch (err: any) {
      passed = err instanceof AdvisoryResultIntakeContractError &&
               err.code === 'INVALID_ADVISORY_RESULT_INTAKE';
    }
    tests.push({ id: testCounter++, name: '17. valid authorized machine + missing result → intake contract error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '17. valid authorized machine + missing result → intake contract error', passed: false, message: err.message });
  }

  // 18. valid authorized machine + extra outer key → intake contract error
  try {
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', { ...createValidIntakeRequest(), extraOuter: true }, createValidVerifier());
    } catch (err: any) {
      passed = err instanceof AdvisoryResultIntakeContractError &&
               err.code === 'INVALID_ADVISORY_RESULT_INTAKE';
    }
    tests.push({ id: testCounter++, name: '18. valid authorized machine + extra outer key → intake contract error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '18. valid authorized machine + extra outer key → intake contract error', passed: false, message: err.message });
  }

  // 19. valid authorized machine + malformed nested result → intake contract error
  try {
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', createValidIntakeRequest({ result: { extraKey: 1 } }), createValidVerifier());
    } catch (err: any) {
      passed = err instanceof AdvisoryResultIntakeContractError &&
               err.code === 'INVALID_ADVISORY_RESULT_INTAKE';
    }
    tests.push({ id: testCounter++, name: '19. valid authorized machine + malformed nested result → intake contract error', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '19. valid authorized machine + malformed nested result → intake contract error', passed: false, message: err.message });
  }

  // 20. valid authorized machine + non-ISO trimmed sourceUpdatedAt succeeds
  try {
    const req = createValidIntakeRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: 'custom-timestamp-123',
          },
        },
      },
    });
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', req, createValidVerifier());
    tests.push({ id: testCounter++, name: '20. valid authorized machine + non-ISO trimmed sourceUpdatedAt succeeds', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '20. valid authorized machine + non-ISO trimmed sourceUpdatedAt succeeds', passed: false, message: err.message });
  }

  // 21. valid authorized machine + empty summary + valid finding succeeds
  try {
    const req = createValidIntakeRequest({
      result: {
        assessment: {
          summary: '',
          findings: [{ code: 'CHK', severity: AIReviewSeverity.Info, message: 'msg' }],
        },
      },
    });
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', req, createValidVerifier());
    tests.push({ id: testCounter++, name: '21. valid authorized machine + empty summary + valid finding succeeds', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '21. valid authorized machine + empty summary + valid finding succeeds', passed: false, message: err.message });
  }

  // 22. valid authorized machine + non-empty summary + zero findings succeeds
  try {
    const req = createValidIntakeRequest({
      result: {
        assessment: {
          summary: 'Looks good.',
          findings: [],
        },
      },
    });
    const res = await authorizeAndValidateAdvisoryResultIntake('cred', req, createValidVerifier());
    tests.push({ id: testCounter++, name: '22. valid authorized machine + non-empty summary + zero findings succeeds', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '22. valid authorized machine + non-empty summary + zero findings succeeds', passed: false, message: err.message });
  }

  // 23. valid authorized machine + empty summary + zero findings fails intake validation
  try {
    const req = createValidIntakeRequest({
      result: {
        assessment: {
          summary: '',
          findings: [],
        },
      },
    });
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', req, createValidVerifier());
    } catch (err: any) {
      passed = err instanceof AdvisoryResultIntakeContractError &&
               err.code === 'INVALID_ADVISORY_RESULT_INTAKE';
    }
    tests.push({ id: testCounter++, name: '23. valid authorized machine + empty summary + zero findings fails intake validation', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '23. valid authorized machine + empty summary + zero findings fails intake validation', passed: false, message: err.message });
  }

  // 24. UNAUTHORIZED + malformed intake: authorization error wins
  try {
    const verifier = createValidVerifier(null);
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', null, verifier);
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_UNAUTHENTICATED';
    }
    tests.push({ id: testCounter++, name: '24. UNAUTHORIZED + malformed intake: authorization error wins', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '24. UNAUTHORIZED + malformed intake: authorization error wins', passed: false, message: err.message });
  }

  // 25. UNAUTHORIZED + malformed intake: intake validation is not reached
  try {
    let intakeTouched = false;
    const intakeProxy = new Proxy({}, {
      get() {
        intakeTouched = true;
        throw new Error('INTAKE_TOUCHED');
      },
      ownKeys() {
        intakeTouched = true;
        throw new Error('INTAKE_TOUCHED');
      },
      getOwnPropertyDescriptor() {
        intakeTouched = true;
        throw new Error('INTAKE_TOUCHED');
      },
      has() {
        intakeTouched = true;
        throw new Error('INTAKE_TOUCHED');
      },
    });
    const verifier = createValidVerifier(null);
    let caughtErr: any = null;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', intakeProxy, verifier);
    } catch (err) {
      caughtErr = err;
    }
    const passed = caughtErr instanceof MachineAuthorizationError &&
                   caughtErr.code === 'MACHINE_UNAUTHENTICATED' &&
                   intakeTouched === false &&
                   !caughtErr.message.includes('INTAKE_TOUCHED');
    tests.push({ id: testCounter++, name: '25. UNAUTHORIZED + malformed intake: intake validation is not reached', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '25. UNAUTHORIZED + malformed intake: intake validation is not reached', passed: false, message: err.message });
  }

  // 26. verifier throw + malformed intake: verification error wins
  try {
    const throwingVerifier: MachineIdentityVerifier = {
      async verify() {
        throw new Error('Verifier crash');
      },
    };
    let passed = false;
    try {
      await authorizeAndValidateAdvisoryResultIntake('cred', null, throwingVerifier);
    } catch (err: any) {
      passed = err instanceof MachineAuthorizationError &&
               err.code === 'MACHINE_AUTHENTICATION_FAILED';
    }
    tests.push({ id: testCounter++, name: '26. verifier throw + malformed intake: verification error wins', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '26. verifier throw + malformed intake: verification error wins', passed: false, message: err.message });
  }

  // 27. production structurally delegates to authorizeAdvisoryResultSubmission exactly once
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/authorizedAdvisoryResultIntakeBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const matches = code.match(/authorizeAdvisoryResultSubmission\(/g);
    const passed = matches !== null && matches.length === 1;
    tests.push({ id: testCounter++, name: '27. production structurally delegates to authorizeAdvisoryResultSubmission exactly once', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '27. production structurally delegates to authorizeAdvisoryResultSubmission exactly once', passed: false, message: err.message });
  }

  // 28. production structurally delegates to validateAdvisoryResultIntakeRequest exactly once and only after authorization await
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/authorizedAdvisoryResultIntakeBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');
    const validateMatches = code.match(/validateAdvisoryResultIntakeRequest\(/g);
    const authIdx = code.indexOf('await authorizeAdvisoryResultSubmission');
    const validateIdx = code.indexOf('validateAdvisoryResultIntakeRequest(');
    const passed = validateMatches !== null &&
                   validateMatches.length === 1 &&
                   authIdx !== -1 &&
                   validateIdx !== -1 &&
                   authIdx < validateIdx;
    tests.push({ id: testCounter++, name: '28. production structurally delegates to validateAdvisoryResultIntakeRequest exactly once and only after authorization await', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '28. production structurally delegates to validateAdvisoryResultIntakeRequest exactly once and only after authorization await', passed: false, message: err.message });
  }

  // 29. production contains no duplicate authorization/validation logic and no HTTP/persistence/task-source/workflow/generated-metadata coupling
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/authorizedAdvisoryResultIntakeBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    const noWorkerImport = !code.includes('peia-worker');
    const noDuplicateAuth = !code.includes('principal.isActive') &&
                            !code.includes('capabilities.includes') &&
                            !code.includes('SUBMIT_ADVISORY_RESULT');
    const noDuplicateValidation = !code.includes('taskId') &&
                                   !code.includes('taskType') &&
                                   !code.includes('targetType') &&
                                   !code.includes('summary') &&
                                   !code.includes('findings') &&
                                   !code.includes('VALID_CODE_REGEX') &&
                                   !code.includes('AIReviewSeverity');
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
                          !code.includes('addDoc') &&
                          !code.includes('setDoc') &&
                          !code.includes('updateDoc') &&
                          !code.includes('deleteDoc') &&
                          !code.includes('repository') &&
                          !code.includes('database');
    const noTaskSource = !code.includes('PendingTaskSource') &&
                         !code.includes('prepareNextPendingTaskFromSource');
    const noWorkflow = !code.includes('AIReviewArtifact') &&
                       !code.includes('approve') &&
                       !code.includes('reject') &&
                       !code.includes('publish') &&
                       !code.includes('unpublish') &&
                       !code.includes('AITaskStatus.Completed') &&
                       !code.includes('AITaskStatus.Failed') &&
                       !code.includes('completeTask') &&
                       !code.includes('failTask');
    const noGeneratedMetadata = !code.includes('resultId') &&
                                !code.includes('receivedAt') &&
                                !code.includes('uploadedAt') &&
                                !code.includes('generatedAt') &&
                                !code.includes('createdAt') &&
                                !code.includes('updatedAt') &&
                                !code.includes('attemptCount');

    const passed = noWorkerImport &&
                   noDuplicateAuth &&
                   noDuplicateValidation &&
                   noHttp &&
                   noPersistence &&
                   noTaskSource &&
                   noWorkflow &&
                   noGeneratedMetadata;

    tests.push({ id: testCounter++, name: '29. production contains no duplicate authorization/validation logic and no HTTP/persistence/task-source/workflow/generated-metadata coupling', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '29. production contains no duplicate authorization/validation logic and no HTTP/persistence/task-source/workflow/generated-metadata coupling', passed: false, message: err.message });
  }

  // 30. final self-contained invariant + exact test-count gate
  try {
    const preCountMatch = tests.length === 29 && testCounter === 30;

    const sourcePath = path.join(process.cwd(), 'functions/src/peia/authorizedAdvisoryResultIntakeBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    // A. Interface exists
    const aMatch = code.includes('export interface AuthorizedAdvisoryResultIntake');

    // B. Interface fields: principal, request
    const interfaceIdx = code.indexOf('export interface AuthorizedAdvisoryResultIntake');
    const interfaceBlock = interfaceIdx !== -1 ? code.slice(interfaceIdx, code.indexOf('}', interfaceIdx)) : '';
    const interfaceLines = interfaceBlock
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('readonly '));
    const bMatch =
      interfaceLines.length === 2 &&
      interfaceLines.some((l) => l === 'readonly principal: VerifiedMachinePrincipal;') &&
      interfaceLines.some((l) => l === 'readonly request: AdvisoryResultIntakeRequest;');

    // C & D. Types
    const cMatch = code.includes('VerifiedMachinePrincipal');
    const dMatch = code.includes('AdvisoryResultIntakeRequest');

    // E. Exported function
    const eMatch = code.includes('export async function authorizeAndValidateAdvisoryResultIntake(');

    // F. Parameters
    const fnIdx = code.indexOf('export async function authorizeAndValidateAdvisoryResultIntake(');
    const paramStart = fnIdx !== -1 ? fnIdx + 'export async function authorizeAndValidateAdvisoryResultIntake('.length : -1;
    const paramEnd = paramStart !== -1 ? code.indexOf('): Promise', paramStart) : -1;
    const paramBlock = paramStart !== -1 && paramEnd !== -1 ? code.slice(paramStart, paramEnd) : '';
    const params = paramBlock
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const fMatch =
      params.length === 3 &&
      params[0] === 'credentialInput: unknown' &&
      params[1] === 'intakeInput: unknown' &&
      params[2] === 'verifier: MachineIdentityVerifier';

    // G. Return Promise<AuthorizedAdvisoryResultIntake>
    const gMatch = code.includes('): Promise<AuthorizedAdvisoryResultIntake>');

    // H. authorizeAdvisoryResultSubmission called once
    const hMatch = (code.match(/authorizeAdvisoryResultSubmission\(/g) || []).length === 1;

    // I. validateAdvisoryResultIntakeRequest called once
    const iMatch = (code.match(/validateAdvisoryResultIntakeRequest\(/g) || []).length === 1;

    // J. Order: Auth before Validation
    const authIdx = code.indexOf('authorizeAdvisoryResultSubmission(');
    const validateIdx = code.indexOf('validateAdvisoryResultIntakeRequest(');
    const jMatch = authIdx !== -1 && validateIdx !== -1 && authIdx < validateIdx;

    // K. Authorization awaited
    const kMatch = code.includes('await authorizeAdvisoryResultSubmission(');

    // L & M. Arguments passed correctly
    const lMatch = code.includes('validateAdvisoryResultIntakeRequest(\n    intakeInput\n  )') ||
                   code.includes('validateAdvisoryResultIntakeRequest(intakeInput)');
    const mMatch = code.includes('credentialInput,\n    verifier') ||
                   code.includes('credentialInput, verifier');

    // N. Returns object { principal, request }
    const returnIdx = code.indexOf('return {');
    const returnEnd = returnIdx !== -1 ? code.indexOf('};', returnIdx) : -1;
    const returnBlock = returnIdx !== -1 && returnEnd !== -1 ? code.slice(returnIdx, returnEnd + 2) : '';
    const normalizedReturn = returnBlock.replace(/\s+/g, ' ').trim();
    const nMatch = normalizedReturn === 'return { principal, request, };' || normalizedReturn === 'return { principal, request };';

    // O & P. No catch block & no new Error / custom error class
    const oMatch = !code.includes('catch');
    const pMatch = !code.includes('new Error') && !code.includes('throw new');

    // Q. No duplicate capability checks
    const qMatch = !code.includes('isActive') &&
                   !code.includes('capabilities.includes') &&
                   !code.includes('SUBMIT_ADVISORY_RESULT');

    // R. No duplicate intake-field validation
    const rMatch = !code.includes('taskId') &&
                   !code.includes('taskType') &&
                   !code.includes('targetType') &&
                   !code.includes('summary') &&
                   !code.includes('findings') &&
                   !code.includes('VALID_CODE_REGEX') &&
                   !code.includes('AIReviewSeverity');

    // S. No HTTP
    const sMatch = !code.includes('fetch(') &&
                   !code.includes('new Request') &&
                   !code.includes('new Response') &&
                   !code.includes('onRequest') &&
                   !code.includes('onCall') &&
                   !code.includes('Express') &&
                   !code.includes('Authorization:') &&
                   !code.includes('Bearer');

    // T. No persistence/database
    const tMatch = !code.includes('Firestore') &&
                   !code.includes('firebase') &&
                   !code.includes('getFirestore') &&
                   !code.includes('collection(') &&
                   !code.includes('doc(') &&
                   !code.includes('addDoc') &&
                   !code.includes('setDoc') &&
                   !code.includes('updateDoc') &&
                   !code.includes('deleteDoc') &&
                   !code.includes('repository') &&
                   !code.includes('database');

    // U. No PendingTaskSource / task source / lookup
    const uMatch = !code.includes('PendingTaskSource') &&
                   !code.includes('prepareNextPendingTaskFromSource');

    // V. No workflow / editorial authority
    const vMatch = !code.includes('AIReviewArtifact') &&
                   !code.includes('approve') &&
                   !code.includes('reject') &&
                   !code.includes('publish') &&
                   !code.includes('unpublish') &&
                   !code.includes('AITaskStatus.Completed') &&
                   !code.includes('AITaskStatus.Failed') &&
                   !code.includes('completeTask') &&
                   !code.includes('failTask');

    // W. No generated metadata
    const wMatch = !code.includes('resultId') &&
                   !code.includes('receivedAt') &&
                   !code.includes('uploadedAt') &&
                   !code.includes('generatedAt') &&
                   !code.includes('createdAt') &&
                   !code.includes('updatedAt') &&
                   !code.includes('attemptCount');

    // X. No cloning / serialization
    const xMatch = !code.includes('structuredClone') &&
                   !code.includes('JSON.parse') &&
                   !code.includes('JSON.stringify') &&
                   !code.includes('{ ...principal') &&
                   !code.includes('{ ...request');

    // Y. Order tests 24-26 passed
    const yMatch = tests[23].passed && tests[24].passed && tests[25].passed;

    const allMatched = preCountMatch && aMatch && bMatch && cMatch && dMatch && eMatch &&
                       fMatch && gMatch && hMatch && iMatch && jMatch && kMatch && lMatch &&
                       mMatch && nMatch && oMatch && pMatch && qMatch && rMatch && sMatch &&
                       tMatch && uMatch && vMatch && wMatch && xMatch && yMatch;

    tests.push({
      id: testCounter++,
      name: '30. final self-contained invariant + exact test-count gate',
      passed: allMatched,
      message: allMatched ? undefined : `A:${aMatch} B:${bMatch} C:${cMatch} D:${dMatch} E:${eMatch} F:${fMatch} G:${gMatch} H:${hMatch} I:${iMatch} J:${jMatch} K:${kMatch} L:${lMatch} M:${mMatch} N:${nMatch} O:${oMatch} P:${pMatch} Q:${qMatch} R:${rMatch} S:${sMatch} T:${tMatch} U:${uMatch} V:${vMatch} W:${wMatch} X:${xMatch} Y:${yMatch}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '30. final self-contained invariant', passed: false, message: err.message });
  }

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA AUTHORIZED ADVISORY RESULT INTAKE BOUNDARY TESTS');
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

  if (failed > 0 || tests.length !== 30 || testCounter !== 31) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
