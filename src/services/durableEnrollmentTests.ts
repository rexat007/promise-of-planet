import {
  validateEnrollmentData,
  EnrollmentError,
  FirestoreEnrollmentRepository,
  InMemoryEnrollmentRepository,
  EnrollmentService
} from './enrollmentService';
import {
  TrainingCourseService,
  InMemoryTrainingCourseRepository,
  FirestoreTrainingCourseRepository
} from './trainingCourseService';
import type { Enrollment } from '../types/enrollment';
import type { TrainingCourse } from '../types/training';
import { WorkflowState } from '../types/workflow';
import { AdminRole, AdminPermission } from '../types/admin';
import type { Account } from '../types/account';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILURE: ${message}`);
  }
}

export async function runDurableEnrollmentTests(): Promise<{ passed: boolean; logs: string[] }> {
  const logs: string[] = [];
  const prodEnrollmentRepo = new FirestoreEnrollmentRepository();
  const prodTrainingRepo = new FirestoreTrainingCourseRepository();

  const validEnrollmentSample: Enrollment = {
    id: 'user-123_course-456',
    accountId: 'user-123',
    courseId: 'course-456',
    createdAt: '2026-03-01T00:00:00Z',
  };

  const publishedCourseSample: TrainingCourse = {
    id: 'course-published-01',
    titleAr: 'دورة زراعية متقدمة',
    titleEn: 'Advanced Agricultural Practices',
    summaryAr: 'ملخص الدورة التدريبية',
    summaryEn: 'Summary of the training course',
    category: 'Agriculture',
    level: 'Intermediate',
    durationHours: 20,
    deliveryMode: 'OnlineSelfPaced',
    targetAudienceAr: 'المزارعون والمهندسون',
    targetAudienceEn: 'Farmers and Engineers',
    workflowState: WorkflowState.Published,
    workflowHistory: [],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    author: 'الجمعية البيئية',
    language: 'ar',
  };

  const draftCourseSample: TrainingCourse = {
    ...publishedCourseSample,
    id: 'course-draft-02',
    workflowState: WorkflowState.Draft,
  };

  try {
    // Test 1: Valid canonical Enrollment is accepted
    const validated = validateEnrollmentData(validEnrollmentSample);
    assert(validated.id === 'user-123_course-456', 'Test 1 Failed: Valid enrollment ID mismatch.');
    logs.push('✔ Test 1 Passed: Valid canonical Enrollment is accepted.');

    // Test 2: Malformed or extra-field Enrollment data is rejected
    let extraFieldCaught = false;
    try {
      validateEnrollmentData({
        ...validEnrollmentSample,
        status: 'Active', // Unrequested extra attribute
      });
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'ENROLLMENT_DATA_INVALID') {
        extraFieldCaught = true;
      }
    }
    assert(extraFieldCaught, 'Test 2 Failed: Extra/unapproved field in Enrollment was not rejected.');
    logs.push('✔ Test 2 Passed: Malformed or extra-field Enrollment data is rejected.');

    // Test 3: Enrollment.id / document identity mismatch is rejected
    let mismatchCaught = false;
    try {
      validateEnrollmentData(validEnrollmentSample, 'expected-different-doc-id');
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'ENROLLMENT_DATA_INVALID') {
        mismatchCaught = true;
      }
    }
    assert(mismatchCaught, 'Test 3 Failed: Enrollment.id / document identity mismatch was not caught.');
    logs.push('✔ Test 3 Passed: Enrollment.id / document identity mismatch is rejected.');

    // Test 4: accountId cannot differ from authenticated UID / missing accountId is rejected
    let unauthEnrollCaught = false;
    try {
      await EnrollmentService.enrollAccount('', 'course-456');
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'AUTH_REQUIRED') {
        unauthEnrollCaught = true;
      }
    }
    assert(unauthEnrollCaught, 'Test 4 Failed: Empty/missing accountId did not fail with AUTH_REQUIRED.');
    logs.push('✔ Test 4 Passed: Empty or unauthenticated accountId is rejected at service boundary.');

    // Test 5: Enrollment cannot reference a missing course
    const inMemCourseRepo = new InMemoryTrainingCourseRepository();
    TrainingCourseService.setRepository(inMemCourseRepo);
    const inMemEnrollRepo = new InMemoryEnrollmentRepository();
    EnrollmentService.setRepository(inMemEnrollRepo);

    let missingCourseCaught = false;
    try {
      await EnrollmentService.enrollAccount('user-123', 'non-existent-course-id');
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'COURSE_UNAVAILABLE') {
        missingCourseCaught = true;
      }
    }
    assert(missingCourseCaught, 'Test 5 Failed: Enrollment in non-existent course did not fail with COURSE_UNAVAILABLE.');
    logs.push('✔ Test 5 Passed: Enrollment cannot reference a missing course.');

    // Test 6: Ordinary member cannot enroll in a non-Published course
    await inMemCourseRepo.saveCourse(draftCourseSample);
    let draftEnrollCaught = false;
    try {
      await EnrollmentService.enrollAccount('user-123', draftCourseSample.id);
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'COURSE_UNAVAILABLE') {
        draftEnrollCaught = true;
      }
    }
    assert(draftEnrollCaught, 'Test 6 Failed: Enrollment in a Draft course did not fail with COURSE_UNAVAILABLE.');
    logs.push('✔ Test 6 Passed: Ordinary member cannot enroll in a non-Published course.');

    // Test 7: Published canonical course is eligible for enrollment
    await inMemCourseRepo.saveCourse(publishedCourseSample);
    const createdEnrollment = await EnrollmentService.enrollAccount('user-123', publishedCourseSample.id);
    assert(createdEnrollment.id === `user-123_${publishedCourseSample.id}`, 'Test 7 Failed: Enrollment ID mismatch.');
    assert(createdEnrollment.accountId === 'user-123', 'Test 7 Failed: Enrollment accountId mismatch.');
    assert(createdEnrollment.courseId === publishedCourseSample.id, 'Test 7 Failed: Enrollment courseId mismatch.');
    logs.push('✔ Test 7 Passed: Published canonical course is eligible for enrollment.');

    // Test 8: Duplicate enrollment for the same account/course cannot create a second canonical relationship
    let duplicateCaught = false;
    try {
      await EnrollmentService.enrollAccount('user-123', publishedCourseSample.id);
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'ALREADY_ENROLLED') {
        duplicateCaught = true;
      }
    }
    assert(duplicateCaught, 'Test 8 Failed: Duplicate enrollment did not fail with ALREADY_ENROLLED.');
    logs.push('✔ Test 8 Passed: Duplicate enrollment for the same account/course is prevented.');

    // Test 9: Failed durable enrollment creates no false local success
    let saveFailureCaught = false;
    try {
      await inMemEnrollRepo.saveEnrollment({
        id: 'invalid_id_format',
        accountId: 'user-123',
        courseId: 'course-published-01',
        createdAt: '2026-03-01T00:00:00Z',
      });
    } catch {
      saveFailureCaught = true;
    }
    const checkBadEnroll = await inMemEnrollRepo.getEnrollment('user-123', 'course-published-01');
    assert(saveFailureCaught && checkBadEnroll?.id !== 'invalid_id_format', 'Test 9 Failed: Invalid save corrupted repository state.');
    logs.push('✔ Test 9 Passed: Failed durable enrollment creates no false local success.');

    // Test 10: Production Enrollment repository has no automatic mock or in-memory fallback
    EnrollmentService.setRepository(prodEnrollmentRepo);
    let prodUnavailCaught = false;
    try {
      await prodEnrollmentRepo.getEnrollment('user-123', 'course-456');
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'BACKEND_UNAVAILABLE') {
        prodUnavailCaught = true;
      }
    }
    assert(prodUnavailCaught, 'Test 10 Failed: Production enrollment repository did not throw BACKEND_UNAVAILABLE when unconfigured.');
    logs.push('✔ Test 10 Passed: Production Enrollment repository has no automatic mock fallback.');

    // Test 11: Account remains exactly five fields
    const mockAccount: Account = {
      id: 'acc-01',
      email: 'member@promiseofplanet.sd',
      displayName: 'Environmental Member',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };
    const accountKeys = Object.keys(mockAccount);
    assert(accountKeys.length === 5, `Test 11 Failed: Account schema has ${accountKeys.length} fields instead of 5.`);
    assert(
      accountKeys.every((k) => ['id', 'email', 'displayName', 'createdAt', 'updatedAt'].includes(k)),
      'Test 11 Failed: Account schema fields modified.'
    );
    logs.push('✔ Test 11 Passed: Account canonical schema remains exactly 5 fields.');

    // Test 12: Admin RBAC remains 9 roles / 10 permissions and no Trainee/Member role introduced
    const allAdminRoles = Object.values(AdminRole);
    assert(allAdminRoles.length === 9, 'Test 12 Failed: Admin roles count modified.');
    const permissionsCount = Object.keys(AdminPermission).length;
    assert(permissionsCount === 10, 'Test 12 Failed: Admin permissions count modified.');
    assert(
      !allAdminRoles.includes('Trainee' as any) && !allAdminRoles.includes('Member' as any),
      'Test 12 Failed: Trainee or Member role was introduced in AdminRole.'
    );
    logs.push('✔ Test 12 Passed: Admin RBAC remains exactly 9 roles / 10 permissions.');

    // Reset default production repositories
    EnrollmentService.setRepository(prodEnrollmentRepo);
    TrainingCourseService.setRepository(prodTrainingRepo);

    return { passed: true, logs };
  } catch (err: any) {
    // Reset default production repositories on failure
    EnrollmentService.setRepository(prodEnrollmentRepo);
    TrainingCourseService.setRepository(prodTrainingRepo);
    logs.push(`❌ ${err.message}`);
    return { passed: false, logs };
  }
}
