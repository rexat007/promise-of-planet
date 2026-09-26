import {
  hashOpaqueMachineCredential,
  OpaqueMachineIdentityVerifier,
  MachineCredentialBindingRepository,
} from '../functions/src/peia/machineCredentialVerifier';
import {
  MachineCredentialContractError,
  ValidatedMachineCredentialDigest,
  MachineCredentialBinding,
} from '../functions/src/peia/machineCredentialContract';
import { authorizeAndPreparePendingTaskDelivery } from '../functions/src/peia/authorizedTaskDeliveryBoundary';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
import { AITaskType, AITaskStatus } from '../src/types/aiTask';
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

class FakeBindingRepository implements MachineCredentialBindingRepository {
  public receivedDigest: ValidatedMachineCredentialDigest | null = null;
  public called = false;

  constructor(
    private readonly bindings: Record<string, MachineCredentialBinding>,
    private readonly shouldThrow: boolean = false,
    private readonly mismatchReturn: boolean = false,
    private readonly mismatchAlgorithm: boolean = false
  ) {}

  async findByCredentialDigest(
    digest: ValidatedMachineCredentialDigest
  ): Promise<MachineCredentialBinding | null> {
    this.called = true;
    this.receivedDigest = digest;

    if (this.shouldThrow) {
      throw new Error('Database query failure!');
    }

    if (this.mismatchReturn) {
      return {
        credentialDigest: { algorithm: 'SHA-256', value: 'mismatched-digest-value-here-1234567890abcdef' },
        principal: {
          principalId: 'node-rogue',
          isActive: true,
          capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
        },
      };
    }

    if (this.mismatchAlgorithm) {
      return {
        credentialDigest: { algorithm: 'MD5' as any, value: digest.value },
        principal: {
          principalId: 'node-rogue',
          isActive: true,
          capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
        },
      };
    }

    return this.bindings[digest.value] || null;
  }
}

async function run() {
  // Setup standard deterministic objects
  const testCredential = 'peia_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const expectedDigest = 'e11419fd6f8b8d253bbffa1251f34a34e8d59f16611484e59f505bf6be3f82f5';

  const activePrincipal = {
    principalId: 'node-delta',
    isActive: true,
    capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS] as const,
  };

  const dbBindings: Record<string, MachineCredentialBinding> = {
    [expectedDigest]: {
      credentialDigest: { algorithm: 'SHA-256', value: expectedDigest },
      principal: activePrincipal,
    },
  };

  // 1. Known SHA-256 vector matches exactly
  try {
    const res = hashOpaqueMachineCredential(testCredential);
    const matched = res.value === expectedDigest;
    tests.push({
      id: testCounter++,
      name: '1. Known SHA-256 vector matches exactly',
      passed: matched,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '1. Known SHA-256 vector matches exactly',
      passed: false,
      message: err.message,
    });
  }

  // 2. Hashing output is lowercase 64-char hex
  try {
    const res = hashOpaqueMachineCredential(testCredential);
    const lowercaseHexPattern = /^[a-f0-9]{64}$/;
    const matched = lowercaseHexPattern.test(res.value);
    tests.push({
      id: testCounter++,
      name: '2. Hashing output is lowercase 64-char hex',
      passed: matched,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '2. Hashing output is lowercase 64-char hex',
      passed: false,
    });
  }

  // 3. Hashing preserves exact credential semantics with no trim/normalization
  try {
    // String has valid length but a space is trailing, so it fails format check rather than being normalized
    const spaceCredential = testCredential + ' ';
    hashOpaqueMachineCredential(spaceCredential);
    tests.push({
      id: testCounter++,
      name: '3. Hashing preserves exact credential semantics with no trim/normalization',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
    tests.push({
      id: testCounter++,
      name: '3. Hashing preserves exact credential semantics with no trim/normalization',
      passed: matched,
    });
  }

  // 4. Invalid credential type causes hashOpaqueMachineCredential to throw MachineCredentialContractError
  try {
    hashOpaqueMachineCredential({ token: 'abc' });
    tests.push({
      id: testCounter++,
      name: '4. Invalid credential type causes throw',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_TYPE';
    tests.push({
      id: testCounter++,
      name: '4. Invalid credential type causes hashOpaqueMachineCredential to throw MachineCredentialContractError',
      passed: matched,
    });
  }

  // 5. Invalid credential format causes hashOpaqueMachineCredential to throw MachineCredentialContractError
  try {
    hashOpaqueMachineCredential('peia_v1_short');
    tests.push({
      id: testCounter++,
      name: '5. Invalid credential format causes throw',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
    tests.push({
      id: testCounter++,
      name: '5. Invalid credential format causes hashOpaqueMachineCredential to throw MachineCredentialContractError',
      passed: matched,
    });
  }

  // 6. Verifier with valid credential + matching binding returns principal
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const principal = await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '6. Verifier with valid credential + matching binding returns principal',
      passed: principal !== null && principal.principalId === 'node-delta',
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '6. Verifier with valid credential + matching binding returns principal',
      passed: false,
      message: err.message,
    });
  }

  // 7. Verifier invalid credential format returns null
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const res = await verifier.verify('peia_v1_invalid_format_short');
    tests.push({
      id: testCounter++,
      name: '7. Verifier invalid credential format returns null',
      passed: res === null,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '7. Verifier invalid credential format returns null',
      passed: false,
    });
  }

  // 8. Verifier non-string credential returns null
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const res = await verifier.verify(987654321);
    tests.push({
      id: testCounter++,
      name: '8. Verifier non-string credential returns null',
      passed: res === null,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '8. Verifier non-string credential returns null',
      passed: false,
    });
  }

  // 9. Verifier unknown valid-format credential returns null
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const res = await verifier.verify('peia_v1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    tests.push({
      id: testCounter++,
      name: '9. Verifier unknown valid-format credential returns null',
      passed: res === null,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '9. Verifier unknown valid-format credential returns null',
      passed: false,
    });
  }

  // 10. Repository receives digest only, never raw credential
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await verifier.verify(testCredential);
    const receivesOnlyDigest = repo.receivedDigest !== null && 
                                !('rawCredential' in (repo.receivedDigest as any)) &&
                                !('credential' in (repo.receivedDigest as any));
    tests.push({
      id: testCounter++,
      name: '10. Repository receives digest only, never raw credential',
      passed: receivesOnlyDigest,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '10. Repository receives digest only, never raw credential',
      passed: false,
    });
  }

  // 11. Repository lookup digest equals expected SHA-256 digest
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await verifier.verify(testCredential);
    const equalsExpected = repo.receivedDigest?.value === expectedDigest;
    tests.push({
      id: testCounter++,
      name: '11. Repository lookup digest equals expected SHA-256 digest',
      passed: equalsExpected,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '11. Repository lookup digest equals expected SHA-256 digest',
      passed: false,
    });
  }

  // 12. Mismatched returned binding digest returns null
  try {
    const repo = new FakeBindingRepository(dbBindings, false, true); // mismatchReturn = true
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const res = await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '12. Mismatched returned binding digest returns null',
      passed: res === null,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '12. Mismatched returned binding digest returns null',
      passed: false,
    });
  }

  // 13. Mismatched algorithm returns null
  try {
    const repo = new FakeBindingRepository(dbBindings, false, false, true); // mismatchAlgorithm = true
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const res = await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '13. Mismatched algorithm returns null',
      passed: res === null,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '13. Mismatched algorithm returns null',
      passed: false,
    });
  }

  // 14. Repository thrown error propagates from verifier
  try {
    const repo = new FakeBindingRepository(dbBindings, true); // shouldThrow = true
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '14. Repository error propagates',
      passed: false,
    });
  } catch (err: any) {
    const matched = err.message === 'Database query failure!';
    tests.push({
      id: testCounter++,
      name: '14. Repository thrown error propagates from verifier',
      passed: matched,
    });
  }

  // 15. Repository error does NOT become null
  try {
    const repo = new FakeBindingRepository(dbBindings, true);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '15. Repository error does NOT become null',
      passed: false,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '15. Repository error does NOT become null',
      passed: true,
    });
  }

  // 16. Invalid credential does NOT call repository
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await verifier.verify('invalid-token');
    tests.push({
      id: testCounter++,
      name: '16. Invalid credential does NOT call repository',
      passed: !repo.called,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '16. Invalid credential does NOT call repository',
      passed: false,
    });
  }

  // 17. Verifier does not validate principal active state
  try {
    const inactivePrincipal = { ...activePrincipal, isActive: false };
    const customBindings = {
      [expectedDigest]: {
        credentialDigest: { algorithm: 'SHA-256' as const, value: expectedDigest },
        principal: inactivePrincipal,
      },
    };
    const repo = new FakeBindingRepository(customBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const principal = await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '17. Verifier does not validate principal active state (it returns it unchanged)',
      passed: principal !== null && principal.isActive === false,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '17. Verifier does not validate principal active state (it returns it unchanged)',
      passed: false,
    });
  }

  // 18. Verifier does not validate machine capabilities
  try {
    const emptyCapPrincipal = { ...activePrincipal, capabilities: [] };
    const customBindings = {
      [expectedDigest]: {
        credentialDigest: { algorithm: 'SHA-256' as const, value: expectedDigest },
        principal: emptyCapPrincipal,
      },
    };
    const repo = new FakeBindingRepository(customBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const principal = await verifier.verify(testCredential);
    tests.push({
      id: testCounter++,
      name: '18. Verifier does not validate machine capabilities',
      passed: principal !== null && principal.capabilities.length === 0,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '18. Verifier does not validate machine capabilities',
      passed: false,
    });
  }

  // 19. through authorizePendingTaskDelivery: valid credential + active authorized principal succeeds
  const mockTask = {
    taskId: 'task-123',
    taskType: AITaskType.CONTENT_REVIEW,
    target: {
      targetType: 'News' as const,
      targetId: 'news-abc',
      sourceUpdatedAt: '2026-09-26T04:00:00Z',
    },
    contentSnapshot: { text: 'co2 emissions' },
    createdAt: '2026-09-26T04:10:00Z',
    status: AITaskStatus.Pending,
  };

  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    const res = await authorizeAndPreparePendingTaskDelivery(testCredential, mockTask, verifier);
    tests.push({
      id: testCounter++,
      name: '19. through authorizePendingTaskDelivery: valid credential + active authorized principal succeeds',
      passed: res.principal.principalId === 'node-delta' && res.task.taskId === 'task-123',
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '19. through authorizePendingTaskDelivery: valid credential + active authorized principal succeeds',
      passed: false,
      message: err.message,
    });
  }

  // 20. through authorizePendingTaskDelivery: invalid credential becomes MACHINE_UNAUTHENTICATED
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await authorizeAndPreparePendingTaskDelivery('invalid-token', mockTask, verifier);
    tests.push({
      id: testCounter++,
      name: '20. invalid credential fails with MACHINE_UNAUTHENTICATED',
      passed: false,
    });
  } catch (err: any) {
    const matched = err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '20. through authorizePendingTaskDelivery: invalid credential becomes MACHINE_UNAUTHENTICATED',
      passed: matched,
    });
  }

  // 21. through authorizePendingTaskDelivery: unknown valid-format credential becomes MACHINE_UNAUTHENTICATED
  try {
    const repo = new FakeBindingRepository(dbBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await authorizeAndPreparePendingTaskDelivery('peia_v1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', mockTask, verifier);
    tests.push({
      id: testCounter++,
      name: '21. unknown valid credential fails with MACHINE_UNAUTHENTICATED',
      passed: false,
    });
  } catch (err: any) {
    const matched = err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '21. through authorizePendingTaskDelivery: unknown valid-format credential becomes MACHINE_UNAUTHENTICATED',
      passed: matched,
    });
  }

  // 22. through authorizePendingTaskDelivery: repository exception becomes MACHINE_AUTHENTICATION_FAILED
  try {
    const repo = new FakeBindingRepository(dbBindings, true); // throws
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await authorizeAndPreparePendingTaskDelivery(testCredential, mockTask, verifier);
    tests.push({
      id: testCounter++,
      name: '22. repository exception becomes MACHINE_AUTHENTICATION_FAILED',
      passed: false,
    });
  } catch (err: any) {
    const matched = err.code === 'MACHINE_AUTHENTICATION_FAILED';
    tests.push({
      id: testCounter++,
      name: '22. through authorizePendingTaskDelivery: repository exception becomes MACHINE_AUTHENTICATION_FAILED',
      passed: matched,
    });
  }

  // 23. through authorizePendingTaskDelivery: inactive bound principal becomes MACHINE_INACTIVE
  try {
    const inactivePrincipal = { ...activePrincipal, isActive: false };
    const customBindings = {
      [expectedDigest]: {
        credentialDigest: { algorithm: 'SHA-256' as const, value: expectedDigest },
        principal: inactivePrincipal,
      },
    };
    const repo = new FakeBindingRepository(customBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await authorizeAndPreparePendingTaskDelivery(testCredential, mockTask, verifier);
    tests.push({
      id: testCounter++,
      name: '23. inactive bound principal fails with MACHINE_INACTIVE',
      passed: false,
    });
  } catch (err: any) {
    const matched = err.code === 'MACHINE_INACTIVE';
    tests.push({
      id: testCounter++,
      name: '23. through authorizePendingTaskDelivery: inactive bound principal becomes MACHINE_INACTIVE',
      passed: matched,
    });
  }

  // 24. through authorizePendingTaskDelivery: principal lacking capability becomes MACHINE_CAPABILITY_DENIED
  try {
    const emptyCapPrincipal = { ...activePrincipal, capabilities: [] };
    const customBindings = {
      [expectedDigest]: {
        credentialDigest: { algorithm: 'SHA-256' as const, value: expectedDigest },
        principal: emptyCapPrincipal,
      },
    };
    const repo = new FakeBindingRepository(customBindings);
    const verifier = new OpaqueMachineIdentityVerifier(repo);
    await authorizeAndPreparePendingTaskDelivery(testCredential, mockTask, verifier);
    tests.push({
      id: testCounter++,
      name: '24. lacking capability fails with MACHINE_CAPABILITY_DENIED',
      passed: false,
    });
  } catch (err: any) {
    const matched = err.code === 'MACHINE_CAPABILITY_DENIED';
    tests.push({
      id: testCounter++,
      name: '24. through authorizePendingTaskDelivery: principal lacking capability becomes MACHINE_CAPABILITY_DENIED',
      passed: matched,
    });
  }

  // 25. raw credential does not appear in verifier error messages
  try {
    const badToken = 'peia_v1_SECRET_DO_NOT_LOG_TOKEN_VALUE_ABCDE_12';
    hashOpaqueMachineCredential(badToken);
  } catch (err: any) {
    const containsSecret = err.message.includes('SECRET_DO_NOT_LOG_TOKEN');
    tests.push({
      id: testCounter++,
      name: '25. raw credential does not appear in verifier error messages',
      passed: !containsSecret,
    });
  }

  // 26. no raw credential persistence API exists
  const prodFilePath = path.join(process.cwd(), 'functions/src/peia/machineCredentialVerifier.ts');
  const code = fs.readFileSync(prodFilePath, 'utf8');
  const noRawPersistence = !code.includes('saveRaw') && !code.includes('persistRaw') && !code.includes('writeRaw');
  tests.push({
    id: testCounter++,
    name: '26. no raw credential persistence API exists',
    passed: noRawPersistence,
  });

  // 27. no Firestore imports exist in production verifier file
  const noFirestore = !code.includes('firebase-admin/firestore') && !code.includes('firestore()');
  tests.push({
    id: testCounter++,
    name: '27. no Firestore imports exist in production verifier file',
    passed: noFirestore,
  });

  // 28. no Firebase Functions/HTTP imports exist
  const noHttp = !code.includes('firebase-functions') && !code.includes('express') && !code.includes('HttpsError');
  tests.push({
    id: testCounter++,
    name: '28. no Firebase Functions/HTTP imports exist',
    passed: noHttp,
  });

  // 29. no human Admin RBAC references exist
  const noAdminRBAC = !code.includes('AdminRole') && !code.includes('AdminPermission') && !code.includes('AdminUser');
  tests.push({
    id: testCounter++,
    name: '29. no human Admin RBAC references exist',
    passed: noAdminRBAC,
  });

  // 30. no credential generator exists
  const noGenerator = !code.includes('randomBytes') && !code.includes('generateCredential');
  tests.push({
    id: testCounter++,
    name: '30. no credential generator exists',
    passed: noGenerator,
  });

  // 31. functions/src/index.ts remains untouched
  const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
  const indexCode = fs.readFileSync(indexPath, 'utf8');
  const indexUntouched = !indexCode.includes('OpaqueMachineIdentityVerifier') && !indexCode.includes('hashOpaqueMachineCredential');
  tests.push({
    id: testCounter++,
    name: '31. functions/src/index.ts remains untouched',
    passed: indexUntouched,
  });

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA-16H MACHINE CREDENTIAL VERIFIER TESTS');
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

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
