import { NewsAdminClient } from './newsAdminClient';
import { PublicNewsClient } from './publicNewsClient';
import { WorkflowState } from '../types/workflow';
import { AdminRole, AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import type { NewsItem } from '../types/news';
import type { 
  NewsRepository, 
  NewsItemBackend, 
  SanitizedPublicNewsDTO 
} from '../../functions/src/news/newsRepository';
import type { AdminRepository } from '../../functions/src/admin/adminRepository';
import { NewsApplicationService } from '../../functions/src/news/newsApplicationService';
import { PublicNewsRepository } from '../../functions/src/news/publicNewsRepository';
import { executeManageNewsRequest } from '../../functions/src/news/newsAdminHandlers';
import { sanitizeForFirestore } from '../../functions/src/news/firestoreNewsRepository';

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

/**
 * Isolated in-memory repository for News items (zero production Firestore mutation).
 */
class InMemoryNewsRepository implements NewsRepository {
  private items = new Map<string, NewsItemBackend>();

  async getById(id: string): Promise<NewsItemBackend | null> {
    const item = this.items.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async save(item: NewsItemBackend): Promise<void> {
    const cleanItem = sanitizeForFirestore({ ...item });
    this.items.set(item.id, JSON.parse(JSON.stringify(cleanItem)));
  }

  async listAll(): Promise<NewsItemBackend[]> {
    return Array.from(this.items.values()).map(v => JSON.parse(JSON.stringify(v)));
  }

  async listPublished(language?: 'ar' | 'en'): Promise<NewsItemBackend[]> {
    return Array.from(this.items.values())
      .filter(item => item.workflowState === 'Published')
      .filter(item => {
        if (item.workflowState !== 'Published') return false;
        if (language === 'en') {
          return Boolean(
            (item.titleEn && item.titleEn.trim()) ||
            (item.bodyEn && item.bodyEn.trim()) ||
            (item.titleAr && item.titleAr.trim())
          );
        }
        return Boolean(item.titleAr && item.titleAr.trim());
      })
      .map(v => JSON.parse(JSON.stringify(v)));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * Isolated in-memory repository for Admin users.
 */
class InMemoryAdminRepository implements AdminRepository {
  private admins = new Map<string, AdminUser>();

  constructor(initialAdmins: AdminUser[] = []) {
    for (const admin of initialAdmins) {
      this.admins.set(admin.id, admin);
    }
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    const admin = this.admins.get(uid);
    return admin ? { ...admin } : null;
  }

  async listAdmins(): Promise<AdminUser[]> {
    return Array.from(this.admins.values()).map(a => ({ ...a }));
  }

  async saveAdmin(admin: AdminUser): Promise<void> {
    this.admins.set(admin.id, { ...admin });
  }

  async deactivateAdmin(uid: string): Promise<void> {
    const admin = this.admins.get(uid);
    if (admin) admin.isActive = false;
  }

  async verifyAdminAccess(uid: string, _requiredPermission: AdminPermission): Promise<boolean> {
    const admin = this.admins.get(uid);
    if (!admin || !admin.isActive) return false;
    return true;
  }
}

export async function runNewsFunctionalTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const assert = (id: string, name: string, condition: boolean, details: string) => {
    results.push({
      id,
      name,
      passed: condition,
      details: condition ? `PASSED: ${details}` : `FAILED: ${details}`,
    });
  };

  // Test admin user fixtures
  const editorAdmin: AdminUser = {
    id: 'admin-editor-1',
    name: 'سارة أحمد - محرر محتوى',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  const ownerAdmin: AdminUser = {
    id: 'admin-owner-1',
    name: 'د. عبد العظيم - رئيس التحرير والمدير',
    email: 'owner@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  };

  const viewerAdmin: AdminUser = {
    id: 'admin-viewer-1',
    name: 'مراقب عام',
    email: 'viewer@promiseofplanet.org',
    role: AdminRole.Viewer,
    isActive: true,
  };

  // Set up in-memory backend services
  const memoryNewsRepo = new InMemoryNewsRepository();
  const memoryAdminRepo = new InMemoryAdminRepository([editorAdmin, ownerAdmin, viewerAdmin]);
  const newsService = new NewsApplicationService(memoryNewsRepo);
  const publicNewsRepo = new PublicNewsRepository(memoryNewsRepo);

  let currentAuthUid: string | null = editorAdmin.id;

  // Wire transports for isolated contract testing
  NewsAdminClient.setTransport(async (action: string, payload?: any) => {
    return executeManageNewsRequest(
      {
        auth: currentAuthUid ? { uid: currentAuthUid } : undefined,
        data: { action, ...payload },
      },
      memoryAdminRepo,
      newsService
    );
  });

  PublicNewsClient.setTransport(async (data: { lang?: 'ar' | 'en' }) => {
    const articles = await publicNewsRepo.listPublicNews(data.lang);
    return { articles };
  });

  // --------------------------------------------------------------------------
  // TEST 1: Truthful Empty State (No Mock News on Empty Backend)
  // --------------------------------------------------------------------------
  try {
    memoryNewsRepo.clear();
    const adminItems = await NewsAdminClient.listAll();
    const publicItems = await PublicNewsClient.listPublishedNews();

    const emptyAdminOk = Array.isArray(adminItems) && adminItems.length === 0;
    const emptyPublicOk = Array.isArray(publicItems) && publicItems.length === 0;

    assert(
      'REQ-01',
      'Truthful Empty State (Zero Mock Injection)',
      emptyAdminOk && emptyPublicOk,
      'Both admin and public clients return empty lists on empty collection without injecting INITIAL_MOCK_NEWS'
    );
  } catch (err: any) {
    assert('REQ-01', 'Truthful Empty State (Zero Mock Injection)', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: New Draft Creation & Server-Authoritative ID Assignment
  // --------------------------------------------------------------------------
  let createdDraft: NewsItem;
  try {
    const provisionalDraftInput: Partial<NewsItem> = {
      titleAr: 'تحقيق استقصائي حول تلوث مياه نهر النيل في ولاية الخرطوم',
      titleEn: 'Investigative Report on River Nile Water Quality in Khartoum State',
      summaryAr: 'دراسة ميدانية توثق مستويات التلوث الزئبقي والنفايات الصناعية في مجرى النيل.',
      summaryEn: 'Field investigation documenting industrial runoff in the Nile River.',
      bodyAr: 'بدأ فريق التحرير جولة ميدانية لرصد عينات المياه وفحص المخلفات الكيميائية في ثلاث مناطق...',
      bodyEn: 'Our editorial investigation team conducted a field assessment collecting water samples...',
      author: editorAdmin.name,
      category: 'الموارد المائية والنيل',
      tags: ['مياه', 'النيل', 'تلوث', 'الخرطوم'],
      sources: ['تقرير هيئة مياه ولاية الخرطوم', 'دراسة جامعة الخرطوم 2025'],
      featuredImage: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957',
      location: 'الخرطوم / Khartoum',
      urgencyLevel: 'Urgent',
    };

    currentAuthUid = editorAdmin.id;
    createdDraft = await NewsAdminClient.saveNewsItem(provisionalDraftInput, editorAdmin, true);

    // Verify client-supplied IDs cannot override server identity
    const spoofedInput: Partial<NewsItem> = {
      ...provisionalDraftInput,
      id: 'client-injected-spoof-id-999',
    };
    const spoofResult = await NewsAdminClient.saveNewsItem(spoofedInput, editorAdmin, true);
    const spoofIdRejected = spoofResult.id !== 'client-injected-spoof-id-999' && spoofResult.id.startsWith('news-');

    const hasServerId = Boolean(createdDraft.id && createdDraft.id.startsWith('news-'));
    const isDraft = createdDraft.workflowState === 'Draft';
    const hasInitialAudit = Array.isArray(createdDraft.history) && createdDraft.history.length === 1;

    assert(
      'REQ-02',
      'New Draft Creation & Server-Authoritative ID',
      hasServerId && isDraft && hasInitialAudit && spoofIdRejected,
      `Draft assigned server ID '${createdDraft.id}' in Draft state with server-authoritative audit entry; client-supplied IDs rejected`
    );
  } catch (err: any) {
    assert('REQ-02', 'New Draft Creation & Server-Authoritative ID', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Fresh Authenticated Backend Read
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    const retrieved = await NewsAdminClient.getById(createdDraft.id);

    const retrievalOk =
      retrieved !== null &&
      retrieved.id === createdDraft.id &&
      retrieved.titleAr === createdDraft.titleAr &&
      retrieved.titleEn === createdDraft.titleEn &&
      retrieved.tags.length === 4 &&
      retrieved.sources.length === 2;

    assert(
      'REQ-03',
      'Fresh Authenticated Backend Read',
      retrievalOk,
      'Saved draft successfully retrieved from backend with all bilingual content and attribution intact'
    );
  } catch (err: any) {
    assert('REQ-03', 'Fresh Authenticated Backend Read', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Role-Based Editorial Authorization Enforcement
  // --------------------------------------------------------------------------
  try {
    // 1. Viewer cannot create drafts (lacks Create permission)
    currentAuthUid = viewerAdmin.id;
    let viewerBlocked = false;
    try {
      await NewsAdminClient.saveNewsItem({ titleAr: 'محاولة غير مصرح بها' }, viewerAdmin, true);
    } catch (_e) {
      viewerBlocked = true;
    }

    // 2. ContentEditor cannot approve (lacks Approve permission)
    currentAuthUid = editorAdmin.id;
    let editorApproveBlocked = false;
    try {
      await NewsAdminClient.executeTransition(createdDraft.id, WorkflowState.Approved, editorAdmin);
    } catch (_e) {
      editorApproveBlocked = true;
    }

    // 3. ContentEditor cannot publish (lacks Publish permission)
    let editorPublishBlocked = false;
    try {
      await NewsAdminClient.executeTransition(createdDraft.id, WorkflowState.Published, editorAdmin);
    } catch (_e) {
      editorPublishBlocked = true;
    }

    // Restore auth to editorAdmin
    currentAuthUid = editorAdmin.id;

    assert(
      'REQ-04',
      'Role-Based Authorization Enforcement',
      viewerBlocked && editorApproveBlocked && editorPublishBlocked,
      'Viewer creation blocked; Editor approval and direct publication strictly blocked by server authorization'
    );
  } catch (err: any) {
    assert('REQ-04', 'Role-Based Authorization Enforcement', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Protection Against Client-Forged Workflow Fields
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    // Attempt to forge published state and fake publication date via updateDraft
    const forgedInput: any = {
      id: createdDraft.id,
      titleAr: createdDraft.titleAr,
      workflowState: 'Published',
      publishedAt: '2020-01-01T00:00:00Z',
      history: [{ id: 'fake', action: 'fake' }],
    };

    const sanitizedUpdate = await NewsAdminClient.saveNewsItem(forgedInput, editorAdmin, false);

    // Verify server rejected forged fields: workflowState remains Draft, publishedAt remains undefined
    const notPublished = sanitizedUpdate.workflowState === 'Draft';
    const noFakeDate = !sanitizedUpdate.publishedAt;
    const historyPreserved = sanitizedUpdate.history.length === 1 && sanitizedUpdate.history[0].id !== 'fake';

    assert(
      'REQ-05',
      'Server-Authoritative Workflow Boundary (No Forgery)',
      notPublished && noFakeDate && historyPreserved,
      'Server completely discarded forged workflowState, publishedAt, and history fields'
    );
  } catch (err: any) {
    assert('REQ-05', 'Server-Authoritative Workflow Boundary (No Forgery)', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Explicit Human Editorial Transitions Sequence
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    // 1. Invalid jump Draft -> Published must fail
    let invalidJumpBlocked = false;
    try {
      currentAuthUid = ownerAdmin.id;
      await NewsAdminClient.executeTransition(createdDraft.id, WorkflowState.Published, ownerAdmin);
    } catch (_e) {
      invalidJumpBlocked = true;
    }

    // 2. Draft -> InReview
    currentAuthUid = editorAdmin.id;
    createdDraft = await NewsAdminClient.executeTransition(
      createdDraft.id,
      WorkflowState.InReview,
      editorAdmin,
      'تقديم للمراجعة التحريرية'
    );

    // 3. InReview -> Approved (by Owner)
    currentAuthUid = ownerAdmin.id;
    createdDraft = await NewsAdminClient.executeTransition(
      createdDraft.id,
      WorkflowState.Approved,
      ownerAdmin,
      'اعتماد التقرير للنشر'
    );

    // 4. Approved -> Published (by Owner)
    createdDraft = await NewsAdminClient.executeTransition(
      createdDraft.id,
      WorkflowState.Published,
      ownerAdmin,
      'نشر عام على المنصة'
    );

    const isPublished = createdDraft.workflowState === 'Published';
    const hasPublishedAt = Boolean(createdDraft.publishedAt);
    const hasAuditTrail = createdDraft.history.length === 4;

    assert(
      'REQ-06',
      'Explicit Human Workflow Sequence',
      invalidJumpBlocked && isPublished && hasPublishedAt && hasAuditTrail,
      'Invalid jumps blocked; Human approval and publication completed with authoritative timestamp and 4 audit records'
    );
  } catch (err: any) {
    assert('REQ-06', 'Explicit Human Workflow Sequence', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Authoritative Editorial Content Lock (Draft-Only Modifications)
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    // 1. Create a fresh test article in Draft
    let lockTestItem = await NewsAdminClient.saveNewsItem(
      {
        titleAr: 'مقال لاختبار قفل المحتوى التحريري',
        titleEn: 'Editorial Content Lock Test Article',
        summaryAr: 'ملخص لاختبار القيود التحريرية على التعديل.',
        category: 'الموارد المائية والنيل',
      },
      editorAdmin,
      true
    );

    // 1a. Draft edit must SUCCEED
    lockTestItem = await NewsAdminClient.saveNewsItem(
      {
        id: lockTestItem.id,
        titleAr: 'مقال لاختبار قفل المحتوى - مسودة معدلة بنجاح',
      },
      editorAdmin,
      false
    );
    const draftEditOk = lockTestItem.titleAr === 'مقال لاختبار قفل المحتوى - مسودة معدلة بنجاح';

    // 2. Transition Draft -> InReview
    lockTestItem = await NewsAdminClient.executeTransition(
      lockTestItem.id,
      WorkflowState.InReview,
      editorAdmin,
      'تقديم للمراجعة'
    );

    // 2a. InReview edit must be REJECTED
    let inReviewEditRejected = false;
    try {
      await NewsAdminClient.saveNewsItem(
        { id: lockTestItem.id, titleAr: 'محاولة تعديل غير مصرح بها أثناء المراجعة' },
        editorAdmin,
        false
      );
    } catch (_e) {
      inReviewEditRejected = true;
    }
    const itemAfterInReview = await NewsAdminClient.getById(lockTestItem.id);
    const inReviewPreserved = itemAfterInReview?.workflowState === WorkflowState.InReview &&
      itemAfterInReview?.titleAr === 'مقال لاختبار قفل المحتوى - مسودة معدلة بنجاح';

    // 3. Transition InReview -> ChangesRequested (by Owner)
    currentAuthUid = ownerAdmin.id;
    lockTestItem = await NewsAdminClient.executeTransition(
      lockTestItem.id,
      WorkflowState.ChangesRequested,
      ownerAdmin,
      'مطلوب توثيق إضافي للمصادر'
    );

    // 3a. ChangesRequested edit must be REJECTED before transition to Draft
    currentAuthUid = editorAdmin.id;
    let changesRequestedEditRejected = false;
    try {
      await NewsAdminClient.saveNewsItem(
        { id: lockTestItem.id, titleAr: 'محاولة تعديل أثناء التعديلات المطلوبة قبل المسودة' },
        editorAdmin,
        false
      );
    } catch (_e) {
      changesRequestedEditRejected = true;
    }

    // 3b. Transition ChangesRequested -> Draft (revise_draft)
    lockTestItem = await NewsAdminClient.executeTransition(
      lockTestItem.id,
      WorkflowState.Draft,
      editorAdmin,
      'إعادة للمسودة لاستكمال التعديلات'
    );

    // 3c. Now in Draft: edit must SUCCEED
    lockTestItem = await NewsAdminClient.saveNewsItem(
      { id: lockTestItem.id, titleAr: 'مقال تم تعديله بعد إعادته للمسودة بنجاح' },
      editorAdmin,
      false
    );
    const changesRequestedAfterDraftEditOk = lockTestItem.titleAr === 'مقال تم تعديله بعد إعادته للمسودة بنجاح';

    // 4. Transition Draft -> InReview -> Approved
    lockTestItem = await NewsAdminClient.executeTransition(
      lockTestItem.id,
      WorkflowState.InReview,
      editorAdmin,
      'إعادة تقديم للمراجعة'
    );
    currentAuthUid = ownerAdmin.id;
    lockTestItem = await NewsAdminClient.executeTransition(
      lockTestItem.id,
      WorkflowState.Approved,
      ownerAdmin,
      'اعتماد رسمي للنشر'
    );

    // 4a. Approved edit must be REJECTED
    let approvedEditRejected = false;
    try {
      await NewsAdminClient.saveNewsItem(
        { id: lockTestItem.id, titleAr: 'محاولة تعديل محظورة بعد الاعتماد' },
        editorAdmin,
        false
      );
    } catch (_e) {
      approvedEditRejected = true;
    }
    const itemAfterApproved = await NewsAdminClient.getById(lockTestItem.id);
    const approvedPreserved = itemAfterApproved?.workflowState === WorkflowState.Approved &&
      itemAfterApproved?.titleAr === 'مقال تم تعديله بعد إعادته للمسودة بنجاح' &&
      itemAfterApproved?.history.length === 6;

    // 5. Transition Approved -> Published
    lockTestItem = await NewsAdminClient.executeTransition(
      lockTestItem.id,
      WorkflowState.Published,
      ownerAdmin,
      'نشر عام للمقال'
    );

    // 5a. Published edit must be REJECTED
    let publishedEditRejected = false;
    try {
      await NewsAdminClient.saveNewsItem(
        { id: lockTestItem.id, titleAr: 'محاولة تعديل مقال منشور' },
        editorAdmin,
        false
      );
    } catch (_e) {
      publishedEditRejected = true;
    }
    const itemAfterPublished = await NewsAdminClient.getById(lockTestItem.id);
    const publishedPreserved = itemAfterPublished?.workflowState === WorkflowState.Published &&
      itemAfterPublished?.titleAr === 'مقال تم تعديله بعد إعادته للمسودة بنجاح';

    const allLockChecksPass =
      draftEditOk &&
      inReviewEditRejected &&
      inReviewPreserved &&
      changesRequestedEditRejected &&
      changesRequestedAfterDraftEditOk &&
      approvedEditRejected &&
      approvedPreserved &&
      publishedEditRejected &&
      publishedPreserved;

    assert(
      'REQ-07',
      'Authoritative Editorial Content Lock (Draft-Only Modifications)',
      allLockChecksPass,
      'Draft edits succeed; InReview, ChangesRequested, Approved, and Published edits strictly rejected with state and audit history fully preserved'
    );
  } catch (err: any) {
    assert('REQ-07', 'Authoritative Editorial Content Lock (Draft-Only Modifications)', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Isolation of Draft and Approved-Unpublished Records from Public Read
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    // Create draft 2 (remains in Draft)
    const draft2 = await NewsAdminClient.saveNewsItem(
      { titleAr: 'مسودة قيد الكتابة لم تنشر', category: 'Climate' },
      editorAdmin,
      true
    );

    // Create draft 3 and transition to Approved (not published)
    let draft3 = await NewsAdminClient.saveNewsItem(
      { titleAr: 'مقال معتمد لم ينشر بعد', category: 'Climate' },
      editorAdmin,
      true
    );
    draft3 = await NewsAdminClient.executeTransition(draft3.id, WorkflowState.InReview, editorAdmin);
    currentAuthUid = ownerAdmin.id;
    draft3 = await NewsAdminClient.executeTransition(draft3.id, WorkflowState.Approved, ownerAdmin);

    // Fetch public published news
    const publicArticles = await PublicNewsClient.listPublishedNews();

    const publishedIncluded = publicArticles.some(a => a.id === createdDraft.id);
    const draft2Excluded = !publicArticles.some(a => a.id === draft2.id);
    const draft3Excluded = !publicArticles.some(a => a.id === draft3.id);

    assert(
      'REQ-08',
      'Public Newsroom Isolation (Published Only)',
      publishedIncluded && draft2Excluded && draft3Excluded,
      'Only Published article returned; Draft and Approved-unpublished items strictly excluded from public hub'
    );
  } catch (err: any) {
    assert('REQ-08', 'Public Newsroom Isolation (Published Only)', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Public DTO Strips Internal History & Review Notes
  // --------------------------------------------------------------------------
  try {
    const rawPublicDtos: SanitizedPublicNewsDTO[] = await publicNewsRepo.listPublicNews();
    const targetDto = rawPublicDtos.find(d => d.id === createdDraft.id);

    const hasDto = targetDto !== undefined;
    const historyStripped = hasDto && !('history' in (targetDto as any));
    const workflowNotesStripped = hasDto && !('reviewNotes' in (targetDto as any));
    const publicFieldsPresent = hasDto && Boolean(targetDto.titleAr && targetDto.publishedAt && targetDto.author);

    assert(
      'REQ-09',
      'Public DTO Protection & Privacy',
      hasDto && historyStripped && workflowNotesStripped && publicFieldsPresent,
      'Public DTO preserves public attribution and content while completely stripping internal transition history'
    );
  } catch (err: any) {
    assert('REQ-09', 'Public DTO Protection & Privacy', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 10: Public Search, Category Filtering, Bilingual Content, and Slug Resolution
  // --------------------------------------------------------------------------
  try {
    const slug = PublicNewsClient.getSlug(createdDraft.titleAr);
    const resolvedBySlug = await PublicNewsClient.getPublishedArticle(slug);
    const searchResults = await PublicNewsClient.listPublishedNews({ searchQuery: 'الخرطوم' });
    const categoryResults = await PublicNewsClient.listPublishedNews({ category: 'Water' });

    const slugFound = resolvedBySlug !== null && resolvedBySlug.id === createdDraft.id;
    const searchFound = searchResults.some(a => a.id === createdDraft.id);
    const categoryFound = categoryResults.some(a => a.id === createdDraft.id);

    assert(
      'REQ-10',
      'Search, Filtering, and Slug Lookup',
      slugFound && searchFound && categoryFound,
      `Article resolvable via semantic slug '${slug}', Arabic keyword search, and canonical category filter`
    );
  } catch (err: any) {
    assert('REQ-10', 'Search, Filtering, and Slug Lookup', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 11: Public Backend Failure Integrity (Fail-Closed)
  // --------------------------------------------------------------------------
  try {
    // 1. Unconfigured backend fails visibly with BACKEND_UNAVAILABLE rather than returning false emptiness
    PublicNewsClient.setTransport(null);
    let unconfiguredFailedVisibly = false;
    try {
      await PublicNewsClient.listPublishedNews();
    } catch (e: any) {
      if (e.message && e.message.includes('BACKEND_UNAVAILABLE')) {
        unconfiguredFailedVisibly = true;
      }
    }

    // 2. Successful zero-record backend response produces the truthful empty state
    PublicNewsClient.setTransport(async () => ({ articles: [] }));
    const zeroRecordArticles = await PublicNewsClient.listPublishedNews();
    const truthfulEmptyStateOk = Array.isArray(zeroRecordArticles) && zeroRecordArticles.length === 0;

    // 3. Simulated backend failure transparently propagates error without falling back to demo fixtures
    PublicNewsClient.setTransport(async () => {
      throw new Error('SIMULATED_BACKEND_FAILURE');
    });

    let threwError = false;
    try {
      await PublicNewsClient.listPublishedNews();
    } catch (_e) {
      threwError = true;
    }

    // Reset transport back to in-memory public repo
    PublicNewsClient.setTransport(async (data: { lang?: 'ar' | 'en' }) => {
      const articles = await publicNewsRepo.listPublicNews(data.lang);
      return { articles };
    });

    assert(
      'REQ-11',
      'Public Backend Failure Integrity (Fail-Closed)',
      unconfiguredFailedVisibly && truthfulEmptyStateOk && threwError,
      'Unconfigured backend throws BACKEND_UNAVAILABLE; zero-record response produces truthful empty list; failures propagate transparently without mocks'
    );
  } catch (err: any) {
    assert('REQ-11', 'Public Backend Failure Integrity (Fail-Closed)', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 12: Firestore Serialization Safety & Preserved Meaningful Values
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    // 1. Direct unit verification of sanitizeForFirestore serialization boundary
    const testPayloadWithUndefined: any = {
      id: 'news-test-serialization',
      titleAr: 'اختبار المعالجة المحددة لحقول فايرستور',
      titleEn: undefined, // undefined optional field
      publishedAt: undefined, // undefined optional field
      emptyStringField: '', // meaningful empty string
      zeroField: 0, // meaningful zero
      falseField: false, // meaningful false
      nullField: null, // meaningful null
      nestedObj: {
        validProp: 'preserved',
        undefProp: undefined,
      },
      history: [
        { id: 'trans-1', action: 'create', comment: undefined },
      ],
    };

    const sanitized = sanitizeForFirestore(testPayloadWithUndefined);

    const undefinedOmitted =
      !('titleEn' in sanitized) &&
      !('publishedAt' in sanitized) &&
      !('undefProp' in sanitized.nestedObj) &&
      !('comment' in sanitized.history[0]);

    const meaningfulValuesPreserved =
      sanitized.emptyStringField === '' &&
      sanitized.zeroField === 0 &&
      sanitized.falseField === false &&
      sanitized.nullField === null &&
      sanitized.nestedObj.validProp === 'preserved' &&
      sanitized.id === 'news-test-serialization';

    // 2. Missing optional fields during draft creation must not fail
    const minimalDraftInput: Partial<NewsItem> = {
      titleAr: 'مسودة بدون حقول اختيارية',
      author: editorAdmin.name,
      // all other optional fields omitted / undefined
    };

    const createdMinimal = await NewsAdminClient.saveNewsItem(minimalDraftInput, editorAdmin, true);
    const minimalCreationOk =
      Boolean(createdMinimal.id && createdMinimal.id.startsWith('news-')) &&
      createdMinimal.workflowState === WorkflowState.Draft &&
      createdMinimal.history.length === 1 &&
      !('publishedAt' in createdMinimal || (createdMinimal as any).publishedAt);

    assert(
      'REQ-12',
      'Firestore Serialization Safety & Preserved Meaningful Values',
      undefinedOmitted && meaningfulValuesPreserved && minimalCreationOk,
      'Undefined values safely omitted; 0, false, null, and empty strings preserved; missing optional fields succeed with server identity intact'
    );
  } catch (err: any) {
    assert('REQ-12', 'Firestore Serialization Safety & Preserved Meaningful Values', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 13: Public Arabic Fallback Under English Language Selection
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    // 1. Create Arabic-only published article (no English title or body)
    let arOnlyItem = await NewsAdminClient.saveNewsItem(
      {
        titleAr: 'خبر بيئي منشور باللغة العربية حصراً',
        summaryAr: 'ملخص عربي فقط لبيان التراجع البيئي في الجزيرة.',
        bodyAr: 'مقال تفصيلي بالعربية فقط لتوثيق الوضع الزراعي...',
        category: 'الزراعة والأمن الغذائي',
      },
      editorAdmin,
      true
    );
    arOnlyItem = await NewsAdminClient.executeTransition(arOnlyItem.id, WorkflowState.InReview, editorAdmin);
    currentAuthUid = ownerAdmin.id;
    arOnlyItem = await NewsAdminClient.executeTransition(arOnlyItem.id, WorkflowState.Approved, ownerAdmin);
    arOnlyItem = await NewsAdminClient.executeTransition(arOnlyItem.id, WorkflowState.Published, ownerAdmin);

    // 2. Create bilingual published article
    currentAuthUid = editorAdmin.id;
    let bilingualItem = await NewsAdminClient.saveNewsItem(
      {
        titleAr: 'تقرير مشترك ثنائي اللغة',
        titleEn: 'Joint Bilingual Environmental Report',
        summaryAr: 'ملخص عربي',
        summaryEn: 'English summary',
        bodyAr: 'محتوى عربي',
        bodyEn: 'English content',
        category: 'المناخ والتغيرات الجوية',
      },
      editorAdmin,
      true
    );
    bilingualItem = await NewsAdminClient.executeTransition(bilingualItem.id, WorkflowState.InReview, editorAdmin);
    currentAuthUid = ownerAdmin.id;
    bilingualItem = await NewsAdminClient.executeTransition(bilingualItem.id, WorkflowState.Approved, ownerAdmin);
    bilingualItem = await NewsAdminClient.executeTransition(bilingualItem.id, WorkflowState.Published, ownerAdmin);

    // 3. Query public news hub under English selection ('en')
    const englishSelectionArticles = await PublicNewsClient.listPublishedNews({ language: 'en' });
    const arArticleIncludedUnderEn = englishSelectionArticles.some(a => a.id === arOnlyItem.id);
    const bilingualIncludedUnderEn = englishSelectionArticles.some(a => a.id === bilingualItem.id);

    // 4. Query public news hub under Arabic selection ('ar')
    const arabicSelectionArticles = await PublicNewsClient.listPublishedNews({ language: 'ar' });
    const arArticleIncludedUnderAr = arabicSelectionArticles.some(a => a.id === arOnlyItem.id);
    const bilingualIncludedUnderAr = arabicSelectionArticles.some(a => a.id === bilingualItem.id);

    const fallbackPreserved =
      arArticleIncludedUnderEn &&
      bilingualIncludedUnderEn &&
      arArticleIncludedUnderAr &&
      bilingualIncludedUnderAr;

    assert(
      'REQ-13',
      'Public Arabic Fallback Under English Language Selection',
      fallbackPreserved,
      'Arabic-only published articles remain accessible under English fallback; bilingual articles returned for both languages'
    );
  } catch (err: any) {
    assert('REQ-13', 'Public Arabic Fallback Under English Language Selection', false, err.message);
  }

  // Clean up test transport
  NewsAdminClient.setTransport(null);
  PublicNewsClient.setTransport(null);

  return results;
}
