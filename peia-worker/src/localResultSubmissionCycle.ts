import {
  type SqliteAdvisoryResultOutboxRepository,
} from './sqliteAdvisoryResultOutboxRepository';
import {
  type SqliteNonAdvisoryOutcomeRepository,
} from './sqliteNonAdvisoryOutcomeRepository';
import {
  type SqliteTaskProcessingLifecycleRepository,
} from './sqliteTaskProcessingLifecycleRepository';
import { TaskProcessingState } from './localTaskProcessingLifecycleContract';
import { uploadAdvisoryResult, type AdvisoryResultHttpUploadInput } from './advisoryResultHttpUploadTransport';
import { uploadNonAdvisoryOutcome, type NonAdvisoryOutcomeHttpReportInput } from './nonAdvisoryOutcomeHttpReportTransport';
import { type AdvisoryResultUploadResponse } from './advisoryResultUploadContract';
import { type NonAdvisoryOutcomeReportResponse } from './nonAdvisoryOutcomeReportContract';
import { validateStoredAdvisoryResultRecord } from './localAdvisoryResultOutboxContract';
import { validateDurableNonAdvisoryOutcomeRecord } from './localNonAdvisoryOutcomeContract';

export type SubmissionStatus =
  | 'COMPLETED'
  | 'SUBMISSION_FAILED'
  | 'LOCAL_INCONSISTENCY';

export interface SubmissionResult {
  readonly taskId: string;
  readonly status: SubmissionStatus;
  readonly error?: string;
}

export interface SubmissionCycleConfig {
  readonly advisoryEndpointUrl: string;
  readonly nonAdvisoryEndpointUrl: string;
  readonly credential: string;
  readonly outboxRepository: SqliteAdvisoryResultOutboxRepository;
  readonly outcomeRepository: SqliteNonAdvisoryOutcomeRepository;
  readonly lifecycleRepository: SqliteTaskProcessingLifecycleRepository;
  readonly uploadAdvisory?: (input: AdvisoryResultHttpUploadInput) => Promise<AdvisoryResultUploadResponse>;
  readonly uploadNonAdvisory?: (input: NonAdvisoryOutcomeHttpReportInput) => Promise<NonAdvisoryOutcomeReportResponse>;
}

export async function runResultSubmissionCycle(
  config: SubmissionCycleConfig
): Promise<readonly SubmissionResult[]> {
  const records = await config.lifecycleRepository.listResumableRecords();
  const results: SubmissionResult[] = [];
  
  const uploadAdvisory = config.uploadAdvisory ?? uploadAdvisoryResult;
  const uploadNonAdvisory = config.uploadNonAdvisory ?? uploadNonAdvisoryOutcome;

  for (const record of records) {
    if (
      record.state !== TaskProcessingState.ADVISORY_PENDING_UPLOAD &&
      record.state !== TaskProcessingState.NON_ADVISORY_PENDING_REPORT
    ) {
      continue;
    }

    try {
      if (record.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD) {
        const outbox = await config.outboxRepository.findByTaskId(record.taskId);
        if (!outbox) {
          results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'Outbox record missing' });
          continue;
        }
        
        try {
          validateStoredAdvisoryResultRecord(outbox);
        } catch {
          results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'Invalid stored advisory record' });
          continue;
        }
        
        if (outbox.result.task.taskId !== record.taskId) {
            results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'TaskId mismatch in outbox' });
            continue;
        }

        const response = await uploadAdvisory({
          endpointUrl: config.advisoryEndpointUrl,
          credential: config.credential,
          result: outbox.result,
        });

        if (response.kind !== 'ACCEPTED' || response.value.ok !== true || response.value.taskId !== record.taskId) {
          results.push({ taskId: record.taskId, status: 'SUBMISSION_FAILED', error: 'Server rejection or mismatch' });
          continue;
        }
      } else {
        const outcome = await config.outcomeRepository.findByTaskId(record.taskId);
        if (!outcome) {
          results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'Outcome record missing' });
          continue;
        }
        
        try {
          validateDurableNonAdvisoryOutcomeRecord(outcome);
        } catch {
          results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'Invalid durable non-advisory outcome' });
          continue;
        }
        
        if (outcome.taskId !== record.taskId) {
            results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'TaskId mismatch in outcome' });
            continue;
        }

        if (outcome.modelAttempts !== record.modelAttempts) {
            results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'Model attempts mismatch' });
            continue;
        }

        const expectedTerminal = (outcome.kind === 'MODEL_FAILURE') 
            ? 'MODEL_FAILURE' 
            : 'ABSTAINED';

        if (record.terminalOutcome !== expectedTerminal) {
            results.push({ taskId: record.taskId, status: 'LOCAL_INCONSISTENCY', error: 'Terminal outcome mismatch' });
            continue;
        }

        const response = await uploadNonAdvisory({
          endpointUrl: config.nonAdvisoryEndpointUrl,
          credential: config.credential,
          outcome,
        });

        if (response.ok !== true || response.taskId !== record.taskId) {
          results.push({ taskId: record.taskId, status: 'SUBMISSION_FAILED', error: 'Server rejection or mismatch' });
          continue;
        }
      }

      await config.lifecycleRepository.transitionState(record.taskId, TaskProcessingState.COMPLETED);
      results.push({ taskId: record.taskId, status: 'COMPLETED' });
    } catch (err: unknown) {
      results.push({
        taskId: record.taskId,
        status: 'SUBMISSION_FAILED',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
