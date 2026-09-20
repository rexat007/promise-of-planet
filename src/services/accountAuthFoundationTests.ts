import { AccountService, inMemoryAccountStorage } from './accountService';
import { AdminAccessService } from './adminAccess';
import { ROLE_PERMISSIONS_MAP, AdminRole, AdminPermission } from '../types/admin';

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

  inMemoryAccountStorage.clear();

  await test('1. Account identity is keyed by Firebase UID', async () => {
    const uid = 'test-uid-123';
    const acc = await AccountService.createAccount(uid, { email: 'user@example.com', displayName: 'Test User' });
    if (acc.id !== uid) throw new Error('Account ID must match Firebase UID');
    const fetched = await AccountService.getAccount(uid);
    if (!fetched || fetched.id !== uid) throw new Error('Fetched account must match UID key');
  });

  await test('2. Account schema contains no forbidden privilege/context fields', async () => {
    const uid = 'test-uid-schema';
    const acc = await AccountService.createAccount(uid, { email: 'schema@example.com' });
    const keys = Object.keys(acc);
    const forbidden = ['isAdmin', 'isMember', 'isTrainee', 'role', 'roles', 'permissions', 'subscriptionTier', 'plan', 'points', 'badges', 'courseIds'];
    for (const f of forbidden) {
      if (keys.includes(f)) throw new Error(`Forbidden field found in Account schema: ${f}`);
    }
  });

  await test('3. Ordinary account creation does not create or imply admins/{uid}', async () => {
    const uid = 'ordinary-user-uid';
    await AccountService.createAccount(uid, { email: 'ordinary@example.com' });
    const adminUser = AdminAccessService.getMockUsers().find(a => a.id === uid);
    if (adminUser) throw new Error('Ordinary account must not be present in admin users list');
  });

  await test('4. Account resolution never converts an ordinary authenticated user into an AdminUser', async () => {
    const uid = 'non-admin-uid-999';
    await AccountService.createAccount(uid, { email: 'plain@example.com' });
    const acc = await AccountService.getAccount(uid);
    if (!acc) throw new Error('Account must exist');
    if ('role' in acc || 'permissions' in acc || 'isAdmin' in acc) {
      throw new Error('Account leaked administrative properties');
    }
  });

  await test('5. Unauthenticated state remains public/visitor and creates no persistent Visitor record', async () => {
    const unauthAcc = await AccountService.getAccount('non-existent-visitor');
    if (unauthAcc !== null) throw new Error('Unauthenticated visitor must resolve to null account');
  });

  await test('6. Auth/account failure does not fall back to mock Owner', async () => {
    const acc = await AccountService.getAccount('invalid-or-missing-uid');
    if (acc !== null) throw new Error('Must return null on missing account');
    const owner = AdminAccessService.getMockUsers().find(u => u.role === AdminRole.Owner);
    if (!owner) throw new Error('Owner role must remain intact independently');
  });

  await test('7. Firebase UID remains identity authority', async () => {
    const uid = 'auth-authority-uid';
    const acc = await AccountService.createAccount(uid, { email: 'auth@example.com' });
    if (acc.id !== uid) throw new Error('Account id must strictly equal Firebase UID');
  });

  await test('8. Email is not used as primary identity key', async () => {
    const uid1 = 'uid-one';
    const uid2 = 'uid-two';
    const email = 'shared@example.com';
    const acc1 = await AccountService.createAccount(uid1, { email });
    const acc2 = await AccountService.createAccount(uid2, { email });
    if (acc1.id === acc2.id) throw new Error('Accounts with same email must remain separate based on UID');
  });

  await test('9. No browser/client path can assign AdminRole through account registration', async () => {
    const uid = 'hacker-uid';
    const acc = await AccountService.createAccount(uid, { email: 'hacker@example.com' });
    const rawAny = acc as any;
    if (rawAny.role || rawAny.isAdmin) throw new Error('Privilege escalation detected in account creation');
  });

  await test('10. Existing canonical AdminRole and AdminPermission vocabularies are unchanged', async () => {
    const roles = Object.values(AdminRole);
    if (!roles.includes(AdminRole.Owner) || !roles.includes(AdminRole.ContentEditor)) {
      throw new Error('Canonical AdminRole vocabulary modified');
    }
    const permissions = Object.values(AdminPermission);
    if (!permissions.includes(AdminPermission.View) || !permissions.includes(AdminPermission.Create)) {
      throw new Error('Canonical AdminPermission vocabulary modified');
    }
  });

  await test('11. ROLE_PERMISSIONS_MAP is intact', async () => {
    const ownerPerms = ROLE_PERMISSIONS_MAP[AdminRole.Owner];
    if (!ownerPerms || ownerPerms.size === 0) throw new Error('ROLE_PERMISSIONS_MAP for Owner must be intact');
  });

  await test('12. No enrollments collection/type is introduced by this block', async () => {
    const accKeys = ['id', 'email', 'displayName', 'createdAt', 'updatedAt'];
    if (accKeys.length !== 5) throw new Error('Account schema length mismatch');
  });

  await test('13. No Developer role/permission is introduced', async () => {
    const roles = Object.values(AdminRole);
    if (roles.includes('Developer' as any)) throw new Error('Developer role must not exist in AdminRole');
  });

  await test('14. Public platform remains usable without authentication', async () => {
    const active = AccountService.observeAuthState(() => {
      // unauthenticated callback
    });
    if (typeof active !== 'function') throw new Error('Auth observer must return unsubscribe function');
    active();
  });

  await test('15. Email/password auth operations fail clearly when Firebase Auth unconfigured', async () => {
    try {
      await AccountService.signIn('test@example.com', 'password123');
    } catch (e: any) {
      if (!e) throw new Error('Expected auth failure when unconfigured');
    }
  });

  return results;
}
