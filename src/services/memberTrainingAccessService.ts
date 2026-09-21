import { auth, isFirebaseConfigured } from './firebase';
import { AccountService } from './accountService';
import { EnrollmentService, EnrollmentError } from './enrollmentService';
import { TrainingCourseService, TrainingCourseError } from './trainingCourseService';
import type { TrainingCourse } from '../types/training';
import type { Enrollment } from '../types/enrollment';
import type { Account } from '../types/account';
import { WorkflowState } from '../types/workflow';

export type AccessStatus =
  | 'loading'
  | 'unauthenticated'
  | 'account_unavailable'
  | 'not_enrolled'
  | 'enrolled'
  | 'course_unavailable'
  | 'backend_unavailable'
  | 'error';

export interface DerivedAccessState {
  status: AccessStatus;
  course: TrainingCourse | null;
  enrollment: Enrollment | null;
  account: Account | null;
  error: { code: string; message: string } | null;
}

export class MemberTrainingAccessServiceClass {
  private authProvider?: () => string | null;

  /**
   * Inject explicit auth provider for testing or seam injection.
   */
  setAuthProvider(provider: (() => string | null) | undefined): void {
    this.authProvider = provider;
  }

  private getAuthenticatedUid(): string | null {
    if (this.authProvider) {
      return this.authProvider();
    }
    if (isFirebaseConfigured && auth && auth.currentUser) {
      return auth.currentUser.uid;
    }
    return null;
  }

  /**
   * Resolves derived runtime member access state for a Published TrainingCourse.
   */
  async resolveAccessState(courseId: string, initialCourse?: TrainingCourse | null): Promise<DerivedAccessState> {
    if (!courseId || typeof courseId !== 'string' || !courseId.trim()) {
      return {
        status: 'course_unavailable',
        course: null,
        enrollment: null,
        account: null,
        error: { code: 'COURSE_UNAVAILABLE', message: 'A valid course ID is required.' },
      };
    }

    let course: TrainingCourse | null = initialCourse || null;

    // Resolve course through canonical TrainingCourseService
    try {
      if (!course) {
        course = await TrainingCourseService.getCourseById(courseId);
      }
    } catch (err: any) {
      if (err instanceof TrainingCourseError && err.code === 'BACKEND_UNAVAILABLE') {
        return {
          status: 'backend_unavailable',
          course: null,
          enrollment: null,
          account: null,
          error: { code: 'BACKEND_UNAVAILABLE', message: 'Training course backend is unavailable or unconfigured.' },
        };
      }
      return {
        status: 'error',
        course: null,
        enrollment: null,
        account: null,
        error: { code: 'UNKNOWN_ERROR', message: err?.message || 'Failed to fetch course details.' },
      };
    }

    if (!course || course.workflowState !== WorkflowState.Published) {
      return {
        status: 'course_unavailable',
        course,
        enrollment: null,
        account: null,
        error: { code: 'COURSE_UNAVAILABLE', message: 'The requested course is not available or not published.' },
      };
    }

    // Resolve authenticated identity
    const uid = this.getAuthenticatedUid();
    if (!uid) {
      return {
        status: 'unauthenticated',
        course,
        enrollment: null,
        account: null,
        error: null,
      };
    }

    // Resolve canonical Account profile
    let account: Account | null = null;
    try {
      account = await AccountService.getAccount(uid);
    } catch {
      return {
        status: 'backend_unavailable',
        course,
        enrollment: null,
        account: null,
        error: { code: 'BACKEND_UNAVAILABLE', message: 'Account backend is unavailable or unconfigured.' },
      };
    }

    if (!account) {
      return {
        status: 'account_unavailable',
        course,
        enrollment: null,
        account: null,
        error: { code: 'ACCOUNT_UNAVAILABLE', message: 'A valid canonical Account is required before accessing training enrollment.' },
      };
    }

    // Resolve canonical Enrollment
    try {
      const enrollment = await EnrollmentService.getMyEnrollment(courseId);
      if (enrollment) {
        return {
          status: 'enrolled',
          course,
          enrollment,
          account,
          error: null,
        };
      }
      return {
        status: 'not_enrolled',
        course,
        enrollment: null,
        account,
        error: null,
      };
    } catch (err: any) {
      if (err instanceof EnrollmentError) {
        if (err.code === 'AUTH_REQUIRED') {
          return {
            status: 'unauthenticated',
            course,
            enrollment: null,
            account,
            error: null,
          };
        }
        if (err.code === 'ACCOUNT_UNAVAILABLE') {
          return {
            status: 'account_unavailable',
            course,
            enrollment: null,
            account,
            error: { code: 'ACCOUNT_UNAVAILABLE', message: err.message },
          };
        }
        if (err.code === 'COURSE_UNAVAILABLE') {
          return {
            status: 'course_unavailable',
            course,
            enrollment: null,
            account,
            error: { code: 'COURSE_UNAVAILABLE', message: err.message },
          };
        }
        if (err.code === 'BACKEND_UNAVAILABLE') {
          return {
            status: 'backend_unavailable',
            course,
            enrollment: null,
            account,
            error: { code: 'BACKEND_UNAVAILABLE', message: err.message },
          };
        }
      }
      return {
        status: 'error',
        course,
        enrollment: null,
        account,
        error: { code: 'UNKNOWN_ERROR', message: err?.message || 'Failed to verify enrollment state.' },
      };
    }
  }

  /**
   * Action to perform enrollment for current authenticated account in courseId.
   */
  async requestEnrollment(courseId: string): Promise<DerivedAccessState> {
    try {
      const created = await EnrollmentService.enrollInCourse(courseId);
      const uid = this.getAuthenticatedUid();
      const account = uid ? await AccountService.getAccount(uid) : null;
      const course = await TrainingCourseService.getCourseById(courseId);
      return {
        status: 'enrolled',
        course,
        enrollment: created,
        account,
        error: null,
      };
    } catch (err: any) {
      const currentAccess = await this.resolveAccessState(courseId);
      const code = err instanceof EnrollmentError ? err.code : 'UNKNOWN_ERROR';
      const message = err?.message || 'Failed to complete course enrollment.';
      return {
        ...currentAccess,
        error: { code, message },
      };
    }
  }
}

export const MemberTrainingAccessService = new MemberTrainingAccessServiceClass();
