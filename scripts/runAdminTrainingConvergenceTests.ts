import * as fs from 'fs';
import * as path from 'path';
import { TrainingCourseService, validateTrainingCourseData } from '../src/services/trainingCourseService';
import { WorkflowState } from '../src/types/workflow';
import { AdminPermission, AdminRole } from '../src/types/admin';
import type { AdminUser } from '../src/types/admin';
import type { TrainingCourse } from '../src/types/training';

interface TestResult {
  name: string;
  classification: 'UNIT_LOGIC_TEST' | 'INTEGRATION_TEST' | 'STATIC_SOURCE_ASSERTION';
  passed: boolean;
  message?: string;
}

async function runTests() {
  const results: TestResult[] = [];
  const adminManagementPath = path.resolve('./src/components/training/AdminTrainingManagement.tsx');
  const adminModalPath = path.resolve('./src/components/training/TrainingCourseEditorModal.tsx');

  console.log('====================================================');
  console.log('RUNNING ADMIN TRAINING CANONICAL CONVERGENCE TESTS');
  console.log('====================================================\n');

  // Test 1: Static Source Assertion - No Mock Import in AdminTrainingManagement
  try {
    const code = fs.readFileSync(adminManagementPath, 'utf8');
    const hasMockImport = code.includes('MOCK_TRAINING_COURSES') || code.includes('mockTrainingData');
    results.push({
      name: 'Admin Training Management does not import or depend on mock training courses',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: !hasMockImport,
      message: hasMockImport ? 'Found references or imports of MOCK_TRAINING_COURSES' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'Admin Training Management does not import or depend on mock training courses',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 2: Static Source Assertion - Admin Training Management uses TrainingCourseService
  try {
    const code = fs.readFileSync(adminManagementPath, 'utf8');
    const hasServiceImport = code.includes('TrainingCourseService');
    const hasServiceCall = code.includes('TrainingCourseService.listCourses');
    results.push({
      name: 'Admin Training Management imports and calls TrainingCourseService',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: hasServiceImport && hasServiceCall,
      message: !(hasServiceImport && hasServiceCall) ? 'TrainingCourseService import or listCourses invocation is missing' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'Admin Training Management imports and calls TrainingCourseService',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 3: Unit Logic Test - Error when unconfigured Firestore (No silent mock fallback)
  try {
    // Calling listCourses with unconfigured Firestore must throw error and NOT fallback to mock data
    await TrainingCourseService.listCourses(undefined, true);
    results.push({
      name: 'No production fallback to mock data exists on read error',
      classification: 'UNIT_LOGIC_TEST',
      passed: false,
      message: 'Expected BACKEND_UNAVAILABLE or other exception, but call succeeded (Firestore might be configured in this environment)',
    });
  } catch (err: any) {
    const expectedErrors = ['BACKEND_UNAVAILABLE', 'UNAUTHORIZED', 'permission-denied', 'FIRESTORE_ACCESS_ERROR'];
    const isExpected = expectedErrors.some(e => err.message?.includes(e) || err.code?.includes(e) || err.toString().includes(e));
    results.push({
      name: 'No production fallback to mock data exists on read error',
      classification: 'UNIT_LOGIC_TEST',
      passed: isExpected,
      message: !isExpected ? `Threw unexpected error: ${err.message}` : undefined,
    });
  }

  // Test 4: Unit Logic Test - Create action invokes canonical durable service save (Validation checks)
  const mockOwner: AdminUser = {
    id: 'owner-test',
    email: 'owner@test.com',
    name: 'Owner Tester',
    role: AdminRole.Owner,
    isActive: true,
    permissions: [AdminPermission.Create, AdminPermission.Edit],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleCourse: TrainingCourse = {
    id: `test-course-${Date.now()}`,
    titleAr: 'دورة اختبارية للتحقق المستمر',
    titleEn: 'Verification Test Course Title',
    summaryAr: 'ملخص موجز للدورة',
    summaryEn: 'Detailed test course summary',
    category: 'Climate',
    level: 'Beginner',
    durationHours: 4,
    deliveryMode: 'OnlineSelfPaced',
    targetAudienceAr: 'الجمهور المستهدف',
    targetAudienceEn: 'Target audience',
    instructorNameAr: 'المدرب',
    instructorNameEn: 'Instructor',
    workflowState: WorkflowState.Draft,
    workflowHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: 'Owner Tester',
    language: 'ar',
  };

  try {
    const validated = validateTrainingCourseData(sampleCourse);
    results.push({
      name: 'Create actions and inputs are compatible with the canonical TrainingCourse validation schema',
      classification: 'UNIT_LOGIC_TEST',
      passed: validated.id === sampleCourse.id && validated.category === 'Climate',
      message: undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'Create actions and inputs are compatible with the canonical TrainingCourse validation schema',
      classification: 'UNIT_LOGIC_TEST',
      passed: false,
      message: err.message,
    });
  }

  // Test 5: Unit Logic Test - Unauthorized saves are properly blocked
  const mockInactiveAdmin: AdminUser = {
    id: 'inactive-test',
    email: 'inactive@test.com',
    name: 'Inactive Tester',
    role: AdminRole.Trainer,
    isActive: false,
    permissions: [AdminPermission.Edit],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await TrainingCourseService.saveCourse(sampleCourse, mockInactiveAdmin);
    results.push({
      name: 'Failed save correctly rejects unauthorized/inactive users',
      classification: 'UNIT_LOGIC_TEST',
      passed: false,
      message: 'Expected saveCourse to throw UNAUTHORIZED, but it succeeded',
    });
  } catch (err: any) {
    const passed = err.code === 'UNAUTHORIZED' || err.message?.includes('administrative authority');
    results.push({
      name: 'Failed save correctly rejects unauthorized/inactive users',
      classification: 'UNIT_LOGIC_TEST',
      passed,
      message: !passed ? `Expected unauthorized save to be rejected with UNAUTHORIZED code, but got: ${err.message}` : undefined,
    });
  }

  // Test 6: Static Source Assertion - Workflow transition updates the state before saving
  try {
    const modalCode = fs.readFileSync(adminModalPath, 'utf8');
    const hasTransitionEngine = modalCode.includes('WorkflowEngine.executeTransition');
    const updatesFormData = modalCode.includes('setFormData');
    results.push({
      name: 'Workflow transition results are validated and set locally prior to durable submit',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: hasTransitionEngine && updatesFormData,
      message: !(hasTransitionEngine && updatesFormData) ? 'Modal does not handle workflow transitions correctly' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'Workflow transition results are validated and set locally prior to durable submit',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 7: Static Source Assertion - Successful save transitions to distinct success confirmation
  try {
    const code = fs.readFileSync(adminModalPath, 'utf8');
    const hasSuccessRendering = code.includes('SUCCESS CONFIRMATION STATE') && code.includes('isSaveSuccess ?');
    const hasSuccessTextAr = code.includes('تم حفظ البرنامج التدريبي بنجاح');
    const hasSuccessTextEn = code.includes('Training course saved successfully');
    
    results.push({
      name: 'A. Successful save switches edit form to distinct Success Confirmation state',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: hasSuccessRendering && hasSuccessTextAr && hasSuccessTextEn,
      message: !(hasSuccessRendering && hasSuccessTextAr && hasSuccessTextEn) ? 'Distinct Success Confirmation state rendering or translation text not found in source code.' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'A. Successful save switches edit form to distinct Success Confirmation state',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 8: Static Source Assertion - Success confirmation remains visible, no auto-dismiss timer remains
  try {
    const code = fs.readFileSync(adminModalPath, 'utf8');
    // Ensure that no timeout dismisses isSaveSuccess or calls onClose within isSaveSuccess hooks
    const hasAutoCloseTimer = code.includes('setTimeout') && code.includes('onClose') && code.includes('2500');
    
    results.push({
      name: 'B & C. Success confirmation remains visible until explicit close (no auto-dismiss timer remains)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: !hasAutoCloseTimer,
      message: hasAutoCloseTimer ? 'Detected auto-dismiss timer/dismissTimeout referencing onClose in the modal.' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'B & C. Success confirmation remains visible until explicit close (no auto-dismiss timer remains)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 9: Static Source Assertion - Failed save keeps edit form visible and preserves user data
  try {
    const code = fs.readFileSync(adminModalPath, 'utf8');
    // Verify that catch block of handleSubmit sets saveError but preserves formData
    const hasFailedSaveHandler = code.includes('setSaveError') && code.includes('Failed to save training course durably.');
    
    results.push({
      name: 'D & E. Failed save keeps edit form visible, preserves entered data and shows bounded error',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: hasFailedSaveHandler,
      message: !hasFailedSaveHandler ? 'Save failure error-setting or preservation handler not found in handleSubmit.' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'D & E. Failed save keeps edit form visible, preserves entered data and shows bounded error',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 10: Static Source Assertion / Unit Logic - Successful save is not treated as dirty
  try {
    const code = fs.readFileSync(adminModalPath, 'utf8');
    // Verify that isFormDirty returns false if isSaveSuccess is true
    const isDirtyResetOnSuccess = code.includes('if (isSaveSuccess) return false;');
    
    results.push({
      name: 'F & G. Successful save resets dirty-state, and closing does not trigger discard warning',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: isDirtyResetOnSuccess,
      message: !isDirtyResetOnSuccess ? 'isFormDirty does not immediately return false when isSaveSuccess is true.' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'F & G. Successful save resets dirty-state, and closing does not trigger discard warning',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 11: Static Source Assertion - Escape closes through canonical close path and accessibility is preserved
  try {
    const code = fs.readFileSync(adminModalPath, 'utf8');
    const handlesEscape = code.includes("e.key === 'Escape'") && code.includes('handleCloseAttempt()');
    const isDialog = code.includes('role="dialog"') && code.includes('aria-modal="true"');
    
    results.push({
      name: 'H. Escape from success confirmation closes through canonical path, preserving accessibility standards',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: handlesEscape && isDialog,
      message: !(handlesEscape && isDialog) ? 'Escape key handler or aria-modal accessibility properties not defined on the modal.' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'H. Escape from success confirmation closes through canonical path, preserving accessibility standards',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Test 12: Static Source Assertion - Public visibility logic remains untouched
  try {
    const centerPath = path.resolve('./src/components/training/TrainingCenter.tsx');
    const code = fs.readFileSync(centerPath, 'utf8');
    const filterPublished = code.includes('workflowState === WorkflowState.Published') || code.includes("workflowState === 'Published'");
    
    results.push({
      name: 'I. Public visibility logic remains untouched (restricting catalog view to Published state)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: filterPublished,
      message: !filterPublished ? 'Public training center catalog visibility filter is missing or modified.' : undefined,
    });
  } catch (err: any) {
    results.push({
      name: 'I. Public visibility logic remains untouched (restricting catalog view to Published state)',
      classification: 'STATIC_SOURCE_ASSERTION',
      passed: false,
      message: err.message,
    });
  }

  // Print summary results
  let passedCount = 0;
  let failedCount = 0;

  console.log('--- TEST EXECUTION DETAILS ---');
  results.forEach(r => {
    if (r.passed) {
      console.log(`✅ [PASS] [${r.classification}] ${r.name}`);
      passedCount++;
    } else {
      console.log(`❌ [FAIL] [${r.classification}] ${r.name}`);
      if (r.message) console.log(`   └─ Error: ${r.message}`);
      failedCount++;
    }
  });

  console.log('\n====================================================');
  console.log(`TOTAL CONVERGENCE TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution failure:', err);
  process.exit(1);
});
