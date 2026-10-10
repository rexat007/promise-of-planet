import {
  uploadNonAdvisoryOutcomeWithFetch,
  type NonAdvisoryOutcomeHttpFetchResponse,
} from '../peia-worker/src/nonAdvisoryOutcomeHttpReportTransport';
import { NonAdvisoryOutcomeKind } from '../peia-worker/src/localNonAdvisoryOutcomeContract';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running PEIA Non-Advisory Outcome HTTP Report Transport Tests ---');

const now = new Date().toISOString();
const validOutcome = {
  taskId: 'task-100',
  kind: NonAdvisoryOutcomeKind.INPUT_FAILURE,
  reason: 'MISSING_RETRIEVAL_QUERY',
  modelAttempts: 0,
  createdAt: now,
};

async function testSuccess() {
  const fetcher = async (url: string, init: any): Promise<NonAdvisoryOutcomeHttpFetchResponse> => {
    assert(url === 'https://api.example.com/report', 'Incorrect URL');
    assert(init.method === 'POST', 'Incorrect method');
    assert(init.headers.Authorization === 'Bearer secret', 'Incorrect auth header');
    return {
      status: 200,
      json: async () => ({ ok: true, taskId: 'task-100' }),
    };
  };

  const response = await uploadNonAdvisoryOutcomeWithFetch(
    { endpointUrl: 'https://api.example.com/report', credential: 'secret', outcome: validOutcome },
    fetcher
  );
  assert(response.ok === true, 'Response ok should be true');
  assert(response.taskId === 'task-100', 'Incorrect taskId');
}

await testSuccess();
console.log('PASSED: All Non-Advisory Outcome HTTP Report Transport tests passed.');
