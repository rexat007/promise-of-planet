import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  app,
  auth,
  db,
  isFirebaseConfigured,
  isFirebaseStorageConfigured,
  handleFirestoreError,
  OperationType,
} from './firebase';
import { AccountService } from './accountService';
import { AdminAccessService } from './adminAccess';
import { AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import {
  SubmissionStatus,
  CANONICAL_COMMUNITY_CATEGORIES,
  type CitizenSubmission,
  type CitizenSubmissionAttachment,
} from '../types/community';

export type CitizenSubmissionErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'ATTACHMENT_INVALID'
  | 'ATTACHMENT_UPLOAD_FAILED'
  | 'BACKEND_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED';

export class CitizenSubmissionError extends Error {
  code: CitizenSubmissionErrorCode;

  constructor(code: CitizenSubmissionErrorCode, message: string) {
    super(message);
    this.name = 'CitizenSubmissionError';
    this.code = code;
  }
}

export const ALLOWED_EVIDENCE_MIMES: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'application/pdf': 'document',
};

export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024; // 15 MB per file
export const MAX_EVIDENCE_FILES = 5;

export interface EvidenceFileInput {
  name: string;
  type: string;
  size: number;
  file?: File | Blob | Uint8Array;
}

export function validateEvidenceFile(file: EvidenceFileInput): {
  valid: boolean;
  fileType?: 'image' | 'video' | 'audio' | 'document';
  error?: string;
} {
  if (!file || typeof file.name !== 'string' || !file.name.trim()) {
    return { valid: false, error: 'File name is missing.' };
  }
  const mime = (file.type || '').trim().toLowerCase();
  const fileType = ALLOWED_EVIDENCE_MIMES[mime];
  if (!fileType) {
    return {
      valid: false,
      error: `Unsupported file type '${file.type || 'unknown'}'. Allowed: JPG, PNG, WEBP, MP4, WEBM, MOV, MP3, WAV, OGG, PDF.`,
    };
  }
  if (typeof file.size !== 'number' || isNaN(file.size) || file.size <= 0) {
    return { valid: false, error: `File '${file.name}' is empty or unreadable.` };
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return {
      valid: false,
      error: `File '${file.name}' exceeds the 15 MB maximum size limit.`,
    };
  }
  return { valid: true, fileType };
}

export function sanitizeEvidenceFileName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80);
}

export function validateCitizenSubmissionData(
  data: any,
  expectedId?: string
): CitizenSubmission {
  if (!data || typeof data !== 'object') {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Submission data must be a valid object.');
  }

  const allowedKeys = [
    'id',
    'submittedAt',
    'submittedByUid',
    'contributorName',
    'contributorContact',
    'title',
    'body',
    'sourceLanguage',
    'category',
    'locationDescription',
    'status',
    'attachments',
    'editorialReferenceId',
    'moderatorNotes',
    'reviewedByUid',
    'reviewedByName',
    'updatedAt',
  ];

  const extraKeys = Object.keys(data).filter(k => !allowedKeys.includes(k));
  if (extraKeys.length > 0) {
    throw new CitizenSubmissionError(
      'VALIDATION_ERROR',
      `Submission contains non-canonical fields: ${extraKeys.join(', ')}`
    );
  }

  if (typeof data.id !== 'string' || !data.id.trim()) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Submission id is required.');
  }
  if (expectedId && data.id !== expectedId) {
    throw new CitizenSubmissionError(
      'VALIDATION_ERROR',
      `Submission id '${data.id}' does not match expected id '${expectedId}'.`
    );
  }

  if (typeof data.submittedByUid !== 'string' || !data.submittedByUid.trim()) {
    throw new CitizenSubmissionError(
      'VALIDATION_ERROR',
      'Authoritative submittedByUid is required on canonical submissions.'
    );
  }

  if (typeof data.contributorName !== 'string' || data.contributorName.trim().length < 2) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Contributor name is required (minimum 2 characters).');
  }

  if (typeof data.title !== 'string' || data.title.trim().length < 5) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Report title is required (minimum 5 characters).');
  }

  if (typeof data.body !== 'string' || data.body.trim().length < 15) {
    throw new CitizenSubmissionError(
      'VALIDATION_ERROR',
      'Detailed report description is required (minimum 15 characters).'
    );
  }

  if (data.sourceLanguage !== 'ar' && data.sourceLanguage !== 'en') {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Invalid sourceLanguage.');
  }

  if (!CANONICAL_COMMUNITY_CATEGORIES.includes(data.category)) {
    throw new CitizenSubmissionError(
      'VALIDATION_ERROR',
      `Invalid environmental category '${data.category}'.`
    );
  }

  const validStatuses = Object.values(SubmissionStatus);
  if (!validStatuses.includes(data.status)) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', `Invalid submission status '${data.status}'.`);
  }

  if (typeof data.submittedAt !== 'string' || isNaN(Date.parse(data.submittedAt))) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Invalid submittedAt timestamp.');
  }

  if (typeof data.updatedAt !== 'string' || isNaN(Date.parse(data.updatedAt))) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Invalid updatedAt timestamp.');
  }

  if (!Array.isArray(data.attachments)) {
    throw new CitizenSubmissionError('VALIDATION_ERROR', 'Attachments must be an array.');
  }

  if (data.attachments.length > MAX_EVIDENCE_FILES) {
    throw new CitizenSubmissionError(
      'ATTACHMENT_INVALID',
      `Maximum ${MAX_EVIDENCE_FILES} attachments allowed per submission.`
    );
  }

  const requiredStoragePrefix = `citizen_submissions/${data.submittedByUid}/${data.id}/`;
  const validatedAttachments: CitizenSubmissionAttachment[] = data.attachments.map((att: any) => {
    if (!att || typeof att !== 'object') {
      throw new CitizenSubmissionError('ATTACHMENT_INVALID', 'Invalid attachment entry.');
    }
    if (typeof att.id !== 'string' || !att.id.trim() || typeof att.fileName !== 'string' || !att.fileName.trim()) {
      throw new CitizenSubmissionError('ATTACHMENT_INVALID', 'Attachment id and fileName are required.');
    }
    if (!['image', 'video', 'audio', 'document'].includes(att.fileType)) {
      throw new CitizenSubmissionError('ATTACHMENT_INVALID', `Invalid attachment fileType '${att.fileType}'.`);
    }
    if (
      typeof att.storagePath !== 'string' ||
      !att.storagePath.startsWith(requiredStoragePrefix) ||
      att.storagePath.includes('..') ||
      att.storagePath.includes('\\')
    ) {
      throw new CitizenSubmissionError(
        'ATTACHMENT_INVALID',
        `Attachment storagePath must be strictly bound to owner and submission ('${requiredStoragePrefix}').`
      );
    }

    const fileUrl = typeof att.fileUrl === 'string' ? att.fileUrl.trim() : '';
    const encodedPath = encodeURIComponent(att.storagePath);
    const isCanonicalStorageUri = fileUrl === `storage://${att.storagePath}`;
    const isFirebaseStorageUrl =
      fileUrl.startsWith('https://firebasestorage.googleapis.com/') && fileUrl.includes(encodedPath);

    if (!isCanonicalStorageUri && !isFirebaseStorageUrl) {
      throw new CitizenSubmissionError(
        'ATTACHMENT_INVALID',
        'Fake or unverified external attachment URL is forbidden.'
      );
    }

    if (att.mimeType !== undefined) {
      const expectedType = ALLOWED_EVIDENCE_MIMES[String(att.mimeType).toLowerCase()];
      if (!expectedType || expectedType !== att.fileType) {
        throw new CitizenSubmissionError('ATTACHMENT_INVALID', 'Attachment MIME type mismatch.');
      }
    }

    if (att.sizeBytes !== undefined) {
      if (typeof att.sizeBytes !== 'number' || att.sizeBytes <= 0 || att.sizeBytes > MAX_EVIDENCE_BYTES) {
        throw new CitizenSubmissionError('ATTACHMENT_INVALID', 'Attachment sizeBytes is invalid or exceeds 15 MB.');
      }
    }

    return {
      id: att.id.trim(),
      fileName: att.fileName.trim(),
      fileType: att.fileType,
      fileUrl,
      storagePath: att.storagePath,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
    };
  });

  return {
    id: data.id.trim(),
    submittedAt: data.submittedAt,
    submittedByUid: data.submittedByUid.trim(),
    contributorName: data.contributorName.trim(),
    contributorContact: data.contributorContact ? String(data.contributorContact).trim() : undefined,
    title: data.title.trim(),
    body: data.body.trim(),
    sourceLanguage: data.sourceLanguage,
    category: data.category,
    locationDescription: data.locationDescription ? String(data.locationDescription).trim() : undefined,
    status: data.status,
    attachments: validatedAttachments,
    editorialReferenceId: data.editorialReferenceId ? String(data.editorialReferenceId).trim() : undefined,
    moderatorNotes: data.moderatorNotes ? String(data.moderatorNotes).trim() : undefined,
    reviewedByUid: data.reviewedByUid ? String(data.reviewedByUid).trim() : undefined,
    reviewedByName: data.reviewedByName ? String(data.reviewedByName).trim() : undefined,
    updatedAt: data.updatedAt,
  };
}

function serializeSubmissionForFirestore(sub: CitizenSubmission): Record<string, any> {
  const payload: Record<string, any> = {};
  for (const [k, v] of Object.entries(sub)) {
    if (v !== undefined) {
      if (k === 'attachments' && Array.isArray(v)) {
        payload[k] = v.map(att => {
          const cleanAtt: Record<string, any> = {};
          for (const [ak, av] of Object.entries(att)) {
            if (av !== undefined) cleanAtt[ak] = av;
          }
          return cleanAtt;
        });
      } else {
        payload[k] = v;
      }
    }
  }
  return payload;
}

export interface CitizenSubmissionRepository {
  createSubmission(submission: CitizenSubmission): Promise<CitizenSubmission>;
  getSubmissionById(id: string): Promise<CitizenSubmission | null>;
  listAllSubmissions(): Promise<CitizenSubmission[]>;
  listSubmissionsByUid(uid: string): Promise<CitizenSubmission[]>;
  updateSubmission(submission: CitizenSubmission): Promise<CitizenSubmission>;
}

export interface CitizenEvidenceStorageAdapter {
  uploadEvidence(
    uid: string,
    submissionId: string,
    fileInput: EvidenceFileInput
  ): Promise<CitizenSubmissionAttachment>;
  deleteEvidence(storagePath: string): Promise<void>;
  resolveAuthorizedUrl(storagePath: string): Promise<string>;
}

export class FirebaseCitizenEvidenceStorageAdapter implements CitizenEvidenceStorageAdapter {
  async uploadEvidence(
    uid: string,
    submissionId: string,
    fileInput: EvidenceFileInput
  ): Promise<CitizenSubmissionAttachment> {
    if (!isFirebaseStorageConfigured || !app) {
      throw new CitizenSubmissionError(
        'ATTACHMENT_UPLOAD_FAILED',
        'Firebase Storage is not configured in this environment. Evidence attachments cannot be uploaded.'
      );
    }
    if (!auth?.currentUser || auth.currentUser.uid !== uid) {
      throw new CitizenSubmissionError(
        'AUTH_REQUIRED',
        'Authenticated session mismatch for evidence attachment upload.'
      );
    }

    const validation = validateEvidenceFile(fileInput);
    if (!validation.valid || !validation.fileType) {
      throw new CitizenSubmissionError('ATTACHMENT_INVALID', validation.error || 'Invalid evidence file.');
    }

    if (!fileInput.file) {
      throw new CitizenSubmissionError('ATTACHMENT_INVALID', 'Binary file payload is missing.');
    }

    const attachmentId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const safeName = sanitizeEvidenceFileName(fileInput.name);
    const storagePath = `citizen_submissions/${uid}/${submissionId}/${attachmentId}_${safeName}`;

    try {
      const storage = getStorage(app);
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, fileInput.file as Blob, {
        contentType: fileInput.type,
        customMetadata: {
          ownerUid: uid,
          submissionId,
          attachmentId,
        },
      });

      return {
        id: attachmentId,
        fileName: fileInput.name.trim(),
        fileType: validation.fileType,
        fileUrl: `storage://${storagePath}`,
        storagePath,
        mimeType: fileInput.type.trim().toLowerCase(),
        sizeBytes: fileInput.size,
      };
    } catch (err: any) {
      if (err instanceof CitizenSubmissionError) throw err;
      throw new CitizenSubmissionError(
        'ATTACHMENT_UPLOAD_FAILED',
        `Evidence upload failed for '${fileInput.name}'. Ensure Firebase Storage rules are deployed and active.`
      );
    }
  }

  async deleteEvidence(storagePath: string): Promise<void> {
    if (!isFirebaseStorageConfigured || !app || !storagePath) return;
    try {
      const storage = getStorage(app);
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);
    } catch {
      // Best-effort cleanup of partial uploads
    }
  }

  async resolveAuthorizedUrl(storagePath: string): Promise<string> {
    if (!isFirebaseStorageConfigured || !app) {
      throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Firebase Storage is not configured.');
    }
    if (!auth?.currentUser) {
      throw new CitizenSubmissionError('AUTH_REQUIRED', 'Authentication required to access private evidence.');
    }
    const storage = getStorage(app);
    const storageRef = ref(storage, storagePath);
    return await getDownloadURL(storageRef);
  }
}

export class InMemoryCitizenEvidenceStorageAdapter implements CitizenEvidenceStorageAdapter {
  private objects = new Map<string, { uid: string; submissionId: string; fileName: string; mimeType: string; sizeBytes: number }>();
  private shouldFailUploads = false;

  setShouldFailUploads(fail: boolean): void {
    this.shouldFailUploads = fail;
  }

  hasObject(storagePath: string): boolean {
    return this.objects.has(storagePath);
  }

  getObjectCount(): number {
    return this.objects.size;
  }

  clear(): void {
    this.objects.clear();
    this.shouldFailUploads = false;
  }

  async uploadEvidence(
    uid: string,
    submissionId: string,
    fileInput: EvidenceFileInput
  ): Promise<CitizenSubmissionAttachment> {
    const validation = validateEvidenceFile(fileInput);
    if (!validation.valid || !validation.fileType) {
      throw new CitizenSubmissionError('ATTACHMENT_INVALID', validation.error || 'Invalid evidence file.');
    }

    if (this.shouldFailUploads) {
      throw new CitizenSubmissionError('ATTACHMENT_UPLOAD_FAILED', `Simulated storage upload failure for '${fileInput.name}'.`);
    }

    const attachmentId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const safeName = sanitizeEvidenceFileName(fileInput.name);
    const storagePath = `citizen_submissions/${uid}/${submissionId}/${attachmentId}_${safeName}`;

    this.objects.set(storagePath, {
      uid,
      submissionId,
      fileName: fileInput.name.trim(),
      mimeType: fileInput.type.trim().toLowerCase(),
      sizeBytes: fileInput.size,
    });

    return {
      id: attachmentId,
      fileName: fileInput.name.trim(),
      fileType: validation.fileType,
      fileUrl: `storage://${storagePath}`,
      storagePath,
      mimeType: fileInput.type.trim().toLowerCase(),
      sizeBytes: fileInput.size,
    };
  }

  async deleteEvidence(storagePath: string): Promise<void> {
    this.objects.delete(storagePath);
  }

  async resolveAuthorizedUrl(storagePath: string): Promise<string> {
    if (!this.objects.has(storagePath)) {
      throw new CitizenSubmissionError('NOT_FOUND', 'Evidence object not found in storage.');
    }
    return `https://firebasestorage.googleapis.com/v0/b/promise-of-planet/o/${encodeURIComponent(storagePath)}?alt=media`;
  }
}

export class FirestoreCitizenSubmissionRepository implements CitizenSubmissionRepository {
  private isConfigured(): boolean {
    return isFirebaseConfigured && !!db;
  }

  async createSubmission(submission: CitizenSubmission): Promise<CitizenSubmission> {
    if (!this.isConfigured()) {
      throw new CitizenSubmissionError(
        'BACKEND_UNAVAILABLE',
        'Firebase backend is not configured or unavailable. Submissions cannot be persisted.'
      );
    }

    const validated = validateCitizenSubmissionData(submission, submission.id);

    // Prefer Cloud Function callable boundary if available, falling back to direct Firestore rule-enforced write
    if (app && auth?.currentUser) {
      try {
        const fns = getFunctions(app);
        const callable = httpsCallable<{ submission: any }, { submission: CitizenSubmission }>(
          fns,
          'submitCitizenReport'
        );
        const result = await callable({ submission: serializeSubmissionForFirestore(validated) });
        if (result.data?.submission) {
          return validateCitizenSubmissionData(result.data.submission);
        }
      } catch (callableErr: any) {
        // If callable fails with explicit validation or auth/precondition error, propagate immediately
        const code = String(callableErr?.code || '');
        if (
          code.includes('unauthenticated') ||
          code.includes('permission-denied') ||
          code.includes('invalid-argument') ||
          code.includes('failed-precondition')
        ) {
          throw new CitizenSubmissionError('VALIDATION_ERROR', callableErr.message || 'Submission rejected by server.');
        }
        // Otherwise attempt rule-enforced Firestore write directly
      }
    }

    try {
      const docRef = doc(db, 'citizen_submissions', validated.id);
      await setDoc(docRef, serializeSubmissionForFirestore(validated));
      return validated;
    } catch (err: any) {
      if (err instanceof CitizenSubmissionError) throw err;
      try {
        handleFirestoreError(err, OperationType.CREATE, `citizen_submissions/${validated.id}`);
      } catch {
        throw new CitizenSubmissionError(
          'BACKEND_UNAVAILABLE',
          'Unable to persist citizen submission to Firestore. Ensure Firestore rules for citizen_submissions are deployed.'
        );
      }
    }
  }

  async getSubmissionById(id: string): Promise<CitizenSubmission | null> {
    if (!this.isConfigured()) {
      throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Firebase backend is unavailable.');
    }
    try {
      const docRef = doc(db, 'citizen_submissions', id);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;
      return validateCitizenSubmissionData(snap.data(), id);
    } catch (err: any) {
      if (err instanceof CitizenSubmissionError) throw err;
      try {
        handleFirestoreError(err, OperationType.GET, `citizen_submissions/${id}`);
      } catch {
        throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Failed to retrieve citizen submission.');
      }
    }
  }

  async listAllSubmissions(): Promise<CitizenSubmission[]> {
    if (!this.isConfigured()) {
      throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Firebase backend is unavailable.');
    }
    try {
      const snap = await getDocs(collection(db, 'citizen_submissions'));
      return snap.docs
        .map(d => validateCitizenSubmissionData(d.data(), d.id))
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    } catch (err: any) {
      if (err instanceof CitizenSubmissionError) throw err;
      try {
        handleFirestoreError(err, OperationType.LIST, 'citizen_submissions');
      } catch {
        throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Failed to list citizen submissions.');
      }
    }
  }

  async listSubmissionsByUid(uid: string): Promise<CitizenSubmission[]> {
    if (!this.isConfigured()) {
      throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Firebase backend is unavailable.');
    }
    try {
      const q = query(collection(db, 'citizen_submissions'), where('submittedByUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs
        .map(d => validateCitizenSubmissionData(d.data(), d.id))
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    } catch (err: any) {
      if (err instanceof CitizenSubmissionError) throw err;
      try {
        handleFirestoreError(err, OperationType.LIST, 'citizen_submissions');
      } catch {
        throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Failed to list user submissions.');
      }
    }
  }

  async updateSubmission(submission: CitizenSubmission): Promise<CitizenSubmission> {
    if (!this.isConfigured()) {
      throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Firebase backend is unavailable.');
    }
    const validated = validateCitizenSubmissionData(submission, submission.id);
    try {
      const docRef = doc(db, 'citizen_submissions', validated.id);
      await setDoc(docRef, serializeSubmissionForFirestore(validated));
      return validated;
    } catch (err: any) {
      if (err instanceof CitizenSubmissionError) throw err;
      try {
        handleFirestoreError(err, OperationType.UPDATE, `citizen_submissions/${validated.id}`);
      } catch {
        throw new CitizenSubmissionError('BACKEND_UNAVAILABLE', 'Failed to update submission moderation state.');
      }
    }
  }
}

export class InMemoryCitizenSubmissionRepository implements CitizenSubmissionRepository {
  private store = new Map<string, CitizenSubmission>();

  async createSubmission(submission: CitizenSubmission): Promise<CitizenSubmission> {
    const validated = validateCitizenSubmissionData(submission, submission.id);
    if (this.store.has(validated.id)) {
      throw new CitizenSubmissionError('VALIDATION_ERROR', `Submission '${validated.id}' already exists.`);
    }
    this.store.set(validated.id, {
      ...validated,
      attachments: validated.attachments.map(a => ({ ...a })),
    });
    return validated;
  }

  async getSubmissionById(id: string): Promise<CitizenSubmission | null> {
    if (!id) return null;
    const found = this.store.get(id);
    if (!found) return null;
    return validateCitizenSubmissionData(found, id);
  }

  async listAllSubmissions(): Promise<CitizenSubmission[]> {
    return Array.from(this.store.values())
      .map(s => validateCitizenSubmissionData(s, s.id))
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  async listSubmissionsByUid(uid: string): Promise<CitizenSubmission[]> {
    if (!uid) return [];
    return Array.from(this.store.values())
      .filter(s => s.submittedByUid === uid)
      .map(s => validateCitizenSubmissionData(s, s.id))
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  async updateSubmission(submission: CitizenSubmission): Promise<CitizenSubmission> {
    const existing = this.store.get(submission.id);
    if (!existing) {
      throw new CitizenSubmissionError('NOT_FOUND', `Submission '${submission.id}' not found.`);
    }
    const validated = validateCitizenSubmissionData(submission, submission.id);
    this.store.set(validated.id, {
      ...validated,
      attachments: validated.attachments.map(a => ({ ...a })),
    });
    return validated;
  }

  clear(): void {
    this.store.clear();
  }
}

export interface CreateCitizenReportInput {
  contributorName: string;
  contributorContact?: string;
  title: string;
  body: string;
  sourceLanguage: 'ar' | 'en';
  category: string;
  locationDescription?: string;
  evidenceFiles?: EvidenceFileInput[];
  // Any client-supplied status or moderation fields are ignored
  status?: any;
  moderatorNotes?: any;
  editorialReferenceId?: any;
}

export interface ModerateCitizenSubmissionInput {
  status: SubmissionStatus;
  moderatorNotes?: string;
  editorialReferenceId?: string;
}

export class CitizenSubmissionServiceClass {
  private repository: CitizenSubmissionRepository = new FirestoreCitizenSubmissionRepository();
  private storageAdapter: CitizenEvidenceStorageAdapter = new FirebaseCitizenEvidenceStorageAdapter();
  private authProvider?: () => string | null;

  setRepository(repo: CitizenSubmissionRepository): void {
    this.repository = repo;
  }

  getRepository(): CitizenSubmissionRepository {
    return this.repository;
  }

  setStorageAdapter(adapter: CitizenEvidenceStorageAdapter): void {
    this.storageAdapter = adapter;
  }

  getStorageAdapter(): CitizenEvidenceStorageAdapter {
    return this.storageAdapter;
  }

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
   * Submits a citizen journalism field report.
   * - Requires real authenticated user and provisioned canonical Account record.
   * - Binds submittedByUid strictly to authenticated UID.
   * - Forces initial status to SubmissionStatus.Received.
   * - Uploads any evidence files with rollback on partial failure to prevent orphaned files or false success.
   */
  async submitReport(input: CreateCitizenReportInput): Promise<CitizenSubmission> {
    const uid = this.getAuthenticatedUid();
    if (!uid || !uid.trim()) {
      throw new CitizenSubmissionError(
        'AUTH_REQUIRED',
        'You must be signed in with a platform account to submit a field report.'
      );
    }

    // Verify canonical Account profile exists and was properly provisioned
    let account = null;
    try {
      account = await AccountService.getAccount(uid);
    } catch {
      account = null;
    }
    if (!account || account.id !== uid) {
      throw new CitizenSubmissionError(
        'ACCOUNT_UNAVAILABLE',
        'A valid provisioned platform account profile is required before submitting reports.'
      );
    }

    const evidenceFiles = input.evidenceFiles || [];
    if (evidenceFiles.length > MAX_EVIDENCE_FILES) {
      throw new CitizenSubmissionError(
        'ATTACHMENT_INVALID',
        `Maximum ${MAX_EVIDENCE_FILES} attachments are allowed per submission.`
      );
    }

    // Pre-validate all evidence files before any upload starts
    for (const file of evidenceFiles) {
      const check = validateEvidenceFile(file);
      if (!check.valid) {
        throw new CitizenSubmissionError('ATTACHMENT_INVALID', check.error || 'Invalid attachment.');
      }
    }

    const now = new Date().toISOString();
    const submissionId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Pre-validate text fields before uploading any attachments
    const draftCheck: CitizenSubmission = {
      id: submissionId,
      submittedAt: now,
      submittedByUid: uid,
      contributorName: (input.contributorName || '').trim(),
      contributorContact: input.contributorContact?.trim() || undefined,
      title: (input.title || '').trim(),
      body: (input.body || '').trim(),
      sourceLanguage: input.sourceLanguage === 'en' ? 'en' : 'ar',
      category: (input.category || '').trim(),
      locationDescription: input.locationDescription?.trim() || undefined,
      status: SubmissionStatus.Received,
      attachments: [],
      updatedAt: now,
    };
    validateCitizenSubmissionData(draftCheck, submissionId);

    // Upload attachments with atomic rollback on error to avoid orphaned files
    const uploadedAttachments: CitizenSubmissionAttachment[] = [];
    try {
      for (const file of evidenceFiles) {
        const uploaded = await this.storageAdapter.uploadEvidence(uid, submissionId, file);
        uploadedAttachments.push(uploaded);
      }
    } catch (uploadErr: any) {
      for (const att of uploadedAttachments) {
        if (att.storagePath) {
          await this.storageAdapter.deleteEvidence(att.storagePath);
        }
      }
      if (uploadErr instanceof CitizenSubmissionError) {
        throw uploadErr;
      }
      throw new CitizenSubmissionError(
        'ATTACHMENT_UPLOAD_FAILED',
        uploadErr?.message || 'Failed to upload evidence attachments.'
      );
    }

    const finalSubmission: CitizenSubmission = {
      ...draftCheck,
      attachments: uploadedAttachments,
    };

    try {
      return await this.repository.createSubmission(finalSubmission);
    } catch (saveErr: any) {
      // Rollback uploaded files if metadata persistence fails
      for (const att of uploadedAttachments) {
        if (att.storagePath) {
          await this.storageAdapter.deleteEvidence(att.storagePath);
        }
      }
      throw saveErr;
    }
  }

  /**
   * Lists only the authenticated contributor's own submissions.
   * Contributors can never inspect another contributor's private submissions.
   */
  async listMySubmissions(): Promise<CitizenSubmission[]> {
    const uid = this.getAuthenticatedUid();
    if (!uid || !uid.trim()) {
      throw new CitizenSubmissionError('AUTH_REQUIRED', 'Authentication is required to view your submissions.');
    }
    return await this.repository.listSubmissionsByUid(uid);
  }

  /**
   * Lists all citizen submissions for authorized administrative staff.
   */
  async listSubmissionsForAdmin(adminUser: AdminUser | null | undefined): Promise<CitizenSubmission[]> {
    if (!adminUser || !adminUser.isActive) {
      throw new CitizenSubmissionError('UNAUTHORIZED', 'Active administrative credentials are required.');
    }
    const canView =
      AdminAccessService.hasPermission(adminUser, AdminPermission.View) ||
      AdminAccessService.hasPermission(adminUser, AdminPermission.Review);
    if (!canView) {
      throw new CitizenSubmissionError('UNAUTHORIZED', 'Admin user lacks permission to view citizen submissions.');
    }
    return await this.repository.listAllSubmissions();
  }

  /**
   * Updates moderation status and notes on a submission.
   * - Requires AdminPermission.Review (public users and unpermitted admins are blocked).
   * - Preserves contributor ownership and original submission content.
   * - AcceptedForEditorial strictly marks editorial intake status and NEVER automatically publishes to News.
   */
  async moderateSubmission(
    submissionId: string,
    update: ModerateCitizenSubmissionInput,
    adminUser: AdminUser | null | undefined
  ): Promise<CitizenSubmission> {
    if (!adminUser || !adminUser.isActive) {
      throw new CitizenSubmissionError(
        'UNAUTHORIZED',
        'Active administrative credentials are required to moderate submissions.'
      );
    }
    if (!AdminAccessService.hasPermission(adminUser, AdminPermission.Review)) {
      throw new CitizenSubmissionError(
        'UNAUTHORIZED',
        'Review permission is required to modify citizen submission status.'
      );
    }

    const existing = await this.repository.getSubmissionById(submissionId);
    if (!existing) {
      throw new CitizenSubmissionError('NOT_FOUND', `Submission '${submissionId}' not found.`);
    }

    const validStatuses = Object.values(SubmissionStatus);
    if (!validStatuses.includes(update.status)) {
      throw new CitizenSubmissionError('VALIDATION_ERROR', `Invalid moderation status '${update.status}'.`);
    }

    const updated: CitizenSubmission = {
      ...existing,
      id: existing.id,
      submittedAt: existing.submittedAt,
      submittedByUid: existing.submittedByUid,
      status: update.status,
      moderatorNotes: update.moderatorNotes?.trim() ? update.moderatorNotes.trim() : undefined,
      editorialReferenceId:
        update.editorialReferenceId !== undefined
          ? (update.editorialReferenceId.trim() || undefined)
          : existing.editorialReferenceId,
      reviewedByUid: adminUser.id,
      reviewedByName: adminUser.name,
      updatedAt: new Date().toISOString(),
    };

    return await this.repository.updateSubmission(updated);
  }

  /**
   * Resolves private evidence attachment access URL strictly for authorized admin or the owning contributor.
   */
  async resolveAttachmentAccessUrl(
    attachment: CitizenSubmissionAttachment,
    actor: { adminUser?: AdminUser | null; contributorUid?: string | null }
  ): Promise<string> {
    const isAuthorizedAdmin =
      Boolean(actor.adminUser && actor.adminUser.isActive) &&
      (AdminAccessService.hasPermission(actor.adminUser!, AdminPermission.View) ||
        AdminAccessService.hasPermission(actor.adminUser!, AdminPermission.Review));

    const effectiveContributorUid = actor.contributorUid ?? this.getAuthenticatedUid();
    const isOwner =
      Boolean(effectiveContributorUid && attachment.storagePath) &&
      attachment.storagePath!.startsWith(`citizen_submissions/${effectiveContributorUid}/`);

    if (!isAuthorizedAdmin && !isOwner) {
      throw new CitizenSubmissionError(
        'UNAUTHORIZED',
        'Unauthorized access to private citizen submission evidence attachment.'
      );
    }

    if (attachment.storagePath) {
      return await this.storageAdapter.resolveAuthorizedUrl(attachment.storagePath);
    }

    throw new CitizenSubmissionError('ATTACHMENT_INVALID', 'Attachment lacks a valid canonical storagePath.');
  }
}

export const CitizenSubmissionService = new CitizenSubmissionServiceClass();
