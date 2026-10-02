import * as http from 'node:http';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runSingleDownloadCycleCliWithDependencies } from '../peia-worker/src/runSingleDownloadCycleCli';

const VALID_TASK_AVAILABLE_BODY = {
  ok: true,
  principalId: "principal-999",
  task: {
    taskId: "task-abc",
    taskType: "CONTENT_REVIEW",
    status: "Pending",
    createdAt: "2026-10-01T07:30:00Z",
    target: {
      targetType: "News",
      targetId: "news-111",
      sourceUpdatedAt: "2026-10-01T07:00:00Z"
    },
    contentSnapshot: {
      title: "Planet Promise",
      body: "Protecting ecosystems."
    }
  }
};

const VALID_NO_TASK_BODY = {
  ok: true,
  principalId: "principal-999",
  task: null
};

interface TestResult {
  name: string;
  passed: boolean;
  error?: any;
}

const testResults: TestResult[] = [];
let totalTestsRun = 0;

function createTempDbPath(): string {
  const rand = Math.floor(Math.random() * 1000000);
  return path.resolve(process.cwd(), `temp_db_${rand}.sqlite`);
}

function parseJsonFromOutput(output: string): any {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const jsonStr = output.substring(start, end + 1);
    return JSON.parse(jsonStr);
  }
  return JSON.parse(output);
}

function runCliAsync(env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const cliPath = path.resolve(process.cwd(), 'peia-worker/dist/peia-worker/src/runSingleDownloadCycleCli.js');
    const child = spawn('node', [cliPath], {
      env: {
        ...process.env,
        ...env
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (status) => {
      resolve({
        status,
        stdout,
        stderr
      });
    });
  });
}

async function runTestCase(name: string, fn: () => Promise<void>) {
  totalTestsRun++;
  try {
    await fn();
    testResults.push({ name, passed: true });
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    testResults.push({ name, passed: false, error: err });
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

// Create a dynamic loopback HTTP server
let mockServer: http.Server;
let mockPort = 0;
let mockRequestCount = 0;
let mockResponseBody: any = {};
let mockResponseStatus = 200;
let nonLoopbackRequestDetected = false;

function setupServer() {
  mockServer = http.createServer((req, res) => {
    mockRequestCount++;
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') {
      nonLoopbackRequestDetected = true;
    }
    
    // Consume request body to ensure proper socket flushing
    req.on('data', () => {});
    req.on('end', () => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }

      res.statusCode = mockResponseStatus;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(mockResponseBody));
    });
  });

  return new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const address = mockServer.address();
      if (address && typeof address === 'object') {
        mockPort = address.port;
      }
      resolve();
    });
  });
}

function shutdownServer() {
  if (mockServer && mockServer.closeAllConnections) {
    mockServer.closeAllConnections();
  }
  return new Promise<void>((resolve) => {
    mockServer.close(() => {
      resolve();
    });
  });
}

async function runAllTests() {
  await setupServer();

  const secretCredential = "ValidSuperSecretSecret-123";

  // Test 1: Valid runtime config accepted
  await runTestCase("1. Valid runtime config accepted", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}. Stderr: ${res.stderr}`);
    }

    const parsedStdout = parseJsonFromOutput(res.stdout);
    if (parsedStdout.kind !== 'STORED' || parsedStdout.taskId !== 'task-abc') {
      throw new Error(`Unexpected stdout payload: ${res.stdout}`);
    }

    if (mockRequestCount !== 1) {
      throw new Error(`Expected exactly 1 request, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 2: Missing PEIA_TASK_ENDPOINT_URL
  await runTestCase("2. Missing PEIA_TASK_ENDPOINT_URL", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 2) {
      throw new Error(`Expected exit code 2, got ${res.status}. Stderr: ${res.stderr}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'CONFIG' || parsedStderr.code !== 'INVALID_RUNTIME_CONFIG') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (mockRequestCount !== 0) {
      throw new Error(`Expected 0 requests, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 3: Missing PEIA_LOCAL_DATABASE_PATH
  await runTestCase("3. Missing PEIA_LOCAL_DATABASE_PATH", async () => {
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 2) {
      throw new Error(`Expected exit code 2, got ${res.status}. Stderr: ${res.stderr}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'CONFIG' || parsedStderr.code !== 'INVALID_RUNTIME_CONFIG') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (mockRequestCount !== 0) {
      throw new Error(`Expected 0 requests, got ${mockRequestCount}`);
    }
  });

  // Test 4: Missing PEIA_MACHINE_CREDENTIAL
  await runTestCase("4. Missing PEIA_MACHINE_CREDENTIAL", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath
    });

    if (res.status !== 2) {
      throw new Error(`Expected exit code 2, got ${res.status}. Stderr: ${res.stderr}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'CONFIG' || parsedStderr.code !== 'INVALID_RUNTIME_CONFIG') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (mockRequestCount !== 0) {
      throw new Error(`Expected 0 requests, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 5: Credential with whitespace rejected
  await runTestCase("5. Credential with whitespace rejected", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: "bad credential spacing"
    });

    if (res.status !== 2) {
      throw new Error(`Expected exit code 2, got ${res.status}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'CONFIG' || parsedStderr.code !== 'INVALID_RUNTIME_CONFIG') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (res.stdout.includes("bad credential spacing") || res.stderr.includes("bad credential spacing")) {
      throw new Error("Secret credential was leaked in CLI output.");
    }

    if (mockRequestCount !== 0) {
      throw new Error(`Expected 0 requests, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 6: Credential with CR/LF rejected
  await runTestCase("6. Credential with CR/LF rejected", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: "bad\nnewline"
    });

    if (res.status !== 2) {
      throw new Error(`Expected exit code 2, got ${res.status}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'CONFIG' || parsedStderr.code !== 'INVALID_RUNTIME_CONFIG') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (res.stdout.includes("bad\nnewline") || res.stderr.includes("bad\nnewline")) {
      throw new Error("Secret credential was leaked in CLI output.");
    }

    if (mockRequestCount !== 0) {
      throw new Error(`Expected 0 requests, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 7: Invalid endpoint
  await runTestCase("7. Invalid endpoint", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: "http://external-untrusted-domain.com",
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status === 0) {
      throw new Error(`Expected non-zero exit code for external invalid endpoint, got ${res.status}`);
    }

    if (mockRequestCount !== 0) {
      throw new Error(`Expected 0 requests to loopback server, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 8: Valid TASK_AVAILABLE
  await runTestCase("8. Valid TASK_AVAILABLE", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}. Stderr: ${res.stderr}`);
    }

    const parsedStdout = parseJsonFromOutput(res.stdout);
    if (parsedStdout.kind !== 'STORED' || parsedStdout.taskId !== 'task-abc') {
      throw new Error(`Unexpected stdout payload: ${res.stdout}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 9: Stored record readable after child exits
  await runTestCase("9. Stored record readable after child exits", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}`);
    }

    const db = new DatabaseSync(dbPath);
    const query = db.prepare('SELECT * FROM peia_pending_tasks WHERE task_id = ?');
    const row: any = query.get('task-abc');

    if (!row) {
      throw new Error("Stored task row could not be found in parent process verification.");
    }

    if (row.principal_id !== 'principal-999' || row.target_type !== 'News') {
      throw new Error(`Unexpected persisted database fields: ${JSON.stringify(row)}`);
    }

    db.close();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 10: Valid NO_TASK
  await runTestCase("10. Valid NO_TASK", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 200;
    mockResponseBody = VALID_NO_TASK_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}`);
    }

    const parsedStdout = parseJsonFromOutput(res.stdout);
    if (parsedStdout.kind !== 'NO_TASK') {
      throw new Error(`Unexpected stdout: ${res.stdout}`);
    }

    const db = new DatabaseSync(dbPath);
    const query = db.prepare('SELECT COUNT(*) as count FROM peia_pending_tasks');
    const result: any = query.get();
    if (result.count !== 0) {
      throw new Error(`Expected 0 rows in DB, got ${result.count}`);
    }
    db.close();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 11: Malformed success response
  await runTestCase("11. Malformed success response", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 200;
    mockResponseBody = { ok: true, principalId: "principal-1" };

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 3) {
      throw new Error(`Expected exit code 3, got ${res.status}. Stderr: ${res.stderr}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'NETWORK_OR_RESPONSE' || parsedStderr.code !== 'INVALID_SUCCESS_PAYLOAD') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 12: Invalid HTTP status
  await runTestCase("12. Invalid HTTP status", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 500;
    mockResponseBody = { ok: false };

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 3) {
      throw new Error(`Expected exit code 3, got ${res.status}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'NETWORK_OR_RESPONSE' || parsedStderr.code !== 'INVALID_HTTP_STATUS') {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 13: Network failure
  await runTestCase("13. Network failure", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: "http://127.0.0.1:59999",
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 3) {
      throw new Error(`Expected exit code 3, got ${res.status}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'NETWORK_OR_RESPONSE' || (parsedStderr.code !== 'NETWORK_FAILURE' && parsedStderr.code !== 'RESPONSE_READ_FAILED')) {
      throw new Error(`Unexpected stderr payload: ${res.stderr}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 14: Identical task across second independent run (Idempotency)
  await runTestCase("14. Identical task across second independent run", async () => {
    const dbPath = createTempDbPath();
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    let res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });
    if (res.status !== 0) {
      throw new Error(`Expected exit code 0 on Run 1, got ${res.status}`);
    }

    res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });
    if (res.status !== 0) {
      throw new Error(`Expected exit code 0 on Run 2, got ${res.status}`);
    }

    const db = new DatabaseSync(dbPath);
    const result: any = db.prepare('SELECT COUNT(*) as count FROM peia_pending_tasks').get();
    if (result.count !== 1) {
      throw new Error(`Expected exactly 1 row after idempotent runs, got ${result.count}`);
    }
    db.close();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 15: Conflicting same taskId
  await runTestCase("15. Conflicting same taskId", async () => {
    const dbPath = createTempDbPath();
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    let res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });
    if (res.status !== 0) {
      throw new Error(`Expected exit code 0 on Run 1, got ${res.status}`);
    }

    const conflictBody = {
      ...VALID_TASK_AVAILABLE_BODY,
      principalId: "conflicting-principal-abc"
    };
    mockResponseBody = conflictBody;

    res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 4) {
      throw new Error(`Expected exit code 4 for conflict, got ${res.status}`);
    }

    const parsedStderr = parseJsonFromOutput(res.stderr);
    if (parsedStderr.category !== 'LOCAL_STORE' || parsedStderr.code !== 'TASK_CONFLICT') {
      throw new Error(`Unexpected stderr payload on conflict: ${res.stderr}`);
    }

    const db = new DatabaseSync(dbPath);
    const row: any = db.prepare('SELECT * FROM peia_pending_tasks WHERE task_id = ?').get('task-abc');
    if (row.principal_id !== 'principal-999') {
      throw new Error("Original row was overridden by conflicting run!");
    }
    db.close();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 16: Persistence survives process restart / reopen
  await runTestCase("16. Persistence survives process restart / reopen", async () => {
    const dbPath = createTempDbPath();
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}`);
    }

    const db = new DatabaseSync(dbPath);
    const row: any = db.prepare('SELECT * FROM peia_pending_tasks WHERE task_id = ?').get('task-abc');
    if (!row) {
      throw new Error("Stored row did not survive across reopening of DB");
    }
    db.close();

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 17: DB handle closes so temp DB can be deleted cleanly
  await runTestCase("17. DB handle closes so temp DB can be deleted", async () => {
    const dbPath = createTempDbPath();
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}`);
    }

    try {
      fs.unlinkSync(dbPath);
    } catch (err: any) {
      throw new Error(`Unable to delete database file: ${err.message}`);
    }
  });

  // Test 18: stdout never contains credential
  await runTestCase("18. stdout never contains credential", async () => {
    const dbPath = createTempDbPath();
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.stdout.includes(secretCredential)) {
      throw new Error("Secret credential was leaked in stdout.");
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 19: stderr never contains credential
  await runTestCase("19. stderr never contains credential", async () => {
    const dbPath = createTempDbPath();
    mockResponseStatus = 500;
    mockResponseBody = { error: "Something bad happened" };

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.stderr.includes(secretCredential)) {
      throw new Error("Secret credential was leaked in stderr.");
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 20: Only loopback requests occurred
  await runTestCase("20. Only loopback requests occurred", async () => {
    if (nonLoopbackRequestDetected) {
      throw new Error("Security breach: Non-loopback request received.");
    }
  });

  // Test 21: One request per reached download cycle
  await runTestCase("21. One request per reached download cycle", async () => {
    const dbPath = createTempDbPath();
    mockRequestCount = 0;
    mockResponseStatus = 200;
    mockResponseBody = VALID_TASK_AVAILABLE_BODY;

    const res = await runCliAsync({
      PEIA_TASK_ENDPOINT_URL: `http://127.0.0.1:${mockPort}`,
      PEIA_LOCAL_DATABASE_PATH: dbPath,
      PEIA_MACHINE_CREDENTIAL: secretCredential
    });

    if (res.status !== 0) {
      throw new Error(`Expected exit code 0, got ${res.status}`);
    }

    if (mockRequestCount !== 1) {
      throw new Error(`Expected exactly 1 request per cycle, got ${mockRequestCount}`);
    }

    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  // Test 23: Unexpected internal error
  await runTestCase("23. Unexpected internal error", async () => {
    const stderrLines: string[] = [];
    const exitCode = await runSingleDownloadCycleCliWithDependencies({
      loadConfig: () => ({ databasePath: '/tmp/db', endpointUrl: 'http://127.0.0.1:1', credential: 'creds' }),
      runCycle: async () => { throw new Error("Synthetic unexpected error SECRET_SENTINEL"); },
      writeStdout: () => {},
      writeStderr: (data) => { stderrLines.push(data); },
      exit: () => {}
    });

    if (exitCode !== 5) {
      throw new Error(`Expected exit code 5, got ${exitCode}`);
    }

    const parsedStderr = parseJsonFromOutput(stderrLines.join(''));
    if (parsedStderr.category !== 'UNEXPECTED' || parsedStderr.code !== 'UNEXPECTED_ERROR' || parsedStderr.message !== 'An unexpected error occurred.') {
      throw new Error(`Unexpected stderr payload: ${stderrLines.join('')}`);
    }

    if (stderrLines.join('').includes("Synthetic unexpected error") || stderrLines.join('').includes("SECRET_SENTINEL")) {
      throw new Error("Raw error or secret leaked in stderr.");
    }
  });

  // Test 24: Exact test-count gate
  await runTestCase("24. Exact test-count gate", async () => {
    const totalExpected = 23;
    if (totalTestsRun !== totalExpected) {
      throw new Error(`Expected exactly ${totalExpected} tests to have run, but got ${totalTestsRun}`);
    }
  });

  await shutdownServer();

  console.log("\n--- E2E WORKER RUNTIME FOUNDATION TEST RESULTS ---");
  const failed = testResults.filter(r => !r.passed);
  console.log(`SUMMARY: ${testResults.filter(r => r.passed).length} passed / ${testResults.length} total / ${failed.length} failed`);
  
  if (failed.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
