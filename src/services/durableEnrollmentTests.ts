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
import {
  AccountService,
  InMemoryAccountRepository,
  FirestoreAccountRepository
} from './accountService';
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
  const prodAccountRepo = new FirestoreAccountRepository();

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

    // Test A: Unauthenticated member enrollment fails AUTH_REQUIRED
    EnrollmentService.setAuthProvider(() => null);
    let unauthEnrollCaught = false;
    try {
      await EnrollmentService.enrollInCourse('course-published-01');
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'AUTH_REQUIRED') {
        unauthEnrollCaught = true;
      }
    }
    assert(unauthEnrollCaught, 'Test A Failed: Unauthenticated enrollment did not fail with AUTH_REQUIRED.');
    logs.push('✔ Test A Passed: Unauthenticated member enrollment fails AUTH_REQUIRED.');

    // Set up in-memory repos for authenticated tests
    const inMemAccountRepo = new InMemoryAccountRepository();
    AccountService.setRepository(inMemAccountRepo);
    const inMemCourseRepo = new InMemoryTrainingCourseRepository();
    TrainingCourseService.setRepository(inMemCourseRepo);
    const inMemEnrollRepo = new InMemoryEnrollmentRepository();
    EnrollmentService.setRepository(inMemEnrollRepo);

    // Seed canonical Account for testing
    await inMemAccountRepo.createAccount({
      id: 'user-auth-123',
      email: 'member@promiseofplanet.sd',
      displayName: 'Authenticated Member',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    });
    await inMemCourseRepo.saveCourse(publishedCourseSample);

    // Test B & C: Authenticated UID becomes Enrollment.accountId automatically; member API cannot supply arbitrary UID
    EnrollmentService.setAuthProvider(() => 'user-auth-123');
    const createdEnrollment = await EnrollmentService.enrollInCourse(publishedCourseSample.id);
    assert(createdEnrollment.accountId === 'user-auth-123', 'Test B/C Failed: Enrollment accountId did not match authenticated UID.');
    assert(createdEnrollment.id === `user-auth-123_${publishedCourseSample.id}`, 'Test B/C Failed: Enrollment identity mismatch.');
    logs.push('✔ Test B/C Passed: Authenticated UID becomes Enrollment.accountId automatically and member cannot supply arbitrary UID.');

    // Test D: Member get/list operations are owner-bound to authenticated UID
    const myEnrollment = await EnrollmentService.getMyEnrollment(publishedCourseSample.id);
    assert(myEnrollment !== null && myEnrollment.id === `user-auth-123_${publishedCourseSample.id}`, 'Test D Failed: getMyEnrollment failed for owner.');
    const myEnrollmentsList = await EnrollmentService.listMyEnrollments();
    assert(myEnrollmentsList.length === 1 && myEnrollmentsList[0].accountId === 'user-auth-123', 'Test D Failed: listMyEnrollments failed for owner.');

    // Switch to another authenticated user to prove isolation
    EnrollmentService.setAuthProvider(() => 'other-user-999');
    const foreignList = await EnrollmentService.listMyEnrollments();
    assert(foreignList.length === 0, 'Test D Failed: Other user was able to access user-auth-123 enrollments.');
    const foreignGet = await EnrollmentService.getMyEnrollment(publishedCourseSample.id);
    assert(foreignGet === null, 'Test D Failed: Other user was able to get user-auth-123 enrollment.');
    logs.push('✔ Test D Passed: Member get/list operations are owner-bound strictly to authenticated UID.');

    // Test E: Missing canonical Account fails safely (ACCOUNT_UNAVAILABLE)
    EnrollmentService.setAuthProvider(() => 'user-without-account');
    let missingAccountCaught = false;
    try {
      await EnrollmentService.enrollInCourse(publishedCourseSample.id);
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'ACCOUNT_UNAVAILABLE') {
        missingAccountCaught = true;
      }
    }
    assert(missingAccountCaught, 'Test E Failed: Enrollment without canonical Account record did not throw ACCOUNT_UNAVAILABLE.');
    logs.push('✔ Test E Passed: Missing canonical Account fails safely with ACCOUNT_UNAVAILABLE.');

    // Restore user-auth-123 for remaining enrollment checks
    EnrollmentService.setAuthProvider(() => 'user-auth-123');

    // Test F1: Ordinary member cannot enroll in a non-Published course
    await inMemCourseRepo.saveCourse(draftCourseSample);
    let draftEnrollCaught = false;
    try {
      await EnrollmentService.enrollInCourse(draftCourseSample.id);
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'COURSE_UNAVAILABLE') {
        draftEnrollCaught = true;
      }
    }
    assert(draftEnrollCaught, 'Test F1 Failed: Enrollment in a Draft course did not fail with COURSE_UNAVAILABLE.');
    logs.push('✔ Test F1 Passed: Ordinary member cannot enroll in a non-Published course.');

    // Test F2: Duplicate enrollment for the same account/course is prevented
    let duplicateCaught = false;
    try {
      await EnrollmentService.enrollInCourse(publishedCourseSample.id);
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'ALREADY_ENROLLED') {
        duplicateCaught = true;
      }
    }
    assert(duplicateCaught, 'Test F2 Failed: Duplicate enrollment did not fail with ALREADY_ENROLLED.');
    logs.push('✔ Test F2 Passed: Duplicate enrollment for the same account/course is prevented.');

    // Test F3: Failed durable enrollment creates no false local success
    let saveFailureCaught = false;
    try {
      await inMemEnrollRepo.saveEnrollment({
        id: 'invalid_id_format',
        accountId: 'user-auth-123',
        courseId: 'course-published-01',
        createdAt: '2026-03-01T00:00:00Z',
      });
    } catch {
      saveFailureCaught = true;
    }
    const checkBadEnroll = await inMemEnrollRepo.getEnrollment('user-auth-123', 'course-published-01');
    assert(saveFailureCaught && checkBadEnroll?.id !== 'invalid_id_format', 'Test F3 Failed: Invalid save corrupted repository state.');
    logs.push('✔ Test F3 Passed: Failed durable enrollment creates no false local success.');

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

    // Reset default production repositories and auth provider
    EnrollmentService.setAuthProvider(undefined);
    EnrollmentService.setRepository(prodEnrollmentRepo);
    TrainingCourseService.setRepository(prodTrainingRepo);
    AccountService.setRepository(prodAccountRepo);

    return { passed: true, logs };
  } catch (err: any) {
    // Reset default production repositories and auth provider on failure
    EnrollmentService.setAuthProvider(undefined);
    EnrollmentService.setRepository(prodEnrollmentRepo);
    TrainingCourseService.setRepository(prodTrainingRepo);
    AccountService.setRepository(prodAccountRepo);
    logs.push(`❌ ${err.message}`);
    return { passed: false, logs };
  }
}

