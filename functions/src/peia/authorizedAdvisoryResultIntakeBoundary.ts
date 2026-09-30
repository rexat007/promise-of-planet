import {
  MachineIdentityVerifier,
  VerifiedMachinePrincipal,
  authorizeAdvisoryResultSubmission,
} from './machineAuthorizationBoundary';
import {
  AdvisoryResultIntakeRequest,
  validateAdvisoryResultIntakeRequest,
} from './advisoryResultIntakeContract';

export interface AuthorizedAdvisoryResultIntake {
  readonly principal: VerifiedMachinePrincipal;
  readonly request: AdvisoryResultIntakeRequest;
}

export async function authorizeAndValidateAdvisoryResultIntake(
  credentialInput: unknown,
  intakeInput: unknown,
  verifier: MachineIdentityVerifier
): Promise<AuthorizedAdvisoryResultIntake> {
  const principal = await authorizeAdvisoryResultSubmission(
    credentialInput,
    verifier
  );

  const request = validateAdvisoryResultIntakeRequest(
    intakeInput
  );

  return {
    principal,
    request,
  };
}
