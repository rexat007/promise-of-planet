import Module, { createRequire } from 'node:module';
import type { NewsApplicationService as NewsApplicationServiceType } from '../functions/src/news/newsApplicationService';
import type { NewsItemBackend, NewsRepository } from '../functions/src/news/newsRepository';
import type { AdminRepository } from '../functions/src/admin/adminRepository';
import { AdminRole, type AdminUser } from '../functions/src/types/admin';
import {
  AIReviewTargetType,
  AIReviewSeverity,
  PEIALibraryPreparationInputBasis,
} from '../functions/src/shared/aiReviewContract';
import { AITaskStatus, AITaskType, type AIReviewTask } from '../functions/src/types/aiTask';
import {
  FirestorePeiaTaskQueueService,
  derivePeiaTaskId,
  derivePeiaTaskDocumentId,
  type PeiaTaskQueueFirestoreDatabase,
  type PeiaTaskQueueTransaction,
} from '../functions/src/peia/firestorePeiaTaskQueueService';
import { PEIA_PENDING_TASK_COLLECTION } from '../functions/src/peia/firestorePendingTaskSource';
import {
  FirestoreAdvisoryResultRepository,
} from '../functions/src/peia/firestoreAdvisoryResultRepository';
import {
  FirestoreNonAdvisoryOutcomeRepository,
  PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
  deriveNonAdvisoryOutcomeDocumentId,
} from '../functions/src/peia/firestoreNonAdvisoryOutcomeRepository';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';

class FallbackHttpsError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  try {
    return originalModuleLoad.call(this, request, parent, isMain);
  } catch (err: unknown) {
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: FallbackHttpsError,
        onCall: (_opts: unknown, handler: unknown) => handler,
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error('Live getFirestore() must not be invoked in headless integration tests.');
        },
      };
    }
    throw err;
  }
};

const require = createRequire(import.meta.url);
const { NewsApplicationService } = require('../functions/src/news/newsApplicationService') as {
  NewsApplicationService: typeof NewsApplicationServiceType;
};
const { executeManageNewsRequest } = require('../functions/src/news/newsAdminHandlers') as typeof import('../functions/src/news/newsAdminHandlers');

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

async function assertRejectsWithHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  expectedMessageSubstring: string,
  context: string
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const candidate = err as { code?: unknown; message?: unknown; name?: unknown } | null;
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string'
    ) {
      if (candidate.code !== expectedCode) {
        throw new Error(
          `${context}: expected HttpsError code '${expectedCode}', got '${candidate.code}' (${candidate.message})`
        );
      }
      if (!candidate.message.includes(expectedMessageSubstring)) {
        throw new Error(
          `${context}: expected message containing '${expectedMessageSubstring}', got '${candidate.message}'`
        );
      }
      return;
    }
    throw new Error(
      `${context}: expected HttpsError(${expectedCode}), got ${
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }`
    );
  }
  throw new Error(
    `${context}: expected HttpsError(${expectedCode}) containing '${expectedMessageSubstring}', but succeeded`
  );
}

function cloneJson<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
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

interface TransactionAudit {
  readsBeforeWrite: boolean;
  docRefsRead: string[];
  docRefsWritten: string[];
  retries: number;
}

/**
 * In-memory transactional Firestore backing both `news` and canonical PEIA collections
 * (`peiaReviewTasks`, `peiaAdvisoryResults`, `peiaNonAdvisoryOutcomes`), supporting
 * optimistic concurrency control (OCC) and transactional hooks for race simulation.
 */
class InMemoryNewsAndPeiaFirestore implements PeiaTaskQueueFirestoreDatabase {
  readonly collections = new Map<string, Map<string, unknown>>();
  readonly transactionHistory: TransactionAudit[] = [];
  private readonly docVersions = new Map<string, number>();
  private commitCounter = 0;
  public onBeforeTransactionRead?: (collectionName: string, docId: string, attempt: number) => Promise<void> | void;
  public onBeforeTransactionCommit?: (attempt: number) => Promise<void> | void;

  private getMap(name: string): Map<string, unknown> {
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
    const col = this.getMap(collectionName);
    col.set(docId, cloneJson(data));
    this.bumpDocVersion(collectionName, docId);
  }

  readDocumentDirect<T = unknown>(collectionName: string, docId: string): T | undefined {
    const raw = this.collections.get(collectionName)?.get(docId);
    return raw !== undefined ? cloneJson(raw as T) : undefined;
  }

  countDocuments(collectionName: string): number {
    return this.collections.get(collectionName)?.size ?? 0;
  }

  collection(collectionName: string) {
    const getMap = () => this.getMap(collectionName);
    return {
      doc: (documentId: string) => ({
        id: documentId,
        __collectionName: collectionName,
      }),
      where: (field: string, op: string, value: unknown) => {
        const filters: Array<{ field: string; op: string; value: unknown }> = [
          { field, op, value },
        ];
        let limitCount = Infinity;
        const queryObj = {
          __collectionName: collectionName,
          __filters: filters,
          __getLimit: () => limitCount,
          where: (f: string, o: string, v: unknown) => {
            filters.push({ field: f, op: o, value: v });
            return queryObj;
          },
          limit: (n: number) => {
            limitCount = n;
            return queryObj;
          },
          __execute: () => {
            const col = getMap();
            const matched: Array<{
              exists: boolean;
              ref: { id: string };
              data: () => unknown;
            }> = [];
            for (const [docId, docData] of col.entries()) {
              const allMatch = filters.every((flt) => {
                if (flt.op !== '==') {
                  throw new Error(`Unsupported query operator: ${flt.op}`);
                }
                return getNestedField(docData, flt.field) === flt.value;
              });
              if (allMatch) {
                const cloned = cloneJson(docData);
                matched.push({
                  exists: true,
                  ref: { id: docId, __collectionName: collectionName } as any,
                  data: () => cloneJson(cloned),
                });
                if (matched.length >= limitCount) {
                  break;
                }
              }
            }
            return { docs: matched };
          },
        };
        return queryObj;
      },
    };
  }

  async runTransaction<T>(
    updateFunction: (transaction: PeiaTaskQueueTransaction) => Promise<T>
  ): Promise<T> {
    const maxAttempts = 5;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      let hasWritten = false;
      let readsBeforeWrite = true;
      const docRefsRead: string[] = [];
      const docRefsWritten: string[] = [];
      const readVersions = new Map<string, number>();
      const stagedWrites: Array<() => void> = [];
      const stagedCreateKeys: Array<{ collectionName: string; docId: string }> = [];

      const tx: any = {
        get: async (target: any) => {
          if (hasWritten) {
            readsBeforeWrite = false;
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          if (typeof target?.__execute === 'function') {
            const colName = target.__collectionName as string;
            const col = this.getMap(colName);
            for (const [docId] of col.entries()) {
              readVersions.set(`${colName}/${docId}`, this.getDocVersion(colName, docId));
            }
            return target.__execute();
          }

          const colName = target.__collectionName as string;
          const docId = target.id as string;
          if (this.onBeforeTransactionRead) {
            await this.onBeforeTransactionRead(colName, docId, attempt);
          }

          const key = `${colName}/${docId}`;
          docRefsRead.push(key);
          readVersions.set(key, this.getDocVersion(colName, docId));
          const col = this.getMap(colName);
          const exists = col.has(docId);
          const raw = col.get(docId);
          return {
            exists,
            ref: { id: docId },
            data: () => (exists ? cloneJson(raw) : undefined),
          };
        },
        create: (docRef: any, data: unknown) => {
          hasWritten = true;
          const colName = docRef.__collectionName as string;
          const docId = docRef.id as string;
          const key = `${colName}/${docId}`;
          docRefsWritten.push(key);
          stagedCreateKeys.push({ collectionName: colName, docId });
          stagedWrites.push(() => {
            const col = this.getMap(colName);
            col.set(docId, cloneJson(data));
            this.bumpDocVersion(colName, docId);
          });
          return tx;
        },
        set: (docRef: any, data: unknown) => {
          hasWritten = true;
          const colName = docRef.__collectionName as string;
          const docId = docRef.id as string;
          const key = `${colName}/${docId}`;
          docRefsWritten.push(key);
          stagedWrites.push(() => {
            const col = this.getMap(colName);
            col.set(docId, cloneJson(data));
            this.bumpDocVersion(colName, docId);
          });
          return tx;
        },
        update: (docRef: any, patch: Record<string, unknown>) => {
          hasWritten = true;
          const colName = docRef.__collectionName as string;
          const docId = docRef.id as string;
          const key = `${colName}/${docId}`;
          docRefsWritten.push(key);
          stagedWrites.push(() => {
            const col = this.getMap(colName);
            const existing = (col.get(docId) as Record<string, unknown>) ?? {};
            col.set(docId, cloneJson({ ...existing, ...patch }));
            this.bumpDocVersion(colName, docId);
          });
          return tx;
        },
      };

      const result = await updateFunction(tx);

      if (this.onBeforeTransactionCommit) {
        await this.onBeforeTransactionCommit(attempt);
      }

      let versionConflict = false;
      for (const [key, seenVersion] of readVersions.entries()) {
        const [colName, docId] = key.split('/');
        if (this.getDocVersion(colName, docId) !== seenVersion) {
          versionConflict = true;
          break;
        }
      }

      for (const createOp of stagedCreateKeys) {
        const col = this.getMap(createOp.collectionName);
        if (col.has(createOp.docId)) {
          versionConflict = true;
          break;
        }
      }

      if (versionConflict) {
        if (attempt >= maxAttempts) {
          throw new Error('Transaction max retries exceeded due to concurrent conflict.');
        }
        continue;
      }

      for (const applyWrite of stagedWrites) {
        applyWrite();
      }

      this.transactionHistory.push({
        readsBeforeWrite,
        docRefsRead,
        docRefsWritten,
        retries: attempt - 1,
      });

      return result;
    }

    throw new Error('Unreachable transaction loop exit.');
  }
}

class InMemoryNewsRepository implements NewsRepository {
  constructor(private readonly db: InMemoryNewsAndPeiaFirestore) {}

  async getById(id: string): Promise<NewsItemBackend | null> {
    const item = this.db.readDocumentDirect<NewsItemBackend>('news', id);
    return item ?? null;
  }

  async save(item: NewsItemBackend): Promise<void> {
    this.db.seedDocument('news', item.id, item);
  }

  async listAll(): Promise<NewsItemBackend[]> {
    const col = this.db.collections.get('news');
    if (!col) return [];
    return Array.from(col.values()).map((v) => cloneJson(v as NewsItemBackend));
  }

  async listPublished(): Promise<NewsItemBackend[]> {
    const all = await this.listAll();
    return all.filter((item) => item.workflowState === 'Published');
  }

  async delete(id: string): Promise<void> {
    this.db.collections.get('news')?.delete(id);
  }
}

class InMemoryAdminRepository implements AdminRepository {
  private readonly admins = new Map<string, AdminUser>();

  constructor(initialAdmins: readonly AdminUser[] = []) {
    for (const admin of initialAdmins) {
      this.admins.set(admin.id, cloneJson(admin));
    }
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    return this.admins.get(uid) ?? null;
  }

  async listAdmins(): Promise<AdminUser[]> {
    return Array.from(this.admins.values());
  }

  async saveAdmin(user: AdminUser): Promise<void> {
    this.admins.set(user.id, cloneJson(user));
  }
}

const FIXED_CLOCK_ISO = '2026-05-10T12:00:00.000Z';

const SAMPLE_ADMINS: readonly AdminUser[] = [
  {
    id: 'owner-1',
    name: 'Platform Owner',
    email: 'owner@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  },
  {
    id: 'editor-1',
    name: 'Senior Content Editor',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  },
  {
    id: 'rights-1',
    name: 'Rights Reviewer',
    email: 'rights@promiseofplanet.org',
    role: AdminRole.RightsReviewer,
    isActive: true,
  },
  {
    id: 'curator-1',
    name: 'Library Curator',
    email: 'curator@promiseofplanet.org',
    role: AdminRole.LibraryCurator,
    isActive: true,
  },
  {
    id: 'viewer-1',
    name: 'Read Only Viewer',
    email: 'viewer@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  },
  {
    id: 'inactive-editor',
    name: 'Inactive Editor',
    email: 'inactive@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: false,
  },
  {
    id: 'ai-assistant-1',
    name: 'PEIA AI Assistant',
    email: 'ai@promiseofplanet.org',
    role: AdminRole.AIAssistant,
    isActive: true,
  },
];

function createSampleNewsItem(overrides: Partial<NewsItemBackend> = {}): NewsItemBackend {
  return {
    id: 'news-article-101',
    titleAr: 'تقرير علمي حول استعادة النظم البيئية الساحلية في البحر الأحمر',
    titleEn: 'Scientific Report on Red Sea Coastal Ecosystem Restoration',
    summaryAr: 'ملخص تحليلي يرصد جهود حماية الشعاب المرجانية وأشجار القرم.',
    summaryEn: 'Analytical summary tracking coral reef and mangrove conservation efforts.',
    bodyAr:
      'تشهد المناطق الساحلية برامج رصد بيئي موسعة تعتمد على البيانات الميدانية الموثقة لقياس تعافي التنوع الحيوي.',
    bodyEn:
      'Coastal zones are undergoing expanded environmental monitoring programs based on verified field data.',
    author: 'فريق التحرير العلمي',
    category: 'التنوع الحيوي',
    tags: ['البحر الأحمر', 'الشعاب المرجانية'],
    sources: ['https://example.org/red-sea-monitoring-2026'],
    workflowState: 'Draft',
    createdAt: '2026-05-10T09:00:00.000Z',
    updatedAt: '2026-05-10T10:30:00.000Z',
    history: [],
    ...overrides,
  };
}

function createHarness() {
  const db = new InMemoryNewsAndPeiaFirestore();
  const newsRepo = new InMemoryNewsRepository(db);
  const newsService = new NewsApplicationService(newsRepo);
  const adminRepo = new InMemoryAdminRepository(SAMPLE_ADMINS);
  let clockIso = FIXED_CLOCK_ISO;

  return {
    db,
    newsRepo,
    newsService,
    adminRepo,
    setClock: (iso: string) => {
      clockIso = iso;
    },
    invoke: (auth: { uid: string; token?: Record<string, unknown> } | undefined, data: unknown) =>
      executeManageNewsRequest(
        { auth, data },
        adminRepo,
        newsService,
        undefined,
        undefined,
        undefined,
        db,
        { clock: () => clockIso }
      ),
  };
}

async function main(): Promise<void> {
  // 1. Authorized human ContentEditor/Owner can request News PEIA review.
  await runTest('1. Authorized human ContentEditor and Owner can request News PEIA review without mutating News', async () => {
    const h = createHarness();
    const article1 = createSampleNewsItem({ id: 'news-101' });
    const article2 = createSampleNewsItem({ id: 'news-102', updatedAt: '2026-05-10T11:00:00.000Z' });
    await h.newsRepo.save(article1);
    await h.newsRepo.save(article2);

    const editorResult = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: 'news-101',
        expectedUpdatedAt: article1.updatedAt,
      }
    );

    assert(editorResult.disposition === 'CREATED', 'Expected CREATED disposition for editor-1');
    assert(editorResult.status === AITaskStatus.Pending, 'Expected Pending status after enqueue');
    assert(editorResult.isStale === false, 'Expected non-stale status after enqueue');
    assert(editorResult.task.taskType === AITaskType.CONTENT_REVIEW, 'Expected CONTENT_REVIEW taskType');
    assert(editorResult.task.target.targetType === AIReviewTargetType.News, 'Expected News targetType');
    assert(editorResult.task.target.targetId === 'news-101', 'Expected targetId news-101');
    assert(
      editorResult.task.target.sourceUpdatedAt === article1.updatedAt,
      'Expected sourceUpdatedAt to match article1.updatedAt'
    );

    const ownerResult = await h.invoke(
      { uid: 'owner-1' },
      {
        action: 'requestPeiaReview',
        id: 'news-102',
        expectedUpdatedAt: article2.updatedAt,
      }
    );

    assert(ownerResult.disposition === 'CREATED', 'Expected CREATED disposition for owner-1');
    assert(ownerResult.task.target.targetId === 'news-102', 'Expected targetId news-102');

    // Verify News documents were NOT mutated
    const persisted1 = await h.newsRepo.getById('news-101');
    assert(
      JSON.stringify(persisted1) === JSON.stringify(article1),
      'News record news-101 must remain completely unmutated'
    );
  });

  // 2. Unauthenticated, inactive, Viewer, and AIAssistant/automated callers are rejected.
  await runTest('2. Unauthenticated, inactive, Viewer, cross-domain, and AIAssistant/automated callers are rejected', async () => {
    const h = createHarness();
    const article = createSampleNewsItem();
    await h.newsRepo.save(article);

    const reqPayload = {
      action: 'requestPeiaReview',
      id: article.id,
      expectedUpdatedAt: article.updatedAt,
    };
    const statusPayload = {
      action: 'getPeiaReviewStatus',
      id: article.id,
    };

    // Unauthenticated
    await assertRejectsWithHttpsError(
      () => h.invoke(undefined, reqPayload),
      'unauthenticated',
      'UNAUTHENTICATED',
      'Unauthenticated requestPeiaReview'
    );
    await assertRejectsWithHttpsError(
      () => h.invoke(undefined, statusPayload),
      'unauthenticated',
      'UNAUTHENTICATED',
      'Unauthenticated getPeiaReviewStatus'
    );

    // Inactive admin
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'inactive-editor' }, reqPayload),
      'permission-denied',
      'ADMIN_INACTIVE',
      'Inactive admin requestPeiaReview'
    );

    // Viewer role
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'viewer-1' }, reqPayload),
      'permission-denied',
      'PERMISSION_DENIED',
      'Viewer requestPeiaReview'
    );
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'viewer-1' }, statusPayload),
      'permission-denied',
      'PERMISSION_DENIED',
      'Viewer getPeiaReviewStatus'
    );

    // Cross-domain LibraryCurator (has Edit/Review in Library, not News)
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'curator-1' }, reqPayload),
      'permission-denied',
      'PERMISSION_DENIED',
      'LibraryCurator requestPeiaReview'
    );

    // RightsReviewer can view/review status in News domain, but cannot requestPeiaReview (lacks Edit)
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'rights-1' }, reqPayload),
      'permission-denied',
      'PERMISSION_DENIED',
      'RightsReviewer requestPeiaReview'
    );

    // AIAssistant role in AdminRepository
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'ai-assistant-1' }, reqPayload),
      'permission-denied',
      'AI_ACTION_FORBIDDEN',
      'AIAssistant role requestPeiaReview'
    );
    await assertRejectsWithHttpsError(
      () => h.invoke({ uid: 'ai-assistant-1' }, statusPayload),
      'permission-denied',
      'AI_ACTION_FORBIDDEN',
      'AIAssistant role getPeiaReviewStatus'
    );

    // Automated / AI token claims even on an Owner UID
    for (const claim of [
      { role: AdminRole.AIAssistant },
      { isAIAssistant: true },
      { aiAssistant: true },
      { ai: true },
      { automated: true },
    ]) {
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'owner-1', token: claim }, reqPayload),
        'permission-denied',
        'AI_ACTION_FORBIDDEN',
        `Automated token claim ${JSON.stringify(claim)} requestPeiaReview`
      );
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'owner-1', token: claim }, statusPayload),
        'permission-denied',
        'AI_ACTION_FORBIDDEN',
        `Automated token claim ${JSON.stringify(claim)} getPeiaReviewStatus`
      );
    }

    assert(
      h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
      'Zero tasks should be created when authorization fails'
    );
  });

  // 3. Missing News item is rejected.
  await runTest('3. Missing News item is rejected with not-found for both requestPeiaReview and getPeiaReviewStatus', async () => {
    const h = createHarness();

    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'requestPeiaReview',
            id: 'non-existent-news-999',
            expectedUpdatedAt: '2026-05-10T10:30:00.000Z',
          }
        ),
      'not-found',
      'NOT_FOUND',
      'Missing News item on requestPeiaReview'
    );

    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'getPeiaReviewStatus',
            id: 'non-existent-news-999',
          }
        ),
      'not-found',
      'NOT_FOUND',
      'Missing News item on getPeiaReviewStatus'
    );
  });

  // 4. expectedUpdatedAt mismatch is rejected.
  await runTest('4. expectedUpdatedAt mismatch is rejected with failed-precondition (STALE_SOURCE_VERSION)', async () => {
    const h = createHarness();
    const article = createSampleNewsItem({ updatedAt: '2026-05-10T10:30:00.000Z' });
    await h.newsRepo.save(article);

    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'requestPeiaReview',
            id: article.id,
            expectedUpdatedAt: '2026-05-10T09:15:00.000Z',
          }
        ),
      'failed-precondition',
      'STALE_SOURCE_VERSION',
      'Mismatched expectedUpdatedAt'
    );

    assert(
      h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
      'No PEIA task should be created on expectedUpdatedAt mismatch'
    );
  });

  // 5. Caller-supplied snapshot/status/task/workflow override fields are rejected.
  await runTest('5. Caller-supplied snapshot, status, task, role, permission, or workflow override fields are rejected', async () => {
    const h = createHarness();
    const article = createSampleNewsItem();
    await h.newsRepo.save(article);

    const prohibitedRequestFields = [
      'title',
      'summary',
      'body',
      'contentSnapshot',
      'taskId',
      'taskType',
      'status',
      'createdAt',
      'sourceUpdatedAt',
      'targetType',
      'targetId',
      'approved',
      'published',
      'workflowState',
      'role',
      'permission',
      'unexpectedExtraKey',
    ];

    for (const field of prohibitedRequestFields) {
      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'editor-1' },
            {
              action: 'requestPeiaReview',
              id: article.id,
              expectedUpdatedAt: article.updatedAt,
              [field]: 'injected-value',
            }
          ),
        'invalid-argument',
        'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
        `requestPeiaReview with forbidden field '${field}'`
      );
    }

    const prohibitedStatusFields = [
      'title',
      'summary',
      'body',
      'contentSnapshot',
      'taskType',
      'status',
      'createdAt',
      'sourceUpdatedAt',
      'targetType',
      'targetId',
      'approved',
      'published',
      'workflowState',
      'role',
      'permission',
      'expectedUpdatedAt',
    ];

    for (const field of prohibitedStatusFields) {
      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'editor-1' },
            {
              action: 'getPeiaReviewStatus',
              id: article.id,
              [field]: 'injected-value',
            }
          ),
        'invalid-argument',
        'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
        `getPeiaReviewStatus with forbidden field '${field}'`
      );
    }

    assert(
      h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
      'No tasks created during untrusted input rejection tests'
    );
  });

  // 6. Snapshot is built strictly from authoritative stored News content.
  await runTest('6. Snapshot is built strictly from authoritative stored News content', async () => {
    const h = createHarness();
    const article = createSampleNewsItem({
      id: 'news-authoritative-6',
      titleAr: '  عنوان رسمي معتمد من قاعدة البيانات  ',
      summaryAr: '  ملخص رسمي مخزن على الخادم  ',
      bodyAr: 'فقرة أولى من النص الرسمي.\r\nفقرة ثانية من النص الرسمي.',
      updatedAt: '2026-05-10T10:45:00.000Z',
    });
    await h.newsRepo.save(article);

    const res = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );

    const expectedSnapshot = {
      allowSnapshotEvidence: true,
      title: 'عنوان رسمي معتمد من قاعدة البيانات',
      body: 'فقرة أولى من النص الرسمي.\nفقرة ثانية من النص الرسمي.',
      summary: 'ملخص رسمي مخزن على الخادم',
    };

    assert(
      JSON.stringify(res.task.contentSnapshot) === JSON.stringify(expectedSnapshot),
      `Expected authoritative snapshot ${JSON.stringify(expectedSnapshot)}, got ${JSON.stringify(res.task.contentSnapshot)}`
    );

    const storedDoc = h.db.readDocumentDirect<AIReviewTask>(
      PEIA_PENDING_TASK_COLLECTION,
      res.documentId
    );
    assert(storedDoc !== undefined, 'Expected stored task document in peiaReviewTasks');
    assert(
      JSON.stringify(storedDoc?.contentSnapshot) === JSON.stringify(expectedSnapshot),
      'Stored task contentSnapshot must match authoritative News content'
    );
  });

  // 7. Duplicate request for the same News version is idempotent.
  await runTest('7. Duplicate request for the same News version is idempotent (ALREADY_EXISTS) and preserves createdAt/status', async () => {
    const h = createHarness();
    const article = createSampleNewsItem({ id: 'news-idempotent-7' });
    await h.newsRepo.save(article);

    h.setClock('2026-05-10T12:00:00.000Z');
    const first = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );
    assert(first.disposition === 'CREATED', 'First call must return CREATED');

    h.setClock('2026-05-10T12:05:00.000Z');
    const second = await h.invoke(
      { uid: 'owner-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );
    assert(second.disposition === 'ALREADY_EXISTS', 'Second call must return ALREADY_EXISTS');
    assert(second.taskId === first.taskId, 'Both calls must return identical taskId');
    assert(second.documentId === first.documentId, 'Both calls must return identical documentId');
    assert(
      second.task.createdAt === '2026-05-10T12:00:00.000Z',
      'Idempotent replay must preserve original createdAt'
    );
    assert(
      h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 1,
      'Exactly one task document must exist in peiaReviewTasks'
    );
  });

  // 8. Request after News updatedAt advances creates a distinct task for the new version.
  await runTest('8. Request after News updatedAt advances creates a distinct task for the new version', async () => {
    const h = createHarness();
    const v1 = createSampleNewsItem({
      id: 'news-versioned-8',
      updatedAt: '2026-05-10T10:00:00.000Z',
      bodyAr: 'النص الأصلي للنسخة الأولى من المقال العلمي.',
    });
    await h.newsRepo.save(v1);

    const resV1 = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: v1.id,
        expectedUpdatedAt: v1.updatedAt,
      }
    );

    const v2: NewsItemBackend = {
      ...v1,
      bodyAr: 'النص المحدث للنسخة الثانية بعد المراجعة التحريرية.',
      updatedAt: '2026-05-10T11:30:00.000Z',
    };
    await h.newsRepo.save(v2);

    const resV2 = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: v2.id,
        expectedUpdatedAt: v2.updatedAt,
      }
    );

    assert(resV2.disposition === 'CREATED', 'Expected CREATED for new source version v2');
    assert(resV2.taskId !== resV1.taskId, 'Expected distinct taskId for new sourceUpdatedAt');
    assert(resV2.documentId !== resV1.documentId, 'Expected distinct documentId for new sourceUpdatedAt');
    assert(resV2.isStale === false, 'New version task must not be stale');
    assert(
      h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 2,
      'Expected two distinct version tasks in peiaReviewTasks'
    );
  });

  // 9. getPeiaReviewStatus returns NotRequested, Pending, Completed, and Failed states accurately.
  await runTest('9. getPeiaReviewStatus returns NotRequested, Pending, Completed, and Failed states accurately', async () => {
    const h = createHarness();
    const article = createSampleNewsItem({ id: 'news-status-9' });
    await h.newsRepo.save(article);

    // (a) NotRequested before any enqueue
    const notRequested = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'getPeiaReviewStatus',
        id: article.id,
      }
    );
    assert(notRequested.status === 'NotRequested', 'Expected NotRequested before enqueue');
    assert(notRequested.isStale === false, 'NotRequested must have isStale === false');
    assert(notRequested.task === null, 'NotRequested must have task === null');
    assert(notRequested.advisoryResult === null, 'NotRequested must have advisoryResult === null');
    assert(notRequested.nonAdvisoryOutcome === null, 'NotRequested must have nonAdvisoryOutcome === null');

    // (b) Pending after enqueue
    const enqueued = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );
    const pendingStatus = await h.invoke(
      { uid: 'rights-1' },
      {
        action: 'getPeiaReviewStatus',
        id: article.id,
      }
    );
    assert(pendingStatus.status === AITaskStatus.Pending, 'Expected Pending status');
    assert(pendingStatus.taskId === enqueued.taskId, 'Expected matching taskId');
    assert(pendingStatus.isStale === false, 'Expected isStale === false');
    assert(pendingStatus.advisoryResult === null, 'Expected advisoryResult === null while Pending');
    assert(pendingStatus.nonAdvisoryOutcome === null, 'Expected nonAdvisoryOutcome === null while Pending');

    // (c) Completed when task is Completed and valid advisoryResult record exists
    const advisoryRepo = new FirestoreAdvisoryResultRepository(h.db as any);
    await advisoryRepo.saveWithTaskConvergence({
      taskId: enqueued.taskId,
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
          summary: 'المقال متسق علمياً مع توصية بتوضيح الفترة الزمنية للرصد.',
          findings: [
            {
              code: 'CONSISTENT_CLAIM',
              severity: AIReviewSeverity.Info,
              message: 'البيانات المرجعية متوافقة مع نطاق التقرير.',
              evidenceIds: [`TASK_CONTENT_SNAPSHOT::news-${article.id}`],
            },
          ],
        },
        recommendations: ['مراجعة مصدر الرصد الميداني قبل النشر.'],
        uncertainties: ['البيانات الخارجية غير مفحوصة محلياً.'],
        limitations: ['مرتكز حصرياً على لقطة المهمة المعتمدة.'],
      },
    });

    const completedStatus = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'getPeiaReviewStatus',
        id: article.id,
      }
    );
    assert(completedStatus.status === AITaskStatus.Completed, 'Expected Completed status');
    assert(completedStatus.isStale === false, 'Expected isStale === false on matching updatedAt');
    assert(
      completedStatus.advisoryResult?.assessment.summary ===
        'المقال متسق علمياً مع توصية بتوضيح الفترة الزمنية للرصد.',
      'Expected assessment.summary to be returned in Completed status'
    );
    assert(completedStatus.nonAdvisoryOutcome === null, 'Expected nonAdvisoryOutcome === null on Completed');

    // (d) Failed when task is Failed and valid nonAdvisoryOutcome record exists
    const failedArticle = createSampleNewsItem({
      id: 'news-status-9-failed',
      updatedAt: '2026-05-10T11:00:00.000Z',
    });
    await h.newsRepo.save(failedArticle);

    const enqueuedFailed = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: failedArticle.id,
        expectedUpdatedAt: failedArticle.updatedAt,
      }
    );
    const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(h.db as any);
    await nonAdvisoryRepo.saveWithTaskConvergence({
      taskId: enqueuedFailed.task.taskId,
      reconciledTask: enqueuedFailed.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      },
      nonAdvisoryOutcome: {
        taskId: enqueuedFailed.task.taskId,
        kind: 'MODEL_FAILURE',
        reason: 'TIMEOUT',
        modelAttempts: 2,
        createdAt: '2026-05-10T12:15:00.000Z',
        detail: 'Local model runtime timed out during inference.',
      },
      convergedStatus: AITaskStatus.Failed,
      convergedAt: '2026-05-10T12:15:02.000Z',
    });

    const failedStatus = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'getPeiaReviewStatus',
        id: failedArticle.id,
      }
    );
    assert(failedStatus.status === AITaskStatus.Failed, 'Expected Failed status');
    assert(failedStatus.isStale === false, 'Expected isStale === false');
    assert(
      failedStatus.nonAdvisoryOutcome?.reason === 'TIMEOUT',
      'Expected nonAdvisoryOutcome reason TIMEOUT in Failed status'
    );
    assert(failedStatus.advisoryResult === null, 'Expected advisoryResult === null on Failed');
  });

  // 10. getPeiaReviewStatus marks results stale when News updatedAt changes.
  await runTest('10. getPeiaReviewStatus marks tasks/results stale when News updatedAt changes, and returns NotRequested for the new unrequested version', async () => {
    const h = createHarness();
    const article = createSampleNewsItem({
      id: 'news-stale-10',
      updatedAt: '2026-05-10T10:00:00.000Z',
    });
    await h.newsRepo.save(article);

    const enqueuedV1 = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );

    // Advance News updatedAt to v2 without requesting a new PEIA review
    const updatedArticle: NewsItemBackend = {
      ...article,
      bodyAr: 'نص محدث بعد إنشاء مهمة المراجعة الأولى.',
      updatedAt: '2026-05-10T11:45:00.000Z',
    };
    await h.newsRepo.save(updatedArticle);

    // Querying explicit v1 taskId against updated News item must report isStale: true
    const staleV1Status = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'getPeiaReviewStatus',
        id: article.id,
        taskId: enqueuedV1.taskId,
      }
    );
    assert(staleV1Status.status === AITaskStatus.Pending, 'Expected v1 task to still be Pending');
    assert(staleV1Status.isStale === true, 'Expected v1 task to be marked isStale === true');
    assert(
      staleV1Status.taskSourceUpdatedAt === '2026-05-10T10:00:00.000Z',
      'Expected taskSourceUpdatedAt to reflect v1 timestamp'
    );
    assert(
      staleV1Status.currentSourceUpdatedAt === '2026-05-10T11:45:00.000Z',
      'Expected currentSourceUpdatedAt to reflect v2 timestamp'
    );

    // Querying without explicit taskId resolves deterministic v2 taskId -> NotRequested
    const currentV2Status = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'getPeiaReviewStatus',
        id: article.id,
      }
    );
    assert(currentV2Status.status === 'NotRequested', 'Expected NotRequested for unrequested v2');
    assert(currentV2Status.isStale === false, 'Expected isStale === false for NotRequested v2');
  });

  // 11. Cross-item or LibraryIntake taskId is rejected.
  await runTest('11. Cross-item News taskId or LibraryIntake taskId is rejected in getPeiaReviewStatus', async () => {
    const h = createHarness();
    const articleA = createSampleNewsItem({ id: 'news-item-A' });
    const articleB = createSampleNewsItem({ id: 'news-item-B' });
    await h.newsRepo.save(articleA);
    await h.newsRepo.save(articleB);

    const enqueuedB = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: articleB.id,
        expectedUpdatedAt: articleB.updatedAt,
      }
    );

    // Enqueue a LibraryIntake task in the shared peiaReviewTasks queue
    const queueService = new FirestorePeiaTaskQueueService(h.db, {
      clock: () => FIXED_CLOCK_ISO,
    });
    const libraryEnqueue = await queueService.enqueueLibraryIntakeTask({
      targetId: 'intake-doc-55',
      sourceUpdatedAt: '2026-05-10T10:30:00.000Z',
      inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
      title: 'تقرير التنوع الحيوي البحري',
      issuingOrganization: 'برنامج الأمم المتحدة للبيئة',
      language: 'ar',
    });

    // Passing articleB's persisted taskId when querying articleA must fail closed
    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'getPeiaReviewStatus',
            id: articleA.id,
            taskId: enqueuedB.taskId,
          }
        ),
      'failed-precondition',
      'RECONCILIATION_INTEGRITY_ERROR',
      'Cross-item persisted News taskId'
    );

    // Passing LibraryIntake's persisted taskId when querying articleA must fail closed
    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'getPeiaReviewStatus',
            id: articleA.id,
            taskId: libraryEnqueue.task.taskId,
          }
        ),
      'failed-precondition',
      'RECONCILIATION_INTEGRITY_ERROR',
      'Cross-target persisted LibraryIntake taskId'
    );

    // Passing an unpersisted foreign taskId (derived for another item) must also fail closed
    const unpersistedForeignTaskId = derivePeiaTaskId({
      targetType: AIReviewTargetType.LibraryIntake,
      targetId: 'intake-unpersisted-99',
      sourceUpdatedAt: '2026-05-10T10:30:00.000Z',
    });
    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'getPeiaReviewStatus',
            id: articleA.id,
            taskId: unpersistedForeignTaskId,
          }
        ),
      'failed-precondition',
      'CROSS_ITEM_OR_UNKNOWN_TASK_ID',
      'Unpersisted foreign taskId'
    );
  });

  // 12. Concurrent source modification is handled safely.
  await runTest('12. Concurrent source modification between initial News read and transactional task creation is caught and fails closed', async () => {
    // Subcase 12a: News record updatedAt changes after pre-read but before transactional read of news/{id}
    const h1 = createHarness();
    const article1 = createSampleNewsItem({
      id: 'news-race-12a',
      updatedAt: '2026-05-10T10:00:00.000Z',
    });
    await h1.newsRepo.save(article1);

    h1.db.onBeforeTransactionRead = async (colName, docId) => {
      if (colName === 'news' && docId === article1.id) {
        // Simulate concurrent writer updating the News item right before the transaction reads news/{id}
        await h1.newsRepo.save({
          ...article1,
          bodyAr: 'تعديل متزامن أثناء محاولة إنشاء مهمة المراجعة.',
          updatedAt: '2026-05-10T10:05:00.000Z',
        });
      }
    };

    await assertRejectsWithHttpsError(
      () =>
        h1.invoke(
          { uid: 'editor-1' },
          {
            action: 'requestPeiaReview',
            id: article1.id,
            expectedUpdatedAt: '2026-05-10T10:00:00.000Z',
          }
        ),
      'failed-precondition',
      'STALE_SOURCE_VERSION',
      'Concurrent modification before transaction read'
    );
    assert(
      h1.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
      'Zero tasks may be created when source version changes before transaction read'
    );

    // Subcase 12b: News record changes AFTER transactional read of news/{id} but BEFORE transaction commit (OCC retry)
    const h2 = createHarness();
    const article2 = createSampleNewsItem({
      id: 'news-race-12b',
      updatedAt: '2026-05-10T10:00:00.000Z',
    });
    await h2.newsRepo.save(article2);

    h2.db.onBeforeTransactionCommit = async (attempt) => {
      if (attempt === 1) {
        // Simulate concurrent edit to news/{id} after tx.get(newsDocRef) but before commit
        await h2.newsRepo.save({
          ...article2,
          bodyAr: 'تعديل متزامن قبل التثبيت النهائي للمعاملة.',
          updatedAt: '2026-05-10T10:08:00.000Z',
        });
      }
    };

    await assertRejectsWithHttpsError(
      () =>
        h2.invoke(
          { uid: 'editor-1' },
          {
            action: 'requestPeiaReview',
            id: article2.id,
            expectedUpdatedAt: '2026-05-10T10:00:00.000Z',
          }
        ),
      'failed-precondition',
      'STALE_SOURCE_VERSION',
      'Concurrent modification during transaction commit (OCC retry)'
    );
    assert(
      h2.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
      'Zero tasks may be created when OCC detects concurrent News modification before commit'
    );

    // Verify that when no concurrent modification occurs, news/{id} is in the transaction read set before peiaReviewTasks write
    const h3 = createHarness();
    const article3 = createSampleNewsItem({ id: 'news-race-12c' });
    await h3.newsRepo.save(article3);

    const okRes = await h3.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article3.id,
        expectedUpdatedAt: article3.updatedAt,
      }
    );
    assert(okRes.disposition === 'CREATED', 'Expected CREATED when no concurrent edit occurs');
    const enqueueTx = h3.db.transactionHistory[0];
    assert(enqueueTx.readsBeforeWrite === true, 'All transaction reads must occur before writes');
    assert(
      enqueueTx.docRefsRead[0] === `news/${article3.id}`,
      `Expected first transactional read to be news/${article3.id}, got ${enqueueTx.docRefsRead[0]}`
    );
    assert(
      enqueueTx.docRefsWritten.includes(
        `${PEIA_PENDING_TASK_COLLECTION}/${derivePeiaTaskDocumentId(okRes.taskId)}`
      ),
      'Expected transactional write to peiaReviewTasks'
    );
  });

  // 13. Completed + ABSTAINED News PEIA review status reconciliation and idempotent requestPeiaReview replay.
  await runTest('13. Completed + ABSTAINED News PEIA review returns structured DTO with advisoryResult === null and nonAdvisoryOutcome, and fails closed on invalid Completed artifacts', async () => {
    const h = createHarness();
    const article = createSampleNewsItem({
      id: 'news-abstained-13',
      updatedAt: '2026-05-10T14:00:00.000Z',
    });
    await h.newsRepo.save(article);

    const enqueued = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );

    const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(h.db as any);
    await nonAdvisoryRepo.saveWithTaskConvergence({
      taskId: enqueued.taskId,
      reconciledTask: enqueued.task,
      principal: {
        principalId: 'worker-01',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      },
      nonAdvisoryOutcome: {
        taskId: enqueued.taskId,
        kind: 'ABSTAINED',
        reason: 'INVALID_MODEL_OUTPUT',
        modelAttempts: 2,
        createdAt: '2026-05-10T14:05:00.000Z',
        detail: 'Local model output failed schema validation; abstaining safely.',
      },
      convergedStatus: AITaskStatus.Completed,
      convergedAt: '2026-05-10T14:05:02.000Z',
    });

    const abstainedStatus = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'getPeiaReviewStatus',
        id: article.id,
      }
    );
    assert(abstainedStatus.status === AITaskStatus.Completed, 'Expected Completed status for ABSTAINED');
    assert(abstainedStatus.isStale === false, 'Expected isStale === false');
    assert(abstainedStatus.advisoryResult === null, 'Expected advisoryResult === null for ABSTAINED');
    assert(
      abstainedStatus.nonAdvisoryOutcome?.kind === 'ABSTAINED',
      'Expected nonAdvisoryOutcome.kind === ABSTAINED'
    );
    assert(
      abstainedStatus.nonAdvisoryOutcome?.reason === 'INVALID_MODEL_OUTPUT',
      'Expected nonAdvisoryOutcome.reason === INVALID_MODEL_OUTPUT'
    );

    // Idempotent requestPeiaReview replay on Completed + ABSTAINED returns ALREADY_EXISTS with the same reconciled DTO
    const replayRes = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: article.id,
        expectedUpdatedAt: article.updatedAt,
      }
    );
    assert(replayRes.disposition === 'ALREADY_EXISTS', 'Expected ALREADY_EXISTS on replay');
    assert(replayRes.status === AITaskStatus.Completed, 'Expected Completed status on replay');
    assert(replayRes.advisoryResult === null, 'Expected advisoryResult === null on replay');
    assert(
      replayRes.nonAdvisoryOutcome?.kind === 'ABSTAINED',
      'Expected nonAdvisoryOutcome.kind === ABSTAINED on replay'
    );

    // Invalid Completed + MODEL_FAILURE fails closed with failed-precondition (RECONCILIATION_INTEGRITY_ERROR)
    const invalidArticle = createSampleNewsItem({
      id: 'news-invalid-completed-13b',
      updatedAt: '2026-05-10T14:10:00.000Z',
    });
    await h.newsRepo.save(invalidArticle);

    const enqueuedInvalid = await h.invoke(
      { uid: 'editor-1' },
      {
        action: 'requestPeiaReview',
        id: invalidArticle.id,
        expectedUpdatedAt: invalidArticle.updatedAt,
      }
    );
    h.db.seedDocument(
      PEIA_PENDING_TASK_COLLECTION,
      derivePeiaTaskDocumentId(enqueuedInvalid.taskId),
      {
        ...enqueuedInvalid.task,
        status: AITaskStatus.Completed,
      }
    );
    h.db.seedDocument(
      PEIA_NON_ADVISORY_OUTCOME_COLLECTION,
      deriveNonAdvisoryOutcomeDocumentId(enqueuedInvalid.taskId),
      {
        taskId: enqueuedInvalid.taskId,
        reconciledTask: enqueuedInvalid.task,
        principal: {
          principalId: 'worker-01',
          isActive: true,
          capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
        },
        nonAdvisoryOutcome: {
          taskId: enqueuedInvalid.taskId,
          kind: 'MODEL_FAILURE',
          reason: 'TIMEOUT',
          modelAttempts: 2,
          createdAt: '2026-05-10T14:12:00.000Z',
        },
        convergedStatus: AITaskStatus.Failed,
        convergedAt: '2026-05-10T14:12:01.000Z',
      }
    );

    await assertRejectsWithHttpsError(
      () =>
        h.invoke(
          { uid: 'editor-1' },
          {
            action: 'getPeiaReviewStatus',
            id: invalidArticle.id,
          }
        ),
      'failed-precondition',
      'RECONCILIATION_INTEGRITY_ERROR',
      'Completed News task with MODEL_FAILURE artifact'
    );
  });

  const failed = results.filter((r) => !r.passed);
  for (const r of results) {
    if (r.passed) {
      console.log(`PASS [${r.id}] ${r.name}`);
    } else {
      console.error(`FAIL [${r.id}] ${r.name}: ${r.message}`);
    }
  }
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
