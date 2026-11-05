import Module, { createRequire } from 'node:module';
import * as crypto from 'node:crypto';
import type { LibraryApplicationService as LibraryApplicationServiceType } from '../functions/src/library/libraryApplicationService';
import type { LibraryRepository } from '../functions/src/library/libraryRepository';
import { LibraryValidator } from '../functions/src/library/libraryValidator';
import type { FirestoreLibraryRepository as FirestoreLibraryRepositoryType } from '../functions/src/library/firestoreLibraryRepository';
import type { AdminRepository } from '../functions/src/admin/adminRepository';
import { AdminRole, type AdminUser } from '../functions/src/types/admin';
import { WorkflowState } from '../functions/src/shared/workflowContract';
import {
  LibraryDocumentType,
  LibraryRightsStatus,
  LibraryIntakeStatus,
  type LibraryDocument,
  type LibraryOrganization,
  type LibrarySource,
  type LibraryIntakeRecord,
  type LibraryIntakeAISuggestion,
} from '../functions/src/shared/libraryContract';
import {
  AIReviewTargetType,
  AIReviewSeverity,
  PEIALibraryPreparationInputBasis,
  PEIALibrarySuggestedDocumentType,
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
import { FirestoreAdvisoryResultRepository } from '../functions/src/peia/firestoreAdvisoryResultRepository';
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
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
): unknown {
  try {
    return originalModuleLoad.call(this, request, parent, isMain);
  } catch (err: unknown) {
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: FallbackHttpsError,
        onCall: (_opts: unknown, handler: unknown) => handler,
      };
    }
    if (request === 'firebase-functions/params') {
      return {
        defineSecret: (name: string) => ({
          name,
          value: () => process.env[name] || '',
        }),
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error(
            'Live getFirestore() must not be invoked in headless integration tests.'
          );
        },
      };
    }
    throw err;
  }
};

const require = createRequire(import.meta.url);
const { FirestoreLibraryRepository } = require(
  '../functions/src/library/firestoreLibraryRepository'
) as {
  FirestoreLibraryRepository: typeof FirestoreLibraryRepositoryType;
};
const { LibraryApplicationService } = require(
  '../functions/src/library/libraryApplicationService'
) as {
  LibraryApplicationService: typeof LibraryApplicationServiceType;
};
const { executeManageLibraryDocumentsRequest } = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const results: TestResult[] = [];
let nextId = 1;

async function runTest(
  name: string,
  fn: () => Promise<void> | void
): Promise<void> {
  const id = nextId++;
  try {
    await fn();
    results.push({ id, name, passed: true });
  } catch (err: unknown) {
    results.push({
      id,
      name,
      passed: false,
      message:
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
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
    const candidate = err as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
    } | null;
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
 * In-memory transactional Firestore backing both Library collections
 * (`library_documents`, `library_organizations`, `library_sources`,
 * `library_intake`, `library_intake_urls`) and canonical PEIA collections
 * (`peiaReviewTasks`, `peiaAdvisoryResults`, `peiaNonAdvisoryOutcomes`),
 * supporting optimistic concurrency control (OCC) and transactional hooks.
 */
class InMemoryLibraryAndPeiaFirestore implements PeiaTaskQueueFirestoreDatabase {
  readonly collections = new Map<string, Map<string, unknown>>();
  readonly transactionHistory: TransactionAudit[] = [];
  private readonly docVersions = new Map<string, number>();
  private commitCounter = 0;
  public onBeforeTransactionRead?: (
    collectionName: string,
    docId: string,
    attempt: number
  ) => Promise<void> | void;
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

  deleteDocumentDirect(collectionName: string, docId: string): void {
    const col = this.getMap(collectionName);
    col.delete(docId);
    this.bumpDocVersion(collectionName, docId);
  }

  readDocumentDirect<T = unknown>(
    collectionName: string,
    docId: string
  ): T | undefined {
    const raw = this.collections.get(collectionName)?.get(docId);
    return raw !== undefined ? cloneJson(raw as T) : undefined;
  }

  listCollectionDirect<T = unknown>(collectionName: string): T[] {
    const col = this.collections.get(collectionName);
    if (!col) return [];
    return Array.from(col.values()).map((v) => cloneJson(v as T));
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
      const stagedCreateKeys: Array<{ collectionName: string; docId: string }> =
        [];

      const tx: any = {
        get: async (target: any) => {
          if (hasWritten) {
            readsBeforeWrite = false;
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.'
            );
          }
          if (typeof target?.__execute === 'function') {
            const colName = target.__collectionName as string;
            const col = this.getMap(colName);
            for (const [docId] of col.entries()) {
              readVersions.set(
                `${colName}/${docId}`,
                this.getDocVersion(colName, docId)
              );
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
            id: docId,
            ref: { id: docId, __collectionName: colName },
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
          throw new Error(
            'Transaction max retries exceeded due to concurrent conflict.'
          );
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

/**
 * Repository implementation backed directly by `InMemoryLibraryAndPeiaFirestore`,
 * mirroring `FirestoreLibraryRepository` collection names and semantics.
 */
class InMemoryFirestoreBackedLibraryRepository implements LibraryRepository {
  constructor(private readonly db: InMemoryLibraryAndPeiaFirestore) {}

  async getById(id: string): Promise<LibraryDocument | null> {
    if (!id || typeof id !== 'string') return null;
    const raw = this.db.readDocumentDirect<LibraryDocument>(
      FirestoreLibraryRepository.COLLECTION,
      id.trim()
    );
    if (!raw) return null;
    return LibraryValidator.validatePersistedDocument(raw, id.trim());
  }

  async create(doc: LibraryDocument): Promise<LibraryDocument> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.COLLECTION,
      doc.id
    );
    if (existing) {
      throw new Error(
        `DUPLICATE_DOCUMENT: Document with ID ${doc.id} already exists`
      );
    }
    const clean = cloneJson(doc);
    this.db.seedDocument(FirestoreLibraryRepository.COLLECTION, doc.id, clean);
    return doc;
  }

  async update(doc: LibraryDocument): Promise<LibraryDocument> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.COLLECTION,
      doc.id
    );
    if (!existing) {
      throw new Error(`NOT_FOUND: Document with ID ${doc.id} not found`);
    }
    const clean = cloneJson(doc);
    this.db.seedDocument(FirestoreLibraryRepository.COLLECTION, doc.id, clean);
    return doc;
  }

  async listAll(): Promise<LibraryDocument[]> {
    return this.db
      .listCollectionDirect<LibraryDocument>(
        FirestoreLibraryRepository.COLLECTION
      )
      .map((d) => LibraryValidator.validatePersistedDocument(d, d.id));
  }

  async getOrganizationById(id: string): Promise<LibraryOrganization | null> {
    if (!id || typeof id !== 'string') return null;
    const org = this.db.readDocumentDirect<LibraryOrganization>(
      FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION,
      id.trim()
    );
    return org ? { ...org, id: id.trim() } : null;
  }

  async listOrganizations(): Promise<LibraryOrganization[]> {
    return this.db.listCollectionDirect<LibraryOrganization>(
      FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION
    );
  }

  async createOrganization(
    org: LibraryOrganization
  ): Promise<LibraryOrganization> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION,
      org.id
    );
    if (existing) {
      throw new Error(
        `DUPLICATE_ORGANIZATION: Organization with ID ${org.id} already exists`
      );
    }
    this.db.seedDocument(
      FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION,
      org.id,
      org
    );
    return org;
  }

  async updateOrganization(
    org: LibraryOrganization
  ): Promise<LibraryOrganization> {
    this.db.seedDocument(
      FirestoreLibraryRepository.ORGANIZATIONS_COLLECTION,
      org.id,
      org
    );
    return org;
  }

  async getSourceById(id: string): Promise<LibrarySource | null> {
    if (!id || typeof id !== 'string') return null;
    const src = this.db.readDocumentDirect<LibrarySource>(
      FirestoreLibraryRepository.SOURCES_COLLECTION,
      id.trim()
    );
    return src ? { ...src, id: id.trim() } : null;
  }

  async listSources(): Promise<LibrarySource[]> {
    return this.db.listCollectionDirect<LibrarySource>(
      FirestoreLibraryRepository.SOURCES_COLLECTION
    );
  }

  async createSource(source: LibrarySource): Promise<LibrarySource> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.SOURCES_COLLECTION,
      source.id
    );
    if (existing) {
      throw new Error(
        `DUPLICATE_SOURCE: Source with ID ${source.id} already exists`
      );
    }
    this.db.seedDocument(
      FirestoreLibraryRepository.SOURCES_COLLECTION,
      source.id,
      source
    );
    return source;
  }

  async updateSource(source: LibrarySource): Promise<LibrarySource> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.SOURCES_COLLECTION,
      source.id
    );
    if (!existing) {
      throw new Error(`NOT_FOUND: Source with ID ${source.id} not found`);
    }
    this.db.seedDocument(
      FirestoreLibraryRepository.SOURCES_COLLECTION,
      source.id,
      source
    );
    return source;
  }

  async getIntakeById(id: string): Promise<LibraryIntakeRecord | null> {
    if (!id || typeof id !== 'string') return null;
    const rec = this.db.readDocumentDirect<LibraryIntakeRecord>(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      id.trim()
    );
    return rec ? { ...rec, id: id.trim() } : null;
  }

  async listIntake(): Promise<LibraryIntakeRecord[]> {
    const records = this.db.listCollectionDirect<LibraryIntakeRecord>(
      FirestoreLibraryRepository.INTAKE_COLLECTION
    );
    return records.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createIntake(
    record: LibraryIntakeRecord
  ): Promise<LibraryIntakeRecord> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      record.id
    );
    if (existing) {
      throw new Error(
        `DUPLICATE_INTAKE: Intake record with ID ${record.id} already exists`
      );
    }
    const urlHash = crypto
      .createHash('sha256')
      .update(record.normalizedUrl.trim().toLowerCase())
      .digest('hex');
    const existingUrl = this.db.readDocumentDirect(
      FirestoreLibraryRepository.INTAKE_URLS_COLLECTION,
      urlHash
    );
    if (existingUrl) {
      throw new Error(
        `DUPLICATE_INTAKE: Reference URL already exists in intake queue: ${record.normalizedUrl}`
      );
    }
    this.db.seedDocument(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      record.id,
      record
    );
    this.db.seedDocument(
      FirestoreLibraryRepository.INTAKE_URLS_COLLECTION,
      urlHash,
      {
        intakeId: record.id,
        normalizedUrl: record.normalizedUrl,
        createdAt: record.createdAt,
      }
    );
    return record;
  }

  async updateIntake(
    record: LibraryIntakeRecord
  ): Promise<LibraryIntakeRecord> {
    const existing = this.db.readDocumentDirect(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      record.id
    );
    if (!existing) {
      throw new Error(
        `NOT_FOUND: Intake record with ID ${record.id} not found`
      );
    }
    this.db.seedDocument(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      record.id,
      record
    );
    return record;
  }

  async saveIntakeAISuggestion(
    intakeId: string,
    expectedUpdatedAt: string,
    suppliedExcerpt: string | undefined,
    aiSuggestion: LibraryIntakeAISuggestion,
    updatedAt: string
  ): Promise<LibraryIntakeRecord> {
    const existing = this.db.readDocumentDirect<LibraryIntakeRecord>(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      intakeId.trim()
    );
    if (!existing) {
      throw new Error(
        `NOT_FOUND: Intake record with ID ${intakeId} not found`
      );
    }
    if (existing.updatedAt !== expectedUpdatedAt) {
      throw new Error(
        `CONFLICT: Intake record ${intakeId} was modified by a newer editorial action while AI preparation was in flight.`
      );
    }
    const nextRecord: LibraryIntakeRecord = {
      ...existing,
      id: intakeId.trim(),
      ...(suppliedExcerpt !== undefined ? { suppliedExcerpt } : {}),
      aiSuggestion,
      updatedAt,
    };
    this.db.seedDocument(
      FirestoreLibraryRepository.INTAKE_COLLECTION,
      intakeId.trim(),
      nextRecord
    );
    return nextRecord;
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

  async saveAdmin(user: AdminUser): Promise<AdminUser> {
    const cloned = cloneJson(user);
    this.admins.set(user.id, cloned);
    return cloned;
  }
}

const FIXED_CLOCK_ISO = '2026-06-15T12:00:00.000Z';

const SAMPLE_ADMINS: readonly AdminUser[] = [
  {
    id: 'owner-1',
    name: 'Platform Owner',
    email: 'owner@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  },
  {
    id: 'curator-1',
    name: 'Senior Library Curator',
    email: 'curator@promiseofplanet.org',
    role: AdminRole.LibraryCurator,
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
    id: 'editor-1',
    name: 'Content Editor',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  },
  {
    id: 'training-manager-1',
    name: 'Training Manager',
    email: 'training-manager@promiseofplanet.org',
    role: AdminRole.TrainingManager,
    isActive: true,
  },
  {
    id: 'trainer-1',
    name: 'Trainer',
    email: 'trainer@promiseofplanet.org',
    role: AdminRole.Trainer,
    isActive: true,
  },
  {
    id: 'citizen-mod-1',
    name: 'Citizen Moderator',
    email: 'citizen-mod@promiseofplanet.org',
    role: AdminRole.CitizenModerator,
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
    id: 'inactive-curator',
    name: 'Inactive Curator',
    email: 'inactive@promiseofplanet.org',
    role: AdminRole.LibraryCurator,
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

function createSampleOrganization(
  overrides: Partial<LibraryOrganization> = {}
): LibraryOrganization {
  return {
    id: 'org-unep-1',
    nameAr: 'برنامج الأمم المتحدة للبيئة',
    nameEn: 'United Nations Environment Programme',
    type: 'InternationalBody',
    countryRegionAr: 'دولي',
    countryRegionEn: 'International',
    websiteUrl: 'https://www.unep.org',
    createdAt: '2026-06-15T08:00:00.000Z',
    updatedAt: '2026-06-15T08:00:00.000Z',
    ...overrides,
  };
}

function createSampleSource(
  overrides: Partial<LibrarySource> = {}
): LibrarySource {
  return {
    id: 'src-unep-archive-1',
    organizationId: 'org-unep-1',
    sourceNameAr: 'الأرشيف الرسمي لبرنامج الأمم المتحدة للبيئة',
    sourceNameEn: 'Official UNEP Institutional Archive',
    sourceUrl: 'https://wedocs.unep.org',
    sourceType: 'InstitutionalArchive',
    verificationStatus: 'Verified',
    createdAt: '2026-06-15T08:30:00.000Z',
    updatedAt: '2026-06-15T08:30:00.000Z',
    ...overrides,
  };
}

function createSampleIntakeRecord(
  overrides: Partial<LibraryIntakeRecord> = {}
): LibraryIntakeRecord {
  return {
    id: 'intake-doc-101',
    url: 'https://wedocs.unep.org/bitstream/handle/20.500.11822/red-sea-2026.pdf',
    normalizedUrl:
      'https://wedocs.unep.org/bitstream/handle/20.500.11822/red-sea-2026.pdf',
    title: 'تقرير تقييم التنوع الحيوي البحري في البحر الأحمر وخليج عدن 2026',
    organizationId: 'org-unep-1',
    sourceId: 'src-unep-archive-1',
    language: 'ar',
    notes: 'مرجع مؤسسي مقترح للإدراج في قسم التقارير الدولية.',
    status: LibraryIntakeStatus.PendingReview,
    submittedByAdminId: 'curator-1',
    submittedByAdminName: 'Senior Library Curator',
    createdAt: '2026-06-15T09:00:00.000Z',
    updatedAt: '2026-06-15T10:30:00.000Z',
    ...overrides,
  };
}

function createHarness() {
  const db = new InMemoryLibraryAndPeiaFirestore();
  const libraryRepo = new InMemoryFirestoreBackedLibraryRepository(db);
  const service = new LibraryApplicationService(libraryRepo);
  const adminRepo = new InMemoryAdminRepository(SAMPLE_ADMINS);
  let clockIso = FIXED_CLOCK_ISO;

  return {
    db,
    libraryRepo,
    service,
    adminRepo,
    setClock: (iso: string) => {
      clockIso = iso;
    },
    invoke: (
      auth: { uid: string; token?: Record<string, unknown> } | undefined,
      data: unknown,
      geminiOptions?: {
        readonly apiKey?: string;
        readonly fetchImpl?: typeof fetch;
        readonly timeoutMs?: number;
      }
    ) =>
      executeManageLibraryDocumentsRequest(
        { auth, data: data as Record<string, any> },
        adminRepo,
        service,
        db,
        { clock: () => clockIso },
        geminiOptions
      ),
  };
}

async function main(): Promise<void> {
  // 1. Human admin can request preparation.
  await runTest(
    '1. Authorized human admins (LibraryCurator, Owner, RightsReviewer) can request LibraryIntake PEIA preparation',
    async () => {
      const h = createHarness();
      const org = createSampleOrganization();
      const src = createSampleSource();
      await h.libraryRepo.createOrganization(org);
      await h.libraryRepo.createSource(src);

      const intake1 = createSampleIntakeRecord({ id: 'intake-101' });
      const intake2 = createSampleIntakeRecord({
        id: 'intake-102',
        normalizedUrl: 'https://wedocs.unep.org/report-102.pdf',
        status: LibraryIntakeStatus.InPreparation,
        updatedAt: '2026-06-15T11:00:00.000Z',
      });
      const intake3 = createSampleIntakeRecord({
        id: 'intake-103',
        normalizedUrl: 'https://wedocs.unep.org/report-103.pdf',
        status: LibraryIntakeStatus.PendingReview,
        updatedAt: '2026-06-15T11:30:00.000Z',
      });
      await h.libraryRepo.createIntake(intake1);
      await h.libraryRepo.createIntake(intake2);
      await h.libraryRepo.createIntake(intake3);

      const curatorRes = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake1.id,
          expectedUpdatedAt: intake1.updatedAt,
        }
      );

      assert(
        curatorRes.disposition === 'CREATED',
        'Expected CREATED disposition for curator-1'
      );
      assert(
        curatorRes.status === AITaskStatus.Pending,
        'Expected Pending status after enqueue'
      );
      assert(curatorRes.isStale === false, 'Expected isStale === false');
      assert(
        curatorRes.task.taskType === AITaskType.CONTENT_REVIEW,
        'Expected CONTENT_REVIEW taskType'
      );
      assert(
        curatorRes.task.target.targetType === AIReviewTargetType.LibraryIntake,
        'Expected LibraryIntake targetType'
      );
      assert(
        curatorRes.task.target.targetId === intake1.id,
        'Expected targetId to match intake1.id'
      );
      assert(
        curatorRes.task.target.sourceUpdatedAt === intake1.updatedAt,
        'Expected sourceUpdatedAt to match intake1.updatedAt'
      );

      const curatorStatus = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake1.id,
        }
      );
      assert(
        curatorStatus.status === AITaskStatus.Pending,
        'Expected curator-1 to read Pending status on getIntakePeiaPreparationStatus'
      );

      const ownerRes = await h.invoke(
        { uid: 'owner-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake2.id,
          expectedUpdatedAt: intake2.updatedAt,
        }
      );
      assert(
        ownerRes.disposition === 'CREATED',
        'Expected CREATED disposition for owner-1 on InPreparation intake'
      );

      const ownerStatus = await h.invoke(
        { uid: 'owner-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake2.id,
        }
      );
      assert(
        ownerStatus.status === AITaskStatus.Pending,
        'Expected owner-1 to read Pending status on getIntakePeiaPreparationStatus'
      );

      const rightsRes = await h.invoke(
        { uid: 'rights-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake3.id,
          expectedUpdatedAt: intake3.updatedAt,
        }
      );
      assert(
        rightsRes.disposition === 'CREATED',
        'Expected CREATED disposition for rights-1 under narrow Library PEIA RightsReviewer exception'
      );

      const rightsStatus = await h.invoke(
        { uid: 'rights-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake3.id,
        }
      );
      assert(
        rightsStatus.status === AITaskStatus.Pending,
        'Expected rights-1 to read Pending status on getIntakePeiaPreparationStatus'
      );
    }
  );

  // 2. Automated/AI caller rejected.
  await runTest(
    '2. Automated/AI callers (AIAssistant role or automated/AI token claims) are rejected on both actions',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord();
      await h.libraryRepo.createIntake(intake);

      const reqPayload = {
        action: 'requestIntakePeiaPreparation',
        intakeId: intake.id,
        expectedUpdatedAt: intake.updatedAt,
      };
      const statusPayload = {
        action: 'getIntakePeiaPreparationStatus',
        intakeId: intake.id,
      };

      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'ai-assistant-1' }, reqPayload),
        'permission-denied',
        'AI_ACTION_FORBIDDEN',
        'AIAssistant role requestIntakePeiaPreparation'
      );
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'ai-assistant-1' }, statusPayload),
        'permission-denied',
        'AI_ACTION_FORBIDDEN',
        'AIAssistant role getIntakePeiaPreparationStatus'
      );

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
          `Token claim ${JSON.stringify(claim)} on requestIntakePeiaPreparation`
        );
        await assertRejectsWithHttpsError(
          () => h.invoke({ uid: 'owner-1', token: claim }, statusPayload),
          'permission-denied',
          'AI_ACTION_FORBIDDEN',
          `Token claim ${JSON.stringify(claim)} on getIntakePeiaPreparationStatus`
        );
      }

      assert(
        h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Zero tasks created when automated/AI caller is rejected'
      );
    }
  );

  // 3. Inactive/missing admin rejected.
  await runTest(
    '3. Unauthenticated, unregistered, and inactive admins are rejected',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord();
      await h.libraryRepo.createIntake(intake);

      const reqPayload = {
        action: 'requestIntakePeiaPreparation',
        intakeId: intake.id,
        expectedUpdatedAt: intake.updatedAt,
      };
      const statusPayload = {
        action: 'getIntakePeiaPreparationStatus',
        intakeId: intake.id,
      };

      await assertRejectsWithHttpsError(
        () => h.invoke(undefined, reqPayload),
        'unauthenticated',
        'UNAUTHENTICATED',
        'Missing auth on requestIntakePeiaPreparation'
      );
      await assertRejectsWithHttpsError(
        () => h.invoke(undefined, statusPayload),
        'unauthenticated',
        'UNAUTHENTICATED',
        'Missing auth on getIntakePeiaPreparationStatus'
      );

      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'unregistered-user-99' }, reqPayload),
        'permission-denied',
        'ADMIN_NOT_REGISTERED',
        'Unregistered admin on requestIntakePeiaPreparation'
      );
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'unregistered-user-99' }, statusPayload),
        'permission-denied',
        'ADMIN_NOT_REGISTERED',
        'Unregistered admin on getIntakePeiaPreparationStatus'
      );

      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'inactive-curator' }, reqPayload),
        'permission-denied',
        'ADMIN_INACTIVE',
        'Inactive admin on requestIntakePeiaPreparation'
      );
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'inactive-curator' }, statusPayload),
        'permission-denied',
        'ADMIN_INACTIVE',
        'Inactive admin on getIntakePeiaPreparationStatus'
      );
    }
  );

  // 4. Cross-domain and missing-permission callers rejected on both actions.
  await runTest(
    '4. Cross-domain roles (ContentEditor, TrainingManager, Trainer, CitizenModerator, Viewer) and users lacking required permissions are rejected on both PEIA actions before any queue write',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord();
      await h.libraryRepo.createIntake(intake);

      const reqPayload = {
        action: 'requestIntakePeiaPreparation',
        intakeId: intake.id,
        expectedUpdatedAt: intake.updatedAt,
      };
      const statusPayload = {
        action: 'getIntakePeiaPreparationStatus',
        intakeId: intake.id,
      };

      const rejectedCrossDomainUids = [
        'editor-1',
        'training-manager-1',
        'trainer-1',
        'citizen-mod-1',
        'viewer-1',
      ];

      for (const uid of rejectedCrossDomainUids) {
        await assertRejectsWithHttpsError(
          () => h.invoke({ uid }, reqPayload),
          'permission-denied',
          'PERMISSION_DENIED: AdminUser lacks Library domain responsibility',
          `Cross-domain caller ${uid} calling requestIntakePeiaPreparation`
        );

        await assertRejectsWithHttpsError(
          () => h.invoke({ uid }, statusPayload),
          'permission-denied',
          'PERMISSION_DENIED: AdminUser lacks Library domain responsibility',
          `Cross-domain caller ${uid} calling getIntakePeiaPreparationStatus`
        );
      }

      // Admin with an unmapped role is also rejected
      await h.adminRepo.saveAdmin({
        id: 'no-perms-user',
        name: 'No Perms',
        email: 'noperms@promiseofplanet.org',
        role: 'UnmappedCustomRole' as any,
        isActive: true,
      });
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'no-perms-user' }, reqPayload),
        'permission-denied',
        'PERMISSION_DENIED',
        'Unmapped role calling requestIntakePeiaPreparation'
      );
      await assertRejectsWithHttpsError(
        () => h.invoke({ uid: 'no-perms-user' }, statusPayload),
        'permission-denied',
        'PERMISSION_DENIED',
        'Unmapped role calling getIntakePeiaPreparationStatus'
      );

      assert(
        h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Expected zero PEIA queue documents created when cross-domain callers are rejected'
      );
      assert(
        h.db.transactionHistory.length === 0,
        'Expected zero PEIA queue transactions executed when cross-domain callers are rejected'
      );
    }
  );

  // 5. Client-supplied content and authority rejected.
  await runTest(
    '5. Client-supplied content, excerpt, organization name, snapshot, status, task, role, and permission fields are rejected',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord();
      await h.libraryRepo.createIntake(intake);

      const prohibitedRequestFields = [
        'suppliedExcerpt',
        'title',
        'notes',
        'issuingOrganization',
        'organizationName',
        'sourceNotes',
        'organizationId',
        'sourceId',
        'language',
        'inputBasis',
        'taskId',
        'taskType',
        'status',
        'createdAt',
        'contentSnapshot',
        'targetType',
        'targetId',
        'sourceUpdatedAt',
        'role',
        'permission',
        'permissions',
        'approved',
        'published',
        'workflowState',
      ];

      for (const field of prohibitedRequestFields) {
        await assertRejectsWithHttpsError(
          () =>
            h.invoke(
              { uid: 'curator-1' },
              {
                action: 'requestIntakePeiaPreparation',
                intakeId: intake.id,
                expectedUpdatedAt: intake.updatedAt,
                [field]: 'client-injected-value',
              }
            ),
          'invalid-argument',
          'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
          `requestIntakePeiaPreparation with forbidden field '${field}'`
        );
      }

      const prohibitedStatusFields = [
        'suppliedExcerpt',
        'title',
        'notes',
        'issuingOrganization',
        'sourceNotes',
        'inputBasis',
        'taskType',
        'status',
        'contentSnapshot',
        'targetType',
        'targetId',
        'sourceUpdatedAt',
        'expectedUpdatedAt',
        'role',
        'permission',
        'permissions',
      ];

      for (const field of prohibitedStatusFields) {
        await assertRejectsWithHttpsError(
          () =>
            h.invoke(
              { uid: 'curator-1' },
              {
                action: 'getIntakePeiaPreparationStatus',
                intakeId: intake.id,
                [field]: 'client-injected-value',
              }
            ),
          'invalid-argument',
          'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD',
          `getIntakePeiaPreparationStatus with forbidden field '${field}'`
        );
      }
    }
  );

  // 6. Missing intake rejected.
  await runTest(
    '6. Missing intake record is rejected with not-found on both actions',
    async () => {
      const h = createHarness();

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: 'missing-intake-404',
              expectedUpdatedAt: '2026-06-15T10:30:00.000Z',
            }
          ),
        'not-found',
        'NOT_FOUND',
        'Missing intake on requestIntakePeiaPreparation'
      );

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'getIntakePeiaPreparationStatus',
              intakeId: 'missing-intake-404',
            }
          ),
        'not-found',
        'NOT_FOUND',
        'Missing intake on getIntakePeiaPreparationStatus'
      );
    }
  );

  // 7. Rejected intake rejected.
  await runTest(
    '7. Rejected intake record is rejected with failed-precondition (INTAKE_REJECTED)',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const rejectedIntake = createSampleIntakeRecord({
        id: 'intake-rejected-7',
        status: LibraryIntakeStatus.Rejected,
      });
      await h.libraryRepo.createIntake(rejectedIntake);

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: rejectedIntake.id,
              expectedUpdatedAt: rejectedIntake.updatedAt,
            }
          ),
        'failed-precondition',
        'INTAKE_REJECTED',
        'Rejected intake record'
      );

      assert(
        h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Zero tasks created for Rejected intake record'
      );
    }
  );

  // 8. Stale expectedUpdatedAt rejected.
  await runTest(
    '8. Stale expectedUpdatedAt is rejected with failed-precondition (STALE_SOURCE_VERSION)',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({
        id: 'intake-stale-8',
        updatedAt: '2026-06-15T10:30:00.000Z',
      });
      await h.libraryRepo.createIntake(intake);

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: intake.id,
              expectedUpdatedAt: '2026-06-15T09:00:00.000Z',
            }
          ),
        'failed-precondition',
        'STALE_SOURCE_VERSION',
        'Stale expectedUpdatedAt'
      );
    }
  );

  // 9. MetadataOnly task uses no fabricated excerpt.
  await runTest(
    '9. Intake without persisted suppliedExcerpt produces MetadataOnly task with no fabricated excerpt',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({
        id: 'intake-metadata-only-9',
        suppliedExcerpt: undefined,
      });
      await h.libraryRepo.createIntake(intake);

      const res = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );

      assert(
        res.inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly,
        'Expected MetadataOnly inputBasis'
      );
      assert(
        res.task.contentSnapshot['inputBasis'] ===
          PEIALibraryPreparationInputBasis.MetadataOnly,
        'Expected contentSnapshot.inputBasis === MetadataOnly'
      );
      assert(
        !('suppliedExcerpt' in res.task.contentSnapshot),
        'MetadataOnly task must not contain suppliedExcerpt key'
      );
    }
  );

  // 10. Persisted suppliedExcerpt generates correct inputBasis.
  await runTest(
    '10. Persisted suppliedExcerpt generates SuppliedExcerptAndMetadata inputBasis with normalized excerpt',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({
        id: 'intake-with-excerpt-10',
        suppliedExcerpt:
          '  المادة (1): يهدف هذا التقرير إلى رصد الشعاب المرجانية.\r\nالمادة (2): تطبق المعايير البيئية المعتمدة.  ',
      });
      await h.libraryRepo.createIntake(intake);

      const res = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );

      assert(
        res.inputBasis ===
          PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        'Expected SuppliedExcerptAndMetadata inputBasis'
      );
      assert(
        res.task.contentSnapshot['inputBasis'] ===
          PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        'Expected contentSnapshot.inputBasis === SuppliedExcerptAndMetadata'
      );
      assert(
        res.task.contentSnapshot['suppliedExcerpt'] ===
          'المادة (1): يهدف هذا التقرير إلى رصد الشعاب المرجانية.\nالمادة (2): تطبق المعايير البيئية المعتمدة.',
        'Expected normalized persisted suppliedExcerpt in contentSnapshot'
      );
    }
  );

  // 11. Organization/source metadata resolved safely.
  await runTest(
    '11. Organization and source metadata are resolved from server-side repositories and broken references fail closed',
    async () => {
      const h = createHarness();
      const org = createSampleOrganization({
        id: 'org-11',
        nameAr: 'الهيئة الإقليمية للمحافظة على بيئة البحر الأحمر وخليج عدن',
        nameEn: 'PERSGA',
      });
      const src = createSampleSource({
        id: 'src-11',
        organizationId: 'org-11',
        sourceNameAr: 'البوابة الرسمية للهيئة الإقليمية',
        sourceNameEn: 'PERSGA Official Portal',
        sourceType: 'GovernmentPortal',
        verificationStatus: 'Verified',
        sourceUrl: 'https://www.persga.org/publications',
      });
      await h.libraryRepo.createOrganization(org);
      await h.libraryRepo.createSource(src);

      const intake = createSampleIntakeRecord({
        id: 'intake-org-src-11',
        organizationId: org.id,
        sourceId: src.id,
      });
      await h.libraryRepo.createIntake(intake);

      const res = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );

      assert(
        res.task.contentSnapshot['issuingOrganization'] ===
          'الهيئة الإقليمية للمحافظة على بيئة البحر الأحمر وخليج عدن (PERSGA)',
        `Unexpected issuingOrganization: ${String(res.task.contentSnapshot['issuingOrganization'])}`
      );
      assert(
        res.task.contentSnapshot['sourceNotes'] ===
          'البوابة الرسمية للهيئة الإقليمية (PERSGA Official Portal) | type=GovernmentPortal | verificationStatus=Verified | url=https://www.persga.org/publications',
        `Unexpected sourceNotes: ${String(res.task.contentSnapshot['sourceNotes'])}`
      );

      // Broken organization reference must fail closed
      const brokenOrgIntake = createSampleIntakeRecord({
        id: 'intake-broken-org-11',
        normalizedUrl: 'https://www.persga.org/broken-org.pdf',
        organizationId: 'missing-org-999',
        sourceId: undefined,
      });
      await h.libraryRepo.createIntake(brokenOrgIntake);

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: brokenOrgIntake.id,
              expectedUpdatedAt: brokenOrgIntake.updatedAt,
            }
          ),
        'failed-precondition',
        'BROKEN_ORGANIZATION_REFERENCE',
        'Broken organization reference'
      );

      // Broken source reference must fail closed
      const brokenSrcIntake = createSampleIntakeRecord({
        id: 'intake-broken-src-11',
        normalizedUrl: 'https://www.persga.org/broken-src.pdf',
        organizationId: org.id,
        sourceId: 'missing-src-999',
      });
      await h.libraryRepo.createIntake(brokenSrcIntake);

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: brokenSrcIntake.id,
              expectedUpdatedAt: brokenSrcIntake.updatedAt,
            }
          ),
        'failed-precondition',
        'BROKEN_SOURCE_REFERENCE',
        'Broken source reference'
      );
    }
  );

  // 12. Concurrent intake update prevents stale task.
  await runTest(
    '12. Concurrent intake update (before transactional read or before commit via OCC retry) prevents stale task creation',
    async () => {
      // 12a: Concurrent update to library_intake/{id} before transactional read
      const h1 = createHarness();
      await h1.libraryRepo.createOrganization(createSampleOrganization());
      await h1.libraryRepo.createSource(createSampleSource());
      const intake1 = createSampleIntakeRecord({
        id: 'intake-race-12a',
        updatedAt: '2026-06-15T10:00:00.000Z',
      });
      await h1.libraryRepo.createIntake(intake1);

      h1.db.onBeforeTransactionRead = async (colName, docId) => {
        if (
          colName === FirestoreLibraryRepository.INTAKE_COLLECTION &&
          docId === intake1.id
        ) {
          await h1.libraryRepo.updateIntake({
            ...intake1,
            title: 'عنوان معدل بشكل متزامن قبل القراءة داخل المعاملة',
            updatedAt: '2026-06-15T10:05:00.000Z',
          });
        }
      };

      await assertRejectsWithHttpsError(
        () =>
          h1.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: intake1.id,
              expectedUpdatedAt: '2026-06-15T10:00:00.000Z',
            }
          ),
        'failed-precondition',
        'STALE_SOURCE_VERSION',
        'Concurrent intake update before transaction.get'
      );
      assert(
        h1.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Zero tasks created when intake changes before transaction.get'
      );

      // 12b: Concurrent update to library_intake/{id} after transaction.get but before commit (OCC retry)
      const h2 = createHarness();
      await h2.libraryRepo.createOrganization(createSampleOrganization());
      await h2.libraryRepo.createSource(createSampleSource());
      const intake2 = createSampleIntakeRecord({
        id: 'intake-race-12b',
        updatedAt: '2026-06-15T10:00:00.000Z',
      });
      await h2.libraryRepo.createIntake(intake2);

      h2.db.onBeforeTransactionCommit = async (attempt) => {
        if (attempt === 1) {
          await h2.libraryRepo.updateIntake({
            ...intake2,
            updatedAt: '2026-06-15T10:09:00.000Z',
          });
        }
      };

      await assertRejectsWithHttpsError(
        () =>
          h2.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: intake2.id,
              expectedUpdatedAt: '2026-06-15T10:00:00.000Z',
            }
          ),
        'failed-precondition',
        'STALE_SOURCE_VERSION',
        'Concurrent intake update before transaction commit (OCC retry)'
      );
      assert(
        h2.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Zero tasks created when intake changes before commit'
      );
    }
  );

  // 13. Concurrent metadata update is safely handled.
  await runTest(
    '13. Concurrent organization or source metadata update in transaction read set fails closed without creating a stale task',
    async () => {
      // 13a: Organization modified after transaction.get(orgDocRef) but before commit (OCC retry)
      const hOrg = createHarness();
      const org = createSampleOrganization({ id: 'org-race-13a' });
      const src = createSampleSource({
        id: 'src-race-13a',
        organizationId: org.id,
      });
      await hOrg.libraryRepo.createOrganization(org);
      await hOrg.libraryRepo.createSource(src);
      const intake = createSampleIntakeRecord({
        id: 'intake-race-13a',
        organizationId: org.id,
        sourceId: src.id,
      });
      await hOrg.libraryRepo.createIntake(intake);

      hOrg.db.onBeforeTransactionCommit = async (attempt) => {
        if (attempt === 1) {
          await hOrg.libraryRepo.updateOrganization({
            ...org,
            nameAr: 'اسم منظمة معدل بشكل متزامن أثناء المعاملة',
            updatedAt: '2026-06-15T11:20:00.000Z',
          });
        }
      };

      await assertRejectsWithHttpsError(
        () =>
          hOrg.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: intake.id,
              expectedUpdatedAt: intake.updatedAt,
            }
          ),
        'failed-precondition',
        'STALE_METADATA_VERSION',
        'Concurrent organization update during transaction commit'
      );
      assert(
        hOrg.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Zero tasks created on concurrent organization update'
      );

      // 13b: Source verificationStatus modified after transaction.get(sourceDocRef) but before commit (OCC retry)
      const hSrc = createHarness();
      const orgB = createSampleOrganization({ id: 'org-race-13b' });
      const srcB = createSampleSource({
        id: 'src-race-13b',
        organizationId: orgB.id,
        verificationStatus: 'PendingVerification',
      });
      await hSrc.libraryRepo.createOrganization(orgB);
      await hSrc.libraryRepo.createSource(srcB);
      const intakeB = createSampleIntakeRecord({
        id: 'intake-race-13b',
        organizationId: orgB.id,
        sourceId: srcB.id,
      });
      await hSrc.libraryRepo.createIntake(intakeB);

      hSrc.db.onBeforeTransactionCommit = async (attempt) => {
        if (attempt === 1) {
          await hSrc.libraryRepo.updateSource({
            ...srcB,
            verificationStatus: 'Verified',
            updatedAt: '2026-06-15T11:25:00.000Z',
          });
        }
      };

      await assertRejectsWithHttpsError(
        () =>
          hSrc.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: intakeB.id,
              expectedUpdatedAt: intakeB.updatedAt,
            }
          ),
        'failed-precondition',
        'STALE_METADATA_VERSION',
        'Concurrent source update during transaction commit'
      );
      assert(
        hSrc.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 0,
        'Zero tasks created on concurrent source update'
      );

      // 13c: Verify read-set contains library_intake, library_organizations, library_sources strictly before write
      const hOk = createHarness();
      await hOk.libraryRepo.createOrganization(org);
      await hOk.libraryRepo.createSource(src);
      await hOk.libraryRepo.createIntake(intake);

      const okRes = await hOk.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );
      const enqueueTx = hOk.db.transactionHistory[0];
      assert(
        enqueueTx.readsBeforeWrite === true,
        'All transaction reads must occur before writes'
      );
      assert(
        enqueueTx.docRefsRead[0] === `library_intake/${intake.id}`,
        `Expected first read to be library_intake/${intake.id}`
      );
      assert(
        enqueueTx.docRefsRead[1] === `library_organizations/${org.id}`,
        `Expected second read to be library_organizations/${org.id}`
      );
      assert(
        enqueueTx.docRefsRead[2] === `library_sources/${src.id}`,
        `Expected third read to be library_sources/${src.id}`
      );
      assert(
        enqueueTx.docRefsWritten.includes(
          `${PEIA_PENDING_TASK_COLLECTION}/${derivePeiaTaskDocumentId(okRes.taskId)}`
        ),
        'Expected transactional write to peiaReviewTasks'
      );
    }
  );

  // 14. Repeated identical request is idempotent.
  await runTest(
    '14. Repeated identical request for the same intake version is idempotent (ALREADY_EXISTS) and preserves createdAt',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({ id: 'intake-idempotent-14' });
      await h.libraryRepo.createIntake(intake);

      h.setClock('2026-06-15T12:00:00.000Z');
      const first = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );
      assert(first.disposition === 'CREATED', 'Expected CREATED on first call');

      h.setClock('2026-06-15T12:10:00.000Z');
      const second = await h.invoke(
        { uid: 'owner-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );
      assert(
        second.disposition === 'ALREADY_EXISTS',
        'Expected ALREADY_EXISTS on second call'
      );
      assert(second.taskId === first.taskId, 'Expected identical taskId');
      assert(
        second.documentId === first.documentId,
        'Expected identical documentId'
      );
      assert(
        second.task.createdAt === '2026-06-15T12:00:00.000Z',
        'Expected original createdAt preserved'
      );
      assert(
        h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 1,
        'Expected exactly 1 task document in peiaReviewTasks'
      );
    }
  );

  // 15. Different snapshot for same source version fails closed.
  await runTest(
    '15. Different snapshot under the same intake sourceUpdatedAt fails closed with already-exists (TASK_PAYLOAD_CONFLICT)',
    async () => {
      const h = createHarness();
      const org = createSampleOrganization({ id: 'org-conflict-15' });
      const src = createSampleSource({
        id: 'src-conflict-15',
        organizationId: org.id,
      });
      await h.libraryRepo.createOrganization(org);
      await h.libraryRepo.createSource(src);
      const intake = createSampleIntakeRecord({
        id: 'intake-conflict-15',
        organizationId: org.id,
        sourceId: src.id,
      });
      await h.libraryRepo.createIntake(intake);

      await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );

      // Update organization name while keeping intake.updatedAt unchanged
      await h.libraryRepo.updateOrganization({
        ...org,
        nameEn: 'UNEP Modified Name Without Advancing Intake Timestamp',
        updatedAt: '2026-06-15T12:30:00.000Z',
      });

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId: intake.id,
              expectedUpdatedAt: intake.updatedAt,
            }
          ),
        'already-exists',
        'TASK_PAYLOAD_CONFLICT',
        'Different snapshot under same sourceUpdatedAt'
      );

      assert(
        h.db.countDocuments(PEIA_PENDING_TASK_COLLECTION) === 1,
        'Must never create a second task for the same source version'
      );
    }
  );

  // 16. No modification of library_intake.
  await runTest(
    '16. Neither requestIntakePeiaPreparation nor getIntakePeiaPreparationStatus mutates library_intake',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({ id: 'intake-unmutated-16' });
      await h.libraryRepo.createIntake(intake);

      const beforeJson = JSON.stringify(
        await h.libraryRepo.getIntakeById(intake.id)
      );

      await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );
      await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );

      const afterJson = JSON.stringify(
        await h.libraryRepo.getIntakeById(intake.id)
      );
      assert(
        beforeJson === afterJson,
        'library_intake record must remain byte-for-byte unmutated'
      );
    }
  );

  // 17. No invocation of Gemini.
  await runTest(
    '17. PEIA preparation actions never invoke Gemini or global fetch',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({ id: 'intake-no-gemini-17' });
      await h.libraryRepo.createIntake(intake);

      let fetchCalled = false;
      const forbiddenFetch = (async () => {
        fetchCalled = true;
        throw new Error('Gemini / fetch must never be called by PEIA actions');
      }) as unknown as typeof fetch;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = forbiddenFetch;
      try {
        const res = await h.invoke(
          { uid: 'curator-1' },
          {
            action: 'requestIntakePeiaPreparation',
            intakeId: intake.id,
            expectedUpdatedAt: intake.updatedAt,
          },
          { apiKey: '', fetchImpl: forbiddenFetch }
        );
        assert(res.disposition === 'CREATED', 'Expected CREATED without Gemini');

        const statusRes = await h.invoke(
          { uid: 'curator-1' },
          {
            action: 'getIntakePeiaPreparationStatus',
            intakeId: intake.id,
          },
          { apiKey: '', fetchImpl: forbiddenFetch }
        );
        assert(
          statusRes.status === AITaskStatus.Pending,
          'Expected Pending status without Gemini'
        );
        assert(fetchCalled === false, 'fetch must not be called by PEIA');
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );

  // 18. Valid result readback.
  await runTest(
    '18. getIntakePeiaPreparationStatus returns NotRequested, Pending, Completed (with canonical libraryPreparation), and Failed accurately',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({ id: 'intake-status-18' });
      await h.libraryRepo.createIntake(intake);

      // (a) NotRequested
      const notRequested = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );
      assert(
        notRequested.status === 'NotRequested',
        'Expected NotRequested before enqueue'
      );
      assert(notRequested.isStale === false, 'Expected isStale === false');
      assert(
        notRequested.libraryPreparation === null,
        'Expected libraryPreparation === null'
      );

      // (b) Pending
      const enqueued = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );
      const pending = await h.invoke(
        { uid: 'rights-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );
      assert(
        pending.status === AITaskStatus.Pending,
        'Expected Pending status'
      );
      assert(
        pending.inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly,
        'Expected MetadataOnly inputBasis'
      );
      assert(
        pending.libraryPreparation === null,
        'Expected libraryPreparation === null while Pending'
      );

      // (c) Completed with canonical libraryPreparation
      const advisoryRepo = new FirestoreAdvisoryResultRepository(h.db as any);
      const canonicalPrep = {
        inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
        suggestedTitleAr:
          'تقرير تقييم التنوع الحيوي البحري في البحر الأحمر وخليج عدن 2026',
        suggestedTitleEn:
          'Red Sea and Gulf of Aden Marine Biodiversity Assessment Report 2026',
        suggestedIssuingOrganization:
          'برنامج الأمم المتحدة للبيئة (United Nations Environment Programme)',
        suggestedDocumentType:
          PEIALibrarySuggestedDocumentType.InstitutionalReport,
        suggestedEnvironmentalDomains: ['Biodiversity', 'MarineEnvironment'],
        suggestedTopicsAr: ['التنوع الحيوي البحري', 'البحر الأحمر'],
        suggestedTopicsEn: ['Marine Biodiversity', 'Red Sea'],
        suggestedSummaryAr: null,
        suggestedSummaryEn: null,
        provenanceObservationsAr: [
          'مرتكز على البيانات الوصفية المرفقة لسجل الاستقبال فقط.',
        ],
        provenanceObservationsEn: [
          'Grounded strictly in supplied intake metadata snapshot.',
        ],
        uncertaintyNoticesAr: [
          'لم يتم جلب أو فحص ملف PDF الكامل من الرابط الخارجي.',
        ],
        uncertaintyNoticesEn: [
          'Full remote PDF document was not fetched or inspected.',
        ],
      };

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
            summary:
              'تم إعداد مقترحات الفهرسة الأولية استناداً إلى البيانات الوصفية فقط.',
            findings: [
              {
                code: 'METADATA_GROUNDED_PREPARATION',
                severity: AIReviewSeverity.Info,
                message: 'المقترحات مستندة إلى لقطة البيانات الوصفية المعتمدة.',
                evidenceIds: [`TASK_CONTENT_SNAPSHOT::intake-${intake.id}`],
              },
            ],
          },
          recommendations: ['التحقق البشري من النص الكامل للوثيقة قبل النشر.'],
          uncertainties: ['لم تتم قراءة الملف الخارجي الكامل.'],
          limitations: ['تحليل مقتصر على البيانات الوصفية فقط.'],
          libraryPreparation: canonicalPrep,
        },
      });

      const completed = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );
      assert(
        completed.status === AITaskStatus.Completed,
        'Expected Completed status'
      );
      assert(completed.isStale === false, 'Expected isStale === false');
      assert(
        completed.libraryPreparation?.suggestedDocumentType ===
          PEIALibrarySuggestedDocumentType.InstitutionalReport,
        'Expected canonical libraryPreparation.suggestedDocumentType'
      );
      assert(
        completed.libraryPreparation?.suggestedSummaryAr === null &&
          completed.libraryPreparation?.suggestedSummaryEn === null,
        'Expected null summaries for MetadataOnly libraryPreparation'
      );
      assert(
        !('verificationWarningAr' in (completed.libraryPreparation as object)),
        'Must return canonical PEIALibraryPreparationAdvisoryPayload, not a fabricated LibraryIntakeAISuggestion'
      );

      // (d) Failed with nonAdvisoryOutcome
      const failedIntake = createSampleIntakeRecord({
        id: 'intake-status-18-failed',
        normalizedUrl: 'https://wedocs.unep.org/failed-18.pdf',
      });
      await h.libraryRepo.createIntake(failedIntake);
      const enqueuedFailed = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: failedIntake.id,
          expectedUpdatedAt: failedIntake.updatedAt,
        }
      );

      const nonAdvisoryRepo = new FirestoreNonAdvisoryOutcomeRepository(
        h.db as any
      );
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
          createdAt: '2026-06-15T12:20:00.000Z',
          detail: 'Local model inference timed out.',
        },
        convergedStatus: AITaskStatus.Failed,
        convergedAt: '2026-06-15T12:20:01.000Z',
      });

      const failedStatus = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: failedIntake.id,
        }
      );
      assert(
        failedStatus.status === AITaskStatus.Failed,
        'Expected Failed status'
      );
      assert(
        failedStatus.nonAdvisoryOutcome?.reason === 'TIMEOUT',
        'Expected TIMEOUT reason'
      );
      assert(
        failedStatus.libraryPreparation === null,
        'Expected libraryPreparation === null on Failed'
      );
    }
  );

  // 19. Cross-intake and cross-domain task rejection.
  await runTest(
    '19. Cross-intake LibraryIntake taskId, cross-domain News taskId, and unpersisted foreign taskId are rejected',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());

      const intakeA = createSampleIntakeRecord({
        id: 'intake-iso-A',
        normalizedUrl: 'https://wedocs.unep.org/iso-a.pdf',
      });
      const intakeB = createSampleIntakeRecord({
        id: 'intake-iso-B',
        normalizedUrl: 'https://wedocs.unep.org/iso-b.pdf',
      });
      await h.libraryRepo.createIntake(intakeA);
      await h.libraryRepo.createIntake(intakeB);

      const enqueuedB = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intakeB.id,
          expectedUpdatedAt: intakeB.updatedAt,
        }
      );

      // Enqueue a News task in the shared queue
      const queueService = new FirestorePeiaTaskQueueService(h.db, {
        clock: () => FIXED_CLOCK_ISO,
      });
      const newsEnqueue = await queueService.enqueueNewsTask({
        targetId: 'news-article-77',
        sourceUpdatedAt: '2026-06-15T10:30:00.000Z',
        title: 'خبر علمي حول الطاقة المتجددة',
        body: 'تفاصيل الخبر العلمي حول مشروعات الطاقة الشمسية.',
      });

      // Cross-intake persisted taskId rejected
      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'getIntakePeiaPreparationStatus',
              intakeId: intakeA.id,
              taskId: enqueuedB.taskId,
            }
          ),
        'failed-precondition',
        'RECONCILIATION_INTEGRITY_ERROR',
        'Cross-intake taskId'
      );

      // Cross-domain persisted News taskId rejected
      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'getIntakePeiaPreparationStatus',
              intakeId: intakeA.id,
              taskId: newsEnqueue.task.taskId,
            }
          ),
        'failed-precondition',
        'RECONCILIATION_INTEGRITY_ERROR',
        'Cross-domain News taskId'
      );

      // Unpersisted foreign taskId rejected
      const unpersistedForeignTaskId = derivePeiaTaskId({
        targetType: AIReviewTargetType.News,
        targetId: 'news-unpersisted-88',
        sourceUpdatedAt: '2026-06-15T10:30:00.000Z',
      });
      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'getIntakePeiaPreparationStatus',
              intakeId: intakeA.id,
              taskId: unpersistedForeignTaskId,
            }
          ),
        'failed-precondition',
        'CROSS_ITEM_OR_UNKNOWN_TASK_ID',
        'Unpersisted foreign taskId'
      );
    }
  );

  // 20. Historical result marked stale after source update (including Gemini or status update).
  await runTest(
    '20. Historical PEIA preparation task/result is marked stale after intake updatedAt advances',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({
        id: 'intake-stale-20',
        updatedAt: '2026-06-15T10:00:00.000Z',
      });
      await h.libraryRepo.createIntake(intake);

      const enqueuedV1 = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );

      // Advance intake version via existing updateIntakeStatus action
      const updatedRes = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'updateIntakeStatus',
          intakeId: intake.id,
          status: LibraryIntakeStatus.InPreparation,
          reviewNotes: 'بدء إعداد بطاقة الوثيقة.',
        }
      );
      const v2UpdatedAt = updatedRes.intakeRecord.updatedAt;
      assert(
        v2UpdatedAt !== intake.updatedAt,
        'Expected updateIntakeStatus to advance updatedAt'
      );

      // Querying explicit v1 taskId reports isStale === true
      const staleV1 = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
          taskId: enqueuedV1.taskId,
        }
      );
      assert(staleV1.isStale === true, 'Expected historical v1 task to be stale');
      assert(
        staleV1.taskSourceUpdatedAt === '2026-06-15T10:00:00.000Z',
        'Expected taskSourceUpdatedAt to match v1'
      );
      assert(
        staleV1.currentSourceUpdatedAt === v2UpdatedAt,
        'Expected currentSourceUpdatedAt to match v2'
      );

      // Querying without taskId resolves v2 deterministic taskId -> NotRequested
      const currentV2 = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );
      assert(
        currentV2.status === 'NotRequested',
        'Expected NotRequested for unrequested v2'
      );
      assert(currentV2.isStale === false, 'Expected isStale === false for NotRequested v2');
    }
  );

  // 21. Completed PEIA result remains advisory-only.
  await runTest(
    '21. Completed PEIA result remains strictly advisory-only and never writes to library_intake.aiSuggestion or library_documents',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());
      const intake = createSampleIntakeRecord({ id: 'intake-advisory-only-21' });
      await h.libraryRepo.createIntake(intake);

      const enqueued = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );

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
            summary: 'مخرجات استرشادية فقط.',
            findings: [
              {
                code: 'ADVISORY_CHECK',
                severity: AIReviewSeverity.Info,
                message: 'فحص استرشادي.',
                evidenceIds: [`TASK_CONTENT_SNAPSHOT::intake-${intake.id}`],
              },
            ],
          },
          recommendations: ['مراجعة بشرية مطلوبة.'],
          uncertainties: ['لم يفحص الملف الكامل.'],
          limitations: ['استرشادي فقط.'],
          libraryPreparation: {
            inputBasis: PEIALibraryPreparationInputBasis.MetadataOnly,
            suggestedTitleAr: 'عنوان مقترح استرشادي',
            suggestedTitleEn: 'Advisory Suggested Title',
            suggestedIssuingOrganization: 'UNEP',
            suggestedDocumentType:
              PEIALibrarySuggestedDocumentType.InstitutionalReport,
            suggestedEnvironmentalDomains: ['Biodiversity'],
            suggestedTopicsAr: ['تنوع حيوي'],
            suggestedTopicsEn: ['Biodiversity'],
            suggestedSummaryAr: null,
            suggestedSummaryEn: null,
            provenanceObservationsAr: ['ملاحظة مصدر.'],
            provenanceObservationsEn: ['Provenance note.'],
            uncertaintyNoticesAr: ['تنبيه عدم يقين.'],
            uncertaintyNoticesEn: ['Uncertainty notice.'],
          },
        },
      });

      const status = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );
      assert(
        status.status === AITaskStatus.Completed,
        'Expected Completed status'
      );

      const storedIntake = await h.libraryRepo.getIntakeById(intake.id);
      assert(
        storedIntake?.aiSuggestion === undefined,
        'PEIA advice must NEVER be persisted into library_intake.aiSuggestion automatically'
      );
      assert(
        storedIntake?.status === LibraryIntakeStatus.PendingReview,
        'Intake status must remain unchanged'
      );
      assert(
        storedIntake?.updatedAt === intake.updatedAt,
        'Intake updatedAt must remain unchanged'
      );
      assert(
        h.db.countDocuments(FirestoreLibraryRepository.COLLECTION) === 0,
        'Zero canonical library_documents may be created by PEIA preparation'
      );
    }
  );

  // 22. Existing Library actions and Gemini flow remain unchanged.
  await runTest(
    '22. Existing manageLibraryDocuments actions (organizations, sources, intake, Gemini generateIntakeAISuggestions, documents, workflow, rights) remain unchanged',
    async () => {
      const h = createHarness();

      // Register organization & source
      const orgRes = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'registerOrganization',
          input: {
            id: 'org-22',
            nameAr: 'وزارة البيئة والمياه',
            nameEn: 'Ministry of Environment and Water',
            type: 'Ministry',
            countryRegionAr: 'السودان',
            countryRegionEn: 'Sudan',
            websiteUrl: 'https://env.gov.sd',
          },
        }
      );
      assert(orgRes.organization.id === 'org-22', 'Expected org-22 created');

      const srcRes = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'registerSource',
          input: {
            id: 'src-22',
            organizationId: 'org-22',
            sourceNameAr: 'الجريدة الرسمية',
            sourceNameEn: 'Official Gazette',
            sourceType: 'OfficialGazette',
            sourceUrl: 'https://gazette.gov.sd',
          },
        }
      );
      assert(
        srcRes.source.verificationStatus === 'PendingVerification',
        'Expected PendingVerification initially'
      );

      const verifiedSrcRes = await h.invoke(
        { uid: 'rights-1' },
        {
          action: 'verifySource',
          sourceId: 'src-22',
          status: 'Verified',
        }
      );
      assert(
        verifiedSrcRes.source.verificationStatus === 'Verified',
        'Expected Verified status after verifySource'
      );

      // Submit intake
      const submitRes = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'submitIntake',
          input: {
            url: 'https://gazette.gov.sd/laws/water-2026.pdf',
            title: 'قانون حماية المياه الجوفية لسنة 2026',
            organizationId: 'org-22',
            sourceId: 'src-22',
            language: 'ar',
            notes: 'قانون رسمي منشور في الجريدة الرسمية.',
          },
        }
      );
      const intakeId = submitRes.intakeRecord.id;
      const initialUpdatedAt = submitRes.intakeRecord.updatedAt;

      // Existing Gemini flow (generateIntakeAISuggestions) with mocked fetch
      const mockGeminiFetch = (async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        suggestedTitleAr: 'قانون حماية المياه الجوفية لسنة 2026',
                        suggestedTitleEn: 'Groundwater Protection Law of 2026',
                        suggestedIssuingOrganization: 'وزارة البيئة والمياه',
                        suggestedDocumentType: 'Law',
                        suggestedEnvironmentalDomains: ['Water'],
                        suggestedTopicsAr: ['المياه الجوفية'],
                        suggestedTopicsEn: ['Groundwater'],
                        suggestedSummaryAr:
                          'ينظم القانون حماية الأحواض الجوفية وترشيد الاستخراج.',
                        suggestedSummaryEn:
                          'The law regulates groundwater basin protection and extraction.',
                        provenanceObservationsAr: ['صادر في الجريدة الرسمية.'],
                        provenanceObservationsEn: ['Published in the Official Gazette.'],
                        uncertaintyNoticesAr: ['مبني على المقتطف النصي المرفق.'],
                        uncertaintyNoticesEn: ['Based on supplied excerpt.'],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
      })) as unknown as typeof fetch;

      const geminiRes = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'generateIntakeAISuggestions',
          intakeId,
          suppliedExcerpt:
            'المادة (1): يسمى هذا القانون قانون حماية المياه الجوفية لسنة 2026.',
        },
        { apiKey: 'test-gemini-key', fetchImpl: mockGeminiFetch }
      );
      assert(
        geminiRes.intakeRecord.aiSuggestion?.isAdvisoryOnly === true,
        'Expected Gemini aiSuggestion saved on intake record'
      );
      assert(
        geminiRes.intakeRecord.suppliedExcerpt ===
          'المادة (1): يسمى هذا القانون قانون حماية المياه الجوفية لسنة 2026.',
        'Expected Gemini flow to persist suppliedExcerpt'
      );

      // Verify PEIA enqueue guard treats Gemini's updatedAt advancement as a source-version change
      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'requestIntakePeiaPreparation',
              intakeId,
              expectedUpdatedAt: initialUpdatedAt,
            }
          ),
        'failed-precondition',
        'STALE_SOURCE_VERSION',
        'Pre-Gemini expectedUpdatedAt rejected after Gemini updated intake'
      );

      // Requesting PEIA preparation with the post-Gemini updatedAt succeeds and uses the persisted excerpt
      const peiaAfterGemini = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId,
          expectedUpdatedAt: geminiRes.intakeRecord.updatedAt,
        }
      );
      assert(
        peiaAfterGemini.disposition === 'CREATED',
        'Expected CREATED with post-Gemini updatedAt'
      );
      assert(
        peiaAfterGemini.inputBasis ===
          PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata,
        'Expected SuppliedExcerptAndMetadata from persisted excerpt'
      );

      // Existing canonical LibraryDocument creation, rights, and workflow actions
      const createdDoc = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'create',
          input: {
            id: 'doc-water-2026',
            titleAr: 'قانون حماية المياه الجوفية لسنة 2026',
            titleEn: 'Groundwater Protection Law of 2026',
            documentType: LibraryDocumentType.Law,
            organizationId: 'org-22',
            sourceId: 'src-22',
            geographyAr: 'السودان',
            geographyEn: 'Sudan',
            publicationDate: '2026-06-01',
            language: 'ar',
            summaryAr: 'ملخص القانون.',
            summaryEn: 'Law summary.',
            topicsAr: ['مياه'],
            topicsEn: ['Water'],
            environmentalDomains: ['Water'],
            legalStatusDescriptionAr: 'ساري',
            legalStatusDescriptionEn: 'Active',
            rightsStatus: LibraryRightsStatus.Unknown,
          },
        }
      );
      assert(
        createdDoc.document.workflowState === WorkflowState.Draft,
        'Expected created document in Draft state'
      );

      const rightsDoc = await h.invoke(
        { uid: 'rights-1' },
        {
          action: 'updateRights',
          id: 'doc-water-2026',
          rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
          notesAr: 'متاح للعامة',
          notesEn: 'Openly available',
        }
      );
      assert(
        rightsDoc.document.rightsStatus ===
          LibraryRightsStatus.OpenPubliclyAvailable,
        'Expected OpenPubliclyAvailable rights status'
      );
    }
  );

  // 23. Completed + ABSTAINED Library intake PEIA preparation status reconciliation and idempotent replay.
  await runTest(
    '23. Completed + ABSTAINED Library intake PEIA preparation returns structured DTO with advisoryResult === null, libraryPreparation === null, and valid nonAdvisoryOutcome without throwing failed-precondition',
    async () => {
      const h = createHarness();
      await h.libraryRepo.createOrganization(createSampleOrganization());
      await h.libraryRepo.createSource(createSampleSource());

      const intake = createSampleIntakeRecord({
        id: 'intake-abstained-23',
        updatedAt: '2026-06-15T15:00:00.000Z',
      });
      await h.libraryRepo.createIntake(intake);

      const enqueued = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
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
          createdAt: '2026-06-15T15:05:00.000Z',
          detail: 'Local model output failed schema validation; abstaining safely.',
        },
        convergedStatus: AITaskStatus.Completed,
        convergedAt: '2026-06-15T15:05:02.000Z',
      });

      const status = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'getIntakePeiaPreparationStatus',
          intakeId: intake.id,
        }
      );
      assert(
        status.status === AITaskStatus.Completed,
        'Expected Completed status for ABSTAINED LibraryIntake task'
      );
      assert(status.isStale === false, 'Expected isStale === false');
      assert(
        status.inputBasis === PEIALibraryPreparationInputBasis.MetadataOnly,
        'Expected MetadataOnly inputBasis'
      );
      assert(status.advisoryResult === null, 'Expected advisoryResult === null on ABSTAINED');
      assert(
        status.libraryPreparation === null,
        'Expected libraryPreparation === null on ABSTAINED'
      );
      assert(
        status.nonAdvisoryOutcome?.kind === 'ABSTAINED',
        'Expected nonAdvisoryOutcome.kind === ABSTAINED'
      );
      assert(
        status.nonAdvisoryOutcome?.reason === 'INVALID_MODEL_OUTPUT',
        'Expected nonAdvisoryOutcome.reason === INVALID_MODEL_OUTPUT'
      );

      // Idempotent requestIntakePeiaPreparation replay on Completed + ABSTAINED returns ALREADY_EXISTS with structured DTO
      const replay = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: intake.id,
          expectedUpdatedAt: intake.updatedAt,
        }
      );
      assert(
        replay.disposition === 'ALREADY_EXISTS',
        'Expected ALREADY_EXISTS disposition on replay'
      );
      assert(
        replay.status === AITaskStatus.Completed,
        'Expected Completed status on replay'
      );
      assert(replay.advisoryResult === null, 'Expected advisoryResult === null on replay');
      assert(
        replay.libraryPreparation === null,
        'Expected libraryPreparation === null on replay'
      );
      assert(
        replay.nonAdvisoryOutcome?.kind === 'ABSTAINED',
        'Expected nonAdvisoryOutcome.kind === ABSTAINED on replay'
      );

      // Invalid Completed + MODEL_FAILURE on LibraryIntake fails closed with failed-precondition (RECONCILIATION_INTEGRITY_ERROR)
      const invalidIntake = createSampleIntakeRecord({
        id: 'intake-invalid-completed-23b',
        url: 'https://wedocs.unep.org/bitstream/handle/20.500.11822/red-sea-invalid-23b.pdf',
        normalizedUrl: 'https://wedocs.unep.org/bitstream/handle/20.500.11822/red-sea-invalid-23b.pdf',
        updatedAt: '2026-06-15T15:10:00.000Z',
      });
      await h.libraryRepo.createIntake(invalidIntake);

      const enqueuedInvalid = await h.invoke(
        { uid: 'curator-1' },
        {
          action: 'requestIntakePeiaPreparation',
          intakeId: invalidIntake.id,
          expectedUpdatedAt: invalidIntake.updatedAt,
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
            reason: 'NON_ZERO_EXIT',
            modelAttempts: 2,
            exitCode: 1,
            createdAt: '2026-06-15T15:12:00.000Z',
          },
          convergedStatus: AITaskStatus.Failed,
          convergedAt: '2026-06-15T15:12:01.000Z',
        }
      );

      await assertRejectsWithHttpsError(
        () =>
          h.invoke(
            { uid: 'curator-1' },
            {
              action: 'getIntakePeiaPreparationStatus',
              intakeId: invalidIntake.id,
            }
          ),
        'failed-precondition',
        'RECONCILIATION_INTEGRITY_ERROR',
        'Completed LibraryIntake task with MODEL_FAILURE artifact'
      );
    }
  );

  const failed = results.filter((r) => !r.passed);
  for (const r of results) {
    if (r.passed) {
      console.log(`PASS [${r.id}] ${r.name}`);
    } else {
      console.error(`FAIL [${r.id}] ${r.name}: ${r.message}`);
    }
  }
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed.`
  );

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
