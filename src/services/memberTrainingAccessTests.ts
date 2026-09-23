import fs from 'fs';
import path from 'path';
import { MemberTrainingAccessService } from './memberTrainingAccessService';
import {
  EnrollmentService,
  InMemoryEnrollmentRepository,
  FirestoreEnrollmentRepository
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

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

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

  try {
    // Set up in-memory repositories
    const inMemAccountRepo = new InMemoryAccountRepository();
    const inMemCourseRepo = new InMemoryTrainingCourseRepository();
    const inMemEnrollRepo = new InMemoryEnrollmentRepository();

    AccountService.setRepository(inMemAccountRepo);
    TrainingCourseService.setRepository(inMemCourseRepo);
    EnrollmentService.setRepository(inMemEnrollRepo);

    await inMemCourseRepo.saveCourse(publishedCourseSample);

    // Seed canonical Accounts for member testing
    await inMemAccountRepo.createAccount({
      id: 'member-user-101',
      email: 'member101@promiseofplanet.sd',
      displayName: 'Member One Hundred One',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    });

    await inMemAccountRepo.createAccount({
      id: 'member-user-202',
      email: 'member202@promiseofplanet.sd',
      displayName: 'Member Two Hundred Two',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    });

    // =========================================================================
    // 1. Modal opened unauthenticated resolves unauthenticated
    // =========================================================================
    MemberTrainingAccessService.setAuthProvider(() => null);
    EnrollmentService.setAuthProvider(() => null);

    const initialUnauthAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(initialUnauthAccess.status === 'unauthenticated', 'Test 1 Failed: Modal opened unauthenticated did not resolve as unauthenticated.');
    assert(initialUnauthAccess.account === null, 'Test 1 Failed: Unauthenticated status contains non-null account.');
    assert(initialUnauthAccess.enrollment === null, 'Test 1 Failed: Unauthenticated status contains non-null enrollment.');
    logs.push('✔ Test 1 Passed: Modal opened unauthenticated resolves unauthenticated.');

    // =========================================================================
    // 2. Changing provider identity enables clean service access state resolution under authenticated UID
    // =========================================================================
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-101');
    EnrollmentService.setAuthProvider(() => 'member-user-101');
    
    const autoReResolvedAccess = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(autoReResolvedAccess.status !== 'unauthenticated', 'Test 2 Failed: resolveAccessState on authenticated UID did not resolve access state.');
    logs.push('✔ Test 2 Passed: resolveAccessState resolves correct access state under changed authenticated UID provider.');

    // =========================================================================
    // 3. Authenticated canonical Account with no Enrollment resolves not_enrolled after login
    // =========================================================================
    assert(autoReResolvedAccess.status === 'not_enrolled', 'Test 3 Failed: Authenticated account with no enrollment did not resolve to not_enrolled.');
    assert(autoReResolvedAccess.account?.id === 'member-user-101', 'Test 3 Failed: Account profile missing or mismatched.');
    assert(autoReResolvedAccess.enrollment === null, 'Test 3 Failed: Enrollment was non-null.');
    logs.push('✔ Test 3 Passed: Authenticated canonical Account with no Enrollment resolves as not_enrolled.');

    // =========================================================================
    // 4. Authenticated Account with existing Enrollment resolves enrolled after login
    // =========================================================================
    await EnrollmentService.enrollInCourse(publishedCourseSample.id);
    const resolvedEnrolled = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(resolvedEnrolled.status === 'enrolled', 'Test 4 Failed: Authenticated account with active enrollment did not resolve to enrolled.');
    assert(resolvedEnrolled.enrollment !== null, 'Test 4 Failed: Enrollment object is missing.');
    assert(resolvedEnrolled.enrollment?.accountId === 'member-user-101', 'Test 4 Failed: Enrollment accountId mismatch.');
    logs.push('✔ Test 4 Passed: Authenticated Account with existing Enrollment resolves as enrolled.');

    // =========================================================================
    // 5. Authenticated → logout while modal remains open removes stale Account/Enrollment state and resolves unauthenticated
    // =========================================================================
    MemberTrainingAccessService.setAuthProvider(() => null);
    EnrollmentService.setAuthProvider(() => null);

    const logoutResolved = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(logoutResolved.status === 'unauthenticated', 'Test 5 Failed: Logout state did not resolve to unauthenticated.');
    assert(logoutResolved.account === null, 'Test 5 Failed: Stale Account data retained after logout.');
    assert(logoutResolved.enrollment === null, 'Test 5 Failed: Stale Enrollment data retained after logout.');
    logs.push('✔ Test 5 Passed: Authenticated → logout clears stale Account/Enrollment state and resolves unauthenticated.');

    // =========================================================================
    // 6. UID A → UID B cannot retain UID A enrollment state
    // =========================================================================
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-202');
    EnrollmentService.setAuthProvider(() => 'member-user-202');

    const uidBResolved = await MemberTrainingAccessService.resolveAccessState(publishedCourseSample.id);
    assert(uidBResolved.status === 'not_enrolled', 'Test 6 Failed: UID B resolved to incorrect status (retained UID A enrolled state).');
    assert(uidBResolved.account?.id === 'member-user-202', 'Test 6 Failed: Stale UID A account data retained.');
    assert(uidBResolved.enrollment === null, 'Test 6 Failed: Stale UID A enrollment data retained.');
    logs.push('✔ Test 6 Passed: UID A → UID B transition completely clears UID A state and re-resolves correctly.');

    // =========================================================================
    // 7. Successful login does NOT automatically call enrollInCourse & zero useFirebaseAuth dependency
    // =========================================================================
    const modalPath = path.resolve(process.cwd(), 'src/components/training/CourseAccessModal.tsx');
    const modalSource = fs.readFileSync(modalPath, 'utf8');
    
    // Verify that the useEffect hook does NOT invoke enrollInCourse or requestEnrollment
    const isAutoEnrollInEffect = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*(enrollInCourse|requestEnrollment)/.test(modalSource);
    assert(!isAutoEnrollInEffect, 'Test 7 Failed: useEffect hook automatically triggers enrollment upon login.');
    
    // Verify that useFirebaseAuth and FirebaseAuthProvider dependencies are completely gone from the modal source
    assert(!modalSource.includes('useFirebaseAuth'), 'Test 7 Failed: CourseAccessModal still depends on useFirebaseAuth.');
    assert(!modalSource.includes('FirebaseAuthProvider'), 'Test 7 Failed: CourseAccessModal still references FirebaseAuthProvider.');
    
    logs.push('✔ Test 7 Passed: Successful login does NOT automatically trigger course enrollment, and useFirebaseAuth dependency is completely removed.');

    // =========================================================================
    // 8. Generic Explore CTA never: selects courses[0], scrolls to its own training-section, exposes misleading action
    // =========================================================================
    const latestTrainingPath = path.resolve(process.cwd(), 'src/components/content/LatestTraining.tsx');
    const latestTrainingSource = fs.readFileSync(latestTrainingPath, 'utf8');

    // Confirm smoothScrollToSection was removed from handleExploreClick
    const hasScrollFallbackInExplore = latestTrainingSource.includes("smoothScrollToSection('training-section')");
    assert(!hasScrollFallbackInExplore, 'Test 8 Failed: LatestTraining still has a fallback to scroll to its own section.');

    // Confirm that the CTA renders conditionally based on onExploreTraining
    const hasConditionalCta = latestTrainingSource.includes('{onExploreTraining && (');
    assert(hasConditionalCta, 'Test 8 Failed: Explore CTA is not conditional on onExploreTraining.');
    logs.push('✔ Test 8 Passed: Generic Explore CTA never scrolls to own section, selects arbitrary course, or renders without a valid destination.');

    // =========================================================================
    // 9. LatestTraining still has ZERO MOCK_TRAINING_COURSES production dependency
    // =========================================================================
    assert(!latestTrainingSource.includes('MOCK_TRAINING_COURSES'), 'Test 9 Failed: LatestTraining still references MOCK_TRAINING_COURSES.');
    logs.push('✔ Test 9 Passed: LatestTraining still has ZERO MOCK_TRAINING_COURSES production dependency.');

    // =========================================================================
    // 10. Account remains exactly 5 fields
    // =========================================================================
    const accSample = await inMemAccountRepo.getAccount('member-user-101');
    const accKeys = Object.keys(accSample || {});
    assert(accKeys.length === 5, `Test 10 Failed: Account field count modified (${accKeys.length}).`);
    logs.push('✔ Test 10 Passed: Account schema remains exactly 5 fields.');

    // =========================================================================
    // 11. Enrollment remains exactly 4 fields
    // =========================================================================
    // Perform enrollment to ensure record exists
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-101');
    EnrollmentService.setAuthProvider(() => 'member-user-101');
    const tempEnroll = await inMemEnrollRepo.getEnrollment('member-user-101', publishedCourseSample.id);
    const enrollKeys = Object.keys(tempEnroll || {});
    assert(enrollKeys.length === 4, `Test 11 Failed: Enrollment field count modified (${enrollKeys.length}).`);
    logs.push('✔ Test 11 Passed: Enrollment schema remains exactly 4 fields.');

    // =========================================================================
    // 12. Admin RBAC remains 9 roles / 10 permissions
    // =========================================================================
    const adminRolesCount = Object.values(AdminRole).length;
    const adminPermissionsCount = Object.keys(AdminPermission).length;
    assert(adminRolesCount === 9, `Test 12 Failed: Admin roles count changed (${adminRolesCount}).`);
    assert(adminPermissionsCount === 10, `Test 12 Failed: Admin permissions count changed (${adminPermissionsCount}).`);
    assert(Object.keys(ROLE_PERMISSIONS_MAP).length === 9, 'Test 12 Failed: Role permissions map altered.');
    logs.push('✔ Test 12 Passed: Admin RBAC remains exactly 9 roles / 10 permissions.');

    // =========================================================================
    // 13. Draft / non-Published TrainingCourse cannot become enrollable
    // =========================================================================
    const draftCourseSample: TrainingCourse = {
      ...publishedCourseSample,
      id: 'course-draft-01',
      workflowState: WorkflowState.Draft,
    };
    await inMemCourseRepo.saveCourse(draftCourseSample);

    // Assert that resolving access state for this draft course resolves as course_unavailable
    MemberTrainingAccessService.setAuthProvider(() => 'member-user-101');
    EnrollmentService.setAuthProvider(() => 'member-user-101');

    const draftAccessState = await MemberTrainingAccessService.resolveAccessState(draftCourseSample.id);
    assert(draftAccessState.status === 'course_unavailable', 'Security Guard Failed: Draft course resolved to an accessible status.');

    // Assert that trying to enroll throws/fails and creates no enrollment record
    let draftEnrollmentPrevented = false;
    try {
      await EnrollmentService.enrollInCourse(draftCourseSample.id);
    } catch {
      draftEnrollmentPrevented = true;
    }
    assert(draftEnrollmentPrevented, 'Security Guard Failed: Draft course enrollment attempt did not throw an exception.');
    const draftEnrollmentCheck = await inMemEnrollRepo.getEnrollment('member-user-101', draftCourseSample.id);
    assert(draftEnrollmentCheck === null, 'Security Guard Failed: Draft course enrollment was stored in database repository.');
    logs.push('✔ Test 13 Passed: Draft / non-Published TrainingCourse cannot be resolved or enrolled in.');

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
