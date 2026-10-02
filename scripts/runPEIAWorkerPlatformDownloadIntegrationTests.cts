import { executeFirebasePendingTaskHttpEndpoint, PendingTaskHttpResponseWriter } from '../functions/src/peia/firebasePendingTaskHttpEndpoint';
import { downloadPendingTaskWithFetch, PendingTaskHttpFetch, PendingTaskHttpFetchInit } from '../peia-worker/src/pendingTaskHttpDownloadTransport';
import { FirestoreTaskGatewayHandler } from '../functions/src/peia/firestoreTaskGatewayComposition';
import { PendingTaskGatewaySuccess } from '../functions/src/peia/taskGatewayContract';
import { MachineAuthorizationError } from '../functions/src/peia/machineAuthorizationBoundary';
import { AIReviewTask, AITaskType, AITaskStatus } from '../src/types/aiTask';
import { AIReviewTargetType } from '../src/types/aiReview';

// Fake gateway
const createFakeGateway = (result: PendingTaskGatewaySuccess | Error): FirestoreTaskGatewayHandler => {
  return async () => {
    if (result instanceof Error) throw result;
    return result;
  };
};

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !Object.prototype.hasOwnProperty.call(error, 'code')
  ) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');

  if (!descriptor || !('value' in descriptor)) {
    return undefined;
  }

  return typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function errorContainsSentinel(
  error: unknown,
  sentinel: string
): boolean {
  const parts: string[] = [String(error)];

  if (error instanceof Error) {
    parts.push(error.name, error.message);
  }

  const code = getErrorCode(error);
  if (code !== undefined) {
    parts.push(code);
  }

  return parts.some((part) => part.includes(sentinel));
}

// Integration Test Bridge
async function runTests() {
  const testResults: { name: string, passed: boolean }[] = [];
  const runTestCase = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); testResults.push({ name, passed: true }); console.log(`[PASS] ${name}`); }
    catch (e) { testResults.push({ name, passed: false }); console.error(`[FAIL] ${name}`, e); }
  };

  const sentinelCredential = 'peia_v1_0123456789012345678901234567890123456789012';

  const createBridge = (
    gateway: FirestoreTaskGatewayHandler, 
    onFetch?: (init: PendingTaskHttpFetchInit) => void,
    onBody?: (body: unknown) => void
  ) => {
    const fetcher: PendingTaskHttpFetch = async (url, init) => {
      if (onFetch) onFetch(init);
      let status = 0;
      let body: unknown = null;
      const writer: PendingTaskHttpResponseWriter = {
        setHeader: () => {},
        status: (s) => { status = s; return writer; },
        json: (b) => { 
          body = b; 
          if (onBody) onBody(b);
          return body; 
        }
      };
      
      await executeFirebasePendingTaskHttpEndpoint(
        { method: init.method, headers: { ...init.headers }, body: undefined },
        writer,
        { 
          createGateway: () => gateway, 
          executeRequest: require('../functions/src/peia/taskGatewayHttpRequestAdapter').executePendingTaskHttpRequest, 
          mapSuccess: require('../functions/src/peia/taskGatewayHttpResponseMapper').mapPendingTaskHttpSuccess, 
          mapError: require('../functions/src/peia/taskGatewayHttpResponseMapper').mapPendingTaskHttpError 
        }
      );
      
      return { status, json: async () => body };
    };
    return fetcher;
  };

  // 1. TASK_AVAILABLE
  await runTestCase("1. TASK_AVAILABLE ROUND TRIP", async () => {
    const task: AIReviewTask = {
      taskId: "t1",
      taskType: AITaskType.CONTENT_REVIEW,
      target: { targetType: AIReviewTargetType.News, targetId: "n1", sourceUpdatedAt: "2026-10-02T00:00:00Z" },
      contentSnapshot: { title: "T", body: "B" },
      createdAt: "2026-10-02T00:00:00Z",
      status: AITaskStatus.Pending
    };
    const bridge = createBridge(createFakeGateway({ principalId: "p1", task }));
    const result = await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    
    if (result.kind !== 'TASK_AVAILABLE' || result.value.principalId !== "p1" || result.value.task.taskId !== "t1" || 
        result.value.task.taskType !== AITaskType.CONTENT_REVIEW || result.value.task.status !== AITaskStatus.Pending ||
        result.value.task.target.targetType !== AIReviewTargetType.News || result.value.task.target.targetId !== "n1" ||
        result.value.task.target.sourceUpdatedAt !== "2026-10-02T00:00:00Z" || result.value.task.contentSnapshot.title !== "T" ||
        result.value.task.contentSnapshot.body !== "B" || result.value.task.createdAt !== "2026-10-02T00:00:00Z") throw new Error("Mismatch");
  });

  // 2. NO_TASK
  await runTestCase("2. NO_TASK ROUND TRIP", async () => {
    const bridge = createBridge(createFakeGateway({ principalId: "p1", task: null }));
    const result = await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    if (result.kind !== 'NO_TASK') throw new Error("Mismatch");
  });

  // 3. REQUEST CONTRACT
  await runTestCase("3. REQUEST CONTRACT", async () => {
    let capturedInit: PendingTaskHttpFetchInit | undefined;
    const bridge = createBridge(createFakeGateway({ principalId: "p1", task: null }), (init) => { capturedInit = init; });
    await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    
    if (!capturedInit) throw new Error("No init captured");
    if (capturedInit.method !== 'POST') throw new Error("Method not POST");
    if (capturedInit.headers.Authorization !== `Bearer ${sentinelCredential}`) throw new Error("Auth header mismatch");
    if (capturedInit.headers.Accept !== 'application/json') throw new Error("Accept header mismatch");
    if ('body' in capturedInit) throw new Error("Request must not have body");
  });

  // 4. 401 ROUND TRIP
  await runTestCase("4. 401 ROUND TRIP", async () => {
    const bridge = createBridge(createFakeGateway(new MachineAuthorizationError('MACHINE_UNAUTHENTICATED', 'Unauth')));
    let rejected = false;
    try {
      await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    } catch (error: unknown) {
      rejected = true;
      if (getErrorCode(error) !== 'REMOTE_REQUEST_REJECTED') {
        throw error instanceof Error ? error : new Error('Unexpected rejection value.');
      }
    }
    if (!rejected) throw new Error('Expected REMOTE_REQUEST_REJECTED.');
  });

  // 5. 403 ROUND TRIP
  await runTestCase("5. 403 ROUND TRIP", async () => {
    const bridge = createBridge(createFakeGateway(new MachineAuthorizationError('MACHINE_CAPABILITY_DENIED', 'Forbidden')));
    let rejected = false;
    try {
      await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    } catch (error: unknown) {
      rejected = true;
      if (getErrorCode(error) !== 'REMOTE_REQUEST_REJECTED') {
        throw error instanceof Error ? error : new Error('Unexpected rejection value.');
      }
    }
    if (!rejected) throw new Error('Expected REMOTE_REQUEST_REJECTED.');
  });

  // 6. CREDENTIAL NON-LEAKAGE
  await runTestCase("6. CREDENTIAL NON-LEAKAGE", async () => {
    let capturedBody: unknown;
    let rejected = false;
    const bridge = createBridge(createFakeGateway(new Error("Sentinel Error")), undefined, (b) => { capturedBody = b; });
    try {
      await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    } catch (error: unknown) {
      rejected = true;
      if (errorContainsSentinel(error, sentinelCredential)) throw new Error("Leaked in error");
      if (capturedBody === undefined) throw new Error("Server response body missing");
      if (JSON.stringify(capturedBody).includes(sentinelCredential)) throw new Error("Leaked in response body");
    }
    if (!rejected) throw new Error("Expected bridged failure.");
  });

  const passed = testResults.filter(r => r.passed).length;
  console.log(`SUMMARY: ${passed} / ${testResults.length} passed`);
  process.exit(passed === testResults.length ? 0 : 1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
