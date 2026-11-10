import assert from 'node:assert/strict';
import process from 'node:process';
import {
  LibraryQuarantineBinarySafetyCaseController,
  isLibraryQuarantineBinarySafetyCaseEnabled,
  canUserManageBinarySafetyCases,
} from '../src/services/libraryQuarantineBinarySafetyCaseClient';
import { AdminRole, AdminPermission, type AdminUser } from '../src/types/admin';

const ownerUser: AdminUser = Object.freeze({
  id: 'owner_01',
  uid: 'owner_01',
  name: 'Owner Admin',
  email: 'owner@planet.org',
  role: AdminRole.Owner,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const curatorUser: AdminUser = Object.freeze({
  id: 'curator_01',
  uid: 'curator_01',
  name: 'Curator Admin',
  email: 'curator@planet.org',
  role: AdminRole.Curator,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function runClientTests() {
  console.log('STARTING LIB-FILE-BINARY-SAFETY-CASE-01 CLIENT TESTS...');

  const receiptId = '0123456789abcdef0123456789abcdef';

  // Test 1: RBAC check for owner vs curator
  assert.equal(canUserManageBinarySafetyCases(ownerUser), true);
  assert.equal(canUserManageBinarySafetyCases(curatorUser), false);
  assert.equal(canUserManageBinarySafetyCases(null), false);

  // Test 2: Feature flag check with envOverride
  const mockEnv = {
    VITE_LIBRARY_REVIEW_WORKBENCH_ENABLED: 'true',
    VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED: 'true',
    VITE_LIBRARY_CATALOG_HANDOFF_ENABLED: 'true',
    VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED: 'true',
  };

  assert.equal(isLibraryQuarantineBinarySafetyCaseEnabled(mockEnv), true);
  assert.equal(isLibraryQuarantineBinarySafetyCaseEnabled({}), false);

  const controller = new LibraryQuarantineBinarySafetyCaseController(receiptId, {
    envOverride: mockEnv,
    invokeCallable: async (action, data) => {
      if (action === 'getQuarantineBinarySafetyCase') {
        return {
          ok: true,
          outcome: 'READY',
          receiptId,
          documentId: `qcat-${receiptId}`,
          currentRevision: 0,
          isCaseCurrent: true,
          requiresFreshEvidence: false,
          sourceFormat: 'pdf',
          deepInspectionStatus: 'PDF_REQUIRES_ISOLATED_PARSER',
          readiness: {
            binarySafety: 'NOT_VERIFIED',
            fileSanitization: 'NOT_PERFORMED',
            publication: 'BLOCKED',
            catalogWorkflow: 'Draft',
          },
          binarySafetyCase: null,
        };
      }
      return { ok: false };
    },
  });

  await controller.loadCase();
  const state = controller.getState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.snapshot?.sourceFormat, 'pdf');

  console.log('ALL LIB-FILE-BINARY-SAFETY-CASE-01 CLIENT TESTS PASSED.');
}

runClientTests().catch((err) => {
  console.error('Client tests failed:', err);
  process.exit(1);
});
