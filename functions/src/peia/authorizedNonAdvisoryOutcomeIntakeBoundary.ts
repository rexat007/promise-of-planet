import {
  MachineIdentityVerifier,
  VerifiedMachinePrincipal,
  authorizeTaskProcessingOutcomeSubmission,
} from './machineAuthorizationBoundary';
import {
  NonAdvisoryOutcomeIntakeRequest,
  validateNonAdvisoryOutcomeIntakeRequest,
} from './nonAdvisoryOutcomeIntakeContract';

export interface AuthorizedNonAdvisoryOutcomeIntake {
  readonly principal: VerifiedMachinePrincipal;
  readonly request: NonAdvisoryOutcomeIntakeRequest;
}

export async function authorizeAndValidateNonAdvisoryOutcomeIntake(
  credentialInput: unknown,
  intakeInput: unknown,
  verifier: MachineIdentityVerifier
): Promise<AuthorizedNonAdvisoryOutcomeIntake> {
  const principal = await authorizeTaskProcessingOutcomeSubmission(
    credentialInput,
    verifier
  );

  const request = validateNonAdvisoryOutcomeIntakeRequest(
    intakeInput
  );

  return {
    principal,
    request,
  };
}
