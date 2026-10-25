import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { User } from 'firebase/auth';
import {
  AccountServiceClass,
  InMemoryAccountRepository,
  AccountError,
  NEUTRAL_PASSWORD_RESET_MESSAGES,
  validateAccountDisplayNameUpdate
} from './accountService';
import {
  FORGOT_PASSWORD_ACTION_LABELS,
  getSafeWidgetErrorMessage
} from '../components/auth/AccountAuthWidget';
import { Account } from '../types/account';

class TestablePasswordAndProfileAccountService extends AccountServiceClass {
  public simulatedUser: User | null = null;
  public createUserCallCount = 0;
  public resetCallEmails: string[] = [];
  public onPerformPasswordReset?: (email: string) => Promise<void>;

  protected isConfigured(): boolean {
    return true;
  }

  protected getAuthenticatedUser(): User | null {
    return this.simulatedUser;
  }

  protected async performCreateUser(email: string, _password: string): Promise<User> {
    this.createUserCallCount += 1;
    const createdUser = {
      uid: `uid-${email.split('@')[0].toLowerCase()}`,
      email: email.trim().toLowerCase(),
      displayName: null
    } as unknown as User;
    this.simulatedUser = createdUser;
    return createdUser;
  }

  protected async performPasswordReset(email: string): Promise<void> {
    this.resetCallEmails.push(email);
    if (this.onPerformPasswordReset) {
      await this.onPerformPasswordReset(email);
    }
  }
}

describe('AUTH-02B1: Password Recovery & Public Account Profile Management', () => {
  let repo: InMemoryAccountRepository;
  let service: TestablePasswordAndProfileAccountService;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    service = new TestablePasswordAndProfileAccountService(repo);
  });

  // 1. forgot-password action is available from sign-in state
  it('1. exposes bilingual forgot-password action from the sign-in view and switches to reset mode without creating accounts', () => {
    expect(FORGOT_PASSWORD_ACTION_LABELS.ar).toBe('نسيت كلمة المرور؟');
    expect(FORGOT_PASSWORD_ACTION_LABELS.en).toBe('Forgot password?');

    const widgetSource = readFileSync(
      resolve(__dirname, '../components/auth/AccountAuthWidget.tsx'),
      'utf8'
    );
    expect(widgetSource).toContain("mode === 'signin'");
    expect(widgetSource).toContain("setMode('reset')");
    expect(widgetSource).toContain('FORGOT_PASSWORD_ACTION_LABELS');
    expect(widgetSource).toContain('AccountService.requestPasswordReset(email)');
  });

  // 2. invalid email is rejected before password reset call
  it('2. rejects empty or malformed email locally before invoking Firebase password reset mechanism', async () => {
    await expect(service.requestPasswordReset('')).rejects.toMatchObject({
      code: 'ACCOUNT_DATA_INVALID'
    });
    await expect(service.requestPasswordReset('   ')).rejects.toMatchObject({
      code: 'ACCOUNT_DATA_INVALID'
    });
    await expect(service.requestPasswordReset('not-an-email')).rejects.toMatchObject({
      code: 'ACCOUNT_DATA_INVALID'
    });
    await expect(service.requestPasswordReset('missing-domain@')).rejects.toMatchObject({
      code: 'ACCOUNT_DATA_INVALID'
    });

    expect(service.resetCallEmails).toHaveLength(0);
  });

  // 3. valid password reset request calls Firebase reset mechanism once
  it('3. invokes the Firebase password reset mechanism once with trimmed normalized email and deduplicates concurrent in-flight submissions', async () => {
    let resolveReset!: () => void;
    service.onPerformPasswordReset = () =>
      new Promise<void>((res) => {
        resolveReset = res;
      });

    const p1 = service.requestPasswordReset('  Reader@Example.com  ');
    const p2 = service.requestPasswordReset('reader@example.com');

    resolveReset();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(service.resetCallEmails).toEqual(['reader@example.com']);
    expect(r1.email).toBe('reader@example.com');
    expect(r2.email).toBe('reader@example.com');
  });

  // 4. password reset response uses a neutral non-enumerating success message
  it('4. returns the identical neutral non-enumerating confirmation whether or not the email has a Firebase account', async () => {
    // Case A: Existing user
    service.onPerformPasswordReset = async () => {};
    const existingResult = await service.requestPasswordReset('existing@example.com');

    // Case B: Non-existent user (Firebase throws auth/user-not-found)
    service.onPerformPasswordReset = async () => {
      const err: any = new Error('Firebase: Error (auth/user-not-found).');
      err.code = 'auth/user-not-found';
      throw err;
    };
    const missingResult = await service.requestPasswordReset('unknown@example.com');

    expect(existingResult.messageAr).toBe(NEUTRAL_PASSWORD_RESET_MESSAGES.ar);
    expect(existingResult.messageEn).toBe(NEUTRAL_PASSWORD_RESET_MESSAGES.en);
    expect(missingResult.messageAr).toBe(existingResult.messageAr);
    expect(missingResult.messageEn).toBe(existingResult.messageEn);
    expect(existingResult.messageEn.toLowerCase()).toContain('if an account is associated');
  });

  // 5. rate-limit / network error returns safe actionable failure
  it('5. maps rate-limit and network failures to safe actionable AccountErrors and UI messages without leaking tokens or internals', async () => {
    service.onPerformPasswordReset = async () => {
      const err: any = new Error('Firebase: Too many requests (auth/too-many-requests). token=secret123');
      err.code = 'auth/too-many-requests';
      throw err;
    };

    let caughtRateLimit: AccountError | null = null;
    try {
      await service.requestPasswordReset('user@example.com');
    } catch (e: any) {
      caughtRateLimit = e;
    }

    expect(caughtRateLimit).toBeInstanceOf(AccountError);
    expect(caughtRateLimit?.code).toBe('PASSWORD_RESET_RATE_LIMITED');
    expect(caughtRateLimit?.message).not.toContain('secret123');
    expect(getSafeWidgetErrorMessage(caughtRateLimit, false)).toContain('Too many password reset requests');
    expect(getSafeWidgetErrorMessage(caughtRateLimit, true)).toContain('تم تجاوز الحد المسموح');

    service.onPerformPasswordReset = async () => {
      const err: any = new Error('Firebase: Network failure (auth/network-request-failed).');
      err.code = 'auth/network-request-failed';
      throw err;
    };

    let caughtNetwork: AccountError | null = null;
    try {
      await service.requestPasswordReset('user@example.com');
    } catch (e: any) {
      caughtNetwork = e;
    }

    expect(caughtNetwork).toBeInstanceOf(AccountError);
    expect(caughtNetwork?.code).toBe('PASSWORD_RESET_NETWORK_ERROR');
    expect(getSafeWidgetErrorMessage(caughtNetwork, false)).toContain('Network error');
    expect(getSafeWidgetErrorMessage(caughtNetwork, true)).toContain('حدث خطأ في الشبكة');
  });

  // 6. password reset does not create a Firebase account or accounts/{uid} document
  it('6. does not create a Firebase user or any accounts/{uid} document when requesting a password reset', async () => {
    service.onPerformPasswordReset = async () => {};

    await service.requestPasswordReset('visitor@example.com');

    expect(service.createUserCallCount).toBe(0);
    expect(await repo.getAccount('visitor@example.com')).toBeNull();
    expect(await repo.getAccount('uid-visitor')).toBeNull();
  });

  // 7. signed-in user with valid accounts/{uid} can update displayName
  it('7. allows a signed-in user with a provisioned accounts/{uid} document to update their displayName trimmed cleanly', async () => {
    const uid = 'uid-provisioned-7';
    await repo.createAccount({
      id: uid,
      email: 'member@example.com',
      displayName: 'Original Name',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z'
    });

    service.simulatedUser = {
      uid,
      email: 'member@example.com',
      displayName: 'Original Name'
    } as unknown as User;

    const updated = await service.updateCurrentAccount({
      displayName: '  Updated Member Name  '
    });

    expect(updated.displayName).toBe('Updated Member Name');
    const persisted = await repo.getAccount(uid);
    expect(persisted?.displayName).toBe('Updated Member Name');
  });

  // 8. empty / whitespace displayName is rejected
  it('8. rejects empty or whitespace-only displayName updates before persistence', async () => {
    const uid = 'uid-provisioned-8';
    await repo.createAccount({
      id: uid,
      email: 'member8@example.com',
      displayName: 'Valid Name',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z'
    });

    service.simulatedUser = {
      uid,
      email: 'member8@example.com',
      displayName: 'Valid Name'
    } as unknown as User;

    await expect(
      service.updateCurrentAccount({ displayName: '' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_DATA_INVALID' });

    await expect(
      service.updateCurrentAccount({ displayName: '    ' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_DATA_INVALID' });

    const persisted = await repo.getAccount(uid);
    expect(persisted?.displayName).toBe('Valid Name');
  });

  // 9. email, id, and createdAt remain unchanged after displayName update
  it('9. preserves id, email, and createdAt unchanged after a displayName update', async () => {
    const uid = 'uid-provisioned-9';
    const originalCreatedAt = '2025-11-20T14:22:00.000Z';
    await repo.createAccount({
      id: uid,
      email: 'immutable@example.com',
      displayName: 'Before Update',
      createdAt: originalCreatedAt,
      updatedAt: originalCreatedAt
    });

    service.simulatedUser = {
      uid,
      email: 'immutable@example.com',
      displayName: 'Before Update'
    } as unknown as User;

    const updated = await service.updateCurrentAccount({
      displayName: 'After Update'
    });

    expect(updated.id).toBe(uid);
    expect(updated.email).toBe('immutable@example.com');
    expect(updated.displayName).toBe('After Update');
    expect(updated.createdAt).toBe(originalCreatedAt);
    expect(typeof updated.updatedAt).toBe('string');
  });

  // 10. forbidden / privileged fields (role, isActive, isAdmin, etc.) cannot be written
  it('10. rejects any payload attempting to inject role, isActive, isAdmin, permissions, id, email, or createdAt', async () => {
    const uid = 'uid-provisioned-10';
    await repo.createAccount({
      id: uid,
      email: 'user10@example.com',
      displayName: 'Safe User',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z'
    });

    service.simulatedUser = {
      uid,
      email: 'user10@example.com',
      displayName: 'Safe User'
    } as unknown as User;

    const forbiddenPayloads: Record<string, unknown>[] = [
      { displayName: 'New Name', role: 'Admin' },
      { displayName: 'New Name', isActive: true },
      { displayName: 'New Name', isAdmin: true },
      { displayName: 'New Name', permissions: ['news:write'] },
      { displayName: 'New Name', email: 'hijack@example.com' },
      { displayName: 'New Name', id: 'other-uid' },
      { displayName: 'New Name', createdAt: '2099-01-01T00:00:00.000Z' }
    ];

    for (const payload of forbiddenPayloads) {
      expect(() => validateAccountDisplayNameUpdate(payload)).toThrowError(AccountError);
      await expect(
        service.updateCurrentAccount(payload as any)
      ).rejects.toMatchObject({ code: 'ACCOUNT_DATA_INVALID' });
    }

    const stored = await repo.getAccount(uid);
    expect(stored?.displayName).toBe('Safe User');
    expect(Object.keys(stored!).sort()).toEqual(['createdAt', 'displayName', 'email', 'id', 'updatedAt']);
  });

  // 11. profile update fails safely when accounts/{uid} is missing / recovery incomplete
  it('11. blocks profile update when accounts/{uid} is missing or profile recovery is still incomplete', async () => {
    const uid = 'uid-unprovisioned-11';
    service.simulatedUser = {
      uid,
      email: 'orphan@example.com',
      displayName: null
    } as unknown as User;

    await expect(
      service.updateCurrentAccount({ displayName: 'Attempted Name' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });

    expect(await repo.getAccount(uid)).toBeNull();
  });

  // 12. UI state updates only after repository persistence succeeds
  it('12. updates AccountAuthWidget and repository state only after authoritative persistence resolves and leaves prior state untouched on failure', async () => {
    const uid = 'uid-provisioned-12';
    const initialAccount: Account = {
      id: uid,
      email: 'atomic@example.com',
      displayName: 'Committed Name',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z'
    };
    await repo.createAccount(initialAccount);

    service.simulatedUser = {
      uid,
      email: 'atomic@example.com',
      displayName: 'Committed Name'
    } as unknown as User;

    // Simulate widget state holder that only commits after updateCurrentAccount resolves
    let widgetAccountState: Account | null = await service.getCurrentAccount();
    expect(widgetAccountState?.displayName).toBe('Committed Name');

    let resolveRepoUpdate!: (value: Account) => void;
    let rejectRepoUpdate!: (reason?: unknown) => void;

    const controlledRepo = {
      getAccount: (id: string) => repo.getAccount(id),
      createAccount: (acc: Account) => repo.createAccount(acc),
      updateAccount: () =>
        new Promise<Account>((res, rej) => {
          resolveRepoUpdate = res;
          rejectRepoUpdate = rej;
        })
    };
    service.setRepository(controlledRepo);

    // Start an update and verify widgetAccountState has NOT changed while persistence is pending
    const pendingSuccess = service
      .updateCurrentAccount({ displayName: 'Persisted Name' })
      .then((updated) => {
        if (updated && updated.id === uid) {
          widgetAccountState = updated;
        }
        return updated;
      });

    await Promise.resolve();
    expect(widgetAccountState?.displayName).toBe('Committed Name');

    // Resolve repository persistence and verify state now updates
    resolveRepoUpdate({
      ...initialAccount,
      displayName: 'Persisted Name',
      updatedAt: '2026-02-01T10:00:00.000Z'
    });
    const saved = await pendingSuccess;
    expect(saved.displayName).toBe('Persisted Name');
    expect(widgetAccountState?.displayName).toBe('Persisted Name');

    // Now simulate a repository persistence failure and verify state remains at 'Persisted Name'
    const pendingFailure = service
      .updateCurrentAccount({ displayName: 'Failed Name' })
      .then((updated) => {
        if (updated && updated.id === uid) {
          widgetAccountState = updated;
        }
        return updated;
      });

    await Promise.resolve();
    rejectRepoUpdate(new AccountError('ACCOUNT_DATA_INVALID', 'Write rejected by Firestore'));

    await expect(pendingFailure).rejects.toMatchObject({ code: 'ACCOUNT_DATA_INVALID' });
    expect(widgetAccountState?.displayName).toBe('Persisted Name');

    // Also verify AccountAuthWidget source enforces updating setAccount(updated) strictly after awaiting updateCurrentAccount
    const widgetSource = readFileSync(
      resolve(__dirname, '../components/auth/AccountAuthWidget.tsx'),
      'utf8'
    );
    const awaitIdx = widgetSource.indexOf('const updated = await AccountService.updateCurrentAccount');
    const setAccountIdx = widgetSource.indexOf('setAccount(updated)', awaitIdx);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(setAccountIdx).toBeGreaterThan(awaitIdx);
  });
});
