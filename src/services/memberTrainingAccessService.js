"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemberTrainingAccessService = exports.MemberTrainingAccessServiceClass = void 0;
const firebase_1 = require("./firebase");
const accountService_1 = require("./accountService");
const enrollmentService_1 = require("./enrollmentService");
const trainingCourseService_1 = require("./trainingCourseService");
const workflow_1 = require("../types/workflow");
class MemberTrainingAccessServiceClass {
    authProvider;
    /**
     * Inject explicit auth provider for testing or seam injection.
     */
    setAuthProvider(provider) {
        this.authProvider = provider;
    }
    getAuthenticatedUid() {
        if (this.authProvider) {
            return this.authProvider();
        }
        if (firebase_1.isFirebaseConfigured && firebase_1.auth && firebase_1.auth.currentUser) {
            return firebase_1.auth.currentUser.uid;
        }
        return null;
    }
    /**
     * Resolves derived runtime member access state for a Published TrainingCourse.
     */
    async resolveAccessState(courseId, initialCourse) {
        if (!courseId || typeof courseId !== 'string' || !courseId.trim()) {
            return {
                status: 'course_unavailable',
                course: null,
                enrollment: null,
                account: null,
                error: { code: 'COURSE_UNAVAILABLE', message: 'A valid course ID is required.' },
            };
        }
        let course = initialCourse || null;
        // Resolve course through canonical TrainingCourseService
        try {
            if (!course) {
                course = await trainingCourseService_1.TrainingCourseService.getCourseById(courseId);
            }
        }
        catch (err) {
            if (err instanceof trainingCourseService_1.TrainingCourseError && err.code === 'BACKEND_UNAVAILABLE') {
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
        if (!course || course.workflowState !== workflow_1.WorkflowState.Published) {
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
        let account = null;
        try {
            account = await accountService_1.AccountService.getAccount(uid);
        }
        catch {
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
            const enrollment = await enrollmentService_1.EnrollmentService.getMyEnrollment(courseId);
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
        }
        catch (err) {
            if (err instanceof enrollmentService_1.EnrollmentError) {
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
    async requestEnrollment(courseId) {
        try {
            const created = await enrollmentService_1.EnrollmentService.enrollInCourse(courseId);
            const uid = this.getAuthenticatedUid();
            const account = uid ? await accountService_1.AccountService.getAccount(uid) : null;
            const course = await trainingCourseService_1.TrainingCourseService.getCourseById(courseId);
            return {
                status: 'enrolled',
                course,
                enrollment: created,
                account,
                error: null,
            };
        }
        catch (err) {
            const currentAccess = await this.resolveAccessState(courseId);
            const code = err instanceof enrollmentService_1.EnrollmentError ? err.code : 'UNKNOWN_ERROR';
            const message = err?.message || 'Failed to complete course enrollment.';
            return {
                ...currentAccess,
                error: { code, message },
            };
        }
    }
}
exports.MemberTrainingAccessServiceClass = MemberTrainingAccessServiceClass;
exports.MemberTrainingAccessService = new MemberTrainingAccessServiceClass();
//# sourceMappingURL=memberTrainingAccessService.js.map