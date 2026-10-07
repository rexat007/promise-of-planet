import { DatabaseSync } from 'node:sqlite';
import {
  type TaskProcessingRecord,
  TaskProcessingState,
  type TaskProcessingTerminalOutcome,
  validateTaskProcessingRecord,
  validateStateTransition,
  PEIA_MAX_MODEL_ATTEMPTS,
} from './localTaskProcessingLifecycleContract';

export type SqliteTaskProcessingLifecycleRepositoryErrorCode =
  | 'INVALID_DATABASE_PATH'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_SCHEMA_FAILED'
  | 'DATABASE_READ_FAILED'
  | 'DATABASE_WRITE_FAILED'
  | 'TASK_NOT_FOUND'
  | 'PROCESSING_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'CORRUPT_STORED_RECORD';

export class SqliteTaskProcessingLifecycleRepositoryError extends Error {
  readonly code: SqliteTaskProcessingLifecycleRepositoryErrorCode;

  constructor(
    code: SqliteTaskProcessingLifecycleRepositoryErrorCode,
    message?: string
  ) {
    const defaultMessages: Record<
      SqliteTaskProcessingLifecycleRepositoryErrorCode,
      string
    > = {
      INVALID_DATABASE_PATH: 'Invalid task processing database path.',
      DATABASE_OPEN_FAILED: 'Unable to open task processing database.',
      DATABASE_SCHEMA_FAILED: 'Unable to initialize task processing database schema.',
      DATABASE_READ_FAILED: 'Unable to read task processing database.',
      DATABASE_WRITE_FAILED: 'Unable to write task processing database.',
      TASK_NOT_FOUND: 'Task processing record not found.',
      PROCESSING_CONFLICT: 'Conflicting task processing record.',
      INVALID_TRANSITION: 'Invalid task processing state transition.',
      MAX_ATTEMPTS_EXCEEDED: 'Maximum model attempts exceeded.',
      CORRUPT_STORED_RECORD: 'Stored task processing record is corrupt or invalid.',
    };

    super(message ?? defaultMessages[code]);
    this.name = 'SqliteTaskProcessingLifecycleRepositoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface TaskProcessingRow {
  task_id: string;
  state: string;
  model_attempts: number;
  terminal_outcome: string | null;
  updated_at: string;
}

export interface TaskProcessingLifecycleRepository {
  createInitialRecord(taskId: string): Promise<TaskProcessingRecord>;
  findByTaskId(taskId: string): Promise<TaskProcessingRecord | null>;
  listResumableRecords(): Promise<readonly TaskProcessingRecord[]>;
  recordModelAttempt(taskId: string): Promise<TaskProcessingRecord>;
  transitionState(
    taskId: string,
    targetState: TaskProcessingState,
    terminalOutcome?: TaskProcessingTerminalOutcome | null
  ): Promise<TaskProcessingRecord>;
  close(): void;
}

export class SqliteTaskProcessingLifecycleRepository
  implements TaskProcessingLifecycleRepository
{
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (
      typeof databasePath !== 'string' ||
      databasePath.trim().length === 0 ||
      databasePath !== databasePath.trim()
    ) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'INVALID_DATABASE_PATH'
      );
    }

    try {
      this.db = new DatabaseSync(databasePath);
    } catch {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_OPEN_FAILED'
      );
    }

    this.initializeSchema();
  }

  private initializeSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS peia_task_processing (
          task_id TEXT PRIMARY KEY NOT NULL,
          state TEXT NOT NULL,
          model_attempts INTEGER NOT NULL,
          terminal_outcome TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    } catch {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_SCHEMA_FAILED'
      );
    }
  }

  private mapRowToRecord(row: TaskProcessingRow): TaskProcessingRecord {
    try {
      return validateTaskProcessingRecord({
        taskId: row.task_id,
        state: row.state,
        modelAttempts: row.model_attempts,
        terminalOutcome: row.terminal_outcome,
        updatedAt: row.updated_at,
      });
    } catch (err: unknown) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'CORRUPT_STORED_RECORD',
        `Corrupt task processing record: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async findByTaskId(taskId: string): Promise<TaskProcessingRecord | null> {
    if (
      typeof taskId !== 'string' ||
      taskId.length === 0 ||
      taskId !== taskId.trim()
    ) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_READ_FAILED',
        'Invalid taskId provided to findByTaskId.'
      );
    }

    try {
      const stmt = this.db.prepare(
        `SELECT task_id, state, model_attempts, terminal_outcome, updated_at
         FROM peia_task_processing
         WHERE task_id = ?`
      );
      const row = stmt.get(taskId) as TaskProcessingRow | undefined;
      if (!row) {
        return null;
      }
      return this.mapRowToRecord(row);
    } catch (err: unknown) {
      if (err instanceof SqliteTaskProcessingLifecycleRepositoryError) {
        throw err;
      }
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_READ_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async createInitialRecord(taskId: string): Promise<TaskProcessingRecord> {
    if (
      typeof taskId !== 'string' ||
      taskId.length === 0 ||
      taskId !== taskId.trim()
    ) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Invalid taskId provided to createInitialRecord.'
      );
    }

    const existing = await this.findByTaskId(taskId);
    if (existing) {
      if (
        existing.state === TaskProcessingState.READY &&
        existing.modelAttempts === 0 &&
        existing.terminalOutcome === null
      ) {
        return existing; // Idempotent
      }
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'PROCESSING_CONFLICT',
        `Task processing record already exists in non-initial state: ${existing.state} (attempts: ${existing.modelAttempts}).`
      );
    }

    const now = new Date().toISOString();
    const candidate: TaskProcessingRecord = validateTaskProcessingRecord({
      taskId,
      state: TaskProcessingState.READY,
      modelAttempts: 0,
      terminalOutcome: null,
      updatedAt: now,
    });

    try {
      const stmt = this.db.prepare(
        `INSERT INTO peia_task_processing (task_id, state, model_attempts, terminal_outcome, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      stmt.run(
        candidate.taskId,
        candidate.state,
        candidate.modelAttempts,
        candidate.terminalOutcome,
        candidate.updatedAt
      );
      return candidate;
    } catch (err: unknown) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_WRITE_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async listResumableRecords(): Promise<readonly TaskProcessingRecord[]> {
    try {
      const stmt = this.db.prepare(
        `SELECT task_id, state, model_attempts, terminal_outcome, updated_at
         FROM peia_task_processing
         WHERE state IN (?, ?, ?, ?)
         ORDER BY updated_at ASC, task_id ASC`
      );
      const rows = stmt.all(
        TaskProcessingState.READY,
        TaskProcessingState.PROCESSING,
        TaskProcessingState.ADVISORY_PENDING_UPLOAD,
        TaskProcessingState.NON_ADVISORY_PENDING_REPORT
      ) as TaskProcessingRow[];

      return rows.map((row) => this.mapRowToRecord(row));
    } catch (err: unknown) {
      if (err instanceof SqliteTaskProcessingLifecycleRepositoryError) {
        throw err;
      }
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_READ_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async recordModelAttempt(taskId: string): Promise<TaskProcessingRecord> {
    if (
      typeof taskId !== 'string' ||
      taskId.length === 0 ||
      taskId !== taskId.trim()
    ) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Invalid taskId provided to recordModelAttempt.'
      );
    }

    const now = new Date().toISOString();

    try {
      const stmt = this.db.prepare(
        `UPDATE peia_task_processing
         SET state = ?, model_attempts = model_attempts + 1, terminal_outcome = NULL, updated_at = ?
         WHERE task_id = ? AND state IN (?, ?) AND model_attempts < ?`
      );
      const result = stmt.run(
        TaskProcessingState.PROCESSING,
        now,
        taskId,
        TaskProcessingState.READY,
        TaskProcessingState.PROCESSING,
        PEIA_MAX_MODEL_ATTEMPTS
      );

      const changes = typeof result === 'object' && result !== null && 'changes' in result
        ? Number((result as { changes: number | bigint }).changes)
        : 0;

      if (changes === 1) {
        const updated = await this.findByTaskId(taskId);
        if (!updated) {
          throw new SqliteTaskProcessingLifecycleRepositoryError(
            'CORRUPT_STORED_RECORD',
            'Failed to read updated record after atomic reservation.'
          );
        }
        return updated;
      }

      // If 0 rows updated, inspect current state to return the exact fail-closed reason
      const current = await this.findByTaskId(taskId);
      if (!current) {
        throw new SqliteTaskProcessingLifecycleRepositoryError('TASK_NOT_FOUND');
      }

      if (current.modelAttempts >= PEIA_MAX_MODEL_ATTEMPTS) {
        throw new SqliteTaskProcessingLifecycleRepositoryError(
          'MAX_ATTEMPTS_EXCEEDED',
          `Task ${taskId} has already reached maximum model attempts (${PEIA_MAX_MODEL_ATTEMPTS}).`
        );
      }

      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'INVALID_TRANSITION',
        `Cannot record model attempt for task in state: ${current.state}.`
      );
    } catch (err: unknown) {
      if (err instanceof SqliteTaskProcessingLifecycleRepositoryError) {
        throw err;
      }
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_WRITE_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async transitionState(
    taskId: string,
    targetState: TaskProcessingState,
    terminalOutcome?: TaskProcessingTerminalOutcome | null
  ): Promise<TaskProcessingRecord> {
    const existing = await this.findByTaskId(taskId);
    if (!existing) {
      throw new SqliteTaskProcessingLifecycleRepositoryError('TASK_NOT_FOUND');
    }

    try {
      validateStateTransition(existing.state, targetState);
    } catch (err: unknown) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'INVALID_TRANSITION',
        err instanceof Error ? err.message : String(err)
      );
    }

    // Determine preserved terminalOutcome if moving to COMPLETED without explicit outcome passed:
    const effectiveOutcome =
      terminalOutcome !== undefined
        ? terminalOutcome
        : existing.state === TaskProcessingState.ADVISORY_PENDING_UPLOAD
        ? null
        : existing.terminalOutcome;

    const now = new Date().toISOString();
    let candidate: TaskProcessingRecord;
    try {
      candidate = validateTaskProcessingRecord({
        taskId,
        state: targetState,
        modelAttempts: existing.modelAttempts,
        terminalOutcome: effectiveOutcome,
        updatedAt: now,
      });
    } catch (err: unknown) {
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'INVALID_TRANSITION',
        err instanceof Error ? err.message : String(err)
      );
    }

    try {
      const stmt = this.db.prepare(
        `UPDATE peia_task_processing
         SET state = ?, model_attempts = ?, terminal_outcome = ?, updated_at = ?
         WHERE task_id = ? AND state = ?`
      );
      const res = stmt.run(
        candidate.state,
        candidate.modelAttempts,
        candidate.terminalOutcome,
        candidate.updatedAt,
        candidate.taskId,
        existing.state
      );

      const changes = typeof res === 'object' && res !== null && 'changes' in res
        ? Number((res as { changes: number | bigint }).changes)
        : 0;

      if (changes !== 1) {
        throw new SqliteTaskProcessingLifecycleRepositoryError(
          'INVALID_TRANSITION',
          'Concurrent state modification detected during transitionState.'
        );
      }
      return candidate;
    } catch (err: unknown) {
      if (err instanceof SqliteTaskProcessingLifecycleRepositoryError) {
        throw err;
      }
      throw new SqliteTaskProcessingLifecycleRepositoryError(
        'DATABASE_WRITE_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  close(): void {
    this.db.close();
  }
}
