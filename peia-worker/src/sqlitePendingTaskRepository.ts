import { DatabaseSync } from 'node:sqlite';
import {
  type LocalPendingTaskRepository,
  type StoredPendingTaskRecord,
  validateStoredPendingTaskRecord,
  isSameStoredPendingTaskRecord,
  LocalPendingTaskState,
} from './localPendingTaskStoreContract';

export type SqlitePendingTaskRepositoryErrorCode =
  | 'INVALID_DATABASE_PATH'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_SCHEMA_FAILED'
  | 'DATABASE_READ_FAILED'
  | 'DATABASE_WRITE_FAILED'
  | 'TASK_CONFLICT'
  | 'CORRUPT_STORED_RECORD';

export class SqlitePendingTaskRepositoryError extends Error {
  readonly code: SqlitePendingTaskRepositoryErrorCode;

  constructor(
    code: SqlitePendingTaskRepositoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SqlitePendingTaskRepositoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface PendingTaskRow {
  task_id: string;
  principal_id: string;
  task_type: string;
  target_type: string;
  target_id: string;
  source_updated_at: string;
  content_snapshot_json: string;
  remote_created_at: string;
  remote_status: string;
  local_state: string;
}

export class SqlitePendingTaskRepository
  implements LocalPendingTaskRepository {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    if (
      typeof databasePath !== 'string' ||
      databasePath.length === 0 ||
      databasePath !== databasePath.trim()
    ) {
      throw new SqlitePendingTaskRepositoryError(
        'INVALID_DATABASE_PATH',
        'Invalid local database path.'
      );
    }

    try {
      this.db = new DatabaseSync(databasePath);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_OPEN_FAILED',
        'Unable to open local task database.'
      );
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS peia_pending_tasks (
          task_id TEXT PRIMARY KEY NOT NULL,
          principal_id TEXT NOT NULL,
          task_type TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          source_updated_at TEXT NOT NULL,
          content_snapshot_json TEXT NOT NULL,
          remote_created_at TEXT NOT NULL,
          remote_status TEXT NOT NULL,
          local_state TEXT NOT NULL
        )
      `);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_SCHEMA_FAILED',
        'Unable to initialize local task database.'
      );
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // safe idempotent close
    }
  }

  private reconstructRecord(row: PendingTaskRow): StoredPendingTaskRecord {
    let contentSnapshot: unknown;
    try {
      contentSnapshot = JSON.parse(row.content_snapshot_json);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'CORRUPT_STORED_RECORD',
        'Stored task record is invalid.'
      );
    }

    const reconstructed = {
      taskId: row.task_id,
      principalId: row.principal_id,
      taskType: row.task_type,
      target: {
        targetType: row.target_type,
        targetId: row.target_id,
        sourceUpdatedAt: row.source_updated_at,
      },
      contentSnapshot,
      remoteCreatedAt: row.remote_created_at,
      remoteStatus: row.remote_status,
      localState: row.local_state,
    };

    try {
      return validateStoredPendingTaskRecord(reconstructed);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'CORRUPT_STORED_RECORD',
        'Stored task record is invalid.'
      );
    }
  }

  async save(record: StoredPendingTaskRecord): Promise<void> {
    if (this.closed) {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Unable to write local task database.'
      );
    }

    try {
      validateStoredPendingTaskRecord(record);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Unable to write local task database.'
      );
    }

    let serializedSnapshot: string;
    try {
      serializedSnapshot = JSON.stringify(record.contentSnapshot);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Unable to write local task database.'
      );
    }

    let existingRow: unknown;
    try {
      const selectStmt = this.db.prepare(
        'SELECT task_id, principal_id, task_type, target_type, target_id, source_updated_at, content_snapshot_json, remote_created_at, remote_status, local_state FROM peia_pending_tasks WHERE task_id = ?'
      );
      existingRow = selectStmt.get(record.taskId);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_WRITE_FAILED',
        'Unable to write local task database.'
      );
    }

    if (!existingRow) {
      try {
        const insertStmt = this.db.prepare(`
          INSERT INTO peia_pending_tasks (
            task_id,
            principal_id,
            task_type,
            target_type,
            target_id,
            source_updated_at,
            content_snapshot_json,
            remote_created_at,
            remote_status,
            local_state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertStmt.run(
          record.taskId,
          record.principalId,
          record.taskType,
          record.target.targetType,
          record.target.targetId,
          record.target.sourceUpdatedAt,
          serializedSnapshot,
          record.remoteCreatedAt,
          record.remoteStatus,
          record.localState
        );
        return;
      } catch {
        throw new SqlitePendingTaskRepositoryError(
          'DATABASE_WRITE_FAILED',
          'Unable to write local task database.'
        );
      }
    }

    const existingRecord = this.reconstructRecord(existingRow as PendingTaskRow);

    if (isSameStoredPendingTaskRecord(existingRecord, record)) {
      return;
    }

    throw new SqlitePendingTaskRepositoryError(
      'TASK_CONFLICT',
      'Conflicting local task record.'
    );
  }

  async findByTaskId(
    taskId: string
  ): Promise<StoredPendingTaskRecord | null> {
    if (this.closed) {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_READ_FAILED',
        'Unable to read local task database.'
      );
    }

    if (
      typeof taskId !== 'string' ||
      taskId.length === 0 ||
      taskId !== taskId.trim()
    ) {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_READ_FAILED',
        'Unable to read local task database.'
      );
    }

    let row: unknown;
    try {
      const selectStmt = this.db.prepare(
        'SELECT task_id, principal_id, task_type, target_type, target_id, source_updated_at, content_snapshot_json, remote_created_at, remote_status, local_state FROM peia_pending_tasks WHERE task_id = ?'
      );
      row = selectStmt.get(taskId);
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_READ_FAILED',
        'Unable to read local task database.'
      );
    }

    if (!row) {
      return null;
    }

    return this.reconstructRecord(row as PendingTaskRow);
  }

  async listDownloaded(): Promise<readonly StoredPendingTaskRecord[]> {
    if (this.closed) {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_READ_FAILED',
        'Unable to read local task database.'
      );
    }

    let rows: unknown[];
    try {
      const listStmt = this.db.prepare(
        'SELECT task_id, principal_id, task_type, target_type, target_id, source_updated_at, content_snapshot_json, remote_created_at, remote_status, local_state FROM peia_pending_tasks WHERE local_state = ? ORDER BY remote_created_at ASC, task_id ASC'
      );
      rows = listStmt.all(LocalPendingTaskState.Downloaded) as unknown[];
    } catch {
      throw new SqlitePendingTaskRepositoryError(
        'DATABASE_READ_FAILED',
        'Unable to read local task database.'
      );
    }

    const records: StoredPendingTaskRecord[] = [];
    for (const r of rows) {
      records.push(this.reconstructRecord(r as PendingTaskRow));
    }

    return records;
  }
}
