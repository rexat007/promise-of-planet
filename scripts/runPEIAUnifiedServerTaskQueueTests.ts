import { AITaskStatus, AITaskType } from '../functions/src/types/aiTask';
import {
  AIReviewTargetType,
  AIReviewSeverity,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
} from '../functions/src/shared/aiReviewContract';
import { validateAIReviewTask } from '../functions/src/peia/aiTaskValidator';
import { prepareAIReviewTaskForDelivery } from '../functions/src/peia/aiTaskDeliveryBoundary';
import {
  FirestorePendingTaskSource,
  PEIA_PENDING_TASK_COLLECTION,
} from '../functions/src/peia/firestorePendingTaskSource';
import { FirestoreAdvisoryResultTaskSource } from '../functions/src/peia/firestoreAdvisoryResultTaskSource';
import {
  FirestoreAdvisoryResultRepository,
  PEIA_ADVISORY_RESULT_COLLECTION,
  deriveAdvisoryResultDocumentId,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import {
  FirestoreNonAdvisoryOutcomeRepository,
  PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
  deriveNonAdvisoryOutcomeDocumentId,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomeRepository';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import {
  FirestorePeiaTaskQueueService,
  PeiaTaskQueueError,
  buildNewsTaskSnapshot,
  buildLibraryIntakeTaskSnapshot,
  derivePeiaTaskId,
  derivePeiaTaskDocumentId,
  computeFormattedWorkerEvidenceLength,
  MAX_WORKER_EVIDENCE_CONTEXT_CHARS,
  type PeiaTaskQueueFirestoreDatabase,
  type PeiaTaskQueueTransaction,
} from '../functions/src/peia/firestorePeiaTaskQueueService';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const results: TestResult[] = [];
let nextId = 1;

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  const id = nextId++;
  try {
    await fn();
    results.push({ id, name, passed: true });
  } catch (err: unknown) {
    results.push({
      id,
      name,
      passed: false,
      message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejectsWithQueueCode(
  fn: () => Promise<unknown> | unknown,
  expectedCode: string,
  context: string
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof PeiaTaskQueueError && err.code === expectedCode) {
      return;
    }
    const errObj = err as { name?: string; code?: string; message?: string };
    throw new Error(
      `${context}: expected PeiaTaskQueueError(${expectedCode}), got ${errObj?.name}(${errObj?.code}): ${errObj?.message}`
    );
  }
  throw new Error(`${context}: expected PeiaTaskQueueError(${expectedCode}), but succeeded.`);
}

function getNestedField(obj: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function cloneJson<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

interface TransactionRecord {
  readsBeforeWrite: boolean;
  reads: number;
  writes: number;
  retries: number;
  docRefsRead: string[];
  docRefsWritten: string[];
  queryFields: string[];
}

/**
 * In-memory Firestore implementation modeling real optimistic concurrency control (OCC)
 * with conflict detection and transaction retries when concurrent transactions contend
 * on the same document key.
 */
class InMemoryTransactionalFirestore implements PeiaTaskQueueFirestoreDatabase {
  readonly collections = new Map<string, Map<string, unknown>>();
  readonly accessedCollections: string[] = [];
  readonly transactionHistory: TransactionRecord[] = [];
  private readonly docVersions = new Map<string, number>();
  private commitCounter = 0;

  private getMap(name: string): Map<string, unknown> {
    this.accessedCollections.push(name);
    let col = this.collections.get(name);
    if (!col) {
      col = new Map<string, unknown>();
      this.collections.set(name, col);
    }
    return col;
  }

  private getDocVersion(collectionName: string, docId: string): number {
    return this.docVersions.get(`${collectionName}/${docId}`) ?? 0;
  }

  private bumpDocVersion(collectionName: string, docId: string): void {
    this.commitCounter++;
    this.docVersions.set(`${collectionName}/${docId}`, this.commitCounter);
  }

  seedDocument(collectionName: string, docId: string, data: unknown): void {
    let col = this.collections.get(collectionName);
    if (!col) {
      col = new Map<string, unknown>();
      this.collections.set(collectionName, col);
    }
    col.set(docId, cloneJson(data));
    this.bumpDocVersion(collectionName, docId);
  }

  readDocumentDirect(collectionName: string, docId: string): unknown | undefined {
    return this.collections.get(collectionName)?.get(docId);
  }

  countDocuments(collectionName: string): number {
    return this.collections.get(collectionName)?.size ?? 0;
  }

  collection(collectionName: string): any {
    const colMap = this.getMap(collectionName);

    const buildQuery = (
      filters: { field: string; op: string; value: unknown }[],
      orderings: { field: string; direction: 'asc' | 'desc' }[],
      limitCount?: number
    ): any => {
      const execute = () => {
        let entries = Array.from(colMap.entries()).map(([id, data]) => ({
          id,
          data: cloneJson(data),
        }));

        for (const f of filters) {
          entries = entries.filter((entry) => {
            const actual = getNestedField(entry.data, f.field);
            if (f.op === '==') {
              return actual === f.value;
            }
            return false;
          });
        }

        if (orderings.length > 0) {
          entries.sort((a, b) => {
            for (const o of orderings) {
              const va = String(getNestedField(a.data, o.field) ?? '');
              const vb = String(getNestedField(b.data, o.field) ?? '');
              if (va < vb) return o.direction === 'asc' ? -1 : 1;
              if (va > vb) return o.direction === 'asc' ? 1 : -1;
            }
            return 0;
          });
        }

        if (limitCount !== undefined) {
          entries = entries.slice(0, limitCount);
        }

        return {
          docs: entries.map((e) => ({
            exists: true,
            ref: { id: e.id, __collection: collectionName },
            data: () => cloneJson(e.data),
          })),
        };
      };

      return {
        __isQuery: true,
        __collection: collectionName,
        __filters: filters,
        __execute: execute,
        where(field: string, op: string, value: unknown) {
          return buildQuery([...filters, { field, op, value }], orderings, limitCount);
        },
        orderBy(field: string, direction: 'asc' | 'desc') {
          return buildQuery(filters, [...orderings, { field, direction }], limitCount);
        },
        limit(count: number) {
          return buildQuery(filters, orderings, count);
        },
        async get() {
          return execute();
        },
      };
    };

    return {
      doc(documentId: string) {
        return {
          __isDocRef: true,
          __collection: collectionName,
          id: documentId,
          async get() {
            const exists = colMap.has(documentId);
            const raw = colMap.get(documentId);
            return {
              exists,
              ref: { id: documentId, __collection: collectionName },
              data: () => (exists ? cloneJson(raw) : undefined),
            };
          },
        };
      },
      where(field: string, op: string, value: unknown) {
        return buildQuery([{ field, op, value }], [], undefined);
      },
      orderBy(field: string, direction: 'asc' | 'desc') {
        return buildQuery([], [{ field, direction }], undefined);
      },
      limit(count: number) {
        return buildQuery([], [], count);
      },
    };
  }

  async runTransaction<T>(
    updateFunction: (transaction: PeiaTaskQueueTransaction) => Promise<T>
  ): Promise<T> {
    const maxAttempts = 10;
    let retries = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let hasWritten = false;
      let readsBeforeWrite = true;
      let reads = 0;
      let writes = 0;
      const docRefsRead: string[] = [];
      const docRefsWritten: string[] = [];
      const queryFields: string[] = [];
      const readSetVersions = new Map<string, number>();
      const writeSetKeys = new Set<string>();
      const stagedWrites: (() => void)[] = [];

      const tx: any = {
        get: async (target: any) => {
          if (hasWritten) {
            readsBeforeWrite = false;
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          reads++;
          // Yield to microtask queue so concurrent transactions interleave their reads
          await Promise.resolve();

          if (target && target.__isQuery) {
            for (const f of target.__filters ?? []) {
              queryFields.push(f.field);
            }
            const snap = target.__execute();
            for (const d of snap.docs) {
              const key = `${target.__collection}/${d.ref.id}`;
              if (!readSetVersions.has(key)) {
                readSetVersions.set(key, this.getDocVersion(target.__collection, d.ref.id));
              }
            }
            return snap;
          }
          if (target && target.__isDocRef) {
            const key = `${target.__collection}/${target.id}`;
            docRefsRead.push(key);
            if (!readSetVersions.has(key)) {
              readSetVersions.set(key, this.getDocVersion(target.__collection, target.id));
            }
            const col = this.getMap(target.__collection);
            const exists = col.has(target.id);
            const val = col.get(target.id);
            return {
              exists,
              ref: { id: target.id, __collection: target.__collection },
              data: () => (exists ? cloneJson(val) : undefined),
            };
          }
          throw new Error('Unsupported transaction.get target');
        },
        create: (docRef: any, data: unknown) => {
          hasWritten = true;
          writes++;
          const key = `${docRef.__collection}/${docRef.id}`;
          docRefsWritten.push(key);
          writeSetKeys.add(key);
          if (!readSetVersions.has(key)) {
            readSetVersions.set(key, this.getDocVersion(docRef.__collection, docRef.id));
          }
          stagedWrites.push(() => {
            const col = this.getMap(docRef.__collection);
            if (col.has(docRef.id)) {
              throw new Error(`Document ${docRef.__collection}/${docRef.id} already exists.`);
            }
            col.set(docRef.id, cloneJson(data));
            this.bumpDocVersion(docRef.__collection, docRef.id);
          });
          return tx;
        },
        set: (docRef: any, data: unknown) => {
          hasWritten = true;
          writes++;
          const key = `${docRef.__collection}/${docRef.id}`;
          docRefsWritten.push(key);
          writeSetKeys.add(key);
          if (!readSetVersions.has(key)) {
            readSetVersions.set(key, this.getDocVersion(docRef.__collection, docRef.id));
          }
          stagedWrites.push(() => {
            const col = this.getMap(docRef.__collection);
            col.set(docRef.id, cloneJson(data));
            this.bumpDocVersion(docRef.__collection, docRef.id);
          });
          return tx;
        },
        update: (docRef: any, patch: Record<string, unknown>) => {
          hasWritten = true;
          writes++;
          const key = `${docRef.__collection}/${docRef.id}`;
          docRefsWritten.push(key);
          writeSetKeys.add(key);
          if (!readSetVersions.has(key)) {
            readSetVersions.set(key, this.getDocVersion(docRef.__collection, docRef.id));
          }
          stagedWrites.push(() => {
            const col = this.getMap(docRef.__collection);
            const existing = col.get(docRef.id);
            if (!existing || typeof existing !== 'object') {
              throw new Error(`Document ${docRef.__collection}/${docRef.id} does not exist for update.`);
            }
            col.set(docRef.id, { ...(existing as Record<string, unknown>), ...cloneJson(patch) });
            this.bumpDocVersion(docRef.__collection, docRef.id);
          });
          return tx;
        },
      };

      const result = await updateFunction(tx);

      // Optimistic concurrency control check at commit time:
      // Verify that no document in readSetVersions changed since it was read
      let hasConflict = false;
      for (const [key, observedVersion] of readSetVersions.entries()) {
        const currentVersion = this.docVersions.get(key) ?? 0;
        if (currentVersion !== observedVersion) {
          hasConflict = true;
          break;
        }
      }

      if (hasConflict) {
        retries++;
        continue;
      }

      for (const applyWrite of stagedWrites) {
        applyWrite();
      }
      this.transactionHistory.push({
        readsBeforeWrite,
        reads,
        writes,
        retries,
        docRefsRead,
        docRefsWritten,
        queryFields,
      });
      return result;
    }

    throw new Error('Transaction exceeded maximum retry attempts due to contention.');
  }
}

async function main() {
  // 1. News snapshot compatibility
  await runTest('1. News snapshot compatibility with worker & blank optional summary omission', async () => {
    const built = buildNewsTaskSnapshot({
      targetId: 'news-101',
      sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
      title: '  Solar Desalination Expansion in Coastal Municipalities  ',
      body: 'Line 1 of article.\r\nLine 2 of article with facts.\rLine 3.',
      summary: '   \r\n   ',
    });

    assert(built.target.targetType === AIReviewTargetType.News, 'Expected News targetType');
    assert(built.target.targetId === 'news-101', 'Expected targetId news-101');
    assert(built.contentSnapshot.allowSnapshotEvidence === true, 'Expected allowSnapshotEvidence: true');
    assert(
      built.contentSnapshot.title === 'Solar Desalination Expansion in Coastal Municipalities',
      'Expected trimmed title'
    );
    assert(
      built.contentSnapshot.body === 'Line 1 of article.\nLine 2 of article with facts.\nLine 3.',
      'Expected normalized LF body'
    );
    assert(!('summary' in built.contentSnapshot), 'Expected blank summary key to be omitted');

    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T10:05:00.000Z',
    });
    const enqueued = await service.enqueueNewsTask({
      targetId: 'news-101',
      sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
      title: 'Solar Desalination Expansion in Coastal Municipalities',
      body: 'Line 1 of article.\r\nLine 2 of article with facts.',
      summary: 'Key summary of solar desalination project.',
    });

    const deliverable = prepareAIReviewTaskForDelivery(enqueued.task);
    assert(deliverable.status === AITaskStatus.Pending, 'Deliverable Pending task');
    assert(
      deliverable.contentSnapshot['summary'] === 'Key summary of solar desalination project.',
      'Expected non-empty summary preserved'
    );
  });

  // 2. LibraryIntake MetadataOnly compatibility
  await runTest('2. LibraryIntake MetadataOnly compatibility & prohibition of excerpt/summaries', async () => {
    const built = buildLibraryIntakeTaskSnapshot({
      targetId: 'intake-201',
      sourceUpdatedAt: '2026-11-01T11:00:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: '  UNEP Emissions Gap Report 2026  ',
      issuingOrganization: '  United Nations Environment Programme (UNEP)  ',
      language: 'en',
      notes: '  Submitted by regional desk.\r\nVerify annex tables.  ',
      sourceNotes: '   ',
    });

    assert(built.target.targetType === AIReviewTargetType.LibraryIntake, 'Expected LibraryIntake');
    assert(built.contentSnapshot.allowSnapshotEvidence === true, 'Expected allowSnapshotEvidence: true');
    assert(
      built.contentSnapshot.inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly,
      'Expected MetadataOnly'
    );
    assert(!('suppliedExcerpt' in built.contentSnapshot), 'Expected suppliedExcerpt omitted');
    assert(!('sourceNotes' in built.contentSnapshot), 'Expected blank sourceNotes omitted');
    assert(
      built.contentSnapshot.notes === 'Submitted by regional desk.\nVerify annex tables.',
      'Expected normalized notes'
    );

    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T11:05:00.000Z',
    });
    const enqueued = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-201',
      sourceUpdatedAt: '2026-11-01T11:00:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'UNEP Emissions Gap Report 2026',
      issuingOrganization: 'United Nations Environment Programme (UNEP)',
      language: 'en',
      notes: 'Submitted by regional desk.\nVerify annex tables.',
    });

    assert(
      enqueued.task.contentSnapshot['inputBasis'] === PEIALibraryPreparationInputBasis.MetadataOnly,
      'MetadataOnly basis preserved'
    );
    assert(!('suppliedExcerpt' in enqueued.task.contentSnapshot), 'No suppliedExcerpt in MetadataOnly');

    await assertRejectsWithQueueCode(
      () =>
        buildLibraryIntakeTaskSnapshot({
          targetId: 'intake-201',
          sourceUpdatedAt: '2026-11-01T11:00:00.000Z',
          inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
          title: 'UNEP Report',
          suppliedExcerpt: 'Should not be allowed in MetadataOnly',
        }),
      'INVALID_SNAPSHOT_INPUT',
      'MetadataOnly with suppliedExcerpt'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildLibraryIntakeTaskSnapshot({
          targetId: 'intake-201',
          sourceUpdatedAt: '2026-11-01T11:00:00.000Z',
          inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
          title: 'UNEP Report',
          suggestedSummaryEn: 'Fabricated summary',
        } as unknown),
      'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
      'MetadataOnly with prohibited summary field'
    );
  });

  // 3. LibraryIntake excerpt compatibility
  await runTest('3. LibraryIntake SuppliedExcerptAndMetadata compatibility with worker', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T11:10:00.000Z',
    });

    const enqueued = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-202',
      sourceUpdatedAt: '2026-11-01T11:00:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'IPCC Special Assessment on Urban Heat Islands',
      issuingOrganization: 'IPCC',
      language: 'bilingual',
      notes: 'Includes Arabic executive summary.',
      sourceNotes: 'Official UN repository.',
      suppliedExcerpt: 'Executive Summary:\r\nUrban green infrastructure reduces peak surface temperatures by 2.5C.',
    });

    assert(
      enqueued.task.contentSnapshot['inputBasis'] ===
        PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      'SuppliedExcerptAndMetadata basis preserved'
    );
    assert(
      enqueued.task.contentSnapshot['suppliedExcerpt'] ===
        'Executive Summary:\nUrban green infrastructure reduces peak surface temperatures by 2.5C.',
      'Normalized excerpt preserved'
    );
    const formattedLength = computeFormattedWorkerEvidenceLength(
      enqueued.task.target,
      enqueued.task.contentSnapshot
    );
    assert(
      formattedLength > 0 && formattedLength <= MAX_WORKER_EVIDENCE_CONTEXT_CHARS,
      'Formatted evidence block fits within worker 8000-char limit'
    );
  });

  // 4. Rejection of malformed and oversized snapshots
  await runTest('4. Rejection of malformed and oversized snapshots', async () => {
    await assertRejectsWithQueueCode(
      () =>
        buildNewsTaskSnapshot({
          targetId: 'news-err-1',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          title: 'Valid Title',
          body: '   \n\t  ',
        }),
      'INVALID_SNAPSHOT_INPUT',
      'Blank News body'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildNewsTaskSnapshot({
          targetId: 'news-err-2',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          title: 'Line 1\nLine 2',
          body: 'Valid body text.',
        }),
      'INVALID_SNAPSHOT_INPUT',
      'Multi-line News title'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildNewsTaskSnapshot({
          targetId: 'news-err-3',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          title: 'Valid Title',
          body: 'Valid text with \x00 null byte',
        }),
      'INVALID_SNAPSHOT_INPUT',
      'Null byte in body'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildLibraryIntakeTaskSnapshot({
          targetId: 'intake-err-1',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
          title: 'Valid Title',
          suppliedExcerpt: '   ',
        }),
      'INVALID_SNAPSHOT_INPUT',
      'Blank suppliedExcerpt in SuppliedExcerptAndMetadata mode'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildNewsTaskSnapshot({
          targetId: 'news-err-4',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          title: 'Valid Title',
          body: 'Valid body',
          taskId: 'client-injected-id',
        } as unknown),
      'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
      'Client-injected taskId'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildNewsTaskSnapshot({
          targetId: 'news-err-5',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          title: 'Valid Title',
          body: 'A'.repeat(7000),
        }),
      'SNAPSHOT_OVERSIZED',
      'Oversized News body'
    );

    await assertRejectsWithQueueCode(
      () =>
        buildLibraryIntakeTaskSnapshot({
          targetId: 'intake-err-2',
          sourceUpdatedAt: '2026-11-01T10:00:00.000Z',
          inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
          title: 'T'.repeat(280),
          issuingOrganization: 'O'.repeat(280),
          notes: 'N'.repeat(1950),
          sourceNotes: 'S'.repeat(1450),
          suppliedExcerpt: 'E'.repeat(5500),
        }),
      'SNAPSHOT_OVERSIZED',
      'Combined LibraryIntake fields exceeding 8000-char formatted worker context limit'
    );
  });

  // 5. Canonical CONTENT_REVIEW validation
  await runTest('5. Canonical CONTENT_REVIEW validation & exact top-level/target keys', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T12:00:00.000Z',
    });

    const newsRes = await service.enqueueNewsTask({
      targetId: 'news-501',
      sourceUpdatedAt: '2026-11-01T11:50:00.000Z',
      title: 'Canonical News Task',
      body: 'Verified body text.',
    });

    const intakeRes = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-501',
      sourceUpdatedAt: '2026-11-01T11:55:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'Canonical LibraryIntake Task',
    });

    for (const res of [newsRes, intakeRes]) {
      const validated = validateAIReviewTask(res.task);
      assert(validated.taskType === AITaskType.CONTENT_REVIEW, 'Expected CONTENT_REVIEW');
      assert(validated.status === AITaskStatus.Pending, 'Expected Pending');
      assert(
        JSON.stringify(Object.keys(validated).sort()) ===
          JSON.stringify(['contentSnapshot', 'createdAt', 'status', 'target', 'taskId', 'taskType']),
        'Exact top-level keys'
      );
      assert(
        JSON.stringify(Object.keys(validated.target).sort()) ===
          JSON.stringify(['sourceUpdatedAt', 'targetId', 'targetType']),
        'Exact target keys'
      );
      const formattedLen = computeFormattedWorkerEvidenceLength(
        validated.target,
        validated.contentSnapshot
      );
      assert(
        formattedLen <= MAX_WORKER_EVIDENCE_CONTEXT_CHARS,
        `Expected formatted length <= ${MAX_WORKER_EVIDENCE_CONTEXT_CHARS}`
      );
    }
  });

  // 6. Deterministic task and document identity (News & LibraryIntake follow strict targetType+targetId+sourceUpdatedAt rule)
  await runTest('6. Deterministic taskId (strictly targetType+targetId+sourceUpdatedAt) and sha256(taskId) document identity', () => {
    const s1 = buildNewsTaskSnapshot({
      targetId: 'news-601',
      sourceUpdatedAt: '2026-11-01T12:00:00.000Z',
      title: 'Deterministic Title',
      body: 'Line A\r\nLine B',
    });
    const s2 = buildNewsTaskSnapshot({
      targetId: 'news-601',
      sourceUpdatedAt: '2026-11-01T12:00:00.000Z',
      title: '  Deterministic Title  ',
      body: 'Line A\nLine B',
      summary: '   ',
    });
    const s2DifferentSnapshot = buildNewsTaskSnapshot({
      targetId: 'news-601',
      sourceUpdatedAt: '2026-11-01T12:00:00.000Z',
      title: 'Different Title At Same Source Version',
      body: 'Completely different body text.',
    });

    // Requirement 1: Same source version + identical snapshot => same taskId
    const taskId1 = derivePeiaTaskId(s1.target, s1.contentSnapshot);
    const taskId2 = derivePeiaTaskId(s2.target, s2.contentSnapshot);
    assert(taskId1 === taskId2, 'Same source version + identical snapshot must yield identical taskId');

    // Requirement 2: Same source version + different snapshot => same taskId
    const taskId2Diff = derivePeiaTaskId(s2DifferentSnapshot.target, s2DifferentSnapshot.contentSnapshot);
    assert(
      taskId1 === taskId2Diff,
      'Same source version + different snapshot must yield identical taskId'
    );

    // Requirement 14: News and LibraryIntake both follow the same identity rule
    const libA = buildLibraryIntakeTaskSnapshot({
      targetId: 'intake-601',
      sourceUpdatedAt: '2026-11-01T12:00:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'Library Intake Item',
      suppliedExcerpt: 'Excerpt A',
    });
    const libB = buildLibraryIntakeTaskSnapshot({
      targetId: 'intake-601',
      sourceUpdatedAt: '2026-11-01T12:00:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'Library Intake Item',
      suppliedExcerpt: 'Excerpt B',
    });
    const libTaskIdA = derivePeiaTaskId(libA.target, libA.contentSnapshot);
    const libTaskIdB = derivePeiaTaskId(libB.target, libB.contentSnapshot);
    assert(
      libTaskIdA === libTaskIdB,
      'LibraryIntake with same source version and different suppliedExcerpt must yield identical taskId'
    );
    assert(
      derivePeiaTaskDocumentId(libTaskIdA) === derivePeiaTaskDocumentId(libTaskIdB),
      'LibraryIntake with same source version and different suppliedExcerpt must yield identical docId'
    );

    const docId1 = derivePeiaTaskDocumentId(taskId1);
    assert(
      docId1 === deriveAdvisoryResultDocumentId(taskId1) &&
        docId1 === deriveNonAdvisoryOutcomeDocumentId(taskId1),
      'Task document ID convention matches advisory and non-advisory SHA-256(taskId) convention'
    );

    // Requirement 3: Different source version => different taskId
    const s3 = buildNewsTaskSnapshot({
      targetId: 'news-601',
      sourceUpdatedAt: '2026-11-01T12:01:00.000Z',
      title: 'Deterministic Title',
      body: 'Line A\nLine B',
    });
    const taskId3 = derivePeiaTaskId(s3.target, s3.contentSnapshot);
    assert(taskId1 !== taskId3, 'Different sourceUpdatedAt must yield distinct taskId');

    const libC = buildLibraryIntakeTaskSnapshot({
      targetId: 'intake-601',
      sourceUpdatedAt: '2026-11-01T12:01:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'Library Intake Item',
      suppliedExcerpt: 'Excerpt A',
    });
    const libTaskIdC = derivePeiaTaskId(libC.target, libC.contentSnapshot);
    assert(libTaskIdA !== libTaskIdC, 'Different LibraryIntake sourceUpdatedAt must yield distinct taskId');
  });

  // 7. Transactional idempotency & gateway queryability
  await runTest('7. Transactional idempotency preserves createdAt and gateway queryability (zero writes on repeat)', async () => {
    const db = new InMemoryTransactionalFirestore();
    let tick = 0;
    const timestamps = ['2026-11-01T13:00:00.000Z', '2026-11-01T13:05:00.000Z'];
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => timestamps[tick++] ?? '2026-11-01T13:10:00.000Z',
    });

    const input = {
      targetId: 'news-701',
      sourceUpdatedAt: '2026-11-01T12:30:00.000Z',
      title: 'Idempotent Article',
      body: 'Article body for idempotent test.',
    };

    const first = await service.enqueueNewsTask(input);
    const second = await service.enqueueNewsTask(input);

    assert(first.disposition === 'CREATED', 'First enqueue must be CREATED');
    assert(second.disposition === 'ALREADY_EXISTS', 'Second enqueue must be ALREADY_EXISTS');
    assert(first.task.taskId === second.task.taskId, 'taskId must match');
    assert(
      second.task.createdAt === '2026-11-01T13:00:00.000Z',
      'Second enqueue must not overwrite createdAt'
    );
    assert(db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 1, 'Exactly one document in peiaReviewTasks');
    assert(
      db.transactionHistory.every((t) => t.readsBeforeWrite),
      'All transaction reads executed before writes'
    );
    assert(db.transactionHistory[1].writes === 0, 'Second transaction performed zero writes');
    assert(
      db.transactionHistory.every((t) => !t.queryFields.includes('target.targetId')),
      'No historical target.targetId scan performed'
    );

    const pendingSource = new FirestorePendingTaskSource(db as any);
    const nextPending = (await pendingSource.fetchNextPendingTask()) as { taskId?: string } | null;
    assert(
      nextPending?.taskId === first.task.taskId,
      'FirestorePendingTaskSource retrieves the enqueued task'
    );

    const taskByIdSource = new FirestoreAdvisoryResultTaskSource(db as any);
    const fetchedById = (await taskByIdSource.fetchTaskById(first.task.taskId)) as {
      taskId?: string;
    } | null;
    assert(
      fetchedById?.taskId === first.task.taskId,
      'FirestoreAdvisoryResultTaskSource retrieves the enqueued task by taskId'
    );
  });

  // 8. Concurrent identical & divergent enqueue attempts with OCC contention/retry
  await runTest('8. Concurrent identical and divergent requests under OCC contention/retry', async () => {
    // 8A: Concurrent identical requests => 1 CREATED, 1 ALREADY_EXISTS, 1 document
    const dbIdentical = new InMemoryTransactionalFirestore();
    let clockSeq = 1;
    const serviceIdentical = new FirestorePeiaTaskQueueService(dbIdentical, {
      clock: () => `2026-11-01T14:00:0${clockSeq++}.000Z`,
    });

    const inputIdentical = {
      targetId: 'intake-801',
      sourceUpdatedAt: '2026-11-01T13:50:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'Concurrent Intake Test',
      suppliedExcerpt: 'Concurrent excerpt content.',
    };

    const [r1, r2] = await Promise.all([
      serviceIdentical.enqueueLibraryIntakeTask(inputIdentical),
      serviceIdentical.enqueueLibraryIntakeTask(inputIdentical),
    ]);

    const dispositions = [r1.disposition, r2.disposition].sort();
    assert(
      dispositions[0] === 'ALREADY_EXISTS' && dispositions[1] === 'CREATED',
      `Expected one CREATED and one ALREADY_EXISTS, got ${dispositions.join(', ')}`
    );
    assert(r1.task.taskId === r2.task.taskId, 'Both concurrent callers receive identical taskId');
    assert(r1.documentId === r2.documentId, 'Both concurrent callers use identical docId');
    assert(r1.task.createdAt === r2.task.createdAt, 'createdAt is preserved from first writer');
    assert(dbIdentical.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 1, 'Single document stored');
    assert(
      dbIdentical.transactionHistory.some((t) => t.retries >= 1),
      'Expected OCC contention retry on concurrent identical requests'
    );
    assert(
      dbIdentical.transactionHistory[0].docRefsRead[0] ===
        dbIdentical.transactionHistory[1].docRefsRead[0],
      'Both concurrent transactions read the exact same deterministic document reference'
    );

    // 8B: Concurrent divergent requests for same source version => 1 CREATED, 1 fails closed with TASK_PAYLOAD_CONFLICT
    const dbDivergent = new InMemoryTransactionalFirestore();
    let divClock = 1;
    const serviceDivergent = new FirestorePeiaTaskQueueService(dbDivergent, {
      clock: () => `2026-11-01T14:10:0${divClock++}.000Z`,
    });

    const outcomes = await Promise.allSettled([
      serviceDivergent.enqueueLibraryIntakeTask({
        targetId: 'intake-802',
        sourceUpdatedAt: '2026-11-01T14:00:00.000Z',
        inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        title: 'Concurrent Divergent Intake',
        suppliedExcerpt: 'Excerpt Version Alpha',
      }),
      serviceDivergent.enqueueLibraryIntakeTask({
        targetId: 'intake-802',
        sourceUpdatedAt: '2026-11-01T14:00:00.000Z',
        inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        title: 'Concurrent Divergent Intake',
        suppliedExcerpt: 'Excerpt Version Beta',
      }),
    ]);

    const fulfilled = outcomes.filter(
      (o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof serviceDivergent.enqueueLibraryIntakeTask>>> =>
        o.status === 'fulfilled'
    );
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');

    assert(fulfilled.length === 1, `Expected exactly 1 fulfilled creation, got ${fulfilled.length}`);
    assert(fulfilled[0].value.disposition === 'CREATED', 'Winning request must be CREATED');
    assert(rejected.length === 1, `Expected exactly 1 rejected request, got ${rejected.length}`);
    assert(
      rejected[0].reason instanceof PeiaTaskQueueError &&
        rejected[0].reason.code === 'TASK_PAYLOAD_CONFLICT',
      `Expected losing divergent request to fail with TASK_PAYLOAD_CONFLICT, got ${String(rejected[0].reason)}`
    );
    assert(
      dbDivergent.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 1,
      'At most one task document created under concurrent divergent requests'
    );
  });

  // 9. Payload divergence conflict & 25 / >25 historical target tasks regression
  await runTest('9. Divergent payloads under same source version fail closed even with 25 and >25 historical target tasks', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T15:00:00.000Z',
    });

    // Seed 25 historical tasks for intake-900 across earlier sourceUpdatedAt versions
    for (let i = 1; i <= 25; i++) {
      const minute = String(i).padStart(2, '0');
      await service.enqueueLibraryIntakeTask({
        targetId: 'intake-900',
        sourceUpdatedAt: `2026-10-01T10:${minute}:00.000Z`,
        inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
        title: `Historical Intake Version ${i}`,
      });
    }
    assert(db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 25, 'Expected 25 seeded historical tasks');

    // Enqueue version 26 with Excerpt A
    const v26 = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-900',
      sourceUpdatedAt: '2026-11-01T14:30:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'Current Intake Version 26',
      suppliedExcerpt: 'Original Excerpt A',
    });
    assert(v26.disposition === 'CREATED', 'Expected version 26 to be CREATED');

    // Requirement 8: With 25 historical target tasks present, different excerpt at same sourceUpdatedAt must fail with TASK_PAYLOAD_CONFLICT
    await assertRejectsWithQueueCode(
      () =>
        service.enqueueLibraryIntakeTask({
          targetId: 'intake-900',
          sourceUpdatedAt: '2026-11-01T14:30:00.000Z',
          inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
          title: 'Current Intake Version 26',
          suppliedExcerpt: 'Conflicting Excerpt B under identical sourceUpdatedAt',
        }),
      'TASK_PAYLOAD_CONFLICT',
      'Divergent LibraryIntake excerpt with 25 historical target tasks'
    );

    // Seed 15 more historical tasks so > 25 (41 total) tasks exist for intake-900
    for (let i = 26; i <= 40; i++) {
      const minute = String(i).padStart(2, '0');
      await service.enqueueLibraryIntakeTask({
        targetId: 'intake-900',
        sourceUpdatedAt: `2026-10-01T10:${minute}:00.000Z`,
        inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
        title: `Historical Intake Version ${i}`,
      });
    }
    assert(db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 41, 'Expected >25 (41) tasks for target');

    // Requirement 9: With >25 historical target tasks present, different excerpt at same sourceUpdatedAt must STILL fail with TASK_PAYLOAD_CONFLICT
    await assertRejectsWithQueueCode(
      () =>
        service.enqueueLibraryIntakeTask({
          targetId: 'intake-900',
          sourceUpdatedAt: '2026-11-01T14:30:00.000Z',
          inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
          title: 'Current Intake Version 26',
          suppliedExcerpt: 'Conflicting Excerpt C with >25 historical tasks',
        }),
      'TASK_PAYLOAD_CONFLICT',
      'Divergent LibraryIntake excerpt with >25 historical target tasks'
    );

    // Requirement 12: Verify zero historical target scans (`target.targetId`) occurred across all transactions
    assert(
      db.transactionHistory.every((t) => !t.queryFields.includes('target.targetId')),
      'Conflict detection must never perform a historical target.targetId scan'
    );

    // Also verify News payload divergence at same sourceUpdatedAt
    const firstNews = await service.enqueueNewsTask({
      targetId: 'news-901',
      sourceUpdatedAt: '2026-11-01T14:30:00.000Z',
      title: 'Original Title',
      body: 'Original body content.',
    });

    await assertRejectsWithQueueCode(
      () =>
        service.enqueueNewsTask({
          targetId: 'news-901',
          sourceUpdatedAt: '2026-11-01T14:30:00.000Z',
          title: 'Original Title',
          body: 'Mutated body content under same sourceUpdatedAt.',
        }),
      'TASK_PAYLOAD_CONFLICT',
      'Divergent News snapshot under same (targetType, targetId, sourceUpdatedAt)'
    );

    db.seedDocument(PEIA_PENDING_TASK_COLLECTION, firstNews.documentId, {
      ...firstNews.task,
      contentSnapshot: {
        ...firstNews.task.contentSnapshot,
        body: 'Tampered body in storage under identical taskId',
      },
    });

    await assertRejectsWithQueueCode(
      () =>
        service.enqueueNewsTask({
          targetId: 'news-901',
          sourceUpdatedAt: '2026-11-01T14:30:00.000Z',
          title: 'Original Title',
          body: 'Original body content.',
        }),
      'TASK_PAYLOAD_CONFLICT',
      'Divergent payload stored under identical taskId'
    );
  });

  // 10. No rewriting existing Completed/Failed tasks
  await runTest('10. Enqueue does not overwrite existing Completed or Failed tasks', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T16:00:00.000Z',
    });

    const newsInput = {
      targetId: 'news-1001',
      sourceUpdatedAt: '2026-11-01T15:30:00.000Z',
      title: 'Completed News Item',
      body: 'Body of completed news item.',
    };

    const created = await service.enqueueNewsTask(newsInput);

    const advisoryRepo = new FirestoreAdvisoryResultRepository(db as any);
    await advisoryRepo.saveWithTaskConvergence({
      taskId: created.task.taskId,
      reconciledTask: created.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
      },
      advisoryResult: {
        schemaVersion: 1,
        humanReviewRequired: true,
        task: {
          taskId: created.task.taskId,
          taskType: AITaskType.CONTENT_REVIEW,
          target: created.task.target,
        },
        assessment: {
          summary: 'Verified assessment summary.',
          findings: [
            {
              code: 'CONSISTENT_CLAIM',
              severity: AIReviewSeverity.Info,
              message: 'Claim is internally consistent.',
              evidenceIds: [`TASK_CONTENT_SNAPSHOT::news-${created.task.target.targetId}`],
            },
          ],
        },
        recommendations: ['Editor should verify primary ministry release.'],
        uncertainties: ['External dataset not inspected offline.'],
        limitations: ['Grounded strictly in task snapshot.'],
      },
    });

    const replayCompleted = await service.enqueueNewsTask(newsInput);
    assert(replayCompleted.disposition === 'ALREADY_EXISTS', 'Expected ALREADY_EXISTS');
    assert(
      replayCompleted.task.status === AITaskStatus.Completed,
      'Completed status must not be overwritten to Pending'
    );
    assert(
      replayCompleted.task.createdAt === '2026-11-01T16:00:00.000Z',
      'createdAt must not be overwritten'
    );

    // Divergent snapshot against an existing Completed task must also fail closed with TASK_PAYLOAD_CONFLICT
    await assertRejectsWithQueueCode(
      () =>
        service.enqueueNewsTask({
          ...newsInput,
          body: 'Attempted modification of Completed task snapshot',
        }),
      'TASK_PAYLOAD_CONFLICT',
      'Divergent snapshot against Completed task'
    );

    const intakeInput = {
      targetId: 'intake-1002',
      sourceUpdatedAt: '2026-11-01T15:40:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'Failed Intake Item',
    };
    const createdFailed = await service.enqueueLibraryIntakeTask(intakeInput);
    const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(db as any);
    await nonAdvisoryRepo.saveWithTaskConvergence({
      taskId: createdFailed.task.taskId,
      reconciledTask: createdFailed.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      },
      nonAdvisoryOutcome: {
        taskId: createdFailed.task.taskId,
        kind: 'MODEL_FAILURE',
        reason: 'TIMEOUT',
        modelAttempts: 2,
        createdAt: '2026-11-01T16:02:00.000Z',
        detail: 'Local model timed out after 2 attempts.',
      },
      convergedStatus: AITaskStatus.Failed,
      convergedAt: '2026-11-01T16:02:05.000Z',
    });

    const replayFailed = await service.enqueueLibraryIntakeTask(intakeInput);
    assert(replayFailed.disposition === 'ALREADY_EXISTS', 'Expected ALREADY_EXISTS');
    assert(
      replayFailed.task.status === AITaskStatus.Failed,
      'Failed status must not be overwritten to Pending'
    );

    // Divergent snapshot against an existing Failed task must also fail closed with TASK_PAYLOAD_CONFLICT
    await assertRejectsWithQueueCode(
      () =>
        service.enqueueLibraryIntakeTask({
          ...intakeInput,
          title: 'Attempted modification of Failed task snapshot',
        }),
      'TASK_PAYLOAD_CONFLICT',
      'Divergent snapshot against Failed task'
    );
  });

  // 11. Read-only status reconciliation (NotRequested, Pending, Completed, Failed)
  await runTest('11. Read-only status reconciliation for NotRequested, Pending, Completed, and Failed', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T17:00:00.000Z',
    });

    const notReq = await service.reconcileTaskStatus({
      taskId: 'peia-task-nonexistent0000000000000000',
      targetType: AIReviewTargetType.News,
      targetId: 'news-1100',
      currentSourceUpdatedAt: '2026-11-01T16:50:00.000Z',
    });
    assert(notReq.status === 'NotRequested', 'Expected NotRequested');
    assert(notReq.isStale === false, 'NotRequested isStale must be false');

    const intakeEnqueued = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-1101',
      sourceUpdatedAt: '2026-11-01T16:50:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
      title: 'Biodiversity Baseline 2026',
      suppliedExcerpt: 'Wetland restoration increased avian diversity by 18%.',
    });

    const pendingStatus = await service.reconcileTaskStatus({
      taskId: intakeEnqueued.task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: 'intake-1101',
      currentSourceUpdatedAt: '2026-11-01T16:50:00.000Z',
    });
    assert(pendingStatus.status === AITaskStatus.Pending, 'Expected Pending');
    assert(pendingStatus.isStale === false, 'Expected non-stale Pending');

    const advisoryRepo = new FirestoreAdvisoryResultRepository(db as any);
    await advisoryRepo.saveWithTaskConvergence({
      taskId: intakeEnqueued.task.taskId,
      reconciledTask: intakeEnqueued.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
      },
      advisoryResult: {
        schemaVersion: 1,
        humanReviewRequired: true,
        task: {
          taskId: intakeEnqueued.task.taskId,
          taskType: AITaskType.CONTENT_REVIEW,
          target: intakeEnqueued.task.target,
        },
        assessment: {
          summary: 'Library intake excerpt evaluated offline.',
          findings: [
            {
              code: 'EXCERPT_GROUNDED',
              severity: AIReviewSeverity.Info,
              message: 'Excerpt supports wetland restoration claim.',
              evidenceIds: [`TASK_CONTENT_SNAPSHOT::intake-${intakeEnqueued.task.target.targetId}`],
            },
          ],
        },
        recommendations: ['Verify wetland survey methodology before cataloging.'],
        uncertainties: ['External dataset not inspected.'],
        limitations: ['Grounded only in supplied excerpt.'],
        libraryPreparation: {
          inputBasis: PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
          suggestedTitleAr: 'خط الأساس للتنوع البيولوجي ٢٠٢٦',
          suggestedTitleEn: 'Biodiversity Baseline 2026',
          suggestedIssuingOrganization: 'UNEP',
          suggestedDocumentType: PEIALibrarySuggestedDocumentType.InstitutionalReport,
          suggestedSummaryAr: 'يلخص آثار استعادة الأراضي الرطبة على تنوع الطيور.',
          suggestedSummaryEn: 'Summarizes wetland restoration impacts on avian diversity.',
          suggestedEnvironmentalDomains: ['Biodiversity'],
          suggestedTopicsAr: ['التنوع البيولوجي'],
          suggestedTopicsEn: ['Wetland restoration'],
          provenanceObservationsAr: ['مقتطف مقدم من المحرر'],
          provenanceObservationsEn: ['Editor-supplied excerpt only'],
          uncertaintyNoticesAr: ['لم يتم فحص الملف الكامل'],
          uncertaintyNoticesEn: ['Outside scope of excerpt'],
        },
      },
    });

    const completedStatus = await service.reconcileTaskStatus({
      taskId: intakeEnqueued.task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: 'intake-1101',
      currentSourceUpdatedAt: '2026-11-01T16:50:00.000Z',
    });
    if (
      completedStatus.status !== AITaskStatus.Completed ||
      completedStatus.completionKind !== 'ADVISORY'
    ) {
      throw new Error(`Expected Completed ADVISORY status, got ${completedStatus.status}`);
    }
    assert(completedStatus.nonAdvisoryOutcome === null, 'Expected nonAdvisoryOutcome === null on ADVISORY Completed');
    assert(
      completedStatus.advisoryResult.libraryPreparation?.suggestedTitleEn === 'Biodiversity Baseline 2026',
      'Expected libraryPreparation payload on Completed reconciliation'
    );

    const newsEnqueued = await service.enqueueNewsTask({
      targetId: 'news-1102',
      sourceUpdatedAt: '2026-11-01T16:55:00.000Z',
      title: 'Failed News Task',
      body: 'News body text.',
    });
    const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(db as any);
    await nonAdvisoryRepo.saveWithTaskConvergence({
      taskId: newsEnqueued.task.taskId,
      reconciledTask: newsEnqueued.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      },
      nonAdvisoryOutcome: {
        taskId: newsEnqueued.task.taskId,
        kind: 'MODEL_FAILURE',
        reason: 'NON_ZERO_EXIT',
        modelAttempts: 2,
        exitCode: 1,
        createdAt: '2026-11-01T17:05:00.000Z',
      },
      convergedStatus: AITaskStatus.Failed,
      convergedAt: '2026-11-01T17:05:01.000Z',
    });

    const failedStatus = await service.reconcileTaskStatus({
      taskId: newsEnqueued.task.taskId,
      targetType: AIReviewTargetType.News,
      targetId: 'news-1102',
      currentSourceUpdatedAt: '2026-11-01T16:55:00.000Z',
    });
    if (failedStatus.status !== AITaskStatus.Failed) {
      throw new Error(`Expected Failed status, got ${failedStatus.status}`);
    }
    assert(failedStatus.advisoryResult === null, 'Expected advisoryResult === null on Failed');
    assert(failedStatus.nonAdvisoryOutcome.reason === 'NON_ZERO_EXIT', 'Expected NON_ZERO_EXIT');
  });

  // 12. Missing advisory result integrity failure
  await runTest('12. Completed task with missing advisory result fails closed as integrity error', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T18:00:00.000Z',
    });

    const enqueued = await service.enqueueNewsTask({
      targetId: 'news-1201',
      sourceUpdatedAt: '2026-11-01T17:50:00.000Z',
      title: 'Missing Result Task',
      body: 'Body text.',
    });

    db.seedDocument(PEIA_PENDING_TASK_COLLECTION, enqueued.documentId, {
      ...enqueued.task,
      status: AITaskStatus.Completed,
    });

    await assertRejectsWithQueueCode(
      () =>
        service.reconcileTaskStatus({
          taskId: enqueued.task.taskId,
          targetType: AIReviewTargetType.News,
          targetId: 'news-1201',
          currentSourceUpdatedAt: '2026-11-01T17:50:00.000Z',
        }),
      'RECONCILIATION_INTEGRITY_ERROR',
      'Completed task missing advisory result artifact'
    );
  });

  // 13. Conflicting advisory/non-advisory artifacts failure
  await runTest('13. Conflicting advisory and non-advisory artifacts fail closed as integrity error', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T18:10:00.000Z',
    });

    const enqueued = await service.enqueueNewsTask({
      targetId: 'news-1301',
      sourceUpdatedAt: '2026-11-01T18:00:00.000Z',
      title: 'Conflicting Artifacts Task',
      body: 'Body text.',
    });

    const advisoryRepo = new FirestoreAdvisoryResultRepository(db as any);
    await advisoryRepo.saveWithTaskConvergence({
      taskId: enqueued.task.taskId,
      reconciledTask: enqueued.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
      },
      advisoryResult: {
        schemaVersion: 1,
        humanReviewRequired: true,
        task: {
          taskId: enqueued.task.taskId,
          taskType: AITaskType.CONTENT_REVIEW,
          target: enqueued.task.target,
        },
        assessment: {
          summary: 'Summary.',
          findings: [
            {
              code: 'FACT_CHECKED',
              severity: AIReviewSeverity.Info,
              message: 'Verified.',
              evidenceIds: [`TASK_CONTENT_SNAPSHOT::news-${enqueued.task.target.targetId}`],
            },
          ],
        },
        recommendations: ['Rec 1'],
        uncertainties: ['Unc 1'],
        limitations: ['Lim 1'],
      },
    });

    db.seedDocument(
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
      deriveNonAdvisoryOutcomeDocumentId(enqueued.task.taskId),
      {
        taskId: enqueued.task.taskId,
        reconciledTask: enqueued.task,
        principal: {
          principalId: 'worker-01',
          isActive: true,
          capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
        },
        nonAdvisoryOutcome: {
          taskId: enqueued.task.taskId,
          kind: 'MODEL_FAILURE',
          reason: 'TIMEOUT',
          modelAttempts: 2,
          createdAt: '2026-11-01T18:12:00.000Z',
        },
        convergedStatus: AITaskStatus.Failed,
        convergedAt: '2026-11-01T18:12:01.000Z',
      }
    );

    await assertRejectsWithQueueCode(
      () =>
        service.reconcileTaskStatus({
          taskId: enqueued.task.taskId,
          targetType: AIReviewTargetType.News,
          targetId: 'news-1301',
          currentSourceUpdatedAt: '2026-11-01T18:00:00.000Z',
        }),
      'RECONCILIATION_INTEGRITY_ERROR',
      'Simultaneous advisory and non-advisory artifacts'
    );
  });

  // 14. Stale source detection
  await runTest('14. Stale source detection when source record updatedAt advances', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T19:00:00.000Z',
    });

    const enqueued = await service.enqueueNewsTask({
      targetId: 'news-1401',
      sourceUpdatedAt: '2026-11-01T18:30:00.000Z',
      title: 'Draft Before Edit',
      body: 'Initial draft body.',
    });

    const freshStatus = await service.reconcileTaskStatus({
      taskId: enqueued.task.taskId,
      targetType: AIReviewTargetType.News,
      targetId: 'news-1401',
      currentSourceUpdatedAt: '2026-11-01T18:30:00.000Z',
    });
    assert(freshStatus.isStale === false, 'Expected isStale === false when updatedAt matches');

    const staleStatus = await service.reconcileTaskStatus({
      taskId: enqueued.task.taskId,
      targetType: AIReviewTargetType.News,
      targetId: 'news-1401',
      currentSourceUpdatedAt: '2026-11-01T19:15:00.000Z',
    });
    assert(staleStatus.isStale === true, 'Expected isStale === true when sourceUpdatedAt differs');
  });

  // 15. No mutation of News or Library source records
  await runTest('15. Enqueue and reconciliation never mutate News or Library source records', async () => {
    const db = new InMemoryTransactionalFirestore();
    const originalNewsDoc = Object.freeze({
      id: 'news-1501',
      workflowState: 'InReview',
      titleAr: 'عنوان الخبر',
      bodyAr: 'نص الخبر الأصلي',
      updatedAt: '2026-11-01T20:00:00.000Z',
    });
    const originalIntakeDoc = Object.freeze({
      id: 'intake-1501',
      status: 'PendingReview',
      title: 'Original Intake Title',
      language: 'ar',
      updatedAt: '2026-11-01T20:00:00.000Z',
    });

    db.seedDocument('news', 'news-1501', originalNewsDoc);
    db.seedDocument('library_intake', 'intake-1501', originalIntakeDoc);
    db.accessedCollections.length = 0;

    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T20:05:00.000Z',
    });

    const newsTask = await service.enqueueNewsTask({
      targetId: originalNewsDoc.id,
      sourceUpdatedAt: originalNewsDoc.updatedAt,
      title: originalNewsDoc.titleAr,
      body: originalNewsDoc.bodyAr,
    });

    const intakeTask = await service.enqueueLibraryIntakeTask({
      targetId: originalIntakeDoc.id,
      sourceUpdatedAt: originalIntakeDoc.updatedAt,
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: originalIntakeDoc.title,
      language: originalIntakeDoc.language,
    });

    await service.reconcileTaskStatus({
      taskId: newsTask.task.taskId,
      targetType: AIReviewTargetType.News,
      targetId: originalNewsDoc.id,
      currentSourceUpdatedAt: originalNewsDoc.updatedAt,
    });

    await service.reconcileTaskStatus({
      taskId: intakeTask.task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: originalIntakeDoc.id,
      currentSourceUpdatedAt: originalIntakeDoc.updatedAt,
    });

    assert(
      JSON.stringify(db.readDocumentDirect('news', 'news-1501')) === JSON.stringify(originalNewsDoc),
      'News source document must remain completely untouched'
    );
    assert(
      JSON.stringify(db.readDocumentDirect('library_intake', 'intake-1501')) ===
        JSON.stringify(originalIntakeDoc),
      'LibraryIntake source document must remain completely untouched'
    );
  });

  // 16. No unexpected Firestore collection usage
  await runTest('16. Service accesses only the three canonical PEIA Firestore collections', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T21:00:00.000Z',
    });

    const enqueued = await service.enqueueNewsTask({
      targetId: 'news-1601',
      sourceUpdatedAt: '2026-11-01T20:50:00.000Z',
      title: 'Collection Isolation Check',
      body: 'Body text for collection isolation check.',
    });

    await service.reconcileTaskStatus({
      taskId: enqueued.task.taskId,
      targetType: AIReviewTargetType.News,
      targetId: 'news-1601',
      currentSourceUpdatedAt: '2026-11-01T20:50:00.000Z',
    });

    const allowedCollections = new Set<string>([
      PEIA_PENDING_TASK_COLLECTION,
      PEIA_ADVISORY_RESULT_COLLECTION,
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
    ]);

    for (const colName of db.accessedCollections) {
      assert(
        allowedCollections.has(colName),
        `Unexpected Firestore collection accessed: "${colName}"`
      );
    }
    assert(
      db.accessedCollections.includes(PEIA_PENDING_TASK_COLLECTION) &&
        db.accessedCollections.includes(PEIA_ADVISORY_RESULT_COLLECTION) &&
        db.accessedCollections.includes(PEIA_NON_ADVISORY_OUTCOME_COLLECTION),
      'Expected all 3 canonical PEIA collections to be checked during enqueue + reconciliation'
    );
  });

  // 17. Completed + ABSTAINED reconciliation for News and LibraryIntake
  await runTest('17. Completed task with valid ABSTAINED non-advisory outcome reconciles cleanly for News and LibraryIntake', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T21:30:00.000Z',
    });
    const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(db as any);

    // (a) LibraryIntake Completed + ABSTAINED (INVALID_MODEL_OUTPUT)
    const intakeEnqueued = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-1701',
      sourceUpdatedAt: '2026-11-01T21:20:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'Historical Abstained Library Intake',
      issuingOrganization: 'UNEP',
      language: 'en',
    });

    await nonAdvisoryRepo.saveWithTaskConvergence({
      taskId: intakeEnqueued.task.taskId,
      reconciledTask: intakeEnqueued.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      },
      nonAdvisoryOutcome: {
        taskId: intakeEnqueued.task.taskId,
        kind: 'ABSTAINED',
        reason: 'INVALID_MODEL_OUTPUT',
        modelAttempts: 2,
        createdAt: '2026-11-01T21:31:00.000Z',
        detail: 'Local model output failed schema validation; abstaining safely.',
      },
      convergedStatus: AITaskStatus.Completed,
      convergedAt: '2026-11-01T21:31:02.000Z',
    });

    const reconciledIntake = await service.reconcileTaskStatus({
      taskId: intakeEnqueued.task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: 'intake-1701',
      currentSourceUpdatedAt: '2026-11-01T21:20:00.000Z',
    });

    if (
      reconciledIntake.status !== AITaskStatus.Completed ||
      reconciledIntake.completionKind !== 'ABSTAINED'
    ) {
      throw new Error(`Expected Completed ABSTAINED, got ${reconciledIntake.status}`);
    }
    assert(reconciledIntake.advisoryResult === null, 'Expected advisoryResult === null on ABSTAINED');
    assert(
      reconciledIntake.nonAdvisoryOutcome.kind === 'ABSTAINED',
      'Expected nonAdvisoryOutcome.kind === ABSTAINED'
    );
    assert(
      reconciledIntake.nonAdvisoryOutcome.reason === 'INVALID_MODEL_OUTPUT',
      'Expected nonAdvisoryOutcome.reason === INVALID_MODEL_OUTPUT'
    );
    assert(reconciledIntake.isStale === false, 'Expected non-stale when sourceUpdatedAt matches');

    const staleReconciledIntake = await service.reconcileTaskStatus({
      taskId: intakeEnqueued.task.taskId,
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: 'intake-1701',
      currentSourceUpdatedAt: '2026-11-01T22:00:00.000Z',
    });
    assert(staleReconciledIntake.isStale === true, 'Expected isStale === true when sourceUpdatedAt advances');

    // (b) News Completed + ABSTAINED
    const newsEnqueued = await service.enqueueNewsTask({
      targetId: 'news-1702',
      sourceUpdatedAt: '2026-11-01T21:25:00.000Z',
      title: 'Abstained News Item',
      body: 'Short news body for abstention reconciliation.',
    });

    await nonAdvisoryRepo.saveWithTaskConvergence({
      taskId: newsEnqueued.task.taskId,
      reconciledTask: newsEnqueued.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      },
      nonAdvisoryOutcome: {
        taskId: newsEnqueued.task.taskId,
        kind: 'ABSTAINED',
        reason: 'INSUFFICIENT_EVIDENCE',
        modelAttempts: 0,
        createdAt: '2026-11-01T21:32:00.000Z',
      },
      convergedStatus: AITaskStatus.Completed,
      convergedAt: '2026-11-01T21:32:01.000Z',
    });

    const reconciledNews = await service.reconcileTaskStatus({
      taskId: newsEnqueued.task.taskId,
      targetType: AIReviewTargetType.News,
      targetId: 'news-1702',
      currentSourceUpdatedAt: '2026-11-01T21:25:00.000Z',
    });

    if (
      reconciledNews.status !== AITaskStatus.Completed ||
      reconciledNews.completionKind !== 'ABSTAINED'
    ) {
      throw new Error(`Expected Completed ABSTAINED for News, got ${reconciledNews.status}`);
    }
    assert(reconciledNews.advisoryResult === null, 'Expected advisoryResult === null for News ABSTAINED');
    assert(
      reconciledNews.nonAdvisoryOutcome.reason === 'INSUFFICIENT_EVIDENCE',
      'Expected INSUFFICIENT_EVIDENCE reason'
    );
  });

  // 18. Invalid Completed/Failed/Pending abstention & non-advisory combinations fail closed
  await runTest('18. Invalid Completed, Failed, and Pending abstention combinations fail closed with RECONCILIATION_INTEGRITY_ERROR', async () => {
    const db = new InMemoryTransactionalFirestore();
    const service = new FirestorePeiaTaskQueueService(db, {
      clock: () => '2026-11-01T22:00:00.000Z',
    });

    // (a) Completed task paired with MODEL_FAILURE non-advisory artifact
    const taskModelFailureOnCompleted = await service.enqueueNewsTask({
      targetId: 'news-1801',
      sourceUpdatedAt: '2026-11-01T21:50:00.000Z',
      title: 'Tampered Completed Model Failure',
      body: 'Body text.',
    });
    db.seedDocument(PEIA_PENDING_TASK_COLLECTION, taskModelFailureOnCompleted.documentId, {
      ...taskModelFailureOnCompleted.task,
      status: AITaskStatus.Completed,
    });
    db.seedDocument(
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
      deriveNonAdvisoryOutcomeDocumentId(taskModelFailureOnCompleted.task.taskId),
      {
        taskId: taskModelFailureOnCompleted.task.taskId,
        reconciledTask: taskModelFailureOnCompleted.task,
        principal: {
          principalId: 'worker-01',
          isActive: true,
          capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
        },
        nonAdvisoryOutcome: {
          taskId: taskModelFailureOnCompleted.task.taskId,
          kind: 'MODEL_FAILURE',
          reason: 'TIMEOUT',
          modelAttempts: 2,
          createdAt: '2026-11-01T22:01:00.000Z',
        },
        convergedStatus: AITaskStatus.Failed,
        convergedAt: '2026-11-01T22:01:01.000Z',
      }
    );

    await assertRejectsWithQueueCode(
      () =>
        service.reconcileTaskStatus({
          taskId: taskModelFailureOnCompleted.task.taskId,
          targetType: AIReviewTargetType.News,
          targetId: 'news-1801',
          currentSourceUpdatedAt: '2026-11-01T21:50:00.000Z',
        }),
      'RECONCILIATION_INTEGRITY_ERROR',
      'Completed task paired with MODEL_FAILURE non-advisory outcome'
    );

    // (b) Completed + ABSTAINED with tampered reconciledTask reference
    const taskTamperedRef = await service.enqueueLibraryIntakeTask({
      targetId: 'intake-1802',
      sourceUpdatedAt: '2026-11-01T21:50:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'Tampered Reference Intake',
    });
    db.seedDocument(PEIA_PENDING_TASK_COLLECTION, taskTamperedRef.documentId, {
      ...taskTamperedRef.task,
      status: AITaskStatus.Completed,
    });
    db.seedDocument(
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
      deriveNonAdvisoryOutcomeDocumentId(taskTamperedRef.task.taskId),
      {
        taskId: taskTamperedRef.task.taskId,
        reconciledTask: {
          ...taskTamperedRef.task,
          target: {
            ...taskTamperedRef.task.target,
            sourceUpdatedAt: '2026-11-01T19:00:00.000Z',
          },
        },
        principal: {
          principalId: 'worker-01',
          isActive: true,
          capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
        },
        nonAdvisoryOutcome: {
          taskId: taskTamperedRef.task.taskId,
          kind: 'ABSTAINED',
          reason: 'INVALID_MODEL_OUTPUT',
          modelAttempts: 2,
          createdAt: '2026-11-01T22:02:00.000Z',
        },
        convergedStatus: AITaskStatus.Completed,
        convergedAt: '2026-11-01T22:02:01.000Z',
      }
    );

    await assertRejectsWithQueueCode(
      () =>
        service.reconcileTaskStatus({
          taskId: taskTamperedRef.task.taskId,
          targetType: AIReviewTargetType.LibraryIntake,
          targetId: 'intake-1802',
          currentSourceUpdatedAt: '2026-11-01T21:50:00.000Z',
        }),
      'RECONCILIATION_INTEGRITY_ERROR',
      'Completed + ABSTAINED with mismatched reconciledTask.target.sourceUpdatedAt'
    );

    // (c) Failed task paired with ABSTAINED non-advisory outcome
    const taskFailedWithAbstained = await service.enqueueNewsTask({
      targetId: 'news-1803',
      sourceUpdatedAt: '2026-11-01T21:50:00.000Z',
      title: 'Failed Task With Abstained Artifact',
      body: 'Body text.',
    });
    db.seedDocument(PEIA_PENDING_TASK_COLLECTION, taskFailedWithAbstained.documentId, {
      ...taskFailedWithAbstained.task,
      status: AITaskStatus.Failed,
    });
    db.seedDocument(
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
      deriveNonAdvisoryOutcomeDocumentId(taskFailedWithAbstained.task.taskId),
      {
        taskId: taskFailedWithAbstained.task.taskId,
        reconciledTask: taskFailedWithAbstained.task,
        principal: {
          principalId: 'worker-01',
          isActive: true,
          capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
        },
        nonAdvisoryOutcome: {
          taskId: taskFailedWithAbstained.task.taskId,
          kind: 'ABSTAINED',
          reason: 'INVALID_MODEL_OUTPUT',
          modelAttempts: 2,
          createdAt: '2026-11-01T22:03:00.000Z',
        },
        convergedStatus: AITaskStatus.Completed,
        convergedAt: '2026-11-01T22:03:01.000Z',
      }
    );

    await assertRejectsWithQueueCode(
      () =>
        service.reconcileTaskStatus({
          taskId: taskFailedWithAbstained.task.taskId,
          targetType: AIReviewTargetType.News,
          targetId: 'news-1803',
          currentSourceUpdatedAt: '2026-11-01T21:50:00.000Z',
        }),
      'RECONCILIATION_INTEGRITY_ERROR',
      'Failed task paired with ABSTAINED non-advisory outcome'
    );

    // (d) Pending task with pre-existing ABSTAINED non-advisory outcome
    const taskPendingWithAbstained = await service.enqueueNewsTask({
      targetId: 'news-1804',
      sourceUpdatedAt: '2026-11-01T21:50:00.000Z',
      title: 'Pending Task With Abstained Artifact',
      body: 'Body text.',
    });
    db.seedDocument(
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
      deriveNonAdvisoryOutcomeDocumentId(taskPendingWithAbstained.task.taskId),
      {
        taskId: taskPendingWithAbstained.task.taskId,
        reconciledTask: taskPendingWithAbstained.task,
        principal: {
          principalId: 'worker-01',
          isActive: true,
          capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
        },
        nonAdvisoryOutcome: {
          taskId: taskPendingWithAbstained.task.taskId,
          kind: 'ABSTAINED',
          reason: 'INVALID_MODEL_OUTPUT',
          modelAttempts: 2,
          createdAt: '2026-11-01T22:04:00.000Z',
        },
        convergedStatus: AITaskStatus.Completed,
        convergedAt: '2026-11-01T22:04:01.000Z',
      }
    );

    await assertRejectsWithQueueCode(
      () =>
        service.reconcileTaskStatus({
          taskId: taskPendingWithAbstained.task.taskId,
          targetType: AIReviewTargetType.News,
          targetId: 'news-1804',
          currentSourceUpdatedAt: '2026-11-01T21:50:00.000Z',
        }),
      'RECONCILIATION_INTEGRITY_ERROR',
      'Pending task paired with ABSTAINED non-advisory outcome'
    );
  });

  console.log('====================================================');
  console.log('RUNNING PEIA UNIFIED SERVER TASK QUEUE TESTS');
  console.log('====================================================\n');

  let failed = 0;
  for (const r of results) {
    if (r.passed) {
      console.log(`✅ [${r.id}] ${r.name}`);
    } else {
      failed++;
      console.error(`❌ [${r.id}] ${r.name}`);
      console.error(`   ${r.message}`);
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${results.length - failed} passed / ${results.length} total / ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
