import {
  downloadPendingTask,
  downloadPendingTaskWithFetch,
  type PendingTaskHttpDownloadInput,
  type PendingTaskHttpFetch,
} from './pendingTaskHttpDownloadTransport';
import type { PendingTaskDownloadResult } from './downloadTaskResponseContract';
import {
  createStoredPendingTaskRecord,
  type StoredPendingTaskRecord,
  type LocalPendingTaskRepository,
} from './localPendingTaskStoreContract';

export type DownloadToLocalPersistenceResult =
  | {
      readonly kind: 'STORED';
      readonly record: StoredPendingTaskRecord;
    }
  | {
      readonly kind: 'NO_TASK';
    };

export async function persistPendingTaskDownloadResult(
  result: PendingTaskDownloadResult,
  repository: LocalPendingTaskRepository
): Promise<DownloadToLocalPersistenceResult> {
  if (result.kind === 'NO_TASK') {
    return {
      kind: 'NO_TASK',
    };
  }

  const record = createStoredPendingTaskRecord(result.value);
  await repository.save(record);

  return {
    kind: 'STORED',
    record,
  };
}

export async function downloadAndPersistPendingTaskWithDependencies(
  input: PendingTaskHttpDownloadInput,
  fetcher: PendingTaskHttpFetch,
  repository: LocalPendingTaskRepository
): Promise<DownloadToLocalPersistenceResult> {
  const result = await downloadPendingTaskWithFetch(input, fetcher);
  return persistPendingTaskDownloadResult(result, repository);
}

export async function downloadAndPersistPendingTask(
  input: PendingTaskHttpDownloadInput,
  repository: LocalPendingTaskRepository
): Promise<DownloadToLocalPersistenceResult> {
  const result = await downloadPendingTask(input);
  return persistPendingTaskDownloadResult(result, repository);
}
