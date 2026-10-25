/**
 * Promise of Planet — AUTH-02A
 * Durable Public Account Provisioning & Recovery Tests
 *
 * Covers all 14 required verification scenarios:
 * 1. Normal registration produces a canonical account profile.
 * 2. Existing valid profile is returned without mutation.
 * 3. Missing profile can be recovered while signed in.
 * 4. Concurrent recovery attempts do not create duplicate profiles.
 * 5. Registration auth/profile timing race is handled.
 * 6. Firestore provisioning failure remains visibly recoverable.
 * 7. Recovery never creates another Firebase Auth account.
 * 8. Recovery never writes admins/{uid}.
 * 9. No role or permission fields are introduced.
 * 10. Sign-out during recovery does not leave stale UI state.
 * 11. Learner with missing profile cannot enroll prematurely.
 * 12. Successful recovery restores normal learner flow.
 * 13. Existing citizen journalist behavior remains compatible.
 * 14. Existing login and sign-out regressions pass.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import {
  AccountError,
  AccountService,
  AccountServiceClass,
  FirestoreAccountRepository,
  InMemoryAccountRepository,
  validateAccountData,
} from './accountService';
import { INCOMPLETE_ACCOUNT_SETUP_MESSAGES } from '../components/auth/AccountAuthWidget';
import { resolveCourseAccessWithAccountRecovery } from '../components/training/CourseAccessModal';
import { MemberTrainingAccessService } from './memberTrainingAccessService';
import {
  EnrollmentService,
  FirestoreEnrollmentRepository,
  InMemoryEnrollmentRepository,
} from './enrollmentService';
import {
  TrainingCourseService,
  FirestoreTrainingCourseRepository,
  InMemoryTrainingCourseRepository,
} from './trainingCourseService';
import {
  CitizenSubmissionServiceClass,
  InMemoryCitizenEvidenceStorageAdapter,
  InMemoryCitizenSubmissionRepository,
} from './citizenSubmissionService';
import { runMemberTrainingAccessTests } from './memberTrainingAccessTests';
import { runPublicTrainingConvergenceTests } from './publicTrainingConvergenceTests';
import { WorkflowState } from '../types/workflow';
import type { Account } from '../types/account';
import type { TrainingCourse } from '../types/training';

class TestableAccountService extends AccountServiceClass {
  public createUserCallCount = 0;
  public signInCallCount = 0;
  public simulatedUser: User | null = null;
  public onCreateUserHook?: (user: User) => void | Promise<void>;

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
      displayName: null,
    } as unknown as User;
    this.simulatedUser = createdUser;
    if (this.onCreateUserHook) {
      await this.onCreateUserHook(createdUser);
    }
    return createdUser;
  }

  protected async performSignIn(email: string, _password: string): Promise<User> {
    this.signInCallCount += 1;
    const signedInUser = {
      uid: `uid-${email.split('@')[0].toLowerCase()}`,
      email: email.trim().toLowerCase(),
      displayName: null,
    } as unknown as User;
    this.simulatedUser = signedInUser;
    return signedInUser;
  }

  async signOut(): Promise<void> {
    this.simulatedUser = null;
    await super.signOut();
  }
}

const SAMPLE_PUBLISHED_COURSE: TrainingCourse = {
  id: 'course-auth02a-published-01',
  titleAr: 'دورة استعادة النظم البيئية',
  titleEn: 'Ecosystem Restoration Course',
  summaryAr: 'ملخص الدورة التدريبية',
  summaryEn: 'Training course summary',
  category: 'Climate',
  level: 'Beginner',
  durationHours: 8,
  deliveryMode: 'OnlineSelfPaced',
  targetAudienceAr: 'الباحثون والمتطوعون',
  targetAudienceEn: 'Researchers and Volunteers',
  workflowState: WorkflowState.Published,
  workflowHistory: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  author: 'Admin',
  language: 'ar',
};

describe('AUTH-02A: Durable Public Account Provisioning & Recovery', () => {
  let memAccountRepo: InMemoryAccountRepository;
  let memCourseRepo: InMemoryTrainingCourseRepository;
  let memEnrollRepo: InMemoryEnrollmentRepository;

  beforeEach(() => {
    memAccountRepo = new InMemoryAccountRepository();
    memCourseRepo = new InMemoryTrainingCourseRepository();
    memEnrollRepo = new InMemoryEnrollmentRepository();
  });

  afterEach(() => {
    AccountService.setRepository(new FirestoreAccountRepository());
    AccountService.setAuthUserProvider(undefined);
    TrainingCourseService.setRepository(new FirestoreTrainingCourseRepository());
    EnrollmentService.setRepository(new FirestoreEnrollmentRepository());
    EnrollmentService.setAuthProvider(undefined);
    MemberTrainingAccessService.setAuthProvider(undefined);
  });

  it('1. Normal registration produces a canonical 5-field account profile', async () => {
    const service = new TestableAccountService(memAccountRepo);
    const result = await service.register(
      'Nadia.Osman@Example.com',
      'password123',
      'Nadia Osman'
    );

    expect(service.createUserCallCount).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.account).not.toBeNull();
    expect(result.account?.id).toBe('uid-nadia.osman');
    expect(result.account?.email).toBe('nadia.osman@example.com');
    expect(result.account?.displayName).toBe('Nadia Osman');
    expect(Object.keys(result.account!).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'id',
      'updatedAt',
    ]);

    const stored = await memAccountRepo.getAccount('uid-nadia.osman');
    expect(stored).toEqual(result.account);
  });

  it('2. Existing valid profile is returned without mutation during recovery', async () => {
    const existingAccount: Account = {
      id: 'uid-existing-member',
      email: 'existing@promiseofplanet.sd',
      displayName: 'Original Preserved Name',
      createdAt: '2026-01-15T08:30:00.000Z',
      updatedAt: '2026-02-20T12:00:00.000Z',
    };
    await memAccountRepo.createAccount(existingAccount);

    let createCalls = 0;
    const spyRepo: InMemoryAccountRepository = Object.assign(
      Object.create(Object.getPrototypeOf(memAccountRepo)),
      memAccountRepo,
      {
        createAccount: async (acc: Account) => {
          createCalls += 1;
          return await memAccountRepo.createAccount(acc);
        },
      }
    );

    const service = new TestableAccountService(spyRepo);
    service.simulatedUser = {
      uid: 'uid-existing-member',
      email: 'existing@promiseofplanet.sd',
      displayName: 'Different Auth Name',
    } as unknown as User;

    const recovery = await service.recoverCurrentAccountProfile({
      displayName: 'Attempted Override Name',
    });

    expect(recovery.status).toBe('already_provisioned');
    expect(recovery.recoverable).toBe(false);
    expect(recovery.error).toBeNull();
    expect(createCalls).toBe(0);
    expect(recovery.account).toEqual(existingAccount);
    expect(recovery.account?.createdAt).toBe('2026-01-15T08:30:00.000Z');
    expect(recovery.account?.updatedAt).toBe('2026-02-20T12:00:00.000Z');
    expect(recovery.account?.displayName).toBe('Original Preserved Name');
  });

  it('3. Missing profile can be recovered while signed in without re-registering', async () => {
    const service = new TestableAccountService(memAccountRepo);
    service.simulatedUser = {
      uid: 'uid-missing-profile-01',
      email: 'missing01@promiseofplanet.sd',
      displayName: 'Recovered Environmentalist',
    } as unknown as User;

    expect(await memAccountRepo.getAccount('uid-missing-profile-01')).toBeNull();

    const recovery = await service.recoverCurrentAccountProfile();

    expect(recovery.status).toBe('recovered');
    expect(recovery.recoverable).toBe(false);
    expect(recovery.error).toBeNull();
    expect(recovery.account).not.toBeNull();
    expect(recovery.account?.id).toBe('uid-missing-profile-01');
    expect(recovery.account?.email).toBe('missing01@promiseofplanet.sd');
    expect(recovery.account?.displayName).toBe('Recovered Environmentalist');
    expect(service.createUserCallCount).toBe(0);

    // Subsequent recovery call returns the existing profile without mutating createdAt or displayName
    const createdTimestamp = recovery.account!.createdAt;
    const secondRecovery = await service.recoverCurrentAccountProfile({
      displayName: 'Later Name',
    });
    expect(secondRecovery.status).toBe('already_provisioned');
    expect(secondRecovery.account?.createdAt).toBe(createdTimestamp);
    expect(secondRecovery.account?.displayName).toBe('Recovered Environmentalist');
  });

  it('4. Concurrent recovery attempts do not create duplicate profiles or overwrite', async () => {
    let txSetCount = 0;
    let storedDoc: Account | null = null;

    class SimulatedTransactionalFirestoreRepo extends FirestoreAccountRepository {
      protected isConfigured(): boolean {
        return true;
      }
      protected async fetchDoc(_uid: string): Promise<any> {
        return {
          exists: () => storedDoc !== null,
          data: () => storedDoc,
        };
      }
      protected async runTx(updateFn: (tx: any) => Promise<any>): Promise<any> {
        await new Promise((resolve) => setTimeout(resolve, 15));
        const tx = {
          get: async () => ({
            exists: () => storedDoc !== null,
            data: () => storedDoc,
          }),
          set: (_ref: any, data: Account) => {
            txSetCount += 1;
            storedDoc = data;
          },
        };
        return await updateFn(tx);
      }
    }

    const txRepo = new SimulatedTransactionalFirestoreRepo();
    const service = new TestableAccountService(txRepo);
    service.simulatedUser = {
      uid: 'uid-concurrent-user',
      email: 'concurrent@promiseofplanet.sd',
      displayName: 'Concurrent User',
    } as unknown as User;

    const [r1, r2, r3] = await Promise.all([
      service.recoverCurrentAccountProfile(),
      service.recoverCurrentAccountProfile(),
      service.recoverCurrentAccountProfile(),
    ]);

    expect(txSetCount).toBe(1);
    expect(r1.account).not.toBeNull();
    expect(r2.account).toEqual(r1.account);
    expect(r3.account).toEqual(r1.account);
  });

  it('5. Registration auth/profile timing race is handled safely without losing displayName or double-writing', async () => {
    let createAccountWriteCount = 0;
    const baseCreate = memAccountRepo.createAccount.bind(memAccountRepo);
    memAccountRepo.createAccount = async (acc: Account) => {
      createAccountWriteCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await baseCreate(acc);
    };

    const service = new TestableAccountService(memAccountRepo);
    let authListenerRecoveryResult: any = null;
    let authListenerPromise: Promise<void> | null = null;

    // Simulate Firebase firing onAuthStateChanged inside performCreateUser BEFORE register() calls createAccountForUser
    service.onCreateUserHook = (createdUser: User) => {
      authListenerPromise = (async () => {
        const inFlight = await service.awaitInFlightRegistrationForUser(createdUser);
        if (inFlight?.account) {
          authListenerRecoveryResult = inFlight.account;
        } else {
          const rec = await service.recoverCurrentAccountProfile();
          authListenerRecoveryResult = rec.account;
        }
      })();
    };

    const regResult = await service.register(
      'salma@promiseofplanet.sd',
      'password123',
      'Salma El-Tayeb'
    );
    if (authListenerPromise) {
      await authListenerPromise;
    }

    expect(createAccountWriteCount).toBe(1);
    expect(regResult.account?.displayName).toBe('Salma El-Tayeb');
    expect(authListenerRecoveryResult).toEqual(regResult.account);
  });

  it('6. Firestore provisioning failure remains visibly recoverable and preserves intended displayName on retry', async () => {
    let shouldFailCreate = true;
    const baseCreate = memAccountRepo.createAccount.bind(memAccountRepo);
    memAccountRepo.createAccount = async (acc: Account) => {
      if (shouldFailCreate) {
        throw new Error('FirebaseError: [code=unavailable] Transient Firestore outage');
      }
      return await baseCreate(acc);
    };

    const service = new TestableAccountService(memAccountRepo);

    // Initial registration succeeds in Firebase Auth but fails Firestore profile provisioning
    const regResult = await service.register(
      'tariq.member@promiseofplanet.sd',
      'password123',
      'Tariq Member'
    );

    expect(regResult.user.uid).toBe('uid-tariq.member');
    expect(regResult.account).toBeNull();
    expect(regResult.error).toBe(
      'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.'
    );

    // While Firestore is still failing, recovery returns explicit recoverable_failure without raw SDK leak
    const failedRecovery = await service.recoverCurrentAccountProfile();
    expect(failedRecovery.status).toBe('recoverable_failure');
    expect(failedRecovery.recoverable).toBe(true);
    expect(failedRecovery.account).toBeNull();
    expect(failedRecovery.error?.code).toBe('ACCOUNT_PROVISIONING_FAILED');
    expect(failedRecovery.error?.message).not.toContain('FirebaseError');
    expect(failedRecovery.error?.message).not.toContain('Transient Firestore outage');

    // Bilingual incomplete setup strings match required specification
    expect(INCOMPLETE_ACCOUNT_SETUP_MESSAGES.ar).toBe(
      'تم تسجيل الدخول، لكن إعداد ملف الحساب لم يكتمل.'
    );
    expect(INCOMPLETE_ACCOUNT_SETUP_MESSAGES.en).toBe(
      'You are signed in, but your account profile setup is incomplete.'
    );

    // Once Firestore recovers, manual retry succeeds and preserves 'Tariq Member' displayName without re-creating Auth user
    shouldFailCreate = false;
    const recovered = await service.recoverCurrentAccountProfile();
    expect(recovered.status).toBe('recovered');
    expect(recovered.account).not.toBeNull();
    expect(recovered.account?.id).toBe('uid-tariq.member');
    expect(recovered.account?.displayName).toBe('Tariq Member');
    expect(service.createUserCallCount).toBe(1);
  });

  it('7. Recovery never creates another Firebase Auth account', async () => {
    const service = new TestableAccountService(memAccountRepo);
    service.simulatedUser = {
      uid: 'uid-auth-once',
      email: 'authonce@promiseofplanet.sd',
      displayName: 'Auth Once',
    } as unknown as User;

    expect(service.createUserCallCount).toBe(0);

    await service.recoverCurrentAccountProfile();
    await service.recoverCurrentAccountProfile();

    expect(service.createUserCallCount).toBe(0);
    expect(service.signInCallCount).toBe(0);
  });

  it('8. Recovery never writes admins/{uid} or references admin collections', async () => {
    const accountServiceSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/accountService.ts'),
      'utf8'
    );
    const widgetSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/auth/AccountAuthWidget.tsx'),
      'utf8'
    );
    const modalSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/training/CourseAccessModal.tsx'),
      'utf8'
    );

    expect(accountServiceSource).not.toContain("'admins'");
    expect(accountServiceSource).not.toContain('"admins"');
    expect(widgetSource).not.toContain("'admins'");
    expect(widgetSource).not.toContain('"admins"');
    expect(modalSource).not.toContain("'admins'");
    expect(modalSource).not.toContain('"admins"');
  });

  it('9. No role or permission fields are introduced and caller-supplied arbitrary UID is rejected', async () => {
    const service = new TestableAccountService(memAccountRepo);
    service.simulatedUser = {
      uid: 'uid-authentic-caller',
      email: 'caller@promiseofplanet.sd',
      displayName: 'Authentic Caller',
    } as unknown as User;

    // Attempt to inject a caller-supplied target UID in recovery options
    const spoofAttempt = await service.recoverCurrentAccountProfile({
      uid: 'uid-victim-target',
    } as any);
    expect(spoofAttempt.status).toBe('recoverable_failure');
    expect(spoofAttempt.recoverable).toBe(false);
    expect(spoofAttempt.error?.code).toBe('ACCOUNT_DATA_INVALID');
    expect(await memAccountRepo.getAccount('uid-victim-target')).toBeNull();

    // Legitimate recovery produces strictly the 5 canonical fields
    const validRecovery = await service.recoverCurrentAccountProfile();
    expect(validRecovery.status).toBe('recovered');
    const account = validRecovery.account!;
    expect(Object.keys(account).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'id',
      'updatedAt',
    ]);
    expect('role' in account).toBe(false);
    expect('isAdmin' in account).toBe(false);
    expect('isActive' in account).toBe(false);
    expect('permissions' in account).toBe(false);

    // Schema validator rejects any injected role/isAdmin/permissions fields
    expect(() =>
      validateAccountData(
        { ...account, role: 'RightsReviewer' },
        account.id
      )
    ).toThrow(AccountError);
  });

  it('10. Sign-out during recovery does not leave stale UI or service state', async () => {
    const baseGet = memAccountRepo.getAccount.bind(memAccountRepo);
    const service = new TestableAccountService(memAccountRepo);
    service.simulatedUser = {
      uid: 'uid-signing-out',
      email: 'signout@promiseofplanet.sd',
      displayName: 'Signing Out User',
    } as unknown as User;

    memAccountRepo.getAccount = async (uid: string) => {
      // Simulate user signing out while getAccount is in flight
      await service.signOut();
      return await baseGet(uid);
    };

    const result = await service.recoverCurrentAccountProfile();
    expect(result.status).toBe('unauthenticated');
    expect(result.account).toBeNull();
    expect(result.recoverable).toBe(false);
    expect(await baseGet('uid-signing-out')).toBeNull();
  });

  it('11. Learner with missing profile cannot enroll prematurely when account recovery fails', async () => {
    await memCourseRepo.saveCourse(SAMPLE_PUBLISHED_COURSE);

    const failingAccountRepo = new InMemoryAccountRepository();
    failingAccountRepo.createAccount = async () => {
      throw new AccountError(
        'ACCOUNT_PROVISIONING_FAILED',
        'Unable to provision account profile.'
      );
    };

    AccountService.setRepository(failingAccountRepo);
    AccountService.setAuthUserProvider(
      () =>
        ({
          uid: 'uid-learner-unprovisioned',
          email: 'learner@promiseofplanet.sd',
          displayName: 'Learner Unprovisioned',
        }) as unknown as User
    );
    TrainingCourseService.setRepository(memCourseRepo);
    EnrollmentService.setRepository(memEnrollRepo);
    EnrollmentService.setAuthProvider(() => 'uid-learner-unprovisioned');
    MemberTrainingAccessService.setAuthProvider(() => 'uid-learner-unprovisioned');

    const accessState = await resolveCourseAccessWithAccountRecovery(
      SAMPLE_PUBLISHED_COURSE.id,
      SAMPLE_PUBLISHED_COURSE
    );

    expect(accessState.status).toBe('account_unavailable');
    expect(accessState.account).toBeNull();
    expect(accessState.enrollment).toBeNull();

    // Direct enrollment attempt is also blocked because accounts/{uid} does not exist
    const enrollAttempt = await MemberTrainingAccessService.requestEnrollment(
      SAMPLE_PUBLISHED_COURSE.id
    );
    expect(enrollAttempt.status).toBe('account_unavailable');
    expect(enrollAttempt.enrollment).toBeNull();
    expect(
      await memEnrollRepo.getEnrollment(
        'uid-learner-unprovisioned',
        SAMPLE_PUBLISHED_COURSE.id
      )
    ).toBeNull();
  });

  it('12. Successful recovery restores normal learner flow and enables subsequent course enrollment', async () => {
    await memCourseRepo.saveCourse(SAMPLE_PUBLISHED_COURSE);

    AccountService.setRepository(memAccountRepo);
    AccountService.setAuthUserProvider(
      () =>
        ({
          uid: 'uid-learner-recovered',
          email: 'recovered.learner@promiseofplanet.sd',
          displayName: 'Recovered Learner',
        }) as unknown as User
    );
    TrainingCourseService.setRepository(memCourseRepo);
    EnrollmentService.setRepository(memEnrollRepo);
    EnrollmentService.setAuthProvider(() => 'uid-learner-recovered');
    MemberTrainingAccessService.setAuthProvider(() => 'uid-learner-recovered');

    // Before recovery, profile is missing
    expect(await memAccountRepo.getAccount('uid-learner-recovered')).toBeNull();

    // CourseAccessModal recovery flow provisions the missing profile and resolves to not_enrolled
    const resolvedAccess = await resolveCourseAccessWithAccountRecovery(
      SAMPLE_PUBLISHED_COURSE.id,
      SAMPLE_PUBLISHED_COURSE
    );

    expect(resolvedAccess.status).toBe('not_enrolled');
    expect(resolvedAccess.account).not.toBeNull();
    expect(resolvedAccess.account?.id).toBe('uid-learner-recovered');
    expect(resolvedAccess.enrollment).toBeNull();

    // Learner can now explicitly enroll
    const enrolledState = await MemberTrainingAccessService.requestEnrollment(
      SAMPLE_PUBLISHED_COURSE.id
    );
    expect(enrolledState.status).toBe('enrolled');
    expect(enrolledState.enrollment?.accountId).toBe('uid-learner-recovered');
    expect(enrolledState.enrollment?.courseId).toBe(SAMPLE_PUBLISHED_COURSE.id);
  });

  it('13. Existing citizen journalist behavior remains compatible with createAccountForUser and recovery', async () => {
    AccountService.setRepository(memAccountRepo);
    const cjUser = {
      uid: 'uid-cj-compatible',
      email: 'cj@promiseofplanet.sd',
      displayName: 'Citizen Reporter',
    } as unknown as User;
    AccountService.setAuthUserProvider(() => cjUser);

    // PublicCitizenJournalist calls createAccountForUser directly; verify idempotency with recoverCurrentAccountProfile
    const createdViaCj = await AccountService.createAccountForUser(
      cjUser,
      'Citizen Reporter'
    );
    const secondCallViaCj = await AccountService.createAccountForUser(
      cjUser,
      'Different Name'
    );
    const recoveredViaService = await AccountService.recoverCurrentAccountProfile();

    expect(secondCallViaCj).toEqual(createdViaCj);
    expect(recoveredViaService.status).toBe('already_provisioned');
    expect(recoveredViaService.account).toEqual(createdViaCj);

    const cjService = new CitizenSubmissionServiceClass();
    const subRepo = new InMemoryCitizenSubmissionRepository();
    cjService.setRepository(subRepo);
    cjService.setStorageAdapter(new InMemoryCitizenEvidenceStorageAdapter());
    cjService.setAuthProvider(() => cjUser.uid);

    const submission = await cjService.submitReport({
      contributorName: createdViaCj.displayName,
      title: 'Riverbank erosion monitoring report',
      body: 'Observed significant riverbank erosion near agricultural plots after seasonal floods.',
      sourceLanguage: 'en',
      category: 'water',
      locationDescription: 'River Nile State',
    });

    expect(submission.submittedByUid).toBe(cjUser.uid);
  });

  it('14. Existing login, registration, and sign-out regressions pass', async () => {
    const service = new TestableAccountService(memAccountRepo);

    // Register a new user
    const reg = await service.register(
      'regression.user@promiseofplanet.sd',
      'password123',
      'Regression User'
    );
    expect(reg.account).not.toBeNull();
    expect(reg.account?.id).toBe('uid-regression.user');
    expect(await service.getCurrentAccount()).toEqual(reg.account);

    // Update displayName via updateCurrentAccount
    const updated = await service.updateCurrentAccount({
      displayName: 'Updated Regression User',
    });
    expect(updated.displayName).toBe('Updated Regression User');
    expect(updated.createdAt).toBe(reg.account?.createdAt);

    // Sign out clears current user and recovery returns unauthenticated
    await service.signOut();
    expect(await service.getCurrentAccount()).toBeNull();
    const unauthRec = await service.recoverCurrentAccountProfile();
    expect(unauthRec.status).toBe('unauthenticated');
    expect(unauthRec.account).toBeNull();

    // Sign back in restores access to existing account without overwriting updated displayName
    const signedIn = await service.signIn(
      'regression.user@promiseofplanet.sd',
      'password123'
    );
    expect(signedIn.uid).toBe('uid-regression.user');
    const postSignInRec = await service.recoverCurrentAccountProfile();
    expect(postSignInRec.status).toBe('already_provisioned');
    expect(postSignInRec.account?.displayName).toBe('Updated Regression User');

    // MemberTrainingAccess and PublicTrainingConvergence suites pass
    const memberTrainingSuite = await runMemberTrainingAccessTests();
    expect(memberTrainingSuite.passed).toBe(true);

    const publicTrainingSuite = await runPublicTrainingConvergenceTests();
    expect(publicTrainingSuite.passed).toBe(true);
  });
});
