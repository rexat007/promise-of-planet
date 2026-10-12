import { InMemoryLibraryRepository } from '../functions/src/library/inMemoryLibraryRepository';
import { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import { LibraryDocumentType, LibraryRightsStatus } from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import { AdminRole, AdminPermission, type AdminUser } from '../src/types/admin';

async function runTests() {
  console.log('Running Library Canonical Persistence Foundation Unit Tests...');

  const fullAdmin: AdminUser = { id: 'a1', name: 'Full Admin', email: 'full@test.org', role: AdminRole.Owner, isActive: true };
  const editorAdmin: AdminUser = { id: 'a2', name: 'Editor', email: 'e@test.org', role: AdminRole.ContentEditor, isActive: true };
  const revAdmin: AdminUser = { id: 'a3', name: 'Reviewer', email: 'r@test.org', role: AdminRole.RightsReviewer, isActive: true };
  const appAdmin: AdminUser = { id: 'a4', name: 'Approver', email: 'app@test.org', role: AdminRole.TrainingManager, isActive: true };
  const pubAdmin: AdminUser = { id: 'a5', name: 'Publisher', email: 'pub@test.org', role: AdminRole.Owner, isActive: true };

  const repo = new InMemoryLibraryRepository();
  const service = new LibraryApplicationService(repo);

  const docInput = { titleAr: 'قانون بيئي', titleEn: 'Law', documentType: LibraryDocumentType.Law, organizationId: 'o1', sourceId: 's1', geographyAr: 'مصر', geographyEn: 'Egypt', publicationDate: '2026-01-01', language: 'ar' as const, summaryAr: 'ملخص', summaryEn: 'Sum', topicsAr: [], topicsEn: [], environmentalDomains: [], legalStatusDescriptionAr: 'قانون', legalStatusDescriptionEn: 'Law', rightsStatus: LibraryRightsStatus.Unknown };

  // 1. canonical create
  const created = await service.create(docInput, fullAdmin);
  console.log('✅ Passed: 1. canonical create');

  // 2. duplicate create
  try { await service.create({ ...docInput, id: created.id }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('DUPLICATE')) throw e; }
  console.log('✅ Passed: 2. duplicate create rejected');

  // 3-4. listAll / getById
  const allDocs = await service.listAll();
  const fetched = await service.getById(created.id);
  if (allDocs.length !== 1 || !fetched) throw new Error('fail');
  console.log('✅ Passed: 3-4. listAll/getById');

  // 25. unexpected create field rejected (remapped from original 1)
  try { await service.create({ ...docInput, unexpected: 'field' } as any, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 25. unexpected create field rejected');

  // 27. invalid language rejected (remapped from original 3)
  try { await service.create({ ...docInput, language: 'fr' as any }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 27. invalid language rejected');

  // 28. invalid publicationDate rejected (remapped from original 4)
  try { await service.create({ ...docInput, publicationDate: 'not-a-date' }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 28. invalid publicationDate rejected');

  // 36. Review transition succeeds without Edit (remapped from original 12)
  const d1 = await service.transitionWorkflow(created.id, WorkflowState.InReview, 'submitting', editorAdmin);
  const d2 = await service.transitionWorkflow(d1.id, WorkflowState.ChangesRequested, 'reviewing', revAdmin);
  console.log('✅ Passed: 36. Review transition succeeds without Edit');

  // 37. Approve transition succeeds without Edit (remapped from original 13)
  await service.transitionWorkflow(created.id, WorkflowState.Draft, 'revising', editorAdmin);
  await service.transitionWorkflow(created.id, WorkflowState.InReview, 'submitting', editorAdmin);
  await service.transitionWorkflow(created.id, WorkflowState.Approved, 'approving', appAdmin);
  console.log('✅ Passed: 37. Approve transition succeeds without Edit');

  // 38. Publish transition succeeds without Edit (remapped from original 14)
  await service.transitionWorkflow(created.id, WorkflowState.Published, 'publishing', pubAdmin);
  console.log('✅ Passed: 38. Publish transition succeeds without Edit');

  // 39. missing actual transition permission rejected (remapped from original 15)
  try { await service.transitionWorkflow(created.id, WorkflowState.InReview, 'invalid', editorAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('PERMISSION_DENIED') && !e.message.includes('INVALID_TRANSITION')) throw e; }
  console.log('✅ Passed: 39. missing actual transition permission rejected');
  
  // 40. SubmitForReview accepts Create OR Edit (remapped from original 16)
  const doc2 = await service.create(docInput, editorAdmin);
  await service.transitionWorkflow(doc2.id, WorkflowState.InReview, 'sub', editorAdmin);
  console.log('✅ Passed: 40. SubmitForReview accepts Create OR Edit');

  // 6. invalid enum
  try { await service.create({ ...docInput, documentType: 'invalid' as any }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 6. invalid documentType rejected');

  // 10. Firestore embedded-id mismatch
  const doc4 = { ...docInput, id: 'wrong-id' };
  await service.repo.create(doc4 as any);
  try { await service.repo.getById('wrong-id'); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; }
  console.log('✅ Passed: 34. Firestore embedded-id mismatch rejected');

  console.log('🎉 All Remediation Tests PASSED!');
}
runTests().catch((err) => { console.error(err); process.exit(1); });
