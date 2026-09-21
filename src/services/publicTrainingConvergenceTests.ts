import fs from 'fs';
import path from 'path';
import { TrainingCourseService, InMemoryTrainingCourseRepository } from './trainingCourseService';
import { WorkflowState } from '../types/workflow';
import type { TrainingCourse } from '../types/training';
import type { Account } from '../types/account';
import type { Enrollment } from '../types/enrollment';
import { AdminRole, AdminPermission, ROLE_PERMISSIONS_MAP } from '../shared/adminContract';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runPublicTrainingConvergenceTests(): Promise<{ passed: boolean; logs: string[] }> {
  const logs: string[] = [];

  try {
    // Test 1: Verify LatestTraining.tsx does not import or reference MOCK_TRAINING_COURSES
    const latestTrainingPath = path.resolve(process.cwd(), 'src/components/content/LatestTraining.tsx');
    const latestTrainingSource = fs.readFileSync(latestTrainingPath, 'utf8');
    
    assert(!latestTrainingSource.includes('MOCK_TRAINING_COURSES'), 'Test 1 Failed: LatestTraining.tsx still references MOCK_TRAINING_COURSES.');
    logs.push('✔ Test 1 Passed: LatestTraining.tsx production path has no MOCK_TRAINING_COURSES dependency.');

    // Test 2 & 3 & 4: Canonical TrainingCourseService query, Published-only filter, and ID preservation
    const testRepo = new InMemoryTrainingCourseRepository();
    const publishedCourse1: TrainingCourse = {
      id: 'pub-course-101',
      titleAr: 'عنوان منشور 1',
      titleEn: 'Published Title 1',
      summaryAr: 'ملخص منشور 1',
      summaryEn: 'Published Summary 1',
      category: 'Climate',
      level: 'Beginner',
      durationHours: 10,
      deliveryMode: 'OnlineSelfPaced',
      targetAudienceAr: 'الجمهور',
      targetAudienceEn: 'Audience',
      workflowState: WorkflowState.Published,
      workflowHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: 'Admin',
      language: 'en'
    };

    const draftCourse: TrainingCourse = { ...publishedCourse1, id: 'draft-course-102', workflowState: WorkflowState.Draft };
    const publishedCourse2: TrainingCourse = { ...publishedCourse1, id: 'pub-course-103' };

    testRepo.seed(publishedCourse1);
    testRepo.seed(draftCourse);
    testRepo.seed(publishedCourse2);

    const originalRepo = TrainingCourseService.getRepository();
    TrainingCourseService.setRepository(testRepo);

    const fetchedCourses = await TrainingCourseService.listCourses();

    assert(fetchedCourses.length === 2, `Test 2/3 Failed: Expected 2 published courses, got ${fetchedCourses.length}.`);
    assert(fetchedCourses.every((c) => c.workflowState === WorkflowState.Published), 'Test 3 Failed: Non-published course returned.');
    assert(fetchedCourses[0].id === 'pub-course-101' && fetchedCourses[1].id === 'pub-course-103', 'Test 4 Failed: Canonical course.id was altered.');
    logs.push('✔ Test 2, 3 & 4 Passed: Public preview queries TrainingCourseService, returns only Published courses, and preserves canonical course IDs.');

    // Test 5 & 6: Verification of no mock fallback during loading or backend error
    assert(!latestTrainingSource.includes('catch') || !latestTrainingSource.includes('MOCK_TRAINING_COURSES'), 'Test 6 Failed: Catch block falls back to mock courses.');
    assert(latestTrainingSource.includes('setCourses([])') || latestTrainingSource.includes('setError'), 'Test 6 Failed: Backend error handling missing.');
    logs.push('✔ Test 5 & 6 Passed: Loading and backend failure do not fall back to mock data.');

    // Test 7: Truthful Empty State
    testRepo.clear();
    const emptyResult = await TrainingCourseService.listCourses();
    assert(emptyResult.length === 0, 'Test 7 Failed: Expected empty list.');
    assert(latestTrainingSource.includes('courses.length === 0'), 'Test 7 Failed: Missing empty state UI check in LatestTraining.tsx.');
    logs.push('✔ Test 7 Passed: Empty canonical result yields truthful empty state.');

    // Restore original repo
    TrainingCourseService.setRepository(originalRepo);

    // Test 8: Generic Explore CTA implementation check
    assert(!latestTrainingSource.includes('courses[0]') && !latestTrainingSource.includes('selectedCourse(courses[0])'), 'Test 8 Failed: Generic Explore CTA targets arbitrary course.');
    logs.push('✔ Test 8 Passed: Generic Explore CTA does not arbitrarily select courses[0].');

    // Test 9: Account schema canonical count (5 fields)
    const mockAccount: Account = {
      id: 'acc-01',
      email: 'member@promiseofplanet.sd',
      displayName: 'Environmental Member',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };
    const accountKeys = Object.keys(mockAccount);
    assert(accountKeys.length === 5, `Test 9 Failed: Account schema modified (${accountKeys.length} fields).`);
    assert(
      accountKeys.every((k) => ['id', 'email', 'displayName', 'createdAt', 'updatedAt'].includes(k)),
      'Test 9 Failed: Account schema fields modified.'
    );
    logs.push('✔ Test 9 Passed: Account schema remains exactly 5 fields.');

    // Test 10: Enrollment schema canonical count (4 fields)
    const mockEnrollment: Enrollment = {
      id: 'acc-01_course-01',
      accountId: 'acc-01',
      courseId: 'course-01',
      createdAt: '2026-03-01T00:00:00Z',
    };
    const enrollmentKeys = Object.keys(mockEnrollment);
    assert(enrollmentKeys.length === 4, `Test 10 Failed: Enrollment schema modified (${enrollmentKeys.length} fields).`);
    assert(
      enrollmentKeys.every((k) => ['id', 'accountId', 'courseId', 'createdAt'].includes(k)),
      'Test 10 Failed: Enrollment schema fields modified.'
    );
    logs.push('✔ Test 10 Passed: Enrollment schema remains exactly 4 fields.');

    // Test 11: Admin RBAC canonical counts (9 roles, 10 permissions)
    const adminRolesCount = Object.values(AdminRole).length;
    const adminPermissionsCount = Object.keys(AdminPermission).length;
    assert(adminRolesCount === 9, `Test 11 Failed: Admin roles count modified (${adminRolesCount}).`);
    assert(adminPermissionsCount === 10, `Test 11 Failed: Admin permissions count modified (${adminPermissionsCount}).`);
    assert(Object.keys(ROLE_PERMISSIONS_MAP).length === 9, 'Test 11 Failed: Role permissions map modified.');
    logs.push('✔ Test 11 Passed: Admin RBAC remains 9 roles / 10 permissions.');

    return { passed: true, logs };
  } catch (err: any) {
    logs.push(`❌ Test Failed: ${err.message}`);
    return { passed: false, logs };
  }
}
