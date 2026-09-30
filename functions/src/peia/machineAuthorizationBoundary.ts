/**
 * Machine Authorization Boundary for PEIA External Workers.
 * 
 * CRITICAL IDENTITY SEPARATION RULE:
 * Machine identity operates as a separate machine principal and MUST NOT reuse
 * human administrator RBAC roles/permissions contracts.
 */

export const PEIAMachineCapability = {
  FETCH_PENDING_REVIEW_TASKS: 'FETCH_PENDING_REVIEW_TASKS',
  SUBMIT_ADVISORY_RESULT: 'SUBMIT_ADVISORY_RESULT',
} as const;

export type PEIAMachineCapability = typeof PEIAMachineCapability[keyof typeof PEIAMachineCapability];

export interface VerifiedMachinePrincipal {
  readonly principalId: string;
  readonly isActive: boolean;
  readonly capabilities: readonly PEIAMachineCapability[];
}

export interface MachineIdentityVerifier {
  verify(input: unknown): Promise<VerifiedMachinePrincipal | null>;
}

export class MachineAuthorizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MachineAuthorizationError';
    this.code = code;
  }
}

async function authorizeWithCapability(
  credentialInput: unknown,
  verifier: MachineIdentityVerifier,
  requiredCapability: PEIAMachineCapability,
  capabilityDeniedMessage: string
): Promise<VerifiedMachinePrincipal> {
  let principal: VerifiedMachinePrincipal | null = null;

  try {
    principal = await verifier.verify(credentialInput);
  } catch (err: any) {
    throw new MachineAuthorizationError(
      'MACHINE_AUTHENTICATION_FAILED',
      'Machine identity verification failed due to an unexpected verification error.'
    );
  }

  if (principal === null) {
    throw new MachineAuthorizationError(
      'MACHINE_UNAUTHENTICATED',
      'Machine principal authentication failed: Unauthenticated.'
    );
  }

  if (typeof principal.principalId !== 'string' || principal.principalId.trim() === '') {
    throw new MachineAuthorizationError(
      'MACHINE_PRINCIPAL_INVALID',
      'Machine principal lacks a valid stable identifier.'
    );
  }

  if (principal.isActive !== true) {
    throw new MachineAuthorizationError(
      'MACHINE_INACTIVE',
      'Machine principal has been deactivated.'
    );
  }

  if (!principal.capabilities || !principal.capabilities.includes(requiredCapability)) {
    throw new MachineAuthorizationError(
      'MACHINE_CAPABILITY_DENIED',
      capabilityDeniedMessage
    );
  }

  return principal;
}

/**
 * Authorizes a machine principal for Pending task delivery eligibility.
 * Fails closed on any authentication or permission check failure.
 */
export async function authorizePendingTaskDelivery(
  credentialInput: unknown,
  verifier: MachineIdentityVerifier
): Promise<VerifiedMachinePrincipal> {
  return authorizeWithCapability(
    credentialInput,
    verifier,
    PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
    'Machine principal is not authorized for pending task delivery.'
  );
}

/**
 * Authorizes a machine principal for advisory result submission eligibility.
 * Fails closed on any authentication or permission check failure.
 */
export async function authorizeAdvisoryResultSubmission(
  credentialInput: unknown,
  verifier: MachineIdentityVerifier
): Promise<VerifiedMachinePrincipal> {
  return authorizeWithCapability(
    credentialInput,
    verifier,
    PEIAMachineCapability.SUBMIT_ADVISORY_RESULT,
    'Machine principal is not authorized for advisory result submission.'
  );
}
