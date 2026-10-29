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
import {
  AdminAccessGate,
  ADMIN_SIGNOUT_ERROR_MESSAGES,
  clearAdminPresentationSession,
  executeAdminSignOut,
} from '../layout/AdminAccessGate';
import { AdminRole, type AdminUser } from '../../types/admin';
import {
  AdminGateResolutionController,
  AdminIdentityServiceClass,
  AdminReadError,
  InMemoryAdminIdentityRepository,
} from '../../services/adminIdentityService';
import {
  GlobalMemberAccountDialog,
  GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS,
  GLOBAL_MEMBER_ADMIN_READ_ERROR_MESSAGES,
  GLOBAL_MEMBER_ADMIN_RETRY_LABELS,
  DialogAdminClassificationController,
  bindDialogAdminClassificationEffect,
  getGlobalMemberDialogTitle,
  handleGlobalMemberDialogKeyDown,
  invokeAuthorizedDialogAdminNavigation,
  restoreGlobalMemberDialogFocus,
} from './GlobalMemberAccountDialog';
import {
  AccountAuthWidget,
  FORGOT_PASSWORD_ACTION_LABELS,
  INCOMPLETE_ACCOUNT_SETUP_MESSAGES,
  REGISTRATION_ERROR_MESSAGES,
  getSafeWidgetErrorMessage,
} from './AccountAuthWidget';
import {
  AdminInvitationAcceptanceController,
  OPEN_ADMIN_PORTAL_ACTION_AR,
  OPEN_ADMIN_PORTAL_ACTION_EN,
} from './AdminInvitationAcceptancePanel';
import {
  AdminInvitationStatus,
  type AcceptAdminInvitationClientResponse,
} from '../../services/adminIdentityManagementClient';
import {
  AccountError,
  AccountService,
  AccountServiceClass,
  InMemoryAccountRepository,
  NEUTRAL_PASSWORD_RESET_MESSAGES,
  classifyRegistrationAuthError,
  getSafeRegistrationDiagnosticCode,
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

describe('AUTH-02B2, AUTH-05-R1 & AUTH-05-UAE1: Unified Account Entry & Server-Backed Admin Classification', () => {
  let accountRepo: InMemoryAccountRepository;
  let testService: TestableGlobalAccountService;

  beforeEach(async () => {
    accountRepo = new InMemoryAccountRepository();
    testService = new TestableGlobalAccountService(accountRepo);
    HeaderAuthSessionController.setSharedController(null);
    DialogAdminClassificationController.setSharedController(null);
    vi.restoreAllMocks();
    await i18n.changeLanguage('ar');
  });

  it('1. renders exactly one Header member account entry in the fixed control zone on desktop without duplicating forms or rendering redundant Header Admin Portal button', async () => {
    await i18n.changeLanguage('en');
    const signedOutController = new HeaderAuthSessionController({
      initialUser: null,
      initialIsAuthLoading: false,
    });
    const html = renderToStaticMarkup(
      createElement(Header, {
        authSessionController: signedOutController,
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
    // Redundant public Header Admin Portal button must be removed
    expect(html).not.toContain('id="header-enter-admin-btn"');
    // Header itself must not embed AccountAuthWidget's password/email inputs directly
    expect(html).not.toContain('type="password"');
  });

  it('2. exposes a single reachable account entry across mobile, tablet, and desktop viewports (320px, 390px, 768px, 1280px) with no duplicate account controls', async () => {
    await i18n.changeLanguage('ar');
    const headerSource = readFileSync(
      resolve(__dirname, '../layout/Header.tsx'),
      'utf8'
    );
    const signedOutController = new HeaderAuthSessionController({
      initialUser: null,
      initialIsAuthLoading: false,
    });
    const html = renderToStaticMarkup(
      createElement(Header, {
        authSessionController: signedOutController,
        onEnterAdmin: () => {},
        activePage: 'home',
        onOpenMemberAccount: () => {},
        isMemberAccountOpen: false,
      })
    );

    const buttonOccurrencesInSource = (
      headerSource.match(/\sid="header-member-account-btn"/g) || []
    ).length;
    expect(buttonOccurrencesInSource).toBe(1);
    expect(headerSource).not.toContain('header-enter-admin-btn');

    const renderedOccurrences = (
      html.match(/data-testid="header-member-account-btn"/g) || []
    ).length;
    expect(renderedOccurrences).toBe(1);
    expect(html).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar);
    // Responsive truncation and min-w-0 guards across 320px, 390px, 768px, and 1280px
    expect(html).toContain('max-w-[96px] min-[390px]:max-w-[135px] sm:max-w-none');
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
    expect(closedShellHtml).not.toContain('id="header-enter-admin-btn"');
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

  it('4. keeps sign-in and registration reachable inside GlobalMemberAccountDialog with dynamic state-consistent headings', async () => {
    const signedOutDialogController = new DialogAdminClassificationController({
      initialUser: null,
      initialIsAuthLoading: false,
    });

    const dialogEnHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: false,
        adminClassificationController: signedOutDialogController,
      })
    );
    const widgetEnHtml = renderToStaticMarkup(
      createElement(AccountAuthWidget, { isAr: false })
    );
    expect(dialogEnHtml).toContain(widgetEnHtml);
    expect(dialogEnHtml).toContain('>Sign In</h2>');
    expect(dialogEnHtml).not.toContain('My Account / Sign In');

    const dialogArHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        isAr: true,
        adminClassificationController: signedOutDialogController,
      })
    );
    const widgetArHtml = renderToStaticMarkup(
      createElement(AccountAuthWidget, { isAr: true })
    );
    expect(dialogArHtml).toContain(widgetArHtml);
    expect(dialogArHtml).toContain('>تسجيل الدخول</h2>');
    expect(dialogArHtml).not.toContain('حسابي / تسجيل الدخول');

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
    const orphanUser = {
      uid: 'uid-orphan-member',
      email: 'orphan@example.com',
      displayName: 'Orphan Member',
    } as unknown as User;
    testService.simulatedUser = orphanUser;

    expect(await testService.getCurrentAccount()).toBeNull();

    const recovery = await testService.recoverCurrentAccountProfile({
      displayName: 'Recovered Global Member',
    });
    expect(recovery.status).toBe('recovered');
    expect(recovery.account?.id).toBe('uid-orphan-member');
    expect(recovery.account?.displayName).toBe('Recovered Global Member');
    expect(testService.signOutCallCount).toBe(0);

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

    handleGlobalMemberDialogKeyDown({
      key: 'Escape',
      focusableElements: [],
      activeElement: null,
      onClose: handleClose,
    });

    expect(dialogOpen).toBe(false);
    expect(testService.signOutCallCount).toBe(0);
    expect((await testService.getCurrentAccount())?.id).toBe('uid-persistent');

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

      const { user, account } = await testService.register(
        'sharedmember@example.com',
        'SharedPass123!',
        'Shared Member'
      );
      expect(account?.id).toBe(user.uid);

      AccountService.setAuthUserProvider(() => user);
      EnrollmentService.setAuthProvider(() => user.uid);
      MemberTrainingAccessService.setAuthProvider(() => user.uid);

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

  it('9. removes the redundant Header Admin Portal button while preserving App.tsx AdminAccessGate wiring via GlobalMemberAccountDialog', () => {
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
    expect(headerHtml).not.toContain('id="header-enter-admin-btn"');
    expect(adminEntered).toBe(false);
    expect(memberOpened).toBe(false);

    const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(appSource).toContain('<AdminAccessGate');
    expect(appSource).toContain('setIsMemberAccountOpen(false)');
    expect(appSource).toContain('setIsAdminOpen(true)');
  });

  it('10. never uses FirebaseAuthProvider, mock admin identities, localStorage, sessionStorage, or cookies as Header/Dialog auth authority or grants administrative roles through public registration', async () => {
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
    expect(headerSource).not.toContain('sessionStorage');
    expect(headerSource).not.toContain('document.cookie');

    const dialogSource = readFileSync(
      resolve(__dirname, './GlobalMemberAccountDialog.tsx'),
      'utf8'
    );
    expect(dialogSource).toContain('AccountService.observeAuthState');
    expect(dialogSource).toContain(
      'AdminIdentityService.resolveAdminForAuthenticatedUid'
    );
    expect(dialogSource).not.toContain('localStorage');
    expect(dialogSource).not.toContain('sessionStorage');
    expect(dialogSource).not.toContain('document.cookie');

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

  it('11. renders correct Arabic RTL and English LTR labels and direction attributes in Header and GlobalMemberAccountDialog across loading, signed-out, and signed-in states', async () => {
    const signedOutHeaderCtrl = new HeaderAuthSessionController({
      initialUser: null,
      initialIsAuthLoading: false,
    });
    const signedOutDialogCtrl = new DialogAdminClassificationController({
      initialUser: null,
      initialIsAuthLoading: false,
    });

    await i18n.changeLanguage('ar');
    const headerAr = renderToStaticMarkup(
      createElement(Header, {
        authSessionController: signedOutHeaderCtrl,
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
        adminClassificationController: signedOutDialogCtrl,
      })
    );
    expect(dialogAr).toContain('dir="rtl"');
    expect(dialogAr).toContain('>تسجيل الدخول</h2>');
    expect(dialogAr).toContain('aria-label="إغلاق نافذة الحساب"');

    await i18n.changeLanguage('en');
    const headerEn = renderToStaticMarkup(
      createElement(Header, {
        authSessionController: signedOutHeaderCtrl,
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
        adminClassificationController: signedOutDialogCtrl,
      })
    );
    expect(dialogEn).toContain('dir="ltr"');
    expect(dialogEn).toContain('>Sign In</h2>');
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

  it('13. AUTH-05-UAE1: renders exact loading ("الحساب" / "Account"), signed-out ("تسجيل الدخول" / "Sign In"), and signed-in ("حسابي" / "My Account") labels in Header and Dialog via AccountService.observeAuthState', async () => {
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.loading.ar).toBe('الحساب');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.loading.en).toBe('Account');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar).toBe('تسجيل الدخول');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.en).toBe('Sign In');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.ar).toBe('حسابي');
    expect(GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.en).toBe('My Account');

    expect(getGlobalMemberDialogTitle(true, 'loading')).toBe('الحساب');
    expect(getGlobalMemberDialogTitle(false, 'loading')).toBe('Account');
    expect(getGlobalMemberDialogTitle(true, 'unauthenticated')).toBe('تسجيل الدخول');
    expect(getGlobalMemberDialogTitle(false, 'unauthenticated')).toBe('Sign In');
    expect(getGlobalMemberDialogTitle(true, 'authenticated')).toBe('حسابي');
    expect(getGlobalMemberDialogTitle(false, 'authenticated')).toBe('My Account');

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

  it('14. AUTH-05-UAE1: displays "حسابي" / "My Account" for Owner, Admin, Editor, RightsReviewer, and ordinary members when authenticated in Firebase Auth, and never infers auth from mock admins', async () => {
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

  it('15. AUTH-05-UAE1: maintains an accessible, neutral initial loading state ("الحساب" / "Account") in both Header and Dialog until AccountService.observeAuthState resolves the session', async () => {
    let observedCallback: ((user: User | null) => void) | null = null;
    vi.spyOn(AccountService, 'observeAuthState').mockImplementation((cb) => {
      observedCallback = cb;
      // Do not invoke cb yet: simulates pending initial Firebase Auth resolution
      return () => {};
    });

    const controller = new HeaderAuthSessionController();
    const cleanup = bindHeaderAuthSessionEffect(controller, () => {});
    const dialogController = new DialogAdminClassificationController({
      observeAuthState: () => () => {},
    });
    const cleanupDialog = bindDialogAdminClassificationEffect(dialogController, () => {});

    try {
      expect(controller.getSnapshot().isAuthLoading).toBe(true);
      expect(controller.getSnapshot().isSignedIn).toBe(false);
      expect(controller.getSnapshot().firebaseUser).toBeNull();
      expect(dialogController.getSnapshot().authState).toBe('loading');

      await i18n.changeLanguage('ar');
      const loadingArHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(loadingArHtml).toContain('aria-busy="true"');
      expect(loadingArHtml).toContain('data-auth-state="loading"');
      expect(loadingArHtml).toContain('>الحساب<');
      expect(loadingArHtml).not.toContain('>تسجيل الدخول<');
      expect(loadingArHtml).not.toContain('>حسابي<');

      const loadingDialogArHtml = renderToStaticMarkup(
        createElement(GlobalMemberAccountDialog, {
          isOpen: true,
          onClose: () => {},
          isAr: true,
          adminClassificationController: dialogController,
        })
      );
      expect(loadingDialogArHtml).toContain('data-auth-state="loading"');
      expect(loadingDialogArHtml).toContain('>الحساب</h2>');

      await i18n.changeLanguage('en');
      const loadingEnHtml = renderToStaticMarkup(
        createElement(Header, { authSessionController: controller })
      );
      expect(loadingEnHtml).toContain('aria-busy="true"');
      expect(loadingEnHtml).toContain('data-auth-state="loading"');
      expect(loadingEnHtml).toContain('>Account<');
      expect(loadingEnHtml).not.toContain('>Sign In<');
      expect(loadingEnHtml).not.toContain('>My Account<');

      const loadingDialogEnHtml = renderToStaticMarkup(
        createElement(GlobalMemberAccountDialog, {
          isOpen: true,
          onClose: () => {},
          isAr: false,
          adminClassificationController: dialogController,
        })
      );
      expect(loadingDialogEnHtml).toContain('data-auth-state="loading"');
      expect(loadingDialogEnHtml).toContain('>Account</h2>');

      // Even if a user object is passed to getGlobalMemberAccountLabel while isAuthLoading is true, it must stay neutral
      const pendingUser = {
        uid: 'pending-uid-100',
        email: 'pending@promiseofplanet.org',
      } as unknown as User;
      expect(getGlobalMemberAccountLabel(true, pendingUser, true)).toBe('الحساب');
      expect(getGlobalMemberAccountLabel(false, pendingUser, true)).toBe('Account');

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
      cleanupDialog();
      cleanup();
      await i18n.changeLanguage('ar');
    }
  });

  it('16. AUTH-05-UAE1: reactively transitions label on sign-in and sign-out via AccountService.observeAuthState without page refresh', async () => {
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

  it('17. AUTH-05-UAE1: opens GlobalMemberAccountDialog in both signed-out and signed-in states with synchronized dynamic headings and keeps signed-in account profile and sign-out action accessible', async () => {
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
      // 1) Signed-out AppShell opens GlobalMemberAccountDialog with "تسجيل الدخول"
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
      expect(signedOutOpenShell).toContain('>تسجيل الدخول</h2>');
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
      expect(signedInOpenShell).toContain('>حسابي</h2>');
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

  it('18. AUTH-05-UAE1: exposes Admin Dashboard action inside GlobalMemberAccountDialog for active Owner, Admin, Editor, and RightsReviewer while omitting it for ordinary members, without auto-redirecting on login', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);
    const gateController = new AdminGateResolutionController();

    const activeAdmins: Array<{ user: User; adminRecord: AdminUser }> = [
      {
        user: {
          uid: 'uid-owner-900',
          email: 'owner@promiseofplanet.org',
          displayName: 'Nadia Owner',
          emailVerified: true,
        } as unknown as User,
        adminRecord: {
          id: 'uid-owner-900',
          name: 'Nadia Owner',
          email: 'owner@promiseofplanet.org',
          role: AdminRole.Owner,
          isActive: true,
        },
      },
      {
        user: {
          uid: 'uid-admin-901',
          email: 'admin@promiseofplanet.org',
          displayName: 'Tariq Admin',
          emailVerified: true,
        } as unknown as User,
        adminRecord: {
          id: 'uid-admin-901',
          name: 'Tariq Admin',
          email: 'admin@promiseofplanet.org',
          role: AdminRole.TrainingManager,
          isActive: true,
        },
      },
      {
        user: {
          uid: 'uid-editor-902',
          email: 'editor@promiseofplanet.org',
          displayName: 'Leila Editor',
          emailVerified: true,
        } as unknown as User,
        adminRecord: {
          id: 'uid-editor-902',
          name: 'Leila Editor',
          email: 'editor@promiseofplanet.org',
          role: AdminRole.ContentEditor,
          isActive: true,
        },
      },
      {
        user: {
          uid: 'uid-reviewer-903',
          email: 'reviewer@promiseofplanet.org',
          displayName: 'Omar Reviewer',
          emailVerified: true,
        } as unknown as User,
        adminRecord: {
          id: 'uid-reviewer-903',
          name: 'Omar Reviewer',
          email: 'reviewer@promiseofplanet.org',
          role: AdminRole.RightsReviewer,
          isActive: true,
        },
      },
    ];

    for (const item of activeAdmins) {
      adminRepo.seed(item.adminRecord);
    }

    const ordinaryUser = {
      uid: 'uid-ordinary-904',
      email: 'reader@example.com',
      displayName: 'Ordinary Reader',
      emailVerified: true,
    } as unknown as User;

    const onEnterAdminSpy = vi.fn();

    // 1) Ordinary authenticated member: sees "حسابي" / "My Account", NO Admin Dashboard button
    const ordinaryDialogController = new DialogAdminClassificationController({
      resolveAdminForUid: (uid) =>
        adminIdentityService.resolveAdminForAuthenticatedUid(uid),
    });
    const ordinarySnap = await ordinaryDialogController.handleAuthEvent(ordinaryUser);
    expect(ordinarySnap.authState).toBe('authenticated');
    expect(ordinarySnap.adminStatus).toBe('non_admin');
    expect(ordinarySnap.adminUser).toBeNull();

    const ordinaryDialogAr = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: onEnterAdminSpy,
        isAr: true,
        adminClassificationController: ordinaryDialogController,
      })
    );
    expect(ordinaryDialogAr).toContain('>حسابي</h2>');
    expect(ordinaryDialogAr).toContain('data-admin-status="non_admin"');
    expect(ordinaryDialogAr).not.toContain('id="global-member-enter-admin-btn"');
    expect(ordinaryDialogAr).not.toContain(
      GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.ar
    );
    expect(ordinaryDialogAr).not.toContain(
      'data-testid="global-member-admin-error-banner"'
    );
    expect(
      invokeAuthorizedDialogAdminNavigation(ordinarySnap, onEnterAdminSpy)
    ).toBe(false);
    expect(onEnterAdminSpy).not.toHaveBeenCalled();

    // 2) Active Owner, Admin (TrainingManager), Editor (ContentEditor), and RightsReviewer: each resolves as 'authorized' and renders "الانتقال إلى لوحة الإدارة" / "Open Admin Dashboard" without auto-redirecting
    for (const item of activeAdmins) {
      onEnterAdminSpy.mockClear();
      const adminDialogController = new DialogAdminClassificationController({
        resolveAdminForUid: (uid) =>
          adminIdentityService.resolveAdminForAuthenticatedUid(uid),
      });
      const snap = await adminDialogController.handleAuthEvent(item.user);
      expect(snap.authState).toBe('authenticated');
      expect(snap.adminStatus).toBe('authorized');
      expect(snap.adminUser?.id).toBe(item.user.uid);
      expect(snap.adminUser?.role).toBe(item.adminRecord.role);
      // Must NOT auto-redirect on authentication
      expect(onEnterAdminSpy).not.toHaveBeenCalled();

      const htmlAr = renderToStaticMarkup(
        createElement(GlobalMemberAccountDialog, {
          isOpen: true,
          onClose: () => {},
          onEnterAdmin: onEnterAdminSpy,
          isAr: true,
          adminClassificationController: adminDialogController,
        })
      );
      expect(htmlAr).toContain('>حسابي</h2>');
      expect(htmlAr).toContain('data-admin-status="authorized"');
      expect(htmlAr).toContain('id="global-member-enter-admin-btn"');
      expect(htmlAr).toContain(GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.ar);
      expect(htmlAr).toContain(item.adminRecord.role);

      const htmlEn = renderToStaticMarkup(
        createElement(GlobalMemberAccountDialog, {
          isOpen: true,
          onClose: () => {},
          onEnterAdmin: onEnterAdminSpy,
          isAr: false,
          adminClassificationController: adminDialogController,
        })
      );
      expect(htmlEn).toContain('>My Account</h2>');
      expect(htmlEn).toContain('id="global-member-enter-admin-btn"');
      expect(htmlEn).toContain(GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.en);

      // Clicking Open Admin Dashboard invokes onEnterAdmin and AdminAccessGate remains final checkpoint
      expect(onEnterAdminSpy).not.toHaveBeenCalled();
      expect(
        invokeAuthorizedDialogAdminNavigation(snap, onEnterAdminSpy)
      ).toBe(true);
      expect(onEnterAdminSpy).toHaveBeenCalledTimes(1);

      await gateController.handleAuthEvent(item.user, (uid) =>
        adminIdentityService.resolveAdminForAuthenticatedUid(uid)
      );
      expect(gateController.getSnapshot().gateState).toBe('ADMIN_AUTHORIZED');
      expect(gateController.getSnapshot().adminUser?.role).toBe(
        item.adminRecord.role
      );
    }
  });

  it('19. AUTH-05-UAE1: subscribes once on mount via AccountService.observeAuthState, prevents duplicate subscriptions, and cleans up observer on unmount', () => {
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

  it('20. AUTH-05-UAE1: denies administrative navigation for deactivated administrator, missing record, or malformed record, and never infers authority from email or displayName', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);

    // 1) Deactivated administrator (isActive: false)
    adminRepo.seed({
      id: 'uid-deactivated-admin',
      name: 'Deactivated Admin',
      email: 'deactivated@promiseofplanet.org',
      role: AdminRole.TrainingManager,
      isActive: false,
    });

    // 2) Malformed administrator records
    adminRepo.seed({
      id: 'uid-malformed-role',
      name: 'Invalid Role User',
      email: 'badrole@promiseofplanet.org',
      role: 'SuperRoot',
      isActive: true,
    });

    const controller = new DialogAdminClassificationController({
      resolveAdminForUid: (uid) =>
        adminIdentityService.resolveAdminForAuthenticatedUid(uid),
    });

    // Test deactivated admin
    const deactivatedSnap = await controller.handleAuthEvent({
      uid: 'uid-deactivated-admin',
      email: 'deactivated@promiseofplanet.org',
      displayName: 'Owner',
    } as unknown as User);
    expect(deactivatedSnap.adminStatus).toBe('non_admin');
    expect(deactivatedSnap.adminUser).toBeNull();
    expect(invokeAuthorizedDialogAdminNavigation(deactivatedSnap, () => {})).toBe(
      false
    );

    const deactivatedHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: true,
        adminClassificationController: controller,
      })
    );
    expect(deactivatedHtml).not.toContain('id="global-member-enter-admin-btn"');

    // Test malformed role record
    const malformedSnap = await controller.handleAuthEvent({
      uid: 'uid-malformed-role',
      email: 'badrole@promiseofplanet.org',
      displayName: 'Owner',
    } as unknown as User);
    expect(malformedSnap.adminStatus).toBe('non_admin');
    expect(malformedSnap.adminUser).toBeNull();

    // Test mismatched UID from custom resolver (e.g., returned record id !== authenticated uid)
    const mismatchedSnap = await controller.handleAuthEvent(
      {
        uid: 'uid-victim-member',
        email: 'owner@promiseofplanet.org',
        displayName: 'Platform Owner',
      } as unknown as User,
      async () => ({
        id: 'uid-other-admin',
        name: 'Other Admin',
        email: 'owner@promiseofplanet.org',
        role: AdminRole.Owner,
        isActive: true,
      })
    );
    expect(mismatchedSnap.adminStatus).toBe('non_admin');
    expect(mismatchedSnap.adminUser).toBeNull();
  });

  it('21. AUTH-05-UAE1: distinguishes Firestore read failure (AdminReadError) from confirmed non-admin, fails closed while preserving member profile, and recovers on explicit Retry without uncontrolled retry loops', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);

    const adminUserRecord: AdminUser = {
      id: 'uid-transient-admin',
      name: 'Transient Admin',
      email: 'transient@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };
    adminRepo.seed(adminUserRecord);
    adminRepo.setShouldFail(true);

    let lookupCalls = 0;
    const controller = new DialogAdminClassificationController({
      resolveAdminForUid: async (uid) => {
        lookupCalls += 1;
        return await adminIdentityService.resolveAdminForAuthenticatedUid(uid);
      },
    });

    const firebaseAdminUser = {
      uid: 'uid-transient-admin',
      email: 'transient@promiseofplanet.org',
      displayName: 'Transient Admin',
    } as unknown as User;

    // 1) Initial lookup fails with AdminReadError -> fails closed with status 'error' (exactly 1 read, no retry loop)
    const errorSnap = await controller.handleAuthEvent(firebaseAdminUser);
    expect(lookupCalls).toBe(1);
    expect(errorSnap.authState).toBe('authenticated');
    expect(errorSnap.adminStatus).toBe('error');
    expect(errorSnap.errorCode).toBe('ADMIN_READ_FAILURE');
    expect(errorSnap.adminUser).toBeNull();
    expect(invokeAuthorizedDialogAdminNavigation(errorSnap, () => {})).toBe(
      false
    );

    const errorHtmlAr = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: true,
        adminClassificationController: controller,
      })
    );
    expect(errorHtmlAr).toContain('data-admin-status="error"');
    expect(errorHtmlAr).toContain('data-testid="global-member-admin-error-banner"');
    expect(errorHtmlAr).toContain('data-error-code="ADMIN_READ_FAILURE"');
    expect(errorHtmlAr).toContain(GLOBAL_MEMBER_ADMIN_READ_ERROR_MESSAGES.ar);
    expect(errorHtmlAr).toContain('data-testid="global-member-admin-retry-btn"');
    expect(errorHtmlAr).toContain(GLOBAL_MEMBER_ADMIN_RETRY_LABELS.ar);
    expect(errorHtmlAr).not.toContain('id="global-member-enter-admin-btn"');
    // Member profile widget remains rendered and accessible
    expect(errorHtmlAr).toContain(
      renderToStaticMarkup(createElement(AccountAuthWidget, { isAr: true }))
    );

    const errorHtmlEn = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: false,
        adminClassificationController: controller,
      })
    );
    expect(errorHtmlEn).toContain(GLOBAL_MEMBER_ADMIN_READ_ERROR_MESSAGES.en);
    expect(errorHtmlEn).toContain(GLOBAL_MEMBER_ADMIN_RETRY_LABELS.en);

    // 2) Transient failure clears -> explicit retry (recheckAdminEligibility) recovers and authorizes
    adminRepo.setShouldFail(false);
    const recoveredSnap = await controller.recheckAdminEligibility();
    expect(lookupCalls).toBe(2);
    expect(recoveredSnap.adminStatus).toBe('authorized');
    expect(recoveredSnap.errorCode).toBeNull();
    expect(recoveredSnap.adminUser?.role).toBe(AdminRole.ContentEditor);

    const recoveredHtml = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: false,
        adminClassificationController: controller,
      })
    );
    expect(recoveredHtml).toContain('data-admin-status="authorized"');
    expect(recoveredHtml).toContain('id="global-member-enter-admin-btn"');
    expect(recoveredHtml).not.toContain(
      'data-testid="global-member-admin-error-banner"'
    );
  });

  it('22. AUTH-05-UAE1: reflects role change or deactivation on re-evaluation and fails closed if re-evaluation throws AdminReadError', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);

    const uid = 'uid-mutable-admin';
    adminRepo.seed({
      id: uid,
      name: 'Mutable Admin',
      email: 'mutable@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    });

    const user = {
      uid,
      email: 'mutable@promiseofplanet.org',
    } as unknown as User;

    const controller = new DialogAdminClassificationController({
      resolveAdminForUid: (targetUid) =>
        adminIdentityService.resolveAdminForAuthenticatedUid(targetUid),
    });

    // Step 1: Initially ContentEditor
    const snap1 = await controller.handleAuthEvent(user);
    expect(snap1.adminStatus).toBe('authorized');
    expect(snap1.adminUser?.role).toBe(AdminRole.ContentEditor);

    // Step 2: Role changed to RightsReviewer on server -> re-evaluation updates role
    adminRepo.seed({
      id: uid,
      name: 'Mutable Admin',
      email: 'mutable@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    });
    const snap2 = await controller.recheckAdminEligibility();
    expect(snap2.adminStatus).toBe('authorized');
    expect(snap2.adminUser?.role).toBe(AdminRole.RightsReviewer);

    // Step 3: Deactivated on server (isActive: false) -> re-evaluation immediately revokes dialog admin navigation
    adminRepo.seed({
      id: uid,
      name: 'Mutable Admin',
      email: 'mutable@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: false,
    });
    const snap3 = await controller.recheckAdminEligibility();
    expect(snap3.adminStatus).toBe('non_admin');
    expect(snap3.adminUser).toBeNull();
    expect(invokeAuthorizedDialogAdminNavigation(snap3, () => {})).toBe(false);

    // Step 4: Re-activated, then Firestore read fails during re-evaluation -> fails closed (does not retain stale authorization)
    adminRepo.seed({
      id: uid,
      name: 'Mutable Admin',
      email: 'mutable@promiseofplanet.org',
      role: AdminRole.RightsReviewer,
      isActive: true,
    });
    await controller.recheckAdminEligibility();
    expect(controller.getSnapshot().adminStatus).toBe('authorized');

    const failSnap = await controller.recheckAdminEligibility(async () => {
      throw new AdminReadError('ADMIN_READ_FAILURE');
    });
    expect(failSnap.adminStatus).toBe('error');
    expect(failSnap.adminUser).toBeNull();
  });

  it('23. AUTH-05-UAE1: enforces race safety across UID switch, logout, and unmount during in-flight admin lookups', async () => {
    let resolveAdminA!: (val: AdminUser | null) => void;
    const pendingAdminAPromise = new Promise<AdminUser | null>((res) => {
      resolveAdminA = res;
    });

    let resolveAdminB!: (val: AdminUser | null) => void;
    const pendingAdminBPromise = new Promise<AdminUser | null>((res) => {
      resolveAdminB = res;
    });

    const controller = new DialogAdminClassificationController({
      resolveAdminForUid: (uid) => {
        if (uid === 'uid-admin-a') return pendingAdminAPromise;
        if (uid === 'uid-member-b') return pendingAdminBPromise;
        return Promise.resolve(null);
      },
    });

    const userA = {
      uid: 'uid-admin-a',
      email: 'admin.a@promiseofplanet.org',
    } as unknown as User;
    const userB = {
      uid: 'uid-member-b',
      email: 'member.b@promiseofplanet.org',
    } as unknown as User;

    // 1) Start lookup for User A (in-flight)
    const taskA = controller.handleAuthEvent(userA);
    expect(controller.getSnapshot().adminStatus).toBe('resolving');
    expect(controller.getSnapshot().firebaseUser?.uid).toBe('uid-admin-a');

    // 2) Switch to User B before User A's lookup finishes
    const taskB = controller.handleAuthEvent(userB);
    expect(controller.getSnapshot().adminStatus).toBe('resolving');
    expect(controller.getSnapshot().firebaseUser?.uid).toBe('uid-member-b');
    expect(controller.getSnapshot().adminUser).toBeNull();

    // User A's stale admin record resolves late -> MUST be ignored and never grant admin to User B!
    resolveAdminA({
      id: 'uid-admin-a',
      name: 'Admin A',
      email: 'admin.a@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    });
    await taskA;
    expect(controller.getSnapshot().firebaseUser?.uid).toBe('uid-member-b');
    expect(controller.getSnapshot().adminStatus).toBe('resolving');
    expect(controller.getSnapshot().adminUser).toBeNull();

    // User B resolves as non-admin
    resolveAdminB(null);
    await taskB;
    expect(controller.getSnapshot().adminStatus).toBe('non_admin');
    expect(controller.getSnapshot().adminUser).toBeNull();

    // 3) Logout during in-flight lookup
    let resolveAdminC!: (val: AdminUser | null) => void;
    const pendingAdminCPromise = new Promise<AdminUser | null>((res) => {
      resolveAdminC = res;
    });
    const userC = {
      uid: 'uid-admin-c',
      email: 'admin.c@promiseofplanet.org',
    } as unknown as User;

    const taskC = controller.handleAuthEvent(userC, () => pendingAdminCPromise);
    expect(controller.getSnapshot().adminStatus).toBe('resolving');

    // User logs out before lookup finishes
    await controller.handleAuthEvent(null);
    expect(controller.getSnapshot().authState).toBe('unauthenticated');
    expect(controller.getSnapshot().adminStatus).toBe('idle');
    expect(controller.getSnapshot().adminUser).toBeNull();

    // Late resolution for User C after logout -> MUST be ignored!
    resolveAdminC({
      id: 'uid-admin-c',
      name: 'Admin C',
      email: 'admin.c@promiseofplanet.org',
      role: AdminRole.TrainingManager,
      isActive: true,
    });
    await taskC;
    expect(controller.getSnapshot().authState).toBe('unauthenticated');
    expect(controller.getSnapshot().adminStatus).toBe('idle');
    expect(controller.getSnapshot().adminUser).toBeNull();

    // 4) Unmount during in-flight lookup
    let resolveAdminD!: (val: AdminUser | null) => void;
    const pendingAdminDPromise = new Promise<AdminUser | null>((res) => {
      resolveAdminD = res;
    });
    const userD = {
      uid: 'uid-admin-d',
      email: 'admin.d@promiseofplanet.org',
    } as unknown as User;

    const taskD = controller.handleAuthEvent(userD, () => pendingAdminDPromise);
    expect(controller.getSnapshot().adminStatus).toBe('resolving');

    controller.unmount();
    resolveAdminD({
      id: 'uid-admin-d',
      name: 'Admin D',
      email: 'admin.d@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    });
    await taskD;
    expect(controller.getSnapshot().adminStatus).toBe('resolving');
    expect(controller.getSnapshot().adminUser).toBeNull();
  });

  it('24. AUTH-05-UAE1: coordinates AdminInvitationAcceptancePanel with server-backed admin classification without duplicating admin navigation buttons or granting authority from client-side display alone', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);

    const inviteeUser = {
      uid: 'uid-invitee-501',
      email: 'invitee@promiseofplanet.org',
      emailVerified: true,
    } as unknown as User;

    const acceptedResponse: AcceptAdminInvitationClientResponse = {
      invitation: {
        invitationId: 'inv_uae1_20261028_01',
        targetUid: 'uid-invitee-501',
        normalizedTargetEmail: 'invitee@promiseofplanet.org',
        intendedRole: AdminRole.ContentEditor,
        invitingOwnerUid: 'uid-owner-900',
        createdAtIso: '2026-10-28T08:00:00.000Z',
        expiresAtIso: '2026-11-04T08:00:00.000Z',
        status: AdminInvitationStatus.Accepted,
        acceptedAtIso: '2026-10-28T09:00:00.000Z',
        acceptedByUid: 'uid-invitee-501',
        revokedAtIso: null,
        revokedByOwnerUid: null,
        expiredAtIso: null,
        revision: 2,
      },
      admin: {
        id: 'uid-invitee-501',
        name: 'Invitee Editor',
        email: 'invitee@promiseofplanet.org',
        role: AdminRole.ContentEditor,
        isActive: true,
      },
      auditEventId: 'audit_uae1_501',
    };

    const dialogAdminController = new DialogAdminClassificationController({
      resolveAdminForUid: (uid) =>
        adminIdentityService.resolveAdminForAuthenticatedUid(uid),
    });

    // Before acceptance: user is an ordinary member (no admins/{uid} record yet)
    await dialogAdminController.handleAuthEvent(inviteeUser);
    expect(dialogAdminController.getSnapshot().adminStatus).toBe('non_admin');

    // Case A: If client-side acceptance state is shown WITHOUT a backing server admins/{uid} record,
    // recheckAdminEligibility() still resolves 'non_admin' (never grants authority from client display alone)
    const unbackedSnap = await dialogAdminController.recheckAdminEligibility();
    expect(unbackedSnap.adminStatus).toBe('non_admin');
    expect(unbackedSnap.adminUser).toBeNull();

    // Case B: Server transaction writes admins/{uid} during acceptance, then recheckAdminEligibility() resolves 'authorized'
    adminRepo.seed(acceptedResponse.admin);
    const backedSnap = await dialogAdminController.recheckAdminEligibility();
    expect(backedSnap.adminStatus).toBe('authorized');
    expect(backedSnap.adminUser?.role).toBe(AdminRole.ContentEditor);

    // While AdminInvitationAcceptancePanel is in 'succeeded' post-acceptance state,
    // GlobalMemberAccountDialog suppresses #global-member-enter-admin-btn so there is only ONE admin portal/dashboard button in the dialog
    const acceptanceController = new AdminInvitationAcceptanceController({
      status: 'succeeded',
      result: acceptedResponse,
      error: null,
      submissionCount: 1,
    });

    const postAcceptanceDialogAr = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: true,
        adminClassificationController: dialogAdminController,
        invitationAcceptanceProps: {
          initialAuthStatus: {
            authenticated: true,
            uid: inviteeUser.uid,
            email: inviteeUser.email,
            emailVerified: true,
          },
          initialAcceptanceState: acceptanceController.getSnapshot(),
        },
      })
    );
    expect(postAcceptanceDialogAr).toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );
    expect(postAcceptanceDialogAr).toContain(OPEN_ADMIN_PORTAL_ACTION_AR);
    expect(postAcceptanceDialogAr).not.toContain(
      'id="global-member-enter-admin-btn"'
    );

    const postAcceptanceDialogEn = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: false,
        adminClassificationController: dialogAdminController,
        invitationAcceptanceProps: {
          initialAuthStatus: {
            authenticated: true,
            uid: inviteeUser.uid,
            email: inviteeUser.email,
            emailVerified: true,
          },
          initialAcceptanceState: acceptanceController.getSnapshot(),
        },
      })
    );
    expect(postAcceptanceDialogEn).toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );
    expect(postAcceptanceDialogEn).toContain(OPEN_ADMIN_PORTAL_ACTION_EN);
    expect(postAcceptanceDialogEn).not.toContain(
      'id="global-member-enter-admin-btn"'
    );

    // On subsequent normal dialog opens (idle invitation panel), #global-member-enter-admin-btn is shown
    const normalAdminDialogEn = renderToStaticMarkup(
      createElement(GlobalMemberAccountDialog, {
        isOpen: true,
        onClose: () => {},
        onEnterAdmin: () => {},
        isAr: false,
        adminClassificationController: dialogAdminController,
      })
    );
    expect(normalAdminDialogEn).toContain('id="global-member-enter-admin-btn"');
    expect(normalAdminDialogEn).toContain(
      GLOBAL_MEMBER_ADMIN_DASHBOARD_ACTION_LABELS.en
    );
    expect(normalAdminDialogEn).not.toContain(
      'data-testid="open-admin-portal-after-acceptance-btn"'
    );
  });

  it('25. AUTH-05-UAE1-R1: administrative Sign Out executes AccountService.signOut(), clears pop_admin_session, invokes onExitAdmin() to return to the public website without reopening GlobalMemberAccountDialog or remaining on legacy AdminAccessGate login screen, and resolves Header to Sign In / تسجيل الدخول', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);
    const ownerAdmin: AdminUser = {
      id: 'uid-owner-logout-01',
      name: 'Owner Admin',
      email: 'owner.logout@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    };
    adminRepo.seed(ownerAdmin);

    const firebaseOwnerUser = {
      uid: ownerAdmin.id,
      email: ownerAdmin.email,
      displayName: ownerAdmin.name,
    } as unknown as User;

    // Set up a mock sessionStorage tracking pop_admin_session
    const storageMap = new Map<string, string>([
      ['pop_admin_session', JSON.stringify({ open: true, tab: 'overview' })],
    ]);
    const mockStorage: Pick<Storage, 'removeItem'> = {
      removeItem: (key: string) => {
        storageMap.delete(key);
      },
    };

    // Set up shared auth observer bus simulating AccountService.observeAuthState + AccountService.signOut
    let activeUser: User | null = firebaseOwnerUser;
    const authListeners = new Set<(user: User | null) => void>();
    const observeSpy = vi
      .spyOn(AccountService, 'observeAuthState')
      .mockImplementation((cb) => {
        authListeners.add(cb);
        cb(activeUser);
        return () => {
          authListeners.delete(cb);
        };
      });

    let signOutCalls = 0;
    const signOutSpy = vi
      .spyOn(AccountService, 'signOut')
      .mockImplementation(async () => {
        signOutCalls += 1;
        activeUser = null;
        for (const listener of authListeners) {
          listener(null);
        }
      });

    // Bind Header auth controller and AdminGateResolutionController to the same auth bus
    const headerController = new HeaderAuthSessionController();
    const unbindHeader = bindHeaderAuthSessionEffect(
      headerController,
      () => {}
    );
    HeaderAuthSessionController.setSharedController(headerController);

    const gateController = new AdminGateResolutionController();
    gateController.mount();
    await gateController.handleAuthEvent(firebaseOwnerUser, (uid) =>
      adminIdentityService.resolveAdminForAuthenticatedUid(uid)
    );

    // Track top-level App routing state (isAdminOpen & isMemberAccountOpen)
    let isAdminOpen = true;
    let isMemberAccountOpen = false;
    let exitAdminCallCount = 0;

    const handleExitAdmin = () => {
      exitAdminCallCount += 1;
      isAdminOpen = false;
      clearAdminPresentationSession(mockStorage);
    };

    try {
      // 1) Before logout: AdminAccessGate is open and renders authorized AdminLayout with #signout-admin-btn and #exit-admin-btn
      expect(gateController.getSnapshot().gateState).toBe('ADMIN_AUTHORIZED');
      expect(headerController.getSnapshot().isSignedIn).toBe(true);

      await i18n.changeLanguage('ar');
      const adminAuthorizedHtmlAr = renderToStaticMarkup(
        createElement(AdminAccessGate, {
          onExitAdmin: handleExitAdmin,
          identityService: adminIdentityService,
          gateController,
        })
      );
      expect(adminAuthorizedHtmlAr).toContain('id="admin-top-header"');
      expect(adminAuthorizedHtmlAr).toContain('id="signout-admin-btn"');
      expect(adminAuthorizedHtmlAr).toContain('id="exit-admin-btn"');
      expect(adminAuthorizedHtmlAr).toContain('تسجيل الخروج');
      expect(adminAuthorizedHtmlAr).not.toContain(
        'بوابة الإدارة - التسجيل مطلوب'
      );

      // 2) Administrator clicks Sign Out / تسجيل الخروج -> executes executeAdminSignOut (which calls AccountService.signOut() by default)
      const signOutResult = await executeAdminSignOut({
        clearAdminSessionStorage: () =>
          clearAdminPresentationSession(mockStorage),
        onExitAdmin: handleExitAdmin,
        isAr: true,
      });

      // Verify all required post-logout conditions:
      expect(signOutResult).toEqual({
        success: true,
        exitedToPublic: true,
        errorMessage: null,
      });
      expect(signOutCalls).toBe(1);
      expect(storageMap.has('pop_admin_session')).toBe(false);
      expect(exitAdminCallCount).toBe(1);
      expect(isAdminOpen).toBe(false);
      expect(isMemberAccountOpen).toBe(false);
      expect(headerController.getSnapshot().isSignedIn).toBe(false);

      // 3) Render the active top-level view after logout (isAdminOpen === false -> public AppShell)
      // Verify public website is rendered, GlobalMemberAccountDialog is closed, legacy AdminAccessGate is NOT rendered,
      // and Header displays تسجيل الدخول (AR) / Sign In (EN)
      const publicViewAfterLogoutAr = renderToStaticMarkup(
        createElement(
          AppShell,
          {
            onEnterAdmin: () => {
              isAdminOpen = true;
            },
            activePage: 'home',
            onNavigate: () => {},
            isMemberAccountOpen,
            onOpenMemberAccount: () => {
              isMemberAccountOpen = true;
            },
            onCloseMemberAccount: () => {
              isMemberAccountOpen = false;
            },
          },
          createElement(
            'div',
            { 'data-testid': 'public-home-destination' },
            'Public Website Content'
          )
        )
      );

      expect(publicViewAfterLogoutAr).toContain(
        'data-testid="public-home-destination"'
      );
      expect(publicViewAfterLogoutAr).toContain(
        'id="header-member-account-btn"'
      );
      expect(publicViewAfterLogoutAr).toContain(
        `>${GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.ar}<`
      );
      expect(publicViewAfterLogoutAr).not.toContain(
        `>${GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.ar}<`
      );
      expect(publicViewAfterLogoutAr).not.toContain(
        'id="global-member-account-dialog"'
      );
      expect(publicViewAfterLogoutAr).not.toContain(
        'بوابة الإدارة - التسجيل مطلوب'
      );
      expect(publicViewAfterLogoutAr).not.toContain(
        'Back-Office Access Control'
      );

      await i18n.changeLanguage('en');
      const publicViewAfterLogoutEn = renderToStaticMarkup(
        createElement(
          AppShell,
          {
            onEnterAdmin: () => {
              isAdminOpen = true;
            },
            activePage: 'home',
            onNavigate: () => {},
            isMemberAccountOpen,
            onOpenMemberAccount: () => {
              isMemberAccountOpen = true;
            },
            onCloseMemberAccount: () => {
              isMemberAccountOpen = false;
            },
          },
          createElement(
            'div',
            { 'data-testid': 'public-home-destination' },
            'Public Website Content'
          )
        )
      );
      expect(publicViewAfterLogoutEn).toContain(
        `>${GLOBAL_MEMBER_ACCOUNT_LABELS.signedOut.en}<`
      );
      expect(publicViewAfterLogoutEn).not.toContain(
        `>${GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.en}<`
      );
      expect(publicViewAfterLogoutEn).not.toContain(
        'id="global-member-account-dialog"'
      );
      expect(publicViewAfterLogoutEn).not.toContain(
        'Back-Office Access Control'
      );
    } finally {
      HeaderAuthSessionController.setSharedController(null);
      unbindHeader();
      gateController.unmount();
      observeSpy.mockRestore();
      signOutSpy.mockRestore();
      await i18n.changeLanguage('ar');
    }
  });

  it('26. AUTH-05-UAE1-R1: preserves distinct navigation semantics — Exit Portal / موقع المنصة returns to public website without signing out and keeps My Account / حسابي in Header', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);
    const editorAdmin: AdminUser = {
      id: 'uid-editor-exit-02',
      name: 'Editor Admin',
      email: 'editor.exit@promiseofplanet.org',
      role: AdminRole.ContentEditor,
      isActive: true,
    };
    adminRepo.seed(editorAdmin);

    const firebaseEditorUser = {
      uid: editorAdmin.id,
      email: editorAdmin.email,
      displayName: editorAdmin.name,
    } as unknown as User;

    let activeUser: User | null = firebaseEditorUser;
    let signOutCalls = 0;
    const observeSpy = vi
      .spyOn(AccountService, 'observeAuthState')
      .mockImplementation((cb) => {
        cb(activeUser);
        return () => {};
      });
    const signOutSpy = vi
      .spyOn(AccountService, 'signOut')
      .mockImplementation(async () => {
        signOutCalls += 1;
        activeUser = null;
      });

    const headerController = new HeaderAuthSessionController();
    const unbindHeader = bindHeaderAuthSessionEffect(
      headerController,
      () => {}
    );
    HeaderAuthSessionController.setSharedController(headerController);

    const storageMap = new Map<string, string>([
      ['pop_admin_session', JSON.stringify({ open: true, tab: 'news' })],
    ]);
    let isAdminOpen = true;
    let isMemberAccountOpen = false;

    try {
      // Administrator clicks "Exit Portal / موقع المنصة" (#exit-admin-btn invokes onExitAdmin directly, NOT handleSignOut)
      const onExitAdmin = () => {
        isAdminOpen = false;
        storageMap.delete('pop_admin_session');
      };

      onExitAdmin();

      // Session remains authenticated; AccountService.signOut was NEVER called
      expect(signOutCalls).toBe(0);
      expect(activeUser).toBe(firebaseEditorUser);
      expect(isAdminOpen).toBe(false);
      expect(isMemberAccountOpen).toBe(false);
      expect(storageMap.has('pop_admin_session')).toBe(false);
      expect(headerController.getSnapshot().isSignedIn).toBe(true);

      // Public website renders with Header showing حسابي (AR) and My Account (EN)
      await i18n.changeLanguage('ar');
      const publicAfterExitAr = renderToStaticMarkup(
        createElement(
          AppShell,
          {
            onEnterAdmin: () => {
              isAdminOpen = true;
            },
            activePage: 'home',
            onNavigate: () => {},
            isMemberAccountOpen,
            onOpenMemberAccount: () => {
              isMemberAccountOpen = true;
            },
            onCloseMemberAccount: () => {
              isMemberAccountOpen = false;
            },
          },
          createElement('div', null, 'Public View Preserving Session')
        )
      );
      expect(publicAfterExitAr).toContain(
        `>${GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.ar}<`
      );

      await i18n.changeLanguage('en');
      const publicAfterExitEn = renderToStaticMarkup(
        createElement(
          AppShell,
          {
            onEnterAdmin: () => {
              isAdminOpen = true;
            },
            activePage: 'home',
            onNavigate: () => {},
            isMemberAccountOpen,
            onOpenMemberAccount: () => {
              isMemberAccountOpen = true;
            },
            onCloseMemberAccount: () => {
              isMemberAccountOpen = false;
            },
          },
          createElement('div', null, 'Public View Preserving Session')
        )
      );
      expect(publicAfterExitEn).toContain(
        `>${GLOBAL_MEMBER_ACCOUNT_LABELS.signedIn.en}<`
      );
    } finally {
      HeaderAuthSessionController.setSharedController(null);
      unbindHeader();
      observeSpy.mockRestore();
      signOutSpy.mockRestore();
      await i18n.changeLanguage('ar');
    }
  });

  it('27. AUTH-05-UAE1-R1: handles failed AccountService.signOut() safely without claiming success, clearing session state, or invoking onExitAdmin(), and surfaces a non-sensitive error message', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);
    const ownerAdmin: AdminUser = {
      id: 'uid-owner-fail-signout',
      name: 'Owner Admin',
      email: 'owner.fail@promiseofplanet.org',
      role: AdminRole.Owner,
      isActive: true,
    };
    adminRepo.seed(ownerAdmin);

    const firebaseOwnerUser = {
      uid: ownerAdmin.id,
      email: ownerAdmin.email,
      displayName: ownerAdmin.name,
    } as unknown as User;

    const gateController = new AdminGateResolutionController();
    gateController.mount();
    await gateController.handleAuthEvent(firebaseOwnerUser, (uid) =>
      adminIdentityService.resolveAdminForAuthenticatedUid(uid)
    );

    const storageMap = new Map<string, string>([
      ['pop_admin_session', JSON.stringify({ open: true, tab: 'overview' })],
    ]);
    let isAdminOpen = true;
    let exitAdminCalls = 0;
    let capturedErrorAr: string | null = null;
    let capturedErrorEn: string | null = null;

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      // Simulate AccountService.signOut() throwing an error with sensitive internal details
      const failingSignOut = async () => {
        throw new Error(
          'INTERNAL_AUTH_TOKEN_FAILURE: uid=uid-owner-fail-signout token=secret-jwt-xyz'
        );
      };

      const failResultAr = await executeAdminSignOut({
        signOut: failingSignOut,
        clearAdminSessionStorage: () => {
          storageMap.delete('pop_admin_session');
        },
        onExitAdmin: () => {
          exitAdminCalls += 1;
          isAdminOpen = false;
        },
        onSignOutError: (msg) => {
          capturedErrorAr = msg;
        },
        isAr: true,
      });

      // Verify failure did NOT claim success, did NOT exit admin, did NOT clear pop_admin_session, and did NOT mark session signed out
      expect(failResultAr).toEqual({
        success: false,
        exitedToPublic: false,
        errorMessage: ADMIN_SIGNOUT_ERROR_MESSAGES.ar,
      });
      expect(exitAdminCalls).toBe(0);
      expect(isAdminOpen).toBe(true);
      expect(storageMap.has('pop_admin_session')).toBe(true);
      expect(gateController.getSnapshot().gateState).toBe('ADMIN_AUTHORIZED');
      expect(capturedErrorAr).toBe(ADMIN_SIGNOUT_ERROR_MESSAGES.ar);
      expect(capturedErrorAr).not.toContain('secret-jwt-xyz');
      expect(capturedErrorAr).not.toContain('uid-owner-fail-signout');

      // Render AdminAccessGate with the captured Arabic sign-out error -> shows safe alert banner above AdminLayout
      await i18n.changeLanguage('ar');
      const gateWithErrorAr = renderToStaticMarkup(
        createElement(AdminAccessGate, {
          onExitAdmin: () => {},
          identityService: adminIdentityService,
          gateController,
          initialSignOutError: capturedErrorAr,
        })
      );
      expect(gateWithErrorAr).toContain(
        'data-testid="admin-signout-error-banner"'
      );
      expect(gateWithErrorAr).toContain(ADMIN_SIGNOUT_ERROR_MESSAGES.ar);
      expect(gateWithErrorAr).not.toContain('secret-jwt-xyz');
      expect(gateWithErrorAr).toContain('id="admin-top-header"');

      // Verify English error message as well
      const failResultEn = await executeAdminSignOut({
        signOut: failingSignOut,
        clearAdminSessionStorage: () => {
          storageMap.delete('pop_admin_session');
        },
        onExitAdmin: () => {
          exitAdminCalls += 1;
        },
        onSignOutError: (msg) => {
          capturedErrorEn = msg;
        },
        isAr: false,
      });
      expect(failResultEn.success).toBe(false);
      expect(capturedErrorEn).toBe(ADMIN_SIGNOUT_ERROR_MESSAGES.en);

      await i18n.changeLanguage('en');
      const gateWithErrorEn = renderToStaticMarkup(
        createElement(AdminAccessGate, {
          onExitAdmin: () => {},
          identityService: adminIdentityService,
          gateController,
          initialSignOutError: capturedErrorEn,
        })
      );
      expect(gateWithErrorEn).toContain(
        'data-testid="admin-signout-error-banner"'
      );
      expect(gateWithErrorEn).toContain(ADMIN_SIGNOUT_ERROR_MESSAGES.en);
    } finally {
      consoleErrorSpy.mockRestore();
      gateController.unmount();
      await i18n.changeLanguage('ar');
    }
  });

  it('28. AUTH-05-UAE1-R1: preserves the administrative authorization boundary in AdminAccessGate and verifies handleSignOut invokes executeAdminSignOut with onExitAdmin', async () => {
    const adminRepo = new InMemoryAdminIdentityRepository();
    const adminIdentityService = new AdminIdentityServiceClass(adminRepo);

    // 1) Ordinary member without admins/{uid} is still denied by AdminAccessGate
    const deniedController = new AdminGateResolutionController();
    deniedController.mount();
    await deniedController.handleAuthEvent(
      {
        uid: 'uid-ordinary-member-gate',
        email: 'member.gate@promiseofplanet.org',
      } as unknown as User,
      (uid) => adminIdentityService.resolveAdminForAuthenticatedUid(uid)
    );
    expect(deniedController.getSnapshot().gateState).toBe('ADMIN_DENIED');

    await i18n.changeLanguage('en');
    const deniedHtmlEn = renderToStaticMarkup(
      createElement(AdminAccessGate, {
        onExitAdmin: () => {},
        identityService: adminIdentityService,
        gateController: deniedController,
      })
    );
    expect(deniedHtmlEn).toContain('Administrative Access Denied');
    expect(deniedHtmlEn).not.toContain('id="admin-top-header"');

    // 2) Verify AdminAccessGate source wires handleSignOut -> executeAdminSignOut with AccountService.signOut, clearAdminPresentationSession, and onExitAdmin
    const gateSource = readFileSync(
      resolve(process.cwd(), 'src/components/layout/AdminAccessGate.tsx'),
      'utf-8'
    );
    expect(gateSource).toContain('await signOut()');
    expect(gateSource).toContain('clearAdminSessionStorage()');
    expect(gateSource).toContain('onExitAdmin()');
    expect(gateSource).toContain('AccountService.signOut()');
    expect(gateSource).toContain("storage?.removeItem('pop_admin_session')");

    deniedController.unmount();
    await i18n.changeLanguage('ar');
  });

  it('29. AUTH-05-UAE1-R2: classifies mocked Firebase registration errors (existing email, invalid email, weak password, rate limit, network failure, operation not allowed, unknown error) by error.code without inspecting message text or leaking sensitive details', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    class ConfigurableRegisterFailureService extends AccountServiceClass {
      public nextFailure: unknown = null;
      public createCalls = 0;

      protected isConfigured(): boolean {
        return true;
      }

      protected async performCreateUser(
        _email: string,
        _password: string
      ): Promise<User> {
        this.createCalls += 1;
        throw this.nextFailure;
      }
    }

    const service = new ConfigurableRegisterFailureService(
      new InMemoryAccountRepository()
    );

    const makeFirebaseError = (code: string, message: string) => {
      const err = new Error(message) as Error & { code: string };
      err.code = code;
      return err;
    };

    try {
      // 1. Existing email: auth/email-already-in-use -> ACCOUNT_ALREADY_EXISTS
      service.nextFailure = makeFirebaseError(
        'auth/email-already-in-use',
        'Firebase: Error (auth/email-already-in-use). token=secret-tok-1'
      );
      await expect(
        service.register('existing@promiseofplanet.org', 'SecretPass!1')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'ACCOUNT_ALREADY_EXISTS',
        message: REGISTRATION_ERROR_MESSAGES.existingAccount.en,
      });

      // 2. Invalid email: auth/invalid-email -> ACCOUNT_DATA_INVALID with email-specific message
      service.nextFailure = makeFirebaseError(
        'auth/invalid-email',
        'Firebase: Error (auth/invalid-email). raw-input=bad@email'
      );
      await expect(
        service.register('bad@email', 'SecretPass!1')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'ACCOUNT_DATA_INVALID',
        message: REGISTRATION_ERROR_MESSAGES.invalidEmail.en,
      });

      // 3. Weak password: auth/weak-password -> REGISTRATION_WEAK_PASSWORD (never ACCOUNT_DATA_INVALID)
      service.nextFailure = makeFirebaseError(
        'auth/weak-password',
        'Firebase: Password should be at least 6 characters (auth/weak-password). pass=123'
      );
      let weakPassErr: AccountError | null = null;
      try {
        await service.register('weak@promiseofplanet.org', '123');
      } catch (e: any) {
        weakPassErr = e;
      }
      expect(weakPassErr).toBeInstanceOf(AccountError);
      expect(weakPassErr?.code).toBe('REGISTRATION_WEAK_PASSWORD');
      expect(weakPassErr?.code).not.toBe('ACCOUNT_DATA_INVALID');
      expect(weakPassErr?.message).toBe(
        REGISTRATION_ERROR_MESSAGES.weakPassword.en
      );

      // 4. Rate limit: auth/too-many-requests -> REGISTRATION_RATE_LIMITED
      service.nextFailure = makeFirebaseError(
        'auth/too-many-requests',
        'Firebase: Access to this account has been temporarily disabled (auth/too-many-requests).'
      );
      await expect(
        service.register('ratelimit@promiseofplanet.org', 'SecretPass!1')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'REGISTRATION_RATE_LIMITED',
        message: REGISTRATION_ERROR_MESSAGES.rateLimit.en,
      });

      // 5. Network failure: auth/network-request-failed -> REGISTRATION_NETWORK_ERROR
      service.nextFailure = makeFirebaseError(
        'auth/network-request-failed',
        'Firebase: A network AuthError has occurred (auth/network-request-failed).'
      );
      await expect(
        service.register('network@promiseofplanet.org', 'SecretPass!1')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'REGISTRATION_NETWORK_ERROR',
        message: REGISTRATION_ERROR_MESSAGES.networkFailure.en,
      });

      // 6. Operation not allowed: auth/operation-not-allowed -> AUTH_UNAVAILABLE
      service.nextFailure = makeFirebaseError(
        'auth/operation-not-allowed',
        'Firebase: The given sign-in provider is disabled (auth/operation-not-allowed).'
      );
      await expect(
        service.register('disabled@promiseofplanet.org', 'SecretPass!1')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'AUTH_UNAVAILABLE',
        message: REGISTRATION_ERROR_MESSAGES.serviceUnavailable.en,
      });

      // 7. Unknown Firebase error or message-only error without .code -> AUTH_UNAVAILABLE (never existing-account, never guesses from message text)
      service.nextFailure = makeFirebaseError(
        'auth/unexpected-server-fault',
        'Firebase: Internal error mentioning auth/email-already-in-use in text token=xyz-secret'
      );
      let unknownErr: AccountError | null = null;
      try {
        await service.register('unknown@promiseofplanet.org', 'SecretPass!1');
      } catch (e: any) {
        unknownErr = e;
      }
      expect(unknownErr).toBeInstanceOf(AccountError);
      expect(unknownErr?.code).toBe('AUTH_UNAVAILABLE');
      expect(unknownErr?.code).not.toBe('ACCOUNT_ALREADY_EXISTS');
      expect(unknownErr?.message).not.toContain('xyz-secret');

      // Message-only Error without error.code property must NOT guess from message text
      service.nextFailure = new Error(
        'Firebase: Error (auth/email-already-in-use) without code property'
      );
      await expect(
        service.register('nocode@promiseofplanet.org', 'SecretPass!1')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'AUTH_UNAVAILABLE',
      });

      // Verify diagnostic logging only logs allowlisted category/firebaseCode and never logs passwords, emails, tokens, or raw Error objects
      const loggedText = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(loggedText).not.toContain('SecretPass!1');
      expect(loggedText).not.toContain('secret-tok-1');
      expect(loggedText).not.toContain('xyz-secret');
      expect(loggedText).not.toContain('existing@promiseofplanet.org');
      expect(
        getSafeRegistrationDiagnosticCode({ code: 'auth/email-already-in-use' })
      ).toBe('auth/email-already-in-use');
      expect(
        getSafeRegistrationDiagnosticCode({ code: 'secret-unallowlisted-code' })
      ).toBe('unknown');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('30. AUTH-05-UAE1-R2: preserves existing AccountError instances thrown during registration without remapping', async () => {
    class PreClassifiedErrorService extends AccountServiceClass {
      protected isConfigured(): boolean {
        return true;
      }

      protected async performCreateUser(
        _email: string,
        _password: string
      ): Promise<User> {
        throw new AccountError(
          'ACCOUNT_DATA_INVALID',
          'Custom pre-validated email error.'
        );
      }
    }

    const service = new PreClassifiedErrorService(
      new InMemoryAccountRepository()
    );
    const direct = new AccountError(
      'ACCOUNT_NOT_FOUND',
      'Preserved AccountError instance.'
    );
    expect(classifyRegistrationAuthError(direct)).toBe(direct);

    await expect(
      service.register('custom@promiseofplanet.org', 'Password123!')
    ).rejects.toMatchObject({
      name: 'AccountError',
      code: 'ACCOUNT_DATA_INVALID',
      message: 'Custom pre-validated email error.',
    });
  });

  it('31. AUTH-05-UAE1-R2: returns accurate Arabic and English user feedback in getSafeWidgetErrorMessage for all registration error categories', () => {
    const existingErr = classifyRegistrationAuthError({
      code: 'auth/email-already-in-use',
    });
    const invalidEmailErr = classifyRegistrationAuthError({
      code: 'auth/invalid-email',
    });
    const weakPasswordErr = classifyRegistrationAuthError({
      code: 'auth/weak-password',
    });
    const rateLimitErr = classifyRegistrationAuthError({
      code: 'auth/too-many-requests',
    });
    const networkErr = classifyRegistrationAuthError({
      code: 'auth/network-request-failed',
    });
    const unavailableErr = classifyRegistrationAuthError({
      code: 'auth/operation-not-allowed',
    });
    const unknownErr = classifyRegistrationAuthError({
      code: 'auth/unknown-code',
    });

    // Arabic messages (Case 13)
    expect(getSafeWidgetErrorMessage(existingErr, true)).toBe(
      'هذا البريد الإلكتروني مستخدم بالفعل. يمكنك تسجيل الدخول أو استعادة كلمة المرور.'
    );
    expect(getSafeWidgetErrorMessage(invalidEmailErr, true)).toBe(
      'يرجى إدخال عنوان بريد إلكتروني صالح.'
    );
    expect(getSafeWidgetErrorMessage(weakPasswordErr, true)).toBe(
      'كلمة المرور لا تستوفي متطلبات الأمان. يرجى اختيار كلمة مرور أقوى.'
    );
    expect(getSafeWidgetErrorMessage(rateLimitErr, true)).toBe(
      'تم تجاوز عدد محاولات التسجيل المسموح بها مؤقتاً. يرجى الانتظار قبل المحاولة مجدداً.'
    );
    expect(getSafeWidgetErrorMessage(networkErr, true)).toBe(
      'تعذر الاتصال بخدمة التسجيل. تحقق من اتصال الإنترنت ثم حاول مجدداً.'
    );
    expect(getSafeWidgetErrorMessage(unavailableErr, true)).toBe(
      'خدمة المصادقة غير متاحة حالياً. يرجى المحاولة لاحقاً.'
    );
    expect(getSafeWidgetErrorMessage(unknownErr, true)).toBe(
      'خدمة المصادقة غير متاحة حالياً. يرجى المحاولة لاحقاً.'
    );

    // English messages (Case 14)
    expect(getSafeWidgetErrorMessage(existingErr, false)).toBe(
      'This email address is already registered. You can sign in or reset your password.'
    );
    expect(getSafeWidgetErrorMessage(invalidEmailErr, false)).toBe(
      'Please enter a valid email address.'
    );
    expect(getSafeWidgetErrorMessage(weakPasswordErr, false)).toBe(
      'The password does not meet security requirements. Please choose a stronger password.'
    );
    expect(getSafeWidgetErrorMessage(rateLimitErr, false)).toBe(
      'Too many registration attempts. Please wait before trying again.'
    );
    expect(getSafeWidgetErrorMessage(networkErr, false)).toBe(
      'Unable to connect to the registration service. Check your internet connection and try again.'
    );
    expect(getSafeWidgetErrorMessage(unavailableErr, false)).toBe(
      'Authentication is currently unavailable. Please try again.'
    );
    expect(getSafeWidgetErrorMessage(unknownErr, false)).toBe(
      'Authentication is currently unavailable. Please try again.'
    );

    // Ensure distinct categories never collapse to the same generic message
    const distinctAr = new Set([
      getSafeWidgetErrorMessage(existingErr, true),
      getSafeWidgetErrorMessage(invalidEmailErr, true),
      getSafeWidgetErrorMessage(weakPasswordErr, true),
      getSafeWidgetErrorMessage(rateLimitErr, true),
      getSafeWidgetErrorMessage(networkErr, true),
      getSafeWidgetErrorMessage(unavailableErr, true),
    ]);
    expect(distinctAr.size).toBe(6);

    const distinctEn = new Set([
      getSafeWidgetErrorMessage(existingErr, false),
      getSafeWidgetErrorMessage(invalidEmailErr, false),
      getSafeWidgetErrorMessage(weakPasswordErr, false),
      getSafeWidgetErrorMessage(rateLimitErr, false),
      getSafeWidgetErrorMessage(networkErr, false),
      getSafeWidgetErrorMessage(unavailableErr, false),
    ]);
    expect(distinctEn.size).toBe(6);
  });

  it('32. AUTH-05-UAE1-R2: preserves Stage 1 vs Stage 2 registration lifecycle, barrier cleanup, account recovery, and no duplicate Firebase user creation', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      // Case 9: Successful Firebase account creation + Firestore profile provisioning
      const successRepo = new InMemoryAccountRepository();
      const successService = new TestableGlobalAccountService(successRepo);
      const created = await successService.register(
        'NewMember@PromiseOfPlanet.org',
        'ValidPass123!',
        'New Member'
      );
      expect(created.user.uid).toBe('uid-newmember');
      expect(created.account).not.toBeNull();
      expect(created.account?.id).toBe('uid-newmember');
      expect(created.account?.email).toBe('newmember@promiseofplanet.org');
      expect(created.account?.displayName).toBe('New Member');
      expect(created.error).toBeUndefined();
      // Barrier is settled and cleaned up after success
      expect(
        await successService.awaitInFlightRegistrationForUser(created.user)
      ).toBeNull();

      // Case 11 (Stage 1 error): Barrier is settled and cleaned up after Stage 1 Firebase error, and no user is authenticated
      class Stage1FailService extends AccountServiceClass {
        public createUserCalls = 0;
        public observedDuringCreate: Promise<{
          user: User | null;
          account: Account | null;
          error?: string;
        } | null> | null = null;

        protected isConfigured(): boolean {
          return true;
        }

        protected async performCreateUser(
          email: string,
          _password: string
        ): Promise<User> {
          this.createUserCalls += 1;
          this.observedDuringCreate = this.awaitInFlightRegistrationForUser({
            uid: '',
            email,
          } as unknown as User);
          const err = new Error('Email exists') as Error & { code: string };
          err.code = 'auth/email-already-in-use';
          throw err;
        }
      }

      const stage1Service = new Stage1FailService(
        new InMemoryAccountRepository()
      );
      await expect(
        stage1Service.register('dup@promiseofplanet.org', 'ValidPass123!')
      ).rejects.toMatchObject({
        code: 'ACCOUNT_ALREADY_EXISTS',
      });
      // No automatic retry (Case 12)
      expect(stage1Service.createUserCalls).toBe(1);
      // Barrier settled to { user: null, account: null } and was cleaned up after error (Case 11)
      expect(await stage1Service.observedDuringCreate).toEqual({
        user: null,
        account: null,
      });
      expect(
        await stage1Service.awaitInFlightRegistrationForUser({
          uid: 'any',
          email: 'dup@promiseofplanet.org',
        } as unknown as User)
      ).toBeNull();

      // Case 10 & 12: Stage 1 Firebase creation succeeds followed by Stage 2 Firestore provisioning failure
      let shouldFailCreateAccount = true;
      const backingRepo = new InMemoryAccountRepository();
      const stage2Repo = {
        getAccount: (uid: string) => backingRepo.getAccount(uid),
        createAccount: async (acc: any) => {
          if (shouldFailCreateAccount) {
            throw new Error('Simulated Firestore write outage');
          }
          return await backingRepo.createAccount(acc);
        },
        updateAccount: (uid: string, data: any) =>
          backingRepo.updateAccount(uid, data),
      };

      class Stage2TestableService extends AccountServiceClass {
        public createUserCalls = 0;
        public activeUser: User | null = null;

        protected isConfigured(): boolean {
          return true;
        }

        protected getAuthenticatedUser(): User | null {
          return this.activeUser;
        }

        protected async performCreateUser(
          email: string,
          _password: string
        ): Promise<User> {
          this.createUserCalls += 1;
          const u = {
            uid: 'uid-stage2-user',
            email: email.trim().toLowerCase(),
            displayName: null,
            emailVerified: false,
          } as unknown as User;
          this.activeUser = u;
          return u;
        }
      }

      const stage2Service = new Stage2TestableService(stage2Repo);
      const partialResult = await stage2Service.register(
        'stage2@promiseofplanet.org',
        'ValidPass123!',
        'Stage Two User'
      );

      // Stage 1 succeeded and Stage 2 failed:
      // - Returns authenticated user without erasing identity
      // - Reports ACCOUNT_PROVISIONING_FAILED, NOT AUTH_UNAVAILABLE
      // - Does NOT attempt to create a second Firebase user
      expect(stage2Service.createUserCalls).toBe(1);
      expect(partialResult.user.uid).toBe('uid-stage2-user');
      expect(partialResult.account).toBeNull();
      expect(partialResult.error).toBe(
        'ACCOUNT_PROVISIONING_FAILED: Unable to provision platform account.'
      );
      expect(
        getSafeWidgetErrorMessage(partialResult.error, true)
      ).not.toBe(REGISTRATION_ERROR_MESSAGES.serviceUnavailable.ar);
      // Barrier cleaned up after Stage 2 failure
      expect(
        await stage2Service.awaitInFlightRegistrationForUser(partialResult.user)
      ).toBeNull();

      // Recovery provisions accounts/{uid} for the existing authenticated user without calling performCreateUser again
      shouldFailCreateAccount = false;
      const recovered = await stage2Service.recoverCurrentAccountProfile();
      expect(stage2Service.createUserCalls).toBe(1);
      expect(recovered.status).toBe('recovered');
      expect(recovered.account?.id).toBe('uid-stage2-user');
      expect(recovered.account?.displayName).toBe('Stage Two User');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('33. AUTH-05-UAE1-R2: preserves existing sign-in, password-reset non-enumeration privacy contract, and verified-email requirements', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    class SignInAndResetService extends AccountServiceClass {
      public resetError: unknown = null;

      protected isConfigured(): boolean {
        return true;
      }

      protected async performSignIn(
        _email: string,
        _password: string
      ): Promise<User> {
        const err = new Error(
          'Firebase: Error (auth/wrong-password).'
        ) as Error & { code: string };
        err.code = 'auth/wrong-password';
        throw err;
      }

      protected async performPasswordReset(_email: string): Promise<void> {
        if (this.resetError) {
          throw this.resetError;
        }
      }
    }

    const service = new SignInAndResetService(new InMemoryAccountRepository());

    try {
      // Sign-in failure continues to throw AUTH_UNAVAILABLE without leaking whether email exists
      await expect(
        service.signIn('user@promiseofplanet.org', 'wrong-pass')
      ).rejects.toMatchObject({
        name: 'AccountError',
        code: 'AUTH_UNAVAILABLE',
      });

      // Password reset returns identical neutral confirmation for existing and non-existing accounts
      const existingReset = await service.requestPasswordReset(
        'known@promiseofplanet.org'
      );
      const notFoundErr = new Error(
        'Firebase: Error (auth/user-not-found).'
      ) as Error & { code: string };
      notFoundErr.code = 'auth/user-not-found';
      service.resetError = notFoundErr;
      const unknownReset = await service.requestPasswordReset(
        'unknown@promiseofplanet.org'
      );

      expect(existingReset.messageAr).toBe(NEUTRAL_PASSWORD_RESET_MESSAGES.ar);
      expect(existingReset.messageEn).toBe(NEUTRAL_PASSWORD_RESET_MESSAGES.en);
      expect(unknownReset.messageAr).toBe(existingReset.messageAr);
      expect(unknownReset.messageEn).toBe(existingReset.messageEn);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

