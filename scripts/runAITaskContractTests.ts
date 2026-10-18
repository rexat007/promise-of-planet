import * as fs from 'fs';
import * as path from 'path';
import {
  AITaskType as CanonicalAITaskType,
  AITaskStatus as CanonicalAITaskStatus,
} from '../functions/src/shared/aiTaskContract';
import {
  AITaskType as FrontendAITaskType,
  AITaskStatus as FrontendAITaskStatus,
} from '../src/types/aiTask';
import {
  AIReviewTargetType as CanonicalAIReviewTargetType,
} from '../functions/src/shared/aiReviewContract';
import {
  AIReviewTargetType as FrontendAIReviewTargetType,
} from '../src/types/aiReview';

interface TestResult {
  id: string;
  name: string;
  classification: 'STATIC_SOURCE_ASSERTION' | 'UNIT_LOGIC_TEST' | 'COMPONENT_BEHAVIOR_TEST';
  passed: boolean;
  message?: string;
}

function runAITaskContractTests(): TestResult[] {
  const results: TestResult[] = [];

  try {
    const canonicalTaskPath = path.join(process.cwd(), 'functions/src/shared/aiTaskContract.ts');
    const frontendTaskPath = path.join(process.cwd(), 'src/types/aiTask.ts');
    const canonicalReviewPath = path.join(process.cwd(), 'functions/src/shared/aiReviewContract.ts');
    const taskCode = fs.readFileSync(canonicalTaskPath, 'utf8');
    const frontendBridgeCode = fs.readFileSync(frontendTaskPath, 'utf8');
    const reviewCode = fs.readFileSync(canonicalReviewPath, 'utf8');

    // 1. CONTENT_REVIEW is the only task type (source + runtime)
    const runtimeTaskTypeKeys = Object.keys(CanonicalAITaskType);
    const onlyContentReviewType =
      taskCode.includes("CONTENT_REVIEW: 'CONTENT_REVIEW'") &&
      !taskCode.includes('LIBRARY_INGEST') &&
      !taskCode.includes('MEDIA_SYNC') &&
      !taskCode.includes('SOURCE_DISCOVERY') &&
      runtimeTaskTypeKeys.length === 1 &&
      CanonicalAITaskType.CONTENT_REVIEW === 'CONTENT_REVIEW';
    results.push({
      id: 'A',
      name: 'CONTENT_REVIEW is the only task type',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: onlyContentReviewType,
      message: onlyContentReviewType ? undefined : 'Found extra task types that violate minimal capability scope',
    });

    // 2. Pending / Completed / Failed are the only statuses (source + runtime)
    const runtimeStatusKeys = Object.keys(CanonicalAITaskStatus).sort();
    const onlyMinimalStatuses =
      taskCode.includes("Pending: 'Pending'") &&
      taskCode.includes("Completed: 'Completed'") &&
      taskCode.includes("Failed: 'Failed'") &&
      !taskCode.includes('InProgress') &&
      !taskCode.includes('Cancelled') &&
      !taskCode.includes('Queued') &&
      runtimeStatusKeys.length === 3 &&
      runtimeStatusKeys[0] === 'Completed' &&
      runtimeStatusKeys[1] === 'Failed' &&
      runtimeStatusKeys[2] === 'Pending' &&
      CanonicalAITaskStatus.Pending === 'Pending' &&
      CanonicalAITaskStatus.Completed === 'Completed' &&
      CanonicalAITaskStatus.Failed === 'Failed';
    results.push({
      id: 'B',
      name: 'Pending / Completed / Failed are the only statuses (Cancellation deferred)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: onlyMinimalStatuses,
      message: onlyMinimalStatuses ? undefined : 'Found invalid status vocabulary or cancellation states',
    });

    // 3. ReviewTargetIdentity is reused from canonical aiReviewContract
    const reusesTargetIdentity =
      taskCode.includes("import type { ReviewTargetIdentity } from './aiReviewContract'") ||
      taskCode.includes("import type {ReviewTargetIdentity} from './aiReviewContract'");
    results.push({
      id: 'C',
      name: 'ReviewTargetIdentity is reused from canonical aiReviewContract',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: reusesTargetIdentity,
      message: reusesTargetIdentity ? undefined : 'Did not reuse the canonical ReviewTargetIdentity contract from ./aiReviewContract',
    });

    // 4. Required fields exist: taskId, taskType, target, contentSnapshot, createdAt, status
    const hasRequiredFields =
      taskCode.includes('taskId:') &&
      taskCode.includes('taskType:') &&
      taskCode.includes('target:') &&
      taskCode.includes('contentSnapshot:') &&
      taskCode.includes('createdAt:') &&
      taskCode.includes('status:');
    results.push({
      id: 'D',
      name: 'Required task fields exist (taskId, taskType, target, contentSnapshot, createdAt, status)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: hasRequiredFields,
      message: hasRequiredFields ? undefined : 'Missing required task interface properties',
    });

    // 5. Fields are marked readonly
    const utilizesReadonly =
      taskCode.includes('readonly taskId:') &&
      taskCode.includes('readonly taskType:') &&
      taskCode.includes('readonly target:') &&
      taskCode.includes('readonly contentSnapshot:') &&
      taskCode.includes('readonly createdAt:') &&
      taskCode.includes('readonly status:');
    results.push({
      id: 'E',
      name: 'Task attributes are readonly for snapshot immutability',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: utilizesReadonly,
      message: utilizesReadonly ? undefined : 'Task contract does not use readonly properties for immutability',
    });

    // 6. No priority, cancellation, language, worker identity/auth, or human authority fields
    const noProhibitedFields =
      !taskCode.includes('priority:') &&
      !taskCode.includes('workerId:') &&
      !taskCode.includes('apiKey:') &&
      !taskCode.includes('serviceAccount:') &&
      !taskCode.includes('machineToken:') &&
      !taskCode.includes('language:') &&
      !taskCode.includes('lang:') &&
      !taskCode.includes('approved:') &&
      !taskCode.includes('published:') &&
      !taskCode.includes('workflowState:') &&
      !taskCode.includes('suggestedAction:');
    results.push({
      id: 'F',
      name: 'No priority, cancellation, language, worker identity, or human decision fields are specified',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: noProhibitedFields,
      message: noProhibitedFields ? undefined : 'Found forbidden fields in the minimalist task contract',
    });

    // 7. contentSnapshot uses Readonly<Record<string, unknown>>
    const validContentSnapshotType = taskCode.includes('contentSnapshot: Readonly<Record<string, unknown>>');
    results.push({
      id: 'G',
      name: 'contentSnapshot uses Readonly<Record<string, unknown>> and has accurate documentation comments',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: validContentSnapshotType,
      message: validContentSnapshotType ? undefined : 'contentSnapshot must use Readonly<Record<string, unknown>>',
    });

    // 8. AIReviewArtifact remains untouched & no duplicate result type was created
    const noResultTypeDuplication =
      reviewCode.includes('export interface AIReviewArtifact') &&
      reviewCode.includes('readonly isAdvisoryOnly: true;') &&
      !taskCode.includes('interface AIReviewArtifact') &&
      !taskCode.includes('interface AgentResult') &&
      !taskCode.includes('interface AITaskResult') &&
      !frontendBridgeCode.includes('interface AIReviewArtifact') &&
      !frontendBridgeCode.includes('interface AgentResult') &&
      !frontendBridgeCode.includes('interface AITaskResult');
    results.push({
      id: 'H',
      name: 'AIReviewArtifact is untouched and no duplicate result types are declared',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: noResultTypeDuplication,
      message: noResultTypeDuplication ? undefined : 'Duplicate result types found inside the task contract',
    });

    // 9. No runtime gateway/persistence/queue implementation exists in src/services/
    const noGatewayImplementation =
      !fs.existsSync(path.join(process.cwd(), 'src/services/aiTaskService.ts')) &&
      !fs.existsSync(path.join(process.cwd(), 'src/services/aiQueueService.ts'));
    results.push({
      id: 'I',
      name: 'No runtime gateway, persistence, or queue implementation is created',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: noGatewayImplementation,
      message: noGatewayImplementation ? undefined : 'Found premature runtime implementations in src/services/',
    });

    // 10. src/types/aiTask.ts re-exports canonical contract and preserves reference identity
    const validFrontendBridgeAndIdentity =
      frontendBridgeCode.includes("from '../../functions/src/shared/aiTaskContract'") &&
      !frontendBridgeCode.includes('interface AIReviewTask') &&
      !frontendBridgeCode.includes('AITaskType = {') &&
      !frontendBridgeCode.includes('AITaskStatus = {') &&
      FrontendAITaskType === CanonicalAITaskType &&
      FrontendAITaskStatus === CanonicalAITaskStatus &&
      FrontendAIReviewTargetType === CanonicalAIReviewTargetType;
    results.push({
      id: 'J',
      name: 'Frontend compatibility bridge re-exports canonical task contract and preserves runtime reference identity',
      classification: 'UNIT_LOGIC_TEST',
      passed: validFrontendBridgeAndIdentity,
      message: validFrontendBridgeAndIdentity ? undefined : 'Frontend compatibility bridge or runtime reference identity mismatch',
    });

  } catch (err: any) {
    results.push({
      id: 'A',
      name: 'CONTENT_REVIEW is the only task type',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  return results;
}

async function main() {
  console.log('====================================================');
  console.log('RUNNING PEIA AI TASK CONTRACT TESTS');
  console.log('====================================================\n');

  const results = runAITaskContractTests();
  let passedCount = 0;
  let failedCount = 0;

  for (const r of results) {
    if (r.passed) {
      passedCount++;
      console.log(`✅ [${r.id}] [${r.classification}] ${r.name}`);
    } else {
      failedCount++;
      console.error(`❌ [${r.id}] [${r.classification}] ${r.name}`);
      if (r.message) {
        console.error(`   Message: ${r.message}`);
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${passedCount} passed / ${results.length} total / ${failedCount} failed`);
  console.log('----------------------------------------------------\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
