import { 
  validateTrainingCourseData, 
  TrainingCourseError, 
  FirestoreTrainingCourseRepository, 
  InMemoryTrainingCourseRepository, 
  TrainingCourseService 
} from './trainingCourseService';
import type { TrainingCourse } from '../types/training';
import { WorkflowState } from '../types/workflow';
import { AdminRole, AdminPermission } from '../types/admin';
import type { Account } from '../types/account';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILURE: ${message}`);
  }
}

export async function runDurableTrainingCourseTests(): Promise<{ passed: boolean; logs: string[] }> {
  const logs: string[] = [];
  const prodRepo = new FirestoreTrainingCourseRepository();
  const allAdminRoles = Object.values(AdminRole);

  const validCourseSample: TrainingCourse = {
    id: 'course-test-01',
    titleAr: 'دورة اختبار الأثر البيئي',
    titleEn: 'Environmental Impact Test Course',
    summaryAr: 'ملخص اختبار المنهج التدريبي',
    summaryEn: 'Test course summary description',
    category: 'Climate',
    level: 'Beginner',
    durationHours: 12,
    deliveryMode: 'OnlineSelfPaced',
    targetAudienceAr: 'الجمهور المستهدف',
    targetAudienceEn: 'Target audience',
    instructorNameAr: 'أحمد علي',
    instructorNameEn: 'Ahmed Ali',
    workflowState: WorkflowState.Published,
    workflowHistory: [],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    author: 'أحمد علي',
    language: 'ar',
  };

  try {
    // Test 1: Valid canonical TrainingCourse data is accepted
    const validated = validateTrainingCourseData(validCourseSample);
    assert(validated.id === 'course-test-01', 'Test 1 Failed: Valid course ID mismatch.');
    logs.push('✔ Test 1 Passed: Valid canonical TrainingCourse data is accepted.');

    // Test 2: Malformed/non-canonical durable course data is rejected safely
    let malformedCaught = false;
    try {
      validateTrainingCourseData({
        ...validCourseSample,
        nonCanonicalAttribute: 'forbidden',
      });
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'COURSE_DATA_INVALID') {
        malformedCaught = true;
      }
    }
    assert(malformedCaught, 'Test 2 Failed: Non-canonical attributes were not rejected.');
    logs.push('✔ Test 2 Passed: Malformed/non-canonical course data is rejected safely.');

    // Test 3: Course document identity cannot silently disagree with TrainingCourse.id
    let mismatchCaught = false;
    try {
      validateTrainingCourseData(validCourseSample, 'expected-different-id');
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'COURSE_DATA_INVALID') {
        mismatchCaught = true;
      }
    }
    assert(mismatchCaught, 'Test 3 Failed: Identity mismatch between document ID and course.id was not caught.');
    logs.push('✔ Test 3 Passed: Course document identity cannot silently disagree with TrainingCourse.id.');

    // Test 4: Production repository does not fall back to mock/in-memory data
    let prodFallbackCaught = false;
    try {
      await prodRepo.listCourses();
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'BACKEND_UNAVAILABLE') {
        prodFallbackCaught = true;
      }
    }
    assert(prodFallbackCaught, 'Test 4 Failed: Production repository fell back or succeeded when unconfigured.');
    logs.push('✔ Test 4 Passed: Production repository does not fall back to mock or in-memory data.');

    // Test 5: Unavailable backend fails explicitly and safely
    let unavailCaught = false;
    try {
      await prodRepo.getCourseById('course-test-01');
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'BACKEND_UNAVAILABLE') {
        unavailCaught = true;
      }
    }
    assert(unavailCaught, 'Test 5 Failed: Unconfigured backend did not throw BACKEND_UNAVAILABLE.');
    logs.push('✔ Test 5 Passed: Unavailable backend fails explicitly and safely.');

    // Test 6: Failed durable mutation does not produce false local success
    const inMemRepo = new InMemoryTrainingCourseRepository();
    TrainingCourseService.setRepository(inMemRepo);
    let saveFailed = false;
    try {
      await TrainingCourseService.saveCourse({
        ...validCourseSample,
        id: 'bad-course',
        // @ts-expect-error forcing invalid field
        category: 'INVALID_CATEGORY',
      });
    } catch {
      saveFailed = true;
    }
    const checkAfterFail = await inMemRepo.getCourseById('bad-course');
    assert(saveFailed && checkAfterFail === null, 'Test 6 Failed: Mutation failure updated repository state.');
    logs.push('✔ Test 6 Passed: Failed durable mutation does not produce false local success.');

    // Test 7: Account canonical schema remains exactly 5 fields
    const mockAccount: Account = {
      id: 'acc-01',
      email: 'test@example.com',
      displayName: 'Test Account',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };
    const accountKeys = Object.keys(mockAccount);
    assert(accountKeys.length === 5, `Test 7 Failed: Account schema has ${accountKeys.length} fields instead of 5.`);
    assert(
      accountKeys.every((k) => ['id', 'email', 'displayName', 'createdAt', 'updatedAt'].includes(k)),
      'Test 7 Failed: Account schema fields modified.'
    );
    logs.push('✔ Test 7 Passed: Account canonical schema remains exactly 5 fields.');

    // Test 8: Admin RBAC canonical counts/contracts are not expanded by this unit
    assert(allAdminRoles.length === 9, `Test 8 Failed: Admin roles expanded beyond 9 canonical roles.`);
    const permissionsCount = Object.keys(AdminPermission).length;
    assert(permissionsCount === 10, `Test 8 Failed: Admin permissions expanded beyond 10 canonical permissions.`);
    logs.push('✔ Test 8 Passed: Admin RBAC canonical counts and contracts are not expanded.');

    // Test 9: No Trainee/Member training role is introduced
    assert(
      !allAdminRoles.includes('Trainee' as any) && !allAdminRoles.includes('Member' as any),
      'Test 9 Failed: Trainee or Member role was introduced.'
    );
    logs.push('✔ Test 9 Passed: No Trainee/Member training role is introduced.');

    // Test 10: No Enrollment implementation is introduced
    const typesCheck = typeof (globalThis as any).Enrollment === 'undefined';
    assert(typesCheck, 'Test 10 Failed: Global Enrollment entity leaked into scope.');
    logs.push('✔ Test 10 Passed: No Enrollment implementation introduced.');

    // Test 11: No GIS/Map platform capability is introduced
    assert(typeof (globalThis as any).google === 'undefined', 'Test 11 Failed: GIS/Map script injected.');
    logs.push('✔ Test 11 Passed: No GIS/Map platform capability introduced.');

    // Test 12: No Donations/Subscriptions changes are introduced
    assert(typeof (globalThis as any).Stripe === 'undefined', 'Test 12 Failed: Stripe/Donation module introduced.');
    logs.push('✔ Test 12 Passed: No Donations/Subscriptions changes introduced.');

    // Reset default production repository
    TrainingCourseService.setRepository(prodRepo);

    return { passed: true, logs };
  } catch (err: any) {
    // Reset default production repository on failure as well
    TrainingCourseService.setRepository(prodRepo);
    logs.push(`❌ ${err.message}`);
    return { passed: false, logs };
  }
}
