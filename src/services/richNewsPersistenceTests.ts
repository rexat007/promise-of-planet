import { NewsAdminClient } from './newsAdminClient';
import { AdminRole, AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import type { NewsItem } from '../types/news';
import type { 
  NewsRepository, 
  NewsItemBackend, 
} from '../../functions/src/news/newsRepository';
import type { AdminRepository } from '../../functions/src/admin/adminRepository';
import { NewsApplicationService } from '../../functions/src/news/newsApplicationService';
import { executeManageNewsRequest } from '../../functions/src/news/newsAdminHandlers';
import { sanitizeForFirestore } from '../../functions/src/news/firestoreNewsRepository';
import type { RichNewsDocumentWrapper } from '../../functions/src/types/richNewsDocument';


export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

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

  async listPublished(_language?: 'ar' | 'en'): Promise<NewsItemBackend[]> {
    return Array.from(this.items.values())
      .filter(item => item.workflowState === 'Published')
      .map(v => JSON.parse(JSON.stringify(v)));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}

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

export async function runRichNewsPersistenceTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const assert = (id: string, name: string, condition: boolean, details: string) => {
    results.push({
      id,
      name,
      passed: condition,
      details: condition ? `PASSED: ${details}` : `FAILED: ${details}`,
    });
  };

  const editorAdmin: AdminUser = {
    id: 'admin-editor-1',
    name: 'سارة أحمد',
    email: 'editor@promiseofplanet.org',
    role: AdminRole.ContentEditor,
    isActive: true,
  };

  const ownerAdmin: AdminUser = {
    id: 'admin-owner-1',
    name: 'د. عبد العظيم',
    email: 'owner@promiseofplanet.org',
    role: AdminRole.Owner,
    isActive: true,
  };

  const memoryNewsRepo = new InMemoryNewsRepository();
  const memoryAdminRepo = new InMemoryAdminRepository([editorAdmin, ownerAdmin]);
  const newsService = new NewsApplicationService(memoryNewsRepo);

  let currentAuthUid: string | null = editorAdmin.id;


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

  const validRichDoc: RichNewsDocumentWrapper = {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { dir: "rtl" },
          content: [{ type: "text", text: "محتوى غني" }]
        }
      ]
    }
  };

  // --------------------------------------------------------------------------
  // TEST 1: Create draft with valid richBodyAr and derive plain text
  // --------------------------------------------------------------------------
  try {
    const input: Partial<NewsItem> = {
      titleAr: 'خبر مع محتوى غني',
      category: 'Climate',
      richBodyAr: validRichDoc,
    };

    const created = await NewsAdminClient.saveNewsItem(input, editorAdmin, true);

    const hasRich = JSON.stringify(created.richBodyAr) === JSON.stringify(validRichDoc);
    const hasDerivedPlain = created.bodyAr === "محتوى غني";

    assert(
      'RICH-01',
      'Create draft with valid richBodyAr and derive plain text',
      hasRich && hasDerivedPlain,
      'richBodyAr persisted and bodyAr automatically derived'
    );
  } catch (err: any) {
    assert('RICH-01', 'Create draft with valid richBodyAr and derive plain text', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Update draft preserving rich content on partial update
  // --------------------------------------------------------------------------
  try {
    const input1: Partial<NewsItem> = {
      titleAr: 'خبر محتوى غني للتحديث',
      category: 'Climate',
      richBodyAr: validRichDoc,
    };
    const created = await NewsAdminClient.saveNewsItem(input1, editorAdmin, true);

    const input2: Partial<NewsItem> = {
      id: created.id,
      titleAr: 'عنوان معدل',
    };
    const updated = await NewsAdminClient.saveNewsItem(input2, editorAdmin, false);

    const richPreserved = JSON.stringify(updated.richBodyAr) === JSON.stringify(validRichDoc);
    const plainPreserved = updated.bodyAr === "محتوى غني";

    assert(
      'RICH-02',
      'Preserve existing rich documents on partial update',
      richPreserved && plainPreserved,
      'richBodyAr and derived bodyAr preserved when only title updated'
    );
  } catch (err: any) {
    assert('RICH-02', 'Preserve existing rich documents on partial update', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Reject malformed rich documents
  // --------------------------------------------------------------------------
  try {
    const malformedRichDoc = { ...validRichDoc, schemaVersion: 99 };
    const input: Partial<NewsItem> = {
      titleAr: 'خبر مع محتوى معطوب',
      category: 'Climate',
      richBodyAr: malformedRichDoc as any,
    };

    let rejected = false;
    try {
      await NewsAdminClient.saveNewsItem(input, editorAdmin, true);
    } catch (e: any) {
      if (e.message.includes('INVALID_RICH_DOCUMENT_AR')) {
        rejected = true;
      }
    }

    assert(
      'RICH-03',
      'Reject malformed rich documents',
      rejected,
      'Server rejected rich document with unsupported schema version'
    );
  } catch (err: any) {
    assert('RICH-03', 'Reject malformed rich documents', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Reject conflicting plain/rich updates
  // --------------------------------------------------------------------------
  try {
    const input: Partial<NewsItem> = {
      titleAr: 'خبر مع محتوى متناقض',
      category: 'Climate',
      richBodyAr: validRichDoc,
      bodyAr: 'محتوى مختلف تماما',
    };

    let rejected = false;
    try {
      await NewsAdminClient.saveNewsItem(input, editorAdmin, true);
    } catch (e: any) {
      if (e.message.includes('CONTRADICTORY_UPDATE')) {
        rejected = true;
      }
    }

    assert(
      'RICH-04',
      'Reject conflicting plain/rich updates',
      rejected,
      'Server rejected update where bodyAr did not match derived text from richBodyAr'
    );
  } catch (err: any) {
    assert('RICH-04', 'Reject conflicting plain/rich updates', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Legacy compatibility (Create draft without rich documents)
  // --------------------------------------------------------------------------
  try {
    const input: Partial<NewsItem> = {
      titleAr: 'خبر قديم النمط',
      category: 'Climate',
      bodyAr: 'نص عادي فقط',
    };

    const created = await NewsAdminClient.saveNewsItem(input, editorAdmin, true);

    const noRich = created.richBodyAr === undefined;
    const hasPlain = created.bodyAr === 'نص عادي فقط';

    assert(
      'RICH-05',
      'Legacy compatibility (Plain text only)',
      noRich && hasPlain,
      'Successfully created draft without rich document'
    );
  } catch (err: any) {
    assert('RICH-05', 'Legacy compatibility (Plain text only)', false, err.message);
  }

  NewsAdminClient.setTransport(null);
  return results;
}
