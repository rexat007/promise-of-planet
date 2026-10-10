import * as fs from 'fs';
import * as path from 'path';
import {
  FirestoreAdvisoryResultRepository,
  PEIA_ADVISORY_RESULT_COLLECTION,
  deriveAdvisoryResultDocumentId,
  type FirestoreDatabase,
  type FirestoreCollection,
  type FirestoreDocument,
  type FirestoreDocumentSnapshot,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
import { AIReviewTargetType } from '../src/types/aiReview';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { ReconciledAdvisoryResultPersistenceRecord } from '../functions/src/peia/advisoryResultPersistenceBoundary';

const tests: { name: string; run: () => Promise<void> }[] = [];
let passedCount = 0;
let failedCount = 0;

async function registerTest(name: string, run: () => Promise<void>) {
  tests.push({ name, run });
}

// Dedicated ALREADY_EXISTS error for fake
class FirestoreAlreadyExistsError extends Error {
  readonly code = 6; // gRPC ALREADY_EXISTS code used by Firestore
  constructor() {
    super('Document already exists');
    this.name = 'FirestoreAlreadyExistsError';
  }
}

// Upgraded Fakes for real create-only semantics
class RecordingSnapshot implements FirestoreDocumentSnapshot {
  constructor(readonly exists: boolean, private readonly dataValue: unknown) {}
  data(): unknown {
    return this.dataValue;
  }
}

class RecordingDocument implements FirestoreDocument {
  public createCalls = 0;
  public successfulCreateCount = 0;
  public getCalls = 0;
  private currentData: unknown | null = null;
  private docExists = false;

  // Reusable error for identity proof
  public readonly alreadyExistsError = new FirestoreAlreadyExistsError();

  constructor(initialData: unknown | null = null) {
    if (initialData !== null) {
      this.currentData = initialData;
      this.docExists = true;
      // successfulCreateCount remains 0 because it was seeded, not created via repo
    }
  }

  async get(): Promise<FirestoreDocumentSnapshot> {
    this.getCalls++;
    return new RecordingSnapshot(this.docExists, this.currentData);
  }

  async create(data: unknown): Promise<unknown> {
    this.createCalls++;
    if (this.docExists) {
      throw this.alreadyExistsError;
    }
    this.currentData = data;
    this.docExists = true;
    this.successfulCreateCount++;
    return { writeTime: 'now' };
  }
  
  // Helper for test verification
  getStoredData(): unknown {
      return this.currentData;
  }
}

class RecordingCollection implements FirestoreCollection {
  public docCalls = 0;
  public lastDocId = '';
  private readonly docMap: Record<string, RecordingDocument> = {};

  doc(id: string) {
    this.docCalls++;
    this.lastDocId = id;
    if (!this.docMap[id]) {
        this.docMap[id] = new RecordingDocument();
    }
    return this.docMap[id];
  }
  
  // Helper to pre-seed documents
  seed(id: string, data: unknown) {
      this.docMap[id] = new RecordingDocument(data);
  }
}

class RecordingDatabase implements FirestoreDatabase {
  public collectionCalls = 0;
  public lastCollectionName = '';
  private readonly collectionMap: Record<string, RecordingCollection> = {};

  collection(name: string) {
    this.collectionCalls++;
    this.lastCollectionName = name;
    if (!this.collectionMap[name]) {
        this.collectionMap[name] = new RecordingCollection();
    }
    return this.collectionMap[name];
  }
}

function createValidCanonicalRecord(taskId: string): ReconciledAdvisoryResultPersistenceRecord {
  return {
    taskId,
    reconciledTask: {
      taskId,
      taskType: AITaskType.CONTENT_REVIEW,
      status: AITaskStatus.Pending,
      createdAt: '2024-01-01T12:00:00Z',
      target: {
        targetType: AIReviewTargetType.News,
        targetId: 'news-1',
        sourceUpdatedAt: '2024-01-01T11:00:00Z',
      },
      contentSnapshot: { title: 'Safe Title' },
    },
    principal: {
      principalId: 'node-1',
      isActive: true,
      capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
    },
    advisoryResult: {
      task: {
        taskId,
        taskType: AITaskType.CONTENT_REVIEW,
        target: {
          targetType: AIReviewTargetType.News,
          targetId: 'news-1',
          sourceUpdatedAt: '2024-01-01T11:00:00Z',
        },
      },
      assessment: {
        summary: 'Safe',
        findings: [],
      },
    },
  };
}

// 1. canonical collection constant
registerTest('1. canonical collection constant', async () => {
  if (PEIA_ADVISORY_RESULT_COLLECTION !== 'peiaAdvisoryResults') {
    throw new Error(`Expected peiaAdvisoryResults, got ${PEIA_ADVISORY_RESULT_COLLECTION}`);
  }
});

// 2. document-id derivation is deterministic
registerTest('2. document-id derivation is deterministic', async () => {
  const id1 = deriveAdvisoryResultDocumentId('task-1');
  const id2 = deriveAdvisoryResultDocumentId('task-1');
  if (id1 !== id2) throw new Error('Not deterministic');
});

// 3. derived document id is 64 lowercase hex characters
registerTest('3. derived document id is 64 lowercase hex characters', async () => {
  const id = deriveAdvisoryResultDocumentId('task-1');
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error(`Invalid hex ID: ${id}`);
});

// 4. taskId containing "/" produces a safe document id with no "/"
registerTest('4. taskId containing "/" produces a safe document id with no "/"', async () => {
  const taskId = 'external/source/task-123';
  const id = deriveAdvisoryResultDocumentId(taskId);
  if (id.includes('/')) throw new Error('Document ID contains slash');
});

// 5. original taskId containing "/" remains unchanged inside persisted record
registerTest('5. original taskId containing "/" remains unchanged inside persisted record', async () => {
  const taskId = 'external/source/task-123';
  const record = createValidCanonicalRecord(taskId);
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(record);
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId(taskId)) as RecordingDocument;
  const stored = doc.getStoredData();
  if (!stored || typeof stored !== 'object') throw new Error('Stored data is not an object');
  if ((stored as Record<string, unknown>).taskId !== taskId) throw new Error(`Stored taskId mismatch: got ${(stored as Record<string, unknown>).taskId}`);
});

// 6. findByTaskId uses derived document ID, not raw taskId
registerTest('6. findByTaskId uses derived document ID, not raw taskId', async () => {
  const taskId = 'task-1';
  const docId = deriveAdvisoryResultDocumentId(taskId);
  const db = new RecordingDatabase();
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.findByTaskId(taskId);
  if (col.lastDocId !== docId) throw new Error(`Expected docId ${docId}, got ${col.lastDocId}`);
});

// 7. same taskId always maps to same document reference
registerTest('7. same taskId always maps to same document reference', async () => {
  const taskId = 'task-1';
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  
  await repo.findByTaskId(taskId);
  const id1 = col.lastDocId;
  await repo.save(createValidCanonicalRecord(taskId));
  const id2 = col.lastDocId;
  
  if (id1 !== id2) throw new Error('IDs do not match');
});

// 8. different taskIds map to different document references
registerTest('8. different taskIds map to different document references', async () => {
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  
  await repo.findByTaskId('task-1');
  const id1 = col.lastDocId;
  await repo.findByTaskId('task-2');
  const id2 = col.lastDocId;
  
  if (id1 === id2) throw new Error('IDs matched unexpectedly');
});

// 9. nonexistent document returns null
registerTest('9. nonexistent document returns null', async () => {
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  const result = await repo.findByTaskId('missing');
  if (result !== null) throw new Error('Expected null');
});

// 10. existing document returns exact raw stored object
registerTest('10. existing document returns exact raw stored object', async () => {
  const taskId = 'task-1';
  const data = { some: 'data', complex: { nested: true } };
  const db = new RecordingDatabase();
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  col.seed(deriveAdvisoryResultDocumentId(taskId), data);
  
  const repo = new FirestoreAdvisoryResultRepository(db);
  const result = await repo.findByTaskId(taskId);
  if (result !== data) throw new Error('Object identity/value mismatch');
});

// 11. read failure propagates the exact same error object
registerTest('11. read failure propagates the exact same error object', async () => {
  const infraError = new Error('Infra failure');
  const db = new RecordingDatabase();
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId('task-1')) as RecordingDocument;
  doc.get = async () => { throw infraError; };
  
  const repo = new FirestoreAdvisoryResultRepository(db);
  try {
    await repo.findByTaskId('task-1');
    throw new Error('Should have thrown');
  } catch (err: unknown) {
    if (err !== infraError) throw new Error('Error not propagated exactly');
  }
});

// 12. save uses derived document ID
registerTest('12. save uses derived document ID', async () => {
  const taskId = 'task-1';
  const docId = deriveAdvisoryResultDocumentId(taskId);
  const db = new RecordingDatabase();
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(createValidCanonicalRecord(taskId));
  if (col.lastDocId !== docId) throw new Error(`Expected docId ${docId}, got ${col.lastDocId}`);
});

// 13. save calls create exactly once
registerTest('13. save calls create exactly once', async () => {
  const db = new RecordingDatabase();
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const taskId = 'task-1';
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(createValidCanonicalRecord(taskId));
  const doc = col.doc(deriveAdvisoryResultDocumentId(taskId)) as RecordingDocument;
  if (doc.createCalls !== 1) throw new Error(`createCalls: ${doc.createCalls}`);
});

// 14. save writes exactly the accepted persistence record
registerTest('14. save writes exactly the accepted persistence record', async () => {
  const taskId = 'task-1';
  const record = createValidCanonicalRecord(taskId);
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(record);
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId(taskId)) as RecordingDocument;
  const stored = doc.getStoredData();
  
  // Structural match check (avoiding direct identity as object is created in save)
  const storedJson = JSON.stringify(stored);
  const recordJson = JSON.stringify(record);
  if (storedJson !== recordJson) throw new Error('Data mismatch');
});

// 15. save adds no metadata fields
registerTest('15. save adds no metadata fields', async () => {
  const record = createValidCanonicalRecord('task-1');
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(record);
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId('task-1')) as RecordingDocument;
  const stored = doc.getStoredData() as Record<string, unknown>;
  const keys = Object.keys(stored);
  if (keys.length !== 4) throw new Error(`Too many keys: ${keys.join(', ')}`);
});

// 16. save adds no: status approved rejected published completed humanDecision
registerTest('16. save adds no: status approved rejected published completed humanDecision', async () => {
  const record = createValidCanonicalRecord('task-1');
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(record);
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId('task-1')) as RecordingDocument;
  const stored = doc.getStoredData() as Record<string, unknown>;
  const prohibited = ['approved', 'rejected', 'published', 'completed', 'humanDecision'];
  for (const p of prohibited) {
      if (p in stored) throw new Error(`Prohibited field found: ${p}`);
  }
});

// 17. save stores no: credential machineCredential secret token authorization
registerTest('17. save stores no: credential machineCredential secret token authorization', async () => {
  const record = createValidCanonicalRecord('task-1');
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(record);
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId('task-1')) as RecordingDocument;
  const stored = doc.getStoredData() as Record<string, unknown>;
  const prohibited = ['credential', 'machineCredential', 'secret', 'token', 'authorization'];
  for (const p of prohibited) {
      if (p in stored) throw new Error(`Prohibited field found: ${p}`);
  }
});

// 18. adapter never calls set
registerTest('18. adapter never calls set', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultRepository.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  // Check for Firestore set() on a document reference
  if (source.includes('.doc(') && source.includes('.set(')) throw new Error('set() call found');
});

// 19. adapter only updates authoritative task status via transaction during convergence
registerTest('19. adapter only updates authoritative task status via transaction during convergence', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultRepository.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  // Avoid false positive with createHash().update()
  const lines = source.split('\n');
  for (const line of lines) {
      if (line.includes('.update(') && !line.includes('createHash') && !line.includes('transaction.update(taskDoc.ref')) {
          throw new Error(`Unexpected update() call found: ${line}`);
      }
  }
});

// 20. adapter never calls delete
registerTest('20. adapter never calls delete', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultRepository.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes('.delete(')) throw new Error('delete() call found');
});

// 21. adapter never calls add
registerTest('21. adapter never calls add', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultRepository.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes('.add(')) throw new Error('add() call found');
});

// 22. adapter does not mutate input record
registerTest('22. adapter does not mutate input record', async () => {
  const record = createValidCanonicalRecord('task-1');
  const originalJson = JSON.stringify(record);
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  await repo.save(record);
  if (JSON.stringify(record) !== originalJson) throw new Error('Input mutated');
});

// 23. existing-document create failure propagates the exact same error object
registerTest('23. existing-document create failure propagates the exact same error object', async () => {
  const taskId = 'task-1';
  const record = createValidCanonicalRecord(taskId);
  const db = new RecordingDatabase();
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const doc = col.doc(deriveAdvisoryResultDocumentId(taskId)) as RecordingDocument;
  
  // Pre-seed
  await doc.create({ existing: true });
  const expectedError = doc.alreadyExistsError;
  
  const repo = new FirestoreAdvisoryResultRepository(db);
  try {
    await repo.save(record);
    throw new Error('Should have thrown');
  } catch (err: unknown) {
    if (err !== expectedError) throw new Error('Error identity mismatch');
  }
});

// 24. sequential first save succeeds and second same-task save fails
registerTest('24. sequential first save succeeds and second same-task save fails', async () => {
  const record = createValidCanonicalRecord('task-1');
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  
  await repo.save(record); // Success
  try {
    await repo.save(record); // Fail
    throw new Error('Second save should have failed');
  } catch (err: unknown) {
    if (!(err instanceof FirestoreAlreadyExistsError)) throw new Error('Unexpected error type');
  }
});

// 25. second same-task save does not overwrite first stored record
registerTest('25. second same-task save does not overwrite first stored record', async () => {
  const taskId = 'task-1';
  const record1 = createValidCanonicalRecord(taskId);
  const record2 = { ...record1, reconciledTask: { ...record1.reconciledTask, contentSnapshot: { changed: true } } };
  
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  
  await repo.save(record1);
  try {
    await repo.save(record2);
    throw new Error('Second save should have thrown');
  } catch (err: unknown) {
    if (!(err instanceof FirestoreAlreadyExistsError)) throw new Error('Expected AlreadyExistsError');
  }
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const docId = deriveAdvisoryResultDocumentId(taskId);
  const doc = col.doc(docId) as RecordingDocument;
  
  if (doc.successfulCreateCount !== 1) throw new Error(`Successful creates: ${doc.successfulCreateCount}`);
  
  const stored = doc.getStoredData();
  if (JSON.stringify(stored) !== JSON.stringify(record1)) {
      throw new Error('Original record was overwritten');
  }
});

// 26. divergent second record for same taskId cannot overwrite first record
registerTest('26. divergent second record for same taskId cannot overwrite first record', async () => {
  const taskId = 'task-1';
  const record1 = createValidCanonicalRecord(taskId);
  const record2: ReconciledAdvisoryResultPersistenceRecord = { 
      ...record1, 
      principal: { ...record1.principal, principalId: 'node-2' } 
  };
  
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  
  await repo.save(record1);
  try {
    await repo.save(record2);
    throw new Error('Second save should have thrown');
  } catch (err: unknown) {
    if (!(err instanceof FirestoreAlreadyExistsError)) throw new Error('Expected AlreadyExistsError');
  }
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const docId = deriveAdvisoryResultDocumentId(taskId);
  const doc = col.doc(docId) as RecordingDocument;
  
  if (doc.successfulCreateCount !== 1) throw new Error(`Successful creates: ${doc.successfulCreateCount}`);
  
  const stored = doc.getStoredData();
  if (JSON.stringify(stored) !== JSON.stringify(record1)) {
      throw new Error('Divergent record overwrote original!');
  }
});

// 27. same record second save also fails at repository create-only layer
registerTest('27. same record second save also fails at repository create-only layer', async () => {
  const record = createValidCanonicalRecord('task-1');
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  
  await repo.save(record);
  try {
    await repo.save(record);
    throw new Error('Should fail even for identical record at repo layer');
  } catch (err: unknown) {
      if (!(err instanceof FirestoreAlreadyExistsError)) throw new Error('Expected AlreadyExistsError');
  }
});

// 28. source contains no firebase-admin import
registerTest('28. source contains no firebase-admin import', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultRepository.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes('firebase-admin')) throw new Error('firebase-admin import found');
});

// 29. source contains no @google-cloud/firestore direct import
registerTest('29. source contains no @google-cloud/firestore direct import', async () => {
  const filePath = path.join(process.cwd(), 'functions/src/peia/firestoreAdvisoryResultRepository.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes('@google-cloud/firestore')) throw new Error('@google-cloud/firestore import found');
});

// 30. concurrent first-write race cannot overwrite existing advisory result
registerTest('30. concurrent first-write race cannot overwrite existing advisory result', async () => {
  const taskId = 'task-race-1';
  const record1 = createValidCanonicalRecord(taskId);
  const record2: ReconciledAdvisoryResultPersistenceRecord = {
      ...record1,
      principal: { ...record1.principal, principalId: 'node-race-loser' }
  };
  
  const db = new RecordingDatabase();
  const repo = new FirestoreAdvisoryResultRepository(db);
  
  const results = await Promise.allSettled([
      repo.save(record1),
      repo.save(record2)
  ]);
  
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<void> => r.status === 'fulfilled');
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  
  if (fulfilled.length !== 1) throw new Error(`Fulfilled: ${fulfilled.length}`);
  if (rejected.length !== 1) throw new Error(`Rejected: ${rejected.length}`);
  
  const rejectReason = rejected[0].reason;
  if (!(rejectReason instanceof FirestoreAlreadyExistsError)) throw new Error('Wrong reject reason');
  
  const col = db.collection(PEIA_ADVISORY_RESULT_COLLECTION) as RecordingCollection;
  const docId = deriveAdvisoryResultDocumentId(taskId);
  const doc = col.doc(docId) as RecordingDocument;
  
  if (doc.successfulCreateCount !== 1) throw new Error(`Successful creates: ${doc.successfulCreateCount}`);
  if (doc.createCalls !== 2) throw new Error(`createCalls: ${doc.createCalls}`);
  
  // Determine winner from promise results
  let expectedWinner: ReconciledAdvisoryResultPersistenceRecord;
  let expectedLoser: ReconciledAdvisoryResultPersistenceRecord;
  
  if (results[0].status === 'fulfilled') {
      expectedWinner = record1;
      expectedLoser = record2;
  } else {
      expectedWinner = record2;
      expectedLoser = record1;
  }

  const stored = doc.getStoredData();
  if (JSON.stringify(stored) !== JSON.stringify(expectedWinner)) {
      throw new Error('Stored record does not match the winner');
  }
  if (JSON.stringify(stored) === JSON.stringify(expectedLoser)) {
      throw new Error('Stored record matches the loser');
  }
  
  // Final get check
  const readBack = await repo.findByTaskId(taskId);
  if (JSON.stringify(readBack) !== JSON.stringify(expectedWinner)) {
      throw new Error('Read-back record does not match the winner');
  }
});

async function runTests() {
  console.log('Running PEIA Firestore Advisory Result Repository Tests (Hardened)...');
  for (const test of tests) {
    try {
      await test.run();
      console.log(`PASSED: ${test.name}`);
      passedCount++;
    } catch (err) {
      console.error(`FAILED: ${test.name}`);
      console.error(err);
      failedCount++;
    }
  }

  console.log('\n==================================================');
  console.log(`SUMMARY: ${passedCount} passed / ${tests.length} total / ${failedCount} failed`);
  console.log('==================================================\n');

  if (failedCount > 0 || tests.length < 30) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
