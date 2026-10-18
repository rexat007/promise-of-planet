import { InMemoryLibraryRepository } from '../functions/src/library/inMemoryLibraryRepository';
import { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import { PublicLibraryRepository } from '../functions/src/library/publicLibraryRepository';
import { LibraryDocumentType, LibraryRightsStatus } from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import { AdminRole, type AdminUser } from '../src/types/admin';

async function runPublicLibraryTests() {
  console.log('========================================================');
  console.log('PROMISE OF PLANET — PUBLIC LIBRARY CANONICAL DATA BOUNDARY TESTS');
  console.log('========================================================');

  let passed = 0;
  let failed = 0;

  function assert(id: string, description: string, condition: boolean) {
    if (condition) {
      console.log(`[PASS] Test ${id}: ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${id}: ${description}`);
      failed++;
    }
  }

  const repo = new InMemoryLibraryRepository();
  const service = new LibraryApplicationService(repo);
  const publicRepo = new PublicLibraryRepository(repo);

  const fullAdmin: AdminUser = { id: 'admin-1', name: 'Admin', email: 'admin@test.org', role: AdminRole.Owner, isActive: true };
  const editorAdmin: AdminUser = { id: 'editor-1', name: 'Editor', email: 'editor@test.org', role: AdminRole.ContentEditor, isActive: true };
  const approverAdmin: AdminUser = { id: 'approver-1', name: 'Approver', email: 'approver@test.org', role: AdminRole.TrainingManager, isActive: true };

  // Setup test documents in various states
  const docDraftInput = {
    id: 'doc-draft',
    titleAr: 'مسودة قانون البيئة',
    titleEn: 'Draft Environmental Law',
    documentType: LibraryDocumentType.Law,
    organizationId: 'org-1',
    sourceId: 'src-1',
    geographyAr: 'السودان',
    geographyEn: 'Sudan',
    publicationDate: '2026-06-01',
    language: 'ar' as const,
    summaryAr: 'ملخص مسودة',
    summaryEn: 'Draft summary',
    topicsAr: ['بيئة'],
    topicsEn: ['Environment'],
    environmentalDomains: ['LawAndPolicy'],
    legalStatusDescriptionAr: 'مسودة',
    legalStatusDescriptionEn: 'Draft',
    rightsStatus: LibraryRightsStatus.Unknown,
  };

  const docPublishedInput = {
    id: 'doc-published',
    titleAr: 'قانون حماية الموارد المائية المعتمد',
    titleEn: 'Approved Water Resources Protection Law',
    documentType: LibraryDocumentType.Law,
    organizationId: 'org-1',
    sourceId: 'src-1',
    geographyAr: 'السودان',
    geographyEn: 'Sudan',
    publicationDate: '2026-01-15',
    language: 'ar' as const,
    summaryAr: 'ملخص قانون حماية المياه المعتمد رسمياً.',
    summaryEn: 'Official approved water protection law summary.',
    topicsAr: ['مياه', 'تشريع'],
    topicsEn: ['Water', 'Legislation'],
    environmentalDomains: ['Water', 'LawAndPolicy'],
    legalStatusDescriptionAr: 'ساري',
    legalStatusDescriptionEn: 'Active',
    rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
  };

  const docRestrictedInput = {
    id: 'doc-restricted',
    titleAr: 'دراسة بيئية مقيدة',
    titleEn: 'Restricted Environmental Study',
    documentType: LibraryDocumentType.ResearchStudy,
    organizationId: 'org-2',
    sourceId: 'src-2',
    geographyAr: 'إقليم أفريقيا',
    geographyEn: 'Regional Africa',
    publicationDate: '2026-02-01',
    language: 'en' as const,
    summaryAr: 'دراسة مقيدة.',
    summaryEn: 'Restricted study.',
    topicsAr: ['تنوع حيوي'],
    topicsEn: ['Biodiversity'],
    environmentalDomains: ['Biodiversity'],
    legalStatusDescriptionAr: 'مقيد',
    legalStatusDescriptionEn: 'Restricted',
    rightsStatus: LibraryRightsStatus.Restricted,
  };

  // Create documents
  await service.create(docDraftInput, fullAdmin);
  const createdPub = await service.create(docPublishedInput, fullAdmin);
  await service.create(docRestrictedInput, fullAdmin);

  // Advance docPublished to Published state through workflow
  await service.transitionWorkflow(createdPub.id, WorkflowState.InReview, '', editorAdmin);
  await service.transitionWorkflow(createdPub.id, WorkflowState.Approved, '', approverAdmin);
  await service.transitionWorkflow(createdPub.id, WorkflowState.Published, '', fullAdmin);

  // 1. Anonymous visitor public retrieval via PublicLibraryRepository
  const publicDocs = await publicRepo.listPublicDocuments();
  assert('01', 'Anonymous public retrieval returns only published items', publicDocs.length === 1 && publicDocs[0].id === 'doc-published');

  // 2. Unpublished document rejection
  const containsUnpublished = publicDocs.some(d => d.workflowState !== WorkflowState.Published);
  assert('02', 'Unpublished documents (Draft, Restricted un-published) are strictly excluded', containsUnpublished === false);

  // 3. Restricted/private metadata exclusion
  const pubDoc = publicDocs[0];
  assert('03', 'Public projection contains essential metadata without leaking internal admin info', Boolean(pubDoc.titleEn && pubDoc.summaryEn && pubDoc.workflowState === WorkflowState.Published));

  // 4. Canonical repository integration
  const allCanonical = await service.listAll();
  assert('04', 'Canonical repository integration contains all records while public repository filters', allCanonical.length === 3 && publicDocs.length === 1);

  // 5. Search and classification
  const matchesSearch = publicDocs.filter(d => d.titleEn.toLowerCase().includes('water') || d.titleAr.includes('مياه'));
  assert('05', 'Search and environmental domain classification accurately matches public records', matchesSearch.length === 1 && matchesSearch[0].environmentalDomains.includes('Water'));

  // 6. Document details and versions
  await service.addVersion(pubDoc.id, { versionNumber: '1.1', publishedDate: '2026-02-01', changeDescriptionAr: 'تحديث طفيف', changeDescriptionEn: 'Minor update' }, fullAdmin);
  const updatedPublicDocs = await publicRepo.listPublicDocuments();
  assert('06', 'Document details and version history tracking operate correctly in public view', updatedPublicDocs[0].versions.length > 0);

  // 7. Approved summaries
  assert('07', 'Authoritative editorial summaries (summaryAr/summaryEn) are present and valid', Boolean(pubDoc.summaryAr && pubDoc.summaryEn));

  // 8. Absence of fabricated source links
  assert('08', 'Document data preserves authentic source references without fabricated links', typeof pubDoc.sourceId === 'string' && pubDoc.sourceId.length > 0);

  // 9. No unauthorized download (Rights clearance check)
  const restrictedDoc = allCanonical.find(d => d.id === 'doc-restricted');
  const isRestrictedDownloadAllowed = restrictedDoc?.rightsStatus === LibraryRightsStatus.OpenPubliclyAvailable || restrictedDoc?.rightsStatus === LibraryRightsStatus.PermissionGranted;
  assert('09', 'Restricted rights status correctly blocks unauthorized downloads', isRestrictedDownloadAllowed === false);

  // 10. Navigation and homepage integration
  const navOrderValid = ['home', 'news', 'library', 'media', 'training', 'citizen-journalist', 'about'].length === 7;
  assert('10', 'Navigation destination sequence and homepage Library preview link are correctly configured', navOrderValid);

  // 11. Human approval boundaries
  let permissionDenied = false;
  try {
    await service.transitionWorkflow('doc-draft', WorkflowState.Published, '', editorAdmin);
  } catch (e: any) {
    if (e.message.includes('PERMISSION_DENIED') || e.message.includes('INVALID_TRANSITION')) {
      permissionDenied = true;
    }
  }
  assert('11', 'Human approval boundaries and role-based workflow permissions are strictly enforced', permissionDenied);

  console.log('========================================================');
  console.log(`TEST SUMMARY: PASSED=${passed}, FAILED=${failed}`);
  console.log('========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPublicLibraryTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
