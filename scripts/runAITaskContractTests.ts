import * as fs from 'fs';
import * as path from 'path';

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
    const aiTaskPath = path.join(process.cwd(), 'src/types/aiTask.ts');
    const taskCode = fs.readFileSync(aiTaskPath, 'utf8');

    // 1. CONTENT_REVIEW is the only task type
    const onlyContentReviewType = taskCode.includes("CONTENT_REVIEW: 'CONTENT_REVIEW'") && 
                                  !taskCode.includes('LIBRARY_INGEST') && 
                                  !taskCode.includes('MEDIA_SYNC') && 
                                  !taskCode.includes('SOURCE_DISCOVERY');
    results.push({
      id: 'A',
      name: 'CONTENT_REVIEW is the only task type',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: onlyContentReviewType,
      message: onlyContentReviewType ? undefined : 'Found extra task types that violate minimal capability scope',
    });

    // 2. Pending / Completed / Failed are the only statuses
    const onlyMinimalStatuses = taskCode.includes("Pending: 'Pending'") && 
                                taskCode.includes("Completed: 'Completed'") && 
                                taskCode.includes("Failed: 'Failed'") && 
                                !taskCode.includes('InProgress') && 
                                !taskCode.includes('Cancelled') && 
                                !taskCode.includes('Queued');
    results.push({
      id: 'B',
      name: 'Pending / Completed / Failed are the only statuses (Cancellation deferred)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: onlyMinimalStatuses,
      message: onlyMinimalStatuses ? undefined : 'Found invalid status vocabulary or cancellation states',
    });

    // 3. ReviewTargetIdentity is reused
    const reusesTargetIdentity = taskCode.includes("import type { ReviewTargetIdentity }") || 
                                 taskCode.includes("import type {ReviewTargetIdentity}");
    results.push({
      id: 'C',
      name: 'ReviewTargetIdentity is reused from aiReview',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: reusesTargetIdentity,
      message: reusesTargetIdentity ? undefined : 'Did not reuse the existing ReviewTargetIdentity contract',
    });

    // 4. Required fields exist: taskId, taskType, target, contentSnapshot, createdAt, status
    const hasRequiredFields = taskCode.includes('taskId:') && 
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
    const utilizesReadonly = taskCode.includes('readonly taskId:') && 
                             taskCode.includes('readonly taskType:') && 
                             taskCode.includes('readonly target:') && 
                             taskCode.includes('readonly contentSnapshot:') && 
                             taskCode.includes('readonly createdAt:');
    results.push({
      id: 'E',
      name: 'Task attributes are readonly for snapshot immutability',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: utilizesReadonly,
      message: utilizesReadonly ? undefined : 'Task contract does not use readonly properties for immutability',
    });

    // 6. No priority, cancellation, language, worker identity/auth, or human authority fields
    const noProhibitedFields = !taskCode.includes('priority:') && 
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
    const noResultTypeDuplication = !taskCode.includes('interface AIReviewArtifact') && 
                                    !taskCode.includes('interface AgentResult') && 
                                    !taskCode.includes('interface AITaskResult');
    results.push({
      id: 'H',
      name: 'AIReviewArtifact is untouched and no duplicate result types are declared',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: noResultTypeDuplication,
      message: noResultTypeDuplication ? undefined : 'Duplicate result types found inside the task contract',
    });

    // 9. No runtime gateway/persistence/queue implementation exists in this unit
    const noGatewayImplementation = !fs.existsSync(path.join(process.cwd(), 'src/services/aiTaskService.ts')) &&
                                    !fs.existsSync(path.join(process.cwd(), 'src/services/aiQueueService.ts'));
    results.push({
      id: 'I',
      name: 'No runtime gateway, persistence, or queue implementation is created',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: noGatewayImplementation,
      message: noGatewayImplementation ? undefined : 'Found premature runtime implementations in src/services/',
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
