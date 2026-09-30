import {
  validateAdvisoryResultIntakeRequest,
  AdvisoryResultIntakeContractError,
  AdvisoryResultIntakeRequest,
} from '../functions/src/peia/advisoryResultIntakeContract';
import { validatePEIAAdvisoryResult } from '../peia-worker/src/advisoryResultContract';
import { validateAdvisoryResultUploadRequest } from '../peia-worker/src/advisoryResultUploadContract';
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

function createValidRequest(overrides: Record<string, any> = {}): Record<string, any> {
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

function expectContractError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (err: any) {
    return (
      err instanceof AdvisoryResultIntakeContractError &&
      err.code === 'INVALID_ADVISORY_RESULT_INTAKE' &&
      err.message === 'Invalid PEIA advisory result intake request.' &&
      err.name === 'AdvisoryResultIntakeContractError'
    );
  }
}

async function run() {
  // 1. validateAdvisoryResultIntakeRequest exists
  try {
    const passed = typeof validateAdvisoryResultIntakeRequest === 'function';
    tests.push({ id: testCounter++, name: '1. validateAdvisoryResultIntakeRequest exists', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '1. validateAdvisoryResultIntakeRequest exists', passed: false, message: err.message });
  }

  // 2. AdvisoryResultIntakeContractError exists
  try {
    const errObj = new AdvisoryResultIntakeContractError();
    const passed = errObj instanceof AdvisoryResultIntakeContractError && errObj instanceof Error;
    tests.push({ id: testCounter++, name: '2. AdvisoryResultIntakeContractError exists', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '2. AdvisoryResultIntakeContractError exists', passed: false, message: err.message });
  }

  // 3. error code vocabulary exactly ONE value
  try {
    const errObj = new AdvisoryResultIntakeContractError();
    const passed = errObj.code === 'INVALID_ADVISORY_RESULT_INTAKE';
    tests.push({ id: testCounter++, name: '3. error code vocabulary exactly ONE value', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '3. error code vocabulary exactly ONE value', passed: false, message: err.message });
  }

  // 4. exact error code/message/name
  try {
    const errObj = new AdvisoryResultIntakeContractError();
    const passed =
      errObj.code === 'INVALID_ADVISORY_RESULT_INTAKE' &&
      errObj.message === 'Invalid PEIA advisory result intake request.' &&
      errObj.name === 'AdvisoryResultIntakeContractError';
    tests.push({ id: testCounter++, name: '4. exact error code/message/name', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '4. exact error code/message/name', passed: false, message: err.message });
  }

  // 5. valid canonical request accepted
  try {
    const req = createValidRequest();
    const res = validateAdvisoryResultIntakeRequest(req);
    tests.push({ id: testCounter++, name: '5. valid canonical request accepted', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '5. valid canonical request accepted', passed: false, message: err.message });
  }

  // 6. successful validation returns exact same outer request reference
  try {
    const req = createValidRequest();
    const res = validateAdvisoryResultIntakeRequest(req);
    tests.push({ id: testCounter++, name: '6. successful validation returns exact same outer request reference', passed: res === req });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '6. successful validation returns exact same outer request reference', passed: false, message: err.message });
  }

  // 7. valid result reference remains exact same nested result reference
  try {
    const req = createValidRequest();
    const res = validateAdvisoryResultIntakeRequest(req);
    tests.push({ id: testCounter++, name: '7. valid result reference remains exact same nested result reference', passed: res.result === req.result });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '7. valid result reference remains exact same nested result reference', passed: false, message: err.message });
  }

  // 8. outer null rejected
  try {
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(null));
    tests.push({ id: testCounter++, name: '8. outer null rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '8. outer null rejected', passed: false, message: err.message });
  }

  // 9. outer array rejected
  try {
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest([]));
    tests.push({ id: testCounter++, name: '9. outer array rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '9. outer array rejected', passed: false, message: err.message });
  }

  // 10. outer primitive rejected
  try {
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest('string'));
    tests.push({ id: testCounter++, name: '10. outer primitive rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '10. outer primitive rejected', passed: false, message: err.message });
  }

  // 11. outer missing result rejected
  try {
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest({}));
    tests.push({ id: testCounter++, name: '11. outer missing result rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '11. outer missing result rejected', passed: false, message: err.message });
  }

  // 12. outer extra field rejected
  try {
    const req = { ...createValidRequest(), extraKey: true };
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '12. outer extra field rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '12. outer extra field rejected', passed: false, message: err.message });
  }

  // 13. result non-object rejected
  try {
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest({ result: null }));
    tests.push({ id: testCounter++, name: '13. result non-object rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '13. result non-object rejected', passed: false, message: err.message });
  }

  // 14. result extra field rejected
  try {
    const req = createValidRequest({ result: { extra: 1 } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '14. result extra field rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '14. result extra field rejected', passed: false, message: err.message });
  }

  // 15. result missing task rejected
  try {
    const req = { result: { assessment: { summary: 's', findings: [] } } };
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '15. result missing task rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '15. result missing task rejected', passed: false, message: err.message });
  }

  // 16. result missing assessment rejected
  try {
    const req = { result: { task: { taskId: '1', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: 'News', targetId: '1', sourceUpdatedAt: '1' } } } };
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '16. result missing assessment rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '16. result missing assessment rejected', passed: false, message: err.message });
  }

  // 17. task non-object rejected
  try {
    const req = createValidRequest({ result: { task: null } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '17. task non-object rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '17. task non-object rejected', passed: false, message: err.message });
  }

  // 18. task exact-key violation rejected
  try {
    const req = createValidRequest({ result: { task: { taskId: '1', taskType: AITaskType.CONTENT_REVIEW } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '18. task exact-key violation rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '18. task exact-key violation rejected', passed: false, message: err.message });
  }

  // 19. blank taskId rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: '   ',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: '2026-09-29T12:00:00Z',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '19. blank taskId rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '19. blank taskId rejected', passed: false, message: err.message });
  }

  // 20. padded taskId rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: ' task-1 ',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: '2026-09-29T12:00:00Z',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '20. padded taskId rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '20. padded taskId rejected', passed: false, message: err.message });
  }

  // 21. wrong taskType rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: 'OTHER_TYPE',
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: '2026-09-29T12:00:00Z',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '21. wrong taskType rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '21. wrong taskType rejected', passed: false, message: err.message });
  }

  // 22. target non-object rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: null,
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '22. target non-object rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '22. target non-object rejected', passed: false, message: err.message });
  }

  // 23. target exact-key violation rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: { targetType: 'News' },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '23. target exact-key violation rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '23. target exact-key violation rejected', passed: false, message: err.message });
  }

  // 24. invalid targetType rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: 'InvalidTarget',
            targetId: 'news-55',
            sourceUpdatedAt: '2026-09-29T12:00:00Z',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '24. invalid targetType rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '24. invalid targetType rejected', passed: false, message: err.message });
  }

  // 25. blank targetId rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: '',
            sourceUpdatedAt: '2026-09-29T12:00:00Z',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '25. blank targetId rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '25. blank targetId rejected', passed: false, message: err.message });
  }

  // 26. padded targetId rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: ' id ',
            sourceUpdatedAt: '2026-09-29T12:00:00Z',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '26. padded targetId rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '26. padded targetId rejected', passed: false, message: err.message });
  }

  // 27. blank sourceUpdatedAt rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: '   ',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '27. blank sourceUpdatedAt rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '27. blank sourceUpdatedAt rejected', passed: false, message: err.message });
  }

  // 28. padded sourceUpdatedAt rejected
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: ' 2026-09-29T12:00:00Z ',
          },
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '28. padded sourceUpdatedAt rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '28. padded sourceUpdatedAt rejected', passed: false, message: err.message });
  }

  // 29. non-ISO but non-empty trimmed sourceUpdatedAt is accepted
  try {
    const req = createValidRequest({
      result: {
        task: {
          taskId: 'task-100',
          taskType: AITaskType.CONTENT_REVIEW,
          target: {
            targetType: AIReviewTargetType.News,
            targetId: 'news-55',
            sourceUpdatedAt: 'custom-timestamp-string-123',
          },
        },
      },
    });
    const res = validateAdvisoryResultIntakeRequest(req);
    tests.push({ id: testCounter++, name: '29. non-ISO but non-empty trimmed sourceUpdatedAt is accepted', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '29. non-ISO but non-empty trimmed sourceUpdatedAt is accepted', passed: false, message: err.message });
  }

  // 30. assessment non-object rejected
  try {
    const req = createValidRequest({ result: { assessment: null } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '30. assessment non-object rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '30. assessment non-object rejected', passed: false, message: err.message });
  }

  // 31. assessment exact-key violation rejected
  try {
    const req = createValidRequest({ result: { assessment: { summary: 's' } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '31. assessment exact-key violation rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '31. assessment exact-key violation rejected', passed: false, message: err.message });
  }

  // 32. padded summary rejected
  try {
    const req = createValidRequest({ result: { assessment: { summary: ' summary ', findings: [] } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '32. padded summary rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '32. padded summary rejected', passed: false, message: err.message });
  }

  // 33. empty summary + zero findings rejected
  try {
    const req = createValidRequest({ result: { assessment: { summary: '', findings: [] } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '33. empty summary + zero findings rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '33. empty summary + zero findings rejected', passed: false, message: err.message });
  }

  // 34. empty summary + one valid finding accepted
  try {
    const req = createValidRequest({
      result: {
        assessment: {
          summary: '',
          findings: [{ code: 'CHK', severity: AIReviewSeverity.Info, message: 'msg' }],
        },
      },
    });
    const res = validateAdvisoryResultIntakeRequest(req);
    tests.push({ id: testCounter++, name: '34. empty summary + one valid finding accepted', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '34. empty summary + one valid finding accepted', passed: false, message: err.message });
  }

  // 35. non-empty summary + zero findings accepted
  try {
    const req = createValidRequest({
      result: {
        assessment: {
          summary: 'Looks good.',
          findings: [],
        },
      },
    });
    const res = validateAdvisoryResultIntakeRequest(req);
    tests.push({ id: testCounter++, name: '35. non-empty summary + zero findings accepted', passed: !!res });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '35. non-empty summary + zero findings accepted', passed: false, message: err.message });
  }

  // 36. findings non-array rejected
  try {
    const req = createValidRequest({ result: { assessment: { summary: 's', findings: {} } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '36. findings non-array rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '36. findings non-array rejected', passed: false, message: err.message });
  }

  // 37. finding non-object rejected
  try {
    const req = createValidRequest({ result: { assessment: { summary: 's', findings: [null] } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '37. finding non-object rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '37. finding non-object rejected', passed: false, message: err.message });
  }

  // 38. finding exact-key violation rejected
  try {
    const req = createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'C', severity: 'Info' }] } } });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '38. finding exact-key violation rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '38. finding exact-key violation rejected', passed: false, message: err.message });
  }

  // 39. invalid finding code matrix rejected
  try {
    const invalidCodes = ['', ' ', 'source_check', '1_SOURCE', 'SOURCE-CHECK', 'SOURCE CHECK', '_SOURCE', ' SOURCE_CHECK', 'SOURCE_CHECK '];
    let allRejected = true;
    for (const code of invalidCodes) {
      const req = createValidRequest({
        result: {
          assessment: {
            summary: 's',
            findings: [{ code, severity: AIReviewSeverity.Info, message: 'm' }],
          },
        },
      });
      if (!expectContractError(() => validateAdvisoryResultIntakeRequest(req))) {
        allRejected = false;
        break;
      }
    }
    tests.push({ id: testCounter++, name: '39. invalid finding code matrix rejected', passed: allRejected });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '39. invalid finding code matrix rejected', passed: false, message: err.message });
  }

  // 40. duplicate finding codes rejected
  try {
    const req = createValidRequest({
      result: {
        assessment: {
          summary: 's',
          findings: [
            { code: 'DUP', severity: AIReviewSeverity.Info, message: 'm1' },
            { code: 'DUP', severity: AIReviewSeverity.Warning, message: 'm2' },
          ],
        },
      },
    });
    const passed = expectContractError(() => validateAdvisoryResultIntakeRequest(req));
    tests.push({ id: testCounter++, name: '40. duplicate finding codes rejected', passed });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '40. duplicate finding codes rejected', passed: false, message: err.message });
  }

  // 41. invalid severity + invalid/padded/blank message matrix rejected
  try {
    const invalidSeverities = ['Critical', 'Error', 'Approved', '', null];
    const invalidMessages = ['', ' ', ' padded ', null];
    let allRejected = true;

    for (const severity of invalidSeverities) {
      const req = createValidRequest({
        result: {
          assessment: {
            summary: 's',
            findings: [{ code: 'CODE', severity: severity as any, message: 'valid msg' }],
          },
        },
      });
      if (!expectContractError(() => validateAdvisoryResultIntakeRequest(req))) {
        allRejected = false;
        break;
      }
    }

    for (const message of invalidMessages) {
      const req = createValidRequest({
        result: {
          assessment: {
            summary: 's',
            findings: [{ code: 'CODE', severity: AIReviewSeverity.Info, message: message as any }],
          },
        },
      });
      if (!expectContractError(() => validateAdvisoryResultIntakeRequest(req))) {
        allRejected = false;
        break;
      }
    }

    tests.push({ id: testCounter++, name: '41. invalid severity + invalid/padded/blank message matrix rejected', passed: allRejected });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '41. invalid severity + invalid/padded/blank message matrix rejected', passed: false, message: err.message });
  }

  // 42. final self-contained invariant + worker-wire parity + exact test-count gate
  try {
    const preCountMatch = tests.length === 41 && testCounter === 42;

    const sourcePath = path.join(process.cwd(), 'functions/src/peia/advisoryResultIntakeContract.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    // A. All four interfaces exist
    const interface1 = code.includes('export interface AdvisoryResultIntakeTaskReference');
    const interface2 = code.includes('export interface AdvisoryResultIntakeFinding');
    const interface3 = code.includes('export interface AdvisoryResultIntakeResult');
    const interface4 = code.includes('export interface AdvisoryResultIntakeRequest');
    const aMatch = interface1 && interface2 && interface3 && interface4;

    // B. Error vocabulary contains exactly ONE code: INVALID_ADVISORY_RESULT_INTAKE
    const errorTypeStart = code.indexOf('export type AdvisoryResultIntakeContractErrorCode');
    const errorTypeSub = errorTypeStart !== -1 ? code.slice(errorTypeStart) : '';
    const errorTypeEnd = errorTypeSub.indexOf(';');
    const errorTypeBlock = errorTypeStart !== -1 && errorTypeEnd !== -1 ? errorTypeSub.slice(0, errorTypeEnd) : '';
    const errorCodes = errorTypeBlock
      .split('=')[1]
      ?.split('|')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean) || [];
    const bMatch = errorCodes.length === 1 && errorCodes[0] === 'INVALID_ADVISORY_RESULT_INTAKE';

    // C. Exact fixed error message
    const cMatch = code.includes("'Invalid PEIA advisory result intake request.'") || code.includes('"Invalid PEIA advisory result intake request."');

    // D. Validator signature
    const dMatch = code.includes('export function validateAdvisoryResultIntakeRequest(') &&
                   code.includes('input: unknown') &&
                   code.includes('): AdvisoryResultIntakeRequest');

    // E. Plain object check
    const eMatch = code.includes('typeof value === \'object\'') &&
                   code.includes('value !== null') &&
                   code.includes('!Array.isArray(value)');

    // F. Outer request exact keys: ['result']
    const fMatch = code.includes("hasExactKeys(input, ['result'])");

    // G. Result exact keys: ['task', 'assessment']
    const gMatch = code.includes("hasExactKeys(result, ['task', 'assessment'])");

    // H. Task exact keys: ['taskId', 'taskType', 'target']
    const hMatch = code.includes("hasExactKeys(task, ['taskId', 'taskType', 'target'])");

    // I. Task type checked against AITaskType.CONTENT_REVIEW
    const iMatch = code.includes('task.taskType !== AITaskType.CONTENT_REVIEW');

    // J. Target exact keys: ['targetType', 'targetId', 'sourceUpdatedAt']
    const jMatch = code.includes("hasExactKeys(task.target, ['targetType', 'targetId', 'sourceUpdatedAt'])");

    // K. Target vocabulary derives from AIReviewTargetType
    const kMatch = code.includes('Object.values(AIReviewTargetType)');

    // L. Assessment exact keys: ['summary', 'findings']
    const lMatch = code.includes("hasExactKeys(assessment, ['summary', 'findings'])");

    // M. summary trimmed string & summary === '' && findings.length === 0 rejected
    const mMatch = code.includes('isTrimmedString(assessment.summary)') &&
                   code.includes("assessment.summary === '' && assessment.findings.length === 0");

    // N. Finding exact keys: ['code', 'severity', 'message']
    const nMatch = code.includes("hasExactKeys(finding, ['code', 'severity', 'message'])");

    // O. Finding code regex
    const oMatch = code.includes('/^[A-Z][A-Z0-9_]*$/');

    // P. Duplicate finding-code prevention Set
    const pMatch = code.includes('new Set<string>()') &&
                   code.includes('seenCodes.has(finding.code)') &&
                   code.includes('seenCodes.add(finding.code)');

    // Q. Severity derives from AIReviewSeverity
    const qMatch = code.includes('Object.values(AIReviewSeverity)');

    // R. Success returns original input reference with no clone / normalization
    const rMatch = (code.includes('return input as unknown as AdvisoryResultIntakeRequest') || code.includes('return input as AdvisoryResultIntakeRequest')) &&
                   !code.includes('structuredClone') &&
                   !code.includes('JSON.parse') &&
                   !code.includes('JSON.stringify') &&
                   !code.includes('{ ...input') &&
                   !code.includes('Object.assign') &&
                   !code.includes('trimmed replacement assignment');

    // S. No worker import in production
    const sMatch = !code.includes('peia-worker');

    // T. No machine authorization logic
    const tMatch = !code.includes('authorizeAdvisoryResultSubmission') &&
                   !code.includes('authorizePendingTaskDelivery') &&
                   !code.includes('MachineIdentityVerifier') &&
                   !code.includes('VerifiedMachinePrincipal') &&
                   !code.includes('PEIAMachineCapability') &&
                   !code.includes('MachineAuthorizationError');

    // U. No persistence / database
    const uMatch = !code.includes('Firestore') &&
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

    // V. No HTTP
    const vMatch = !code.includes('fetch(') &&
                   !code.includes('new Request') &&
                   !code.includes('new Response') &&
                   !code.includes('onRequest') &&
                   !code.includes('onCall') &&
                   !code.includes('Express') &&
                   !code.includes('Authorization') &&
                   !code.includes('Bearer');

    // W. No workflow / editorial authority
    const wMatch = !code.includes('AIReviewArtifact') &&
                   !code.includes('approve') &&
                   !code.includes('reject') &&
                   !code.includes('publish') &&
                   !code.includes('unpublish') &&
                   !code.includes('completeTask') &&
                   !code.includes('failTask') &&
                   !code.includes('AITaskStatus.Completed') &&
                   !code.includes('AITaskStatus.Failed');

    // X. No generated metadata
    const xMatch = !code.includes('principalId') &&
                   !code.includes('workerId') &&
                   !code.includes('providerId') &&
                   !code.includes('resultId') &&
                   !code.includes('receivedAt') &&
                   !code.includes('generatedAt') &&
                   !code.includes('createdAt') &&
                   !code.includes('updatedAt') &&
                   !code.includes('uploadedAt') &&
                   !code.includes('attemptCount');

    // Y. Full worker/server parity matrix
    function didPass(fn: () => unknown): boolean {
      try {
        fn();
        return true;
      } catch {
        return false;
      }
    }

    const parityVectors: Array<{
      id: number;
      type: 'RESULT' | 'ENVELOPE';
      expectedPass: boolean;
      getPayload: () => any;
    }> = [
      // 1. normal valid result
      { id: 1, type: 'RESULT', expectedPass: true, getPayload: () => createValidRequest().result },
      // 2. empty summary + one valid finding
      { id: 2, type: 'RESULT', expectedPass: true, getPayload: () => createValidRequest({ result: { assessment: { summary: '', findings: [{ code: 'CHK', severity: AIReviewSeverity.Info, message: 'msg' }] } } }).result },
      // 3. non-empty summary + empty findings
      { id: 3, type: 'RESULT', expectedPass: true, getPayload: () => createValidRequest({ result: { assessment: { summary: 'Looks good.', findings: [] } } }).result },
      // 4. non-ISO but non-empty trimmed sourceUpdatedAt
      { id: 4, type: 'RESULT', expectedPass: true, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: 'custom-timestamp-string-123' } } } }).result },
      // 5. extra result key
      { id: 5, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { extraKey: 1 } }).result },
      // 6. extra task key
      { id: 6, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, extraKey: 1, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 7. extra target key
      { id: 7, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: '2026-09-29T12:00:00Z', extraKey: 1 } } } }).result },
      // 8. extra assessment key
      { id: 8, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [], extraKey: 1 } } }).result },
      // 9. extra finding key
      { id: 9, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'CODE', severity: AIReviewSeverity.Info, message: 'm', extraKey: 1 }] } } }).result },
      // 10. blank taskId
      { id: 10, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: '   ', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 11. padded taskId
      { id: 11, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: ' task-1 ', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 12. wrong taskType
      { id: 12, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: 'WRONG_TYPE', target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 13. invalid targetType
      { id: 13, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: 'InvalidTarget', targetId: 'news-55', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 14. blank targetId
      { id: 14, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: '', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 15. padded targetId
      { id: 15, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: ' news-55 ', sourceUpdatedAt: '2026-09-29T12:00:00Z' } } } }).result },
      // 16. blank sourceUpdatedAt
      { id: 16, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: '   ' } } } }).result },
      // 17. padded sourceUpdatedAt
      { id: 17, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { task: { taskId: 'task-100', taskType: AITaskType.CONTENT_REVIEW, target: { targetType: AIReviewTargetType.News, targetId: 'news-55', sourceUpdatedAt: ' 2026-09-29T12:00:00Z ' } } } }).result },
      // 18. padded summary
      { id: 18, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: ' summary ', findings: [] } } }).result },
      // 19. empty summary + zero findings
      { id: 19, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: '', findings: [] } } }).result },
      // 20. invalid finding code
      { id: 20, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'invalid_code', severity: AIReviewSeverity.Info, message: 'm' }] } } }).result },
      // 21. duplicate finding code
      { id: 21, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'DUP', severity: AIReviewSeverity.Info, message: 'm1' }, { code: 'DUP', severity: AIReviewSeverity.Warning, message: 'm2' }] } } }).result },
      // 22. invalid severity
      { id: 22, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'CODE', severity: 'InvalidSeverity' as any, message: 'm' }] } } }).result },
      // 23. blank message
      { id: 23, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'CODE', severity: AIReviewSeverity.Info, message: '' }] } } }).result },
      // 24. padded message
      { id: 24, type: 'RESULT', expectedPass: false, getPayload: () => createValidRequest({ result: { assessment: { summary: 's', findings: [{ code: 'CODE', severity: AIReviewSeverity.Info, message: ' message ' }] } } }).result },
      // 25. valid upload envelope
      { id: 25, type: 'ENVELOPE', expectedPass: true, getPayload: () => createValidRequest() },
      // 26. extra outer key
      { id: 26, type: 'ENVELOPE', expectedPass: false, getPayload: () => ({ ...createValidRequest(), extraOuter: true }) },
      // 27. missing result
      { id: 27, type: 'ENVELOPE', expectedPass: false, getPayload: () => ({}) },
      // 28. null result
      { id: 28, type: 'ENVELOPE', expectedPass: false, getPayload: () => ({ result: null }) },
    ];

    let allParityMatched = true;
    for (const vec of parityVectors) {
      const payload = vec.getPayload();
      let workerPass: boolean;
      let serverPass: boolean;

      if (vec.type === 'RESULT') {
        workerPass = didPass(() => validatePEIAAdvisoryResult(payload));
        serverPass = didPass(() => validateAdvisoryResultIntakeRequest({ result: payload }));
      } else {
        workerPass = didPass(() => validateAdvisoryResultUploadRequest(payload));
        serverPass = didPass(() => validateAdvisoryResultIntakeRequest(payload));
      }

      if (workerPass !== vec.expectedPass || serverPass !== vec.expectedPass || workerPass !== serverPass) {
        allParityMatched = false;
        console.error(`Parity Vector ${vec.id} failed: expected=${vec.expectedPass}, worker=${workerPass}, server=${serverPass}`);
      }
    }

    const yMatch = allParityMatched;

    const allMatched = preCountMatch && aMatch && bMatch && cMatch && dMatch && eMatch &&
                       fMatch && gMatch && hMatch && iMatch && jMatch && kMatch && lMatch &&
                       mMatch && nMatch && oMatch && pMatch && qMatch && rMatch && sMatch &&
                       tMatch && uMatch && vMatch && wMatch && xMatch && yMatch;

    tests.push({
      id: testCounter++,
      name: '42. final self-contained invariant + worker-wire parity + exact test-count gate',
      passed: allMatched,
      message: allMatched ? undefined : `A:${aMatch} B:${bMatch} C:${cMatch} D:${dMatch} E:${eMatch} F:${fMatch} G:${gMatch} H:${hMatch} I:${iMatch} J:${jMatch} K:${kMatch} L:${lMatch} M:${mMatch} N:${nMatch} O:${oMatch} P:${pMatch} Q:${qMatch} R:${rMatch} S:${sMatch} T:${tMatch} U:${uMatch} V:${vMatch} W:${wMatch} X:${xMatch} Y:${yMatch}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '42. final self-contained invariant', passed: false, message: err.message });
  }

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA ADVISORY RESULT INTAKE CONTRACT TESTS');
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

  if (failed > 0 || tests.length !== 42 || testCounter !== 43) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
