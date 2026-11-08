import Module, { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import type { AdminRepository } from '../functions/src/admin/adminRepository';
import { AdminRole, type AdminUser } from '../functions/src/types/admin';
import {
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
  type LibraryQuarantinePersistedReceiptEnvelope,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  LibraryQuarantineReceiptState,
  type LibraryQuarantineInternalReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT,
  LIBRARY_QUARANTINE_RECEIPT_CREATED_AT_ORDER_FIELD,
  LIBRARY_QUARANTINE_RECEIPT_ORDER_DIRECTION,
  listLatestSanitizedLibraryQuarantineReceipts,
  type LibraryQuarantineAdminReadFirestoreDatabase,
  type LibraryQuarantineAdminReadQueryDocumentSnapshot,
} from '../functions/src/library/libraryQuarantineAdminReadService';
import type { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';

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
            'Live getFirestore() must not be invoked in headless quarantine read tests.'
          );
        },
      };
    }
    throw err;
  }
};

const require = createRequire(import.meta.url);
const { executeManageLibraryDocumentsRequest } = require(
  '../functions/src/library/libraryAdminHandlers'
) as typeof import('../functions/src/library/libraryAdminHandlers');

function buildHexReceiptId(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function buildHexSha256(index: number): string {
  return index.toString(16).padStart(64, 'a');
}

function buildInternalReceipt(
  index: number,
  overrides: Partial<LibraryQuarantineInternalReceipt> = {}
): LibraryQuarantineInternalReceipt {
  const receiptId = overrides.receiptId ?? buildHexReceiptId(index);
  const format = overrides.format ?? 'PDF';
  const ext = format === 'PDF' ? 'pdf' : 'docx';
  const mime =
    format === 'PDF'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const inspectionStatus =
    format === 'PDF'
      ? 'PDF_REQUIRES_ISOLATED_PARSER'
      : 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION';
  const minuteStr = String(index % 60).padStart(2, '0');
  const defaultCreatedAt = `2026-11-08T10:${minuteStr}:00.000Z`;

  const state = overrides.state ?? LibraryQuarantineReceiptState.Quarantined;
  const generation =
    overrides.generation !== undefined
      ? overrides.generation
      : state === LibraryQuarantineReceiptState.Quarantined
        ? `gen-${index}-998877`
        : null;
  const reconciliationReason =
    overrides.reconciliationReason !== undefined
      ? overrides.reconciliationReason
      : state === LibraryQuarantineReceiptState.NeedsReconciliation
        ? 'GCS conditional write outcome was ambiguous during finalize.'
        : null;
  const rejectionReasonCode =
    overrides.rejectionReasonCode !== undefined
      ? overrides.rejectionReasonCode
      : state === LibraryQuarantineReceiptState.Rejected
        ? 'PDF_ACTIVE_CONTENT_DETECTED'
        : null;

  return Object.freeze({
    receiptId,
    uploaderUid: 'admin-curator',
    originalFilename: `environmental-report-${index}.${ext}`,
    sanitizedFilename: `environmental-report-${index}.${ext}`,
    format,
    canonicalExtension: ext,
    canonicalMimeType: mime,
    byteSize: 4096 + index,
    sha256: buildHexSha256(index),
    deepInspectionStatus: inspectionStatus,
    storagePath: `library/quarantine/${receiptId}/source.${ext}`,
    state,
    generation,
    reconciliationReason,
    rejectionReasonCode,
    createdAt: defaultCreatedAt,
    updatedAt: defaultCreatedAt,
    isSanitized: false as const,
    isVerifiedSafe: false as const,
    isRightsApproved: false as const,
    isPublished: false as const,
    isReadyForPeia: false as const,
    ...overrides,
  });
}

function buildPersistedEnvelope(
  index: number,
  revision = 3,
  receiptOverrides: Partial<LibraryQuarantineInternalReceipt> = {}
): LibraryQuarantinePersistedReceiptEnvelope {
  const receipt = buildInternalReceipt(index, receiptOverrides);
  return Object.freeze({
    schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
    revision,
    state: receipt.state,
    receipt,
  });
}

class InMemoryReadOnlyQuarantineFirestore
  implements LibraryQuarantineAdminReadFirestoreDatabase
{
  private readonly docsById = new Map<string, unknown>();
  public readonly collectionCalls: string[] = [];
  public readonly orderByCalls: Array<{
    fieldPath: string;
    directionStr?: 'asc' | 'desc';
  }> = [];
  public readonly limitCalls: number[] = [];
  public getCalls = 0;
  public unboundedCollectionGetCalls = 0;
  public writeAttemptCount = 0;
  public forceDocsResultOverride:
    | readonly LibraryQuarantineAdminReadQueryDocumentSnapshot[]
    | null = null;

  public seedDocument(docId: string, data: unknown): void {
    this.docsById.set(docId, data);
  }

  public collection(collectionPath: string) {
    this.collectionCalls.push(collectionPath);
    const self = this;

    return {
      get(): Promise<never> {
        self.unboundedCollectionGetCalls += 1;
        return Promise.reject(
          new Error('Unbounded collection.get() is strictly forbidden.')
        );
      },
      doc(): never {
        self.writeAttemptCount += 1;
        throw new Error('Point doc() mutation access is not used by list read.');
      },
      add(): never {
        self.writeAttemptCount += 1;
        throw new Error('Firestore add() is strictly forbidden.');
      },
      orderBy(fieldPath: string, directionStr?: 'asc' | 'desc') {
        self.orderByCalls.push({ fieldPath, directionStr });
        return {
          limit(limitCount: number) {
            self.limitCalls.push(limitCount);
            return {
              async get() {
                self.getCalls += 1;
                if (self.forceDocsResultOverride !== null) {
                  return { docs: self.forceDocsResultOverride };
                }

                const entries = Array.from(self.docsById.entries()).map(
                  ([id, raw]) => ({
                    id,
                    raw,
                  })
                );

                entries.sort((a, b) => {
                  const aCreated =
                    (
                      a.raw as {
                        receipt?: { createdAt?: string };
                      }
                    )?.receipt?.createdAt ?? '';
                  const bCreated =
                    (
                      b.raw as {
                        receipt?: { createdAt?: string };
                      }
                    )?.receipt?.createdAt ?? '';
                  return directionStr === 'desc'
                    ? bCreated.localeCompare(aCreated)
                    : aCreated.localeCompare(bCreated);
                });

                const sliced = entries.slice(0, limitCount);
                const docs: LibraryQuarantineAdminReadQueryDocumentSnapshot[] =
                  sliced.map((entry) => ({
                    id: entry.id,
                    data: () => entry.raw,
                  }));

                return { docs };
              },
            };
          },
        };
      },
    };
  }
}

function buildAdminUserMap(): Map<string, AdminUser> {
  const users: AdminUser[] = [
    {
      id: 'admin-owner',
      name: 'Platform Owner',
      email: 'owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    },
    {
      id: 'admin-curator',
      name: 'Library Curator',
      email: 'curator@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    },
    {
      id: 'admin-rights',
      name: 'Rights Reviewer',
      email: 'rights@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    },
    {
      id: 'admin-inactive-curator',
      name: 'Inactive Curator',
      email: 'inactive@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: false,
    },
    {
      id: 'admin-ai',
      name: 'AI Assistant',
      email: 'ai@promiseofplanet.org',
      role: AdminRole.AIAssistant,
      isActive: true,
    },
    {
      id: 'admin-news',
      name: 'News Editor',
      email: 'news@promiseofplanet.org',
      role: AdminRole.NewsEditor,
      isActive: true,
    },
    {
      id: 'admin-multimedia',
      name: 'Multimedia Producer',
      email: 'media@promiseofplanet.org',
      role: AdminRole.MultimediaProducer,
      isActive: true,
    },
    {
      id: 'admin-finance',
      name: 'Finance Auditor',
      email: 'finance@promiseofplanet.org',
      role: AdminRole.FinanceAuditor,
      isActive: true,
    },
    {
      id: 'admin-translation',
      name: 'Translation Editor',
      email: 'translation@promiseofplanet.org',
      role: AdminRole.TranslationEditor,
      isActive: true,
    },
  ];
  return new Map(users.map((u) => [u.id, u]));
}

function createStubAdminRepo(userMap: Map<string, AdminUser>): AdminRepository {
  return {
    async getAdminByUid(uid: string): Promise<AdminUser | null> {
      return userMap.get(uid) ?? null;
    },
    async listAdmins(): Promise<AdminUser[]> {
      return Array.from(userMap.values());
    },
  };
}

function createForbiddingLibraryService(): {
  service: LibraryApplicationService;
  getCallCount: () => number;
} {
  let calls = 0;
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        return () => {
          calls += 1;
          throw new Error(
            `Forbidden LibraryApplicationService.${String(prop)} invocation during listQuarantineReceipts.`
          );
        };
      },
    }
  ) as unknown as LibraryApplicationService;

  return {
    service: proxy,
    getCallCount: () => calls,
  };
}

async function expectHttpsErrorCode(
  fn: () => Promise<unknown>,
  expectedCode: string,
  expectedSubstring?: string
): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err: unknown) {
    caught = err;
  }
  assert.ok(caught, `Expected HttpsError(${expectedCode}) but call succeeded.`);
  const errObj = caught as { code?: string; message?: string };
  assert.equal(
    errObj.code,
    expectedCode,
    `Expected error code "${expectedCode}", got "${String(errObj.code)}" (${String(errObj.message)})`
  );
  if (expectedSubstring) {
    assert.ok(
      String(errObj.message).includes(expectedSubstring),
      `Expected error message "${String(errObj.message)}" to include "${expectedSubstring}".`
    );
  }
}

async function runAllTests(): Promise<void> {
  const userMap = buildAdminUserMap();
  const adminRepo = createStubAdminRepo(userMap);

  console.log(
    'Running LIB-FILE-INBOX-01 backend read-only quarantine receipt tests...'
  );

  // Test 1: Unauthenticated, inactive, AI, and non-Library roles are rejected
  {
    const db = new InMemoryReadOnlyQuarantineFirestore();
    const { service, getCallCount } = createForbiddingLibraryService();

    // Unauthenticated
    await expectHttpsErrorCode(
      () =>
        executeManageLibraryDocumentsRequest(
          { data: { action: 'listQuarantineReceipts' } },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          db
        ),
      'unauthenticated'
    );

    // Blank UID
    await expectHttpsErrorCode(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: '   ' },
            data: { action: 'listQuarantineReceipts' },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          db
        ),
      'unauthenticated'
    );

    // Automated / AI token claim on otherwise valid curator
    await expectHttpsErrorCode(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: {
              uid: 'admin-curator',
              token: { automated: true },
            },
            data: { action: 'listQuarantineReceipts' },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          db
        ),
      'permission-denied',
      'AI_ACTION_FORBIDDEN'
    );

    // Inactive curator, AIAssistant role, and non-Library roles
    for (const forbiddenUid of [
      'admin-inactive-curator',
      'admin-ai',
      'admin-news',
      'admin-multimedia',
      'admin-finance',
      'admin-translation',
      'unknown-uid',
    ]) {
      await expectHttpsErrorCode(
        () =>
          executeManageLibraryDocumentsRequest(
            {
              auth: { uid: forbiddenUid },
              data: { action: 'listQuarantineReceipts' },
            },
            adminRepo,
            service,
            undefined,
            undefined,
            undefined,
            db
          ),
        'permission-denied'
      );
    }

    assert.equal(db.getCalls, 0);
    assert.equal(getCallCount(), 0);
    console.log(
      'PASS 1: Unauthenticated, inactive, AI, and non-Library roles are rejected before querying Firestore.'
    );
  }

  // Test 2: Authorized human Library roles (Owner, LibraryCurator, RightsReviewer) are allowed
  {
    const db = new InMemoryReadOnlyQuarantineFirestore();
    const env1 = buildPersistedEnvelope(1, 3);
    db.seedDocument(env1.receipt.receiptId, env1);
    const { service, getCallCount } = createForbiddingLibraryService();

    for (const allowedUid of ['admin-owner', 'admin-curator', 'admin-rights']) {
      const response = await executeManageLibraryDocumentsRequest(
        {
          auth: { uid: allowedUid },
          data: { action: 'listQuarantineReceipts' },
        },
        adminRepo,
        service,
        undefined,
        undefined,
        undefined,
        db
      );
      assert.equal(response.receipts.length, 1);
      assert.equal(response.receipts[0].revision, 3);
      assert.equal(
        response.receipts[0].adminReceipt.receiptId,
        env1.receipt.receiptId
      );
    }

    assert.equal(db.getCalls, 3);
    assert.equal(getCallCount(), 0);
    console.log(
      'PASS 2: Authorized human Library roles (Owner, LibraryCurator, RightsReviewer) are allowed.'
    );
  }

  // Test 3: Unknown or extra caller payload keys are strictly rejected
  {
    const db = new InMemoryReadOnlyQuarantineFirestore();
    const { service } = createForbiddingLibraryService();

    for (const extraPayload of [
      { action: 'listQuarantineReceipts', limit: 100 },
      { action: 'listQuarantineReceipts', collection: 'library_documents' },
      { action: 'listQuarantineReceipts', receiptId: buildHexReceiptId(1) },
      { action: 'listQuarantineReceipts', includeStoragePath: true },
    ]) {
      await expectHttpsErrorCode(
        () =>
          executeManageLibraryDocumentsRequest(
            {
              auth: { uid: 'admin-curator' },
              data: extraPayload,
            },
            adminRepo,
            service,
            undefined,
            undefined,
            undefined,
            db
          ),
        'invalid-argument',
        'UNTRUSTED_OR_UNKNOWN_INPUT_FIELD'
      );
    }

    assert.equal(db.getCalls, 0);
    console.log(
      'PASS 3: Unknown/extra payload keys are strictly rejected with invalid-argument.'
    );
  }

  // Test 4: Query is strictly bounded to 20 and ordered newest-first by receipt.createdAt desc
  {
    const db = new InMemoryReadOnlyQuarantineFirestore();
    const { service, getCallCount } = createForbiddingLibraryService();

    // Seed 25 valid envelopes with ascending timestamps (1..25)
    for (let i = 1; i <= 25; i += 1) {
      const env = buildPersistedEnvelope(i, 2);
      db.seedDocument(env.receipt.receiptId, env);
    }

    const res = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: { action: 'listQuarantineReceipts' },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      db
    );

    assert.deepEqual(db.collectionCalls, [
      LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
    ]);
    assert.deepEqual(db.orderByCalls, [
      {
        fieldPath: LIBRARY_QUARANTINE_RECEIPT_CREATED_AT_ORDER_FIELD,
        directionStr: LIBRARY_QUARANTINE_RECEIPT_ORDER_DIRECTION,
      },
    ]);
    assert.deepEqual(db.limitCalls, [LIBRARY_QUARANTINE_ADMIN_LIST_LIMIT]);
    assert.equal(db.unboundedCollectionGetCalls, 0);
    assert.equal(db.writeAttemptCount, 0);
    assert.equal(getCallCount(), 0);

    assert.equal(res.receipts.length, 20);
    // Newest first: index 25 down to index 6
    assert.equal(
      res.receipts[0].adminReceipt.receiptId,
      buildHexReceiptId(25)
    );
    assert.equal(
      res.receipts[19].adminReceipt.receiptId,
      buildHexReceiptId(6)
    );

    for (let i = 1; i < res.receipts.length; i += 1) {
      const prevTs = res.receipts[i - 1].adminReceipt.createdAt;
      const currTs = res.receipts[i].adminReceipt.createdAt;
      assert.ok(
        prevTs >= currTs,
        `Expected descending order: ${prevTs} >= ${currTs}`
      );
    }

    // Also verify fail-closed if an adapter ever returned > 20 documents
    const brokenDb = new InMemoryReadOnlyQuarantineFirestore();
    brokenDb.forceDocsResultOverride = Array.from({ length: 21 }, (_, idx) => {
      const env = buildPersistedEnvelope(idx + 1, 1);
      return {
        id: env.receipt.receiptId,
        data: () => env,
      };
    });
    const overLimitRes =
      await listLatestSanitizedLibraryQuarantineReceipts(brokenDb);
    assert.equal(overLimitRes.ok, false);
    if (!overLimitRes.ok) {
      assert.equal(overLimitRes.errorCode, 'UNBOUNDED_QUERY_RESULT_REJECTED');
    }

    console.log(
      'PASS 4: Query is strictly bounded to 20 and ordered newest-first by receipt.createdAt desc.'
    );
  }

  // Test 5: Both Quarantined and NeedsReconciliation receipts (plus DOCX & other states) are returned truthfully
  {
    const db = new InMemoryReadOnlyQuarantineFirestore();
    const { service } = createForbiddingLibraryService();

    const quarantinedPdf = buildPersistedEnvelope(10, 3, {
      state: LibraryQuarantineReceiptState.Quarantined,
      format: 'PDF',
      createdAt: '2026-11-08T11:00:00.000Z',
      updatedAt: '2026-11-08T11:00:05.000Z',
    });
    const needsReconDocx = buildPersistedEnvelope(11, 4, {
      state: LibraryQuarantineReceiptState.NeedsReconciliation,
      format: 'DOCX',
      reconciliationReason:
        'GCS conditional write outcome was ambiguous: socket hang up',
      createdAt: '2026-11-08T11:05:00.000Z',
      updatedAt: '2026-11-08T11:05:09.000Z',
    });

    db.seedDocument(quarantinedPdf.receipt.receiptId, quarantinedPdf);
    db.seedDocument(needsReconDocx.receipt.receiptId, needsReconDocx);

    const res = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: { action: 'listQuarantineReceipts' },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      db
    );

    assert.equal(res.receipts.length, 2);

    const first = res.receipts[0];
    assert.equal(first.revision, 4);
    assert.equal(first.adminReceipt.state, 'NeedsReconciliation');
    assert.equal(first.adminReceipt.format, 'DOCX');
    assert.equal(first.adminReceipt.hasVerifiedStorageWrite, false);
    assert.equal(first.adminReceipt.isQuarantinedPrivateOnly, false);
    assert.equal(first.adminReceipt.reconciliationRequired, true);
    assert.equal(
      first.adminReceipt.reconciliationReason,
      'GCS conditional write outcome was ambiguous: socket hang up'
    );

    const second = res.receipts[1];
    assert.equal(second.revision, 3);
    assert.equal(second.adminReceipt.state, 'Quarantined');
    assert.equal(second.adminReceipt.format, 'PDF');
    assert.equal(second.adminReceipt.hasVerifiedStorageWrite, true);
    assert.equal(second.adminReceipt.isQuarantinedPrivateOnly, true);
    assert.equal(second.adminReceipt.reconciliationRequired, false);
    assert.equal(second.adminReceipt.reconciliationReason, null);

    console.log(
      'PASS 5: Both Quarantined and NeedsReconciliation receipts are returned truthfully with exact revisions.'
    );
  }

  // Test 6: Corrupt persisted receipt envelope or mismatched document ID fails closed without skipping
  {
    // 6a. Corrupt envelope (isReadyForPeia: true) alongside a valid envelope -> entire read fails closed
    const dbCorrupt = new InMemoryReadOnlyQuarantineFirestore();
    const { service } = createForbiddingLibraryService();

    const validEnv = buildPersistedEnvelope(1, 3);
    const corruptReceipt = buildInternalReceipt(2);
    const corruptEnv = {
      schemaVersion: LIBRARY_QUARANTINE_RECEIPT_SCHEMA_VERSION,
      revision: 2,
      state: corruptReceipt.state,
      receipt: {
        ...corruptReceipt,
        isReadyForPeia: true,
      },
    };
    dbCorrupt.seedDocument(validEnv.receipt.receiptId, validEnv);
    dbCorrupt.seedDocument(buildHexReceiptId(2), corruptEnv);

    await expectHttpsErrorCode(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: 'admin-curator' },
            data: { action: 'listQuarantineReceipts' },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          dbCorrupt
        ),
      'failed-precondition',
      'CORRUPT_PERSISTED_RECEIPT_ENVELOPE'
    );

    // 6b. Mismatched Firestore document ID vs receipt.receiptId -> fails closed
    const dbMismatch = new InMemoryReadOnlyQuarantineFirestore();
    dbMismatch.seedDocument(buildHexReceiptId(99), validEnv);

    await expectHttpsErrorCode(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: 'admin-curator' },
            data: { action: 'listQuarantineReceipts' },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          dbMismatch
        ),
      'failed-precondition',
      'CORRUPT_PERSISTED_RECEIPT_ENVELOPE'
    );

    // 6c. Non-hex document ID -> fails closed
    const dbBadDocId = new InMemoryReadOnlyQuarantineFirestore();
    dbBadDocId.seedDocument('not-a-valid-32-hex-receipt-id', validEnv);

    await expectHttpsErrorCode(
      () =>
        executeManageLibraryDocumentsRequest(
          {
            auth: { uid: 'admin-curator' },
            data: { action: 'listQuarantineReceipts' },
          },
          adminRepo,
          service,
          undefined,
          undefined,
          undefined,
          dbBadDocId
        ),
      'failed-precondition',
      'INVALID_QUERY_DOCUMENT_ID'
    );

    assert.equal(dbCorrupt.writeAttemptCount, 0);
    assert.equal(dbMismatch.writeAttemptCount, 0);
    assert.equal(dbBadDocId.writeAttemptCount, 0);

    console.log(
      'PASS 6: Corrupt persisted receipt envelopes and mismatched document IDs fail closed without skipping or mutating.'
    );
  }

  // Test 7: Returned DTOs never expose storagePath, generation, URLs, or tokens and preserve all false posture flags
  {
    const db = new InMemoryReadOnlyQuarantineFirestore();
    const { service } = createForbiddingLibraryService();

    const env = buildPersistedEnvelope(42, 3);
    db.seedDocument(env.receipt.receiptId, env);

    const res = await executeManageLibraryDocumentsRequest(
      {
        auth: { uid: 'admin-curator' },
        data: { action: 'listQuarantineReceipts' },
      },
      adminRepo,
      service,
      undefined,
      undefined,
      undefined,
      db
    );

    const item = res.receipts[0];
    const dtoRecord = item.adminReceipt as unknown as Record<string, unknown>;
    assert.equal('storagePath' in dtoRecord, false);
    assert.equal('generation' in dtoRecord, false);
    assert.equal('bucket' in dtoRecord, false);
    assert.equal('signedUrl' in dtoRecord, false);
    assert.equal('downloadUrl' in dtoRecord, false);

    const serialized = JSON.stringify(res);
    assert.equal(serialized.includes('library/quarantine/'), false);
    assert.equal(serialized.includes('gen-42-998877'), false);
    assert.equal(serialized.includes('gs://'), false);

    assert.equal(item.adminReceipt.isSanitized, false);
    assert.equal(item.adminReceipt.isVerifiedSafe, false);
    assert.equal(item.adminReceipt.isRightsApproved, false);
    assert.equal(item.adminReceipt.isPublished, false);
    assert.equal(item.adminReceipt.isReadyForPeia, false);

    console.log(
      'PASS 7: Returned DTOs redact storagePath, generation, URLs, and tokens while preserving false posture flags.'
    );
  }

  console.log('ALL LIB-FILE-INBOX-01 BACKEND READ TESTS PASSED.');
}

runAllTests().catch((err) => {
  console.error('LIB-FILE-INBOX-01 backend read tests failed:', err);
  process.exit(1);
});
