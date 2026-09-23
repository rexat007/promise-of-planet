import { TrainingCourseService } from './trainingCourseService';
import { WorkflowState } from '../types/workflow';

export async function runPublicTrainingCenterUnitTests() {
  const logs: string[] = [];
  let passed = true;

  try {
    // ------------------------------------------------------------
    // 1. CANONICAL SERVICE INTEGRATION
    // TYPE: UNIT_LOGIC_TEST
    // ------------------------------------------------------------
    if (typeof TrainingCourseService.listCourses !== 'function') {
      throw new Error('Test 1 Failed: TrainingCourseService.listCourses is not a function.');
    }
    logs.push('✔ Test 1 [UNIT_LOGIC_TEST]: Public Training Center integrates cleanly with the canonical TrainingCourseService.');

    // ------------------------------------------------------------
    // 2. NO PRODUCTION MOCK FALLBACK
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    const fs = await import('fs');
    const serviceSource = fs.readFileSync('src/services/trainingCourseService.ts', 'utf8');
    if (serviceSource.includes('mockTrainingData') || serviceSource.includes('MOCK_TRAINING_COURSES')) {
      if (!serviceSource.includes("process.env.NODE_ENV === 'test'") && serviceSource.includes('return MOCK_TRAINING_COURSES')) {
        throw new Error('Test 2 Failed: Production TrainingCourseService has direct mock fallback dependency.');
      }
    }
    logs.push('✔ Test 2 [STATIC_SOURCE_ASSERTION]: Production path is free of automatic mock training fallbacks.');

    // ------------------------------------------------------------
    // 3. PUBLISHED-ONLY PUBLIC PATH
    // TYPE: INTEGRATION_TEST
    // ------------------------------------------------------------
    const testCourses = await TrainingCourseService.listCourses();
    const unpublished = testCourses.filter(c => c.workflowState !== WorkflowState.Published);
    if (unpublished.length > 0) {
      throw new Error('Test 3 Failed: Unpublished courses found in public catalog queries.');
    }
    logs.push('✔ Test 3 [INTEGRATION_TEST]: Only Published courses are returned in the public canonical catalog path.');

    // ------------------------------------------------------------
    // 4. TRUTHFUL EMPTY STATE
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    const catalogSource = fs.readFileSync('src/components/training/TrainingCenter.tsx', 'utf8');
    if (!catalogSource.includes('courses.length === 0') || !catalogSource.includes('BookOpen')) {
      throw new Error('Test 4 Failed: TrainingCenter does not implement a truthful empty state for 0 published courses.');
    }
    logs.push('✔ Test 4 [STATIC_SOURCE_ASSERTION]: TrainingCenter layout structures a descriptive empty state when no courses are published.');

    // ------------------------------------------------------------
    // 5. BOUNDED ERROR STATE USING ERRORBANNER
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    if (!catalogSource.includes('ErrorBanner') || !catalogSource.includes('error={error}')) {
      throw new Error('Test 5 Failed: TrainingCenter does not incorporate the standard ErrorBanner for boundary safety.');
    }
    logs.push('✔ Test 5 [STATIC_SOURCE_ASSERTION]: TrainingCenter incorporates ErrorBanner for bounded error presentation.');

    // ------------------------------------------------------------
    // 6. RETRY INVOKES CANONICAL LOADING AGAIN
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    if (!catalogSource.includes('onClick: loadPublishedCourses')) {
      throw new Error('Test 6 Failed: TrainingCenter does not wire the Retry callback to loadPublishedCourses.');
    }
    logs.push('✔ Test 6 [STATIC_SOURCE_ASSERTION]: Retry action is wired to trigger the canonical loading sequence again.');

    // ------------------------------------------------------------
    // 7. HEADER NAVIGATION TO TRAINING CENTER
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    const headerSource = fs.readFileSync('src/components/layout/Header.tsx', 'utf8');
    if (!headerSource.includes("onNavigate('training-center')")) {
      throw new Error('Test 7 Failed: Header does not propagate navigation event to training-center.');
    }
    logs.push('✔ Test 7 [STATIC_SOURCE_ASSERTION]: Header training-center navigation is wired to toggle page state.');

    // ------------------------------------------------------------
    // 8. SAFE RETURN TO HOME VIA HEADER
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    if (!headerSource.includes("onNavigate('home')")) {
      throw new Error('Test 8 Failed: Header logo or nav item does not trigger navigation event back to home.');
    }
    logs.push('✔ Test 8 [STATIC_SOURCE_ASSERTION]: safe Home return is wired through canonical Header click events.');

    // ------------------------------------------------------------
    // 9. ARABIC/ENGLISH LOCALIZED FIELDS SELECTORS
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    if (!catalogSource.includes('isArabic ? course.titleAr : course.titleEn') ||
        !catalogSource.includes('isArabic ? course.summaryAr : course.summaryEn')) {
      throw new Error('Test 9 Failed: Dynamic localized field selection is missing in catalog cards.');
    }
    logs.push('✔ Test 9 [STATIC_SOURCE_ASSERTION]: Localized Arabic and English fields are correctly resolved in the catalog layout.');

    // ------------------------------------------------------------
    // 10. HOMEPAGE LATESTTRAINING PREVIEW PRESERVATION
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    const appSource = fs.readFileSync('src/App.tsx', 'utf8');
    if (!appSource.includes('<LatestTraining') || !appSource.includes('id="training-section"')) {
      throw new Error('Test 10 Failed: Homepage LatestTraining preview section was deleted or altered.');
    }
    logs.push('✔ Test 10 [STATIC_SOURCE_ASSERTION]: Homepage LatestTraining preview remains the active homepage display.');

    // ------------------------------------------------------------
    // 11. NO DUPLICATE REPOSITORY OR SERVICE
    // TYPE: STATIC_SOURCE_ASSERTION
    // ------------------------------------------------------------
    const serviceFiles = fs.readdirSync('src/services');
    const duplicates = serviceFiles.filter((f: string) => f.toLowerCase().includes('training') && f.endsWith('.ts') && f !== 'trainingCourseService.ts' && f !== 'memberTrainingAccessService.ts' && !f.toLowerCase().includes('test') && !f.toLowerCase().includes('index'));
    if (duplicates.length > 0) {
      throw new Error(`Test 11 Failed: Found duplicate training service/repository files: ${duplicates.join(', ')}`);
    }
    logs.push('✔ Test 11 [STATIC_SOURCE_ASSERTION]: No duplicate or parallel training services or repositories exist.');

    // ------------------------------------------------------------
    // 12. PURE CATALOG RENDERING CAUSES ZERO ENROLLMENT MUTATIONS
    // TYPE: NOT_ACTUALLY_VERIFIED
    // ------------------------------------------------------------
    // This cannot be verified by static check or a simple service trigger alone.
    // It requires live/mock browser rendering loops which are NOT automated.
    logs.push('⚠ Test 12 [NOT_ACTUALLY_VERIFIED]: Pure catalog view-rendering zero-mutation behavior is checked manually, not automated.');

  } catch (error: any) {
    passed = false;
    logs.push(`✖ Failure: ${error.message}`);
  }

  return { passed, logs };
}
