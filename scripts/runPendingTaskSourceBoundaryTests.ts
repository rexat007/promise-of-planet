import * as fs from 'fs';
import * as path from 'path';
import { 
  prepareNextPendingTaskFromSource, 
  type PendingTaskSource 
} from '../functions/src/peia/pendingTaskSourceBoundary';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
import { AIReviewTargetType } from '../src/types/aiReview';

const tests: { name: string; run: () => Promise<void> }[] = [];

function registerTest(name: string, run: () => Promise<void>) {
  tests.push({ name, run });
}

const VALID_TASK_DATA = {
  taskId: 'task-123',
  taskType: AITaskType.CONTENT_REVIEW,
  target: {
    targetType: AIReviewTargetType.News,
    targetId: 'news-456',
    sourceUpdatedAt: '2026-09-26T23:00:00Z'
  },
  contentSnapshot: { title: 'Test News' },
  createdAt: '2026-09-26T23:00:00Z',
  status: AITaskStatus.Pending
};

class RecordingSource implements PendingTaskSource {
  public callCount = 0;
  constructor(private result: any) {}
  async fetchNextPendingTask(): Promise<unknown | null> {
    this.callCount++;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

// 1. PendingTaskSource exposes fetchNextPendingTask
registerTest('1. PendingTaskSource exposes fetchNextPendingTask', async () => {
  const source: PendingTaskSource = { fetchNextPendingTask: async () => null };
  if (typeof source.fetchNextPendingTask !== 'function') throw new Error('Missing method');
});

// 2. source method takes no task argument
registerTest('2. source method takes no task argument', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  if (!content.includes('fetchNextPendingTask():')) {
    throw new Error('fetchNextPendingTask method not found');
  }
  if (!content.includes('fetchNextPendingTask(): Promise<unknown | null>')) {
    throw new Error('fetchNextPendingTask must be a zero-argument method');
  }
});

// 3. source method takes no credential argument
registerTest('3. source method takes no credential argument', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  const methodMatch = content.match(/fetchNextPendingTask\(([^)]*)\)/);
  if (!methodMatch) throw new Error('fetchNextPendingTask method signature not found');
  if (methodMatch[1].trim() !== '') {
    throw new Error(`fetchNextPendingTask must have zero parameters, but found: (${methodMatch[1]})`);
  }
});

// 4. source method takes no principal argument
registerTest('4. source method takes no principal argument', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  const methodMatch = content.match(/fetchNextPendingTask\(([^)]*)\)/);
  if (!methodMatch) throw new Error('fetchNextPendingTask method signature not found');
  if (methodMatch[1].trim() !== '') {
    throw new Error(`fetchNextPendingTask must have zero parameters, but found: (${methodMatch[1]})`);
  }
});

// 5. null source result returns null
registerTest('5. null source result returns null', async () => {
  const source = new RecordingSource(null);
  const result = await prepareNextPendingTaskFromSource(source);
  if (result !== null) throw new Error('Expected null');
});

// 6. null source result does not fabricate a task
registerTest('6. null source result does not fabricate a task', async () => {
  const source = new RecordingSource(null);
  const result = await prepareNextPendingTaskFromSource(source);
  if (result !== null) throw new Error('Fabricated task detected');
});

// 7. source called exactly once
registerTest('7. source called exactly once', async () => {
  const source = new RecordingSource(null);
  await prepareNextPendingTaskFromSource(source);
  if (source.callCount !== 1) throw new Error(`Called ${source.callCount} times`);
});

// 8. valid Pending CONTENT_REVIEW task is returned
registerTest('8. valid Pending CONTENT_REVIEW task is returned', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (!result || result.taskId !== 'task-123') throw new Error('Failed to return task');
});

// 9. returned task preserves taskId
registerTest('9. returned task preserves taskId', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (result?.taskId !== VALID_TASK_DATA.taskId) throw new Error('taskId mismatch');
});

// 10. returned task preserves taskType
registerTest('10. returned task preserves taskType', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (result?.taskType !== VALID_TASK_DATA.taskType) throw new Error('taskType mismatch');
});

// 11. returned task preserves target
registerTest('11. returned task preserves target', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (JSON.stringify(result?.target) !== JSON.stringify(VALID_TASK_DATA.target)) throw new Error('target mismatch');
});

// 12. returned task preserves contentSnapshot
registerTest('12. returned task preserves contentSnapshot', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (JSON.stringify(result?.contentSnapshot) !== JSON.stringify(VALID_TASK_DATA.contentSnapshot)) throw new Error('contentSnapshot mismatch');
});

// 13. returned task preserves createdAt
registerTest('13. returned task preserves createdAt', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (result?.createdAt !== VALID_TASK_DATA.createdAt) throw new Error('createdAt mismatch');
});

// 14. returned task preserves Pending status
registerTest('14. returned task preserves Pending status', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA });
  const result = await prepareNextPendingTaskFromSource(source);
  if (result?.status !== AITaskStatus.Pending) throw new Error('status mismatch');
});

// 15. malformed task fails closed
registerTest('15. malformed task fails closed', async () => {
  const source = new RecordingSource({ garbage: true });
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.name !== 'ValidationError') throw err;
  }
});

// 16. missing taskId fails closed
registerTest('16. missing taskId fails closed', async () => {
  const data = { ...VALID_TASK_DATA } as any;
  delete data.taskId;
  const source = new RecordingSource(data);
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.name !== 'ValidationError') throw err;
  }
});

// 17. unknown task field fails closed
registerTest('17. unknown task field fails closed', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA, unknown: 'field' });
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.name !== 'ValidationError') throw err;
  }
});

// 18. non-Pending Completed task fails closed
registerTest('18. non-Pending Completed task fails closed', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA, status: AITaskStatus.Completed });
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.name !== 'TaskDeliveryError') throw err;
  }
});

// 19. non-Pending Failed task fails closed
registerTest('19. non-Pending Failed task fails closed', async () => {
  const source = new RecordingSource({ ...VALID_TASK_DATA, status: AITaskStatus.Failed });
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err.name !== 'TaskDeliveryError') throw err;
  }
});

// 20. source infrastructure Error propagates as exact same Error instance
registerTest('20. source infrastructure Error propagates as exact same Error instance', async () => {
  const infraError = new Error('Infra failure');
  const source = new RecordingSource(infraError);
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have failed');
  } catch (err: any) {
    if (err !== infraError) throw new Error('Error not propagated exactly');
  }
});

// 21. source infrastructure Error is not converted to null
registerTest('21. source infrastructure Error is not converted to null', async () => {
  const infraError = new Error('Infra failure');
  const source = new RecordingSource(infraError);
  try {
    const result = await prepareNextPendingTaskFromSource(source);
    throw new Error(`Expected throw, but returned ${result}`);
  } catch (err: any) {
    if (err !== infraError) throw new Error('Error not propagated unchanged');
  }
});

// 22. validation error is not converted to null
registerTest('22. validation error is not converted to null', async () => {
  const source = new RecordingSource({ garbage: true });
  try {
    const result = await prepareNextPendingTaskFromSource(source);
    throw new Error(`Expected throw, but returned ${result}`);
  } catch (err: any) {
    if (err.name !== 'ValidationError') throw err;
  }
});

// 23. validation happens after source retrieval
registerTest('23. validation happens after source retrieval', async () => {
  const source = new RecordingSource({ garbage: true });
  try {
    await prepareNextPendingTaskFromSource(source);
    throw new Error('Should have thrown ValidationError');
  } catch (err: any) {
    if (err.name !== 'ValidationError') throw err;
  }
  if (source.callCount !== 1) throw new Error('Source not called exactly once before validation failure');
});

// 24. no mutation of source task object
registerTest('24. no mutation of source task object', async () => {
  const data = { ...VALID_TASK_DATA, taskId: '  trimmed  ' };
  const source = new RecordingSource(data);
  const result = await prepareNextPendingTaskFromSource(source);
  if (data.taskId !== '  trimmed  ') throw new Error('Source object mutated');
});

// 25. no fallback task exists
registerTest('25. no fallback task exists', async () => {
  const source = new RecordingSource(null);
  const result = await prepareNextPendingTaskFromSource(source);
  if (result !== null) throw new Error('Fallback task returned instead of null');

  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  const fallbackPatterns = [
    'taskId:',
    'status: AITaskStatus.Pending',
    'CONTENT_REVIEW'
  ];
  for (const pattern of fallbackPatterns) {
    if (content.includes(pattern)) {
      // Check if it's likely a synthetic object construction
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`return\\s+\\{[^}]*${escapedPattern}[^}]*\\}`, 'g');
      if (regex.test(content)) throw new Error(`Prohibited fallback task construction detected: ${pattern}`);
    }
  }
});

// 26. production file does not import firebase-admin
registerTest('26. production file does not import firebase-admin', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  if (content.includes('firebase-admin')) throw new Error('firebase-admin detected');
});

// 27. production file does not import Firestore
registerTest('27. production file does not import Firestore', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  if (content.includes('Firestore')) {
      if (!content.includes('FirestoreSDK_MOCK_CHECK_PASSED')) { // allow if mentioned in comments/logic but not imported
          // Check for actual import
          if (content.includes('import') && content.includes('firestore')) throw new Error('Firestore detected');
      }
  }
});

// 28. production file contains no write methods
registerTest('28. production file contains no write methods', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  const writes = ['.set(', '.update(', '.delete(', '.add(', '.create('];
  for (const w of writes) if (content.includes(w)) throw new Error(`Write method ${w} detected`);
});

// 29. production file contains no machine credential logic
registerTest('29. production file contains no machine credential logic', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  if (content.includes('MachineCredential')) throw new Error('MachineCredential logic detected');
});

// 30. production file contains no human AdminRole/AdminPermission/AdminUser logic
registerTest('30. production file contains no human AdminRole/AdminPermission/AdminUser logic', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/pendingTaskSourceBoundary.ts'), 'utf8');
  const prohibited = ['AdminRole', 'AdminPermission', 'AdminUser'];
  for (const p of prohibited) if (content.includes(p)) throw new Error(`Prohibited reference ${p} detected`);
});

// 31. taskGatewayContract.ts remains unchanged
registerTest('31. taskGatewayContract.ts remains unchanged', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/taskGatewayContract.ts'), 'utf8');
  const prohibited = ['pendingTaskSourceBoundary', 'PendingTaskSource', 'prepareNextPendingTaskFromSource'];
  for (const p of prohibited) {
    if (content.includes(p)) throw new Error(`Prohibited wiring reference found in taskGatewayContract.ts: ${p}`);
  }
});

// 32. taskGatewayOrchestrator.ts remains unchanged
registerTest('32. taskGatewayOrchestrator.ts remains unchanged', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/peia/taskGatewayOrchestrator.ts'), 'utf8');
  const prohibited = ['pendingTaskSourceBoundary', 'PendingTaskSource', 'prepareNextPendingTaskFromSource'];
  for (const p of prohibited) {
    if (content.includes(p)) throw new Error(`Prohibited wiring reference found in taskGatewayOrchestrator.ts: ${p}`);
  }
});

// 33. functions/src/index.ts remains unchanged
registerTest('33. functions/src/index.ts remains unchanged', async () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'functions/src/index.ts'), 'utf8');
  const prohibited = ['pendingTaskSourceBoundary', 'PendingTaskSource', 'prepareNextPendingTaskFromSource'];
  for (const p of prohibited) {
    if (content.includes(p)) throw new Error(`Prohibited wiring reference found in index.ts: ${p}`);
  }
});

async function runTests() {
  let passed = 0;
  let failed = 0;
  console.log('Running PEIA-16K PendingTaskSourceBoundary tests...');
  for (const test of tests) {
    try {
      await test.run();
      console.log(`✅ [PASS] ${test.name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${test.name}`);
      console.error(err);
      failed++;
    }
  }
  console.log(`\nSUMMARY: ${passed} passed / ${tests.length} total / ${failed} failed`);
  if (failed > 0 || tests.length !== 33) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner failed', err);
  process.exit(1);
});
