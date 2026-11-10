import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

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
        onRequest: (_opts: unknown, handler: unknown) => handler,
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
    if (request === 'firebase-admin/auth') {
      return {
        getAuth: () => {
          throw new Error(
            'Uninjected live getAuth() must not be called in headless backend tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/firestore') {
      return {
        getFirestore: () => {
          throw new Error(
            'Uninjected live getFirestore() must not be called in headless backend tests.'
          );
        },
      };
    }
    if (request === 'firebase-admin/storage') {
      return {
        getStorage: () => {
          throw new Error(
            'Uninjected live getStorage() must not be called in headless backend tests.'
          );
        },
      };
    }
    throw err;
  }
};

import { AdminRole, AdminPermission, type AdminUser } from '../functions/src/types/admin';
import { LibraryQuarantineBinarySafetyCaseService } from '../functions/src/library/libraryQuarantineBinarySafetyCaseService';

const {
  LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR,
} = require('../functions/src/library/libraryAdminHandlers') as typeof import('../functions/src/library/libraryAdminHandlers');

class InMemoryBinarySafetyDatabase {
  private store: Map<string, any> = new Map();
  public pointGetCalls = 0;
  public transactionCount = 0;

  public resetCounters(): void {
    this.pointGetCalls = 0;
    this.transactionCount = 0;
  }

  public seedDoc(collection: string, docId: string, data: any): void {
    this.store.set(`${collection}/${docId}`, data);
  }

  public collection(name: string) {
    return {
      doc: (docId: string) => {
        const path = `${name}/${docId}`;
        return {
          get: async () => {
            this.pointGetCalls += 1;
            const data = this.store.get(path);
            return {
              exists: data !== undefined,
              data: () => data,
            };
          },
        };
      },
    };
  }

  public async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const tx = {
      get: async (ref: any) => {
        this.pointGetCalls += 1;
        return ref.get();
      },
      create: (ref: any, data: any) => {
        // Mock write
      },
      set: (ref: any, data: any) => {
        // Mock write
      },
    };
    return updateFunction(tx);
  }
}

class InMemoryAdminRepo {
  constructor(private admins: AdminUser[]) {}
  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    return this.admins.find((a) => a.uid === uid) || null;
  }
  async listAdmins(): Promise<AdminUser[]> {
    return this.admins;
  }
}

const ownerAdmin: AdminUser = Object.freeze({
  id: 'owner_01',
  uid: 'owner_01',
  name: 'Owner Admin',
  email: 'owner@planet.org',
  role: AdminRole.Owner,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const curatorAdmin: AdminUser = Object.freeze({
  id: 'curator_01',
  uid: 'curator_01',
  name: 'Curator Admin',
  email: 'curator@planet.org',
  role: AdminRole.Curator,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function runTests() {
  console.log('STARTING LIB-FILE-BINARY-SAFETY-CASE-01 BACKEND TESTS...');

  const receiptId = '0123456789abcdef0123456789abcdef';
  const documentId = `qcat-${receiptId}`;

  const db = new InMemoryBinarySafetyDatabase();
  const adminRepo = new InMemoryAdminRepo([ownerAdmin, curatorAdmin]);

  // Seed required chain for 7 point reads
  db.seedDoc('library_quarantine_receipts', receiptId, {
    schemaVersion: 1,
    receiptId,
    documentId,
    revision: 1,
    updatedAt: '2026-11-10T10:00:00.000Z',
    sha256: 'a'.repeat(64),
    receipt: { sourceFormat: 'pdf', deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER' },
  });
  db.seedDoc('library_quarantine_review_drafts', receiptId, {
    schemaVersion: 1,
    receiptId,
    sourceRevision: 1,
  });
  db.seedDoc('library_quarantine_human_review_cases', receiptId, {
    schemaVersion: 1,
    receiptId,
    status: 'METADATA_RECORDED',
    revision: 1,
    updatedAt: '2026-11-10T10:00:00.000Z',
  });
  db.seedDoc('library_quarantine_catalog_handoffs', receiptId, {
    schemaVersion: 1,
    receiptId,
    sourceRevision: 1,
    sourceUpdatedAt: '2026-11-10T10:00:00.000Z',
    createdAt: '2026-11-10T10:00:00.000Z',
  });
  db.seedDoc('library_documents', documentId, {
    id: documentId,
    titleAr: 'اختبار',
    titleEn: 'Test',
  });
  db.seedDoc('library_quarantine_catalog_case_alignments', receiptId, {
    schemaVersion: 1,
    receiptId,
    alignmentRevision: 1,
  });

  // Test 1: Owner role can access getQuarantineBinarySafetyCase when release gate enabled
  process.env[LIBRARY_BINARY_SAFETY_CASE_RELEASE_ENV_VAR] = 'true';
  const service = new LibraryQuarantineBinarySafetyCaseService({
    trustedPrincipalProvider: {
      resolveAuthenticatedPrincipal: () => ({ uid: ownerAdmin.uid }),
    },
    adminRepository: adminRepo,
    db: db as any,
  });

  const getRes = await service.getQuarantineBinarySafetyCase({ receiptId });
  assert.equal(getRes.ok, true);
  if (getRes.ok) {
    assert.equal(getRes.outcome, 'READY');
    assert.equal(getRes.sourceFormat, 'pdf');
  }

  // Test 2: Non-owner (Curator) is denied
  const curatorService = new LibraryQuarantineBinarySafetyCaseService({
    trustedPrincipalProvider: {
      resolveAuthenticatedPrincipal: () => ({ uid: curatorAdmin.uid }),
    },
    adminRepository: adminRepo,
    db: db as any,
  });

  await assert.rejects(async () => {
    await curatorService.getQuarantineBinarySafetyCase({ receiptId });
  }, (err: any) => {
    assert.equal(err.code, 'permission-denied');
    return true;
  });

  // Test 3: Save valid binary safety case
  const saveRes = await service.saveQuarantineBinarySafetyCase({
    receiptId,
    expectedRevision: 0,
    input: {
      disposition: 'ISOLATED_ASSESSMENT_REQUIRED',
      evidenceReference: 'TICKET-101',
      evidenceNotes: 'Sent to isolated PDF parser sandbox.',
      reviewNotes: 'Pending parser attestation.',
    },
  });
  assert.equal(saveRes.ok, true);
  if (saveRes.ok) {
    assert.equal(saveRes.outcome, 'SAVED');
    assert.equal(saveRes.revision, 1);
  }

  console.log('ALL LIB-FILE-BINARY-SAFETY-CASE-01 BACKEND TESTS PASSED (3/3).');
}

runTests().catch((err) => {
  console.error('Backend tests failed:', err);
  process.exit(1);
});
