import type { PEIAAdvisoryResult } from './advisoryResultContract';
import {
  createStoredAdvisoryResultRecord,
  type LocalAdvisoryResultOutboxRepository,
  type StoredAdvisoryResultRecord,
} from './localAdvisoryResultOutboxContract';

export interface PersistAdvisoryResultToOutboxResult {
  readonly kind: 'STORED';
  readonly record: StoredAdvisoryResultRecord;
}

export async function persistAdvisoryResultToOutbox(
  result: PEIAAdvisoryResult,
  repository: LocalAdvisoryResultOutboxRepository
): Promise<PersistAdvisoryResultToOutboxResult> {
  const record = createStoredAdvisoryResultRecord(result);
  await repository.save(record);
  return {
    kind: 'STORED',
    record,
  };
}
