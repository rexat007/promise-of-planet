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
import {
  toCanonicalNews,
  toWorkflowNewsItem,
  sanitizeForPublic,
  publicDtoToCanonicalNews,
  normalizeCategory,
} from './newsDomainAdapter';
import {
  CANONICAL_CATEGORY_DEFINITIONS,
  isCanonicalCategory,
  type Category,
} from '../types';
import { getCategoryLabel } from '../components/content/contentFormatters';

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
      category: 'Water',
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
        category: 'Water',
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
      category: 'Climate',
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
        category: 'Agriculture',
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
        category: 'Climate',
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

  // --------------------------------------------------------------------------
  // TEST 14: N2-A Server Draft Persistence & Editorial Validation Slice
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;
    const actor = { uid: editorAdmin.id, name: editorAdmin.name, role: editorAdmin.role };

    // 1. Draft creation with all three fields
    const draftPayload = {
      titleAr: "تحقيق استقصائي حول تلوث مياه النيل الأزرق",
      titleEn: "Investigation on Blue Nile Water Pollution",
      kickerAr: "ملف بيئي خاص",
      kickerEn: "Special Environmental Report",
      journalisticType: "Investigation" as const,
      summaryAr: "ملخص التحقيق حول التلوث الصناعي.",
      bodyAr: "نص التحقيق التفصيلي حول تلوث مياه النيل الأزرق وتأثيراته البيئية.",
      category: "Water",
    };
    const createdWithFields = await newsService.createDraft(draftPayload, actor);

    // 2. Repository readback of preserved values
    const readbackItem = await memoryNewsRepo.getById(createdWithFields.id);
    const readbackOk =
      readbackItem !== null &&
      readbackItem.kickerAr === "ملف بيئي خاص" &&
      readbackItem.kickerEn === "Special Environmental Report" &&
      readbackItem.journalisticType === "Investigation";

    // 3. Partial update retaining omitted fields
    const partialUpdatePayload = {
      summaryAr: "ملخص محدث للتحقيق البيئي في الخرطوم.",
    };
    const updatedDraft = await newsService.updateDraft(createdWithFields.id, partialUpdatePayload, actor);
    const retainedOk =
      updatedDraft.summaryAr === "ملخص محدث للتحقيق البيئي في الخرطوم." &&
      updatedDraft.kickerAr === "ملف بيئي خاص" &&
      updatedDraft.kickerEn === "Special Environmental Report" &&
      updatedDraft.journalisticType === "Investigation";

    // 4. Valid journalisticType replacement
    const typeReplacementPayload = {
      journalisticType: "Report" as const,
      kickerAr: "تقرير ميداني",
    };
    const replacedDraft = await newsService.updateDraft(createdWithFields.id, typeReplacementPayload, actor);
    const replacementOk =
      replacedDraft.journalisticType === "Report" &&
      replacedDraft.kickerAr === "تقرير ميداني" &&
      replacedDraft.kickerEn === "Special Environmental Report";

    // 5. Legacy drafts without optional fields
    const legacyDraftPayload = {
      titleAr: "خبر أرشيفي قديم بدون ملصقات صحفية",
      summaryAr: "ملخص خبر تقليدي.",
      bodyAr: "محتوى الخبر الأرشيفي القديم المحفوظ بدون الحقول الاختيارية الجديدة.",
      category: "Climate",
    };
    const legacyCreated = await newsService.createDraft(legacyDraftPayload, actor);
    const legacyReadback = await memoryNewsRepo.getById(legacyCreated.id);
    const legacyOk =
      legacyReadback !== null &&
      legacyReadback.kickerAr === undefined &&
      legacyReadback.kickerEn === undefined &&
      legacyReadback.journalisticType === undefined;

    // 6. Invalid kickerAr, kickerEn, and journalisticType rejection on createDraft without persistence
    let invalidTypeRejected = false;
    const initialRepoCount = (await memoryNewsRepo.listAll()).length;
    try {
      await newsService.createDraft(
        {
          titleAr: "مقال بنوع غير مصرح به",
          summaryAr: "ملخص المقال",
          bodyAr: "نص المقال التجريبي.",
          category: "Climate",
          journalisticType: "InvalidEditorialType" as any,
        },
        actor
      );
    } catch (e: any) {
      if (e.message && e.message.includes("VALIDATION_ERROR: Invalid journalisticType")) {
        invalidTypeRejected = true;
      }
    }

    let invalidKickerArRejected = false;
    try {
      await newsService.createDraft(
        {
          titleAr: "مقال بكيكر عربي غير نصي",
          summaryAr: "ملخص المقال",
          bodyAr: "نص المقال التجريبي.",
          category: "Climate",
          kickerAr: 12345 as any,
        },
        actor
      );
    } catch (e: any) {
      if (e.message && e.message.includes("VALIDATION_ERROR: Arabic kicker (kickerAr) must be a string")) {
        invalidKickerArRejected = true;
      }
    }

    let invalidKickerEnRejected = false;
    try {
      await newsService.createDraft(
        {
          titleAr: "مقال بكيكر إنجليزي غير نصي",
          summaryAr: "ملخص المقال",
          bodyAr: "نص المقال التجريبي.",
          category: "Climate",
          kickerEn: { invalid: true } as any,
        },
        actor
      );
    } catch (e: any) {
      if (e.message && e.message.includes("VALIDATION_ERROR: English kicker (kickerEn) must be a string")) {
        invalidKickerEnRejected = true;
      }
    }

    const finalRepoCount = (await memoryNewsRepo.listAll()).length;
    const zeroPersistenceOnValidationFailure = initialRepoCount === finalRepoCount;

    // 7. Invalid optional values during updateDraft & preservation of stored record
    let updateInvalidKickerArRejected = false;
    try {
      await newsService.updateDraft(replacedDraft.id, { kickerAr: 999 as any }, actor);
    } catch (e: any) {
      if (e.message && e.message.includes("VALIDATION_ERROR: Arabic kicker (kickerAr) must be a string")) {
        updateInvalidKickerArRejected = true;
      }
    }

    let updateInvalidKickerEnRejected = false;
    try {
      await newsService.updateDraft(replacedDraft.id, { kickerEn: ["invalid"] as any }, actor);
    } catch (e: any) {
      if (e.message && e.message.includes("VALIDATION_ERROR: English kicker (kickerEn) must be a string")) {
        updateInvalidKickerEnRejected = true;
      }
    }

    let updateInvalidTypeRejected = false;
    try {
      await newsService.updateDraft(replacedDraft.id, { journalisticType: "UnsupportedFormat" as any }, actor);
    } catch (e: any) {
      if (e.message && e.message.includes("VALIDATION_ERROR: Invalid journalisticType")) {
        updateInvalidTypeRejected = true;
      }
    }

    const storedAfterFailedUpdates = await memoryNewsRepo.getById(replacedDraft.id);
    const storedRecordPreservedOnInvalidUpdate =
      storedAfterFailedUpdates !== null &&
      storedAfterFailedUpdates.kickerAr === "تقرير ميداني" &&
      storedAfterFailedUpdates.kickerEn === "Special Environmental Report" &&
      storedAfterFailedUpdates.journalisticType === "Report" &&
      storedAfterFailedUpdates.summaryAr === "ملخص محدث للتحقيق البيئي في الخرطوم.";

    // 8. Preservation of Draft-only and human approval rules
    let nonDraftUpdateBlocked = false;
    await newsService.transitionWorkflow(replacedDraft.id, "InReview", actor);
    try {
      await newsService.updateDraft(replacedDraft.id, { kickerAr: "محاولة تعديل غير مسموح بها" }, actor);
    } catch (e: any) {
      if (e.message && e.message.includes("INVALID_TRANSITION")) {
        nonDraftUpdateBlocked = true;
      }
    }

    const allN2APersistenceRequirementsMet =
      readbackOk &&
      retainedOk &&
      replacementOk &&
      legacyOk &&
      invalidTypeRejected &&
      invalidKickerArRejected &&
      invalidKickerEnRejected &&
      zeroPersistenceOnValidationFailure &&
      updateInvalidKickerArRejected &&
      updateInvalidKickerEnRejected &&
      updateInvalidTypeRejected &&
      storedRecordPreservedOnInvalidUpdate &&
      nonDraftUpdateBlocked;

    assert(
      "REQ-14",
      "N2-A Server Draft Persistence & Validation Slice",
      allN2APersistenceRequirementsMet,
      "Draft creation with kicker/journalisticType preserved; partial update retains omitted fields; invalid create/update values rejected with stored record intact; legacy records supported; draft-only lock preserved"
    );
  } catch (err: any) {
    assert("REQ-14", "N2-A Server Draft Persistence & Validation Slice", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 15: N2-A Admin Client Payload Roundtrip
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;

    // 1. Creating a draft through NewsAdminClient.saveNewsItem() preserves all three fields
    const createdViaClient = await NewsAdminClient.saveNewsItem(
      {
        id: "news-sudan-provisional-999",
        titleAr: "تحليل معمق لتحديات الطاقة المتجددة في السودان",
        titleEn: "In-Depth Analysis of Renewable Energy Challenges in Sudan",
        kickerAr: "ملف الطاقة والمناخ",
        kickerEn: "Energy & Climate Dossier",
        journalisticType: "Analysis",
        summaryAr: "ملخص التحليل حول فرص الطاقة الشمسية.",
        bodyAr: "محتوى التحليل الكامل حول تحديات الطاقة المتجددة.",
        category: "Energy",
      },
      editorAdmin,
      true
    );

    const createPreservedOk =
      Boolean(createdViaClient.id) &&
      createdViaClient.id !== "news-sudan-provisional-999" &&
      createdViaClient.id.startsWith("news-") &&
      createdViaClient.workflowState === WorkflowState.Draft &&
      createdViaClient.kickerAr === "ملف الطاقة والمناخ" &&
      createdViaClient.kickerEn === "Energy & Climate Dossier" &&
      createdViaClient.journalisticType === "Analysis";

    // 2. Reading the saved draft via NewsAdminClient returns exact supplied values
    const fetchedById = await NewsAdminClient.getById(createdViaClient.id);
    const allAdminItems = await NewsAdminClient.listAll();
    const fetchedFromList = allAdminItems.find(i => i.id === createdViaClient.id);
    const readRoundtripOk =
      fetchedById !== null &&
      fetchedById.kickerAr === "ملف الطاقة والمناخ" &&
      fetchedById.kickerEn === "Energy & Climate Dossier" &&
      fetchedById.journalisticType === "Analysis" &&
      fetchedFromList !== undefined &&
      fetchedFromList.kickerAr === "ملف الطاقة والمناخ" &&
      fetchedFromList.kickerEn === "Energy & Climate Dossier" &&
      fetchedFromList.journalisticType === "Analysis";

    // 3. Updating a draft changes explicitly supplied fields while preserving omitted fields
    const updatedViaClient = await NewsAdminClient.saveNewsItem(
      {
        id: createdViaClient.id,
        titleAr: createdViaClient.titleAr,
        kickerAr: "ملف خاص محدث",
        journalisticType: "Feature",
      },
      editorAdmin,
      false
    );
    const partialUpdateOk =
      updatedViaClient.id === createdViaClient.id &&
      updatedViaClient.kickerAr === "ملف خاص محدث" &&
      updatedViaClient.kickerEn === "Energy & Climate Dossier" &&
      updatedViaClient.journalisticType === "Feature";

    // 4. An empty-string kicker is transported rather than silently discarded
    const emptyKickerUpdated = await NewsAdminClient.saveNewsItem(
      {
        id: createdViaClient.id,
        titleAr: createdViaClient.titleAr,
        kickerAr: "",
        kickerEn: "",
      },
      editorAdmin,
      false
    );
    const emptyKickerFetched = await NewsAdminClient.getById(createdViaClient.id);
    const emptyStringKickerTransportedOk =
      emptyKickerUpdated.kickerAr === "" &&
      emptyKickerUpdated.kickerEn === "" &&
      emptyKickerUpdated.journalisticType === "Feature" &&
      emptyKickerFetched !== null &&
      emptyKickerFetched.kickerAr === "" &&
      emptyKickerFetched.kickerEn === "";

    // 5. Legacy drafts without the optional fields remain valid
    const legacyViaClient = await NewsAdminClient.saveNewsItem(
      {
        titleAr: "خبر تقليدي عبر عميل الإدارة بدون حقول اختيارية",
        summaryAr: "ملخص الخبر التقليدي.",
        bodyAr: "نص الخبر التقليدي.",
        category: "Water",
      },
      editorAdmin,
      true
    );
    const legacyClientOk =
      Boolean(legacyViaClient.id) &&
      legacyViaClient.kickerAr === undefined &&
      legacyViaClient.kickerEn === undefined &&
      legacyViaClient.journalisticType === undefined;

    // 6. Server-authoritative IDs, workflow restrictions, and authorization remain unchanged
    currentAuthUid = viewerAdmin.id;
    let viewerBlocked = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          titleAr: "محاولة إنشاء من مشاهد",
          kickerAr: "غير مصرح",
          journalisticType: "News",
        },
        viewerAdmin,
        true
      );
    } catch (_err) {
      viewerBlocked = true;
    }

    currentAuthUid = editorAdmin.id;
    await NewsAdminClient.executeTransition(createdViaClient.id, WorkflowState.InReview, editorAdmin);
    let nonDraftClientEditBlocked = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          id: createdViaClient.id,
          titleAr: createdViaClient.titleAr,
          kickerAr: "تعديل بعد الإرسال للمراجعة",
        },
        editorAdmin,
        false
      );
    } catch (e: any) {
      if (e.message && e.message.includes("INVALID_TRANSITION")) {
        nonDraftClientEditBlocked = true;
      }
    }

    assert(
      "REQ-15",
      "N2-A Admin Client Payload Roundtrip",
      createPreservedOk &&
        readRoundtripOk &&
        partialUpdateOk &&
        emptyStringKickerTransportedOk &&
        legacyClientOk &&
        viewerBlocked &&
        nonDraftClientEditBlocked,
      "NewsAdminClient.saveNewsItem transports kickerAr, kickerEn (including empty string), and journalisticType; preserves omitted fields on update; keeps legacy records and workflow/RBAC guards intact"
    );
  } catch (err: any) {
    assert("REQ-15", "N2-A Admin Client Payload Roundtrip", false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 16: N2-A Public Editorial Field Propagation
  // --------------------------------------------------------------------------
  try {
    currentAuthUid = editorAdmin.id;

    // 1. Create Draft with kickerAr, kickerEn, and journalisticType ('Interview')
    let interviewItem = await NewsAdminClient.saveNewsItem(
      {
        titleAr: "مقابلة خاصة حول التكيف المناخي في الجزيرة",
        titleEn: "Special Interview on Climate Adaptation in Gezira",
        kickerAr: "لقاء خاص",
        kickerEn: "Special Interview",
        journalisticType: "Interview",
        summaryAr: "ملخص المقابلة حول الزراعة الذكية مناخياً.",
        summaryEn: "Summary of the interview on climate-smart agriculture.",
        bodyAr: "نص المقابلة الكامل مع خبراء الزراعة والمياه.",
        bodyEn: "Full text of the interview with agriculture and water experts.",
        category: "Agriculture",
      },
      editorAdmin,
      true
    );

    // Check Draft inaccessibility & sanitizeForPublic Draft rejection
    const draftPublicById = await publicNewsRepo.getPublicNewsById(interviewItem.id);
    const draftPublicList = await publicNewsRepo.listPublicNews();
    const draftSanitized = sanitizeForPublic(interviewItem);
    const draftInaccessibleOk =
      draftPublicById === null &&
      !draftPublicList.some(d => d.id === interviewItem.id) &&
      draftSanitized === null;

    // Transition Draft -> InReview -> ChangesRequested -> Draft -> InReview -> Approved
    interviewItem = await NewsAdminClient.executeTransition(interviewItem.id, WorkflowState.InReview, editorAdmin);
    const inReviewSanitized = sanitizeForPublic(interviewItem);
    const inReviewById = await publicNewsRepo.getPublicNewsById(interviewItem.id);

    currentAuthUid = ownerAdmin.id;
    interviewItem = await NewsAdminClient.executeTransition(
      interviewItem.id,
      WorkflowState.ChangesRequested,
      ownerAdmin,
      "مراجعة الترويسة"
    );
    const changesReqSanitized = sanitizeForPublic(interviewItem);

    currentAuthUid = editorAdmin.id;
    interviewItem = await NewsAdminClient.executeTransition(interviewItem.id, WorkflowState.Draft, editorAdmin);
    interviewItem = await NewsAdminClient.executeTransition(interviewItem.id, WorkflowState.InReview, editorAdmin);

    currentAuthUid = ownerAdmin.id;
    interviewItem = await NewsAdminClient.executeTransition(interviewItem.id, WorkflowState.Approved, ownerAdmin);
    const approvedSanitized = sanitizeForPublic(interviewItem);
    const approvedById = await publicNewsRepo.getPublicNewsById(interviewItem.id);
    const approvedList = await publicNewsRepo.listPublicNews();

    const unapprovedInaccessibleOk =
      draftInaccessibleOk &&
      inReviewSanitized === null &&
      inReviewById === null &&
      changesReqSanitized === null &&
      approvedSanitized === null &&
      approvedById === null &&
      !approvedList.some(d => d.id === interviewItem.id);

    // Publish the Interview article
    interviewItem = await NewsAdminClient.executeTransition(interviewItem.id, WorkflowState.Published, ownerAdmin);

    // Verify both PublicNewsRepository read methods preserve all three fields & Interview canonical value
    const pubListAr = await publicNewsRepo.listPublicNews("ar");
    const pubListEn = await publicNewsRepo.listPublicNews("en");
    const dtoFromListAr = pubListAr.find(d => d.id === interviewItem.id);
    const dtoFromListEn = pubListEn.find(d => d.id === interviewItem.id);
    const dtoByIdAr = await publicNewsRepo.getPublicNewsById(interviewItem.id, "ar");
    const dtoByIdEn = await publicNewsRepo.getPublicNewsById(interviewItem.id, "en");

    const publicRepoMethodsPreserveFieldsOk =
      dtoFromListAr !== undefined &&
      dtoFromListAr.kickerAr === "لقاء خاص" &&
      dtoFromListAr.kickerEn === "Special Interview" &&
      dtoFromListAr.journalisticType === "Interview" &&
      dtoFromListAr.titleAr === "مقابلة خاصة حول التكيف المناخي في الجزيرة" &&
      dtoFromListAr.summaryAr === "ملخص المقابلة حول الزراعة الذكية مناخياً." &&
      dtoFromListEn !== undefined &&
      dtoFromListEn.kickerAr === "لقاء خاص" &&
      dtoFromListEn.kickerEn === "Special Interview" &&
      dtoFromListEn.journalisticType === "Interview" &&
      dtoByIdAr !== null &&
      dtoByIdAr.kickerAr === "لقاء خاص" &&
      dtoByIdAr.kickerEn === "Special Interview" &&
      dtoByIdAr.journalisticType === "Interview" &&
      dtoByIdEn !== null &&
      dtoByIdEn.kickerAr === "لقاء خاص" &&
      dtoByIdEn.kickerEn === "Special Interview" &&
      dtoByIdEn.journalisticType === "Interview";

    // Verify public DTOs exclude workflow history and administrative metadata
    const publicDtoMetadataStrippedOk =
      dtoByIdAr !== null &&
      !("history" in (dtoByIdAr as any)) &&
      !("workflowState" in (dtoByIdAr as any)) &&
      !("reviewNotes" in (dtoByIdAr as any)) &&
      !("approvalStatus" in (dtoByIdAr as any)) &&
      dtoFromListAr !== undefined &&
      !("history" in (dtoFromListAr as any)) &&
      !("workflowState" in (dtoFromListAr as any));

    // Verify sanitizeForPublic() on Published item and publicDtoToCanonicalNews()
    const publishedSanitized = sanitizeForPublic(interviewItem);
    const sanitizeForPublicOk =
      publishedSanitized !== null &&
      publishedSanitized.kickerAr === "لقاء خاص" &&
      publishedSanitized.kickerEn === "Special Interview" &&
      publishedSanitized.journalisticType === "Interview" &&
      !("history" in (publishedSanitized as any)) &&
      !("workflowState" in (publishedSanitized as any));

    const canonicalFromPublicDto = publishedSanitized ? publicDtoToCanonicalNews(publishedSanitized) : null;
    const clientPublishedArticle = await PublicNewsClient.getPublishedArticle(interviewItem.id);
    const publicDtoToCanonicalOk =
      canonicalFromPublicDto !== null &&
      canonicalFromPublicDto.kickerAr === "لقاء خاص" &&
      canonicalFromPublicDto.kickerEn === "Special Interview" &&
      canonicalFromPublicDto.journalisticType === "Interview" &&
      canonicalFromPublicDto.titleAr === "مقابلة خاصة حول التكيف المناخي في الجزيرة" &&
      canonicalFromPublicDto.excerptAr === "ملخص المقابلة حول الزراعة الذكية مناخياً." &&
      clientPublishedArticle !== null &&
      clientPublishedArticle.kickerAr === "لقاء خاص" &&
      clientPublishedArticle.kickerEn === "Special Interview" &&
      clientPublishedArticle.journalisticType === "Interview";

    // Verify toCanonicalNews() and toWorkflowNewsItem() preserve the fields on conversion
    const canonicalFromWorkflow = toCanonicalNews(interviewItem);
    const roundtrippedWorkflow = toWorkflowNewsItem(canonicalFromWorkflow);
    const adapterRoundtripOk =
      canonicalFromWorkflow.kickerAr === "لقاء خاص" &&
      canonicalFromWorkflow.kickerEn === "Special Interview" &&
      canonicalFromWorkflow.journalisticType === "Interview" &&
      canonicalFromWorkflow.titleAr === interviewItem.titleAr &&
      canonicalFromWorkflow.excerptAr === interviewItem.summaryAr &&
      roundtrippedWorkflow.kickerAr === "لقاء خاص" &&
      roundtrippedWorkflow.kickerEn === "Special Interview" &&
      roundtrippedWorkflow.journalisticType === "Interview" &&
      roundtrippedWorkflow.titleAr === interviewItem.titleAr &&
      roundtrippedWorkflow.summaryAr === interviewItem.summaryAr;

    // Verify legacy published record without optional fields remains valid with no inferred editorial type
    currentAuthUid = editorAdmin.id;
    let legacyPubItem = await NewsAdminClient.saveNewsItem(
      {
        titleAr: "خبر منشور قديم بدون حقول الترويسة أو النوع الصحفي",
        titleEn: "Legacy Published News Without Kicker or Journalistic Type",
        summaryAr: "ملخص الخبر القديم المنشور.",
        summaryEn: "Summary of legacy published news.",
        bodyAr: "نص الخبر القديم المنشور بالكامل.",
        bodyEn: "Full body of legacy published news.",
        category: "Climate",
      },
      editorAdmin,
      true
    );
    legacyPubItem = await NewsAdminClient.executeTransition(legacyPubItem.id, WorkflowState.InReview, editorAdmin);
    currentAuthUid = ownerAdmin.id;
    legacyPubItem = await NewsAdminClient.executeTransition(legacyPubItem.id, WorkflowState.Approved, ownerAdmin);
    legacyPubItem = await NewsAdminClient.executeTransition(legacyPubItem.id, WorkflowState.Published, ownerAdmin);

    const legacyDtoById = await publicNewsRepo.getPublicNewsById(legacyPubItem.id);
    const legacyDtoFromList = (await publicNewsRepo.listPublicNews()).find(d => d.id === legacyPubItem.id);
    const legacySanitized = sanitizeForPublic(legacyPubItem);
    const legacyCanonicalFromDto = legacySanitized ? publicDtoToCanonicalNews(legacySanitized) : null;
    const legacyCanonicalDirect = toCanonicalNews(legacyPubItem);
    const legacyWorkflowBack = toWorkflowNewsItem(legacyCanonicalDirect);

    const legacyNoInferredFieldsOk =
      legacyDtoById !== null &&
      legacyDtoById.kickerAr === undefined &&
      legacyDtoById.kickerEn === undefined &&
      legacyDtoById.journalisticType === undefined &&
      legacyDtoFromList !== undefined &&
      legacyDtoFromList.kickerAr === undefined &&
      legacyDtoFromList.kickerEn === undefined &&
      legacyDtoFromList.journalisticType === undefined &&
      legacySanitized !== null &&
      legacySanitized.kickerAr === undefined &&
      legacySanitized.kickerEn === undefined &&
      legacySanitized.journalisticType === undefined &&
      legacyCanonicalFromDto !== null &&
      legacyCanonicalFromDto.kickerAr === undefined &&
      legacyCanonicalFromDto.kickerEn === undefined &&
      legacyCanonicalFromDto.journalisticType === undefined &&
      legacyCanonicalDirect.kickerAr === undefined &&
      legacyCanonicalDirect.kickerEn === undefined &&
      legacyCanonicalDirect.journalisticType === undefined &&
      legacyWorkflowBack.kickerAr === undefined &&
      legacyWorkflowBack.kickerEn === undefined &&
      legacyWorkflowBack.journalisticType === undefined;

    // Verify empty-string kicker values remain empty strings through public DTOs and adapters
    currentAuthUid = editorAdmin.id;
    let emptyKickerPubItem = await NewsAdminClient.saveNewsItem(
      {
        titleAr: "تقرير منشور بترويسة فارغة نصياً",
        titleEn: "Published Report With Empty String Kickers",
        kickerAr: "",
        kickerEn: "",
        journalisticType: "Report",
        summaryAr: "ملخص التقرير.",
        summaryEn: "Report summary.",
        bodyAr: "نص التقرير الكامل.",
        bodyEn: "Full report body.",
        category: "Water",
      },
      editorAdmin,
      true
    );
    emptyKickerPubItem = await NewsAdminClient.executeTransition(emptyKickerPubItem.id, WorkflowState.InReview, editorAdmin);
    currentAuthUid = ownerAdmin.id;
    emptyKickerPubItem = await NewsAdminClient.executeTransition(emptyKickerPubItem.id, WorkflowState.Approved, ownerAdmin);
    emptyKickerPubItem = await NewsAdminClient.executeTransition(emptyKickerPubItem.id, WorkflowState.Published, ownerAdmin);

    const emptyDtoById = await publicNewsRepo.getPublicNewsById(emptyKickerPubItem.id);
    const emptyDtoFromList = (await publicNewsRepo.listPublicNews()).find(d => d.id === emptyKickerPubItem.id);
    const emptySanitized = sanitizeForPublic(emptyKickerPubItem);
    const emptyCanonicalFromDto = emptySanitized ? publicDtoToCanonicalNews(emptySanitized) : null;
    const emptyCanonicalDirect = toCanonicalNews(emptyKickerPubItem);
    const emptyWorkflowBack = toWorkflowNewsItem(emptyCanonicalDirect);

    const emptyStringKickersPreservedOk =
      emptyDtoById !== null &&
      emptyDtoById.kickerAr === "" &&
      emptyDtoById.kickerEn === "" &&
      emptyDtoById.journalisticType === "Report" &&
      emptyDtoFromList !== undefined &&
      emptyDtoFromList.kickerAr === "" &&
      emptyDtoFromList.kickerEn === "" &&
      emptySanitized !== null &&
      emptySanitized.kickerAr === "" &&
      emptySanitized.kickerEn === "" &&
      emptyCanonicalFromDto !== null &&
      emptyCanonicalFromDto.kickerAr === "" &&
      emptyCanonicalFromDto.kickerEn === "" &&
      emptyCanonicalDirect.kickerAr === "" &&
      emptyCanonicalDirect.kickerEn === "" &&
      emptyWorkflowBack.kickerAr === "" &&
      emptyWorkflowBack.kickerEn === "";

    assert(
      "REQ-16",
      "N2-A Public Editorial Field Propagation",
      unapprovedInaccessibleOk &&
        publicRepoMethodsPreserveFieldsOk &&
        publicDtoMetadataStrippedOk &&
        sanitizeForPublicOk &&
        publicDtoToCanonicalOk &&
        adapterRoundtripOk &&
        legacyNoInferredFieldsOk &&
        emptyStringKickersPreservedOk,
      "Published articles preserve kickerAr, kickerEn (including empty strings), and journalisticType ('Interview') across listPublicNews, getPublicNewsById, sanitizeForPublic, publicDtoToCanonicalNews, toCanonicalNews, and toWorkflowNewsItem; legacy records infer no defaults; internal metadata and non-Published records remain excluded"
    );
  } catch (err: any) {
    assert("REQ-16", "N2-A Public Editorial Field Propagation", false, err.message);
  }

  // =========================================================================
  // REQ-17: Canonical News Category Integrity and Legacy Draft Safety
  // =========================================================================
  try {
    currentAuthUid = editorAdmin.id;

    // 1. All seven canonical keys are accepted for new Draft creation
    const canonicalKeys = [
      'Climate',
      'Water',
      'Biodiversity',
      'Pollution',
      'Energy',
      'Agriculture',
      'EnvironmentalPolicy',
    ] as const;

    let allSevenCreatedOk = true;
    for (const catKey of canonicalKeys) {
      const created = await NewsAdminClient.saveNewsItem(
        {
          titleAr: `مسودة اختبار التصنيف القياسي ${catKey}`,
          category: catKey,
        },
        editorAdmin,
        true
      );
      if (created.category !== catKey || created.workflowState !== WorkflowState.Draft) {
        allSevenCreatedOk = false;
        break;
      }
    }

    // 2. Missing, empty, translated, unknown, and legacy values are rejected for NEW drafts
    const invalidCreationCandidates = [
      { name: 'missing category', payload: { titleAr: 'مقال بدون تصنيف' } },
      { name: 'empty string', payload: { titleAr: 'مقال بتصنيف فارغ', category: '' } },
      { name: 'whitespace only', payload: { titleAr: 'مقال بتصنيف مسافات', category: '   ' } },
      { name: 'Arabic label', payload: { titleAr: 'مقال باسم عربي', category: 'المناخ' } },
      { name: 'English label', payload: { titleAr: 'مقال باسم إنجليزي', category: 'Climate & Weather' } },
      { name: 'unknown category', payload: { titleAr: 'مقال غير معروف', category: 'UnknownCategory' } },
      { name: 'historical legacy category', payload: { titleAr: 'مقال قديم', category: 'الاستجابة والطوارئ البيئية' } },
    ];

    let allInvalidCreateRejected = true;
    for (const cand of invalidCreationCandidates) {
      let rejected = false;
      try {
        await NewsAdminClient.saveNewsItem(cand.payload as any, editorAdmin, true);
      } catch (err: any) {
        if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
          rejected = true;
        }
      }
      if (!rejected) {
        allInvalidCreateRejected = false;
        break;
      }
    }

    // 3. The client no longer inserts an implicit Climate category
    let clientNoImplicitClimateOk = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          titleAr: 'مقال للتحقق من عدم اختلاق تصنيف المناخ',
        },
        editorAdmin,
        true
      );
    } catch (err: any) {
      if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
        clientNoImplicitClimateOk = true;
      }
    }

    // 4. An existing legacy Draft preserves its exact original category when unrelated fields are edited
    const legacyDraftId = 'news-legacy-draft-req17-001';
    const legacyDraftRecord: NewsItemBackend = {
      id: legacyDraftId,
      titleAr: 'مسودة أرشيفية بتصنيف تاريخي غير قياسي',
      titleEn: 'Historical Unmigrated Draft',
      summaryAr: 'ملخص المسودة الأرشيفية',
      summaryEn: 'Summary of unmigrated draft',
      bodyAr: 'محتوى المسودة الأرشيفية التفصيلي...',
      bodyEn: 'Detailed content of unmigrated draft...',
      author: editorAdmin.name,
      category: 'الاستجابة والطوارئ البيئية',
      tags: ['طوارئ', 'سودان'],
      sources: ['تقرير محلي 2024'],
      workflowState: 'Draft',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      history: [
        {
          id: 'trans-hist-init',
          fromState: 'Draft',
          toState: 'Draft',
          action: 'revise_draft',
          actorName: editorAdmin.name,
          actorRole: editorAdmin.role,
          timestamp: '2024-01-01T00:00:00.000Z',
          comment: 'Historical draft record',
        },
      ],
    };
    await memoryNewsRepo.save(legacyDraftRecord);

    // Edit unrelated field with category omitted
    const legacyEditOmitted = await NewsAdminClient.saveNewsItem(
      {
        id: legacyDraftId,
        titleAr: 'مسودة أرشيفية تم تحديث عنوانها العربي',
      },
      editorAdmin,
      false
    );

    // Edit unrelated field with identical legacy category supplied
    const legacyEditExact = await NewsAdminClient.saveNewsItem(
      {
        id: legacyDraftId,
        titleAr: 'مسودة أرشيفية تم تحديث عنوانها العربي',
        titleEn: 'Historical Unmigrated Draft Title Updated',
        category: 'الاستجابة والطوارئ البيئية',
      },
      editorAdmin,
      false
    );

    const storedLegacyAfterEdits = await memoryNewsRepo.getById(legacyDraftId);
    const legacyCategoryPreservedOk =
      legacyEditOmitted.category === 'الاستجابة والطوارئ البيئية' &&
      legacyEditExact.category === 'الاستجابة والطوارئ البيئية' &&
      storedLegacyAfterEdits !== null &&
      storedLegacyAfterEdits.category === 'الاستجابة والطوارئ البيئية' &&
      storedLegacyAfterEdits.titleAr === 'مسودة أرشيفية تم تحديث عنوانها العربي' &&
      storedLegacyAfterEdits.titleEn === 'Historical Unmigrated Draft Title Updated';

    // 5. Explicit reassignment of a historical Draft to a canonical key succeeds
    const reclassifiedItem = await NewsAdminClient.saveNewsItem(
      {
        id: legacyDraftId,
        titleAr: 'مسودة أرشيفية تم تحديث عنوانها العربي',
        category: 'EnvironmentalPolicy',
      },
      editorAdmin,
      false
    );
    const storedAfterReclass = await memoryNewsRepo.getById(legacyDraftId);
    const explicitReclassOk =
      reclassifiedItem.category === 'EnvironmentalPolicy' &&
      storedAfterReclass !== null &&
      storedAfterReclass.category === 'EnvironmentalPolicy';

    // 6. An attempted assignment to a new invalid category fails
    const legacyDraft2Id = 'news-legacy-draft-req17-002';
    const legacyDraft2Record: NewsItemBackend = {
      id: legacyDraft2Id,
      titleAr: 'مسودة أرشيفية ثانية لاختبار الرفض',
      summaryAr: 'ملخص',
      bodyAr: 'محتوى',
      author: editorAdmin.name,
      category: 'الاستجابة والطوارئ البيئية',
      tags: [],
      sources: [],
      workflowState: 'Draft',
      createdAt: '2024-02-01T00:00:00.000Z',
      updatedAt: '2024-02-01T00:00:00.000Z',
      history: [],
    };
    await memoryNewsRepo.save(legacyDraft2Record);
    const beforeInvalidUpdate = JSON.stringify(await memoryNewsRepo.getById(legacyDraft2Id));

    let invalidReassignmentRejected = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          id: legacyDraft2Id,
          titleAr: 'مسودة أرشيفية ثانية لاختبار الرفض',
          category: 'الموارد المائية والنيل',
        },
        editorAdmin,
        false
      );
    } catch (err: any) {
      if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
        invalidReassignmentRejected = true;
      }
    }

    let emptyCategoryUpdateRejected = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          id: legacyDraft2Id,
          titleAr: 'مسودة أرشيفية ثانية لاختبار الرفض',
          category: '',
        },
        editorAdmin,
        false
      );
    } catch (err: any) {
      if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
        emptyCategoryUpdateRejected = true;
      }
    }

    const afterInvalidUpdate = JSON.stringify(await memoryNewsRepo.getById(legacyDraft2Id));
    const noMutationOnFailedUpdate = beforeInvalidUpdate === afterInvalidUpdate;

    // 7. Historical invalid-category Drafts cannot transition to InReview
    let draftToInReviewRejected = false;
    const beforeTransitionAttempt = JSON.stringify(await memoryNewsRepo.getById(legacyDraft2Id));
    try {
      await NewsAdminClient.executeTransition(legacyDraft2Id, WorkflowState.InReview, editorAdmin);
    } catch (err: any) {
      if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
        draftToInReviewRejected = true;
      }
    }
    const afterTransitionAttempt = JSON.stringify(await memoryNewsRepo.getById(legacyDraft2Id));
    const noWriteOnDraftTransitionFailure = beforeTransitionAttempt === afterTransitionAttempt;

    // 8. Historical invalid-category InReview items cannot transition to Approved
    const legacyInReviewId = 'news-legacy-inreview-req17-003';
    const legacyInReviewRecord: NewsItemBackend = {
      id: legacyInReviewId,
      titleAr: 'مقال قديم قيد المراجعة بتصنيف غير قياسي',
      summaryAr: 'ملخص',
      bodyAr: 'محتوى',
      author: editorAdmin.name,
      category: 'الاستجابة والطوارئ البيئية',
      tags: [],
      sources: [],
      workflowState: 'InReview',
      createdAt: '2024-03-01T00:00:00.000Z',
      updatedAt: '2024-03-01T00:00:00.000Z',
      history: [
        {
          id: 'trans-hist-ir',
          fromState: 'Draft',
          toState: 'InReview',
          action: 'submit_for_review',
          actorName: editorAdmin.name,
          actorRole: editorAdmin.role,
          timestamp: '2024-03-01T00:00:00.000Z',
        },
      ],
    };
    await memoryNewsRepo.save(legacyInReviewRecord);
    const beforeApproveAttempt = JSON.stringify(await memoryNewsRepo.getById(legacyInReviewId));

    currentAuthUid = ownerAdmin.id;
    let inReviewToApprovedRejected = false;
    try {
      await NewsAdminClient.executeTransition(legacyInReviewId, WorkflowState.Approved, ownerAdmin);
    } catch (err: any) {
      if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
        inReviewToApprovedRejected = true;
      }
    }
    const afterApproveAttempt = JSON.stringify(await memoryNewsRepo.getById(legacyInReviewId));
    const noWriteOnApproveFailure = beforeApproveAttempt === afterApproveAttempt;

    // 9. Historical invalid-category Approved items cannot transition to Published
    const legacyApprovedId = 'news-legacy-approved-req17-004';
    const legacyApprovedRecord: NewsItemBackend = {
      id: legacyApprovedId,
      titleAr: 'مقال قديم معتمد بتصنيف غير قياسي',
      summaryAr: 'ملخص',
      bodyAr: 'محتوى',
      author: editorAdmin.name,
      category: 'الاستجابة والطوارئ البيئية',
      tags: [],
      sources: [],
      workflowState: 'Approved',
      createdAt: '2024-04-01T00:00:00.000Z',
      updatedAt: '2024-04-01T00:00:00.000Z',
      history: [
        {
          id: 'trans-hist-appr',
          fromState: 'InReview',
          toState: 'Approved',
          action: 'approve',
          actorName: ownerAdmin.name,
          actorRole: ownerAdmin.role,
          timestamp: '2024-04-01T00:00:00.000Z',
        },
      ],
    };
    await memoryNewsRepo.save(legacyApprovedRecord);
    const beforePublishAttempt = JSON.stringify(await memoryNewsRepo.getById(legacyApprovedId));

    let approvedToPublishedRejected = false;
    try {
      await NewsAdminClient.executeTransition(legacyApprovedId, WorkflowState.Published, ownerAdmin);
    } catch (err: any) {
      if (err.message && err.message.includes('INVALID_CANONICAL_NEWS_CATEGORY')) {
        approvedToPublishedRejected = true;
      }
    }
    const afterPublishAttempt = JSON.stringify(await memoryNewsRepo.getById(legacyApprovedId));
    const noWriteOnPublishFailure = beforePublishAttempt === afterPublishAttempt;

    // 10. Legitimate remedial transitions remain available
    currentAuthUid = ownerAdmin.id;
    const remedialChangesRequested = await NewsAdminClient.executeTransition(
      legacyInReviewId,
      WorkflowState.ChangesRequested,
      ownerAdmin,
      'طلب تعديل: يرجى تصنيف المقال تحت أحد التصنيفات البيئية القياسية السبعة'
    );
    const remedial1Ok =
      remedialChangesRequested.workflowState === WorkflowState.ChangesRequested &&
      remedialChangesRequested.category === 'الاستجابة والطوارئ البيئية';

    currentAuthUid = editorAdmin.id;
    const remedialDraft = await NewsAdminClient.executeTransition(
      legacyInReviewId,
      WorkflowState.Draft,
      editorAdmin
    );
    const remedial2Ok =
      remedialDraft.workflowState === WorkflowState.Draft &&
      remedialDraft.category === 'الاستجابة والطوارئ البيئية';

    // Reclassify to canonical Water in Draft, then advance through workflow
    const curedArticle = await NewsAdminClient.saveNewsItem(
      {
        id: legacyInReviewId,
        titleAr: 'مقال قديم قيد المراجعة بتصنيف غير قياسي',
        category: 'Water',
      },
      editorAdmin,
      false
    );
    const inReviewAfterCure = await NewsAdminClient.executeTransition(
      curedArticle.id,
      WorkflowState.InReview,
      editorAdmin
    );
    currentAuthUid = ownerAdmin.id;
    const approvedAfterCure = await NewsAdminClient.executeTransition(
      inReviewAfterCure.id,
      WorkflowState.Approved,
      ownerAdmin
    );
    const publishedAfterCure = await NewsAdminClient.executeTransition(
      approvedAfterCure.id,
      WorkflowState.Published,
      ownerAdmin
    );
    const remedialPipelineCompleteOk =
      curedArticle.category === 'Water' &&
      publishedAfterCure.workflowState === WorkflowState.Published &&
      publishedAfterCure.category === 'Water';

    // 11. Failed operations do not mutate stored records, timestamps, history, or workflow state
    const failedOpIntegrityOk =
      noMutationOnFailedUpdate &&
      noWriteOnDraftTransitionFailure &&
      noWriteOnApproveFailure &&
      noWriteOnPublishFailure;

    // 12. Existing RBAC, Draft-only content protection, and N2-A editorial fields remain intact
    currentAuthUid = viewerAdmin.id;
    let viewerCreateBlocked = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          titleAr: 'محاولة إنشاء بواسطة مراقب',
          category: 'Climate',
        },
        viewerAdmin,
        true
      );
    } catch {
      viewerCreateBlocked = true;
    }

    currentAuthUid = editorAdmin.id;
    let publishedEditBlocked = false;
    try {
      await NewsAdminClient.saveNewsItem(
        {
          id: publishedAfterCure.id,
          titleAr: 'محاولة تعديل مقال منشور',
          category: 'Climate',
        },
        editorAdmin,
        false
      );
    } catch {
      publishedEditBlocked = true;
    }

    const n2aPreservedDraft = await NewsAdminClient.saveNewsItem(
      {
        titleAr: 'مسودة تجريبية بالحقول التحريرية والتصنيف القياسي',
        category: 'Biodiversity',
        kickerAr: 'ترويسة استباقية',
        kickerEn: 'Proactive Kicker',
        journalisticType: 'Investigation',
      },
      editorAdmin,
      true
    );
    const n2aFieldsIntactOk =
      n2aPreservedDraft.category === 'Biodiversity' &&
      n2aPreservedDraft.kickerAr === 'ترويسة استباقية' &&
      n2aPreservedDraft.kickerEn === 'Proactive Kicker' &&
      n2aPreservedDraft.journalisticType === 'Investigation';

    const rbacAndN2aOk = viewerCreateBlocked && publishedEditBlocked && n2aFieldsIntactOk;

    assert(
      'REQ-17',
      'Canonical News Category Integrity and Legacy Draft Safety',
      allSevenCreatedOk &&
        allInvalidCreateRejected &&
        clientNoImplicitClimateOk &&
        legacyCategoryPreservedOk &&
        explicitReclassOk &&
        invalidReassignmentRejected &&
        emptyCategoryUpdateRejected &&
        draftToInReviewRejected &&
        inReviewToApprovedRejected &&
        approvedToPublishedRejected &&
        remedial1Ok &&
        remedial2Ok &&
        remedialPipelineCompleteOk &&
        failedOpIntegrityOk &&
        rbacAndN2aOk,
      'All seven canonical keys accepted for creation; missing/empty/translated/unknown/legacy values rejected for new drafts; client Climate fallback removed; historical legacy draft categories preserved exactly on unrelated edits; explicit reclassification to canonical key succeeds while invalid reassignment fails; forward transitions (InReview/Approved/Published) rejected for noncanonical categories; remedial transitions remain available; failed operations perform zero repository writes or metadata mutations; RBAC, draft-only lock, and N2-A editorial fields fully preserved'
    );
  } catch (err: any) {
    assert('REQ-17', 'Canonical News Category Integrity and Legacy Draft Safety', false, err.message);
  }

  // =========================================================================
  // REQ-18: N2-A / C3 Public Category Integrity (Zero Climate Fallback & Fail-Closed Transport)
  // =========================================================================
  try {
    // 1. Exact Seven Canonical Category Definitions & Bilingual Labels
    const expectedKeys: Category[] = [
      'Climate',
      'Water',
      'Biodiversity',
      'Pollution',
      'Energy',
      'Agriculture',
      'EnvironmentalPolicy',
    ];

    const definedKeys = CANONICAL_CATEGORY_DEFINITIONS.map(d => d.value);
    const keysMatchOk =
      definedKeys.length === 7 &&
      expectedKeys.every(k => definedKeys.includes(k));

    let bilingualLabelsOk = true;
    for (const def of CANONICAL_CATEGORY_DEFINITIONS) {
      const arLabel = getCategoryLabel(def.value, true);
      const enLabel = getCategoryLabel(def.value, false);
      if (arLabel !== def.labelAr || enLabel !== def.labelEn) {
        bilingualLabelsOk = false;
        break;
      }
    }

    // Unknown category labels return the category string unchanged without translating or falling back to Climate
    const unknownCatLabelAr = getCategoryLabel('الاستجابة والطوارئ البيئية', true);
    const unknownCatLabelEn = getCategoryLabel('الاستجابة والطوارئ البيئية', false);
    const unknownPreservedLabelOk =
      unknownCatLabelAr === 'الاستجابة والطوارئ البيئية' &&
      unknownCatLabelEn === 'الاستجابة والطوارئ البيئية';

    // 2. normalizeCategory strictly accepts canonical keys, rejects everything else with null (zero Climate fallback)
    let normalizeCanonicalOk = true;
    for (const key of expectedKeys) {
      if (normalizeCategory(key) !== key) {
        normalizeCanonicalOk = false;
        break;
      }
    }
    const normalizeNonCanonicalOk =
      normalizeCategory('الاستجابة والطوارئ البيئية') === null &&
      normalizeCategory('water') === null &&
      normalizeCategory('climate') === null &&
      normalizeCategory('Unknown') === null &&
      normalizeCategory('') === null &&
      normalizeCategory(null) === null &&
      normalizeCategory(undefined) === null;

    // 3. Server PublicNewsRepository withholds non-canonical categories from public projection
    const publicTestRepo = new InMemoryNewsRepository();

    // Create 7 canonical published articles
    const canonicalPublishedIds: string[] = [];
    for (let i = 0; i < expectedKeys.length; i++) {
      const key = expectedKeys[i];
      const item: NewsItemBackend = {
        id: `pub-canonical-${key.toLowerCase()}`,
        titleAr: `عنوان مقال منشور ${key}`,
        titleEn: `Published Article Title ${key}`,
        kickerAr: `ترويسة ${key}`,
        kickerEn: `Kicker ${key}`,
        journalisticType: 'NewsReport',
        summaryAr: `ملخص للمقال ${key}`,
        summaryEn: `Summary for article ${key}`,
        bodyAr: `نص المقال العربي لتصنيف ${key}`,
        bodyEn: `English article body for category ${key}`,
        author: 'محرر وعد الكوكب',
        category: key,
        tags: [key.toLowerCase(), 'environment'],
        sources: ['وكالة الأنباء'],
        workflowState: 'Published',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
        publishedAt: `2026-10-20T10:0${i}:00.000Z`,
        history: [],
      };
      await publicTestRepo.save(item);
      canonicalPublishedIds.push(item.id);
    }

    // Historical published article with non-canonical category (legacy Arabic label)
    const legacyPublishedItem: NewsItemBackend = {
      id: 'pub-legacy-emergency',
      titleAr: 'مقال قديم منشور بتصنيف الاستجابة والطوارئ',
      titleEn: 'Historical Article Published With Legacy Category',
      kickerAr: 'ترويسة تاريخية',
      kickerEn: 'Historical Kicker',
      journalisticType: 'Feature',
      summaryAr: 'ملخص المقال القديم',
      summaryEn: 'Summary of historical article',
      bodyAr: 'محتوى المقال التاريخي الكامل',
      bodyEn: 'Full historical article body',
      author: 'المحرر التاريخي',
      category: 'الاستجابة والطوارئ البيئية',
      tags: ['legacy', 'emergency'],
      sources: ['الأرشيف'],
      workflowState: 'Published',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
      publishedAt: '2026-01-01T12:00:00.000Z',
      history: [],
    };
    await publicTestRepo.save(legacyPublishedItem);

    // Published article with lowercase/invalid category
    const lowercasePublishedItem: NewsItemBackend = {
      id: 'pub-invalid-lowercase',
      titleAr: 'مقال منشور بتصنيف غير قياسي بحروف صغيرة',
      titleEn: 'Article with lowercase category',
      kickerAr: 'ترويسة',
      kickerEn: 'Kicker',
      journalisticType: 'NewsReport',
      summaryAr: 'ملخص',
      bodyAr: 'محتوى',
      author: 'المحرر',
      category: 'water',
      tags: [],
      sources: [],
      workflowState: 'Published',
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
      publishedAt: '2026-10-20T10:00:00.000Z',
      history: [],
    };
    await publicTestRepo.save(lowercasePublishedItem);

    // Non-published items (Draft, Approved)
    await publicTestRepo.save({
      id: 'draft-item',
      titleAr: 'مسودة بتصنيف قياسي',
      summaryAr: 'ملخص',
      bodyAr: 'نص',
      author: 'محرر',
      category: 'Climate',
      tags: [],
      sources: [],
      workflowState: 'Draft',
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
      history: [],
    });

    const publicRepo = new PublicNewsRepository(publicTestRepo);

    // listPublicNews: Only canonical Published items returned
    const publicList = await publicRepo.listPublicNews();
    const publicListCountOk = publicList.length === 7;
    const allPublicAreCanonical = publicList.every(i => isCanonicalCategory(i.category));
    const legacyExcludedFromList = !publicList.some(i => i.id === 'pub-legacy-emergency');
    const lowercaseExcludedFromList = !publicList.some(i => i.id === 'pub-invalid-lowercase');
    const draftExcludedFromList = !publicList.some(i => i.id === 'draft-item');

    // Editorial fields preserved in list projection
    const editorialFieldsPreservedInList = publicList.every(
      i => i.kickerAr !== undefined && i.journalisticType === 'NewsReport'
    );

    // getPublicNewsById: Canonical item succeeds; non-canonical item returns null
    const canonicalDetail = await publicRepo.getPublicNewsById('pub-canonical-water');
    const canonicalDetailOk =
      canonicalDetail !== null &&
      canonicalDetail.category === 'Water' &&
      canonicalDetail.kickerAr === 'ترويسة Water' &&
      canonicalDetail.kickerEn === 'Kicker Water' &&
      canonicalDetail.journalisticType === 'NewsReport';

    const legacyDetail = await publicRepo.getPublicNewsById('pub-legacy-emergency');
    const legacyDetailWithheldOk = legacyDetail === null;

    const lowercaseDetail = await publicRepo.getPublicNewsById('pub-invalid-lowercase');
    const lowercaseDetailWithheldOk = lowercaseDetail === null;

    const draftDetail = await publicRepo.getPublicNewsById('draft-item');
    const draftDetailWithheldOk = draftDetail === null;

    // Administrative record in repo remains untouched (no mutation, no deletion)
    const rawLegacyInRepo = await publicTestRepo.getById('pub-legacy-emergency');
    const rawLegacyUntouchedOk =
      rawLegacyInRepo !== null &&
      rawLegacyInRepo.workflowState === 'Published' &&
      rawLegacyInRepo.category === 'الاستجابة والطوارئ البيئية';

    // 4. Domain Adapter: sanitizeForPublic, toCanonicalNews, publicDtoToCanonicalNews fail-closed
    const legacyAsWorkflowItem = toWorkflowNewsItem({
      id: rawLegacyInRepo!.id,
      contentType: 'News',
      titleAr: rawLegacyInRepo!.titleAr,
      excerptAr: rawLegacyInRepo!.summaryAr,
      contentAr: rawLegacyInRepo!.bodyAr,
      category: 'Climate', // placeholder for type-checking toWorkflowNewsItem
      tags: [],
      originalLanguage: 'ar',
      availableLanguages: ['ar'],
      status: 'Published',
      approvalStatus: 'Approved',
      rightsStatus: 'Cleared',
      location: 'Sudan',
      urgencyLevel: 'Standard',
      sources: [],
      createdAt: rawLegacyInRepo!.createdAt,
      updatedAt: rawLegacyInRepo!.updatedAt,
    });
    // Set the exact legacy category on the workflow item
    (legacyAsWorkflowItem as any).category = 'الاستجابة والطوارئ البيئية';

    // sanitizeForPublic returns null for published item with non-canonical category
    const sanitizedLegacyResult = sanitizeForPublic(legacyAsWorkflowItem);
    const sanitizeForPublicNullOk = sanitizedLegacyResult === null;

    // toCanonicalNews throws deterministic CATEGORY_INTEGRITY_ERROR
    let toCanonicalNewsThrew = false;
    try {
      toCanonicalNews(legacyAsWorkflowItem);
    } catch (e: any) {
      if (e.message && e.message.includes('CATEGORY_INTEGRITY_ERROR')) {
        toCanonicalNewsThrew = true;
      }
    }

    // publicDtoToCanonicalNews throws deterministic CATEGORY_INTEGRITY_ERROR for forged DTO
    let publicDtoThrew = false;
    try {
      publicDtoToCanonicalNews({
        id: 'dto-forged',
        titleAr: 'عنوان',
        summaryAr: 'ملخص',
        bodyAr: 'نص',
        author: 'كاتب',
        category: 'الاستجابة والطوارئ البيئية',
        tags: [],
        sources: [],
        location: 'Sudan',
        urgencyLevel: 'Standard',
        publishedAt: '2026-10-20T10:00:00.000Z',
        createdAt: '2026-10-20T10:00:00.000Z',
      });
    } catch (e: any) {
      if (e.message && e.message.includes('CATEGORY_INTEGRITY_ERROR')) {
        publicDtoThrew = true;
      }
    }

    // 5. PublicNewsClient: Valid filters, invalid filters return empty list (no Climate fallback), fail-closed transport
    PublicNewsClient.setTransport(async () => ({
      articles: publicList,
    }));

    // Filter by canonical category returns only matching articles
    const waterFiltered = await PublicNewsClient.listPublishedNews({ category: 'Water' });
    const climateFiltered = await PublicNewsClient.listPublishedNews({ category: 'Climate' });
    const canonicalFilterOk =
      waterFiltered.length === 1 &&
      waterFiltered[0].category === 'Water' &&
      climateFiltered.length === 1 &&
      climateFiltered[0].category === 'Climate';

    // Filter by unknown / non-canonical category returns empty list [] (never falls back to Climate)
    const unknownCatFiltered = await PublicNewsClient.listPublishedNews({
      category: 'الاستجابة والطوارئ البيئية',
    });
    const invalidCatFiltered = await PublicNewsClient.listPublishedNews({
      category: 'InvalidCategory',
    });
    const lowercaseFilter = await PublicNewsClient.listPublishedNews({
      category: 'water',
    });
    const nonCanonicalFilterReturnsEmptyOk =
      unknownCatFiltered.length === 0 &&
      invalidCatFiltered.length === 0 &&
      lowercaseFilter.length === 0;

    // Malformed transport with non-canonical DTO fails closed
    PublicNewsClient.setTransport(async () => ({
      articles: [
        {
          id: 'malformed-dto-1',
          titleAr: 'مقال مشبوه',
          summaryAr: 'ملخص',
          bodyAr: 'نص',
          author: 'مجهول',
          category: 'UnverifiedThirdPartyCategory',
          tags: [],
          sources: [],
          location: 'Sudan',
          urgencyLevel: 'Standard',
          publishedAt: '2026-10-20T10:00:00.000Z',
          createdAt: '2026-10-20T10:00:00.000Z',
        },
      ],
    }));

    let malformedTransportFailedClosed = false;
    try {
      await PublicNewsClient.listPublishedNews();
    } catch (e: any) {
      if (e.message && e.message.includes('CATEGORY_INTEGRITY_ERROR')) {
        malformedTransportFailedClosed = true;
      }
    }

    const req18Success =
      keysMatchOk &&
      bilingualLabelsOk &&
      unknownPreservedLabelOk &&
      normalizeCanonicalOk &&
      normalizeNonCanonicalOk &&
      publicListCountOk &&
      allPublicAreCanonical &&
      legacyExcludedFromList &&
      lowercaseExcludedFromList &&
      draftExcludedFromList &&
      editorialFieldsPreservedInList &&
      canonicalDetailOk &&
      legacyDetailWithheldOk &&
      lowercaseDetailWithheldOk &&
      draftDetailWithheldOk &&
      rawLegacyUntouchedOk &&
      sanitizeForPublicNullOk &&
      toCanonicalNewsThrew &&
      publicDtoThrew &&
      canonicalFilterOk &&
      nonCanonicalFilterReturnsEmptyOk &&
      malformedTransportFailedClosed;

    assert(
      'REQ-18',
      'Public Canonical Category Integrity, Fail-Closed DTO & Zero Climate Fallback',
      req18Success,
      'Exact 7 canonical keys and bilingual labels verified from CANONICAL_CATEGORY_DEFINITIONS; getCategoryLabel returns category string unchanged for unknown categories; normalizeCategory returns null without Climate fallback; server public projection excludes non-canonical published items without mutating or deleting underlying records; public detail returns null for non-canonical items; domain adapter sanitizeForPublic returns null and conversion throws CATEGORY_INTEGRITY_ERROR; public client category filter matches exact canonical key and returns empty list for non-canonical filter values without falling back to Climate; malformed transport DTO fails closed; editorial kicker/journalisticType fields and privacy projections fully preserved'
    );
  } catch (err: any) {
    assert(
      'REQ-18',
      'Public Canonical Category Integrity, Fail-Closed DTO & Zero Climate Fallback',
      false,
      err.message
    );
  }

  // Clean up test transport
  NewsAdminClient.setTransport(null);
  PublicNewsClient.setTransport(null);

  return results;
}
