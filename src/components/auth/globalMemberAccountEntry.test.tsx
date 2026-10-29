import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { User } from 'firebase/auth';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import arTranslation from '../../locales/ar.json';
import enTranslation from '../../locales/en.json';
import {
  Header,
  GLOBAL_MEMBER_ACCOUNT_LABELS,
  HeaderAuthSessionController,
  bindHeaderAuthSessionEffect,
  getGlobalMemberAccountLabel,
  isAuthenticatedFirebaseSessionUser,
} from '../layout/Header';
import { AppShell } from '../layout/AppShell';
import { AdminRole, type AdminUser } from '../../types/admin';
import {
  AdminGateResolutionController,
  AdminIdentityServiceClass,
  InMemoryAdminIdentityRepository,
} from '../../services/adminIdentityService';
import {
  GlobalMemberAccountDialog,
  handleGlobalMemberDialogKeyDown,
  restoreGlobalMemberDialogFocus,
} from './GlobalMemberAccountDialog';
import {
  AccountAuthWidget,
  FORGOT_PASSWORD_ACTION_LABELS,
  INCOMPLETE_ACCOUNT_SETUP_MESSAGES,
} from './AccountAuthWidget';
import {
  AccountService,
  AccountServiceClass,
  InMemoryAccountRepository,
  NEUTRAL_PASSWORD_RESET_MESSAGES,
} from '../../services/accountService';
import { resolveCourseAccessWithAccountRecovery } from '../training/CourseAccessModal';
import { MemberTrainingAccessService } from '../../services/memberTrainingAccessService';
import { EnrollmentService, InMemoryEnrollmentRepository } from '../../services/enrollmentService';
import {
  TrainingCourseService,
  InMemoryTrainingCourseRepository,
} from '../../services/trainingCourseService';
import {
  CitizenSubmissionServiceClass,
  InMemoryCitizenEvidenceStorageAdapter,
  InMemoryCitizenSubmissionRepository,
} from '../../services/citizenSubmissionService';
import { WorkflowState } from '../../types/workflow';
import type { TrainingCourse } from '../../types/training';

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      ar: { translation: arTranslation },
      en: { translation: enTranslation },
    },
    lng: 'ar',
    fallbackLng: 'ar',
    interpolation: { escapeValue: false },
  });
}

class TestableGlobalAccountService extends AccountServiceClass {
  public simulatedUser: User | null = null;
  public signOutCallCount = 0;
  public resetEmails: string[] = [];

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
    } as unknown as User;
    this.simulatedUser = createdUser;
    return createdUser;
  }

  protected async performSignIn(email: string, _password: string): Promise<User> {
    const signedInUser = {
      uid: `uid-${email.split('@')[0].toLowerCase()}`,
      email: email.trim().toLowerCase(),
      displayName: null,
    } as unknown as User;
    this.simulatedUser = signedInUser;
    return signedInUser;
  }

  protected async performPasswordReset(email: string): Promise<void> {
    this.resetEmails.push(email);
  }

  async signOut(): Promise<void> {
    this.signOutCallCount += 1;
    this.simulatedUser = null;
    await super.signOut();
  }
}

const SAMPLE_COURSE: TrainingCourse = {
  id: 'course-global-auth-01',
  titleAr: 'دورة حوكمة الموارد المائية',
  titleEn: 'Water Governance Course',
  summaryAr: 'ملخص الدورة',
  summaryEn: 'Course summary',
  category: 'Water',
  level: 'Beginner',
  durationHours: 6,
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

describe('AUTH-02B2 & AUTH-05-R1: Global Member Account Entry — Unified Account Session & Dynamic Header Label', () => {
  let accountRepo: InMemoryAccountRepository;
  let testService: TestableGlobalAccountService;

  beforeEach(async () => {
    accountRepo = new InMemoryAccountRepository();
    testService = new TestableGlobalAccountService(accountRepo);
    HeaderAuthSessionController.setSharedController(null);
    vi.restoreAllMocks();
    await i18n.changeLanguage('ar');
  });

  it('1. renders exactly one Header member account entry in the fixed control zone on desktop without duplicating forms', async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      createElement(Header, {
        onEnterAdmin: () => {},
        activePage: 'home',
        onOpenMemberAccount: () => {},
        isMemberAccountOpen: false,
      })
    );

    const buttonMatches = html.match(/\sid="header-member-account-btn"/g) || [];
    expect(buttonMatches).toHaveLength(1);
    expect(html).toContain('id="header-fixed-control-zone"');
    expect(html).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.en);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    // Header itself must not embed AccountAuthWidget's password/email inputs directly
    expect(html).not.toContain('type="password"');
  });

  it('2. exposes a single reachable account entry across mobile and desktop viewports with no duplicate account controls', async () => {
    await i18n.changeLanguage('ar');
    const headerSource = readFileSync(
      resolve(__dirname, '../layout/Header.tsx'),
      'utf8'
    );
    const html = renderToStaticMarkup(
      createElement(Header, {
        onEnterAdmin: () => {},
        activePage: 'home',
        onOpenMemberAccount: () => {},
        isMemberAccountOpen: false,
      })
    );

    // Control is located inside #header-fixed-control-zone which is visible across mobile, tablet, and desktop
    const buttonOccurrencesInSource = (
      headerSource.match(/\sid="header-member-account-btn"/g) || []
    ).length;
    expect(buttonOccurrencesInSource).toBe(1);

    const renderedOccurrences = (
      html.match(/data-testid="header-member-account-btn"/g) || []
    ).length;
    expect(renderedOccurrences).toBe(1);
    expect(html).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar);
  });

  it('3. opens GlobalMemberAccountDialog wrapping the existing AccountAuthWidget through App -> AppShell -> Header', async () => {
    await i18n.changeLanguage('en');
    const closedShellHtml = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          isMemberAccountOpen: false,
          onOpenMemberAccount: () => {},
          onCloseMemberAccount: () => {},
        },
        createElement('div', null, 'Public Content')
      )
    );
    expect(closedShellHtml).toContain('id="header-member-account-btn"');
    expect(closedShellHtml).not.toContain('id="global-member-account-dialog"');

    const openShellHtml = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          isMemberAccountOpen: true,
          onOpenMemberAccount: () => {},
          onCloseMemberAccount: () => {},
        },
        createElement('div', null, 'Public Content')
      )
    );
    expect(openShellHtml).toContain('id="global-member-account-dialog"');
    expect(openShellHtml).toContain('role="dialog"');
    expect(openShellHtml).toContain('aria-modal="true"');
    expect(openShellHtml).toContain('aria-expanded="true"');

    const dialogSource = readFileSync(
      resolve(__dirname, './GlobalMemberAccountDialog.tsx'),
      'utf8'
    );
    expect(dialogSource).toContain("import { AccountAuthWidget } from './AccountAuthWidget'");
    expect(dialogSource).toContain('<AccountAuthWidget isAr={isAr} />');
  });

  it('4. keeps sign-in and registration reachable inside GlobalMemberAccountDialog', async () => {
    const dialogEnHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: false,
      })
    );
    const widgetEnHtml = renderToStaticMarkup(
      createElement(AccountAuthWidget, { isAr: false })
    );
    expect(dialogEnHtml).toContain(widgetEnHtml);
    expect(dialogEnHtml).toContain('My Account / Sign In');

    const dialogArHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: true,
      })
    );
    const widgetArHtml = renderToStaticMarkup(
      createElement(AccountAuthWidget, { isAr: true })
    );
    expect(dialogArHtml).toContain(widgetArHtml);
    expect(dialogArHtml).toContain('حسابي / تسجيل الدخول');

    // Verify AccountAuthWidget sign-in and registration flows work end-to-end
    const widgetSource = readFileSync(
      resolve(__dirname, './AccountAuthWidget.tsx'),
      'utf8'
    );
    expect(widgetSource).toContain("setMode('signin')");
    expect(widgetSource).toContain("setMode('register')");
    expect(widgetSource).toContain('AccountService.signIn');
    expect(widgetSource).toContain('AccountService.register');

    const regResult = await testService.register('newreader@example.com', 'Pass1234!', 'New Reader');
    expect(regResult.account?.email).toBe('newreader@example.com');
    const signedIn = await testService.signIn('newreader@example.com', 'Pass1234!');
    expect(signedIn.uid).toBe('uid-newreader');
  });

  it('5. keeps AUTH-02B1 password reset and profile displayName editing reachable from the global dialog', async () => {
    const widgetSource = readFileSync(
      resolve(__dirname, './AccountAuthWidget.tsx'),
      'utf8'
    );
    expect(widgetSource).toContain('FORGOT_PASSWORD_ACTION_LABELS');
    expect(widgetSource).toContain("setMode('reset')");
    expect(widgetSource).toContain('handleUpdateProfileDisplayName');
    expect(widgetSource).toContain('setEditingProfile(true)');
    expect(widgetSource).toContain('AccountService.requestPasswordReset(email)');
    expect(widgetSource).toContain('AccountService.updateCurrentAccount');
    expect(FORGOT_PASSWORD_ACTION_LABELS.en).toBe('Forgot password?');
    expect(FORGOT_PASSWORD_ACTION_LABELS.ar).toBe('نسيت كلمة المرور؟');

    // Verify password reset and displayName editing work on the shared service backing the dialog
    const resetResult = await testService.requestPasswordReset('Member@Example.com');
    expect(resetResult.status).toBe('sent');
    expect(resetResult.messageEn).toBe(NEUTRAL_PASSWORD_RESET_MESSAGES.en);

    const reg = await testService.register('member@example.com', 'SecurePass123!', 'Initial Name');
    expect(reg.account?.displayName).toBe('Initial Name');

    const updated = await testService.updateCurrentAccount({ displayName: 'Edited From Global Dialog' });
    expect(updated.displayName).toBe('Edited From Global Dialog');
  });

  it('6. keeps AUTH-02A incomplete-account recovery reachable from the global dialog without signing out or creating a second user', async () => {
    // Simulate a signed-in Firebase user whose accounts/{uid} document is missing
    const orphanUser = {
      uid: 'uid-orphan-member',
      email: 'orphan@example.com',
      displayName: 'Orphan Member',
    } as unknown as User;
    testService.simulatedUser = orphanUser;

    expect(await testService.getCurrentAccount()).toBeNull();

    // Recover profile via canonical AUTH-02A recovery operation
    const recovery = await testService.recoverCurrentAccountProfile({
      displayName: 'Recovered Global Member',
    });
    expect(recovery.status).toBe('recovered');
    expect(recovery.account?.id).toBe('uid-orphan-member');
    expect(recovery.account?.displayName).toBe('Recovered Global Member');
    expect(testService.signOutCallCount).toBe(0);

    // Confirm AccountAuthWidget exposes the incomplete setup banner and recovery button
    const widgetSource = readFileSync(
      resolve(__dirname, './AccountAuthWidget.tsx'),
      'utf8'
    );
    expect(widgetSource).toContain('INCOMPLETE_ACCOUNT_SETUP_MESSAGES');
    expect(widgetSource).toContain('handleCompleteAccountSetup');
    expect(INCOMPLETE_ACCOUNT_SETUP_MESSAGES.en).toContain('account profile setup is incomplete');
  });

  it('7. closes GlobalMemberAccountDialog without signing the user out and preserves session across public navigation', async () => {
    const reg = await testService.register('persistent@example.com', 'Pass1234!', 'Persistent Reader');
    expect(reg.account?.id).toBe('uid-persistent');

    let dialogOpen = true;
    const handleClose = () => {
      dialogOpen = false;
    };

    // Closing via Escape key handler or close callback never invokes signOut
    handleGlobalMemberDialogKeyDown({
      key: 'Escape',
      focusableElements: [],
      activeElement: null,
      onClose: handleClose,
    });

    expect(dialogOpen).toBe(false);
    expect(testService.signOutCallCount).toBe(0);
    expect((await testService.getCurrentAccount())?.id).toBe('uid-persistent');

    // Verify App.tsx preserves session across public page switches
    const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(appSource).toContain('isMemberAccountOpen={isMemberAccountOpen}');
    expect(appSource).not.toContain('AccountService.signOut');
  });

  it('8. shares the same Firebase authentication session and accounts/{uid} authority across Header, Training, and Citizen Journalism', async () => {
    const originalRepo = AccountService.getRepository();
    const courseRepo = new InMemoryTrainingCourseRepository();
    const enrollmentRepo = new InMemoryEnrollmentRepository();
    const originalCourseRepo = TrainingCourseService.getRepository();
    const originalEnrollmentRepo = EnrollmentService.getRepository();

    try {
      await courseRepo.saveCourse(SAMPLE_COURSE);
      AccountService.setRepository(accountRepo);
      TrainingCourseService.setRepository(courseRepo);
      EnrollmentService.setRepository(enrollmentRepo);

      // Register via global account authority
      const { user, account } = await testService.register(
        'sharedmember@example.com',
        'SharedPass123!',
        'Shared Member'
      );
      expect(account?.id).toBe(user.uid);

      // Inject authenticated user into singleton AccountService, EnrollmentService, and MemberTrainingAccessService
      AccountService.setAuthUserProvider(() => user);
      EnrollmentService.setAuthProvider(() => user.uid);
      MemberTrainingAccessService.setAuthProvider(() => user.uid);

      // 1) Training Center course access immediately recognizes the signed-in member
      const trainingAccess = await resolveCourseAccessWithAccountRecovery(
        SAMPLE_COURSE.id,
        SAMPLE_COURSE
      );
      expect(trainingAccess.status).toBe('not_enrolled');
      expect(trainingAccess.account?.id).toBe(user.uid);
      expect(trainingAccess.account?.displayName).toBe('Shared Member');

      const enrolledState = await MemberTrainingAccessService.requestEnrollment(SAMPLE_COURSE.id);
      expect(enrolledState.status).toBe('enrolled');
      expect(enrolledState.enrollment?.accountId).toBe(user.uid);

      // 2) Citizen Journalism submission service recognizes the exact same account session
      const citizenService = new CitizenSubmissionServiceClass();
      citizenService.setRepository(new InMemoryCitizenSubmissionRepository());
      citizenService.setStorageAdapter(new InMemoryCitizenEvidenceStorageAdapter());
      citizenService.setAuthProvider(() => user.uid);
      const submission = await citizenService.submitReport({
        contributorName: account!.displayName,
        title: 'Water Pipeline Leak Observation',
        body: 'Observed a major water main leak near the eastern canal bank.',
        sourceLanguage: 'en',
        category: 'water',
        locationDescription: 'Khartoum North',
      });
      expect(submission.submittedByUid).toBe(user.uid);
    } finally {
      AccountService.setAuthUserProvider(undefined);
      EnrollmentService.setAuthProvider(undefined as any);
      MemberTrainingAccessService.setAuthProvider(undefined as any);
      AccountService.setRepository(originalRepo);
      TrainingCourseService.setRepository(originalCourseRepo);
      EnrollmentService.setRepository(originalEnrollmentRepo);
    }
  });

  it('9. keeps Admin Portal gateway separate from public member account authentication', () => {
    let adminEntered = false;
    let memberOpened = false;

    const headerHtml = renderToStaticMarkup(
      createElement(Header, {
        onEnterAdmin: () => {
          adminEntered = true;
        },
        onOpenMemberAccount: () => {
          memberOpened = true;
        },
        isMemberAccountOpen: false,
      })
    );

    expect(headerHtml).toContain('id="header-member-account-btn"');
    expect(headerHtml).toContain('id="header-enter-admin-btn"');
    expect(adminEntered).toBe(false);
    expect(memberOpened).toBe(false);

    const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(appSource).toContain('<AdminAccessGate');
    expect(appSource).toContain('setIsMemberAccountOpen(false)');
    expect(appSource).toContain('setIsAdminOpen(true)');
  });

  it('10. never uses FirebaseAuthProvider, mock admin identities, localStorage, or cookies as Header auth authority or grants administrative roles through public registration', async () => {
    const filesToInspect = [
      resolve(__dirname, '../layout/Header.tsx'),
      resolve(__dirname, './GlobalMemberAccountDialog.tsx'),
      resolve(__dirname, './AccountAuthWidget.tsx'),
      resolve(__dirname, '../layout/AppShell.tsx'),
      resolve(__dirname, '../../App.tsx'),
    ];

    for (const filePath of filesToInspect) {
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toContain('FirebaseAuthProvider');
      expect(content).not.toContain('useFirebaseAuth');
    }

    const headerSource = readFileSync(
      resolve(__dirname, '../layout/Header.tsx'),
      'utf8'
    );
    expect(headerSource).toContain('AccountService.observeAuthState');
    expect(headerSource).not.toContain('canonicalAdminUser');
    expect(headerSource).not.toContain('simulateSignIn');
    expect(headerSource).not.toContain('localStorage');
    expect(headerSource).not.toContain('document.cookie');

    const { account } = await testService.register(
      'publicreader@example.com',
      'ReaderPass123!',
      'Public Reader'
    );
    expect(account).not.toBeNull();
    expect(Object.keys(account!).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'id',
      'updatedAt',
    ]);
    expect('role' in (account as Record<string, unknown>)).toBe(false);
    expect('isAdmin' in (account as Record<string, unknown>)).toBe(false);
    expect('permissions' in (account as Record<string, unknown>)).toBe(false);
  });

  it('11. renders correct Arabic RTL and English LTR labels and direction attributes in Header and GlobalMemberAccountDialog', async () => {
    await i18n.changeLanguage('ar');
    const headerAr = renderToStaticMarkup(
      createElement(Header, {
        onEnterAdmin: () => {},
        onOpenMemberAccount: () => {},
        isMemberAccountOpen: true,
      })
    );
    expect(headerAr).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar);
    expect(headerAr).toContain('dir="rtl"');

    const dialogAr = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: true,
      })
    );
    expect(dialogAr).toContain('dir="rtl"');
    expect(dialogAr).toContain('حسابي / تسجيل الدخول');
    expect(dialogAr).toContain('aria-label="إغلاق نافذة الحساب"');

    await i18n.changeLanguage('en');
    const headerEn = renderToStaticMarkup(
      createElement(Header, {
        onEnterAdmin: () => {},
        onOpenMemberAccount: () => {},
        isMemberAccountOpen: true,
      })
    );
    expect(headerEn).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.en);
    expect(headerEn).toContain('dir="ltr"');

    const dialogEn = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: false,
      })
    );
    expect(dialogEn).toContain('dir="ltr"');
    expect(dialogEn).toContain('My Account / Sign In');
    expect(dialogEn).toContain('aria-label="Close account dialog"');
  });

  it('12. enforces keyboard focus trap, Escape close, focus restoration on close, and single-scroll responsive dialog container', () => {
    let focusedId = '';
    const firstBtn = {
      focus: () => {
        focusedId = 'first';
      },
    };
    const middleInput = {
      focus: () => {
        focusedId = 'middle';
      },
    };
    const lastBtn = {
      focus: () => {
        focusedId = 'last';
      },
    };
    const focusables = [firstBtn, middleInput, lastBtn];

    // Tab on last element wraps to first element
    let prevented = false;
    handleGlobalMemberDialogKeyDown({
      key: 'Tab',
      shiftKey: false,
      focusableElements: focusables,
      activeElement: lastBtn,
      onClose: () => {},
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(focusedId).toBe('first');

    // Shift+Tab on first element wraps to last element
    prevented = false;
    handleGlobalMemberDialogKeyDown({
      key: 'Tab',
      shiftKey: true,
      focusableElements: focusables,
      activeElement: firstBtn,
      onClose: () => {},
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(focusedId).toBe('last');

    // Focus restoration returns focus to the Header trigger button on close
    let triggerFocused = false;
    const triggerBtn = {
      focus: () => {
        triggerFocused = true;
      },
    };
    restoreGlobalMemberDialogFocus(triggerBtn, null);
    expect(triggerFocused).toBe(true);

    // Responsive dialog markup uses a single scroll container (max-h-[90vh] overflow-y-auto) and no nested overflow-y-auto inside AccountAuthWidget
    const dialogHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: false,
      })
    );
    const widgetHtml = renderToStaticMarkup(createElement(AccountAuthWidget, { isAr: false }));
    expect(dialogHtml).toContain('max-h-[90vh] overflow-y-auto');
    expect(widgetHtml).not.toContain('overflow-y-auto');
    expect(widgetHtml).not.toContain('overflow-y-scroll');
  });

  it('13. AUTH-05-R1: renders exact signed-out ("تسجيل الدخول" / "Sign In") and signed-in ("حسابي" / "My Account") labels in Arabic and English via AccountService.observeAuthState', async () => {
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar).toBe('تسجيل الدخول');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.en).toBe('Sign In');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.ar).toBe('حسابي');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.en).toBe('My Account');

    let observedCallback: ((user: User | null) => void) | null = null;
    const observeSpy = vi
      .spyOn(AccountService, 'observeAuthState')
      .mockImplementation((cb) => {
        observedCallback = cb;
        cb(null);
        return () => {};
      });

    const controller = new HeaderAuthSessionController();
    const cleanup = bindHeaderAuthSessionEffect(controller, () => {});
    expect(observeSpy).toHaveBeenCalledTimes(1);

    try {
      // 1) Signed out Arabic
      await i18n.changeLanguage('ar');
      const signedOutArHtml = renderToStaticMarkup(
        createElement(Header, {
          authSessionController: controller,
          onOpenMemberAccount: () => {},
          isMemberAccountOpen: false,
        })
      );
      expect(signedOutArHtml).toContain('>تسجيل الدخول<');
      expect(signedOutArHtml).not.toContain('>حسابي<');
      expect(signedOutArHtml).not.toContain('حسابي / تسجيل الدخول');
      expect(signedOutArHtml).toContain('data-auth-state="unauthenticated"');

      // 2) Signed out English
      await i18n.changeLanguage('en');
      const signedOutEnHtml = renderToStaticMarkup(
        createElement(Header, {
          authSessionController: controller,
          onOpenMemberAccount: () => {},
          isMemberAccountOpen: false,
        })
      );
      expect(signedOutEnHtml).toContain('>Sign In<');
      expect(signedOutEnHtml).not.toContain('>My Account<');
      expect(signedOutEnHtml).not.toContain('My Account / Sign In');
      expect(signedOutEnHtml).toContain('data-auth-state="unauthenticated"');

      // 3) Signed in Arabic
      const authenticatedMember = {
        uid: 'member-uid-auth05-01',
        email: 'member01@promiseofplanet.org',
        displayName: 'Salma Member',
      } as unknown as User;
      observedCallback!(authenticatedMember);

      await i18n.changeLanguage('ar');
      const signedInArHtml = renderToStaticMarkup(
        createElement(Header, {
          authSessionController: controller,
          onOpenMemberAccount: () => {},
          isMemberAccountOpen: false,
        })
      );
      expect(signedInArHtml).toContain('>حسابي<');
      expect(signedInArHtml).not.toContain('>تسجيل الدخول<');
      expect(signedInArHtml).not.toContain('حسابي / تسجيل الدخول');
      expect(signedInArHtml).toContain('data-auth-state="authenticated"');

      // 4) Signed in English
      await i18n.changeLanguage('en');
      const signedInEnHtml = renderToStaticMarkup(
        createElement(Header, {
          authSessionController: controller,
          onOpenMemberAccount: () => {},
          isMemberAccountOpen: false,
        })
      );
      expect(signedInEnHtml).toContain('>My Account<');
      expect(signedInEnHtml).not.toContain('>Sign In<');
      expect(signedInEnHtml).not.toContain('My Account / Sign In');
      expect(signedInEnHtml).toContain('data-auth-state="authenticated"');
    } finally {
      cleanup();
      await i18n.changeLanguage('ar');
    }
  });

  it('14. AUTH-05-R1: displays "حسابي" / "My Account" for Owner, Admin, Editor, RightsReviewer, and ordinary members when authenticated in Firebase Auth, and never infers auth from mock admins', async () => {
    let observedCallback: ((user: User | null) => void) | null = null;
    vi.spyOn(AccountService, 'observeAuthState').mockImplementation((cb) => {
      observedCallback = cb;
      return () => {};
    });

    const controller = new HeaderAuthSessionController();
    const cleanup = bindHeaderAuthSessionEffect(controller, () => {});

    const accountIdentities: Array<{ label: string; user: User }> = [
      {
        label: 'Owner',
        user: {
          uid: 'uid-owner-session-01',
          email: 'owner@promiseofplanet.org',
          displayName: 'Platform Owner',
          emailVerified: true,
        } as unknown as User,
      },
      {
        label: 'Admin',
        user: {
          uid: 'uid-admin-session-02',
          email: 'admin@promiseofplanet.org',
          displayName: 'Platform Admin',
          emailVerified: true,
        } as unknown as User,
      },
      {
        label: 'Editor',
        user: {
          uid: 'uid-editor-session-03',
          email: 'editor@promiseofplanet.org',
          displayName: 'Senior Editor',
          emailVerified: true,
        } as unknown as User,
      },
      {
        label: 'RightsReviewer',
        user: {
          uid: 'uid-reviewer-session-04',
          email: 'reviewer@promiseofplanet.org',
          displayName: 'Rights Reviewer',
          emailVerified: true,
        } as unknown as User,
      },
      {
        label: 'Ordinary Member',
        user: {
          uid: 'uid-member-session-05',
          email: 'member@example.com',
          displayName: 'Registered Member',
          emailVerified: false,
        } as unknown as User,
      },
    ];

    try {
      for (const entry of accountIdentities) {
        observedCallback!(entry.user);
        expect(controller.getSnapshot().isSignedIn).toBe(true);
        expect(controller.getSnapshot().firebaseUser?.uid).toBe(entry.user.uid);

        await i18n.changeLanguage('ar');
        const arHtml = renderToStaticMarkup(
          createElement(Header, { authSessionController: controller })
        );
        expect(arHtml).toContain('>حسابي<');
        expect(arHtml).not.toContain('>تسجيل الدخول<');

        await i18n.changeLanguage('en');
        const enHtml = renderToStaticMarkup(
          createElement(Header, { authSessionController: controller })
        );
        expect(enHtml).toContain('>My Account<');
        expect(enHtml).not.toContain('>Sign In<');
      }

      // Mock AdminUser object without a genuine Firebase Auth session (or null user) must NEVER be treated as signed in
      const mockOwnerOnly: AdminUser = {
        id: 'mock-owner-01',
        name: 'Simulated Owner',
        email: 'owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
      };
      expect(
        isAuthenticatedFirebaseSessionUser(mockOwnerOnly as unknown as User)
      ).toBe(false);

      observedCallback!(mockOwnerOnly as unknown as User);
      expect(controller.getSnapshot().isSignedIn).toBe(false);
      expect(controller.getSnapshot().firebaseUser).toBeNull();

      await i18n.changeLanguage('ar');
      const unauthArHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(unauthArHtml).toContain('>تسجيل الدخول<');
      expect(unauthArHtml).not.toContain('>حسابي<');

      await i18n.changeLanguage('en');
      const unauthEnHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(unauthEnHtml).toContain('>Sign In<');
      expect(unauthEnHtml).not.toContain('>My Account<');
    } finally {
      cleanup();
      await i18n.changeLanguage('ar');
    }
  });

  it('15. AUTH-05-R1: maintains an accessible, stable initial loading state until AccountService.observeAuthState resolves the session', async () => {
    let observedCallback: ((user: User | null) => void) | null = null;
    vi.spyOn(AccountService, 'observeAuthState').mockImplementation((cb) => {
      observedCallback = cb;
      // Do not invoke cb yet: simulates pending initial Firebase Auth resolution
      return () => {};
    });

    const controller = new HeaderAuthSessionController();
    const cleanup = bindHeaderAuthSessionEffect(controller, () => {});

    try {
      expect(controller.getSnapshot().isAuthLoading).toBe(true);
      expect(controller.getSnapshot().isSignedIn).toBe(false);
      expect(controller.getSnapshot().firebaseUser).toBeNull();

      await i18n.changeLanguage('ar');
      const loadingArHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(loadingArHtml).toContain('aria-busy="true"');
      expect(loadingArHtml).toContain('data-auth-state="loading"');
      expect(loadingArHtml).toContain('>تسجيل الدخول<');
      expect(loadingArHtml).not.toContain('>حسابي<');

      await i18n.changeLanguage('en');
      const loadingEnHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(loadingEnHtml).toContain('aria-busy="true"');
      expect(loadingEnHtml).toContain('data-auth-state="loading"');
      expect(loadingEnHtml).toContain('>Sign In<');
      expect(loadingEnHtml).not.toContain('>My Account<');

      // Even if a user object is passed to getGlobalMemberAccountLabel while isAuthLoading is true, it must stay stable
      const pendingUser = {
        uid: 'pending-uid-100',
        email: 'pending@promiseofplanet.org',
      } as unknown as User;
      expect(getGlobalMemberAccountLabel(true, pendingUser, true)).toBe('تسجيل الدخول');
      expect(getGlobalMemberAccountLabel(false, pendingUser, true)).toBe('Sign In');

      // Once AccountService.observeAuthState resolves with the user, loading completes and label updates
      observedCallback!(pendingUser);
      expect(controller.getSnapshot().isAuthLoading).toBe(false);
      expect(controller.getSnapshot().isSignedIn).toBe(true);

      await i18n.changeLanguage('ar');
      const resolvedArHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(resolvedArHtml).toContain('aria-busy="false"');
      expect(resolvedArHtml).toContain('data-auth-state="authenticated"');
      expect(resolvedArHtml).toContain('>حسابي<');

      await i18n.changeLanguage('en');
      const resolvedEnHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(resolvedEnHtml).toContain('aria-busy="false"');
      expect(resolvedEnHtml).toContain('data-auth-state="authenticated"');
      expect(resolvedEnHtml).toContain('>My Account<');
    } finally {
      cleanup();
      await i18n.changeLanguage('ar');
    }
  });

  it('16. AUTH-05-R1: reactively transitions label on sign-in and sign-out via AccountService.observeAuthState without page refresh', async () => {
    let observedCallback: ((user: User | null) => void) | null = null;
    vi.spyOn(AccountService, 'observeAuthState').mockImplementation((cb) => {
      observedCallback = cb;
      cb(null);
      return () => {};
    });

    const controller = new HeaderAuthSessionController();
    const stateHistory: Array<{ isSignedIn: boolean; isAuthLoading: boolean; uid: string | null }> = [];
    const cleanup = bindHeaderAuthSessionEffect(controller, (snap) => {
      stateHistory.push({
        isSignedIn: snap.isSignedIn,
        isAuthLoading: snap.isAuthLoading,
        uid: snap.firebaseUser?.uid ?? null,
      });
    });

    const memberUser = {
      uid: 'reactive-member-202',
      email: 'reactive@promiseofplanet.org',
    } as unknown as User;

    try {
      // Step 1: Signed out
      await i18n.changeLanguage('ar');
      expect(
        renderToStaticMarkup(createElement(Header, { authSessionController: controller }))
      ).toContain('>تسجيل الدخول<');
      await i18n.changeLanguage('en');
      expect(
        renderToStaticMarkup(createElement(Header, { authSessionController: controller }))
      ).toContain('>Sign In<');

      // Step 2: Sign in via shared Firebase Auth observer callback (no page refresh)
      observedCallback!(memberUser);
      await i18n.changeLanguage('ar');
      expect(
        renderToStaticMarkup(createElement(Header, { authSessionController: controller }))
      ).toContain('>حسابي<');
      await i18n.changeLanguage('en');
      expect(
        renderToStaticMarkup(createElement(Header, { authSessionController: controller }))
      ).toContain('>My Account<');

      // Step 3: Sign out via shared Firebase Auth observer callback (no page refresh)
      observedCallback!(null);
      await i18n.changeLanguage('ar');
      expect(
        renderToStaticMarkup(createElement(Header, { authSessionController: controller }))
      ).toContain('>تسجيل الدخول<');
      await i18n.changeLanguage('en');
      expect(
        renderToStaticMarkup(createElement(Header, { authSessionController: controller }))
      ).toContain('>Sign In<');

      expect(stateHistory).toEqual([
        { isSignedIn: false, isAuthLoading: false, uid: null },
        { isSignedIn: true, isAuthLoading: false, uid: 'reactive-member-202' },
        { isSignedIn: false, isAuthLoading: false, uid: null },
      ]);
    } finally {
      cleanup();
      await i18n.changeLanguage('ar');
    }
  });

  it('17. AUTH-05-R1: opens GlobalMemberAccountDialog in both signed-out and signed-in states and keeps signed-in account profile and sign-out action accessible', async () => {
    let observedCallback: ((user: User | null) => void) | null = null;
    vi.spyOn(AccountService, 'observeAuthState').mockImplementation((cb) => {
      observedCallback = cb;
      cb(null);
      return () => {};
    });

    const controller = new HeaderAuthSessionController();
    const cleanup = bindHeaderAuthSessionEffect(controller, () => {});
    HeaderAuthSessionController.setSharedController(controller);

    const signedInUser = {
      uid: 'dialog-member-404',
      email: 'dialog.member@example.com',
      displayName: 'Dialog Member',
      emailVerified: true,
    } as unknown as User;

    try {
      // 1) Signed-out AppShell opens GlobalMemberAccountDialog
      await i18n.changeLanguage('ar');
      const signedOutOpenShell = renderToStaticMarkup(
        createElement(
          AppShell,
          {
            isMemberAccountOpen: true,
            onOpenMemberAccount: () => {},
            onCloseMemberAccount: () => {},
          },
          createElement('div', null, 'Public Content')
        )
      );
      expect(signedOutOpenShell).toContain('id="header-member-account-btn"');
      expect(signedOutOpenShell).toContain('data-testid="header-member-account-btn"');
      expect(signedOutOpenShell).toContain('>تسجيل الدخول<');
      expect(signedOutOpenShell).toContain('id="global-member-account-dialog"');
      expect(signedOutOpenShell).toContain('aria-expanded="true"');
      expect((signedOutOpenShell.match(/\sid="header-member-account-btn"/g) || []).length).toBe(1);

      // 2) Signed-in AppShell opens the exact same GlobalMemberAccountDialog with "حسابي"
      observedCallback!(signedInUser);
      const signedInOpenShell = renderToStaticMarkup(
        createElement(
          AppShell,
          {
            isMemberAccountOpen: true,
            onOpenMemberAccount: () => {},
            onCloseMemberAccount: () => {},
          },
          createElement('div', null, 'Public Content')
        )
      );
      expect(signedInOpenShell).toContain('id="header-member-account-btn"');
      expect(signedInOpenShell).toContain('data-testid="header-member-account-btn"');
      expect(signedInOpenShell).toContain('>حسابي<');
      expect(signedInOpenShell).toContain('id="global-member-account-dialog"');
      expect(signedInOpenShell).toContain('aria-expanded="true"');
      expect((signedInOpenShell.match(/\sid="header-member-account-btn"/g) || []).length).toBe(1);

      // 3) Verify signed-in account profile and sign-out option remain accessible in AccountAuthWidget
      const widgetSource = readFileSync(
        resolve(__dirname, './AccountAuthWidget.tsx'),
        'utf8'
      );
      expect(widgetSource).toContain("setMode('profile')");
      expect(widgetSource).toContain('handleSignOut');
      expect(widgetSource).toContain('AccountService.signOut()');
      expect(widgetSource).toContain('تسجيل الخروج');
      expect(widgetSource).toContain('Sign Out');
    } finally {
      HeaderAuthSessionController.setSharedController(null);
      cleanup();
      await i18n.changeLanguage('ar');
    }
  });

  it('18. AUTH-05-R1: keeps Admin Portal button and AdminAccessGate authorization strictly separate from Header Firebase authentication', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);
    const gateController = new AdminGateResolutionController();

    const activeOwnerRecord: AdminUser = {
      id: 'uid-owner-900',
      name: 'Nadia Owner',
      email: 'owner@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    };
    adminRepo.seed(activeOwnerRecord);

    const ownerFirebaseUser = {
      uid: 'uid-owner-900',
      email: 'owner@promiseofplanet.org',
      displayName: 'Nadia Owner',
      emailVerified: true,
    } as unknown as User;

    const ordinaryFirebaseUser = {
      uid: 'uid-ordinary-901',
      email: 'reader@example.com',
      displayName: 'Ordinary Reader',
      emailVerified: true,
    } as unknown as User;

    // 1) Ordinary authenticated Firebase user sees "حسابي" / "My Account" in Header,
    //    but is DENIED by AdminAccessGate because Firebase auth alone is NOT administrative authorization
    const ordinaryHeaderController = new HeaderAuthSessionController({
      initialUser: ordinaryFirebaseUser,
      initialIsAuthLoading: false,
    });
    await i18n.changeLanguage('ar');
    const ordinaryHeaderHtml = renderToStaticMarkup(
      createElement(Header, {
        authSessionController: ordinaryHeaderController,
        onEnterAdmin: () => {},
        onOpenMemberAccount: () => {},
      })
    );
    expect(ordinaryHeaderHtml).toContain('>حسابي<');
    expect(ordinaryHeaderHtml).toContain('id="header-enter-admin-btn"');

    await gateController.handleAuthEvent(ordinaryFirebaseUser, (uid) =>
      adminIdentityService.resolveAdminForAuthenticatedUid(uid)
    );
    expect(gateController.getSnapshot().gateState).toBe('ADMIN_DENIED');
    expect(gateController.getSnapshot().adminUser).toBeNull();

    // 2) Signed-in Owner sees "حسابي" / "My Account" in Header AND clicking #header-member-account-btn
    //    opens GlobalMemberAccountDialog without automatically routing into Admin Portal
    const ownerHeaderController = new HeaderAuthSessionController({
      initialUser: ownerFirebaseUser,
      initialIsAuthLoading: false,
    });
    const ownerHeaderHtml = renderToStaticMarkup(
      createElement(Header, {
        authSessionController: ownerHeaderController,
        onEnterAdmin: () => {},
        onOpenMemberAccount: () => {},
      })
    );
    expect(ownerHeaderHtml).toContain('>حسابي<');
    expect(ownerHeaderHtml).toContain('id="header-enter-admin-btn"');

    const headerSource = readFileSync(
      resolve(__dirname, '../layout/Header.tsx'),
      'utf8'
    );
    // Verify #header-member-account-btn click handler only invokes onOpenMemberAccount and never onEnterAdmin
    const memberBtnBlock = headerSource.slice(
      headerSource.indexOf('Global Member Account Entry'),
      headerSource.indexOf('Admin Portal Gateway')
    );
    expect(memberBtnBlock).toContain('onOpenMemberAccount?.()');
    expect(memberBtnBlock).not.toContain('onEnterAdmin');

    // Meanwhile AdminAccessGate resolves the same Owner UID via admins/{uid}
    await gateController.handleAuthEvent(ownerFirebaseUser, (uid) =>
      adminIdentityService.resolveAdminForAuthenticatedUid(uid)
    );
    expect(gateController.getSnapshot().gateState).toBe('ADMIN_AUTHORIZED');
    expect(gateController.getSnapshot().adminUser?.role).toBe(AdminRole.Owner);
  });

  it('19. AUTH-05-R1: subscribes once on mount via AccountService.observeAuthState, prevents duplicate subscriptions, and cleans up observer on unmount', () => {
    let observedCallback: ((user: User | null) => void) | null = null;
    const unsubscribeSpy = vi.fn();
    const observeSpy = vi
      .spyOn(AccountService, 'observeAuthState')
      .mockImplementation((cb) => {
        observedCallback = cb;
        return unsubscribeSpy;
      });

    const controller = new HeaderAuthSessionController();
    const snapshots: boolean[] = [];

    // Mount via bindHeaderAuthSessionEffect (exact effect used in Header.tsx)
    const cleanup = bindHeaderAuthSessionEffect(controller, (snap) => {
      snapshots.push(snap.isSignedIn);
    });

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().subscriptionCount).toBe(1);
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    // Calling mount() again while already mounted must NOT create a duplicate subscription
    controller.mount();
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().subscriptionCount).toBe(1);

    // Emit signed-in user while mounted
    const activeUser = {
      uid: 'uid-lifecycle-707',
      email: 'lifecycle@promiseofplanet.org',
    } as unknown as User;
    observedCallback!(activeUser);
    expect(controller.getSnapshot().isSignedIn).toBe(true);

    // Unmount: must invoke unsubscribeSpy exactly once
    cleanup();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);

    // Late observer emissions after unmount must be ignored
    observedCallback!(null);
    expect(controller.getSnapshot().firebaseUser?.uid).toBe('uid-lifecycle-707');
    expect(snapshots).toEqual([false, true]);
  });
});
