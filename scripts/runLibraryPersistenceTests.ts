import * as fs from 'fs';
import * as path from 'path';
import { InMemoryLibraryRepository } from '../functions/src/library/inMemoryLibraryRepository';
import { LibraryApplicationService } from '../functions/src/library/libraryApplicationService';
import { LibraryValidator } from '../functions/src/library/libraryValidator';
import { LibraryDocumentType, LibraryRightsStatus, type LibraryDocument } from '../src/types/library';
import { WorkflowState } from '../src/types/workflow';
import { AdminRole, AdminPermission, type AdminUser } from '../src/types/admin';
import { buildSparseLibraryMetadataUpdatePayload } from '../src/components/library/LibraryDocumentEditorModal';
import { isQuarantineCatalogDocumentId } from '../src/services/libraryQuarantineCatalogHandoffClient';

async function runTests() {
  let assertions = 0;
  console.log('Running Library Canonical Persistence Foundation Unit Tests...');

  const fullAdmin: AdminUser = { id: 'a1', name: 'Full Admin', email: 'full@test.org', role: AdminRole.Owner, isActive: true };
  const editorAdmin: AdminUser = { id: 'a2', name: 'Editor', email: 'e@test.org', role: AdminRole.ContentEditor, isActive: true };
  const appAdmin: AdminUser = { id: 'a4', name: 'Approver', email: 'app@test.org', role: AdminRole.TrainingManager, isActive: true };
  const pubAdmin: AdminUser = { id: 'a5', name: 'Publisher', email: 'pub@test.org', role: AdminRole.Owner, isActive: true };

  const repo = new InMemoryLibraryRepository();
  const service = new LibraryApplicationService(repo);

  const docInput = { id: 'd1', titleAr: 'قانون', titleEn: 'Law', documentType: LibraryDocumentType.Law, organizationId: 'o1', sourceId: 's1', geographyAr: 'مصر', geographyEn: 'Egypt', publicationDate: '2026-01-01', language: 'ar' as const, summaryAr: 'ملخص', summaryEn: 'Sum', topicsAr: [], topicsEn: [], environmentalDomains: [], legalStatusDescriptionAr: 'قانون', legalStatusDescriptionEn: 'Law', rightsStatus: LibraryRightsStatus.Unknown };

  // Create
  const created = await service.create(docInput, fullAdmin);
  if (created.id !== docInput.id) throw new Error('Assertion failed: create ID mismatch');
  assertions++;

  // Duplicate create
  try { await service.create(docInput, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('DUPLICATE')) throw e; assertions++; }

  // listAll
  const allDocs = await service.listAll();
  if (allDocs.length !== 1) throw new Error('Assertion failed: listAll');
  assertions++;

  // getById
  const fetched = await service.getById(created.id);
  if (!fetched || fetched.id !== created.id) throw new Error('Assertion failed: getById');
  assertions++;

  // Malformed create
  try { await service.create({} as any, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; assertions++; }

  // Invalid documentType
  try { await service.create({ ...docInput, documentType: 'invalid' as any }, fullAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR')) throw e; assertions++; }

  // Edit metadata
  await service.updateMetadata(created.id, { titleEn: 'New' }, editorAdmin);
  const updated = await service.getById(created.id);
  if (updated?.titleEn !== 'New') throw new Error('Assertion failed: updateMetadata');
  assertions++;

  // ManageRights
  await service.updateRights(created.id, LibraryRightsStatus.OpenPubliclyAvailable, '', '', fullAdmin);
  const rightsUpdated = await service.getById(created.id);
  if (rightsUpdated?.rightsStatus !== LibraryRightsStatus.OpenPubliclyAvailable) throw new Error('Assertion failed: updateRights');
  assertions++;

  // Missing document
  const missing = await service.getById('nonexistent');
  if (missing !== null) throw new Error('Assertion failed: getById nonexistent should be null');
  assertions++;

  // Invalid transition
  try { await service.transitionWorkflow(created.id, 'INVALID' as any, '', editorAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('INVALID_TRANSITION') && !e.message.includes('INVALID_ARGUMENT')) throw e; assertions++; }

  // Workflow transitions
  await service.transitionWorkflow(created.id, WorkflowState.InReview, '', editorAdmin);
  await service.transitionWorkflow(created.id, WorkflowState.Approved, '', appAdmin);
  await service.transitionWorkflow(created.id, WorkflowState.Published, '', pubAdmin);
  assertions += 3;

  // ReviseDraft (Transition from InReview to ChangesRequested, then to Draft)
  const doc2 = await service.create({ ...docInput, id: 'd2' }, fullAdmin);
  await service.transitionWorkflow(doc2.id, WorkflowState.InReview, '', editorAdmin);
  await service.transitionWorkflow(doc2.id, WorkflowState.ChangesRequested, '', appAdmin);
  await service.transitionWorkflow(doc2.id, WorkflowState.Draft, '', editorAdmin);
  const stateUpdated = await service.getById(doc2.id);
  if (stateUpdated?.workflowState !== WorkflowState.Draft) throw new Error('Assertion failed: ReviseDraft');
  assertions++;

  // Missing transition permission
  try { await service.transitionWorkflow(created.id, WorkflowState.Published, '', editorAdmin); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('PERMISSION_DENIED') && !e.message.includes('INVALID_TRANSITION')) throw e; assertions++; }

  // Firestore boundary test
  const validStructure = { ...docInput, id: 'd3', createdAt: '2026-01-01', updatedAt: '2026-01-01', workflowState: WorkflowState.Draft, workflowHistory: [], versions: [] };
  LibraryValidator.validatePersistedDocument(validStructure, 'd3');
  assertions++;
  try { LibraryValidator.validatePersistedDocument({ ...validStructure, id: 'wrong-id' }, 'd3'); throw new Error('fail'); } catch (e: any) { if (!e.message.includes('VALIDATION_ERROR: ID mismatch')) throw e; assertions++; }

  // =========================================================================
  // LIB-CATALOG-DRAFT-LIVE-ACCEPTANCE-REPAIR-01 REGRESSION ASSERTIONS
  // =========================================================================

  // 1. Optional text fields: explicit strings saved and trimmed, then null/undefined optional values
  //    do NOT throw TypeError (500) and do NOT overwrite or erase existing optional values.
  const docWithOptionals = await service.updateMetadata(
    doc2.id,
    {
      titleAr: '  قانون البيئة المحدث  ',
      titleEn: '  Updated Environmental Law  ',
      originalTitle: '  Original Law Title 2026  ',
      authorMetadataAr: '  اللجنة الوطنية للبيئة  ',
      authorMetadataEn: '  National Environment Committee  ',
      topicsAr: ['  تشريعات  ', '  مناخ  '],
      topicsEn: ['  Legislation  ', '  Climate  '],
      environmentalDomains: ['  LawAndPolicy  '],
    },
    editorAdmin
  );
  if (
    docWithOptionals.titleAr !== 'قانون البيئة المحدث' ||
    docWithOptionals.titleEn !== 'Updated Environmental Law' ||
    docWithOptionals.originalTitle !== 'Original Law Title 2026' ||
    docWithOptionals.authorMetadataAr !== 'اللجنة الوطنية للبيئة' ||
    docWithOptionals.authorMetadataEn !== 'National Environment Committee' ||
    docWithOptionals.topicsAr.join(',') !== 'تشريعات,مناخ' ||
    docWithOptionals.topicsEn.join(',') !== 'Legislation,Climate' ||
    docWithOptionals.environmentalDomains.join(',') !== 'LawAndPolicy'
  ) {
    throw new Error('Assertion failed: valid metadata update with explicit optional strings');
  }
  assertions++;

  const afterNullOptionals = await service.updateMetadata(
    doc2.id,
    {
      titleEn: 'Updated Environmental Law v2',
      originalTitle: null as any,
      authorMetadataAr: null as any,
      authorMetadataEn: undefined,
    },
    editorAdmin
  );
  if (
    afterNullOptionals.titleEn !== 'Updated Environmental Law v2' ||
    afterNullOptionals.originalTitle !== 'Original Law Title 2026' ||
    afterNullOptionals.authorMetadataAr !== 'اللجنة الوطنية للبيئة' ||
    afterNullOptionals.authorMetadataEn !== 'National Environment Committee'
  ) {
    throw new Error('Assertion failed: null/undefined optional fields must not throw or erase existing values');
  }
  assertions++;

  // 2. Invalid required strings, invalid optional types, and invalid array elements reject early
  //    with VALIDATION_ERROR (400) and perform ZERO mutation on the stored document.
  const snapshotBeforeInvalid = JSON.stringify(await service.getById(doc2.id));
  const invalidPayloads: Array<{ label: string; payload: any }> = [
    { label: 'null updates object', payload: null },
    { label: 'array updates object', payload: [] },
    { label: 'null titleAr', payload: { titleAr: null } },
    { label: 'empty titleEn', payload: { titleEn: '   ' } },
    { label: 'null organizationId', payload: { organizationId: null } },
    { label: 'empty sourceId', payload: { sourceId: '' } },
    { label: 'null geographyAr', payload: { geographyAr: null } },
    { label: 'empty geographyEn', payload: { geographyEn: '  ' } },
    { label: 'null publicationDate', payload: { publicationDate: null } },
    { label: 'invalid publicationDate', payload: { publicationDate: 'not-a-valid-date' } },
    { label: 'null summaryAr', payload: { summaryAr: null } },
    { label: 'empty summaryEn', payload: { summaryEn: '   ' } },
    { label: 'null legalStatusDescriptionAr', payload: { legalStatusDescriptionAr: null } },
    { label: 'empty legalStatusDescriptionEn', payload: { legalStatusDescriptionEn: '' } },
    { label: 'invalid documentType', payload: { documentType: 'NotAType' } },
    { label: 'null language', payload: { language: null } },
    { label: 'invalid language', payload: { language: 'fr' } },
    { label: 'non-string optional originalTitle', payload: { originalTitle: 12345 } },
    { label: 'non-string optional authorMetadataAr', payload: { authorMetadataAr: { bad: true } } },
    { label: 'non-array topicsAr', payload: { topicsAr: 'not-an-array' } },
    { label: 'null element in topicsAr', payload: { topicsAr: ['مناخ', null] } },
    { label: 'empty element in topicsEn', payload: { topicsEn: ['Climate', '   '] } },
    { label: 'non-string element in environmentalDomains', payload: { environmentalDomains: [123] } },
  ];

  for (const testCase of invalidPayloads) {
    let rejectedWithValidation = false;
    try {
      await service.updateMetadata(doc2.id, testCase.payload, editorAdmin);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.startsWith('VALIDATION_ERROR')) {
        rejectedWithValidation = true;
      } else {
        throw new Error(`Expected VALIDATION_ERROR for ${testCase.label}, got: ${err?.message || err}`);
      }
    }
    if (!rejectedWithValidation) {
      throw new Error(`Assertion failed: ${testCase.label} was not rejected`);
    }
    const snapshotAfterInvalid = JSON.stringify(await service.getById(doc2.id));
    if (snapshotAfterInvalid !== snapshotBeforeInvalid) {
      throw new Error(`Assertion failed: document mutated after failed input (${testCase.label})`);
    }
    assertions++;
  }

  // 3. qcat- private quarantine catalog draft metadata-only update vs locked rights/workflow/version mutations
  //    compared against normal doc- document.
  const qcatId = 'qcat-0123456789abcdef0123456789abcdef';
  if (!isQuarantineCatalogDocumentId(qcatId) || isQuarantineCatalogDocumentId(doc2.id)) {
    throw new Error('Assertion failed: isQuarantineCatalogDocumentId classification');
  }
  assertions++;

  const initialQcatDoc: LibraryDocument = {
    id: qcatId,
    titleAr: 'مسودة فهرسة محجورة أولية',
    titleEn: 'Initial Quarantine Catalog Draft',
    documentType: LibraryDocumentType.InstitutionalReport,
    organizationId: 'o1',
    sourceId: 's1',
    geographyAr: 'السودان',
    geographyEn: 'Sudan',
    publicationDate: '2026-05-01',
    language: 'ar',
    summaryAr: 'ملخص أولي لمسودة الفهرسة',
    summaryEn: 'Initial summary for quarantine catalog draft',
    topicsAr: ['تنوع حيوي'],
    topicsEn: ['Biodiversity'],
    environmentalDomains: ['Biodiversity'],
    rightsStatus: LibraryRightsStatus.ReviewRequired,
    rightsNotesAr: 'قيد المراجعة البشرية للحقوق',
    rightsNotesEn: 'Pending human rights review',
    workflowState: WorkflowState.Draft,
    workflowHistory: [],
    legalStatusDescriptionAr: 'سجل وصفي داخلي قيد المراجعة',
    legalStatusDescriptionEn: 'Internal descriptive record under review',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    versions: [
      {
        id: 'ver-qcat-1',
        documentId: qcatId,
        versionNumber: '1.0',
        publishedDate: '2026-05-01',
        changeDescriptionAr: 'إنشاء مسودة الفهرسة الداخلية',
        changeDescriptionEn: 'Initial internal catalog draft created',
      },
    ],
  };
  await repo.create(initialQcatDoc);

  // Update metadata on qcat- with null optional fields and attempted smuggled privileged fields
  const updatedQcat = await service.updateMetadata(
    qcatId,
    {
      titleAr: 'مسودة فهرسة محجورة محدثة',
      titleEn: 'Updated Quarantine Catalog Draft',
      summaryAr: 'ملخص محدث بعد المراجعة الوصفية',
      summaryEn: 'Updated summary after descriptive review',
      originalTitle: null as any,
      authorMetadataAr: null as any,
      authorMetadataEn: null as any,
      rightsStatus: LibraryRightsStatus.OpenPubliclyAvailable,
      workflowState: WorkflowState.Published,
      versions: [],
      workflowHistory: [{ id: 'tamper' }],
    } as any,
    editorAdmin
  );

  if (
    updatedQcat.titleAr !== 'مسودة فهرسة محجورة محدثة' ||
    updatedQcat.titleEn !== 'Updated Quarantine Catalog Draft' ||
    updatedQcat.summaryAr !== 'ملخص محدث بعد المراجعة الوصفية' ||
    updatedQcat.summaryEn !== 'Updated summary after descriptive review' ||
    updatedQcat.rightsStatus !== LibraryRightsStatus.ReviewRequired ||
    updatedQcat.workflowState !== WorkflowState.Draft ||
    updatedQcat.workflowHistory.length !== 0 ||
    updatedQcat.versions.length !== 1 ||
    updatedQcat.versions[0].versionNumber !== '1.0' ||
    'referenceUrl' in updatedQcat.versions[0]
  ) {
    throw new Error('Assertion failed: qcat- metadata update must preserve Draft, ReviewRequired, versions, and workflowHistory');
  }
  assertions++;

  // Compare: normal doc- allows updateRights, transitionWorkflow, and addVersion,
  // whereas qcat- strictly rejects all three without mutating persisted state.
  await service.updateRights(doc2.id, LibraryRightsStatus.PermissionGranted, 'مسموح', 'Permitted', fullAdmin);
  await service.transitionWorkflow(doc2.id, WorkflowState.InReview, 'Ready for review', editorAdmin);
  await service.addVersion(
    doc2.id,
    {
      versionNumber: '1.1',
      publishedDate: '2026-05-02',
      changeDescriptionAr: 'إصدار محدث',
      changeDescriptionEn: 'Updated version',
    },
    editorAdmin
  );
  const updatedDoc2 = await service.getById(doc2.id);
  if (
    updatedDoc2?.rightsStatus !== LibraryRightsStatus.PermissionGranted ||
    updatedDoc2?.workflowState !== WorkflowState.InReview ||
    updatedDoc2?.versions.length !== 2
  ) {
    throw new Error('Assertion failed: normal doc- should allow rights, workflow, and version updates');
  }
  assertions++;

  const qcatSnapshotBeforeLockedOps = JSON.stringify(await service.getById(qcatId));

  try {
    await service.updateRights(qcatId, LibraryRightsStatus.OpenPubliclyAvailable, '', '', fullAdmin);
    throw new Error('fail');
  } catch (err: any) {
    if (!err.message.includes('INVALID_ARGUMENT') || !err.message.includes('ReviewRequired')) {
      throw err;
    }
    assertions++;
  }

  try {
    await service.transitionWorkflow(qcatId, WorkflowState.InReview, '', editorAdmin);
    throw new Error('fail');
  } catch (err: any) {
    if (!err.message.includes('INVALID_TRANSITION') || !err.message.includes('Draft')) {
      throw err;
    }
    assertions++;
  }

  try {
    await service.addVersion(
      qcatId,
      {
        versionNumber: '1.1',
        publishedDate: '2026-05-02',
        changeDescriptionAr: 'محاولة إضافة إصدار',
        changeDescriptionEn: 'Attempt version add',
      },
      editorAdmin
    );
    throw new Error('fail');
  } catch (err: any) {
    if (!err.message.includes('VALIDATION_ERROR') || !err.message.includes('quarantine catalog draft')) {
      throw err;
    }
    assertions++;
  }

  if (JSON.stringify(await service.getById(qcatId)) !== qcatSnapshotBeforeLockedOps) {
    throw new Error('Assertion failed: qcat- document mutated after rejected rights/workflow/version operations');
  }
  assertions++;

  // 4. Sparse metadata payload helper & single-write modal/parent contract verification
  const sparseFromNullOptionals = buildSparseLibraryMetadataUpdatePayload(
    {
      ...initialQcatDoc,
      titleAr: '  عنوان معدل  ',
      originalTitle: null as any,
      authorMetadataAr: undefined,
      authorMetadataEn: null as any,
    },
    initialQcatDoc
  );
  if (
    sparseFromNullOptionals.titleAr !== 'عنوان معدل' ||
    'originalTitle' in sparseFromNullOptionals ||
    'authorMetadataAr' in sparseFromNullOptionals ||
    'authorMetadataEn' in sparseFromNullOptionals
  ) {
    throw new Error('Assertion failed: buildSparseLibraryMetadataUpdatePayload must omit null/undefined optional fields');
  }
  assertions++;

  const sparseWithExplicitOptionals = buildSparseLibraryMetadataUpdatePayload(
    {
      ...initialQcatDoc,
      originalTitle: '  Original Title  ',
      authorMetadataAr: '  مؤلف  ',
      authorMetadataEn: '  Author  ',
    },
    initialQcatDoc
  );
  if (
    sparseWithExplicitOptionals.originalTitle !== 'Original Title' ||
    sparseWithExplicitOptionals.authorMetadataAr !== 'مؤلف' ||
    sparseWithExplicitOptionals.authorMetadataEn !== 'Author'
  ) {
    throw new Error('Assertion failed: buildSparseLibraryMetadataUpdatePayload must include trimmed string optionals');
  }
  assertions++;

  // Verify AdminLibraryManagement.tsx does not call LibraryAdminClient.updateMetadata in handleSaveDocument
  const adminMgmtSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/library/AdminLibraryManagement.tsx'),
    'utf8'
  );
  if (adminMgmtSource.includes('LibraryAdminClient.updateMetadata(')) {
    throw new Error('Assertion failed: AdminLibraryManagement.tsx must not issue a duplicate LibraryAdminClient.updateMetadata call');
  }
  assertions++;

  const editorModalSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/library/LibraryDocumentEditorModal.tsx'),
    'utf8'
  );
  if (
    !editorModalSource.includes('isQuarantineCatalogDocumentId') ||
    !editorModalSource.includes('quarantine-catalog-draft-rights-readonly') ||
    !editorModalSource.includes('quarantine-catalog-draft-workflow-readonly') ||
    !editorModalSource.includes('quarantine-catalog-draft-versions-readonly')
  ) {
    throw new Error('Assertion failed: LibraryDocumentEditorModal.tsx must enforce qcat- read-only rights/workflow/versions UI');
  }
  assertions++;

  console.log('Handler coverage unavailable without Firebase runtime.');

  console.log(`TOTAL REAL ASSERTIONS: ${assertions}`);
  console.log(`PASSED: ${assertions}`);
  console.log(`FAILED: 0`);
  console.log(`EXIT CODE: 0`);
}
runTests().catch((err) => { console.error(err); process.exit(1); });

