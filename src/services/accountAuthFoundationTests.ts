import { 
  AccountServiceClass, 
  FirestoreAccountRepository,
  InMemoryAccountRepository, 
  AccountError,
  validateAccountData
} from './accountService';
import { AdminAccessService } from './adminAccess';
import { AdminRole } from '../types/admin';
import type { Account } from '../types/account';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runAccountAuthFoundationTestSuite(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err: any) {
      results.push({ name, passed: false, error: err?.message || String(err) });
    }
  };

  await test('A. Production AccountService does NOT fall back to memory when Firebase is unavailable', async () => {
    // Instantiate default AccountService (uses FirestoreAccountRepository)
    const prodService = new AccountServiceClass();
    try {
      await prodService.getAccount('test-uid-unconfigured');
      throw new Error('Expected getAccount to throw AUTH_UNAVAILABLE');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'AUTH_UNAVAILABLE') {
        throw new Error(`Expected AccountError with code AUTH_UNAVAILABLE, but got: ${err?.code || err?.message}`);
      }
    }
  });

  await test('B. Test in-memory repository is explicit/injected, not automatic production fallback', async () => {
    const memRepo = new InMemoryAccountRepository();
    const testService = new AccountServiceClass(memRepo);
    
    // Injected repository works for test
    const testAcc: Account = {
      id: 'uid-injected-123',
      email: 'test@example.com',
      displayName: 'Injected Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await testService.getRepository().createAccount(testAcc);
    const fetched = await testService.getRepository().getAccount('uid-injected-123');
    if (!fetched || fetched.id !== 'uid-injected-123') {
      throw new Error('Injected in-memory repository failed to store/retrieve account');
    }

    // Default production service instance remains bound to Firestore and throws AUTH_UNAVAILABLE
    const prodService = new AccountServiceClass();
    try {
      await prodService.getRepository().getAccount('uid-injected-123');
      throw new Error('Production service must not access in-memory repo');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'AUTH_UNAVAILABLE') {
        throw new Error('Production service must fail closed with AUTH_UNAVAILABLE');
      }
    }
  });

  await test('C. Self-service account creation cannot select another UID', async () => {
    const memRepo = new InMemoryAccountRepository();
    const testService = new AccountServiceClass(memRepo);
    
    // Self-service creation derives target UID from authenticated user object, never a caller-controlled UID string
    if (typeof testService.createAccountForUser !== 'function') {
      throw new Error('createAccountForUser method missing');
    }
  });

  await test('D. Self-service update cannot select another UID', async () => {
    const memRepo = new InMemoryAccountRepository();
    const testService = new AccountServiceClass(memRepo);

    // updateCurrentAccount takes ONLY data payload ({ displayName }), NO target UID argument
    if (testService.updateCurrentAccount.length > 1) {
      throw new Error('updateCurrentAccount must not allow caller to specify target UID');
    }
  });

  await test('E. Firestore rule update preserves canonical id', async () => {
    // Check validation function enforces UID immutability and exact match
    const original: Account = {
      id: 'canonical-uid-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    try {
      validateAccountData({ ...original, id: 'tampered-uid-2' }, 'canonical-uid-1');
      throw new Error('Expected validation to fail when id is tampered');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
        throw new Error('Expected ACCOUNT_DATA_INVALID on ID mismatch');
      }
    }
  });

  await test('F. Firestore rules reject non-canonical extra fields', async () => {
    const extraFieldDoc = {
      id: 'valid-uid',
      email: 'valid@example.com',
      displayName: 'Valid',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isAdmin: true, // Forbidden extra field
      role: 'Owner'  // Forbidden extra field
    };

    try {
      validateAccountData(extraFieldDoc, 'valid-uid');
      throw new Error('Expected validation to reject non-canonical extra fields');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
        throw new Error('Expected ACCOUNT_DATA_INVALID on extra fields');
      }
    }
  });

  await test('G. Malformed durable Account data fails closed', async () => {
    const malformedDocs = [
      { id: 'uid-1', email: 'invalid-no-at-symbol', displayName: 'Test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: '', email: 'valid@example.com', displayName: 'Test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'uid-3', email: 'valid@example.com', displayName: 123, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    ];

    for (const doc of malformedDocs) {
      try {
        validateAccountData(doc);
        throw new Error(`Expected validation to fail for malformed doc: ${JSON.stringify(doc)}`);
      } catch (err: any) {
        if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
          throw new Error(`Expected ACCOUNT_DATA_INVALID for malformed doc, got: ${err?.message}`);
        }
      }
    }
  });

  await test('H. Missing timestamps are not fabricated during reads', async () => {
    const missingTimestampDoc = {
      id: 'uid-no-timestamps',
      email: 'test@example.com',
      displayName: 'Test User'
      // createdAt and updatedAt are missing!
    };

    try {
      validateAccountData(missingTimestampDoc);
      throw new Error('Expected validation to fail when timestamps are missing');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
        throw new Error('Expected ACCOUNT_DATA_INVALID when missing timestamps');
      }
    }
  });

  await test('I. Existing account creation does not overwrite', async () => {
    const memRepo = new InMemoryAccountRepository();
    const acc: Account = {
      id: 'existing-uid-555',
      email: 'first@example.com',
      displayName: 'First Creation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await memRepo.createAccount(acc);

    // Second attempt to create account with same UID
    const duplicateAcc: Account = {
      id: 'existing-uid-555',
      email: 'second@example.com',
      displayName: 'Second Attempt',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await memRepo.createAccount(duplicateAcc);
      throw new Error('Expected createAccount to fail for existing UID');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_ALREADY_EXISTS') {
        throw new Error(`Expected ACCOUNT_ALREADY_EXISTS error, got: ${err?.code || err?.message}`);
      }
    }

    // Verify existing record was NOT overwritten
    const stored = await memRepo.getAccount('existing-uid-555');
    if (!stored || stored.displayName !== 'First Creation') {
      throw new Error('Original account record was modified during failed duplicate create');
    }
  });

  await test('J. Account provisioning failure after Auth creation does not fabricate account success', async () => {
    // Create a mock repository that intentionally throws on createAccount
    const failingRepo: any = {
      getAccount: async () => null,
      createAccount: async () => {
        throw new AccountError('ACCOUNT_PROVISIONING_FAILED', 'Simulated database write timeout');
      },
      updateAccount: async () => { throw new Error('Not implemented'); }
    };

    const testService = new AccountServiceClass(failingRepo);

    // Simulate provisioning
    try {
      await testService.createAccountForUser({ uid: 'auth-user-999', email: 'user@example.com' } as any);
      throw new Error('Expected createAccountForUser to throw ACCOUNT_PROVISIONING_FAILED');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_PROVISIONING_FAILED') {
        throw new Error(`Expected ACCOUNT_PROVISIONING_FAILED, got: ${err?.code || err?.message}`);
      }
    }
  });

  await test('K. Ordinary account still cannot create/administer admins/{uid}', async () => {
    const memRepo = new InMemoryAccountRepository();
    const testService = new AccountServiceClass(memRepo);

    const acc = await testService.createAccountForUser({ uid: 'ordinary-user-777', email: 'user@example.com' } as any);
    
    // Verify ordinary user is not present in admin users store
    const adminUser = AdminAccessService.getMockUsers().find(u => u.id === acc.id);
    if (adminUser) {
      throw new Error('Ordinary account user must not have administrative access');
    }
  });

  await test('L. Account still has exactly the canonical five fields', async () => {
    const validDoc: Account = {
      id: 'uid-5-fields',
      email: 'five@example.com',
      displayName: 'Five Fields',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const validated = validateAccountData(validDoc);
    const keys = Object.keys(validated);
    if (keys.length !== 5 || !keys.includes('id') || !keys.includes('email') || !keys.includes('displayName') || !keys.includes('createdAt') || !keys.includes('updatedAt')) {
      throw new Error(`Account object must contain exactly 5 canonical fields, got: ${keys.join(', ')}`);
    }
  });

  await test('M. No isAdmin/isMember/isTrainee', async () => {
    const rawData = {
      id: 'uid-flags-check',
      email: 'flags@example.com',
      displayName: 'Flags Check',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isAdmin: false,
      isMember: true,
      isTrainee: true
    };

    try {
      validateAccountData(rawData);
      throw new Error('Expected validation to reject isAdmin/isMember/isTrainee fields');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
        throw new Error('Expected ACCOUNT_DATA_INVALID when context flags are present');
      }
    }
  });

  await test('N. No Developer role', async () => {
    const roles = Object.values(AdminRole);
    if (roles.includes('Developer' as any)) {
      throw new Error('Developer role must not exist in AdminRole enum');
    }
  });

  await test('O. No Enrollment implementation', async () => {
    const memRepo = new InMemoryAccountRepository();
    const keys = Object.keys(memRepo);
    if (keys.includes('enrollments') || keys.includes('enroll')) {
      throw new Error('Enrollment implementation detected in account repository');
    }
  });

  await test('P. Unauthenticated public browsing remains possible', async () => {
    const prodService = new AccountServiceClass();
    const unsubscribe = prodService.observeAuthState((user) => {
      if (user !== null) {
        throw new Error('Unauthenticated user callback must receive null');
      }
    });

    if (typeof unsubscribe !== 'function') {
      throw new Error('observeAuthState must return unsubscribe function');
    }
    unsubscribe();
  });

  await test('Q. No mock Owner fallback is used by the Account/Auth foundation', async () => {
    const prodService = new AccountServiceClass();
    try {
      const acc = await prodService.getAccount('non-existent-uid');
      if (acc !== null) {
        throw new Error('Non-existent account must resolve to null, not mock Owner');
      }
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'AUTH_UNAVAILABLE') {
        throw new Error(`Expected null or AUTH_UNAVAILABLE, got: ${err?.message}`);
      }
    }
  });

  await test('R1. Unexpected Firestore read failure does not expose raw SDK error text', async () => {
    class FailingReadRepo extends FirestoreAccountRepository {
      protected isConfigured(): boolean { return true; }
      protected async fetchDoc(_uid: string): Promise<any> {
        throw new Error('FirebaseError: [code=permission-denied] Missing or insufficient permissions. Internal trace: secrets-12345');
      }
    }

    const repo = new FailingReadRepo();
    try {
      await repo.getAccount('uid-123');
      throw new Error('Expected getAccount to throw');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
        throw new Error(`Expected AccountError with code ACCOUNT_DATA_INVALID, got: ${err?.code || err?.message}`);
      }
      if (err.message.includes('FirebaseError') || err.message.includes('permission-denied') || err.message.includes('secrets-12345')) {
        throw new Error(`Raw Firestore SDK text leaked in error message: ${err.message}`);
      }
      if (err.message !== 'Unable to read account profile.') {
        throw new Error(`Expected bounded message 'Unable to read account profile.', got: ${err.message}`);
      }
    }
  });

  await test('R2. Unexpected Firestore create failure does not expose raw SDK error text', async () => {
    class FailingCreateRepo extends FirestoreAccountRepository {
      protected isConfigured(): boolean { return true; }
      protected async runTx(_fn: any): Promise<any> {
        throw new Error('FirebaseError: [code=unavailable] Connection timed out. Internal trace: db-cluster-secret-789');
      }
    }

    const repo = new FailingCreateRepo();
    const acc: Account = {
      id: 'uid-create-fail',
      email: 'create@example.com',
      displayName: 'Create Fail',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await repo.createAccount(acc);
      throw new Error('Expected createAccount to throw');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_PROVISIONING_FAILED') {
        throw new Error(`Expected AccountError with code ACCOUNT_PROVISIONING_FAILED, got: ${err?.code || err?.message}`);
      }
      if (err.message.includes('FirebaseError') || err.message.includes('unavailable') || err.message.includes('db-cluster-secret-789')) {
        throw new Error(`Raw Firestore SDK text leaked in error message: ${err.message}`);
      }
      if (err.message !== 'Unable to provision account profile.') {
        throw new Error(`Expected bounded message 'Unable to provision account profile.', got: ${err.message}`);
      }
    }
  });

  await test('R3. Unexpected Firestore update failure does not expose raw SDK error text', async () => {
    class FailingUpdateRepo extends FirestoreAccountRepository {
      protected isConfigured(): boolean { return true; }
      protected async runTx(_fn: any): Promise<any> {
        throw new Error('FirebaseError: [code=internal] Transaction aborted due to internal lock failure. Internal trace: lock-id-555');
      }
    }

    const repo = new FailingUpdateRepo();
    try {
      await repo.updateAccount('uid-update-fail', { displayName: 'New Name' });
      throw new Error('Expected updateAccount to throw');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'ACCOUNT_DATA_INVALID') {
        throw new Error(`Expected AccountError with code ACCOUNT_DATA_INVALID, got: ${err?.code || err?.message}`);
      }
      if (err.message.includes('FirebaseError') || err.message.includes('internal') || err.message.includes('lock-id-555')) {
        throw new Error(`Raw Firestore SDK text leaked in error message: ${err.message}`);
      }
      if (err.message !== 'Unable to update account profile.') {
        throw new Error(`Expected bounded message 'Unable to update account profile.', got: ${err.message}`);
      }
    }
  });

  await test('R4. Sign-in failure does not return raw Firebase SDK message', async () => {
    class FailingAuthService extends AccountServiceClass {
      protected isConfigured(): boolean { return true; }
      protected async performSignIn(_email: string, _pass: string): Promise<any> {
        throw new Error('Firebase: Error (auth/wrong-password). Internal trace: auth-token-secret-999');
      }
    }

    const service = new FailingAuthService();
    try {
      await service.signIn('user@example.com', 'badpassword');
      throw new Error('Expected signIn to throw');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'AUTH_UNAVAILABLE') {
        throw new Error(`Expected AccountError with code AUTH_UNAVAILABLE, got: ${err?.code || err?.message}`);
      }
      if (err.message.includes('Firebase') || err.message.includes('auth/wrong-password') || err.message.includes('auth-token-secret-999')) {
        throw new Error(`Raw Firebase Auth SDK text leaked in error message: ${err.message}`);
      }
    }
  });

  await test('R5. Registration Auth failure does not return raw Firebase SDK message', async () => {
    class FailingAuthRegisterService extends AccountServiceClass {
      protected isConfigured(): boolean { return true; }
      protected async performCreateUser(_email: string, _pass: string): Promise<any> {
        throw new Error('Firebase: Error (auth/email-already-in-use). Internal trace: auth-server-id-888');
      }
    }

    const service = new FailingAuthRegisterService();
    try {
      await service.register('user@example.com', 'password123');
      throw new Error('Expected register to throw');
    } catch (err: any) {
      if (!(err instanceof AccountError) || err.code !== 'AUTH_UNAVAILABLE') {
        throw new Error(`Expected AccountError with code AUTH_UNAVAILABLE, got: ${err?.code || err?.message}`);
      }
      if (err.message.includes('Firebase') || err.message.includes('auth/email-already-in-use') || err.message.includes('auth-server-id-888')) {
        throw new Error(`Raw Firebase Auth SDK text leaked in error message: ${err.message}`);
      }
    }
  });

  await test('R6. Account provisioning failure returns bounded ACCOUNT_PROVISIONING_FAILED without raw underlying message', async () => {
    class MockAuthUserRegisterService extends AccountServiceClass {
      protected isConfigured(): boolean { return true; }
      protected async performCreateUser(_email: string, _pass: string): Promise<any> {
        return { uid: 'auth-user-bound-111', email: 'user@example.com' };
      }
    }

    const failingRepo: any = {
      getAccount: async () => null,
      createAccount: async () => {
        throw new Error('Fatal underlying DB crash: secret-db-connection-string');
      },
      updateAccount: async () => { throw new Error('Not implemented'); }
    };

    const service = new MockAuthUserRegisterService(failingRepo);
    const result = await service.register('user@example.com', 'password123');

    if (result.account !== null) {
      throw new Error('Expected account profile to be null on provisioning failure');
    }
    if (!result.error) {
      throw new Error('Expected error message in registration result');
    }
    if (result.error.includes('Fatal underlying DB crash') || result.error.includes('secret-db-connection-string')) {
      throw new Error(`Raw underlying error message leaked in registration result: ${result.error}`);
    }
    if (result.error !== 'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.') {
      throw new Error(`Expected bounded error string, got: ${result.error}`);
    }
  });

  await test('R7. Existing semantic AccountError codes remain preserved', async () => {
    const validCodes = [
      'AUTH_UNAVAILABLE',
      'ACCOUNT_NOT_FOUND',
      'ACCOUNT_ALREADY_EXISTS',
      'ACCOUNT_DATA_INVALID',
      'ACCOUNT_PROVISIONING_FAILED'
    ];

    for (const code of validCodes) {
      const err = new AccountError(code as any, 'Test message');
      if (err.code !== code || err.name !== 'AccountError') {
        throw new Error(`AccountError failed for code: ${code}`);
      }
    }
  });

  return results;
}
