import {
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

// Mocks
class FakeVerifier implements MachineIdentityVerifier {
  constructor(
    private readonly mockPrincipal: VerifiedMachinePrincipal | null,
    private readonly shouldThrow: boolean = false
  ) {}

  async verify(input: unknown): Promise<VerifiedMachinePrincipal | null> {
    if (this.shouldThrow) {
      throw new Error('Database down');
    }
    // Verify behaves securely: it resolves a real principal only if input matches
    if (input === 'valid-token') {
      return this.mockPrincipal;
    }
    return null;
  }
}

async function run() {
  // 1. Verified active principal with FETCH_PENDING_REVIEW_TASKS passes
  try {
    const p: VerifiedMachinePrincipal = {
      principalId: 'worker-node-1',
      isActive: true,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    };
    const result = await authorizePendingTaskDelivery('valid-token', new FakeVerifier(p));
    const passed = result.principalId === 'worker-node-1' && result.isActive === true;
    tests.push({
      id: testCounter++,
      name: '1. Verified active principal with FETCH_PENDING_REVIEW_TASKS passes',
      passed,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '1. Verified active principal with FETCH_PENDING_REVIEW_TASKS passes',
      passed: false,
      message: err.message,
    });
  }

  // 2. Verifier returns null → MACHINE_UNAUTHENTICATED
  try {
    await authorizePendingTaskDelivery('invalid-token', new FakeVerifier(null));
    tests.push({
      id: testCounter++,
      name: '2. Verifier returns null fails',
      passed: false,
      message: 'Expected failure, but passed.',
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '2. Verifier returns null → MACHINE_UNAUTHENTICATED',
      passed: matched,
      message: matched ? undefined : `Expected MACHINE_UNAUTHENTICATED, got ${err.code}`,
    });
  }

  // 3. Blank principalId → MACHINE_PRINCIPAL_INVALID
  try {
    const p: VerifiedMachinePrincipal = {
      principalId: '   ',
      isActive: true,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    };
    await authorizePendingTaskDelivery('valid-token', new FakeVerifier(p));
    tests.push({
      id: testCounter++,
      name: '3. Blank principalId fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_PRINCIPAL_INVALID';
    tests.push({
      id: testCounter++,
      name: '3. Blank principalId → MACHINE_PRINCIPAL_INVALID',
      passed: matched,
    });
  }

  // 4. Inactive principal → MACHINE_INACTIVE
  try {
    const p: VerifiedMachinePrincipal = {
      principalId: 'worker-node-inactive',
      isActive: false,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    };
    await authorizePendingTaskDelivery('valid-token', new FakeVerifier(p));
    tests.push({
      id: testCounter++,
      name: '4. Inactive principal fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_INACTIVE';
    tests.push({
      id: testCounter++,
      name: '4. Inactive principal → MACHINE_INACTIVE',
      passed: matched,
    });
  }

  // 5. Active principal without required capability → MACHINE_CAPABILITY_DENIED
  try {
    const p: VerifiedMachinePrincipal = {
      principalId: 'worker-node-no-cap',
      isActive: true,
      capabilities: [],
    };
    await authorizePendingTaskDelivery('valid-token', new FakeVerifier(p));
    tests.push({
      id: testCounter++,
      name: '5. Principal without capabilities fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_CAPABILITY_DENIED';
    tests.push({
      id: testCounter++,
      name: '5. Active principal without required capability → MACHINE_CAPABILITY_DENIED',
      passed: matched,
    });
  }

  // 6. Principal with unrelated capability only fails
  try {
    const p: VerifiedMachinePrincipal = {
      principalId: 'worker-node-other',
      isActive: true,
      capabilities: ['SUBMIT_RESULTS' as any],
    };
    await authorizePendingTaskDelivery('valid-token', new FakeVerifier(p));
    tests.push({
      id: testCounter++,
      name: '6. Unrelated capability fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_CAPABILITY_DENIED';
    tests.push({
      id: testCounter++,
      name: '6. Principal with unrelated capability only fails',
      passed: matched,
    });
  }

  // 7. Verifier throws → fail-closed bounded machine-auth error
  try {
    await authorizePendingTaskDelivery('valid-token', new FakeVerifier(null, true));
    tests.push({
      id: testCounter++,
      name: '7. Verifier throws fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_AUTHENTICATION_FAILED';
    tests.push({
      id: testCounter++,
      name: '7. Verifier throws → fail-closed bounded machine-auth error',
      passed: matched,
    });
  }

  // 8. Credential contents are not echoed into error message
  try {
    const toxicToken = 'secret_toxic_123456';
    await authorizePendingTaskDelivery(toxicToken, new FakeVerifier(null));
  } catch (err: any) {
    const contained = err.message.includes('toxic') || err.message.includes('secret') || err.message.includes('123456');
    tests.push({
      id: testCounter++,
      name: '8. Credential contents are not echoed into error message',
      passed: !contained,
    });
  }

  // 9. Human-style role claim in credential input does NOT bypass verifier
  try {
    const inputWithRole = { token: 'unauthorized', role: 'AIAssistant' };
    await authorizePendingTaskDelivery(inputWithRole, new FakeVerifier(null));
    tests.push({
      id: testCounter++,
      name: '9. Role claim bypass fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '9. Human-style role claim in credential input does NOT bypass verifier',
      passed: matched,
    });
  }

  // 10. Direct fake principal object passed as credential does NOT authorize unless verifier independently verifies it
  try {
    const bypassObject = {
      principalId: 'hacker-node',
      isActive: true,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    };
    // The verifier is configured to reject everything except literal token 'valid-token'
    await authorizePendingTaskDelivery(bypassObject, new FakeVerifier(bypassObject));
    tests.push({
      id: testCounter++,
      name: '10. Direct principal object bypass fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineAuthorizationError && err.code === 'MACHINE_UNAUTHENTICATED';
    tests.push({
      id: testCounter++,
      name: '10. Direct fake principal object passed as credential does NOT authorize without verifier confirmation',
      passed: matched,
    });
  }

  // 11. Authorized return preserves principalId and capability
  try {
    const p: VerifiedMachinePrincipal = {
      principalId: 'worker-alpha',
      isActive: true,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    };
    const result = await authorizePendingTaskDelivery('valid-token', new FakeVerifier(p));
    const matched = result.principalId === 'worker-alpha' && result.capabilities.includes('FETCH_PENDING_REVIEW_TASKS');
    tests.push({
      id: testCounter++,
      name: '11. Authorized return preserves principalId and capability',
      passed: matched,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '11. Authorized return preserves principalId and capability',
      passed: false,
    });
  }

  // 12. No AdminRole/AdminPermission import exists in production PEIA auth boundary
  const prodAuthFilePath = path.join(process.cwd(), 'functions/src/peia/machineAuthorizationBoundary.ts');
  const code = fs.readFileSync(prodAuthFilePath, 'utf8');
  const cleanOfHumanRBAC = !code.includes('AdminRole') && !code.includes('AdminPermission') && !code.includes('adminContract');
  tests.push({
    id: testCounter++,
    name: '12. No AdminRole/AdminPermission import exists in production PEIA auth boundary',
    passed: cleanOfHumanRBAC,
  });

  // 13. No endpoint is added to functions index
  const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
  const indexCode = fs.readFileSync(indexPath, 'utf8');
  const cleanIndex = !indexCode.includes('/peia') && !indexCode.includes('peia') && !indexCode.includes('machineAuthorization');
  tests.push({
    id: testCounter++,
    name: '13. No endpoint is added to functions/src/index.ts',
    passed: cleanIndex,
  });

  // 14. No secret implementation is added
  const secretsPath = path.join(process.cwd(), 'functions/src/youtube/youtubeSecrets.ts');
  const secretsCode = fs.readFileSync(secretsPath, 'utf8');
  const cleanSecrets = !secretsCode.includes('PEIA') && !secretsCode.includes('peia');
  tests.push({
    id: testCounter++,
    name: '14. No secret implementation is added or modified',
    passed: cleanSecrets,
  });

  // Log summary
  console.log('====================================================');
  console.log('RUNNING PEIA-16C MACHINE AUTHORIZATION TESTS');
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
