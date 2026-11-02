import { DatabaseSync } from 'node:sqlite';
import {
  type LocalAdvisoryResultOutboxRepository,
  type StoredAdvisoryResultRecord,
  validateStoredAdvisoryResultRecord,
  isSameStoredAdvisoryResultRecord,
  LocalAdvisoryResultOutboxState,
} from './localAdvisoryResultOutboxContract';

export type SqliteAdvisoryResultOutboxRepositoryErrorCode =
  | 'INVALID_DATABASE_PATH'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_SCHEMA_FAILED'
  | 'DATABASE_READ_FAILED'
  | 'DATABASE_WRITE_FAILED'
  | 'RESULT_CONFLICT'
  | 'CORRUPT_STORED_RECORD';

export class SqliteAdvisoryResultOutboxRepositoryError extends Error {
  readonly code: SqliteAdvisoryResultOutboxRepositoryErrorCode;

  constructor(code: SqliteAdvisoryResultOutboxRepositoryErrorCode) {
    const message =
      code === 'INVALID_DATABASE_PATH'
        ? 'Invalid local advisory outbox database path.'
        : code === 'DATABASE_OPEN_FAILED'
        ? 'Unable to open local advisory outbox database.'
        : code === 'DATABASE_SCHEMA_FAILED'
        ? 'Unable to initialize local advisory outbox database.'
        : code === 'DATABASE_READ_FAILED'
        ? 'Unable to read local advisory outbox database.'
        : code === 'DATABASE_WRITE_FAILED'
        ? 'Unable to write local advisory outbox database.'
        : code === 'RESULT_CONFLICT'
        ? 'Conflicting local advisory result record.'
        : 'Stored advisory result record is invalid.';

    super(message);
    this.name = 'SqliteAdvisoryResultOutboxRepositoryError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface AdvisoryResultOutboxRow {
  task_id: string;
  task_type: string;
  target_type: string;
  target_id: string;
  source_updated_at: string;
  assessment_summary: string;
  findings_json: string;
  local_state: string;
  schema_version?: number | null;
  human_review_required?: number | null;
  recommendations_json?: string | null;
  uncertainties_json?: string | null;
  limitations_json?: string | null;
  library_preparation_json?: string | null;
}

export class SqliteAdvisoryResultOutboxRepository
  implements LocalAdvisoryResultOutboxRepository
{
  private db: DatabaseSync | null = null;
  private isClosed = false;

  constructor(databasePath: string) {
    if (
      typeof databasePath !== 'string' ||
      databasePath.length === 0 ||
      databasePath !== databasePath.trim()
    ) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('INVALID_DATABASE_PATH');
    }

    try {
      this.db = new DatabaseSync(databasePath);
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_OPEN_FAILED');
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS peia_advisory_result_outbox (
          task_id TEXT PRIMARY KEY NOT NULL,
          task_type TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          source_updated_at TEXT NOT NULL,
          assessment_summary TEXT NOT NULL,
          findings_json TEXT NOT NULL,
          local_state TEXT NOT NULL
        );
      `);

      const tableInfo = this.db
        .prepare('PRAGMA table_info(peia_advisory_result_outbox)')
        .all() as Array<{ name: string }>;
      const columnNames = new Set(tableInfo.map((c) => c.name));

      if (!columnNames.has('schema_version')) {
        this.db.exec('ALTER TABLE peia_advisory_result_outbox ADD COLUMN schema_version INTEGER;');
      }
      if (!columnNames.has('human_review_required')) {
        this.db.exec('ALTER TABLE peia_advisory_result_outbox ADD COLUMN human_review_required INTEGER;');
      }
      if (!columnNames.has('recommendations_json')) {
        this.db.exec('ALTER TABLE peia_advisory_result_outbox ADD COLUMN recommendations_json TEXT;');
      }
      if (!columnNames.has('uncertainties_json')) {
        this.db.exec('ALTER TABLE peia_advisory_result_outbox ADD COLUMN uncertainties_json TEXT;');
      }
      if (!columnNames.has('limitations_json')) {
        this.db.exec('ALTER TABLE peia_advisory_result_outbox ADD COLUMN limitations_json TEXT;');
      }
      if (!columnNames.has('library_preparation_json')) {
        this.db.exec('ALTER TABLE peia_advisory_result_outbox ADD COLUMN library_preparation_json TEXT;');
      }
    } catch {
      try {
        this.db.close();
      } catch {
        // swallow error
      }
      this.db = null;
      this.isClosed = true;
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_SCHEMA_FAILED');
    }
  }

  private reconstructRow(row: AdvisoryResultOutboxRow): StoredAdvisoryResultRecord {
    if (
      row.schema_version !== 1 ||
      row.human_review_required !== 1 ||
      row.recommendations_json === null ||
      row.recommendations_json === undefined ||
      row.uncertainties_json === null ||
      row.uncertainties_json === undefined ||
      row.limitations_json === null ||
      row.limitations_json === undefined
    ) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('CORRUPT_STORED_RECORD');
    }

    const hasLibraryPrepColumnValue =
      row.library_preparation_json !== null && row.library_preparation_json !== undefined;

    if (row.target_type === 'LibraryIntake' && !hasLibraryPrepColumnValue) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('CORRUPT_STORED_RECORD');
    }

    if (
      hasLibraryPrepColumnValue &&
      (typeof row.library_preparation_json !== 'string' ||
        row.library_preparation_json.trim().length === 0)
    ) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('CORRUPT_STORED_RECORD');
    }

    let findings: unknown;
    let recommendations: unknown;
    let uncertainties: unknown;
    let limitations: unknown;
    let parsedLibraryPrep: unknown = undefined;

    try {
      findings = JSON.parse(row.findings_json);
      recommendations = JSON.parse(row.recommendations_json);
      uncertainties = JSON.parse(row.uncertainties_json);
      limitations = JSON.parse(row.limitations_json);
      if (hasLibraryPrepColumnValue) {
        parsedLibraryPrep = JSON.parse(row.library_preparation_json as string);
      }
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('CORRUPT_STORED_RECORD');
    }

    if (
      hasLibraryPrepColumnValue &&
      (typeof parsedLibraryPrep !== 'object' ||
        parsedLibraryPrep === null ||
        Array.isArray(parsedLibraryPrep))
    ) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('CORRUPT_STORED_RECORD');
    }

    const initialCandidate = {
      result: {
        schemaVersion: row.schema_version,
        task: {
          taskId: row.task_id,
          taskType: row.task_type,
          target: {
            targetType: row.target_type,
            targetId: row.target_id,
            sourceUpdatedAt: row.source_updated_at,
          },
        },
        humanReviewRequired: true,
        assessment: {
          summary: row.assessment_summary,
          findings,
        },
        recommendations,
        uncertainties,
        limitations,
        ...(hasLibraryPrepColumnValue ? { libraryPreparation: parsedLibraryPrep } : {}),
      },
      localState: row.local_state,
    };

    try {
      const validated = validateStoredAdvisoryResultRecord(initialCandidate);
      if (validated.result.libraryPreparation === undefined) {
        return validated;
      }

      const prep = validated.result.libraryPreparation;
      const canonicalCandidate = {
        result: {
          schemaVersion: validated.result.schemaVersion,
          task: {
            taskId: validated.result.task.taskId,
            taskType: validated.result.task.taskType,
            target: {
              targetType: validated.result.task.target.targetType,
              targetId: validated.result.task.target.targetId,
              sourceUpdatedAt: validated.result.task.target.sourceUpdatedAt,
            },
          },
          humanReviewRequired: validated.result.humanReviewRequired,
          assessment: {
            summary: validated.result.assessment.summary,
            findings: validated.result.assessment.findings,
          },
          recommendations: validated.result.recommendations,
          uncertainties: validated.result.uncertainties,
          limitations: validated.result.limitations,
          libraryPreparation: {
            inputBasis: prep.inputBasis,
            suggestedTitleAr: prep.suggestedTitleAr,
            suggestedTitleEn: prep.suggestedTitleEn,
            suggestedIssuingOrganization: prep.suggestedIssuingOrganization,
            suggestedDocumentType: prep.suggestedDocumentType,
            suggestedEnvironmentalDomains: [...prep.suggestedEnvironmentalDomains],
            suggestedTopicsAr: [...prep.suggestedTopicsAr],
            suggestedTopicsEn: [...prep.suggestedTopicsEn],
            suggestedSummaryAr: prep.suggestedSummaryAr,
            suggestedSummaryEn: prep.suggestedSummaryEn,
            provenanceObservationsAr: [...prep.provenanceObservationsAr],
            provenanceObservationsEn: [...prep.provenanceObservationsEn],
            uncertaintyNoticesAr: [...prep.uncertaintyNoticesAr],
            uncertaintyNoticesEn: [...prep.uncertaintyNoticesEn],
          },
        },
        localState: validated.localState,
      };

      return validateStoredAdvisoryResultRecord(canonicalCandidate);
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('CORRUPT_STORED_RECORD');
    }
  }

  async save(record: StoredAdvisoryResultRecord): Promise<void> {
    if (this.isClosed || !this.db) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_WRITE_FAILED');
    }

    try {
      validateStoredAdvisoryResultRecord(record);
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_WRITE_FAILED');
    }

    if (
      record.result.task.target.targetType === 'LibraryIntake' &&
      record.result.libraryPreparation === undefined
    ) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_WRITE_FAILED');
    }

    const taskId = record.result.task.taskId;

    let existingRow: AdvisoryResultOutboxRow | undefined;
    try {
      const stmt = this.db.prepare(
        'SELECT task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state, schema_version, human_review_required, recommendations_json, uncertainties_json, limitations_json, library_preparation_json FROM peia_advisory_result_outbox WHERE task_id = ?'
      );
      existingRow = stmt.get(taskId) as AdvisoryResultOutboxRow | undefined;
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_READ_FAILED');
    }

    if (existingRow) {
      const existingRecord = this.reconstructRow(existingRow);

      if (isSameStoredAdvisoryResultRecord(existingRecord, record)) {
        return;
      }

      throw new SqliteAdvisoryResultOutboxRepositoryError('RESULT_CONFLICT');
    }

    let findingsJson: string;
    let recommendationsJson: string;
    let uncertaintiesJson: string;
    let limitationsJson: string;
    let libraryPreparationJson: string | null = null;

    try {
      findingsJson = JSON.stringify(record.result.assessment.findings);
      recommendationsJson = JSON.stringify(record.result.recommendations);
      uncertaintiesJson = JSON.stringify(record.result.uncertainties);
      limitationsJson = JSON.stringify(record.result.limitations);
      if (record.result.libraryPreparation !== undefined) {
        libraryPreparationJson = JSON.stringify(record.result.libraryPreparation);
      }
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_WRITE_FAILED');
    }

    try {
      const insertStmt = this.db.prepare(`
        INSERT INTO peia_advisory_result_outbox (
          task_id,
          task_type,
          target_type,
          target_id,
          source_updated_at,
          assessment_summary,
          findings_json,
          local_state,
          schema_version,
          human_review_required,
          recommendations_json,
          uncertainties_json,
          limitations_json,
          library_preparation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        record.result.task.taskId,
        record.result.task.taskType,
        record.result.task.target.targetType,
        record.result.task.target.targetId,
        record.result.task.target.sourceUpdatedAt,
        record.result.assessment.summary,
        findingsJson,
        record.localState,
        record.result.schemaVersion,
        record.result.humanReviewRequired ? 1 : 0,
        recommendationsJson,
        uncertaintiesJson,
        limitationsJson,
        libraryPreparationJson
      );
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_WRITE_FAILED');
    }
  }

  async findByTaskId(taskId: string): Promise<StoredAdvisoryResultRecord | null> {
    if (
      typeof taskId !== 'string' ||
      taskId.length === 0 ||
      taskId !== taskId.trim() ||
      this.isClosed ||
      !this.db
    ) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_READ_FAILED');
    }

    let row: AdvisoryResultOutboxRow | undefined;
    try {
      const stmt = this.db.prepare(
        'SELECT task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state, schema_version, human_review_required, recommendations_json, uncertainties_json, limitations_json, library_preparation_json FROM peia_advisory_result_outbox WHERE task_id = ?'
      );
      row = stmt.get(taskId) as AdvisoryResultOutboxRow | undefined;
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_READ_FAILED');
    }

    if (!row) {
      return null;
    }

    return this.reconstructRow(row);
  }

  async listPendingUpload(): Promise<readonly StoredAdvisoryResultRecord[]> {
    if (this.isClosed || !this.db) {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_READ_FAILED');
    }

    let rows: AdvisoryResultOutboxRow[];
    try {
      const stmt = this.db.prepare(
        'SELECT task_id, task_type, target_type, target_id, source_updated_at, assessment_summary, findings_json, local_state, schema_version, human_review_required, recommendations_json, uncertainties_json, limitations_json, library_preparation_json FROM peia_advisory_result_outbox WHERE local_state = ? ORDER BY task_id ASC'
      );
      rows = stmt.all(LocalAdvisoryResultOutboxState.PendingUpload) as AdvisoryResultOutboxRow[];
    } catch {
      throw new SqliteAdvisoryResultOutboxRepositoryError('DATABASE_READ_FAILED');
    }

    const records: StoredAdvisoryResultRecord[] = [];
    for (const row of rows) {
      records.push(this.reconstructRow(row));
    }

    return records;
  }

  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // swallow error
      }
      this.db = null;
    }
  }
}
