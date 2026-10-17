"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnrollmentService = exports.InMemoryEnrollmentRepository = exports.FirestoreEnrollmentRepository = exports.EnrollmentError = void 0;
exports.validateEnrollmentData = validateEnrollmentData;
const firestore_1 = require("firebase/firestore");
const firebase_1 = require("./firebase");
const accountService_1 = require("./accountService");
const trainingCourseService_1 = require("./trainingCourseService");
const workflow_1 = require("../types/workflow");
class EnrollmentError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'EnrollmentError';
        this.code = code;
    }
}
exports.EnrollmentError = EnrollmentError;
/**
 * Validates runtime Enrollment document structures against the canonical 4-field Enrollment interface.
 */
function validateEnrollmentData(data, expectedId) {
    if (!data || typeof data !== 'object') {
        throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment document data must be a valid non-null object.');
    }
    const keys = Object.keys(data);
    const requiredKeys = ['id', 'accountId', 'courseId', 'createdAt'];
    if (keys.length !== requiredKeys.length || !requiredKeys.every((k) => keys.includes(k))) {
        throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment document contains invalid or extra non-canonical fields.');
    }
    const record = data;
    if (typeof record.id !== 'string' ||
        typeof record.accountId !== 'string' ||
        typeof record.courseId !== 'string' ||
        typeof record.createdAt !== 'string' ||
        !record.id.trim() ||
        !record.accountId.trim() ||
        !record.courseId.trim() ||
        !record.createdAt.trim()) {
        throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment document contains empty or non-string values.');
    }
    const expectedDeterministicId = `${record.accountId}_${record.courseId}`;
    if (record.id !== expectedDeterministicId) {
        throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment.id does not match the deterministic contract `${accountId}_${courseId}`.');
    }
    if (expectedId && record.id !== expectedId) {
        throw new EnrollmentError('ENROLLMENT_DATA_INVALID', `Enrollment document identity '${record.id}' does not match expected document identity '${expectedId}'.`);
    }
    return record;
}
class FirestoreEnrollmentRepository {
    async getEnrollment(accountId, courseId) {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.db) {
            throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Backend storage is unavailable or not configured.');
        }
        const enrollmentId = `${accountId}_${courseId}`;
        try {
            const docRef = (0, firestore_1.doc)(firebase_1.db, 'enrollments', enrollmentId);
            const snap = await (0, firestore_1.getDoc)(docRef);
            if (!snap.exists()) {
                return null;
            }
            return validateEnrollmentData(snap.data(), enrollmentId);
        }
        catch (err) {
            if (err instanceof EnrollmentError)
                throw err;
            try {
                (0, firebase_1.handleFirestoreError)(err, firebase_1.OperationType.GET, `enrollments/${enrollmentId}`);
            }
            catch {
                throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Enrollment storage operation failed or backend is unavailable.');
            }
        }
    }
    async listAccountEnrollments(accountId) {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.db) {
            throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Backend storage is unavailable or not configured.');
        }
        try {
            const q = (0, firestore_1.query)((0, firestore_1.collection)(firebase_1.db, 'enrollments'), (0, firestore_1.where)('accountId', '==', accountId));
            const snap = await (0, firestore_1.getDocs)(q);
            return snap.docs.map((d) => validateEnrollmentData(d.data(), d.id));
        }
        catch (err) {
            if (err instanceof EnrollmentError)
                throw err;
            try {
                (0, firebase_1.handleFirestoreError)(err, firebase_1.OperationType.LIST, 'enrollments');
            }
            catch {
                throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Enrollment storage operation failed or backend is unavailable.');
            }
        }
    }
    async saveEnrollment(enrollment) {
        if (!firebase_1.isFirebaseConfigured || !firebase_1.db) {
            throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Backend storage is unavailable or not configured.');
        }
        const validated = validateEnrollmentData(enrollment);
        try {
            const docRef = (0, firestore_1.doc)(firebase_1.db, 'enrollments', validated.id);
            const existing = await (0, firestore_1.getDoc)(docRef);
            if (existing.exists()) {
                throw new EnrollmentError('ALREADY_ENROLLED', 'The account is already enrolled in this training course.');
            }
            await (0, firestore_1.setDoc)(docRef, validated);
            return validated;
        }
        catch (err) {
            if (err instanceof EnrollmentError)
                throw err;
            try {
                (0, firebase_1.handleFirestoreError)(err, firebase_1.OperationType.CREATE, `enrollments/${validated.id}`);
            }
            catch {
                throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Enrollment storage operation failed or backend is unavailable.');
            }
        }
    }
}
exports.FirestoreEnrollmentRepository = FirestoreEnrollmentRepository;
class InMemoryEnrollmentRepository {
    store = new Map();
    async getEnrollment(accountId, courseId) {
        const id = `${accountId}_${courseId}`;
        const found = this.store.get(id);
        if (!found)
            return null;
        return validateEnrollmentData(found, id);
    }
    async listAccountEnrollments(accountId) {
        return Array.from(this.store.values())
            .filter((e) => e.accountId === accountId)
            .map((e) => validateEnrollmentData(e));
    }
    async saveEnrollment(enrollment) {
        const validated = validateEnrollmentData(enrollment);
        if (this.store.has(validated.id)) {
            throw new EnrollmentError('ALREADY_ENROLLED', 'The account is already enrolled in this training course.');
        }
        this.store.set(validated.id, { ...validated });
        return validated;
    }
}
exports.InMemoryEnrollmentRepository = InMemoryEnrollmentRepository;
class EnrollmentServiceImpl {
    repository = new FirestoreEnrollmentRepository();
    authProvider;
    setRepository(repository) {
        this.repository = repository;
    }
    getRepository() {
        return this.repository;
    }
    /**
     * Set explicit authentication provider for testing or seam injection.
     * If unset, defaults to reading auth?.currentUser?.uid from Firebase Auth foundation.
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
     * Enroll currently authenticated member in a Published training course.
     * Derives accountId strictly from authenticated identity. Caller CANNOT supply arbitrary accountId.
     */
    async enrollInCourse(courseId) {
        const uid = this.getAuthenticatedUid();
        if (!uid || !uid.trim()) {
            throw new EnrollmentError('AUTH_REQUIRED', 'Authentication is required to perform enrollment operations.');
        }
        if (!courseId || !courseId.trim()) {
            throw new EnrollmentError('COURSE_UNAVAILABLE', 'A valid course ID is required to enroll.');
        }
        // Verify canonical Account existence in the Account foundation
        const account = await accountService_1.AccountService.getAccount(uid);
        if (!account) {
            throw new EnrollmentError('ACCOUNT_UNAVAILABLE', 'A valid canonical Account record is required before enrolling in a training course.');
        }
        // Verify canonical TrainingCourse existence and Published status
        const course = await trainingCourseService_1.TrainingCourseService.getCourseById(courseId);
        if (!course || course.workflowState !== workflow_1.WorkflowState.Published) {
            throw new EnrollmentError('COURSE_UNAVAILABLE', 'The specified training course is not available or eligible for enrollment.');
        }
        const enrollmentId = `${uid}_${courseId}`;
        const existing = await this.repository.getEnrollment(uid, courseId);
        if (existing) {
            throw new EnrollmentError('ALREADY_ENROLLED', 'The account is already enrolled in this training course.');
        }
        const newEnrollment = {
            id: enrollmentId,
            accountId: uid,
            courseId,
            createdAt: new Date().toISOString(),
        };
        return await this.repository.saveEnrollment(newEnrollment);
    }
    /**
     * Retrieve enrollment for currently authenticated user in a specific course.
     * Bound strictly to authenticated UID.
     */
    async getMyEnrollment(courseId) {
        const uid = this.getAuthenticatedUid();
        if (!uid || !uid.trim()) {
            throw new EnrollmentError('AUTH_REQUIRED', 'Authentication is required to query enrollments.');
        }
        if (!courseId || !courseId.trim()) {
            throw new EnrollmentError('COURSE_UNAVAILABLE', 'A valid course ID is required to query enrollment.');
        }
        return await this.repository.getEnrollment(uid, courseId);
    }
    /**
     * Alias for getMyEnrollment to support getEnrollment(courseId) contract.
     */
    async getEnrollment(courseId) {
        return await this.getMyEnrollment(courseId);
    }
    /**
     * List all enrollments for currently authenticated user.
     * Bound strictly to authenticated UID.
     */
    async listMyEnrollments() {
        const uid = this.getAuthenticatedUid();
        if (!uid || !uid.trim()) {
            throw new EnrollmentError('AUTH_REQUIRED', 'Authentication is required to list enrollments.');
        }
        return await this.repository.listAccountEnrollments(uid);
    }
}
exports.EnrollmentService = new EnrollmentServiceImpl();
//# sourceMappingURL=enrollmentService.js.map