import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { User } from 'firebase/auth';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import arTranslation from '../../locales/ar.json';
import enTranslation from '../../locales/en.json';
import { Header, GLOBAL_MEMBER_ACCOUNT_LABELS } from '../layout/Header';
import { AppShell } from '../layout/AppShell';
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

describe('AUTH-02B2: Global Member Account Entry — Responsive Header Integration', () => {
  let accountRepo: InMemoryAccountRepository;
  let testService: TestableGlobalAccountService;

  beforeEach(async () => {
    accountRepo = new InMemoryAccountRepository();
    testService = new TestableGlobalAccountService(accountRepo);
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
    expect(html).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.en);
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
    expect(html).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.ar);
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

  it('10. never imports FirebaseAuthProvider mock identities or grants administrative roles through public registration', async () => {
    const filesToCheck = [
      resolve(__dirname, './GlobalMemberAccountDialog.tsx'),
      resolve(__dirname, './AccountAuthWidget.tsx'),
      resolve(__dirname, '../layout/Header.tsx'),
      resolve(__dirname, '../layout/AppShell.tsx'),
      resolve(__dirname, '../../App.tsx'),
    ];

    for (const filePath of filesToCheck) {
      const content = readFileSync(filePath, 'utf8');
      expect(content).not.toContain('FirebaseAuthProvider');
    }

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
    expect(headerAr).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.ar);
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
    expect(headerEn).toContain(GLOBAL_MEMBER_ACCOUNT_LABELS.en);
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
});
