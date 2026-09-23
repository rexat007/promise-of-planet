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
import type { Category } from '../types';
import type { TrainingCourse, TrainingLevel, DeliveryMode, TrainingClassification } from '../types/training';
import { WorkflowState } from '../types/workflow';
import type { AdminUser } from '../types/admin';
import { AdminPermission } from '../types/admin';
import { AdminAccessService } from './adminAccess';

export type TrainingCourseErrorType = 
  | 'BACKEND_UNAVAILABLE'
  | 'COURSE_NOT_FOUND'
  | 'COURSE_DATA_INVALID'
  | 'COURSE_SAVE_FAILED'
  | 'UNAUTHORIZED';

export class TrainingCourseError extends Error {
  code: TrainingCourseErrorType;

  constructor(code: TrainingCourseErrorType, message: string) {
    super(message);
    this.name = 'TrainingCourseError';
    this.code = code;
  }
}

export const VALID_CATEGORIES: Category[] = [
  'Climate',
  'Water',
  'Biodiversity',
  'Pollution',
  'Energy',
  'Agriculture',
  'EnvironmentalPolicy'
];

export const VALID_LEVELS: TrainingLevel[] = [
  'Beginner',
  'Intermediate',
  'Advanced'
];

export const VALID_DELIVERY_MODES: DeliveryMode[] = [
  'OnlineSelfPaced',
  'LiveWorkshop',
  'FieldCohort'
];

export const VALID_WORKFLOW_STATES: WorkflowState[] = [
  WorkflowState.Draft,
  WorkflowState.InReview,
  WorkflowState.ChangesRequested,
  WorkflowState.Approved,
  WorkflowState.Published,
];

/**
 * Validates runtime TrainingCourse data against the canonical TrainingCourse schema.
 * Throws TrainingCourseError('COURSE_DATA_INVALID') if malformed or containing forbidden fields.
 */
export function validateTrainingCourseData(data: any, expectedId?: string): TrainingCourse {
  if (!data || typeof data !== 'object') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course document data is missing or invalid.');
  }

  const allowedKeys = [
    'id',
    'titleAr',
    'titleEn',
    'summaryAr',
    'summaryEn',
    'descriptionAr',
    'descriptionEn',
    'category',
    'level',
    'durationHours',
    'deliveryMode',
    'targetAudienceAr',
    'targetAudienceEn',
    'instructorNameAr',
    'instructorNameEn',
    'instructorBioAr',
    'instructorBioEn',
    'workflowState',
    'workflowHistory',
    'createdAt',
    'updatedAt',
    'author',
    'language'
  ];

  const keys = Object.keys(data);
  const forbidden = keys.filter(k => !allowedKeys.includes(k));
  if (forbidden.length > 0) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course document contains non-canonical or forbidden fields: ${forbidden.join(', ')}`);
  }

  const {
    id,
    titleAr,
    titleEn,
    summaryAr,
    summaryEn,
    descriptionAr,
    descriptionEn,
    category,
    level,
    durationHours,
    deliveryMode,
    targetAudienceAr,
    targetAudienceEn,
    instructorNameAr,
    instructorNameEn,
    instructorBioAr,
    instructorBioEn,
    workflowState,
    workflowHistory,
    createdAt,
    updatedAt,
    author,
    language
  } = data;

  if (typeof id !== 'string' || id.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course id must be a non-empty string.');
  }

  if (expectedId && id !== expectedId) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course document id '${id}' does not match expected id '${expectedId}'.`);
  }

  if (typeof titleAr !== 'string' || titleAr.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course titleAr must be a non-empty string.');
  }

  if (typeof titleEn !== 'string' || titleEn.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course titleEn must be a non-empty string.');
  }

  if (typeof summaryAr !== 'string' || summaryAr.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course summaryAr must be a non-empty string.');
  }

  if (typeof summaryEn !== 'string' || summaryEn.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course summaryEn must be a non-empty string.');
  }

  if (descriptionAr !== undefined && typeof descriptionAr !== 'string') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course descriptionAr must be a string if provided.');
  }

  if (descriptionEn !== undefined && typeof descriptionEn !== 'string') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course descriptionEn must be a string if provided.');
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course category '${category}' is invalid.`);
  }

  if (!VALID_LEVELS.includes(level)) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course level '${level}' is invalid.`);
  }

  if (typeof durationHours !== 'number' || isNaN(durationHours) || durationHours < 0) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course durationHours must be a non-negative number.');
  }

  if (!VALID_DELIVERY_MODES.includes(deliveryMode)) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course deliveryMode '${deliveryMode}' is invalid.`);
  }

  if (typeof targetAudienceAr !== 'string' || targetAudienceAr.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course targetAudienceAr must be a non-empty string.');
  }

  if (typeof targetAudienceEn !== 'string' || targetAudienceEn.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course targetAudienceEn must be a non-empty string.');
  }

  if (instructorNameAr !== undefined && typeof instructorNameAr !== 'string') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course instructorNameAr must be a string if provided.');
  }

  if (instructorNameEn !== undefined && typeof instructorNameEn !== 'string') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course instructorNameEn must be a string if provided.');
  }

  if (instructorBioAr !== undefined && typeof instructorBioAr !== 'string') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course instructorBioAr must be a string if provided.');
  }

  if (instructorBioEn !== undefined && typeof instructorBioEn !== 'string') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course instructorBioEn must be a string if provided.');
  }

  if (!VALID_WORKFLOW_STATES.includes(workflowState)) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course workflowState '${workflowState}' is invalid.`);
  }

  if (!Array.isArray(workflowHistory)) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course workflowHistory must be an array.');
  }

  if (typeof createdAt !== 'string' || createdAt.trim() === '' || isNaN(Date.parse(createdAt))) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course createdAt must be a valid ISO date string.');
  }

  if (typeof updatedAt !== 'string' || updatedAt.trim() === '' || isNaN(Date.parse(updatedAt))) {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course updatedAt must be a valid ISO date string.');
  }

  if (typeof author !== 'string' || author.trim() === '') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', 'Course author must be a non-empty string.');
  }

  if (language !== 'ar' && language !== 'en') {
    throw new TrainingCourseError('COURSE_DATA_INVALID', `Course language '${language}' must be 'ar' or 'en'.`);
  }

  return {
    id: id.trim(),
    titleAr: titleAr.trim(),
    titleEn: titleEn.trim(),
    summaryAr: summaryAr.trim(),
    summaryEn: summaryEn.trim(),
    descriptionAr: descriptionAr ? descriptionAr.trim() : undefined,
    descriptionEn: descriptionEn ? descriptionEn.trim() : undefined,
    category,
    level,
    durationHours,
    deliveryMode,
    targetAudienceAr: targetAudienceAr.trim(),
    targetAudienceEn: targetAudienceEn.trim(),
    instructorNameAr: instructorNameAr ? instructorNameAr.trim() : undefined,
    instructorNameEn: instructorNameEn ? instructorNameEn.trim() : undefined,
    instructorBioAr: instructorBioAr ? instructorBioAr.trim() : undefined,
    instructorBioEn: instructorBioEn ? instructorBioEn.trim() : undefined,
    workflowState,
    workflowHistory,
    createdAt,
    updatedAt,
    author: author.trim(),
    language
  };
}

/**
 * Serializes a TrainingCourse to a Firestore-safe plain object,
 * strictly omitting any keys with undefined values so that Firestore's setDoc does not throw an error.
 */
export function serializeTrainingCourseForFirestore(course: TrainingCourse): Record<string, any> {
  const safePayload: Record<string, any> = {};
  
  const fields: (keyof TrainingCourse)[] = [
    'id',
    'titleAr',
    'titleEn',
    'summaryAr',
    'summaryEn',
    'descriptionAr',
    'descriptionEn',
    'category',
    'level',
    'durationHours',
    'deliveryMode',
    'targetAudienceAr',
    'targetAudienceEn',
    'instructorNameAr',
    'instructorNameEn',
    'instructorBioAr',
    'instructorBioEn',
    'workflowState',
    'createdAt',
    'updatedAt',
    'author',
    'language'
  ];

  for (const field of fields) {
    if (course[field] !== undefined) {
      safePayload[field] = course[field];
    }
  }

  // Handle nested workflowHistory array elements securely to avoid nested undefined values (e.g. comment?: string)
  if (course.workflowHistory !== undefined) {
    safePayload.workflowHistory = course.workflowHistory.map(record => {
      const cleanRecord: Record<string, any> = {
        id: record.id,
        fromState: record.fromState,
        toState: record.toState,
        action: record.action,
        actorName: record.actorName,
        actorRole: record.actorRole,
        timestamp: record.timestamp
      };
      if (record.comment !== undefined) {
        cleanRecord.comment = record.comment;
      }
      return cleanRecord;
    });
  }

  return safePayload;
}

export interface TrainingCourseRepository {
  listCourses(classification?: TrainingClassification, includeUnpublished?: boolean): Promise<TrainingCourse[]>;
  getCourseById(id: string): Promise<TrainingCourse | null>;
  saveCourse(course: TrainingCourse): Promise<TrainingCourse>;
}

/**
 * Production Durable Training Course Repository backed strictly by Firestore training_courses/{courseId}.
 * Does NOT fall back to in-memory storage or mock data when Firebase is unconfigured.
 */
export class FirestoreTrainingCourseRepository implements TrainingCourseRepository {
  protected isConfigured(): boolean {
    return isFirebaseConfigured && !!db;
  }

  async listCourses(classification?: TrainingClassification, includeUnpublished = false): Promise<TrainingCourse[]> {
    if (!this.isConfigured()) {
      throw new TrainingCourseError('BACKEND_UNAVAILABLE', 'Training backend is unconfigured or unavailable.');
    }

    try {
      const coursesRef = collection(db, 'training_courses');
      let q;
      if (!includeUnpublished) {
        q = query(coursesRef, where('workflowState', '==', WorkflowState.Published));
      } else {
        q = query(coursesRef);
      }

      const snapshot = await getDocs(q);
      const courses: TrainingCourse[] = [];

      for (const docSnap of snapshot.docs) {
        const raw = docSnap.data();
        const validated = validateTrainingCourseData(raw, docSnap.id);

        if (classification) {
          if (classification.category && validated.category !== classification.category) continue;
          if (classification.level && validated.level !== classification.level) continue;
          if (classification.deliveryMode && validated.deliveryMode !== classification.deliveryMode) continue;
          if (classification.workflowState && validated.workflowState !== classification.workflowState) continue;
          if (classification.searchQuery?.trim()) {
            const sq = classification.searchQuery.toLowerCase();
            const matchTitleAr = validated.titleAr.toLowerCase().includes(sq);
            const matchTitleEn = validated.titleEn.toLowerCase().includes(sq);
            const matchSummaryAr = validated.summaryAr.toLowerCase().includes(sq);
            const matchSummaryEn = validated.summaryEn.toLowerCase().includes(sq);
            if (!matchTitleAr && !matchTitleEn && !matchSummaryAr && !matchSummaryEn) continue;
          }
        }

        courses.push(validated);
      }

      return courses;
    } catch (error: any) {
      if (error instanceof TrainingCourseError) {
        throw error;
      }
      try {
        handleFirestoreError(error, OperationType.LIST, 'training_courses');
      } catch {
        throw new TrainingCourseError('BACKEND_UNAVAILABLE', 'Training course storage operation failed or backend is unavailable.');
      }
    }
  }

  async getCourseById(id: string): Promise<TrainingCourse | null> {
    if (!id || typeof id !== 'string') {
      return null;
    }

    if (!this.isConfigured()) {
      throw new TrainingCourseError('BACKEND_UNAVAILABLE', 'Training backend is unconfigured or unavailable.');
    }

    try {
      const docRef = doc(db, 'training_courses', id);
      const snapshot = await getDoc(docRef);
      if (!snapshot.exists()) {
        return null;
      }
      return validateTrainingCourseData(snapshot.data(), id);
    } catch (error: any) {
      if (error instanceof TrainingCourseError) {
        throw error;
      }
      try {
        handleFirestoreError(error, OperationType.GET, `training_courses/${id}`);
      } catch {
        throw new TrainingCourseError('BACKEND_UNAVAILABLE', 'Training course storage operation failed or backend is unavailable.');
      }
    }
  }

  async saveCourse(course: TrainingCourse): Promise<TrainingCourse> {
    if (!this.isConfigured()) {
      throw new TrainingCourseError('BACKEND_UNAVAILABLE', 'Training backend is unconfigured or unavailable.');
    }

    const validated = validateTrainingCourseData(course, course.id);

    try {
      const docRef = doc(db, 'training_courses', validated.id);
      const safePayload = serializeTrainingCourseForFirestore(validated);
      await setDoc(docRef, safePayload);
      return validated;
    } catch (error: any) {
      if (error instanceof TrainingCourseError) {
        throw error;
      }
      try {
        handleFirestoreError(error, OperationType.WRITE, `training_courses/${validated.id}`);
      } catch {
        throw new TrainingCourseError('BACKEND_UNAVAILABLE', 'Training course storage operation failed or backend is unavailable.');
      }
    }
  }
}

/**
 * Isolated In-Memory Training Course Repository for testing only.
 * Must be explicitly injected and is NEVER automatically selected by production TrainingCourseService.
 */
export class InMemoryTrainingCourseRepository implements TrainingCourseRepository {
  private courses = new Map<string, TrainingCourse>();

  async listCourses(classification?: TrainingClassification, includeUnpublished = false): Promise<TrainingCourse[]> {
    const list: TrainingCourse[] = [];
    for (const [id, raw] of this.courses.entries()) {
      const validated = validateTrainingCourseData(raw, id);
      if (!includeUnpublished && validated.workflowState !== WorkflowState.Published) {
        continue;
      }
      if (classification) {
        if (classification.category && validated.category !== classification.category) continue;
        if (classification.level && validated.level !== classification.level) continue;
        if (classification.deliveryMode && validated.deliveryMode !== classification.deliveryMode) continue;
        if (classification.workflowState && validated.workflowState !== classification.workflowState) continue;
        if (classification.searchQuery?.trim()) {
          const sq = classification.searchQuery.toLowerCase();
          const matchTitleAr = validated.titleAr.toLowerCase().includes(sq);
          const matchTitleEn = validated.titleEn.toLowerCase().includes(sq);
          const matchSummaryAr = validated.summaryAr.toLowerCase().includes(sq);
          const matchSummaryEn = validated.summaryEn.toLowerCase().includes(sq);
          if (!matchTitleAr && !matchTitleEn && !matchSummaryAr && !matchSummaryEn) continue;
        }
      }
      list.push(validated);
    }
    return list;
  }

  async getCourseById(id: string): Promise<TrainingCourse | null> {
    if (!id) return null;
    const raw = this.courses.get(id);
    if (!raw) return null;
    return validateTrainingCourseData(raw, id);
  }

  async saveCourse(course: TrainingCourse): Promise<TrainingCourse> {
    const validated = validateTrainingCourseData(course, course.id);
    this.courses.set(validated.id, validated);
    return validated;
  }

  seed(rawCourse: any) {
    this.courses.set(rawCourse.id, rawCourse);
  }

  clear() {
    this.courses.clear();
  }
}

export class TrainingCourseServiceClass {
  private repository: TrainingCourseRepository;

  constructor(repository?: TrainingCourseRepository) {
    this.repository = repository || new FirestoreTrainingCourseRepository();
  }

  setRepository(repository: TrainingCourseRepository) {
    this.repository = repository;
  }

  getRepository(): TrainingCourseRepository {
    return this.repository;
  }

  async listCourses(classification?: TrainingClassification, includeUnpublished = false): Promise<TrainingCourse[]> {
    return await this.repository.listCourses(classification, includeUnpublished);
  }

  async getCourseById(id: string): Promise<TrainingCourse | null> {
    return await this.repository.getCourseById(id);
  }

  async saveCourse(course: TrainingCourse, user: AdminUser): Promise<TrainingCourse> {
    if (!user) {
      throw new TrainingCourseError('UNAUTHORIZED', 'Administrative user authorization context is required to save training courses.');
    }
    if (!user.isActive) {
      throw new TrainingCourseError('UNAUTHORIZED', 'Inactive administrator user has zero administrative authority.');
    }
    const hasCreate = AdminAccessService.hasPermission(user, AdminPermission.Create);
    const hasEdit = AdminAccessService.hasPermission(user, AdminPermission.Edit);
    if (!hasCreate && !hasEdit) {
      throw new TrainingCourseError('UNAUTHORIZED', 'User does not possess administrative permission to save training courses.');
    }
    const existing = await this.repository.getCourseById(course.id);
    const requiredPermission = existing ? AdminPermission.Edit : AdminPermission.Create;
    if (!AdminAccessService.hasPermission(user, requiredPermission)) {
      throw new TrainingCourseError('UNAUTHORIZED', 'User does not possess administrative permission to save training courses.');
    }
    return await this.repository.saveCourse(course);
  }
}

export const TrainingCourseService = new TrainingCourseServiceClass();
