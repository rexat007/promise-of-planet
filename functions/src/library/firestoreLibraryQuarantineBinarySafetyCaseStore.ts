import {
  LibraryQuarantinePersistedBinarySafetyCase,
  LibraryQuarantinePersistedBinarySafetyCaseEvent,
} from './libraryQuarantineBinarySafetyCaseContract';

export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION =
  'library_quarantine_binary_safety_cases' as const;

export const LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION =
  'library_quarantine_binary_safety_case_events' as const;

export interface LibraryQuarantineBinarySafetyCaseDocumentSnapshot {
  readonly exists: boolean;
  data(): unknown;
}

export interface LibraryQuarantineBinarySafetyCaseTransaction {
  get(ref: unknown): Promise<LibraryQuarantineBinarySafetyCaseDocumentSnapshot>;
  create(ref: unknown, data: unknown): void;
  update(ref: unknown, data: unknown): void;
  set(ref: unknown, data: unknown, options?: { merge?: boolean }): void;
}

export interface LibraryQuarantineBinarySafetyCaseFirestoreDatabase {
  collection(name: string): any;
  runTransaction<T>(
    updateFunction: (transaction: LibraryQuarantineBinarySafetyCaseTransaction) => Promise<T>
  ): Promise<T>;
}

export interface LibraryQuarantineBinarySafetyCaseStorePort {
  getBinarySafetyCase(receiptId: string): Promise<LibraryQuarantinePersistedBinarySafetyCase | null>;
  saveBinarySafetyCaseAtomic(
    receiptId: string,
    revision: number,
    caseRecord: LibraryQuarantinePersistedBinarySafetyCase,
    eventRecord: LibraryQuarantinePersistedBinarySafetyCaseEvent
  ): Promise<{ readonly saved: boolean; readonly currentRecord?: LibraryQuarantinePersistedBinarySafetyCase }>;
}

export class FirestoreLibraryQuarantineBinarySafetyCaseStore
  implements LibraryQuarantineBinarySafetyCaseStorePort
{
  constructor(private readonly db: LibraryQuarantineBinarySafetyCaseFirestoreDatabase) {}

  public async getBinarySafetyCase(
    receiptId: string
  ): Promise<LibraryQuarantinePersistedBinarySafetyCase | null> {
    const docRef = this.db
      .collection(LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION)
      .doc(receiptId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return null;
    }
    const raw = snap.data();
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    return raw as LibraryQuarantinePersistedBinarySafetyCase;
  }

  public async saveBinarySafetyCaseAtomic(
    receiptId: string,
    expectedRevision: number,
    caseRecord: LibraryQuarantinePersistedBinarySafetyCase,
    eventRecord: LibraryQuarantinePersistedBinarySafetyCaseEvent
  ): Promise<{ readonly saved: boolean; readonly currentRecord?: LibraryQuarantinePersistedBinarySafetyCase }> {
    const caseRef = this.db
      .collection(LIBRARY_QUARANTINE_BINARY_SAFETY_CASES_COLLECTION)
      .doc(receiptId);
    const eventRef = this.db
      .collection(LIBRARY_QUARANTINE_BINARY_SAFETY_CASE_EVENTS_COLLECTION)
      .doc(`${receiptId}_${caseRecord.revision}`);

    return this.db.runTransaction(async (transaction) => {
      const caseSnap = await transaction.get(caseRef);
      const eventSnap = await transaction.get(eventRef);

      if (eventSnap.exists) {
        const err = new Error(
          `ALIGNMENT_EVENT_ALREADY_EXISTS: Binary safety audit event for revision ${caseRecord.revision} already exists.`
        ) as Error & { code?: string };
        err.code = 'already-exists';
        throw err;
      }

      let currentRevision = 0;
      let currentRecord: LibraryQuarantinePersistedBinarySafetyCase | undefined;

      if (caseSnap.exists) {
        const raw = caseSnap.data() as LibraryQuarantinePersistedBinarySafetyCase | undefined;
        if (raw && typeof raw === 'object') {
          currentRecord = raw;
          currentRevision = typeof raw.revision === 'number' ? raw.revision : 0;
        }
      }

      if (currentRevision !== expectedRevision) {
        return {
          saved: false,
          ...(currentRecord !== undefined ? { currentRecord } : {}),
        };
      }

      transaction.set(caseRef, caseRecord);
      transaction.create(eventRef, eventRecord);

      return { saved: true };
    });
  }
}
