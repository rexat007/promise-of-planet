import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where 
} from 'firebase/firestore';
import { db, isFirebaseConfigured, handleFirestoreError, OperationType } from './firebase';
import type { Enrollment } from '../types/enrollment';
import { TrainingCourseService } from './trainingCourseService';
import { WorkflowState } from '../types/workflow';

export type EnrollmentErrorType =
  | 'AUTH_REQUIRED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'COURSE_UNAVAILABLE'
  | 'ALREADY_ENROLLED'
  | 'BACKEND_UNAVAILABLE'
  | 'ENROLLMENT_DATA_INVALID'
  | 'ENROLLMENT_FAILED';

export class EnrollmentError extends Error {
  code: EnrollmentErrorType;

  constructor(code: EnrollmentErrorType, message: string) {
    super(message);
    this.name = 'EnrollmentError';
    this.code = code;
  }
}

/**
 * Validates runtime Enrollment document structures against the canonical 4-field Enrollment interface.
 */
export function validateEnrollmentData(data: unknown, expectedId?: string): Enrollment {
  if (!data || typeof data !== 'object') {
    throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment document data must be a valid non-null object.');
  }

  const keys = Object.keys(data as object);
  const requiredKeys = ['id', 'accountId', 'courseId', 'createdAt'];

  if (keys.length !== requiredKeys.length || !requiredKeys.every((k) => keys.includes(k))) {
    throw new EnrollmentError(
      'ENROLLMENT_DATA_INVALID',
      'Enrollment document contains invalid or extra non-canonical fields.'
    );
  }

  const record = data as Record<string, any>;

  if (
    typeof record.id !== 'string' ||
    typeof record.accountId !== 'string' ||
    typeof record.courseId !== 'string' ||
    typeof record.createdAt !== 'string' ||
    !record.id.trim() ||
    !record.accountId.trim() ||
    !record.courseId.trim() ||
    !record.createdAt.trim()
  ) {
    throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment document contains empty or non-string values.');
  }

  const expectedDeterministicId = `${record.accountId}_${record.courseId}`;
  if (record.id !== expectedDeterministicId) {
    throw new EnrollmentError('ENROLLMENT_DATA_INVALID', 'Enrollment.id does not match the deterministic contract `${accountId}_${courseId}`.');
  }

  if (expectedId && record.id !== expectedId) {
    throw new EnrollmentError(
      'ENROLLMENT_DATA_INVALID',
      `Enrollment document identity '${record.id}' does not match expected document identity '${expectedId}'.`
    );
  }

  return record as Enrollment;
}

export interface EnrollmentRepository {
  getEnrollment(accountId: string, courseId: string): Promise<Enrollment | null>;
  listAccountEnrollments(accountId: string): Promise<Enrollment[]>;
  saveEnrollment(enrollment: Enrollment): Promise<Enrollment>;
}

export class FirestoreEnrollmentRepository implements EnrollmentRepository {
  async getEnrollment(accountId: string, courseId: string): Promise<Enrollment | null> {
    if (!isFirebaseConfigured || !db) {
      throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Backend storage is unavailable or not configured.');
    }

    const enrollmentId = `${accountId}_${courseId}`;
    try {
      const docRef = doc(db, 'enrollments', enrollmentId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return null;
      }
      return validateEnrollmentData(snap.data(), enrollmentId);
    } catch (err: any) {
      if (err instanceof EnrollmentError) throw err;
      try {
        handleFirestoreError(err, OperationType.GET, `enrollments/${enrollmentId}`);
      } catch {
        throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Enrollment storage operation failed or backend is unavailable.');
      }
    }
  }

  async listAccountEnrollments(accountId: string): Promise<Enrollment[]> {
    if (!isFirebaseConfigured || !db) {
      throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Backend storage is unavailable or not configured.');
    }

    try {
      const q = query(collection(db, 'enrollments'), where('accountId', '==', accountId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => validateEnrollmentData(d.data(), d.id));
    } catch (err: any) {
      if (err instanceof EnrollmentError) throw err;
      try {
        handleFirestoreError(err, OperationType.LIST, 'enrollments');
      } catch {
        throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Enrollment storage operation failed or backend is unavailable.');
      }
    }
  }

  async saveEnrollment(enrollment: Enrollment): Promise<Enrollment> {
    if (!isFirebaseConfigured || !db) {
      throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Backend storage is unavailable or not configured.');
    }

    const validated = validateEnrollmentData(enrollment);

    try {
      const docRef = doc(db, 'enrollments', validated.id);
      const existing = await getDoc(docRef);
      if (existing.exists()) {
        throw new EnrollmentError('ALREADY_ENROLLED', 'The account is already enrolled in this training course.');
      }
      await setDoc(docRef, validated);
      return validated;
    } catch (err: any) {
      if (err instanceof EnrollmentError) throw err;
      try {
        handleFirestoreError(err, OperationType.CREATE, `enrollments/${validated.id}`);
      } catch {
        throw new EnrollmentError('BACKEND_UNAVAILABLE', 'Enrollment storage operation failed or backend is unavailable.');
      }
    }
  }
}

export class InMemoryEnrollmentRepository implements EnrollmentRepository {
  private store = new Map<string, Enrollment>();

  async getEnrollment(accountId: string, courseId: string): Promise<Enrollment | null> {
    const id = `${accountId}_${courseId}`;
    const found = this.store.get(id);
    if (!found) return null;
    return validateEnrollmentData(found, id);
  }

  async listAccountEnrollments(accountId: string): Promise<Enrollment[]> {
    return Array.from(this.store.values())
      .filter((e) => e.accountId === accountId)
      .map((e) => validateEnrollmentData(e));
  }

  async saveEnrollment(enrollment: Enrollment): Promise<Enrollment> {
    const validated = validateEnrollmentData(enrollment);
    if (this.store.has(validated.id)) {
      throw new EnrollmentError('ALREADY_ENROLLED', 'The account is already enrolled in this training course.');
    }
    this.store.set(validated.id, { ...validated });
    return validated;
  }
}

class EnrollmentServiceImpl {
  private repository: EnrollmentRepository = new FirestoreEnrollmentRepository();

  setRepository(repository: EnrollmentRepository): void {
    this.repository = repository;
  }

  getRepository(): EnrollmentRepository {
    return this.repository;
  }

  async enrollAccount(accountId: string, courseId: string): Promise<Enrollment> {
    if (!accountId || !accountId.trim()) {
      throw new EnrollmentError('AUTH_REQUIRED', 'Authentication is required to enroll in a training course.');
    }
    if (!courseId || !courseId.trim()) {
      throw new EnrollmentError('COURSE_UNAVAILABLE', 'A valid course ID is required to enroll.');
    }

    // Verify canonical TrainingCourse existence and Published status
    const course = await TrainingCourseService.getCourseById(courseId);
    if (!course || course.workflowState !== WorkflowState.Published) {
      throw new EnrollmentError('COURSE_UNAVAILABLE', 'The specified training course is not available or eligible for enrollment.');
    }

    const enrollmentId = `${accountId}_${courseId}`;
    const existing = await this.repository.getEnrollment(accountId, courseId);
    if (existing) {
      throw new EnrollmentError('ALREADY_ENROLLED', 'The account is already enrolled in this training course.');
    }

    const newEnrollment: Enrollment = {
      id: enrollmentId,
      accountId,
      courseId,
      createdAt: new Date().toISOString(),
    };

    return await this.repository.saveEnrollment(newEnrollment);
  }

  async getEnrollment(accountId: string, courseId: string): Promise<Enrollment | null> {
    if (!accountId || !accountId.trim()) {
      throw new EnrollmentError('AUTH_REQUIRED', 'Authentication is required to query enrollments.');
    }
    return await this.repository.getEnrollment(accountId, courseId);
  }

  async listAccountEnrollments(accountId: string): Promise<Enrollment[]> {
    if (!accountId || !accountId.trim()) {
      throw new EnrollmentError('AUTH_REQUIRED', 'Authentication is required to list enrollments.');
    }
    return await this.repository.listAccountEnrollments(accountId);
  }
}

export const EnrollmentService = new EnrollmentServiceImpl();
