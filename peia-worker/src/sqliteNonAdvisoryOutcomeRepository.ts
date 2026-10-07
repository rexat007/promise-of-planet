import { DatabaseSync } from 'node:sqlite';
import {
  type DurableNonAdvisoryOutcomeRecord,
  validateDurableNonAdvisoryOutcomeRecord,
  isSameDurableNonAdvisoryOutcomeRecord,
} from './localNonAdvisoryOutcomeContract';

export type SqliteNonAdvisoryOutcomeRepositoryErrorCode =
  | 'INVALID_DATABASE_PATH'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_SCHEMA_FAILED'
  | 'DATABASE_READ_FAILED'
  | 'DATABASE_WRITE_FAILED'
  | 'OUTCOME_CONFLICT'
  | 'CORRUPT_STORED_RECORD';

export class SqliteNonAdvisoryOutcomeRepositoryError extends Error {
  readonly code: SqliteNonAdvisoryOutcomeRepositoryErrorCode;

  constructor(
    code: SqliteNonAdvisoryOutcomeRepositoryErrorCode,
    message?: string
  ) {
    const defaultMessages: Record<
      SqliteNonAdvisoryOutcomeRepositoryErrorCode,
      string
    > = {
      INVALID_DATABASE_PATH: 'Invalid non-advisory outcomes database path.',
      DATABASE_OPEN_FAILED: 'Unable to open non-advisory outcomes database.',
      DATABASE_SCHEMA_FAILED: 'Unable to initialize non-advisory outcomes database schema.',
      DATABASE_READ_FAILED: 'Unable to read non-advisory outcomes database.',
      DATABASE_WRITE_FAILED: 'Unable to write non-advisory outcomes database.',
      OUTCOME_CONFLICT: 'Conflicting non-advisory outcome record.',
      CORRUPT_STORED_RECORD: 'Stored non-advisory outcome record is corrupt or invalid.',
    };

    super(message ?? defaultMessages[code]);
    this.name = 'SqliteNonAdvisoryOutcomeRepositoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface NonAdvisoryOutcomeRow {
  task_id: string;
  kind: string;
  reason: string;
  model_attempts: number;
  detail: string | null;
  exit_code: number | null;
  source_failures_json: string | null;
  created_at: string;
}

export interface LocalNonAdvisoryOutcomeRepository {
  save(record: DurableNonAdvisoryOutcomeRecord): Promise<void>;
  findByTaskId(taskId: string): Promise<DurableNonAdvisoryOutcomeRecord | null>;
  close(): void;
}

export class SqliteNonAdvisoryOutcomeRepository
  implements LocalNonAdvisoryOutcomeRepository
{
  private db: DatabaseSync | null = null;
  private isClosed = false;

  constructor(databasePath: string) {
    if (
      typeof databasePath !== 'string' ||
      databasePath.trim().length === 0 ||
      databasePath !== databasePath.trim()
    ) {
      throw new SqliteNonAdvisoryOutcomeRepositoryError('INVALID_DATABASE_PATH');
    }

    try {
      this.db = new DatabaseSync(databasePath);
    } catch {
      throw new SqliteNonAdvisoryOutcomeRepositoryError('DATABASE_OPEN_FAILED');
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS peia_non_advisory_outcomes (
          task_id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          reason TEXT NOT NULL,
          model_attempts INTEGER NOT NULL,
          detail TEXT,
          exit_code INTEGER,
          source_failures_json TEXT,
          created_at TEXT NOT NULL
        );
      `);
    } catch {
      try {
        this.db.close();
      } catch {
        // swallow
      }
      this.db = null;
      this.isClosed = true;
      throw new SqliteNonAdvisoryOutcomeRepositoryError('DATABASE_SCHEMA_FAILED');
    }
  }

  private mapRowToRecord(row: NonAdvisoryOutcomeRow): DurableNonAdvisoryOutcomeRecord {
    let sourceFailures: unknown = undefined;
    if (row.source_failures_json !== null && row.source_failures_json !== undefined) {
      try {
        sourceFailures = JSON.parse(row.source_failures_json);
      } catch {
        throw new SqliteNonAdvisoryOutcomeRepositoryError('CORRUPT_STORED_RECORD');
      }
    }

    const rawObj: Record<string, unknown> = {
      taskId: row.task_id,
      kind: row.kind,
      reason: row.reason,
      modelAttempts: row.model_attempts,
      createdAt: row.created_at,
    };

    if (row.detail !== null && row.detail !== undefined) {
      rawObj['detail'] = row.detail;
    }
    if (row.exit_code !== null && row.exit_code !== undefined) {
      rawObj['exitCode'] = row.exit_code;
    }
    if (sourceFailures !== undefined) {
      rawObj['sourceFailures'] = sourceFailures;
    }

    try {
      return validateDurableNonAdvisoryOutcomeRecord(rawObj);
    } catch (err: unknown) {
      throw new SqliteNonAdvisoryOutcomeRepositoryError(
        'CORRUPT_STORED_RECORD',
        `Corrupt non-advisory outcome record: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async findByTaskId(taskId: string): Promise<DurableNonAdvisoryOutcomeRecord | null> {
    if (this.isClosed || !this.db) {
      throw new SqliteNonAdvisoryOutcomeRepositoryError('DATABASE_READ_FAILED', 'Database is closed.');
    }
    if (
      typeof taskId !== 'string' ||
      taskId.length === 0 ||
      taskId !== taskId.trim()
    ) {
      throw new SqliteNonAdvisoryOutcomeRepositoryError(
        'DATABASE_READ_FAILED',
        'Invalid taskId provided to findByTaskId.'
      );
    }

    try {
      const stmt = this.db.prepare(
        'SELECT task_id, kind, reason, model_attempts, detail, exit_code, source_failures_json, created_at FROM peia_non_advisory_outcomes WHERE task_id = ?'
      );
      const row = stmt.get(taskId) as NonAdvisoryOutcomeRow | undefined;
      if (!row) {
        return null;
      }
      return this.mapRowToRecord(row);
    } catch (err: unknown) {
      if (err instanceof SqliteNonAdvisoryOutcomeRepositoryError) {
        throw err;
      }
      throw new SqliteNonAdvisoryOutcomeRepositoryError('DATABASE_READ_FAILED');
    }
  }

  async save(record: DurableNonAdvisoryOutcomeRecord): Promise<void> {
    if (this.isClosed || !this.db) {
      throw new SqliteNonAdvisoryOutcomeRepositoryError('DATABASE_WRITE_FAILED', 'Database is closed.');
    }

    try {
      validateDurableNonAdvisoryOutcomeRecord(record);
    } catch {
      throw new SqliteNonAdvisoryOutcomeRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Attempted to save invalid durable non-advisory outcome record.'
      );
    }

    try {
      const existing = await this.findByTaskId(record.taskId);
      if (existing) {
        if (isSameDurableNonAdvisoryOutcomeRecord(existing, record)) {
          return;
        } else {
          throw new SqliteNonAdvisoryOutcomeRepositoryError('OUTCOME_CONFLICT');
        }
      }

      let sourceFailuresJson: string | null = null;
      if (record.kind === 'RETRIEVAL_FAILURE') {
        sourceFailuresJson = JSON.stringify(record.sourceFailures);
      }

      const detailVal = record.detail ?? null;
      const exitCodeVal = record.kind === 'MODEL_FAILURE' ? (record.exitCode ?? null) : null;

      const stmt = this.db.prepare(`
        INSERT INTO peia_non_advisory_outcomes (
          task_id, kind, reason, model_attempts, detail, exit_code, source_failures_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        record.taskId,
        record.kind,
        record.reason,
        record.modelAttempts,
        detailVal,
        exitCodeVal,
        sourceFailuresJson,
        record.createdAt
      );
    } catch (err: unknown) {
      if (err instanceof SqliteNonAdvisoryOutcomeRepositoryError) {
        throw err;
      }
      throw new SqliteNonAdvisoryOutcomeRepositoryError('DATABASE_WRITE_FAILED');
    }
  }

  close(): void {
    if (this.isClosed || !this.db) {
      return;
    }
    try {
      this.db.close();
    } catch {
      // swallow
    }
    this.db = null;
    this.isClosed = true;
  }
}
