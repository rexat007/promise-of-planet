import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PEIAAdvisoryResultContractError,
  validatePEIAAdvisoryResult,
  type PEIAAdvisoryResult,
  type PEIAAdvisoryFinding,
} from '../peia-worker/src/advisoryResultContract';
import {
  AITaskType,
} from '../src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
} from '../src/types/aiReview';

/**
 * PEIA-18A — WORKER ADVISORY RESULT CONTRACT TEST SUITE.
 * Enforces exactly 40 real test units covering canonical advisory results,
 * strict validation, reference preservation, rejection of authority/infrastructure fields, and invariants.
 */

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  totalTests++;
  try {
    await fn();
    passedTests++;
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

function assertThrowsContractError(fn: () => unknown): void {
  try {
    fn();
  } catch (err: unknown) {
    assert(
      err instanceof PEIAAdvisoryResultContractError,
      'Error must be instanceof PEIAAdvisoryResultContractError'
    );
    assert(
      (err as PEIAAdvisoryResultContractError).code === 'INVALID_ADVISORY_RESULT',
      'Error code must be INVALID_ADVISORY_RESULT'
    );
    assert(
      (err as PEIAAdvisoryResultContractError).message === 'Invalid PEIA advisory result.',
      'Error message must be "Invalid PEIA advisory result."'
    );
    return;
  }
  throw new Error('Expected function to throw PEIAAdvisoryResultContractError, but it returned normally.');
}

const canonicalFindings: readonly PEIAAdvisoryFinding[] = [
  {
    code: 'METRIC_VERIFICATION_NEEDED',
    severity: AIReviewSeverity.Info,
    message: 'Rainfall metrics require human verification against official records.',
  },
  {
    code: 'CITATION_SOURCE_OUTDATED',
    severity: AIReviewSeverity.Warning,
    message: 'Referenced policy guideline was revised in 2025.',
  },
  {
    code: 'POTENTIAL_INCONSISTENCY_DETECTED',
    severity: AIReviewSeverity.ReviewRecommended,
    message: 'Section 3 directly contradicts Section 1 figures.',
  },
];

const canonicalValidResult: PEIAAdvisoryResult = {
  task: {
    taskId: 'task-canonical-202',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: AIReviewTargetType.News,
      targetId: 'news-987',
      sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
  assessment: {
    summary: 'Comprehensive review completed. Three advisory findings recorded.',
    findings: canonicalFindings,
  },
};

async function runSuite() {
  console.log('--- PEIA-18A 40-Test Advisory Result Contract Audit ---');

  // 1. canonical AIReviewSeverity is used by worker contract
  await test('1. canonical AIReviewSeverity is used by worker contract', () => {
    assert(typeof AIReviewSeverity === 'object' && AIReviewSeverity !== null, 'AIReviewSeverity must exist');
    const source = readFileSync(join(process.cwd(), 'peia-worker/src/advisoryResultContract.ts'), 'utf8');
    assert(source.includes('AIReviewSeverity'), 'Production source must import and use canonical AIReviewSeverity');
  });

  // 2. exact severity values are Info, Warning, ReviewRecommended
  await test('2. exact severity values are Info, Warning, ReviewRecommended', () => {
    const keys = Object.keys(AIReviewSeverity).sort();
    assert(JSON.stringify(keys) === JSON.stringify(['Info', 'ReviewRecommended', 'Warning']), 'Exact severity keys mismatch');
    assert(AIReviewSeverity.Info === 'Info', 'Severity Info mismatch');
    assert(AIReviewSeverity.Warning === 'Warning', 'Severity Warning mismatch');
    assert(AIReviewSeverity.ReviewRecommended === 'ReviewRecommended', 'Severity ReviewRecommended mismatch');
  });

  // 3. validatePEIAAdvisoryResult exists
  await test('3. validatePEIAAdvisoryResult exists', () => {
    assert(typeof validatePEIAAdvisoryResult === 'function', 'validatePEIAAdvisoryResult must be a function');
  });

  // 4. valid canonical artifact passes
  await test('4. valid canonical artifact passes', () => {
    const result = validatePEIAAdvisoryResult(canonicalValidResult);
    assert(result.task.taskId === 'task-canonical-202', 'taskId must match');
    assert(result.assessment.findings.length === 3, 'Findings count must match');
  });

  // 5. validator returns exact same object reference
  await test('5. validator returns exact same object reference', () => {
    const result = validatePEIAAdvisoryResult(canonicalValidResult);
    assert(result === canonicalValidResult, 'Validator must return exact same object reference');
  });

  // 6. all current AIReviewTargetType values accepted
  await test('6. all current AIReviewTargetType values accepted', () => {
    for (const targetType of Object.values(AIReviewTargetType)) {
      const candidate: PEIAAdvisoryResult = {
        ...canonicalValidResult,
        task: {
          ...canonicalValidResult.task,
          target: {
            ...canonicalValidResult.task.target,
            targetType,
          },
        },
      };
      const res = validatePEIAAdvisoryResult(candidate);
      assert(res.task.target.targetType === targetType, `Target type ${targetType} must be accepted`);
    }
  });

  // 7. missing top-level task rejected
  await test('7. missing top-level task rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      assessment: canonicalValidResult.assessment,
    }));
  });

  // 8. missing assessment rejected
  await test('8. missing assessment rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      task: canonicalValidResult.task,
    }));
  });

  // 9. extra top-level field rejected
  await test('9. extra top-level field rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      extraField: 'not-allowed',
    }));
  });

  // 10. blank taskId rejected
  await test('10. blank taskId rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: '',
      },
    }));
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: '   ',
      },
    }));
  });

  // 11. padded taskId rejected
  await test('11. padded taskId rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskId: ' task-canonical-202 ',
      },
    }));
  });

  // 12. wrong taskType rejected
  await test('12. wrong taskType rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        taskType: 'IMAGE_GENERATION' as unknown as typeof AITaskType.CONTENT_REVIEW,
      },
    }));
  });

  // 13. target non-object rejected
  await test('13. target non-object rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: 'invalid-string-target' as unknown as typeof canonicalValidResult.task.target,
      },
    }));
  });

  // 14. missing targetType rejected
  await test('14. missing targetType rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          targetId: 'news-987',
          sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
        } as unknown as typeof canonicalValidResult.task.target,
      },
    }));
  });

  // 15. invalid targetType rejected
  await test('15. invalid targetType rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          targetType: 'UnknownType' as unknown as AIReviewTargetType,
          targetId: 'news-987',
          sourceUpdatedAt: '2026-09-28T00:00:00.000Z',
        },
      },
    }));
  });

  // 16. blank targetId rejected
  await test('16. blank targetId rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          targetId: '',
        },
      },
    }));
  });

  // 17. padded targetId rejected
  await test('17. padded targetId rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          targetId: ' news-987 ',
        },
      },
    }));
  });

  // 18. blank sourceUpdatedAt rejected
  await test('18. blank sourceUpdatedAt rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          sourceUpdatedAt: '',
        },
      },
    }));
  });

  // 19. padded sourceUpdatedAt rejected
  await test('19. padded sourceUpdatedAt rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      task: {
        ...canonicalValidResult.task,
        target: {
          ...canonicalValidResult.task.target,
          sourceUpdatedAt: ' 2026-09-28T00:00:00.000Z ',
        },
      },
    }));
  });

  // 20. assessment non-object rejected
  await test('20. assessment non-object rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: 'string-assessment' as unknown as typeof canonicalValidResult.assessment,
    }));
  });

  // 21. missing summary rejected
  await test('21. missing summary rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        findings: canonicalFindings,
      } as unknown as typeof canonicalValidResult.assessment,
    }));
  });

  // 22. missing findings rejected
  await test('22. missing findings rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary exists',
      } as unknown as typeof canonicalValidResult.assessment,
    }));
  });

  // 23. summary wrong type rejected
  await test('23. summary wrong type rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 12345 as unknown as string,
        findings: canonicalFindings,
      },
    }));
  });

  // 24. findings non-array rejected
  await test('24. findings non-array rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Valid summary',
        findings: {} as unknown as readonly PEIAAdvisoryFinding[],
      },
    }));
  });

  // 25. completely empty assessment summary === '' findings.length === 0 rejected
  await test('25. completely empty assessment summary === "" findings.length === 0 rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: '',
        findings: [],
      },
    }));
  });

  // 26. empty summary accepted when findings non-empty
  await test('26. empty summary accepted when findings non-empty', () => {
    const candidate: PEIAAdvisoryResult = {
      ...canonicalValidResult,
      assessment: {
        summary: '',
        findings: canonicalFindings,
      },
    };
    const res = validatePEIAAdvisoryResult(candidate);
    assert(res.assessment.summary === '', 'Empty summary must be preserved when findings non-empty');
    assert(res.assessment.findings.length === 3, 'Findings must be preserved');
  });

  // 27. empty findings accepted when summary non-empty
  await test('27. empty findings accepted when summary non-empty', () => {
    const candidate: PEIAAdvisoryResult = {
      ...canonicalValidResult,
      assessment: {
        summary: 'Non-empty summary text',
        findings: [],
      },
    };
    const res = validatePEIAAdvisoryResult(candidate);
    assert(res.assessment.summary === 'Non-empty summary text', 'Summary must match');
    assert(res.assessment.findings.length === 0, 'Empty findings array must be preserved');
  });

  // 28. finding non-object rejected
  await test('28. finding non-object rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: ['not-an-object' as unknown as PEIAAdvisoryFinding],
      },
    }));
  });

  // 29. finding missing code rejected
  await test('29. finding missing code rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: [
          {
            severity: AIReviewSeverity.Info,
            message: 'Message without code',
          } as unknown as PEIAAdvisoryFinding,
        ],
      },
    }));
  });

  // 30. finding invalid code regex rejected
  await test('30. finding invalid code regex rejected', () => {
    const invalidCodes = ['lowercase_code', '123_NUM_FIRST', 'CODE-WITH-DASHES', 'CODE WITH SPACES', '_UNDERSCORE_FIRST'];
    for (const code of invalidCodes) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        assessment: {
          summary: 'Summary',
          findings: [
            {
              code,
              severity: AIReviewSeverity.Info,
              message: 'Invalid code format',
            },
          ],
        },
      }));
    }
  });

  // 31. padded finding code rejected
  await test('31. padded finding code rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: [
          {
            code: ' METRIC_CODE ',
            severity: AIReviewSeverity.Info,
            message: 'Padded code',
          },
        ],
      },
    }));
  });

  // 32. duplicate finding codes rejected
  await test('32. duplicate finding codes rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: [
          {
            code: 'DUPLICATE_CODE',
            severity: AIReviewSeverity.Info,
            message: 'First finding',
          },
          {
            code: 'DUPLICATE_CODE',
            severity: AIReviewSeverity.Warning,
            message: 'Second finding with identical code',
          },
        ],
      },
    }));
  });

  // 33. invalid severity rejected (including 'Critical')
  await test('33. invalid severity rejected', () => {
    const invalidSeverities = ['Critical', 'Fatal', 'Error', 'Low', 'High', 'reviewRecommended'];
    for (const severity of invalidSeverities) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        assessment: {
          summary: 'Summary',
          findings: [
            {
              code: 'VALID_CODE',
              severity: severity as unknown as AIReviewSeverity,
              message: 'Invalid severity value',
            },
          ],
        },
      }));
    }
  });

  // 34. blank message rejected
  await test('34. blank message rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: [
          {
            code: 'VALID_CODE',
            severity: AIReviewSeverity.Info,
            message: '',
          },
        ],
      },
    }));
  });

  // 35. padded message rejected
  await test('35. padded message rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: [
          {
            code: 'VALID_CODE',
            severity: AIReviewSeverity.Info,
            message: ' Padded message content ',
          },
        ],
      },
    }));
  });

  // 36. extra finding field rejected
  await test('36. extra finding field rejected', () => {
    assertThrowsContractError(() => validatePEIAAdvisoryResult({
      ...canonicalValidResult,
      assessment: {
        summary: 'Summary',
        findings: [
          {
            code: 'VALID_CODE',
            severity: AIReviewSeverity.Info,
            message: 'Valid message',
            extraFindingField: 123,
          } as unknown as PEIAAdvisoryFinding,
        ],
      },
    }));
  });

  // 37. prohibited authority/action fields rejected at top-level, assessment, and finding where applicable
  await test('37. prohibited authority/action fields rejected at top-level, assessment, and finding where applicable', () => {
    const prohibitedTopFields = [
      'decision',
      'suggestedAction',
      'approved',
      'published',
      'workflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
    ];

    for (const field of prohibitedTopFields) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        [field]: 'prohibited-value',
      }));
    }

    const prohibitedAssessmentFields = [
      'decision',
      'suggestedAction',
      'approved',
      'published',
      'workflowState',
      'autoApply',
      'autoPublish',
    ];

    for (const field of prohibitedAssessmentFields) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        assessment: {
          ...canonicalValidResult.assessment,
          [field]: 'prohibited-value',
        },
      }));
    }

    const prohibitedFindingFields = [
      'action',
      'decision',
      'autoApply',
      'approved',
    ];

    for (const field of prohibitedFindingFields) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        assessment: {
          summary: 'Summary',
          findings: [
            {
              code: 'VALID_CODE',
              severity: AIReviewSeverity.Info,
              message: 'Message',
              [field]: 'prohibited-value',
            } as unknown as PEIAAdvisoryFinding,
          ],
        },
      }));
    }
  });

  // 38. prohibited infrastructure/model-internal fields rejected
  await test('38. prohibited infrastructure/model-internal fields rejected', () => {
    const prohibitedInfraAndModelFields = [
      'credential',
      'machineToken',
      'endpointUrl',
      'databasePath',
      'chainOfThought',
      'rawModelOutput',
      'systemPrompt',
      'prompt',
      'logprobs',
      'tokenCount',
    ];

    for (const field of prohibitedInfraAndModelFields) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        [field]: 'prohibited-infra-or-model-value',
      }));
    }

    for (const field of prohibitedInfraAndModelFields) {
      assertThrowsContractError(() => validatePEIAAdvisoryResult({
        ...canonicalValidResult,
        assessment: {
          ...canonicalValidResult.assessment,
          [field]: 'prohibited-in-assessment',
        },
      }));
    }
  });

  // 39. source invariants: no timestamps/random IDs/network/SQLite/filesystem/env/authority fields
  await test('39. source invariants: no timestamps/random IDs/network/SQLite/filesystem/env/authority fields', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const forbidden = [
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
      'resultId',
      'generatedAt',
      'fetch(',
      'globalThis.fetch',
      'Authorization',
      'Bearer',
      'node:sqlite',
      'DatabaseSync',
      'node:fs',
      'process.env',
      'import.meta.env',
      'contentSnapshot',
      'decision',
      'suggestedAction',
      'approved',
      'rejected',
      'published',
      'workflowState',
      'desiredWorkflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'override',
      'execute',
      'chainOfThought',
      'hiddenReasoning',
      'rawModelOutput',
      'systemPrompt',
      'logprobs',
      'modelWeights',
      'export const PEIAAdvisorySeverity',
      'export type PEIAAdvisorySeverity',
      'Critical',
    ];

    for (const token of forbidden) {
      assert(!source.includes(token), `Forbidden token "${token}" found in source`);
    }

    assert(source.includes('ReviewTargetIdentity'), 'Production must use ReviewTargetIdentity');
    assert(source.includes('AIReviewSeverity'), 'Production must use AIReviewSeverity');
    assert(source.includes('Object.values(AIReviewTargetType)'), 'Production must use Object.values(AIReviewTargetType)');
    assert(source.includes('Object.values(AIReviewSeverity)'), 'Production must use Object.values(AIReviewSeverity)');
  });

  // 40. exact test count + source invariant final gate
  await test('40. exact test count + source invariant final gate', () => {
    const filePath = join(process.cwd(), 'peia-worker/src/advisoryResultContract.ts');
    const source = readFileSync(filePath, 'utf8');

    const requiredTokens = [
      'ReviewTargetIdentity',
      'AIReviewSeverity',
      'PEIAAdvisoryFinding',
      'AdvisoryResultTaskReference',
      'PEIAAdvisoryResult',
      'PEIAAdvisoryResultContractError',
      'validatePEIAAdvisoryResult',
      'Object.values(AIReviewTargetType)',
      'Object.values(AIReviewSeverity)',
    ];

    for (const token of requiredTokens) {
      assert(source.includes(token), `Required token "${token}" missing from source`);
    }

    // 1. EXACTLY ONE ERROR CODE
    const errorCodeTypeMatch = source.match(
      /export\s+type\s+PEIAAdvisoryResultContractErrorCode\s*=\s*([^;]+);/
    );
    assert(errorCodeTypeMatch !== null, 'Must declare PEIAAdvisoryResultContractErrorCode type');
    const errorCodes = errorCodeTypeMatch![1]
      .split('|')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s.length > 0);
    assert(errorCodes.length === 1, `Expected exactly 1 error code, got ${errorCodes.length}`);
    assert(errorCodes[0] === 'INVALID_ADVISORY_RESULT', 'Error code must be INVALID_ADVISORY_RESULT');

    // 2. EXACT FIXED MESSAGE
    assert(
      source.includes("message: string = 'Invalid PEIA advisory result.'") ||
      source.includes('message: string = "Invalid PEIA advisory result."'),
      'Constructor default/fixed message must be "Invalid PEIA advisory result."'
    );

    // 3. DUPLICATE CODE DETECTION
    assert(source.includes('seenCodes'), 'Must declare seenCodes');
    assert(source.includes('seenCodes.has(finding.code)'), 'Must check seenCodes.has(finding.code)');
    assert(source.includes('seenCodes.add(finding.code)'), 'Must execute seenCodes.add(finding.code)');

    // 4. IDENTITY PRESERVATION & NO CLONE HELPERS
    assert(source.includes('return input as PEIAAdvisoryResult;'), 'Must return input directly by identity');
    assert(!source.includes('structuredClone'), 'Must not use structuredClone');
    assert(!source.includes('JSON.stringify(input)'), 'Must not clone via JSON.stringify');
    assert(!source.includes('JSON.parse(JSON.stringify'), 'Must not clone via JSON.parse/stringify');
    assert(!source.includes('Object.assign({}, input)'), 'Must not clone via Object.assign');
    assert(!source.includes('{ ...input }'), 'Must not shallow clone input');

    // 5. NO SERVER-OWNED RESULT METADATA
    assert(!source.includes('resultId'), 'Must contain no resultId');
    assert(!source.includes('generatedAt'), 'Must contain no generatedAt');
    assert(!source.includes('providerId'), 'Must contain no providerId');
    assert(!source.includes('executionState'), 'Must contain no executionState');

    // 6. NO LOCAL SEVERITY DUPLICATION
    assert(!source.includes('export const PEIAAdvisorySeverity'), 'Must not declare PEIAAdvisorySeverity const');
    assert(!source.includes('export type PEIAAdvisorySeverity'), 'Must not declare PEIAAdvisorySeverity type');
    assert(!source.includes('Critical'), 'Must not contain Critical severity');

    // 7. CANONICAL REUSE
    assert(source.includes('ReviewTargetIdentity'), 'Must reuse ReviewTargetIdentity');
    assert(source.includes('AIReviewSeverity'), 'Must reuse AIReviewSeverity');
    assert(source.includes('Object.values(AIReviewTargetType)'), 'Must use Object.values(AIReviewTargetType)');
    assert(source.includes('Object.values(AIReviewSeverity)'), 'Must use Object.values(AIReviewSeverity)');

    // 8. NO AUTHORITY FIELDS
    const forbiddenAuthority = [
      'decision',
      'suggestedAction',
      'approved',
      'rejected',
      'published',
      'workflowState',
      'desiredWorkflowState',
      'permission',
      'role',
      'autoApply',
      'autoPublish',
      'override',
      'execute',
    ];
    for (const field of forbiddenAuthority) {
      assert(!source.includes(field), `Forbidden authority field "${field}" found in source`);
    }

    // 9. TEST COUNT
    assert(totalTests === 40, `Expected exactly 40 tests, found ${totalTests}`);
    assert(passedTests === 39, `Expected 39 prior tests to have passed, got ${passedTests}`);
  });

  // Final count gate
  assert(totalTests === 40, `Expected exactly 40 tests, found ${totalTests}`);
  assert(passedTests === 40, `Expected exactly 40 passed tests, found ${passedTests}`);

  console.log(`SUMMARY: ${passedTests} passed / ${totalTests} total / 0 failed`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
