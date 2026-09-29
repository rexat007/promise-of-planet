import type { PEIAAdvisoryResult } from './advisoryResultContract';
import {
  type PersistAdvisoryResultToOutboxResult,
  persistAdvisoryResultToOutbox,
} from './advisoryResultToOutboxPersistence';
import type { LocalAdvisoryResultOutboxRepository } from './localAdvisoryResultOutboxContract';
import { SqliteAdvisoryResultOutboxRepository } from './sqliteAdvisoryResultOutboxRepository';

export interface SingleAdvisoryResultPersistenceCycleInput {
  readonly databasePath: string;
  readonly result: PEIAAdvisoryResult;
}

export interface SingleAdvisoryResultPersistenceCycleDependencies {
  readonly createRepository: (
    databasePath: string
  ) => {
    close(): void;
  } & LocalAdvisoryResultOutboxRepository;

  readonly persistResult: (
    result: PEIAAdvisoryResult,
    repository: LocalAdvisoryResultOutboxRepository
  ) => Promise<PersistAdvisoryResultToOutboxResult>;
}

export async function runSingleAdvisoryResultPersistenceCycleWithDependencies(
  input: SingleAdvisoryResultPersistenceCycleInput,
  dependencies: SingleAdvisoryResultPersistenceCycleDependencies
): Promise<PersistAdvisoryResultToOutboxResult> {
  const repository = dependencies.createRepository(input.databasePath);
  try {
    return await dependencies.persistResult(
      input.result,
      repository
    );
  } finally {
    repository.close();
  }
}

export async function runSingleAdvisoryResultPersistenceCycle(
  input: SingleAdvisoryResultPersistenceCycleInput
): Promise<PersistAdvisoryResultToOutboxResult> {
  return runSingleAdvisoryResultPersistenceCycleWithDependencies(input, {
    createRepository: (databasePath: string) =>
      new SqliteAdvisoryResultOutboxRepository(databasePath),
    persistResult: persistAdvisoryResultToOutbox,
  });
}
