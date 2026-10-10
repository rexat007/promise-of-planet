import { authorizeAndValidateNonAdvisoryOutcomeIntake } from '../functions/src/peia/authorizedNonAdvisoryOutcomeIntakeBoundary';
import { PEIAMachineCapability, MachineAuthorizationError } from '../functions/src/peia/machineAuthorizationBoundary';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Running PEIA Non-Advisory Outcome Authorization Boundary Tests ---');

const mockVerifier = {
  verify: async (credentialInput: unknown) => {
    if (credentialInput === 'valid-token') {
      return {
        principalId: 'machine-principal-1',
        isActive: true,
        capabilities: [PEIAMachineCapability.SUBMIT_TASK_PROCESSING_OUTCOME],
      };
    }
    if (credentialInput === 'no-capability-token') {
      return {
        principalId: 'machine-principal-2',
        isActive: true,
        capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
      };
    }
    return null;
  },
};

const validIntake = {
  outcome: {
    taskId: 'task-auth-1',
    kind: 'ABSTAINED',
    reason: 'NO_EVIDENCE',
    modelAttempts: 0,
    createdAt: new Date().toISOString(),
  },
};

async function testSuccess() {
  const authorized = await authorizeAndValidateNonAdvisoryOutcomeIntake(
    'valid-token',
    validIntake,
    mockVerifier
  );
  assert(authorized.principal.principalId === 'machine-principal-1', 'Principal ID matches');
  assert(authorized.request.outcome.taskId === 'task-auth-1', 'Task ID matches');
}

async function testDeniedCapability() {
  try {
    await authorizeAndValidateNonAdvisoryOutcomeIntake(
      'no-capability-token',
      validIntake,
      mockVerifier
    );
    console.error('FAILED: expected MachineAuthorizationError for denied capability');
    process.exit(1);
  } catch (err) {
    assert(err instanceof MachineAuthorizationError, 'Expected MachineAuthorizationError');
    assert((err as MachineAuthorizationError).code === 'MACHINE_CAPABILITY_DENIED', 'Code is MACHINE_CAPABILITY_DENIED');
  }
}

async function run() {
  await testSuccess();
  await testDeniedCapability();
  console.log('PASSED: All Non-Advisory Outcome Authorization Boundary tests passed.');
}

run().catch((err) => {
  console.error('FAILED with unexpected error:', err);
  process.exit(1);
});
