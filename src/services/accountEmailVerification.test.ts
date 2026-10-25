import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { User } from 'firebase/auth';
import {
  AccountService,
  AccountServiceClass,
  InMemoryAccountRepository,
  AccountError,
  EMAIL_VERIFICATION_SENT_MESSAGES,
  EMAIL_VERIFICATION_REFRESH_MESSAGES,
  validateAccountData,
} from './accountService';
import {
  AccountEmailVerificationSection,
  EMAIL_VERIFICATION_UI_LABELS,
  getSafeWidgetErrorMessage,
} from '../components/auth/AccountAuthWidget';
import { resolveCourseAccessWithAccountRecovery } from '../components/training/CourseAccessModal';
import { MemberTrainingAccessService } from './memberTrainingAccessService';
import { EnrollmentService, InMemoryEnrollmentRepository } from './enrollmentService';
import {
  TrainingCourseService,
  InMemoryTrainingCourseRepository,
} from './trainingCourseService';
import {
  CitizenSubmissionServiceClass,
  InMemoryCitizenEvidenceStorageAdapter,
  InMemoryCitizenSubmissionRepository,
} from './citizenSubmissionService';
import { WorkflowState } from '../types/workflow';
import type { TrainingCourse } from '../types/training';

class TestableEmailVerificationAccountService extends AccountServiceClass {
  public simulatedUser: User | null = null;
  public sentVerificationUsers: User[] = [];
  public reloadedUsers: User[] = [];
  public onSendEmailVerification?: (user: User) => Promise<void>;
  public onReloadUser?: (user: User) => Promise<void>;

  protected isConfigured(): boolean {
    return true;
  }

  protected getAuthenticatedUser(): User | null {
    return this.simulatedUser;
  }

  protected async performCreateUser(email: string, _password: string): Promise<User> {
    const createdUser = {
      uid: `uid-${email.split('@')[0].toLowerCase()}`,
      email: email.trim().toLowerCase(),
      displayName: null,
      emailVerified: false,
    } as unknown as User;
    this.simulatedUser = createdUser;
    return createdUser;
  }

  protected async performSignIn(email: string, _password: string): Promise<User> {
    const signedInUser = {
      uid: `uid-${email.split('@')[0].toLowerCase()}`,
      email: email.trim().toLowerCase(),
      displayName: null,
      emailVerified: false,
    } as unknown as User;
    this.simulatedUser = signedInUser;
    return signedInUser;
  }

  protected async performSendEmailVerification(user: User): Promise<void> {
    this.sentVerificationUsers.push(user);
    if (this.onSendEmailVerification) {
      await this.onSendEmailVerification(user);
    }
  }

  protected async performReloadUser(user: User): Promise<void> {
    this.reloadedUsers.push(user);
    if (this.onReloadUser) {
      await this.onReloadUser(user);
    }
  }

  async signOut(): Promise<void> {
    this.simulatedUser = null;
    await super.signOut();
  }
}

const SAMPLE_PUBLISHED_COURSE: TrainingCourse = {
  id: 'course-email-verif-01',
  titleAr: 'دورة الإدارة المتكاملة للموارد المائية',
  titleEn: 'Integrated Water Resources Management',
  summaryAr: 'ملخص الدورة التدريبية',
  summaryEn: 'Training course summary',
  category: 'Water',
  level: 'Beginner',
  durationHours: 8,
  deliveryMode: 'OnlineSelfPaced',
  targetAudienceAr: 'الأعضاء والباحثون',
  targetAudienceEn: 'Members and Researchers',
  workflowState: WorkflowState.Published,
  workflowHistory: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  author: 'Admin',
  language: 'ar',
};

describe('AUTH-02B3: Email Verification Lifecycle — Bounded Implementation', () => {
  let repo: InMemoryAccountRepository;
  let service: TestableEmailVerificationAccountService;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    service = new TestableEmailVerificationAccountService(repo);
  });

  // 1. New unverified user displays the correct state
  it('1. reports emailVerified === false for a newly registered user and renders the bilingual unverified UI with Send and Refresh actions', async () => {
    const { user, account } = await service.register(
      'newmember@example.com',
      'Pass1234!',
      'New Member'
    );
    expect(user.emailVerified).toBe(false);
    expect(account?.id).toBe(user.uid);

    const status = service.getEmailVerificationStatus();
    expect(status).toEqual({
      authenticated: true,
      uid: user.uid,
      email: 'newmember@example.com',
      emailVerified: false,
    });

    const unverifiedEnHtml = renderToStaticMarkup(
      createElement(AccountEmailVerificationSection, {
        emailVerified: false,
        isAr: false,
        onSendVerification: () => {},
        onRefreshVerification: () => {},
      })
    );
    expect(unverifiedEnHtml).toContain('data-testid="email-verification-unverified"');
    expect(unverifiedEnHtml).toContain(EMAIL_VERIFICATION_UI_LABELS.unverifiedBadge.en);
    expect(unverifiedEnHtml).toContain(EMAIL_VERIFICATION_UI_LABELS.sendAction.en);
    expect(unverifiedEnHtml.replace(/&#x27;/g, "'")).toContain(
      EMAIL_VERIFICATION_UI_LABELS.refreshAction.en
    );

    const unverifiedArHtml = renderToStaticMarkup(
      createElement(AccountEmailVerificationSection, {
        emailVerified: false,
        isAr: true,
        onSendVerification: () => {},
        onRefreshVerification: () => {},
      })
    );
    expect(unverifiedArHtml).toContain(EMAIL_VERIFICATION_UI_LABELS.unverifiedBadge.ar);
    expect(unverifiedArHtml).toContain(EMAIL_VERIFICATION_UI_LABELS.sendAction.ar);
    expect(unverifiedArHtml).toContain(EMAIL_VERIFICATION_UI_LABELS.refreshAction.ar);
  });

  // 2. Verification email uses the authenticated user
  it('2. sends verification email strictly to the currently authenticated Firebase User instance', async () => {
    const { user } = await service.register(
      'verifyme@example.com',
      'Pass1234!',
      'Verify Me'
    );

    const result = await service.sendEmailVerificationForCurrentUser();

    expect(service.sentVerificationUsers).toHaveLength(1);
    expect(service.sentVerificationUsers[0]).toBe(user);
    expect(result.status).toBe('sent');
    expect(result.uid).toBe(user.uid);
    expect(result.emailVerified).toBe(false);
    expect(result.messageEn).toBe(EMAIL_VERIFICATION_SENT_MESSAGES.en);
    expect(result.messageAr).toBe(EMAIL_VERIFICATION_SENT_MESSAGES.ar);
  });

  // 3. Authenticated UID is checked before sending
  it('3. rejects sendEmailVerificationForCurrentUser and refreshEmailVerificationStatus when unauthenticated or UID is missing', async () => {
    service.simulatedUser = null;

    await expect(service.sendEmailVerificationForCurrentUser()).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });
    await expect(service.refreshEmailVerificationStatus()).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });

    // Missing/blank UID is also rejected before sending
    service.simulatedUser = {
      uid: '   ',
      email: 'broken@example.com',
      emailVerified: false,
    } as unknown as User;

    await expect(service.sendEmailVerificationForCurrentUser()).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });
    expect(service.sentVerificationUsers).toHaveLength(0);
  });

  // 4. No email enumeration through the verification UI
  it('4. prevents email enumeration by accepting no caller-supplied email parameter and exposing verification UI only to authenticated users', async () => {
    expect(service.sendEmailVerificationForCurrentUser.length).toBe(0);

    const { user } = await service.register(
      'private.address@example.com',
      'Pass1234!',
      'Private User'
    );
    expect(user.uid).toBe('uid-private.address');

    const result = await service.sendEmailVerificationForCurrentUser();
    // Neutral confirmation does not echo arbitrary addresses or allow probing arbitrary emails
    expect(result.messageEn).toBe(EMAIL_VERIFICATION_SENT_MESSAGES.en);
    expect(result.messageAr).toBe(EMAIL_VERIFICATION_SENT_MESSAGES.ar);
    expect(result.messageEn).not.toContain('private.address@example.com');

    const widgetSource = readFileSync(
      resolve(__dirname, '../components/auth/AccountAuthWidget.tsx'),
      'utf8'
    );
    // AccountEmailVerificationSection is rendered only inside the authenticated branch (!firebaseUser ? ... : ...)
    const authBranchIdx = widgetSource.indexOf('!firebaseUser ?');
    const verifSectionIdx = widgetSource.indexOf('<AccountEmailVerificationSection');
    expect(verifSectionIdx).toBeGreaterThan(authBranchIdx);
  });

  // 5. Repeated in-flight requests are deduplicated
  it('5. deduplicates concurrent in-flight verification send and refresh requests for the same UID and disables UI buttons while pending', async () => {
    await service.register('dedup@example.com', 'Pass1234!', 'Dedup User');

    let resolveSend!: () => void;
    service.onSendEmailVerification = () =>
      new Promise<void>((res) => {
        resolveSend = res;
      });

    const p1 = service.sendEmailVerificationForCurrentUser();
    const p2 = service.sendEmailVerificationForCurrentUser();

    resolveSend();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(service.sentVerificationUsers).toHaveLength(1);
    expect(r1).toEqual(r2);

    // Also verify refresh deduplication
    let resolveReload!: () => void;
    service.onReloadUser = () =>
      new Promise<void>((res) => {
        resolveReload = res;
      });

    const ref1 = service.refreshEmailVerificationStatus();
    const ref2 = service.refreshEmailVerificationStatus();

    resolveReload();
    const [resRef1, resRef2] = await Promise.all([ref1, ref2]);
    expect(service.reloadedUsers).toHaveLength(1);
    expect(resRef1).toEqual(resRef2);

    // Verify UI buttons are disabled while sendingVerification or refreshingVerification is true
    const pendingHtml = renderToStaticMarkup(
      createElement(AccountEmailVerificationSection, {
        emailVerified: false,
        isAr: false,
        sendingVerification: true,
        refreshingVerification: false,
        onSendVerification: () => {},
        onRefreshVerification: () => {},
      })
    );
    expect(pendingHtml).toContain('Sending verification...');
    expect((pendingHtml.match(/disabled=""/g) || []).length).toBe(2);
  });

  // 6. Rate-limit and network errors are safe
  it('6. maps rate-limit, network, and expired-session errors to safe actionable AccountErrors without exposing tokens or internal traces', async () => {
    await service.register('errorsafe@example.com', 'Pass1234!', 'Error Safe');

    service.onSendEmailVerification = async () => {
      const err: any = new Error(
        'Firebase: Too many requests (auth/too-many-requests). oobCode=secret-oob-999'
      );
      err.code = 'auth/too-many-requests';
      throw err;
    };

    let rateLimitErr: AccountError | null = null;
    try {
      await service.sendEmailVerificationForCurrentUser();
    } catch (e: any) {
      rateLimitErr = e;
    }
    expect(rateLimitErr).toBeInstanceOf(AccountError);
    expect(rateLimitErr?.code).toBe('EMAIL_VERIFICATION_RATE_LIMITED');
    expect(rateLimitErr?.message).not.toContain('secret-oob-999');
    expect(getSafeWidgetErrorMessage(rateLimitErr, false)).toContain(
      'Too many verification requests'
    );
    expect(getSafeWidgetErrorMessage(rateLimitErr, true)).toContain(
      'تم تجاوز الحد المسموح من طلبات التحقق'
    );

    service.onReloadUser = async () => {
      const err: any = new Error(
        'Firebase: Network error (auth/network-request-failed). token=jwt-secret-123'
      );
      err.code = 'auth/network-request-failed';
      throw err;
    };

    let networkErr: AccountError | null = null;
    try {
      await service.refreshEmailVerificationStatus();
    } catch (e: any) {
      networkErr = e;
    }
    expect(networkErr).toBeInstanceOf(AccountError);
    expect(networkErr?.code).toBe('EMAIL_VERIFICATION_NETWORK_ERROR');
    expect(networkErr?.message).not.toContain('jwt-secret-123');
    expect(getSafeWidgetErrorMessage(networkErr, false)).toContain(
      'Network error while processing email verification'
    );

    service.onSendEmailVerification = async () => {
      const err: any = new Error('Firebase: Token expired (auth/user-token-expired).');
      err.code = 'auth/user-token-expired';
      throw err;
    };

    await expect(service.sendEmailVerificationForCurrentUser()).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_SESSION_EXPIRED',
    });
  });

  // 7. Refresh invokes the canonical Firebase reload operation
  it('7. invokes the canonical Firebase Auth reload operation on the authenticated user when refreshing verification status', async () => {
    const { user } = await service.register(
      'reloadcheck@example.com',
      'Pass1234!',
      'Reload Check'
    );

    const refreshRes = await service.refreshEmailVerificationStatus();

    expect(service.reloadedUsers).toHaveLength(1);
    expect(service.reloadedUsers[0]).toBe(user);
    expect(refreshRes.uid).toBe(user.uid);
    expect(refreshRes.emailVerified).toBe(false);
    expect(refreshRes.messageEn).toBe(EMAIL_VERIFICATION_REFRESH_MESSAGES.unverified.en);
  });

  // 8. Verified state appears only after Firebase confirms it
  it('8. transitions to verified status and hides verification action buttons only after Firebase Auth reload confirms emailVerified === true', async () => {
    const { user } = await service.register(
      'confirmverify@example.com',
      'Pass1234!',
      'Confirm Verify'
    );

    // Possession of a canonical accounts/{uid} record does NOT make emailVerified true
    expect(await service.getCurrentAccount()).not.toBeNull();
    expect(service.getEmailVerificationStatus().emailVerified).toBe(false);

    // First refresh while Firebase still reports emailVerified === false keeps state unverified
    const stillUnverified = await service.refreshEmailVerificationStatus();
    expect(stillUnverified.emailVerified).toBe(false);

    // Simulate user clicking the link in their email and Firebase updating user.emailVerified on reload
    service.onReloadUser = async (reloadedUser) => {
      (reloadedUser as { emailVerified: boolean }).emailVerified = true;
    };

    const confirmed = await service.refreshEmailVerificationStatus();
    expect(confirmed.emailVerified).toBe(true);
    expect(confirmed.messageEn).toBe(EMAIL_VERIFICATION_REFRESH_MESSAGES.verified.en);
    expect(confirmed.messageAr).toBe(EMAIL_VERIFICATION_REFRESH_MESSAGES.verified.ar);
    expect(service.getEmailVerificationStatus().emailVerified).toBe(true);

    // Subsequent sendEmailVerificationForCurrentUser returns already_verified without sending a second email
    const sendAfterVerified = await service.sendEmailVerificationForCurrentUser();
    expect(sendAfterVerified.status).toBe('already_verified');
    expect(sendAfterVerified.emailVerified).toBe(true);
    expect(service.sentVerificationUsers).toHaveLength(0);

    // Verified UI displays concise verified badge and hides unnecessary Send/Refresh buttons
    const verifiedHtml = renderToStaticMarkup(
      createElement(AccountEmailVerificationSection, {
        emailVerified: true,
        isAr: false,
        onSendVerification: () => {},
        onRefreshVerification: () => {},
      })
    );
    expect(verifiedHtml).toContain('data-testid="email-verification-verified"');
    expect(verifiedHtml).toContain(EMAIL_VERIFICATION_UI_LABELS.verifiedBadge.en);
    expect(verifiedHtml).not.toContain('data-testid="send-verification-email-btn"');
    expect(verifiedHtml).not.toContain('data-testid="refresh-verification-status-btn"');
    expect((user as { emailVerified: boolean }).emailVerified).toBe(true);
  });

  // 9. User sign-out or account switch discards stale responses
  it('9. discards stale in-flight send or reload responses when the user signs out or switches accounts', async () => {
    await service.register('userone@example.com', 'Pass1234!', 'User One');

    let finishReloadForUserOne!: () => void;
    service.onReloadUser = (u) =>
      new Promise<void>((res) => {
        finishReloadForUserOne = () => {
          (u as { emailVerified: boolean }).emailVerified = true;
          res();
        };
      });

    const staleReloadPromise = service.refreshEmailVerificationStatus();

    // User One signs out and User Two signs in while User One's reload is still in flight
    await service.signOut();
    const userTwo = await service.signIn('usertwo@example.com', 'Pass1234!');
    expect(userTwo.uid).toBe('uid-usertwo');
    expect(userTwo.emailVerified).toBe(false);

    // Resolve User One's in-flight reload
    finishReloadForUserOne();

    await expect(staleReloadPromise).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });

    // Current session (User Two) remains unverified and unaffected by User One's stale response
    expect(service.getEmailVerificationStatus()).toEqual({
      authenticated: true,
      uid: 'uid-usertwo',
      email: 'usertwo@example.com',
      emailVerified: false,
    });
  });

  // 10. No verification tokens stored or exposed
  it('10. does not add emailVerified or verification tokens to accounts/{uid} or browser storage', async () => {
    const { user, account } = await service.register(
      'cleanprofile@example.com',
      'Pass1234!',
      'Clean Profile'
    );
    await service.sendEmailVerificationForCurrentUser();

    const storedAccount = await repo.getAccount(user.uid);
    expect(storedAccount).not.toBeNull();
    expect(Object.keys(storedAccount!).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'id',
      'updatedAt',
    ]);
    expect('emailVerified' in (storedAccount as Record<string, unknown>)).toBe(false);
    expect('verificationToken' in (storedAccount as Record<string, unknown>)).toBe(false);

    // Canonical validator rejects any attempt to persist emailVerified into accounts/{uid}
    expect(() =>
      validateAccountData(
        {
          ...account,
          emailVerified: true,
        },
        user.uid
      )
    ).toThrowError(AccountError);

    const serviceSource = readFileSync(
      resolve(__dirname, './accountService.ts'),
      'utf8'
    );
    const widgetSource = readFileSync(
      resolve(__dirname, '../components/auth/AccountAuthWidget.tsx'),
      'utf8'
    );
    expect(serviceSource).not.toContain('localStorage');
    expect(serviceSource).not.toContain('sessionStorage');
    expect(widgetSource).not.toContain('localStorage');
    expect(widgetSource).not.toContain('sessionStorage');
  });

  // 11. Profile and account recovery remain intact
  it('11. preserves AUTH-02A account recovery and AUTH-02B1 password reset and displayName editing', async () => {
    // Unprovisioned signed-in user can still recover their canonical profile
    const unprovisionedUser = {
      uid: 'uid-recover-02b3',
      email: 'recover02b3@example.com',
      displayName: 'Recoverable Member',
      emailVerified: false,
    } as unknown as User;
    service.simulatedUser = unprovisionedUser;

    const recovery = await service.recoverCurrentAccountProfile();
    expect(recovery.status).toBe('recovered');
    expect(recovery.account?.id).toBe('uid-recover-02b3');

    // Provisioned user (even with emailVerified === false) can update displayName
    const updated = await service.updateCurrentAccount({
      displayName: 'Updated Member Name',
    });
    expect(updated.displayName).toBe('Updated Member Name');

    // Password reset remains operational
    const resetRes = await service.requestPasswordReset('recover02b3@example.com');
    expect(resetRes.status).toBe('sent');
  });

  // 12. Existing training and citizen journalism behavior remains unchanged
  it('12. preserves existing Training Center enrollment and Citizen Journalism submission eligibility without requiring emailVerified === true', async () => {
    const originalAccountRepo = AccountService.getRepository();
    const originalCourseRepo = TrainingCourseService.getRepository();
    const originalEnrollRepo = EnrollmentService.getRepository();

    const courseRepo = new InMemoryTrainingCourseRepository();
    const enrollRepo = new InMemoryEnrollmentRepository();

    try {
      await courseRepo.saveCourse(SAMPLE_PUBLISHED_COURSE);
      AccountService.setRepository(repo);
      TrainingCourseService.setRepository(courseRepo);
      EnrollmentService.setRepository(enrollRepo);

      // Register an unverified member (emailVerified === false)
      const { user, account } = await service.register(
        'unverified.learner@example.com',
        'Pass1234!',
        'Unverified Learner'
      );
      expect(user.emailVerified).toBe(false);
      expect(account?.id).toBe(user.uid);

      AccountService.setAuthUserProvider(() => user);
      EnrollmentService.setAuthProvider(() => user.uid);
      MemberTrainingAccessService.setAuthProvider(() => user.uid);

      // Training enrollment eligibility remains unchanged
      const accessState = await resolveCourseAccessWithAccountRecovery(
        SAMPLE_PUBLISHED_COURSE.id,
        SAMPLE_PUBLISHED_COURSE
      );
      expect(accessState.status).toBe('not_enrolled');

      const enrolled = await MemberTrainingAccessService.requestEnrollment(
        SAMPLE_PUBLISHED_COURSE.id
      );
      expect(enrolled.status).toBe('enrolled');
      expect(enrolled.enrollment?.accountId).toBe(user.uid);

      // Citizen Journalism submission eligibility remains unchanged
      const citizenService = new CitizenSubmissionServiceClass();
      citizenService.setRepository(new InMemoryCitizenSubmissionRepository());
      citizenService.setStorageAdapter(new InMemoryCitizenEvidenceStorageAdapter());
      citizenService.setAuthProvider(() => user.uid);

      const report = await citizenService.submitReport({
        contributorName: account!.displayName,
        title: 'Seasonal Canal Siltation Report',
        body: 'Observed heavy silt accumulation along the secondary irrigation canal.',
        sourceLanguage: 'en',
        category: 'water',
        locationDescription: 'Gezira Scheme',
      });
      expect(report.submittedByUid).toBe(user.uid);
    } finally {
      AccountService.setAuthUserProvider(undefined);
      EnrollmentService.setAuthProvider(undefined as any);
      MemberTrainingAccessService.setAuthProvider(undefined as any);
      AccountService.setRepository(originalAccountRepo);
      TrainingCourseService.setRepository(originalCourseRepo);
      EnrollmentService.setRepository(originalEnrollRepo);
    }
  });
});
