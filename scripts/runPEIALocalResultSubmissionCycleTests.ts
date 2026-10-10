import { runResultSubmissionCycle } from '../peia-worker/src/localResultSubmissionCycle';
import { TaskProcessingState } from '../peia-worker/src/localTaskProcessingLifecycleContract';
import { NonAdvisoryOutcomeKind } from '../peia-worker/src/localNonAdvisoryOutcomeContract';

const mockLifecycleRepository = {
    records: new Map<string, any>(),
    listResumableRecords: async () => Array.from(mockLifecycleRepository.records.values()),
    transitionState: async (taskId: string, state: any) => {
        const record = mockLifecycleRepository.records.get(taskId);
        if (!record) throw new Error('Task not found');
        record.state = state;
        return record;
    },
};

const mockOutboxRepository = {
    records: new Map<string, any>(),
    findByTaskId: async (taskId: string) => mockOutboxRepository.records.get(taskId) || null,
};

const mockOutcomeRepository = {
    records: new Map<string, any>(),
    findByTaskId: async (taskId: string) => mockOutcomeRepository.records.get(taskId) || null,
};

function reset() {
    mockLifecycleRepository.records.clear();
    mockOutboxRepository.records.clear();
    mockOutcomeRepository.records.clear();
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name: string, fn: () => Promise<void>) {
    totalTests++;
    reset();
    try {
        await fn();
        console.log(`[PASS] ${name}`);
        passedTests++;
    } catch (e) {
        failedTests++;
        console.error(`[FAIL] ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// Helper to add records
function addLifecycle(taskId: string, state: any, terminalOutcome: any = null, attempts: number = 0) {
    mockLifecycleRepository.records.set(taskId, {
        taskId,
        state,
        modelAttempts: attempts,
        terminalOutcome,
        updatedAt: '2026-10-10T02:00:00Z',
    });
}

function addOutbox(taskId: string) {
    mockOutboxRepository.records.set(taskId, {
        result: {
            schemaVersion: 1,
            task: {
                taskId,
                taskType: 'CONTENT_REVIEW',
                target: { targetType: 'News', targetId: 'id', sourceUpdatedAt: '2026-10-10' },
            },
            humanReviewRequired: true,
            assessment: { summary: 'Summary text', findings: [] },
            recommendations: [],
            uncertainties: [],
            limitations: [],
        },
        localState: 'PendingUpload',
    });
}

function addOutcome(taskId: string, kind: any, attempts: number = 0) {
    const outcome: any = {
        taskId,
        kind,
        reason: kind === 'MODEL_FAILURE' ? 'TIMEOUT' : 'NO_EVIDENCE',
        modelAttempts: attempts,
        createdAt: '2026-10-10T02:00:00Z',
    };
    if (kind === 'RETRIEVAL_FAILURE') {
        outcome.reason = 'TOTAL_RETRIEVAL_FAILURE';
        outcome.sourceFailures = [
            { sourceId: 'EPA', errorCode: 'TRANSPORT_FAILURE' },
            { sourceId: 'NOAA', errorCode: 'INVALID_SOURCE_RESPONSE' },
        ];
    } else if (kind === 'INPUT_FAILURE') {
        outcome.reason = 'MISSING_RETRIEVAL_QUERY';
    }
    mockOutcomeRepository.records.set(taskId, outcome);
}

console.log('--- Running PEIA Local Result Submission Cycle Tests ---');

// ADVISORY (9 tests)
await test('ADVISORY: success → COMPLETED', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => ({ kind: 'ACCEPTED', value: { ok: true, taskId: 't1' } }),
    });
    if (res[0].status !== 'COMPLETED' || mockLifecycleRepository.records.get('t1').state !== TaskProcessingState.COMPLETED) {
        throw new Error('Failed to transition to COMPLETED');
    }
});

await test('ADVISORY: payload retained', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => ({ kind: 'ACCEPTED', value: { ok: true, taskId: 't1' } }),
    });
    if (!mockOutboxRepository.records.has('t1')) {
        throw new Error('Payload deleted from outbox');
    }
});

await test('ADVISORY: missing outbox', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') {
        throw new Error('Expected LOCAL_INCONSISTENCY');
    }
});

await test('ADVISORY: invalid stored advisory', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    mockOutboxRepository.records.set('t1', { result: { schemaVersion: 999 }, localState: 'PendingUpload' });
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') {
        throw new Error('Expected LOCAL_INCONSISTENCY');
    }
});

await test('ADVISORY: taskId mismatch', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    mockOutboxRepository.records.set('t1', {
        result: {
            schemaVersion: 1,
            task: { taskId: 'different-task', taskType: 'CONTENT_REVIEW', target: { targetType: 'News', targetId: 'id', sourceUpdatedAt: '2026-10-10' } },
            humanReviewRequired: true,
            assessment: { summary: 'Summary text', findings: [] },
            recommendations: [],
            uncertainties: [],
            limitations: [],
        },
        localState: 'PendingUpload',
    });
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') {
        throw new Error('Expected LOCAL_INCONSISTENCY');
    }
});

await test('ADVISORY: network failure', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => { throw new Error('Network error'); },
    });
    if (res[0].status !== 'SUBMISSION_FAILED' || mockLifecycleRepository.records.get('t1').state !== TaskProcessingState.ADVISORY_PENDING_UPLOAD) {
        throw new Error('Failed to handle network failure');
    }
});

await test('ADVISORY: wrong ACK taskId', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => ({ kind: 'ACCEPTED', value: { ok: true, taskId: 'wrong-task' } }),
    });
    if (res[0].status !== 'SUBMISSION_FAILED') {
        throw new Error('Expected SUBMISSION_FAILED for wrong ACK taskId');
    }
});

await test('ADVISORY: transition failure after ACK', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    const repo = {
        ...mockLifecycleRepository,
        transitionState: async () => { throw new Error('Database failure'); },
    };
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: repo as any,
        uploadAdvisory: async () => ({ kind: 'ACCEPTED', value: { ok: true, taskId: 't1' } }),
    });
    if (res[0].status !== 'SUBMISSION_FAILED') {
        throw new Error('Expected SUBMISSION_FAILED on transition error');
    }
});

await test('ADVISORY: true lost-response replay', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    let uploadCallCount = 0;
    const uploadAdvisory = async () => {
        uploadCallCount++;
        return { kind: 'ACCEPTED', value: { ok: true, taskId: 't1' } };
    };

    let transitionAttempts = 0;
    const repo = {
        ...mockLifecycleRepository,
        transitionState: async (taskId: string, state: any) => {
            transitionAttempts++;
            if (transitionAttempts === 1) {
                throw new Error('Simulated DB crash before local transition');
            }
            return mockLifecycleRepository.transitionState(taskId, state);
        },
    };

    // Run 1: server accepts, local transition throws
    const res1 = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: repo as any,
        uploadAdvisory,
    });
    if (res1[0].status !== 'SUBMISSION_FAILED') throw new Error(`Run 1 expected SUBMISSION_FAILED, got ${res1[0].status}`);
    if (mockLifecycleRepository.records.get('t1').state !== TaskProcessingState.ADVISORY_PENDING_UPLOAD) {
        throw new Error('Run 1 lifecycle must remain ADVISORY_PENDING_UPLOAD');
    }
    if (!mockOutboxRepository.records.has('t1')) throw new Error('Run 1 outbox payload must be retained');
    if (uploadCallCount !== 1) throw new Error(`Run 1 expected uploadCallCount === 1, got ${uploadCallCount}`);

    // Run 2: replay, transition succeeds
    const res2 = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: repo as any,
        uploadAdvisory,
    });
    if (res2[0].status !== 'COMPLETED') throw new Error(`Run 2 expected COMPLETED, got ${res2[0].status}`);
    if (mockLifecycleRepository.records.get('t1').state !== TaskProcessingState.COMPLETED) {
        throw new Error('Run 2 lifecycle must be COMPLETED');
    }
    if (uploadCallCount !== 2) throw new Error(`Run 2 expected uploadCallCount === 2, got ${uploadCallCount}`);
    if (!mockOutboxRepository.records.has('t1')) throw new Error('Run 2 outbox payload must be retained');
});

// NON-ADVISORY (16 tests)
await test('NON-ADVISORY: success → COMPLETED', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (res[0].status !== 'COMPLETED') throw new Error('Failed to complete non-advisory task');
});

await test('NON-ADVISORY: payload retained', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (!mockOutcomeRepository.records.has('t2')) throw new Error('Outcome payload deleted');
});

await test('NON-ADVISORY: invalid durable outcome', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    mockOutcomeRepository.records.set('t2', { kind: 'INVALID' });
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') throw new Error('Expected LOCAL_INCONSISTENCY');
});

await test('NON-ADVISORY: INPUT_FAILURE → ABSTAINED', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.INPUT_FAILURE, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (res[0].status !== 'COMPLETED') throw new Error('Failed to complete INPUT_FAILURE task');
});

await test('NON-ADVISORY: RETRIEVAL_FAILURE → ABSTAINED', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.RETRIEVAL_FAILURE, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (res[0].status !== 'COMPLETED') throw new Error('Failed to complete RETRIEVAL_FAILURE task');
});

await test('NON-ADVISORY: ABSTAINED → ABSTAINED', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (res[0].status !== 'COMPLETED') throw new Error('Failed to complete ABSTAINED task');
});

await test('NON-ADVISORY: MODEL_FAILURE → MODEL_FAILURE', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'MODEL_FAILURE', 1);
    addOutcome('t2', NonAdvisoryOutcomeKind.MODEL_FAILURE, 1);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (res[0].status !== 'COMPLETED') throw new Error('Failed to complete MODEL_FAILURE task');
});

await test('NON-ADVISORY: modelAttempts mismatch', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'MODEL_FAILURE', 1);
    addOutcome('t2', NonAdvisoryOutcomeKind.MODEL_FAILURE, 2);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') throw new Error('Expected LOCAL_INCONSISTENCY on modelAttempts mismatch');
});

await test('NON-ADVISORY: terminalOutcome mismatch', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'MODEL_FAILURE', 1);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') throw new Error('Expected LOCAL_INCONSISTENCY on terminalOutcome mismatch');
});

await test('NON-ADVISORY: missing outcome', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') throw new Error('Expected LOCAL_INCONSISTENCY');
});

await test('NON-ADVISORY: taskId mismatch', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    mockOutcomeRepository.records.set('t2', {
        taskId: 't3',
        kind: NonAdvisoryOutcomeKind.ABSTAINED,
        reason: 'NO_EVIDENCE',
        modelAttempts: 0,
        createdAt: '2026-10-10T02:00:00Z',
    });
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
    });
    if (res[0].status !== 'LOCAL_INCONSISTENCY') throw new Error('Expected LOCAL_INCONSISTENCY');
});

await test('NON-ADVISORY: network failure', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => { throw new Error('Network error'); },
    });
    if (res[0].status !== 'SUBMISSION_FAILED') throw new Error('Failed to handle network failure');
});

await test('NON-ADVISORY: malformed response', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: false, taskId: 't2' } as any),
    });
    if (res[0].status !== 'SUBMISSION_FAILED') throw new Error('Expected SUBMISSION_FAILED on malformed response');
});

await test('NON-ADVISORY: wrong ACK taskId', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 'wrong-task' }),
    });
    if (res[0].status !== 'SUBMISSION_FAILED') throw new Error('Expected SUBMISSION_FAILED on wrong ACK taskId');
});

await test('NON-ADVISORY: transition failure after ACK', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    const repo = {
        ...mockLifecycleRepository,
        transitionState: async () => { throw new Error('Database failure'); },
    };
    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: repo as any,
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });
    if (res[0].status !== 'SUBMISSION_FAILED') throw new Error('Expected SUBMISSION_FAILED on transition error');
});

await test('NON-ADVISORY: true lost-response replay', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    let uploadCallCount = 0;
    const uploadNonAdvisory = async () => {
        uploadCallCount++;
        return { ok: true, taskId: 't2' };
    };

    let transitionAttempts = 0;
    const repo = {
        ...mockLifecycleRepository,
        transitionState: async (taskId: string, state: any) => {
            transitionAttempts++;
            if (transitionAttempts === 1) {
                throw new Error('Simulated DB crash before local transition');
            }
            return mockLifecycleRepository.transitionState(taskId, state);
        },
    };

    // Run 1: server accepts, local transition throws
    const res1 = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: repo as any,
        uploadNonAdvisory,
    });
    if (res1[0].status !== 'SUBMISSION_FAILED') throw new Error(`Run 1 expected SUBMISSION_FAILED, got ${res1[0].status}`);
    if (mockLifecycleRepository.records.get('t2').state !== TaskProcessingState.NON_ADVISORY_PENDING_REPORT) {
        throw new Error('Run 1 lifecycle must remain NON_ADVISORY_PENDING_REPORT');
    }
    if (!mockOutcomeRepository.records.has('t2')) throw new Error('Run 1 outcome payload must be retained');
    if (uploadCallCount !== 1) throw new Error(`Run 1 expected uploadCallCount === 1, got ${uploadCallCount}`);

    // Run 2: replay, transition succeeds
    const res2 = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: repo as any,
        uploadNonAdvisory,
    });
    if (res2[0].status !== 'COMPLETED') throw new Error(`Run 2 expected COMPLETED, got ${res2[0].status}`);
    if (mockLifecycleRepository.records.get('t2').state !== TaskProcessingState.COMPLETED) {
        throw new Error('Run 2 lifecycle must be COMPLETED');
    }
    if (uploadCallCount !== 2) throw new Error(`Run 2 expected uploadCallCount === 2, got ${uploadCallCount}`);
    if (!mockOutcomeRepository.records.has('t2')) throw new Error('Run 2 outcome payload must be retained');
});

// BATCH (4 tests)
await test('BATCH: READY skipped / zero network', async () => {
    addLifecycle('t1', TaskProcessingState.READY);
    let network = false;
    await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => { network = true; return {} as any; },
    });
    if (network) throw new Error('Network called for READY task');
});

await test('BATCH: PROCESSING skipped / zero network', async () => {
    addLifecycle('t1', TaskProcessingState.PROCESSING);
    let network = false;
    await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => { network = true; return {} as any; },
    });
    if (network) throw new Error('Network called for PROCESSING task');
});

await test('BATCH: first task fails / second succeeds', async () => {
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);

    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => { throw new Error('Network fail'); },
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });

    if (res.length !== 2) throw new Error('Wrong count');
    if (res.find((r) => r.taskId === 't1')?.status !== 'SUBMISSION_FAILED') throw new Error('T1 should fail');
    if (res.find((r) => r.taskId === 't2')?.status !== 'COMPLETED') throw new Error('T2 should complete');
});

await test('BATCH: reverse order failure isolation', async () => {
    addLifecycle('t2', TaskProcessingState.NON_ADVISORY_PENDING_REPORT, 'ABSTAINED', 0);
    addOutcome('t2', NonAdvisoryOutcomeKind.ABSTAINED, 0);
    addLifecycle('t1', TaskProcessingState.ADVISORY_PENDING_UPLOAD);
    addOutbox('t1');

    const res = await runResultSubmissionCycle({
        advisoryEndpointUrl: 'https://api.com',
        nonAdvisoryEndpointUrl: 'https://api.com',
        credential: 'sec',
        outboxRepository: mockOutboxRepository as any,
        outcomeRepository: mockOutcomeRepository as any,
        lifecycleRepository: mockLifecycleRepository as any,
        uploadAdvisory: async () => { throw new Error('Network fail'); },
        uploadNonAdvisory: async () => ({ ok: true, taskId: 't2' }),
    });

    if (res.length !== 2) throw new Error('Wrong count');
    if (res.find((r) => r.taskId === 't1')?.status !== 'SUBMISSION_FAILED') throw new Error('T1 should fail');
    if (res.find((r) => r.taskId === 't2')?.status !== 'COMPLETED') throw new Error('T2 should complete');
});

console.log(`${passedTests}/${totalTests} PASSED`);
if (failedTests > 0) {
    console.log(`${failedTests} FAILED`);
    process.exit(1);
} else {
    console.log('0 FAILED');
}
