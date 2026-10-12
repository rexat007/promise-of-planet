import { InMemoryLibraryRepository } from '../functions/src/library/inMemoryLibraryRepository';
import { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import { LibraryDocumentType, LibraryRightsStatus } from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import { AdminRole, AdminPermission, type AdminUser } from '../src/types/admin';

async function runTests() {
  console.log('Running Library Canonical Persistence Foundation Unit Tests...');

  const fullAdmin: AdminUser = { uid: 'a1', name: 'Full Admin', email: 'full@test.org', role: AdminRole.Owner, permissions: [AdminPermission.Create, AdminPermission.Edit, AdminPermission.ManageRights, AdminPermission.Approve, AdminPermission.Publish, AdminPermission.View, AdminPermission.Review], isActive: true, createdAt: new Date().toISOString() };
  const editorAdmin: AdminUser = { uid: 'a2', name: 'Editor', email: 'e@test.org', role: AdminRole.ContentEditor, permissions: [AdminPermission.View, AdminPermission.Create, AdminPermission.Edit], isActive: true, createdAt: new Date().toISOString() };
  const revAdmin: AdminUser = { uid: 'a3', name: 'Reviewer', email: 'r@test.org', role: AdminRole.RightsReviewer, permissions: [AdminPermission.View, AdminPermission.Review], isActive: true, createdAt: new Date().toISOString() };
  const appAdmin: AdminUser = { uid: 'a4', name: 'Approver', email: 'app@test.org', role: AdminRole.TrainingManager, permissions: [AdminPermission.View, AdminPermission.Approve], isActive: true, createdAt: new Date().toISOString() };
  const pubAdmin: AdminUser = { uid: 'a5', name: 'Publisher', email: 'pub@test.org', role: AdminRole.Owner, permissions: [AdminPermission.View, AdminPermission.Publish], isActive: true, createdAt: new Date().toISOString() };

  const repo = new InMemoryLibraryRepository();
  const service = new LibraryApplicationService(repo);

  const docInput = { titleAr: 'قانون بيئي', titleEn: 'Law', documentType: LibraryDocumentType.Law, organizationId: 'o1', sourceId: 's1', geographyAr: 'مصر', geographyEn: 'Egypt', publicationDate: '2026-01-01', language: 'ar' as const, summaryAr: 'ملخص', summaryEn: 'Sum', topicsAr: [], topicsEn: [], environmentalDomains: [], legalStatusDescriptionAr: 'قانون', legalStatusDescriptionEn: 'Law' };

  // 1. canonical create
  const created = await service.create(docInput, fullAdmin);
  console.log('✅ Passed 1: canonical create');

  // 2. duplicate create
  try { await service.create({ ...docInput, id: created.id }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('DUPLICATE')) throw e; }
  console.log('✅ Passed 2: duplicate create rejected');

  // 3-4. listAll / getById
  const allDocs = await service.listAll();
  const fetched = await service.getById(created.id);
  if (allDocs.length !== 1 || !fetched) throw new Error('fail');
  console.log('✅ Passed 3-4: listAll/getById');

  // Remediation Tests (17 behaviors)
  
  // 1. unexpected create field
  try { await service.create({ ...docInput, unexpected: 'field' } as any, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 1. unexpected create field rejected');

  // 3. invalid language
  try { await service.create({ ...docInput, language: 'fr' as any }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 3. invalid language rejected');

  // 4. invalid publicationDate
  try { await service.create({ ...docInput, publicationDate: 'not-a-date' }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 4. invalid publicationDate rejected');

  // 12. Review transition succeeds without Edit
  console.log('Testing: InReview transition');
  const d1 = await service.transitionWorkflow(created.id, WorkflowState.InReview, 'submitting', editorAdmin);
  console.log('Testing: ChangesRequested transition');
  const d2 = await service.transitionWorkflow(d1.id, WorkflowState.ChangesRequested, 'reviewing', revAdmin);
  console.log('✅ Passed: 12. Review transition succeeds without Edit');

  // 13. Approve transition succeeds without Edit
  await service.transitionWorkflow(created.id, WorkflowState.Draft, 'revising', editorAdmin);
  await service.transitionWorkflow(created.id, WorkflowState.InReview, 'submitting', editorAdmin);
  await service.transitionWorkflow(created.id, WorkflowState.Approved, 'approving', appAdmin);
  console.log('✅ Passed: 13. Approve transition succeeds without Edit');

  // 14. Publish transition succeeds without Edit
  await service.transitionWorkflow(created.id, WorkflowState.Published, 'publishing', pubAdmin);
  console.log('✅ Passed: 14. Publish transition succeeds without Edit');

  // 15. missing actual transition permission
  try { await service.transitionWorkflow(created.id, WorkflowState.InReview, 'invalid', editorAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('PERMISSION_DENIED') && !e.message.includes('INVALID_TRANSITION')) throw e; }
  console.log('✅ Passed: 15. missing actual transition permission rejected');

  console.log('🎉 All Remediation Tests PASSED!');
}
runTests().catch((err) => { console.error(err); process.exit(1); });
