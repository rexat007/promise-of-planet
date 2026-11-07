import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';

// Intercept Firebase Functions / Admin SDK imports in headless Studio test runner
// so that any uninjected live SDK call fails closed immediately.
const recordedOnRequestDefinitions: Array<{
  readonly options: Record<string, unknown>;
  readonly handler: (req: unknown, res: unknown) => Promise<void>;
}> = [];

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
        onRequest: (
          options: Record<string, unknown>,
          handler: (req: unknown, res: unknown) => Promise<void>
        ) => {
          recordedOnRequestDefinitions.push({ options, handler });
          return Object.assign(handler, { __endpointOptions: options });
        },
        onCall: (_options: unknown, handler: unknown) => handler,
        HttpsError: class HttpsError extends Error {
          readonly code: string;
          constructor(code: string, message: string) {
            super(message);
            this.code = code;
          }
        },
      };
    }
    if (request === 'firebase-admin/auth') {
      return {
        getAuth: () => {
          throw new Error(
            'Uninjected live getAuth() must never be called during headless tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error(
            'Uninjected live getFirestore() must never be called during headless tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/storage') {
      return {
        getStorage: () => {
          throw new Error(
            'Uninjected live getStorage() must never be called during headless tests.'
          );
        },
      };
    }
    throw err;
  }
};

import type { AdminRepository } from '../functions/src/admin/adminRepository';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  type AdminUser,
} from '../functions/src/types/admin';
import {
  CANONICAL_DOCX_MIME_TYPE,
  CANONICAL_PDF_MIME_TYPE,
  MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES,
} from '../functions/src/library/libraryUploadBinaryAdmission';
import {
  LibraryQuarantineReceiptState,
  reserveLibraryQuarantineReceipt,
} from '../functions/src/library/libraryQuarantineReceiptContract';
import {
  FirestoreLibraryQuarantineReceiptStore,
  LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
  type LibraryQuarantineFirestoreCollectionRef,
  type LibraryQuarantineFirestoreDatabase,
  type LibraryQuarantineFirestoreDocumentRef,
  type LibraryQuarantineFirestoreDocumentSnapshot,
  type LibraryQuarantineFirestoreTransaction,
} from '../functions/src/library/firestoreLibraryQuarantineReceiptStore';
import {
  GcsLibraryQuarantineStorageAdapter,
  LIBRARY_QUARANTINE_CACHE_CONTROL,
  LIBRARY_QUARANTINE_CONTENT_DISPOSITION,
  LIBRARY_QUARANTINE_METADATA_STATE_VALUE,
  type GcsLibraryQuarantineBucket,
  type GcsLibraryQuarantineFile,
  type GcsLibraryQuarantineFileOptions,
  type GcsLibraryQuarantineObjectMetadata,
  type GcsLibraryQuarantineReadStreamOptions,
  type GcsLibraryQuarantineReadableStream,
  type GcsLibraryQuarantineSaveOptions,
} from '../functions/src/library/gcsLibraryQuarantineStorageAdapter';
import { LibraryQuarantineWriteCoordinator } from '../functions/src/library/libraryQuarantineWriteCoordinator';

const require = createRequire(
  `${process.cwd()}/scripts/runLibraryQuarantineUploadEndpointTests.ts`
);
const {
  ALLOWED_LIBRARY_UPLOAD_CONTENT_TYPES,
  DEFAULT_TRUSTED_LIBRARY_UPLOAD_ORIGINS,
  FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
  LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
  MAX_LIBRARY_QUARANTINE_UPLOAD_BYTES,
  createProductionLibraryQuarantineUploadRuntime,
  executeLibraryQuarantineUploadEndpoint,
  libraryQuarantineUploadEndpoint,
} = require(
  '../functions/src/library/libraryQuarantineUploadEndpoint'
) as typeof import('../functions/src/library/libraryQuarantineUploadEndpoint');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passedCount = 0;
let failedCount = 0;

async function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
    passedCount++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failedCount++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

// ============================================================================
// Deterministic Valid PDF and DOCX Fixture Builders
// ============================================================================

function makeValidPdfBuffer(bodyComment = 'LIB-FILE-UPLOAD-01-PDF'): Buffer {
  const content = [
    '%PDF-1.7',
    `% ${bodyComment}`,
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [] /Count 0 >>',
    'endobj',
    'xref',
    '0 3',
    '0000000000 65535 f ',
    '0000000015 00000 n ',
    '0000000064 00000 n ',
    'trailer',
    '<< /Size 3 /Root 1 0 R >>',
    'startxref',
    '115',
    '%%EOF',
    '',
  ].join('\n');
  return Buffer.from(content, 'utf8');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(
  entries: ReadonlyArray<{ readonly name: string; readonly content: Buffer }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressed = entry.content;
    const compressed = deflateRawSync(uncompressed);
    const entryCrc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(entryCrc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(entryCrc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function makeValidDocxBuffer(paragraphText = 'وثيقة بيئية للمكتبة'): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  return buildZipArchive([
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'word/document.xml', content: Buffer.from(documentXml, 'utf8') },
  ]);
}

function makeMacroDocxBuffer(): Buffer {
  const validEntries = [
    {
      name: '[Content_Types].xml',
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        'utf8'
      ),
    },
    {
      name: '_rels/.rels',
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        'utf8'
      ),
    },
    {
      name: 'word/document.xml',
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Macro test</w:t></w:r></w:p></w:body></w:document>`,
        'utf8'
      ),
    },
    {
      name: 'word/vbaProject.bin',
      content: Buffer.from('VBA_MACRO_PAYLOAD', 'utf8'),
    },
  ];
  return buildZipArchive(validEntries);
}

// ============================================================================
// In-Memory Fakes for Auth, AdminRepository, Firestore, GCS, and HTTP Response
// ============================================================================

class FakeAdminRepository implements AdminRepository {
  public readonly admins = new Map<string, AdminUser>();
  public lookupCalls = 0;
  public nextError: Error | null = null;

  constructor(initialAdmins?: ReadonlyArray<AdminUser>) {
    for (const admin of initialAdmins ?? []) {
      this.admins.set(admin.id, admin);
    }
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    this.lookupCalls++;
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return this.admins.get(uid) ?? null;
  }

  async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    this.admins.set(admin.id, admin);
    return admin;
  }
}

class FakeQuarantineReceiptFirestoreDb
  implements LibraryQuarantineFirestoreDatabase
{
  public readonly docs = new Map<string, Record<string, unknown>>();
  public readonly timeline: string[];
  public transactionCount = 0;
  public failOnTransactionAttempt: number | null = null;

  constructor(timeline: string[] = []) {
    this.timeline = timeline;
  }

  collection(collectionName: string): LibraryQuarantineFirestoreCollectionRef {
    assert(
      collectionName === LIBRARY_QUARANTINE_RECEIPT_COLLECTION,
      `Unexpected Firestore collection "${collectionName}"`
    );
    return {
      doc: (documentId: string): LibraryQuarantineFirestoreDocumentRef => {
        const fullKey = `${collectionName}/${documentId}`;
        return {
          id: documentId,
          get: async (): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
            const stored = this.docs.get(fullKey);
            return {
              exists: stored !== undefined,
              id: documentId,
              data: () =>
                stored !== undefined
                  ? JSON.parse(JSON.stringify(stored))
                  : undefined,
            };
          },
        };
      },
    };
  }

  async runTransaction<T>(
    updateFunction: (
      transaction: LibraryQuarantineFirestoreTransaction
    ) => Promise<T>
  ): Promise<T> {
    this.transactionCount++;
    if (this.failOnTransactionAttempt === this.transactionCount) {
      this.timeline.push(`firestore:tx#${this.transactionCount}:ABORTED`);
      throw new Error('Simulated Firestore transaction failure');
    }

    const stagedWrites = new Map<string, Record<string, unknown>>();

    const tx: LibraryQuarantineFirestoreTransaction = {
      get: async (
        docRef: LibraryQuarantineFirestoreDocumentRef
      ): Promise<LibraryQuarantineFirestoreDocumentSnapshot> => {
        const fullKey = `${LIBRARY_QUARANTINE_RECEIPT_COLLECTION}/${docRef.id}`;
        const current = stagedWrites.has(fullKey)
          ? stagedWrites.get(fullKey)
          : this.docs.get(fullKey);
        return {
          exists: current !== undefined,
          id: docRef.id,
          data: () =>
            current !== undefined
              ? JSON.parse(JSON.stringify(current))
              : undefined,
        };
      },
      create: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ) => {
        const fullKey = `${LIBRARY_QUARANTINE_RECEIPT_COLLECTION}/${docRef.id}`;
        if (this.docs.has(fullKey) || stagedWrites.has(fullKey)) {
          throw new Error('ALREADY_EXISTS');
        }
        stagedWrites.set(fullKey, JSON.parse(JSON.stringify(data)));
      },
      set: (
        docRef: LibraryQuarantineFirestoreDocumentRef,
        data: Record<string, unknown>
      ) => {
        const fullKey = `${LIBRARY_QUARANTINE_RECEIPT_COLLECTION}/${docRef.id}`;
        stagedWrites.set(fullKey, JSON.parse(JSON.stringify(data)));
      },
    };

    const result = await updateFunction(tx);
    for (const [k, v] of stagedWrites.entries()) {
      const state = (v as { state?: string }).state ?? 'unknown';
      this.timeline.push(`firestore:commit:${state}`);
      this.docs.set(k, v);
    }
    return result;
  }
}

interface StoredFakeGcsObject {
  readonly bytes: Buffer;
  readonly metadata: GcsLibraryQuarantineObjectMetadata;
}

class FakeDedicatedQuarantineGcsBucket implements GcsLibraryQuarantineBucket {
  public readonly name: string;
  public readonly objects = new Map<string, StoredFakeGcsObject>();
  public readonly generationsByPath = new Map<
    string,
    Map<string, StoredFakeGcsObject>
  >();
  public readonly timeline: string[];
  public saveCalls = 0;
  public getMetadataCalls = 0;
  public readStreamCalls = 0;
  public nextSaveError: Error | null = null;
  public nextStreamError: Error | null = null;
  private generationCounter = 1730990000000;

  constructor(
    name: string = LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
    timeline: string[] = []
  ) {
    this.name = name;
    this.timeline = timeline;
  }

  file(
    objectPath: string,
    fileOptions?: GcsLibraryQuarantineFileOptions
  ): GcsLibraryQuarantineFile {
    const pinnedGeneration =
      fileOptions && typeof fileOptions.generation === 'string'
        ? fileOptions.generation
        : undefined;

    return {
      name: objectPath,
      ...(pinnedGeneration !== undefined
        ? { generation: pinnedGeneration }
        : {}),
      save: async (
        data: Buffer,
        options: GcsLibraryQuarantineSaveOptions
      ): Promise<void> => {
        this.saveCalls++;
        this.timeline.push(`gcs:${this.name}:save`);
        if (this.nextSaveError) {
          const err = this.nextSaveError;
          this.nextSaveError = null;
          throw err;
        }
        if (
          options.preconditionOpts?.ifGenerationMatch === 0 &&
          this.objects.has(objectPath)
        ) {
          const err = new Error('Precondition Failed') as Error & {
            code?: number;
          };
          err.code = 412;
          throw err;
        }
        this.generationCounter += 1;
        const generation = String(this.generationCounter);
        const stored: StoredFakeGcsObject = {
          bytes: Buffer.from(data),
          metadata: {
            name: objectPath,
            bucket: this.name,
            generation,
            metageneration: '1',
            contentType: options.contentType,
            cacheControl: options.metadata.cacheControl,
            contentDisposition: options.metadata.contentDisposition,
            size: String(data.byteLength),
            metadata: { ...options.metadata.metadata },
          },
        };
        this.objects.set(objectPath, stored);
        let genMap = this.generationsByPath.get(objectPath);
        if (!genMap) {
          genMap = new Map<string, StoredFakeGcsObject>();
          this.generationsByPath.set(objectPath, genMap);
        }
        genMap.set(generation, stored);
      },
      getMetadata: async (): Promise<
        [GcsLibraryQuarantineObjectMetadata, unknown?]
      > => {
        this.getMetadataCalls++;
        this.timeline.push(`gcs:${this.name}:getMetadata`);
        const stored =
          pinnedGeneration !== undefined
            ? this.generationsByPath.get(objectPath)?.get(pinnedGeneration)
            : this.objects.get(objectPath);
        if (!stored) {
          const err = new Error('No such object') as Error & { code?: number };
          err.code = 404;
          throw err;
        }
        return [JSON.parse(JSON.stringify(stored.metadata))];
      },
      createReadStream: (
        _opts?: GcsLibraryQuarantineReadStreamOptions
      ): GcsLibraryQuarantineReadableStream => {
        this.readStreamCalls++;
        this.timeline.push(
          `gcs:${this.name}:createReadStream:${pinnedGeneration ?? 'UNPINNED'}`
        );
        assert(
          pinnedGeneration !== undefined,
          'Readback stream must always be generation-pinned'
        );
        const stored = this.generationsByPath
          .get(objectPath)
          ?.get(pinnedGeneration!);
        const streamErr = this.nextStreamError;
        this.nextStreamError = null;

        return {
          destroy() {
            // no-op
          },
          async *[Symbol.asyncIterator]() {
            if (!stored) {
              const err = new Error('Generation not found') as Error & {
                code?: number;
              };
              err.code = 404;
              throw err;
            }
            if (streamErr) {
              throw streamErr;
            }
            yield Buffer.from(stored.bytes);
          },
        };
      },
    };
  }
}

class MockHttpResponseWriter {
  public statusCode = 200;
  public readonly headers: Record<string, string> = {};
  public jsonBody: Record<string, unknown> | null = null;
  public ended = false;

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): unknown {
    this.jsonBody = body as Record<string, unknown>;
    return body;
  }

  end(): void {
    this.ended = true;
  }
}

function createEndpointTestHarness(options?: {
  readonly admins?: ReadonlyArray<AdminUser>;
  readonly validTokens?: Readonly<
    Record<string, { readonly uid: string; readonly [k: string]: unknown }>
  >;
}) {
  const timeline: string[] = [];
  const defaultAdmins: AdminUser[] = [
    {
      id: 'uid_library_curator_1',
      name: 'Library Curator',
      email: 'curator@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
    },
    {
      id: 'uid_owner_1',
      name: 'Platform Owner',
      email: 'owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    },
    {
      id: 'uid_inactive_curator',
      name: 'Inactive Curator',
      email: 'inactive@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: false,
    },
    {
      id: 'uid_news_editor',
      name: 'News Content Editor',
      email: 'news@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    },
    {
      id: 'uid_rights_reviewer',
      name: 'Rights Reviewer',
      email: 'rights@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    },
    {
      id: 'uid_trainer',
      name: 'Trainer User',
      email: 'trainer@promiseofplanet.org',
      role: AdminRole.Trainer,
      isActive: true,
    },
    {
      id: 'uid_viewer',
      name: 'Viewer User',
      email: 'viewer@promiseofplanet.org',
      role: AdminRole.Viewer,
      isActive: true,
    },
    {
      id: 'uid_ai_assistant',
      name: 'AI Assistant',
      email: 'ai@promiseofplanet.org',
      role: AdminRole.AIAssistant,
      isActive: true,
    },
  ];

  const adminRepository = new FakeAdminRepository(
    options?.admins ?? defaultAdmins
  );
  const firestoreDb = new FakeQuarantineReceiptFirestoreDb(timeline);
  const receiptStore = new FirestoreLibraryQuarantineReceiptStore(firestoreDb);
  const bucket = new FakeDedicatedQuarantineGcsBucket(
    LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
    timeline
  );

  let stepClockCounter = 0;
  const clock = (): string => {
    stepClockCounter += 1;
    const sec = String(stepClockCounter).padStart(2, '0');
    return `2026-11-07T14:00:${sec}.000Z`;
  };

  const gcsAdapter = new GcsLibraryQuarantineStorageAdapter({
    bucket,
    clock,
  });

  let coordinatorCalls = 0;
  const realCoordinator = new LibraryQuarantineWriteCoordinator({
    receiptStore,
    storageAdapter: gcsAdapter,
    clock,
  });

  const writeCoordinator = {
    executeReservedQuarantineWrite: async (
      input: Parameters<
        LibraryQuarantineWriteCoordinator['executeReservedQuarantineWrite']
      >[0]
    ) => {
      coordinatorCalls += 1;
      timeline.push('coordinator:executeReservedQuarantineWrite');
      return realCoordinator.executeReservedQuarantineWrite(input);
    },
  };

  const tokenMap: Record<
    string,
    { readonly uid: string; readonly [k: string]: unknown }
  > = {
    'valid-curator-token': { uid: 'uid_library_curator_1' },
    'valid-owner-token': { uid: 'uid_owner_1' },
    'inactive-curator-token': { uid: 'uid_inactive_curator' },
    'news-editor-token': { uid: 'uid_news_editor' },
    'rights-reviewer-token': { uid: 'uid_rights_reviewer' },
    'trainer-token': { uid: 'uid_trainer' },
    'viewer-token': { uid: 'uid_viewer' },
    'ai-role-token': { uid: 'uid_ai_assistant' },
    'ai-claim-token': {
      uid: 'uid_library_curator_1',
      isAIAssistant: true,
    },
    'unregistered-admin-token': {
      uid: 'uid_not_in_admins_collection',
      role: AdminRole.Owner,
      permissions: [AdminPermission.Create, AdminPermission.Edit],
    },
    ...(options?.validTokens ?? {}),
  };

  const verifyIdTokenCalls: Array<{
    readonly token: string;
    readonly checkRevoked?: boolean;
  }> = [];

  const verifyIdToken = async (
    idToken: string,
    checkRevoked?: boolean
  ): Promise<{ readonly uid: string; readonly [k: string]: unknown }> => {
    verifyIdTokenCalls.push({ token: idToken, checkRevoked });
    if (checkRevoked !== true) {
      throw new Error('verifyIdToken must be called with checkRevoked = true');
    }
    const found = tokenMap[idToken];
    if (!found) {
      throw new Error('Firebase ID token is invalid or revoked');
    }
    return found;
  };

  return {
    timeline,
    adminRepository,
    firestoreDb,
    receiptStore,
    bucket,
    gcsAdapter,
    writeCoordinator,
    getCoordinatorCalls: () => coordinatorCalls,
    verifyIdToken,
    verifyIdTokenCalls,
    clock,
  };
}

// ============================================================================
// Test Suite Execution
// ============================================================================

async function runAllTests(): Promise<void> {
  await test('1. Active authorized Library editors (LibraryCurator and Owner) succeed for PDF and DOCX with verified Quarantined state', async () => {
    const harness = createEndpointTestHarness();
    const pdfBytes = makeValidPdfBuffer('CLIMATE_REPORT_2026');
    const expectedPdfSha = createHash('sha256')
      .update(pdfBytes)
      .digest('hex')
      .toLowerCase();

    const pdfRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Origin: 'https://promiseofplanet.org',
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'Content-Length': String(pdfBytes.byteLength),
          'X-Original-Filename': 'تقرير_المناخ_2026.pdf',
        },
        rawBody: pdfBytes,
      },
      pdfRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );

    assert(
      pdfRes.statusCode === 201,
      `Expected HTTP 201 for PDF upload, got ${pdfRes.statusCode}`
    );
    assert(
      pdfRes.jsonBody?.ok === true &&
        pdfRes.jsonBody?.status === 'QUARANTINED' &&
        pdfRes.jsonBody?.revision === 3,
      `Expected QUARANTINED at revision 3, got ${JSON.stringify(pdfRes.jsonBody)}`
    );
    assert(
      harness.verifyIdTokenCalls.length === 1 &&
        harness.verifyIdTokenCalls[0].checkRevoked === true,
      'verifyIdToken must be called with checkRevoked: true'
    );
    assert(
      harness.getCoordinatorCalls() === 1,
      'WriteCoordinator must be invoked exactly once'
    );

    const adminReceipt = pdfRes.jsonBody?.adminReceipt as Record<
      string,
      unknown
    >;
    assert(
      adminReceipt.state === LibraryQuarantineReceiptState.Quarantined &&
        adminReceipt.format === 'PDF' &&
        adminReceipt.sha256 === expectedPdfSha &&
        adminReceipt.byteSize === pdfBytes.byteLength &&
        adminReceipt.uploaderUid === 'uid_library_curator_1' &&
        adminReceipt.hasVerifiedStorageWrite === true &&
        adminReceipt.isQuarantinedPrivateOnly === true,
      'Sanitized adminReceipt must reflect verified Quarantined PDF metadata'
    );

    // Owner DOCX upload via metadata JSON header
    const docxBytes = makeValidDocxBuffer('اتفاقية التنوع البيولوجي');
    const docxRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Authorization: 'Bearer valid-owner-token',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(docxBytes.byteLength),
          'X-Library-Upload-Metadata': encodeURIComponent(
            JSON.stringify({
              originalFilename: 'biodiversity_policy.docx',
              claimedMimeType: CANONICAL_DOCX_MIME_TYPE,
            })
          ),
        },
        rawBody: docxBytes,
      },
      docxRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );

    assert(
      docxRes.statusCode === 201 &&
        docxRes.jsonBody?.ok === true &&
        docxRes.jsonBody?.status === 'QUARANTINED' &&
        docxRes.jsonBody?.revision === 3,
      `Expected HTTP 201 QUARANTINED for Owner DOCX upload, got ${docxRes.statusCode}`
    );
  });

  await test('2. Unauthorized users, inactive accounts, untrusted token role claims, and AI accounts are rejected with 403 and zero writes', async () => {
    const harness = createEndpointTestHarness();
    const pdfBytes = makeValidPdfBuffer();

    for (const token of [
      'unregistered-admin-token',
      'inactive-curator-token',
      'ai-role-token',
      'ai-claim-token',
    ]) {
      const res = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': CANONICAL_PDF_MIME_TYPE,
            'X-Original-Filename': 'doc.pdf',
          },
          rawBody: pdfBytes,
        },
        res,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        res.statusCode === 403 && res.jsonBody?.ok === false,
        `Expected 403 for token "${token}", got ${res.statusCode}`
      );
      if (token.startsWith('ai-')) {
        assert(
          res.jsonBody?.errorCode === 'AI_ACCOUNT_FORBIDDEN',
          `Expected AI_ACCOUNT_FORBIDDEN for "${token}", got ${String(res.jsonBody?.errorCode)}`
        );
      } else {
        assert(
          res.jsonBody?.errorCode === 'PERMISSION_DENIED',
          `Expected PERMISSION_DENIED for "${token}", got ${String(res.jsonBody?.errorCode)}`
        );
      }
    }

    assert(
      harness.firestoreDb.docs.size === 0 &&
        harness.bucket.saveCalls === 0 &&
        harness.getCoordinatorCalls() === 0,
      'Zero Firestore or GCS writes may occur on unauthorized / AI requests'
    );
  });

  await test('3. Wrong domain or insufficient permission (ContentEditor, RightsReviewer, Trainer, Viewer, or restricted Library user) rejected with 403', async () => {
    const restrictedCurator = {
      id: 'uid_restricted_curator',
      name: 'View-Only Library Member',
      email: 'viewonly@promiseofplanet.org',
      role: AdminRole.LibraryCurator,
      isActive: true,
      permissions: [AdminPermission.View, AdminPermission.Review],
      domains: [AdminDomain.Library],
    } as unknown as AdminUser;

    const harness = createEndpointTestHarness();
    harness.adminRepository.admins.set(
      restrictedCurator.id,
      restrictedCurator
    );

    const pdfBytes = makeValidPdfBuffer();

    for (const token of [
      'news-editor-token',
      'rights-reviewer-token',
      'trainer-token',
      'viewer-token',
    ]) {
      const res = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': CANONICAL_PDF_MIME_TYPE,
            'X-Original-Filename': 'doc.pdf',
          },
          rawBody: pdfBytes,
        },
        res,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        res.statusCode === 403 &&
          res.jsonBody?.errorCode === 'PERMISSION_DENIED',
        `Expected 403 PERMISSION_DENIED for wrong-domain/insufficient-permission token "${token}", got ${res.statusCode}`
      );
    }

    // Also test Library user whose explicit permissions lack Create/Edit
    const restrictedRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer restricted-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'doc.pdf',
        },
        rawBody: pdfBytes,
      },
      restrictedRes,
      {
        verifyIdToken: async () => ({ uid: 'uid_restricted_curator' }),
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );

    assert(
      restrictedRes.statusCode === 403 &&
        restrictedRes.jsonBody?.errorCode === 'PERMISSION_DENIED',
      'Expected 403 PERMISSION_DENIED when explicit permissions lack Create/Edit'
    );
    assert(
      harness.firestoreDb.docs.size === 0 && harness.bucket.saveCalls === 0,
      'Zero writes on domain/permission rejection'
    );
  });

  await test('4. Missing, invalid, revoked, cookie-only, or alternative authentication rejected with 401', async () => {
    const harness = createEndpointTestHarness();
    const pdfBytes = makeValidPdfBuffer();

    const invalidHeaderCases: Array<
      Readonly<Record<string, string | string[] | undefined>>
    > = [
      {}, // missing Authorization
      { Authorization: 'Basic dXNlcjpwYXNz' }, // wrong scheme
      { Authorization: 'Bearer ' }, // empty token
      { Authorization: 'Bearer revoked-or-unknown-token' }, // verification fails
      { Authorization: ['Bearer valid-curator-token', 'Bearer second-token'] }, // duplicate header
      { Cookie: '__session=valid-curator-token' }, // cookie-only
      {
        Authorization: 'Bearer valid-curator-token',
        Cookie: '__session=some-cookie',
      }, // cookie present alongside Bearer
      {
        Authorization: 'Bearer valid-curator-token',
        'X-API-Key': 'alt-key',
      }, // alternative credential header
      {
        Authorization: 'Bearer valid-curator-token',
        'X-Machine-Token': 'machine-secret',
      },
    ];

    for (const authHeaders of invalidHeaderCases) {
      const res = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': CANONICAL_PDF_MIME_TYPE,
            'X-Original-Filename': 'doc.pdf',
          },
          rawBody: pdfBytes,
        },
        res,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        res.statusCode === 401 &&
          res.jsonBody?.errorCode === 'UNAUTHENTICATED' &&
          res.headers['www-authenticate'] === 'Bearer',
        `Expected 401 UNAUTHENTICATED with WWW-Authenticate: Bearer, got ${res.statusCode}`
      );
    }

    assert(
      harness.firestoreDb.docs.size === 0 && harness.bucket.saveCalls === 0,
      'Zero writes on 401 authentication failures'
    );
  });

  await test('5. Invalid Origin, CORS preflight, and non-POST method enforcement', async () => {
    const harness = createEndpointTestHarness();
    const pdfBytes = makeValidPdfBuffer();

    // 5a. Untrusted origin rejected with 403 CORS_ORIGIN_FORBIDDEN
    for (const badOrigin of [
      'https://attacker.example.com',
      '*',
      'http://promiseofplanet.org',
    ]) {
      const res = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Origin: badOrigin,
            Authorization: 'Bearer valid-curator-token',
            'Content-Type': CANONICAL_PDF_MIME_TYPE,
            'X-Original-Filename': 'doc.pdf',
          },
          rawBody: pdfBytes,
        },
        res,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        res.statusCode === 403 &&
          res.jsonBody?.errorCode === 'CORS_ORIGIN_FORBIDDEN' &&
          res.headers['access-control-allow-origin'] === undefined,
        `Expected 403 CORS_ORIGIN_FORBIDDEN for Origin "${badOrigin}"`
      );
    }

    // 5b. Approved OPTIONS preflight succeeds with 204 and zero side effects
    const optionsRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://promiseofplanet.org',
          'Access-Control-Request-Method': 'POST',
        },
      },
      optionsRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );

    assert(
      optionsRes.statusCode === 204 &&
        optionsRes.ended === true &&
        optionsRes.headers['access-control-allow-origin'] ===
          'https://promiseofplanet.org' &&
        optionsRes.headers['vary'] === 'Origin',
      'Expected 204 with exact Access-Control-Allow-Origin for trusted OPTIONS preflight'
    );

    // 5c. Non-POST HTTP methods rejected with 405
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const methodRes = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method,
          headers: {
            Authorization: 'Bearer valid-curator-token',
          },
        },
        methodRes,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        methodRes.statusCode === 405 &&
          methodRes.jsonBody?.errorCode === 'HTTP_METHOD_NOT_ALLOWED' &&
          methodRes.headers['allow'] === 'POST',
        `Expected 405 HTTP_METHOD_NOT_ALLOWED for ${method}`
      );
    }
  });

  await test('6. Invalid PDF/DOCX, oversized body, empty body, and mismatched Content-Length fail closed before any write', async () => {
    const harness = createEndpointTestHarness();
    const validPdf = makeValidPdfBuffer();

    // 6a. Oversized Content-Length (> 15,000,000)
    const oversizedHeaderRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'Content-Length': String(MAX_LIBRARY_UPLOAD_PRELIMINARY_BYTES + 1),
          'X-Original-Filename': 'huge.pdf',
        },
        rawBody: validPdf,
      },
      oversizedHeaderRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );
    assert(
      oversizedHeaderRes.statusCode === 413 &&
        oversizedHeaderRes.jsonBody?.errorCode === 'SIZE_LIMIT_EXCEEDED',
      'Expected 413 SIZE_LIMIT_EXCEEDED for oversized Content-Length'
    );

    // 6b. Oversized actual binary buffer with custom maxUploadBytes (and default 15MB check)
    const oversizedBodyRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'huge.pdf',
        },
        rawBody: Buffer.alloc(1024, 0x25),
      },
      oversizedBodyRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        maxUploadBytes: 512,
        clock: harness.clock,
      }
    );
    assert(
      oversizedBodyRes.statusCode === 413 &&
        oversizedBodyRes.jsonBody?.errorCode === 'SIZE_LIMIT_EXCEEDED',
      'Expected 413 SIZE_LIMIT_EXCEEDED when rawBody exceeds maxUploadBytes'
    );

    // 6c. Mismatched Content-Length vs actual buffer length
    const mismatchClRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'Content-Length': String(validPdf.byteLength + 10),
          'X-Original-Filename': 'doc.pdf',
        },
        rawBody: validPdf,
      },
      mismatchClRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );
    assert(
      mismatchClRes.statusCode === 400 &&
        mismatchClRes.jsonBody?.errorCode === 'CONTENT_LENGTH_MISMATCH',
      'Expected 400 CONTENT_LENGTH_MISMATCH when Content-Length != rawBody.byteLength'
    );

    // 6d. Empty binary payload
    const emptyRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'empty.pdf',
        },
        rawBody: Buffer.alloc(0),
      },
      emptyRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );
    assert(
      emptyRes.statusCode === 400 &&
        emptyRes.jsonBody?.errorCode === 'EMPTY_BINARY',
      'Expected 400 EMPTY_BINARY for 0-byte payload'
    );

    // 6e. Invalid PDF magic bytes / corrupted structure
    const badPdfRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'fake.pdf',
        },
        rawBody: Buffer.from('NOT_A_PDF_DOCUMENT_AT_ALL', 'utf8'),
      },
      badPdfRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );
    assert(
      badPdfRes.statusCode === 422 &&
        badPdfRes.jsonBody?.errorCode ===
          'BINARY_ADMISSION_OR_STRUCTURE_REJECTED',
      'Expected 422 BINARY_ADMISSION_OR_STRUCTURE_REJECTED for fake PDF'
    );

    // 6f. DOCX with embedded macro vbaProject.bin rejected by LIB-FILE-01B
    const macroDocxRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_DOCX_MIME_TYPE,
          'X-Original-Filename': 'macro.docx',
        },
        rawBody: makeMacroDocxBuffer(),
      },
      macroDocxRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );
    assert(
      macroDocxRes.statusCode === 422 &&
        macroDocxRes.jsonBody?.errorCode ===
          'BINARY_ADMISSION_OR_STRUCTURE_REJECTED' &&
        (macroDocxRes.jsonBody?.binaryRejectionCode ===
          'MACRO_ENABLED_FORMAT_FORBIDDEN' ||
          macroDocxRes.jsonBody?.binaryRejectionCode ===
            'DOCX_FORBIDDEN_MACRO_OR_ACTIVE_PART'),
      `Expected 422 MACRO_ENABLED_FORMAT_FORBIDDEN or DOCX_FORBIDDEN_MACRO_OR_ACTIVE_PART, got ${JSON.stringify(macroDocxRes.jsonBody)}`
    );

    assert(
      harness.firestoreDb.docs.size === 0 &&
        harness.bucket.saveCalls === 0 &&
        harness.getCoordinatorCalls() === 0,
      'Zero Firestore or GCS writes may occur when binary admission fails'
    );
  });

  await test('7. Rejects unexpected input fields, caller-supplied receipt IDs, storage paths, inspection verdicts, object generations, and bucket names', async () => {
    const harness = createEndpointTestHarness();
    const validPdf = makeValidPdfBuffer();

    const forbiddenHeaderCases: Array<Record<string, string>> = [
      { 'X-Receipt-Id': 'a'.repeat(32) },
      { 'X-Storage-Path': 'library/quarantine/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/source.pdf' },
      { 'X-Bucket': 'promiseofplanet-bb325.firebasestorage.app' },
      { 'X-Bucket-Name': 'custom-bucket' },
      { 'X-Generation': '123456789' },
      { 'X-Inspection-Verdict': 'VERIFIED_SAFE' },
      { 'X-Verified-Safe': 'true' },
      { 'X-Public-Url': 'https://example.com/public.pdf' },
      { 'X-Uploader-Uid': 'other_uid' },
    ];

    for (const extraHeader of forbiddenHeaderCases) {
      const res = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-curator-token',
            'Content-Type': CANONICAL_PDF_MIME_TYPE,
            'X-Original-Filename': 'clean.pdf',
            ...extraHeader,
          },
          rawBody: validPdf,
        },
        res,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        res.statusCode === 400 &&
          res.jsonBody?.errorCode === 'UNTRUSTED_CALLER_FIELD',
        `Expected 400 UNTRUSTED_CALLER_FIELD for header ${JSON.stringify(extraHeader)}, got ${res.statusCode}`
      );
    }

    // Forbidden field inside X-Library-Upload-Metadata JSON
    for (const forbiddenEnvelope of [
      { originalFilename: 'clean.pdf', receiptId: 'a'.repeat(32) },
      { originalFilename: 'clean.pdf', storagePath: 'public/evil.pdf' },
      { originalFilename: 'clean.pdf', bucket: 'evil-bucket' },
      { originalFilename: 'clean.pdf', generation: '999' },
      { originalFilename: 'clean.pdf', isVerifiedSafe: true },
    ]) {
      const res = new MockHttpResponseWriter();
      await executeLibraryQuarantineUploadEndpoint(
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-curator-token',
            'Content-Type': CANONICAL_PDF_MIME_TYPE,
            'X-Library-Upload-Metadata': JSON.stringify(forbiddenEnvelope),
          },
          rawBody: validPdf,
        },
        res,
        {
          verifyIdToken: harness.verifyIdToken,
          adminRepository: harness.adminRepository,
          receiptStore: harness.receiptStore,
          writeCoordinator: harness.writeCoordinator,
          clock: harness.clock,
        }
      );

      assert(
        res.statusCode === 400 &&
          res.jsonBody?.errorCode === 'UNTRUSTED_CALLER_FIELD',
        `Expected 400 UNTRUSTED_CALLER_FIELD for metadata ${JSON.stringify(forbiddenEnvelope)}`
      );
    }

    assert(
      harness.firestoreDb.docs.size === 0 && harness.bucket.saveCalls === 0,
      'Zero writes on untrusted caller fields'
    );
  });

  await test('8. Reserved receipt is persisted before GCS write, and failed reservation blocks GCS completely', async () => {
    // 8a. Verify exact ordering on normal execution
    const harness = createEndpointTestHarness();
    const validPdf = makeValidPdfBuffer('ORDERING_PROOF');

    const okRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'ordered.pdf',
        },
        rawBody: validPdf,
      },
      okRes,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );

    assert(okRes.statusCode === 201, 'Expected 201 on normal execution');
    const expectedTimeline = [
      'firestore:commit:Reserved',
      'coordinator:executeReservedQuarantineWrite',
      'firestore:commit:WritePending',
      `gcs:${LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME}:save`,
      `gcs:${LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME}:getMetadata`,
      `gcs:${LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME}:createReadStream:1730990000001`,
      'firestore:commit:Quarantined',
    ];
    assert(
      JSON.stringify(harness.timeline) === JSON.stringify(expectedTimeline),
      `Expected exact timeline ${JSON.stringify(expectedTimeline)}, got ${JSON.stringify(harness.timeline)}`
    );

    // 8b. Failed initial Firestore reservation blocks WriteCoordinator and GCS completely
    const failReserveHarness = createEndpointTestHarness();
    failReserveHarness.firestoreDb.failOnTransactionAttempt = 1;

    const failReserveRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'fail_reserve.pdf',
        },
        rawBody: validPdf,
      },
      failReserveRes,
      {
        verifyIdToken: failReserveHarness.verifyIdToken,
        adminRepository: failReserveHarness.adminRepository,
        receiptStore: failReserveHarness.receiptStore,
        writeCoordinator: failReserveHarness.writeCoordinator,
        clock: failReserveHarness.clock,
      }
    );

    assert(
      failReserveRes.statusCode === 500 &&
        failReserveRes.jsonBody?.status === 'RESERVATION_FAILED' &&
        failReserveRes.jsonBody?.errorCode === 'RESERVATION_PERSISTENCE_FAILED',
      `Expected 500 RESERVATION_PERSISTENCE_FAILED, got ${JSON.stringify(failReserveRes.jsonBody)}`
    );
    assert(
      failReserveHarness.getCoordinatorCalls() === 0 &&
        failReserveHarness.bucket.saveCalls === 0,
      'Failed reservation must block WriteCoordinator and GCS save completely'
    );
  });

  await test('9. Ambiguous storage and CAS outcomes return NEEDS_RECONCILIATION or PERSISTENCE_UNCERTAIN without blind retries or false success', async () => {
    // 9a. Ambiguous GCS save timeout -> transitions receipt to NeedsReconciliation (503)
    const reconHarness = createEndpointTestHarness();
    reconHarness.bucket.nextSaveError = new Error(
      'ETIMEDOUT: Socket timeout writing to https://storage.googleapis.com/promiseofplanet-bb325-library-quarantine'
    );

    const reconRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'timeout.pdf',
        },
        rawBody: makeValidPdfBuffer('TIMEOUT_CASE'),
      },
      reconRes,
      {
        verifyIdToken: reconHarness.verifyIdToken,
        adminRepository: reconHarness.adminRepository,
        receiptStore: reconHarness.receiptStore,
        writeCoordinator: reconHarness.writeCoordinator,
        clock: reconHarness.clock,
      }
    );

    assert(
      reconRes.statusCode === 503 &&
        reconRes.jsonBody?.ok === false &&
        reconRes.jsonBody?.status === 'NEEDS_RECONCILIATION' &&
        reconRes.jsonBody?.reconciliationPersisted === true &&
        typeof reconRes.jsonBody?.receiptId === 'string',
      `Expected 503 NEEDS_RECONCILIATION, got ${JSON.stringify(reconRes.jsonBody)}`
    );
    assert(
      reconHarness.getCoordinatorCalls() === 1 &&
        reconHarness.bucket.saveCalls === 1,
      'Must never blindly retry GCS upload on ambiguous failure'
    );

    // 9b. GCS write succeeds, but final Firestore CAS (WritePending -> Quarantined) fails -> PERSISTENCE_UNCERTAIN (503)
    const uncertainHarness = createEndpointTestHarness();
    // Tx 1 = createReceiptIfAbsent (Reserved), Tx 2 = CAS WritePending, Tx 3 = CAS Quarantined (FAIL)
    uncertainHarness.firestoreDb.failOnTransactionAttempt = 3;

    const uncertainRes = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_DOCX_MIME_TYPE,
          'X-Original-Filename': 'uncertain.docx',
        },
        rawBody: makeValidDocxBuffer('UNCERTAIN_CAS'),
      },
      uncertainRes,
      {
        verifyIdToken: uncertainHarness.verifyIdToken,
        adminRepository: uncertainHarness.adminRepository,
        receiptStore: uncertainHarness.receiptStore,
        writeCoordinator: uncertainHarness.writeCoordinator,
        clock: uncertainHarness.clock,
      }
    );

    assert(
      uncertainRes.statusCode === 503 &&
        uncertainRes.jsonBody?.ok === false &&
        uncertainRes.jsonBody?.status === 'PERSISTENCE_UNCERTAIN' &&
        uncertainRes.jsonBody?.errorCode === 'FINAL_QUARANTINE_CAS_FAILED' &&
        uncertainRes.jsonBody?.reconciliationPersisted === false,
      `Expected 503 PERSISTENCE_UNCERTAIN when final CAS fails after GCS write, got ${JSON.stringify(uncertainRes.jsonBody)}`
    );
  });

  await test('10. Production runtime binds explicitly to promiseofplanet-bb325-library-quarantine and never falls back to default bucket', async () => {
    const requestedBucketNames: Array<string | undefined> = [];
    const fakeFirestore = new FakeQuarantineReceiptFirestoreDb();
    const fakeDedicatedBucket = new FakeDedicatedQuarantineGcsBucket(
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME
    );

    const runtime = createProductionLibraryQuarantineUploadRuntime({
      adminRepository: new FakeAdminRepository(),
      getFirestore: () => fakeFirestore,
      getStorage: () => ({
        bucket: (name?: string) => {
          requestedBucketNames.push(name);
          if (!name) {
            throw new Error(
              'Default bucket() without explicit name is forbidden!'
            );
          }
          return fakeDedicatedBucket;
        },
      }),
      getAuth: () => ({
        verifyIdToken: async (idToken: string, checkRevoked?: boolean) => ({
          uid: idToken,
          checkRevoked,
        }),
      }),
    });

    assert(
      runtime.targetBucketName === 'promiseofplanet-bb325-library-quarantine' &&
        requestedBucketNames.length === 1 &&
        requestedBucketNames[0] === 'promiseofplanet-bb325-library-quarantine',
      `Expected explicit bucket('promiseofplanet-bb325-library-quarantine'), got ${JSON.stringify(requestedBucketNames)}`
    );

    // Reject if resolved bucket reports the forbidden default Firebase Storage bucket name
    let rejectedDefaultBucket = false;
    try {
      createProductionLibraryQuarantineUploadRuntime({
        adminRepository: new FakeAdminRepository(),
        getFirestore: () => fakeFirestore,
        getStorage: () => ({
          bucket: () =>
            new FakeDedicatedQuarantineGcsBucket(
              FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME
            ),
        }),
        getAuth: () => ({
          verifyIdToken: async (idToken: string) => ({ uid: idToken }),
        }),
      });
    } catch (err) {
      rejectedDefaultBucket =
        err instanceof Error && err.message.includes('UNSAFE_BUCKET_BINDING');
    }
    assert(
      rejectedDefaultBucket,
      'Must reject bucket handle whose name matches default promiseofplanet-bb325.firebasestorage.app'
    );

    // Reject caller-supplied bucketName override in production runtime options
    let rejectedBucketOverride = false;
    try {
      createProductionLibraryQuarantineUploadRuntime({
        bucketName: 'custom-bucket',
      } as unknown as Parameters<
        typeof createProductionLibraryQuarantineUploadRuntime
      >[0]);
    } catch (err) {
      rejectedBucketOverride =
        err instanceof Error && err.message.includes('UNSAFE_BUCKET_BINDING');
    }
    assert(
      rejectedBucketOverride,
      'Must reject caller-supplied bucketName override in createProductionLibraryQuarantineUploadRuntime'
    );
  });

  await test('11. Zero leakage of credentials, private storage paths, bucket names, GCS generations, or URLs, and no publication/PEIA escalation', async () => {
    const harness = createEndpointTestHarness();
    const pdfBytes = makeValidPdfBuffer('PRIVACY_CHECK');

    const res = new MockHttpResponseWriter();
    await executeLibraryQuarantineUploadEndpoint(
      {
        method: 'POST',
        headers: {
          Origin: 'https://promiseofplanet.org',
          Authorization: 'Bearer valid-curator-token',
          'Content-Type': CANONICAL_PDF_MIME_TYPE,
          'X-Original-Filename': 'private_doc.pdf',
        },
        rawBody: pdfBytes,
      },
      res,
      {
        verifyIdToken: harness.verifyIdToken,
        adminRepository: harness.adminRepository,
        receiptStore: harness.receiptStore,
        writeCoordinator: harness.writeCoordinator,
        clock: harness.clock,
      }
    );

    assert(res.statusCode === 201, 'Expected 201');
    const serialized = JSON.stringify(res.jsonBody);

    for (const forbiddenSubstring of [
      'library/quarantine/',
      'source.pdf',
      'source.docx',
      LIBRARY_QUARANTINE_DEDICATED_BUCKET_NAME,
      FORBIDDEN_DEFAULT_FIREBASE_STORAGE_BUCKET_NAME,
      'storagePath',
      'attestedGeneration',
      '"generation"',
      'publicUrl',
      'signedUrl',
      'downloadUrl',
      'downloadToken',
      'firebaseStorageDownloadTokens',
      'valid-curator-token',
    ]) {
      assert(
        !serialized.includes(forbiddenSubstring),
        `Response body must never leak "${forbiddenSubstring}": ${serialized}`
      );
    }

    const adminReceipt = res.jsonBody?.adminReceipt as Record<string, unknown>;
    assert(
      res.jsonBody?.isSanitized === false &&
        res.jsonBody?.isVerifiedSafe === false &&
        res.jsonBody?.isRightsApproved === false &&
        res.jsonBody?.isPublished === false &&
        res.jsonBody?.isReadyForPeia === false &&
        adminReceipt.isSanitized === false &&
        adminReceipt.isVerifiedSafe === false &&
        adminReceipt.isRightsApproved === false &&
        adminReceipt.isPublished === false &&
        adminReceipt.isReadyForPeia === false,
      'All sanitization, verification, rights, publication, and PEIA flags must remain false'
    );
  });

  await test('12. Firebase Functions v2 onRequest registration, index.ts export, and read-only baseline SHA-1 integrity', async () => {
    assert(
      typeof libraryQuarantineUploadEndpoint === 'function' &&
        recordedOnRequestDefinitions.length >= 1,
      'libraryQuarantineUploadEndpoint must be registered via Firebase Functions v2 onRequest'
    );
    const endpointOpts = recordedOnRequestDefinitions[0].options;
    assert(
      endpointOpts.cors === false &&
        endpointOpts.maxInstances === 10 &&
        endpointOpts.memory === '512MiB' &&
        endpointOpts.timeoutSeconds === 60,
      `Unexpected onRequest options: ${JSON.stringify(endpointOpts)}`
    );

    const indexSource = fs.readFileSync('functions/src/index.ts', 'utf8');
    assert(
      indexSource.includes(
        'export { libraryQuarantineUploadEndpoint } from "./library/libraryQuarantineUploadEndpoint";'
      ),
      'functions/src/index.ts must export libraryQuarantineUploadEndpoint'
    );

    // Verify all read-only files remain untouched with exact preflight Git blob SHA-1s
    const readOnlyExpectedSha1s: ReadonlyArray<{
      readonly path: string;
      readonly sha1: string;
    }> = [
      {
        path: 'functions/src/library/libraryQuarantineReceiptContract.ts',
        sha1: '4b4d5f32e5903def3a3b0dcdecd45e38083f91bb',
      },
      {
        path: 'functions/src/library/firestoreLibraryQuarantineReceiptStore.ts',
        sha1: 'd9f4114222851c62c25574efbb0ffbeeb5c355e2',
      },
      {
        path: 'functions/src/library/gcsLibraryQuarantineStorageAdapter.ts',
        sha1: '73d6ea3f117cc23cd418b839680870a2137700ae',
      },
      {
        path: 'functions/src/library/libraryQuarantineWriteCoordinator.ts',
        sha1: '8f0343e72eae11158d6516d1baa6af99dca5c22a',
      },
      {
        path: 'functions/src/library/libraryQuarantineRecoveryCoordinator.ts',
        sha1: 'c2105cb5c12fc27e258943374313ad9b1f1c0e9d',
      },
      {
        path: 'functions/src/library/libraryAdminHandlers.ts',
        sha1: 'e8711ca2c4430fa4ea53d1e5c1005890ef33a479',
      },
      {
        path: 'functions/src/news/editorialNewsImageUploadEndpoint.ts',
        sha1: '2db26ba041c5d313f5c7d22ef328757a4a37ae55',
      },
    ];

    for (const item of readOnlyExpectedSha1s) {
      const buf = fs.readFileSync(item.path);
      const header = Buffer.from(`blob ${buf.length}\0`, 'utf8');
      const actualSha1 = createHash('sha1')
        .update(header)
        .update(buf)
        .digest('hex');
      assert(
        actualSha1 === item.sha1,
        `Read-only file ${item.path} SHA-1 mismatch: expected ${item.sha1}, got ${actualSha1}`
      );
    }
  });

  console.log('------------------------------------------------------------');
  console.log(
    `LIBRARY QUARANTINE UPLOAD ENDPOINT TESTS: ${passedCount}/${passedCount + failedCount} PASSED`
  );
  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
