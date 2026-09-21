function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}
import { MemberTrainingAccessService } from './memberTrainingAccessService';
import {
  EnrollmentService,
  InMemoryEnrollmentRepository,
  FirestoreEnrollmentRepository,
  EnrollmentError
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
import type { TrainingCourse } from '../types/training';
import { WorkflowState } from '../types/workflow';
import { AdminRole, AdminPermission, ROLE_PERMISSIONS_MAP } from '../shared/adminContract';

export async function runMemberTrainingAccessTests(): Promise<{ passed: boolean; logs: string[] }> {
  const logs: string[] = [];

  const prodEnrollmentRepo = new FirestoreEnrollmentRepository();
  const prodTrainingRepo = new FirestoreTrainingCourseRepository();
  const prodAccountRepo = new FirestoreAccountRepository();

  const publishedCourseSample: TrainingCourse = {
    id: 'course-published-access-01',
    titleAr: 'دورة الوصول التدريبي المنشورة',
    titleEn: 'Published Access Test Course',
    summaryAr: 'ملخص الدورة المنشورة',
    summaryEn: 'Published course summary',
    category: 'Water',
    level: 'Beginner',
    durationHours: 10,
    deliveryMode: 'OnlineSelfPaced',
    targetAudienceAr: 'الجمهور المستهدف',
    targetAudienceEn: 'Target audience',
    workflowState: WorkflowState.Published,
    workflowHistory: [],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    author: 'Admin',
    language: 'ar',
  };

  const draftCourseSample: TrainingCourse = {
    id: 'course-draft-access-01',
    titleAr: 'دورة مسودة غير منشورة',
    titleEn: 'Draft Test Course',
    summaryAr: 'ملخص الدورة المسودة',
    summaryEn: 'Draft course summary',
    category: 'Climate',
    level: 'Intermediate',
    durationHours: 12,
    deliveryMode: 'LiveWorkshop',
    targetAudienceAr: 'الجمهور',
    targetAudienceEn: 'Audience',
    workflowState: WorkflowState.Draft,
    workflowHistory: [],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    author: 'Admin',
    language: 'ar',
  };

  try {
    // Set up in-memory repositories
    const inMemAccountRepo = new InMemoryAccountRepository();
    const inMemCourseRepo = new InMemoryTrainingCourseRepository();
    const inMemEnrollRepo = new InMemoryEnrollmentRepository();

    AccountService.setRepository(inMemAccountRepo);
    TrainingCourseService.setRepository(inMemCourseRepo);
    EnrollmentService.setRepository(inMemEnrollRepo);

    await inMemCourseRepo.saveCourse(publishedCourseSample);
    await inMemCourseRepo.saveCourse(draftCourseSample);

    // Test 1: Visitor cannot create enrollment
    MemberTrainingAccessService.setAuthProvider(() => null);
    EnrollmentService.setAuthProvider(() => null);

    const visitorAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(visitorAccess.status === 'unauthenticated', 'Test 1 Failed: Visitor access state was not unauthenticated.');
    assert(visitorAccess.enrollment === null, 'Test 1 Failed: Visitor access returned non-null enrollment.');

    let visitorEnrollFailed = false;
    try {
      await EnrollmentService.enrollInCourse(publishedCourseSample.id);
    } catch (e: any) {
      if (e instanceof EnrollmentError && e.code === 'AUTH_REQUIRED') {
        visitorEnrollFailed = true;
      }
    }
    assert(visitorEnrollFailed, 'Test 1 Failed: Visitor enrollment did not fail with AUTH_REQUIRED.');
    logs.push('✔ Test 1 Passed: Visitor cannot create enrollment (unauthenticated state enforced).');

    // Seed canonical Account for member testing
    await inMemAccountRepo.createAccount({
      id: 'member-user-101',
      email: 'member101@promiseofplanet.sd',
      displayName: 'Member One Hundred One',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    });

    // Test 2: Authenticated canonical Account with no Enrollment resolves as not_enrolled
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-101');
    EnrollmentService.setAuthProvider(() => 'member-user-101');

    const notEnrolledAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(notEnrolledAccess.status === 'not_enrolled', 'Test 2 Failed: Authenticated account without enrollment did not resolve as not_enrolled.');
    assert(notEnrolledAccess.account?.id === 'member-user-101', 'Test 2 Failed: Account profile missing in not_enrolled state.');
    assert(notEnrolledAccess.enrollment === null, 'Test 2 Failed: Enrollment should be null in not_enrolled state.');
    logs.push('✔ Test 2 Passed: Authenticated canonical Account with no Enrollment resolves as not_enrolled.');

    // Test 3: Successful canonical enrollment resolves as enrolled
    const enrollResult = await MemberTrainingAccessService.requestEnrollment(publishedCourseSample.id);
    assert(enrollResult.status === 'enrolled', 'Test 3 Failed: Enrollment request did not resolve to enrolled status.');
    assert(enrollResult.enrollment !== null, 'Test 3 Failed: Enrollment object was null after enrollment.');
    assert(enrollResult.enrollment?.accountId === 'member-user-101', 'Test 3 Failed: Enrollment accountId mismatch.');
    assert(enrollResult.enrollment?.id === `member-user-101_${publishedCourseSample.id}`, 'Test 3 Failed: Enrollment ID mismatch.');
    logs.push('✔ Test 3 Passed: Successful canonical enrollment resolves as enrolled.');

    // Test 4: Existing Enrollment resolves as enrolled without creating a duplicate
    const recheckAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(recheckAccess.status === 'enrolled', 'Test 4 Failed: Rechecking existing enrollment did not resolve to enrolled.');
    assert(recheckAccess.enrollment?.id === `member-user-101_${publishedCourseSample.id}`, 'Test 4 Failed: Rechecked enrollment ID mismatch.');

    const duplicateReq = await MemberTrainingAccessService.requestEnrollment(publishedCourseSample.id);
    assert(duplicateReq.status === 'enrolled', 'Test 4 Failed: Duplicate request altered enrolled status.');
    assert(duplicateReq.error?.code === 'ALREADY_ENROLLED', 'Test 4 Failed: Duplicate request did not capture ALREADY_ENROLLED error.');
    logs.push('✔ Test 4 Passed: Existing Enrollment resolves as enrolled without creating a duplicate.');

    // Test 5: Failed enrollment does not produce false enrolled UI state
    // Create a new account with no course enrollment
    await inMemAccountRepo.createAccount({
      id: 'member-user-202',
      email: 'member202@promiseofplanet.sd',
      displayName: 'Member Two Hundred Two',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    });
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-202');
    EnrollmentService.setAuthProvider(() => 'member-user-202');

    // Attempt enrollment in non-existent course
    const failedEnrollReq = await MemberTrainingAccessService.requestEnrollment('non-existent-course-id');
    assert(failedEnrollReq.status === 'course_unavailable', 'Test 5 Failed: Failed enrollment moved to false enrolled state.');
    assert(failedEnrollReq.enrollment === null, 'Test 5 Failed: Failed enrollment set false enrollment record.');
    assert(failedEnrollReq.error !== null, 'Test 5 Failed: Failed enrollment produced no error banner payload.');
    logs.push('✔ Test 5 Passed: Failed enrollment does not produce false enrolled UI state.');

    // Test 6: Account unavailable produces bounded recoverable state
    MemberTrainingAccessService.setAuthProvider(() => 'unregistered-uid-999');
    EnrollmentService.setAuthProvider(() => 'unregistered-uid-999');

    const missingAccountAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(missingAccountAccess.status === 'account_unavailable', 'Test 6 Failed: Missing account did not produce account_unavailable state.');
    assert(missingAccountAccess.error?.code === 'ACCOUNT_UNAVAILABLE', 'Test 6 Failed: Missing error code ACCOUNT_UNAVAILABLE.');
    logs.push('✔ Test 6 Passed: Account unavailable produces bounded recoverable state.');

    // Test 7: Backend failure produces bounded recoverable state
    // Temporarily inject unconfigured production repos
    TrainingCourseService.setRepository(prodTrainingRepo);
    const unavailAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(unavailAccess.status === 'backend_unavailable', 'Test 7 Failed: Unconfigured backend did not produce backend_unavailable state.');
    assert(unavailAccess.error?.code === 'BACKEND_UNAVAILABLE', 'Test 7 Failed: Missing BACKEND_UNAVAILABLE error code.');
    // Restore in-memory repo
    TrainingCourseService.setRepository(inMemCourseRepo);
    logs.push('✔ Test 7 Passed: Backend failure produces bounded recoverable state.');

    // Test 8: Enrollment access is derived strictly from authenticated UID, not caller-supplied identity
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-101');
    EnrollmentService.setAuthProvider(() => 'member-user-101');
    const ownerAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(ownerAccess.status === 'enrolled' && ownerAccess.enrollment?.accountId === 'member-user-101', 'Test 8 Failed: Owner access mismatch.');

    MemberTrainingAccessService.setAuthProvider(() => 'member-user-202');
    EnrollmentService.setAuthProvider(() => 'member-user-202');
    const foreignAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(foreignAccess.status === 'not_enrolled' && foreignAccess.enrollment === null, 'Test 8 Failed: Cross-user identity leaked enrollment state.');
    logs.push('✔ Test 8 Passed: Enrollment access is derived strictly from authenticated UID.');

    // Test 9: Draft/non-Published course cannot become enrollable through this UI
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-101');
    EnrollmentService.setAuthProvider(() => 'member-user-101');
    const draftAccess = await MemberTrainingAccessService.resolveAccessState(draftCourseSample.id);
    assert(draftAccess.status === 'course_unavailable', 'Test 9 Failed: Draft course did not return course_unavailable.');

    const draftEnrollReq = await MemberTrainingAccessService.requestEnrollment(draftCourseSample.id);
    assert(draftEnrollReq.status === 'course_unavailable', 'Test 9 Failed: Draft course enrollment request succeeded or moved to enrolled state.');
    assert(draftEnrollReq.enrollment === null, 'Test 9 Failed: Draft course produced enrollment object.');
    logs.push('✔ Test 9 Passed: Draft/non-Published course cannot become enrollable through this UI.');

    // Test 10: No Account / Enrollment / RBAC schema expansion occurred
    const accSample = await inMemAccountRepo.getAccount('member-user-101');
    const accKeys = Object.keys(accSample || {});
    assert(accKeys.length === 5, `Test 10 Failed: Account field count modified (${accKeys.length}).`);

    const enrollSample = await inMemEnrollRepo.getEnrollment('member-user-101', publishedCourseSample.id);
    const enrollKeys = Object.keys(enrollSample || {});
    assert(enrollKeys.length === 4, `Test 10 Failed: Enrollment field count modified (${enrollKeys.length}).`);

    const adminRolesCount = Object.values(AdminRole).length;
    const adminPermissionsCount = Object.keys(AdminPermission).length;
    assert(adminRolesCount === 9, `Test 10 Failed: Admin roles count changed (${adminRolesCount}).`);
    assert(adminPermissionsCount === 10, `Test 10 Failed: Admin permissions count changed (${adminPermissionsCount}).`);
    assert(Object.keys(ROLE_PERMISSIONS_MAP).length === 9, 'Test 10 Failed: Role permissions map altered.');
    logs.push('✔ Test 10 Passed: No Account/Enrollment/RBAC schema expansion occurred.');

    // Cleanup and reset production repos & auth providers
    MemberTrainingAccessService.setAuthProvider(undefined);
    EnrollmentService.setAuthProvider(undefined);
    AccountService.setRepository(prodAccountRepo);
    TrainingCourseService.setRepository(prodTrainingRepo);
    EnrollmentService.setRepository(prodEnrollmentRepo);

    return { passed: true, logs };
  } catch (err: any) {
    MemberTrainingAccessService.setAuthProvider(undefined);
    EnrollmentService.setAuthProvider(undefined);
    AccountService.setRepository(prodAccountRepo);
    TrainingCourseService.setRepository(prodTrainingRepo);
    EnrollmentService.setRepository(prodEnrollmentRepo);
    logs.push(`❌ ${err.message}`);
    return { passed: false, logs };
  }
}
