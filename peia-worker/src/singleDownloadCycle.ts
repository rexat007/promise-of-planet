import type { PendingTaskHttpDownloadInput } from './pendingTaskHttpDownloadTransport';
import {
  downloadAndPersistPendingTask,
  type DownloadToLocalPersistenceResult,
} from './downloadToLocalPersistence';
import { SqlitePendingTaskRepository } from './sqlitePendingTaskRepository';
import type { LocalPendingTaskRepository } from './localPendingTaskStoreContract';

export interface SingleDownloadCycleInput {
  readonly databasePath: string;
  readonly download: PendingTaskHttpDownloadInput;
}

export interface SingleDownloadCycleDependencies {
  readonly createRepository: (
    databasePath: string
  ) => {
    close(): void;
  } & LocalPendingTaskRepository;

  readonly downloadAndPersist: (
    input: PendingTaskHttpDownloadInput,
    repository: LocalPendingTaskRepository
  ) => Promise<DownloadToLocalPersistenceResult>;
}

export async function runSingleDownloadCycleWithDependencies(
  input: SingleDownloadCycleInput,
  dependencies: SingleDownloadCycleDependencies
): Promise<DownloadToLocalPersistenceResult> {
  const repository = dependencies.createRepository(input.databasePath);
  try {
    return await dependencies.downloadAndPersist(input.download, repository);
  } finally {
    repository.close();
  }
}

export async function runSingleDownloadCycle(
  input: SingleDownloadCycleInput
): Promise<DownloadToLocalPersistenceResult> {
  return runSingleDownloadCycleWithDependencies(input, {
    createRepository: (databasePath: string) => new SqlitePendingTaskRepository(databasePath),
    downloadAndPersist: downloadAndPersistPendingTask,
  });
}
