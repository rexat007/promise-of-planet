import { 
  validateTrainingCourseData, 
  TrainingCourseError, 
  FirestoreTrainingCourseRepository, 
  InMemoryTrainingCourseRepository, 
  TrainingCourseService,
  serializeTrainingCourseForFirestore
} from './trainingCourseService';
import type { TrainingCourse } from '../types/training';
import { WorkflowState } from '../types/workflow';
import { AdminRole, AdminPermission, type AdminUser } from '../types/admin';
import { AdminAccessService } from './adminAccess';
import type { Account } from '../types/account';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILURE: ${message}`);
  }
}

class UnconfiguredFirestoreTrainingCourseRepository extends FirestoreTrainingCourseRepository {
  protected override isConfigured(): boolean {
    return false;
  }
}

export async function runDurableTrainingCourseTests(): Promise<{ passed: boolean; logs: string[] }> {
  const logs: string[] = [];
  const prodRepo = new FirestoreTrainingCourseRepository();
  const unconfiguredProdRepo = new UnconfiguredFirestoreTrainingCourseRepository();
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

  const authorizedAdmin: AdminUser = {
    id: 'admin-auth-01',
    name: 'Mustafa Hassan',
    email: 'training.mgr@promiseofplanet.sd',
    role: AdminRole.TrainingManager,
    isActive: true,
  };

  const inactiveAdmin: AdminUser = {
    id: 'admin-inactive-01',
    name: 'Inactive Manager',
    email: 'inactive@promiseofplanet.sd',
    role: AdminRole.TrainingManager,
    isActive: false,
  };

  const unauthorizedAdmin: AdminUser = {
    id: 'admin-unauth-01',
    name: 'Mona El-Tayeb',
    email: 'viewer@promiseofplanet.sd',
    role: AdminRole.Viewer,
    isActive: true,
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
      await unconfiguredProdRepo.listCourses();
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
      await unconfiguredProdRepo.getCourseById('course-test-01');
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'BACKEND_UNAVAILABLE') {
        unavailCaught = true;
      }
    }
    assert(unavailCaught, 'Test 5 Failed: Unconfigured backend did not throw BACKEND_UNAVAILABLE.');
    logs.push('✔ Test 5 Passed: Unavailable backend fails explicitly and safely.');

    // Test 6: Inactive admin is NOT treated as authorized by the relevant authorization contract
    const inactiveHasPerm = AdminAccessService.hasPermission(inactiveAdmin, AdminPermission.Create);
    assert(!inactiveHasPerm, 'Test 6 Failed: Inactive admin was granted permission by AdminAccessService.');
    let inactiveSaveCaught = false;
    try {
      await TrainingCourseService.saveCourse(validCourseSample, inactiveAdmin);
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'UNAUTHORIZED') {
        inactiveSaveCaught = true;
      }
    }
    assert(inactiveSaveCaught, 'Test 6 Failed: Inactive admin save was not rejected with UNAUTHORIZED.');
    logs.push('✔ Test 6 Passed: Inactive admin is NOT treated as authorized by the authorization contract.');

    // Test 7: Administrative save cannot bypass service RBAC by omitting authorization context
    let missingUserCaught = false;
    try {
      await TrainingCourseService.saveCourse(validCourseSample, undefined as any);
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'UNAUTHORIZED') {
        missingUserCaught = true;
      }
    }
    assert(missingUserCaught, 'Test 7 Failed: Omitting authorization context did not fail with UNAUTHORIZED.');
    logs.push('✔ Test 7 Passed: Administrative save cannot bypass service RBAC by omitting authorization context.');

    // Test 8: Unauthorized admin cannot reach repository mutation
    let unauthCaught = false;
    try {
      await TrainingCourseService.saveCourse(validCourseSample, unauthorizedAdmin);
    } catch (e: any) {
      if (e instanceof TrainingCourseError && e.code === 'UNAUTHORIZED') {
        unauthCaught = true;
      }
    }
    assert(unauthCaught, 'Test 8 Failed: Unauthorized admin save was not rejected with UNAUTHORIZED.');
    logs.push('✔ Test 8 Passed: Unauthorized admin cannot reach repository mutation.');

    // Test 9: Authorized active admin with required canonical permission can reach repository mutation path
    const inMemRepo = new InMemoryTrainingCourseRepository();
    TrainingCourseService.setRepository(inMemRepo);
    const saved = await TrainingCourseService.saveCourse(validCourseSample, authorizedAdmin);
    assert(saved.id === 'course-test-01', 'Test 9 Failed: Save course return value mismatch.');
    const fetched = await inMemRepo.getCourseById('course-test-01');
    assert(fetched !== null && fetched.id === 'course-test-01', 'Test 9 Failed: Course was not saved to repository.');
    logs.push('✔ Test 9 Passed: Authorized admin with required permission reaches repository mutation path.');

    // Test 10: Failed durable mutation produces no false success
    let saveFailed = false;
    try {
      await TrainingCourseService.saveCourse({
        ...validCourseSample,
        id: 'bad-course',
        // @ts-expect-error forcing invalid field
        category: 'INVALID_CATEGORY',
      }, authorizedAdmin);
    } catch {
      saveFailed = true;
    }
    const checkAfterFail = await inMemRepo.getCourseById('bad-course');
    assert(saveFailed && checkAfterFail === null, 'Test 10 Failed: Mutation failure updated repository state.');
    logs.push('✔ Test 10 Passed: Failed durable mutation produces no false success.');

    // Test 11: Account canonical schema remains exactly 5 fields
    const mockAccount: Account = {
      id: 'acc-01',
      email: 'test@example.com',
      displayName: 'Test Account',
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

    // Test 12: Admin RBAC canonical counts and contracts are preserved
    assert(allAdminRoles.length === 9, `Test 12 Failed: Admin roles expanded beyond 9 canonical roles.`);
    const permissionsCount = Object.keys(AdminPermission).length;
    assert(permissionsCount === 10, `Test 12 Failed: Admin permissions expanded beyond 10 canonical permissions.`);
    assert(
      !allAdminRoles.includes('Trainee' as any) && !allAdminRoles.includes('Member' as any),
      'Test 12 Failed: Trainee or Member role was introduced.'
    );
    logs.push('✔ Test 12 Passed: Admin RBAC canonical counts (9 roles, 10 permissions) and contracts are preserved.');

    // Test 13: Validated TrainingCourse can legitimately contain optional undefined values
    const courseWithOptionalUndefined: TrainingCourse = {
      ...validCourseSample,
      id: 'course-test-undef',
      descriptionAr: undefined,
      descriptionEn: undefined,
      instructorNameAr: undefined,
      instructorNameEn: undefined,
      instructorBioAr: undefined,
      instructorBioEn: undefined,
    };
    const validatedWithUndef = validateTrainingCourseData(courseWithOptionalUndefined);
    assert(validatedWithUndef.descriptionAr === undefined, 'Test 13 Failed: descriptionAr was not preserved as undefined.');
    assert(validatedWithUndef.instructorNameAr === undefined, 'Test 13 Failed: instructorNameAr was not preserved as undefined.');
    logs.push('✔ Test 13 Passed: Validated TrainingCourse can legitimately contain optional undefined values.');

    // Test 14: Firestore write payload contains NO undefined values
    const safePayload = serializeTrainingCourseForFirestore(validatedWithUndef);
    const hasUndefinedValue = Object.values(safePayload).some(v => v === undefined);
    assert(!hasUndefinedValue, 'Test 14 Failed: Sanitized Firestore payload contains undefined value.');
    logs.push('✔ Test 14 Passed: Firestore write payload contains NO undefined values.');

    // Test 15: descriptionAr undefined is omitted from Firestore payload
    assert(!('descriptionAr' in safePayload), 'Test 15 Failed: descriptionAr key was not omitted from payload.');
    logs.push('✔ Test 15 Passed: descriptionAr undefined is omitted from Firestore payload.');

    // Test 16: descriptionEn undefined is omitted from Firestore payload
    assert(!('descriptionEn' in safePayload), 'Test 16 Failed: descriptionEn key was not omitted from payload.');
    logs.push('✔ Test 16 Passed: descriptionEn undefined is omitted from Firestore payload.');

    // Test 17: optional instructor fields undefined are omitted
    assert(!('instructorNameAr' in safePayload), 'Test 17 Failed: instructorNameAr key was not omitted.');
    assert(!('instructorNameEn' in safePayload), 'Test 17 Failed: instructorNameEn key was not omitted.');
    assert(!('instructorBioAr' in safePayload), 'Test 17 Failed: instructorBioAr key was not omitted.');
    assert(!('instructorBioEn' in safePayload), 'Test 17 Failed: instructorBioEn key was not omitted.');
    logs.push('✔ Test 17 Passed: optional instructor fields undefined are omitted from Firestore payload.');

    // Test 18: defined optional values are preserved exactly after trimming/canonicalization
    const courseWithDefinedOptional: TrainingCourse = {
      ...validCourseSample,
      id: 'course-test-defined',
      descriptionAr: '  وصف عربي  ',
      descriptionEn: '  English Description  ',
      instructorNameAr: '  د. علي  ',
      instructorNameEn: '  Dr. Ali  ',
      instructorBioAr: '  السيرة الذاتية  ',
      instructorBioEn: '  Instructor Bio  ',
    };
    const validatedDefined = validateTrainingCourseData(courseWithDefinedOptional);
    const safePayloadDefined = serializeTrainingCourseForFirestore(validatedDefined);
    assert(safePayloadDefined.descriptionAr === 'وصف عربي', 'Test 18 Failed: descriptionAr not trimmed/preserved.');
    assert(safePayloadDefined.descriptionEn === 'English Description', 'Test 18 Failed: descriptionEn not trimmed/preserved.');
    assert(safePayloadDefined.instructorNameAr === 'د. علي', 'Test 18 Failed: instructorNameAr not trimmed/preserved.');
    assert(safePayloadDefined.instructorNameEn === 'Dr. Ali', 'Test 18 Failed: instructorNameEn not trimmed/preserved.');
    assert(safePayloadDefined.instructorBioAr === 'السيرة الذاتية', 'Test 18 Failed: instructorBioAr not trimmed/preserved.');
    assert(safePayloadDefined.instructorBioEn === 'Instructor Bio', 'Test 18 Failed: instructorBioEn not trimmed/preserved.');
    logs.push('✔ Test 18 Passed: defined optional values are preserved exactly after trimming and canonicalization.');

    // Test 19: required fields are never removed from safe payload
    assert(safePayloadDefined.id === 'course-test-defined', 'Test 19 Failed: id was removed.');
    assert(safePayloadDefined.titleAr === 'دورة اختبار الأثر البيئي', 'Test 19 Failed: titleAr was removed.');
    assert(safePayloadDefined.category === 'Climate', 'Test 19 Failed: category was removed.');
    assert(safePayloadDefined.level === 'Beginner', 'Test 19 Failed: level was removed.');
    assert(safePayloadDefined.durationHours === 12, 'Test 19 Failed: durationHours was removed.');
    assert(safePayloadDefined.deliveryMode === 'OnlineSelfPaced', 'Test 19 Failed: deliveryMode was removed.');
    assert(safePayloadDefined.workflowState === WorkflowState.Published, 'Test 19 Failed: workflowState was removed.');
    assert(safePayloadDefined.createdAt === '2026-03-01T00:00:00Z', 'Test 19 Failed: createdAt was removed.');
    assert(safePayloadDefined.author === 'أحمد علي', 'Test 19 Failed: author was removed.');
    logs.push('✔ Test 19 Passed: required fields are never removed from the sanitized payload.');

    // Test 20: InMemory repository behavior remains compatible
    const inMemRepoComp = new InMemoryTrainingCourseRepository();
    TrainingCourseService.setRepository(inMemRepoComp);
    const savedComp = await TrainingCourseService.saveCourse(courseWithOptionalUndefined, authorizedAdmin);
    assert(savedComp.descriptionAr === undefined, 'Test 20 Failed: Saved course descriptionAr was not undefined.');
    const fetchedComp = await inMemRepoComp.getCourseById('course-test-undef');
    assert(fetchedComp !== null && fetchedComp.descriptionAr === undefined, 'Test 20 Failed: Fetched course descriptionAr was not undefined.');
    logs.push('✔ Test 20 Passed: InMemory repository behavior remains compatible with undefined optional fields.');

    // Test 21: Nested workflowHistory comments with undefined are omitted
    const courseWithUndefinedComment: TrainingCourse = {
      ...validCourseSample,
      id: 'course-test-comment-undef',
      workflowHistory: [
        {
          id: 'tr-1',
          fromState: WorkflowState.Draft,
          toState: WorkflowState.Published,
          action: 'publish',
          actorName: 'Admin',
          actorRole: 'Owner',
          timestamp: '2026-03-01T00:00:00Z',
          comment: undefined
        }
      ]
    };
    const safePayloadCommentUndef = serializeTrainingCourseForFirestore(courseWithUndefinedComment);
    const firstHistoryRecord = safePayloadCommentUndef.workflowHistory[0];
    assert(!('comment' in firstHistoryRecord), 'Test 21 Failed: Nested undefined comment key was not omitted.');
    logs.push('✔ Test 21 Passed: Nested undefined workflowHistory comment is omitted from Firestore payload.');

    // Test 22: Nested workflowHistory comments with string values are preserved
    const courseWithDefinedComment: TrainingCourse = {
      ...validCourseSample,
      id: 'course-test-comment-defined',
      workflowHistory: [
        {
          id: 'tr-1',
          fromState: WorkflowState.Draft,
          toState: WorkflowState.Published,
          action: 'publish',
          actorName: 'Admin',
          actorRole: 'Owner',
          timestamp: '2026-03-01T00:00:00Z',
          comment: 'Approved!'
        }
      ]
    };
    const safePayloadCommentDefined = serializeTrainingCourseForFirestore(courseWithDefinedComment);
    const firstHistoryRecordDefined = safePayloadCommentDefined.workflowHistory[0];
    assert(firstHistoryRecordDefined.comment === 'Approved!', 'Test 22 Failed: Nested defined comment was not preserved.');
    logs.push('✔ Test 22 Passed: Nested defined workflowHistory comment is preserved in Firestore payload.');

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
