import {
  authorizeAdvisoryResultSubmission,
  authorizePendingTaskDelivery,
  MachineAuthorizationError,
  PEIAMachineCapability,
  VerifiedMachinePrincipal,
  MachineIdentityVerifier,
} from '../functions/src/peia/machineAuthorizationBoundary';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  message?: string;
}

const tests: TestResult[] = [];
let testCounter = 1;

class CountingVerifier implements MachineIdentityVerifier {
  public verifyCount = 0;
  constructor(
    private readonly mockPrincipal: VerifiedMachinePrincipal | null,
    private readonly shouldThrow: boolean = false,
    private readonly rawErrorText: string = 'DB connection refused secret_key_999'
  ) {}

  async verify(input: unknown): Promise<VerifiedMachinePrincipal | null> {
    this.verifyCount++;
    if (this.shouldThrow) {
      throw new Error(this.rawErrorText);
    }
    if (input === 'valid-token' || typeof input === 'object') {
      if (input === 'valid-token') {
        return this.mockPrincipal;
      }
      if (input && typeof input === 'object' && (input as any).token === 'valid-token') {
        return this.mockPrincipal;
      }
    }
    return null;
  }
}

async function run() {
  const submitPrincipal: VerifiedMachinePrincipal = {
    principalId: 'worker-submit-1',
    isActive: true,
    capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
  };

  const fetchOnlyPrincipal: VerifiedMachinePrincipal = {
    principalId: 'worker-fetch-only',
    isActive: true,
    capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
  };

  const bothCapabilitiesPrincipal: VerifiedMachinePrincipal = {
    principalId: 'worker-both',
    isActive: true,
    capabilities: [
      PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
      PEIAMachineCapability.SUBMIT_ADVISORY_RESULT,
    ],
  };

  // 1. PEIAMachineCapability contains FETCH_PENDING_REVIEW_TASKS
  try {
    const passed = PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS === 'FETCH_PENDING_REVIEW_TASKS';
    tests.push({
      id: testCounter++,
      name: '1. PEIAMachineCapability contains FETCH_PENDING_REVIEW_TASKS',
      passed,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '1. PEIAMachineCapability contains FETCH_PENDING_REVIEW_TASKS', passed: false, message: err.message });
  }

  // 2. PEIAMachineCapability contains SUBMIT_ADVISORY_RESULT
  try {
    const passed = PEIAMachineCapability.SUBMIT_ADVISORY_RESULT === 'SUBMIT_ADVISORY_RESULT';
    tests.push({
      id: testCounter++,
      name: '2. PEIAMachineCapability contains SUBMIT_ADVISORY_RESULT',
      passed,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '2. PEIAMachineCapability contains SUBMIT_ADVISORY_RESULT', passed: false, message: err.message });
  }

  // 3. machine capability vocabulary contains exactly TWO values
  try {
    const keys = Object.keys(PEIAMachineCapability);
    const passed = keys.length === 2 &&
                   keys.includes('FETCH_PENDING_REVIEW_TASKS') &&
                   keys.includes('SUBMIT_ADVISORY_RESULT');
    tests.push({
      id: testCounter++,
      name: '3. machine capability vocabulary contains exactly TWO values',
      passed,
      message: passed ? undefined : `Found keys: ${keys.join(', ')}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '3. machine capability vocabulary contains exactly TWO values', passed: false, message: err.message });
  }

  // 4. authorizeAdvisoryResultSubmission exists
  try {
    const passed = typeof authorizeAdvisoryResultSubmission === 'function';
    tests.push({
      id: testCounter++,
      name: '4. authorizeAdvisoryResultSubmission exists',
      passed,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '4. authorizeAdvisoryResultSubmission exists', passed: false, message: err.message });
  }

  // 5. active verified principal with SUBMIT_ADVISORY_RESULT passes
  try {
    const result = await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(submitPrincipal));
    const passed = result.principalId === 'worker-submit-1' && result.isActive === true;
    tests.push({
      id: testCounter++,
      name: '5. active verified principal with SUBMIT_ADVISORY_RESULT passes',
      passed,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '5. active verified principal with SUBMIT_ADVISORY_RESULT passes', passed: false, message: err.message });
  }

  // 6. successful authorization returns exact same principal reference
  try {
    const verifier = new CountingVerifier(submitPrincipal);
    const result = await authorizeAdvisoryResultSubmission('valid-token', verifier);
    const passed = (result === submitPrincipal);
    tests.push({
      id: testCounter++,
      name: '6. successful authorization returns exact same principal reference',
      passed,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '6. successful authorization returns exact same principal reference', passed: false, message: err.message });
  }

  // 7. verifier null → MACHINE_UNAUTHENTICATED + exact message
  try {
    await authorizeAdvisoryResultSubmission('invalid-token', new CountingVerifier(null));
    tests.push({ id: testCounter++, name: '7. verifier null fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_UNAUTHENTICATED' &&
                    err.message === 'Machine principal authentication failed: Unauthenticated.';
    tests.push({
      id: testCounter++,
      name: '7. verifier null → MACHINE_UNAUTHENTICATED + exact message',
      passed: matched,
      message: matched ? undefined : `Got code ${err?.code}, msg: ${err?.message}`,
    });
  }

  // 8. blank principalId → MACHINE_PRINCIPAL_INVALID + exact message
  try {
    const invalidPrincipal: VerifiedMachinePrincipal = {
      principalId: '   ',
      isActive: true,
      capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
    };
    await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(invalidPrincipal));
    tests.push({ id: testCounter++, name: '8. blank principalId fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_PRINCIPAL_INVALID' &&
                    err.message === 'Machine principal lacks a valid stable identifier.';
    tests.push({
      id: testCounter++,
      name: '8. blank principalId → MACHINE_PRINCIPAL_INVALID + exact message',
      passed: matched,
    });
  }

  // 9. inactive principal → MACHINE_INACTIVE + exact message
  try {
    const inactivePrincipal: VerifiedMachinePrincipal = {
      principalId: 'worker-inactive',
      isActive: false,
      capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT],
    };
    await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(inactivePrincipal));
    tests.push({ id: testCounter++, name: '9. inactive principal fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_INACTIVE' &&
                    err.message === 'Machine principal has been deactivated.';
    tests.push({
      id: testCounter++,
      name: '9. inactive principal → MACHINE_INACTIVE + exact message',
      passed: matched,
    });
  }

  // 10. missing SUBMIT_ADVISORY_RESULT → MACHINE_CAPABILITY_DENIED + exact submission message
  try {
    const noCapPrincipal: VerifiedMachinePrincipal = {
      principalId: 'worker-no-cap',
      isActive: true,
      capabilities: [],
    };
    await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(noCapPrincipal));
    tests.push({ id: testCounter++, name: '10. missing capability fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_CAPABILITY_DENIED' &&
                    err.message === 'Machine principal is not authorized for advisory result submission.';
    tests.push({
      id: testCounter++,
      name: '10. missing SUBMIT_ADVISORY_RESULT → MACHINE_CAPABILITY_DENIED + exact submission message',
      passed: matched,
      message: matched ? undefined : `Got msg: ${err?.message}`,
    });
  }

  // 11. FETCH_PENDING_REVIEW_TASKS-only principal is denied result submission
  try {
    await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(fetchOnlyPrincipal));
    tests.push({ id: testCounter++, name: '11. fetch-only denied submission fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_CAPABILITY_DENIED' &&
                    err.message === 'Machine principal is not authorized for advisory result submission.';
    tests.push({
      id: testCounter++,
      name: '11. FETCH_PENDING_REVIEW_TASKS-only principal is denied result submission',
      passed: matched,
    });
  }

  // 12. SUBMIT_ADVISORY_RESULT-only principal passes result submission
  try {
    const res = await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(submitPrincipal));
    tests.push({
      id: testCounter++,
      name: '12. SUBMIT_ADVISORY_RESULT-only principal passes result submission',
      passed: res.principalId === 'worker-submit-1',
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '12. SUBMIT_ADVISORY_RESULT-only principal passes result submission', passed: false, message: err.message });
  }

  // 13. SUBMIT_ADVISORY_RESULT-only principal is denied pending-task delivery
  try {
    await authorizePendingTaskDelivery('valid-token', new CountingVerifier(submitPrincipal));
    tests.push({ id: testCounter++, name: '13. submit-only denied pending delivery fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_CAPABILITY_DENIED' &&
                    err.message === 'Machine principal is not authorized for pending task delivery.';
    tests.push({
      id: testCounter++,
      name: '13. SUBMIT_ADVISORY_RESULT-only principal is denied pending-task delivery',
      passed: matched,
      message: matched ? undefined : `Got msg: ${err?.message}`,
    });
  }

  // 14. principal with BOTH capabilities passes result submission
  try {
    const res = await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(bothCapabilitiesPrincipal));
    tests.push({
      id: testCounter++,
      name: '14. principal with BOTH capabilities passes result submission',
      passed: res.principalId === 'worker-both',
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '14. principal with BOTH capabilities passes result submission', passed: false, message: err.message });
  }

  // 15. principal with BOTH capabilities passes pending-task delivery
  try {
    const res = await authorizePendingTaskDelivery('valid-token', new CountingVerifier(bothCapabilitiesPrincipal));
    tests.push({
      id: testCounter++,
      name: '15. principal with BOTH capabilities passes pending-task delivery',
      passed: res.principalId === 'worker-both',
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '15. principal with BOTH capabilities passes pending-task delivery', passed: false, message: err.message });
  }

  // 16. verifier throws → MACHINE_AUTHENTICATION_FAILED + exact message
  try {
    await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(null, true));
    tests.push({ id: testCounter++, name: '16. verifier throws fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError &&
                    err.code === 'MACHINE_AUTHENTICATION_FAILED' &&
                    err.message === 'Machine identity verification failed due to an unexpected verification error.';
    tests.push({
      id: testCounter++,
      name: '16. verifier throws → MACHINE_AUTHENTICATION_FAILED + exact message',
      passed: matched,
    });
  }

  // 17. raw verifier error text does not leak
  try {
    await authorizeAdvisoryResultSubmission('valid-token', new CountingVerifier(null, true, 'DB timeout secret_db_pw_777'));
    tests.push({ id: testCounter++, name: '17. raw error text leaks fails', passed: false });
  } catch (err: any) {
    const leaked = err.message.includes('secret_db_pw_777') || err.message.includes('DB timeout');
    tests.push({
      id: testCounter++,
      name: '17. raw verifier error text does not leak',
      passed: !leaked,
    });
  }

  // 18. credential secret text does not leak
  try {
    const toxicCredential = 'super_secret_bearer_token_xyz';
    await authorizeAdvisoryResultSubmission(toxicCredential, new CountingVerifier(null));
    tests.push({ id: testCounter++, name: '18. credential leak fails', passed: false });
  } catch (err: any) {
    const leaked = err.message.includes('super_secret_bearer_token_xyz');
    tests.push({
      id: testCounter++,
      name: '18. credential secret text does not leak',
      passed: !leaked,
    });
  }

  // 19. human-style role claim cannot bypass verifier
  try {
    const fakeCredential = { token: 'invalid', role: 'Admin', permission: 'manage' };
    await authorizeAdvisoryResultSubmission(fakeCredential, new CountingVerifier(null));
    tests.push({ id: testCounter++, name: '19. human role claim bypass fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '19. human-style role claim cannot bypass verifier',
      passed: matched,
    });
  }

  // 20. direct fake principal-shaped credential cannot bypass verifier
  try {
    const fakePrincipalCredential = { principalId: 'hacker', isActive: true, capabilities: [PEIAMachineCapability.SUBMIT_ADVISORY_RESULT] };
    await authorizeAdvisoryResultSubmission(fakePrincipalCredential, new CountingVerifier(null));
    tests.push({ id: testCounter++, name: '20. direct principal bypass fails', passed: false });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '20. direct fake principal-shaped credential cannot bypass verifier',
      passed: matched,
    });
  }

  // 21. submission authorization invokes verifier exactly once
  try {
    const verifier = new CountingVerifier(submitPrincipal);
    await authorizeAdvisoryResultSubmission('valid-token', verifier);
    tests.push({
      id: testCounter++,
      name: '21. submission authorization invokes verifier exactly once',
      passed: verifier.verifyCount === 1,
      message: verifier.verifyCount === 1 ? undefined : `Verify called ${verifier.verifyCount} times`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '21. submission authorization invokes verifier exactly once', passed: false, message: err.message });
  }

  // 22. source structurally proves capability separation and correct delegation
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/machineAuthorizationBoundary.ts');
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');

    const subIdx = sourceCode.indexOf('export async function authorizeAdvisoryResultSubmission');
    const subBody = sourceCode.slice(subIdx);
    const subDelegates = subBody.includes('authorizeWithCapability') &&
                         subBody.includes('PEIAMachineCapability.SUBMIT_ADVISORY_RESULT') &&
                         subBody.includes('Machine principal is not authorized for advisory result submission.') &&
                         !subBody.includes('PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS');

    const fetchIdx = sourceCode.indexOf('export async function authorizePendingTaskDelivery');
    const fetchBody = sourceCode.slice(fetchIdx, subIdx);
    const fetchDelegates = fetchBody.includes('authorizeWithCapability') &&
                          fetchBody.includes('PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS') &&
                          fetchBody.includes('Machine principal is not authorized for pending task delivery.') &&
                          !fetchBody.includes('PEIAMachineCapability.SUBMIT_ADVISORY_RESULT');

    tests.push({
      id: testCounter++,
      name: '22. source structurally proves SUBMIT_ADVISORY_RESULT is required by submission boundary and isolated from fetch',
      passed: subDelegates && fetchDelegates,
      message: (subDelegates && fetchDelegates) ? undefined : `subDelegates: ${subDelegates}, fetchDelegates: ${fetchDelegates}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '22. source structural capability proof', passed: false, message: err.message });
  }

  // 23. production contains no human RBAC / result payload / persistence / network / workflow mutation logic
  try {
    const sourcePath = path.join(process.cwd(), 'functions/src/peia/machineAuthorizationBoundary.ts');
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');
    const forbidden = [
      'AdminRole', 'AdminPermission', 'adminContract',
      'PEIAAdvisoryResult', 'AdvisoryResultUploadRequest', 'validateAdvisoryResultUploadRequest',
      'AIReviewArtifact', 'AIReviewFinding',
      'Firestore', 'firebase', 'getFirestore', 'onRequest', 'onCall',
      'approve', 'publish', 'reject', 'completeTask', 'failTask', 'markUploaded', 'PendingUpload'
    ];
    let foundForbidden = false;
    for (const word of forbidden) {
      if (sourceCode.includes(word)) {
        foundForbidden = true;
        break;
      }
    }
    tests.push({
      id: testCounter++,
      name: '23. production contains no human RBAC / result payload / persistence / network / workflow mutation logic',
      passed: !foundForbidden,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '23. production clean check', passed: false, message: err.message });
  }

  // 24. final self-contained invariant + exact test-count gate (Sections A-P)
  try {
    const preLength = tests.length;
    const preCounter = testCounter;
    const pCountMatch = (preLength === 23) && (preCounter === 24);

    const sourcePath = path.join(process.cwd(), 'functions/src/peia/machineAuthorizationBoundary.ts');
    const code = fs.readFileSync(sourcePath, 'utf8');

    // A. EXACT CAPABILITY VOCABULARY (parsed object body)
    const capObjStart = code.indexOf('export const PEIAMachineCapability = {');
    const capObjEnd = code.indexOf('} as const;');
    const capBody = code.slice(capObjStart, capObjEnd);
    const hasFetchCap = capBody.includes('FETCH_PENDING_REVIEW_TASKS: \'FETCH_PENDING_REVIEW_TASKS\'');
    const hasSubmitCap = capBody.includes('SUBMIT_ADVISORY_RESULT: \'SUBMIT_ADVISORY_RESULT\'');
    const capLines = capBody.split('\n').filter(l => l.includes(':'));
    const aMatch = hasFetchCap && hasSubmitCap && capLines.length === 2;

    // B. EXISTING CAPABILITY PRESERVED
    const bMatch = code.includes('FETCH_PENDING_REVIEW_TASKS');

    // C. NEW CAPABILITY PRESENT
    const cMatch = code.includes('SUBMIT_ADVISORY_RESULT');

    // D. BOTH AUTHORIZATION FUNCTIONS EXIST
    const dMatch = code.includes('export async function authorizePendingTaskDelivery') &&
                   code.includes('export async function authorizeAdvisoryResultSubmission');

    // E. EXACT FUNCTION SIGNATURES (Scoped individually)
    const helperIdx = code.indexOf('async function authorizeWithCapability');
    const fetchIdx = code.indexOf('export async function authorizePendingTaskDelivery');
    const subIdx = code.indexOf('export async function authorizeAdvisoryResultSubmission');

    const fetchSigSection = code.slice(fetchIdx, subIdx);
    const subSigSection = code.slice(subIdx);

    const fetchHasSig = fetchSigSection.includes('credentialInput: unknown') &&
                        fetchSigSection.includes('verifier: MachineIdentityVerifier') &&
                        fetchSigSection.includes('Promise<VerifiedMachinePrincipal>');
    const subHasSig = subSigSection.includes('credentialInput: unknown') &&
                      subSigSection.includes('verifier: MachineIdentityVerifier') &&
                      subSigSection.includes('Promise<VerifiedMachinePrincipal>');
    const eMatch = fetchHasSig && subHasSig;

    // F. COMMON FAIL-CLOSED HELPER
    const helperBody = code.slice(helperIdx, fetchIdx);
    const fMatch = helperBody.includes('verifier.verify(credentialInput)') &&
                   helperBody.includes('principal === null') &&
                   helperBody.includes('principalId') &&
                   helperBody.includes('isActive !== true') &&
                   helperBody.includes('capabilities.includes(requiredCapability)') &&
                   helperBody.includes('return principal');

    // G. STRUCTURAL CAPABILITY ERROR PAIRING
    const capCheckIdx = helperBody.indexOf('if (!principal.capabilities || !principal.capabilities.includes(requiredCapability))');
    const capBranch = helperBody.slice(capCheckIdx);
    const errIdx = capBranch.indexOf('new MachineAuthorizationError(');
    const errBlock = capBranch.slice(errIdx, capBranch.indexOf('});', errIdx) !== -1 ? capBranch.indexOf('});', errIdx) : capBranch.indexOf(')', errIdx) + 50);

    const hasCommonErrors = helperBody.includes('MACHINE_AUTHENTICATION_FAILED') &&
                            helperBody.includes('Machine identity verification failed due to an unexpected verification error.') &&
                            helperBody.includes('MACHINE_UNAUTHENTICATED') &&
                            helperBody.includes('Machine principal authentication failed: Unauthenticated.') &&
                            helperBody.includes('MACHINE_PRINCIPAL_INVALID') &&
                            helperBody.includes('Machine principal lacks a valid stable identifier.') &&
                            helperBody.includes('MACHINE_INACTIVE') &&
                            helperBody.includes('Machine principal has been deactivated.');

    const errBlockIndexCode = errBlock.indexOf('new MachineAuthorizationError(');
    const errBlockCodeIndex = errBlock.indexOf('\'MACHINE_CAPABILITY_DENIED\'');
    const errBlockMsgIndex = errBlock.indexOf('capabilityDeniedMessage');

    const strictOrder = errBlockIndexCode !== -1 &&
                        errBlockCodeIndex !== -1 &&
                        errBlockMsgIndex !== -1 &&
                        errBlockIndexCode < errBlockCodeIndex &&
                        errBlockCodeIndex < errBlockMsgIndex;

    const noHardcodedSpecificMsg = !errBlock.includes('Machine principal is not authorized for pending task delivery.') &&
                                   !errBlock.includes('Machine principal is not authorized for advisory result submission.');

    const gMatch = hasCommonErrors && strictOrder && noHardcodedSpecificMsg;

    // H & J. PENDING FUNCTION BODY PROOFS
    const fetchBodyFull = code.slice(fetchIdx, subIdx);
    const hMatch = fetchBodyFull.includes('PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS') &&
                   !fetchBodyFull.includes('PEIAMachineCapability.SUBMIT_ADVISORY_RESULT');
    const jMatch = fetchBodyFull.includes('Machine principal is not authorized for pending task delivery.');

    // I & K. SUBMISSION FUNCTION BODY PROOFS
    const subBodyFull = code.slice(subIdx);
    const iMatch = subBodyFull.includes('PEIAMachineCapability.SUBMIT_ADVISORY_RESULT') &&
                   !subBodyFull.includes('PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS');
    const kMatch = subBodyFull.includes('Machine principal is not authorized for advisory result submission.');

    // L. CAPABILITY SEPARATION STRUCTURAL PROOF
    const lMatch = !fetchBodyFull.includes('SUBMIT_ADVISORY_RESULT') && !subBodyFull.includes('FETCH_PENDING_REVIEW_TASKS');

    // M. NO HUMAN RBAC COUPLING
    const mMatch = !code.includes('AdminRole') && !code.includes('AdminPermission') && !code.includes('adminContract');

    // N. NO RESULT PAYLOAD VALIDATION
    const nMatch = !code.includes('PEIAAdvisoryResult') && !code.includes('AdvisoryResultUploadRequest') && !code.includes('validateAdvisoryResultUploadRequest') && !code.includes('AIReviewArtifact') && !code.includes('AIReviewFinding');

    // O. NO PERSISTENCE / NETWORK / WORKFLOW MUTATION
    const oMatch = !code.includes('Firestore') && !code.includes('firebase') && !code.includes('getFirestore') &&
                   !code.includes('collection(') && !code.includes('doc(') && !code.includes('set(') &&
                   !code.includes('add(') && !code.includes('update(') && !code.includes('delete(') &&
                   !code.includes('fetch(') && !code.includes('onRequest') && !code.includes('onCall') &&
                   !code.includes('completeTask') && !code.includes('failTask') && !code.includes('markUploaded') &&
                   !code.includes('PendingUpload') && !code.includes('AITaskStatus.Completed') && !code.includes('AITaskStatus.Failed');

    const allPassed = aMatch && bMatch && cMatch && dMatch && eMatch && fMatch && gMatch &&
                      hMatch && iMatch && jMatch && kMatch && lMatch && mMatch && nMatch &&
                      oMatch && pCountMatch;

    tests.push({
      id: testCounter++,
      name: '24. final self-contained invariant + exact test-count gate (Sections A-P)',
      passed: allPassed,
      message: allPassed ? undefined : `Failed sections: A:${aMatch} B:${bMatch} C:${cMatch} D:${dMatch} E:${eMatch} F:${fMatch} G:${gMatch} H:${hMatch} I:${iMatch} J:${jMatch} K:${kMatch} L:${lMatch} M:${mMatch} N:${nMatch} O:${oMatch} P:${pCountMatch}`,
    });
  } catch (err: any) {
    tests.push({ id: testCounter++, name: '24. final self-contained invariant (Sections A-P)', passed: false, message: err.message });
  }

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA ADVISORY RESULT SUBMISSION AUTHORIZATION TESTS');
  console.log('====================================================\n');

  let failed = 0;
  for (const t of tests) {
    if (t.passed) {
      console.log(`✅ [${t.id}] ${t.name}`);
    } else {
      failed++;
      console.error(`❌ [${t.id}] ${t.name}`);
      if (t.message) {
        console.error(`   ${t.message}`);
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY: ${tests.length - failed} passed / ${tests.length} total / ${failed} failed`);
  console.log('----------------------------------------------------');

  const finalTestsLengthValid = tests.length === 24;
  const finalTestCounterValid = testCounter === 25;

  if (failed > 0 || !finalTestsLengthValid || !finalTestCounterValid) {
    console.error(`ERROR: Final gate violation! failed=${failed}, tests.length=${tests.length} (expected 24), testCounter=${testCounter} (expected 25)`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
