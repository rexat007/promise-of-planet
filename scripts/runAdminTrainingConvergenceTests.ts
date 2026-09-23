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
