import { executeFirebasePendingTaskHttpEndpoint, PendingTaskHttpResponseWriter } from '../functions/src/peia/firebasePendingTaskHttpEndpoint';
import { downloadPendingTaskWithFetch, PendingTaskHttpFetch } from '../peia-worker/src/pendingTaskHttpDownloadTransport';
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

// Integration Test Bridge
async function runTests() {
  const testResults: { name: string, passed: boolean }[] = [];
  const runTestCase = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); testResults.push({ name, passed: true }); console.log(`[PASS] ${name}`); }
    catch (e) { testResults.push({ name, passed: false }); console.error(`[FAIL] ${name}`, e); }
  };

  const sentinelCredential = 'peia_v1_0123456789012345678901234567890123456789012';

  const createBridge = (gateway: FirestoreTaskGatewayHandler) => {
    const fetcher: PendingTaskHttpFetch = async (url, init) => {
      let status = 0;
      let body: any = null;
      const writer: PendingTaskHttpResponseWriter = {
        setHeader: () => {},
        status: (s) => { status = s; return writer; },
        json: (b) => { body = b; return body; }
      };
      
      await executeFirebasePendingTaskHttpEndpoint(
        { method: init.method, headers: init.headers, body: undefined },
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
    
    if (result.kind !== 'TASK_AVAILABLE' || result.value.principalId !== "p1" || result.value.task.taskId !== "t1") throw new Error("Mismatch");
  });

  // 2. NO_TASK
  await runTestCase("2. NO_TASK ROUND TRIP", async () => {
    const bridge = createBridge(createFakeGateway({ principalId: "p1", task: null }));
    const result = await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    if (result.kind !== 'NO_TASK') throw new Error("Mismatch");
  });

  // 3. REQUEST CONTRACT
  await runTestCase("3. REQUEST CONTRACT", async () => {
    let capturedInit: any;
    const bridge: PendingTaskHttpFetch = async (url, init) => { capturedInit = init; return { status: 200, json: async () => ({ ok: true, principalId: 'p', task: null }) } as any; };
    await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    if (capturedInit.method !== 'POST' || capturedInit.headers['Authorization'] !== `Bearer ${sentinelCredential}` || capturedInit.headers['Accept'] !== 'application/json') throw new Error("Contract mismatch");
  });

  // 4. 401 ROUND TRIP
  await runTestCase("4. 401 ROUND TRIP", async () => {
    const bridge = createBridge(createFakeGateway(new MachineAuthorizationError('MACHINE_UNAUTHENTICATED', 'Unauth')));
    try {
      await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
      throw new Error("Expected 401");
    } catch (e: any) { if (e.code !== 'REMOTE_REQUEST_REJECTED') throw e; }
  });

  // 5. 403 ROUND TRIP
  await runTestCase("5. 403 ROUND TRIP", async () => {
    const bridge = createBridge(createFakeGateway(new MachineAuthorizationError('MACHINE_CAPABILITY_DENIED', 'Forbidden')));
    try {
      await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
      throw new Error("Expected 403");
    } catch (e: any) { if (e.code !== 'REMOTE_REQUEST_REJECTED') throw e; }
  });

  // 6. CREDENTIAL NON-LEAKAGE
  await runTestCase("6. CREDENTIAL NON-LEAKAGE", async () => {
    const bridge = createBridge(createFakeGateway(new Error("Sentinel Error")));
    try {
      await downloadPendingTaskWithFetch({ endpointUrl: 'http://localhost:1', credential: sentinelCredential }, bridge);
    } catch (e: any) {
      const errStr = JSON.stringify(e);
      if (errStr.includes(sentinelCredential)) throw new Error("Leaked");
    }
  });

  const passed = testResults.filter(r => r.passed).length;
  console.log(`SUMMARY: ${passed} / ${testResults.length} passed`);
  process.exit(passed === testResults.length ? 0 : 1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
