import * as fs from 'fs';
import * as path from 'path';
import {
  AITaskType as CanonicalAITaskType,
  AITaskStatus as CanonicalAITaskStatus,
} from '../functions/src/shared/aiTaskContract';
import {
  AITaskType as ServerAITaskType,
  AITaskStatus as ServerAITaskStatus,
} from '../functions/src/types/aiTask';
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

function runAITaskServerContractTests(): TestResult[] {
  const results: TestResult[] = [];

  try {
    // A. functions/src/types/aiTask.ts exists
    const serverTaskPath = path.join(process.cwd(), 'functions/src/types/aiTask.ts');
    const serverFileExists = fs.existsSync(serverTaskPath);
    results.push({
      id: 'A',
      name: 'Server type bridge file functions/src/types/aiTask.ts exists',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: serverFileExists,
      message: serverFileExists ? undefined : 'functions/src/types/aiTask.ts is missing',
    });

    if (serverFileExists) {
      const serverCode = fs.readFileSync(serverTaskPath, 'utf8');

      // B. it re-exports from '../shared/aiTaskContract' and does not use cross-root '../../../src/types/aiTask'
      const reexportsCanonical =
        serverCode.includes("from '../shared/aiTaskContract'") &&
        !serverCode.includes("from '../../../src/types/aiTask'");
      results.push({
        id: 'B',
        name: 'Re-exports directly from canonical ../shared/aiTaskContract',
        classification: 'STATIC_SOURCE_ASSERTION',
        passed: reexportsCanonical,
        message: reexportsCanonical ? undefined : 'Does not re-export from canonical ../shared/aiTaskContract path',
      });

      // C. it does NOT redefine types/interfaces
      const noRedefinition =
        !serverCode.includes('interface AIReviewTask') &&
        !serverCode.includes('AITaskType = {') &&
        !serverCode.includes('AITaskStatus = {');
      results.push({
        id: 'C',
        name: 'Does not redefine interfaces, types, or enum objects locally',
        classification: 'STATIC_SOURCE_ASSERTION',
        passed: noRedefinition,
        message: noRedefinition ? undefined : 'Server file redefines structures locally instead of clean re-exporting',
      });
    }

    // D. Canonical functions/src/shared/aiTaskContract.ts and frontend compatibility bridge src/types/aiTask.ts exist and remain aligned
    const canonicalPath = path.join(process.cwd(), 'functions/src/shared/aiTaskContract.ts');
    const frontendBridgePath = path.join(process.cwd(), 'src/types/aiTask.ts');
    const canonicalExists = fs.existsSync(canonicalPath);
    const frontendBridgeExists = fs.existsSync(frontendBridgePath);
    const frontendBridgeCode = frontendBridgeExists ? fs.readFileSync(frontendBridgePath, 'utf8') : '';
    const frontendBridgeClean =
      frontendBridgeExists &&
      frontendBridgeCode.includes("from '../../functions/src/shared/aiTaskContract'") &&
      !frontendBridgeCode.includes('interface AIReviewTask') &&
      !frontendBridgeCode.includes('AITaskType = {') &&
      !frontendBridgeCode.includes('AITaskStatus = {');

    results.push({
      id: 'D_1',
      name: 'Canonical functions/src/shared/aiTaskContract.ts and frontend bridge src/types/aiTask.ts exist without duplicate declarations',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: canonicalExists && frontendBridgeClean,
      message: (canonicalExists && frontendBridgeClean)
        ? undefined
        : 'Canonical functions/src/shared/aiTaskContract.ts or frontend compatibility bridge src/types/aiTask.ts is missing or invalid',
    });

    if (canonicalExists) {
      const canonicalCode = fs.readFileSync(canonicalPath, 'utf8');
      const onlyContentReviewType =
        canonicalCode.includes("CONTENT_REVIEW: 'CONTENT_REVIEW'") &&
        !canonicalCode.includes('LIBRARY_INGEST') &&
        !canonicalCode.includes('MEDIA_SYNC') &&
        !canonicalCode.includes('SOURCE_DISCOVERY') &&
        Object.keys(CanonicalAITaskType).length === 1 &&
        CanonicalAITaskType.CONTENT_REVIEW === 'CONTENT_REVIEW';
      const runtimeStatuses = Object.keys(CanonicalAITaskStatus).sort();
      const onlyMinimalStatuses =
        canonicalCode.includes("Pending: 'Pending'") &&
        canonicalCode.includes("Completed: 'Completed'") &&
        canonicalCode.includes("Failed: 'Failed'") &&
        !canonicalCode.includes('InProgress') &&
        !canonicalCode.includes('Cancelled') &&
        !canonicalCode.includes('Queued') &&
        runtimeStatuses.length === 3 &&
        runtimeStatuses[0] === 'Completed' &&
        runtimeStatuses[1] === 'Failed' &&
        runtimeStatuses[2] === 'Pending';

      results.push({
        id: 'D_2',
        name: 'Canonical task types remain restricted (CONTENT_REVIEW only)',
        classification: 'STATIC_SOURCE_ASSERTION',
        passed: onlyContentReviewType,
        message: onlyContentReviewType ? undefined : 'Canonical task types have been altered',
      });

      results.push({
        id: 'D_3',
        name: 'Canonical status vocabulary remains minimal (Pending/Completed/Failed)',
        classification: 'STATIC_SOURCE_ASSERTION',
        passed: onlyMinimalStatuses,
        message: onlyMinimalStatuses ? undefined : 'Canonical status vocabulary has been altered',
      });

      const referenceIdentityIntact =
        FrontendAITaskType === CanonicalAITaskType &&
        ServerAITaskType === CanonicalAITaskType &&
        FrontendAITaskStatus === CanonicalAITaskStatus &&
        ServerAITaskStatus === CanonicalAITaskStatus &&
        FrontendAIReviewTargetType === CanonicalAIReviewTargetType;

      results.push({
        id: 'D_4',
        name: 'Runtime reference identity holds across canonical, server bridge, and frontend bridge',
        classification: 'UNIT_LOGIC_TEST',
        passed: referenceIdentityIntact,
        message: referenceIdentityIntact ? undefined : 'Reference identity mismatch between canonical, server, and frontend exports',
      });
    }

    // E. No legacy PEIA server runtime implementation was introduced
    const serverFilesCheck =
      !fs.existsSync(path.join(process.cwd(), 'functions/src/services/aiTaskService.ts')) &&
      !fs.existsSync(path.join(process.cwd(), 'functions/src/services/aiTaskRepository.ts')) &&
      !fs.existsSync(path.join(process.cwd(), 'functions/src/youtube/aiTaskHandler.ts'));

    // Check functions/src/index.ts
    const indexCode = fs.readFileSync(path.join(process.cwd(), 'functions/src/index.ts'), 'utf8');
    const indexClean = !indexCode.includes('aiTask') && !indexCode.includes('TaskService') && !indexCode.includes('TaskHandler');

    results.push({
      id: 'E',
      name: 'No PEIA server runtime services or handlers were introduced',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: serverFilesCheck && indexClean,
      message: (serverFilesCheck && indexClean) ? undefined : 'Premature runtime service, repository, or export found under functions/',
    });

    // F. No PEIA Firestore collection/rules were added
    const firestoreRules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
    const rulesClean = !firestoreRules.includes('aiTasks') && !firestoreRules.includes('ai_tasks');
    results.push({
      id: 'F',
      name: 'No PEIA Firestore collections or rules were defined',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: rulesClean,
      message: rulesClean ? undefined : 'Premature firestore.rules update detected',
    });

    // G. No worker-auth implementation was added
    const noWorkerAuthFiles =
      !fs.existsSync(path.join(process.cwd(), 'functions/src/auth/workerAuth.ts')) &&
      !fs.existsSync(path.join(process.cwd(), 'functions/src/youtube/workerAuth.ts'));
    results.push({
      id: 'G',
      name: 'No machine principal or worker auth helper was added',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: noWorkerAuthFiles,
      message: noWorkerAuthFiles ? undefined : 'Premature worker authentication modules detected',
    });

  } catch (err: any) {
    results.push({
      id: 'A',
      name: 'Server type bridge file functions/src/types/aiTask.ts exists',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  return results;
}

async function main() {
  console.log('====================================================');
  console.log('RUNNING PEIA SERVER TASK CONTRACT CONVERGENCE TESTS');
  console.log('====================================================\n');

  const results = runAITaskServerContractTests();
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
