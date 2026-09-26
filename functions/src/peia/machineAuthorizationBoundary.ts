/**
 * Machine Authorization Boundary for PEIA External Workers.
 * 
 * CRITICAL IDENTITY SEPARATION RULE:
 * Machine identity operates as a separate machine principal and MUST NOT reuse
 * human administrator RBAC roles/permissions contracts.
 */

export const PEIAMachineCapability = {
  FETCH_PENDING_REVIEW_TASKS: 'FETCH_PENDING_REVIEW_TASKS',
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

/**
 * Authorizes a machine principal for Pending task delivery eligibility.
 * Fails closed on any authentication or permission check failure.
 */
export async function authorizePendingTaskDelivery(
  credentialInput: unknown,
  verifier: MachineIdentityVerifier
): Promise<VerifiedMachinePrincipal> {
  let principal: VerifiedMachinePrincipal | null = null;

  try {
    // The credentials/token validation is fully encapsulated in the verifier.
    // The authorization boundary never directly trusts/inspects caller-supplied principal fields.
    principal = await verifier.verify(credentialInput);
  } catch (err: any) {
    throw new MachineAuthorizationError(
      'MACHINE_AUTHENTICATION_FAILED',
      'Machine identity verification failed due to an unexpected verification error.'
    );
  }

  // B. If verifier returns null, fail closed with machine unauthenticated
  if (principal === null) {
    throw new MachineAuthorizationError(
      'MACHINE_UNAUTHENTICATED',
      'Machine principal authentication failed: Unauthenticated.'
    );
  }

  // C. If principalId is missing or blank, fail closed
  if (typeof principal.principalId !== 'string' || principal.principalId.trim() === '') {
    throw new MachineAuthorizationError(
      'MACHINE_PRINCIPAL_INVALID',
      'Machine principal lacks a valid stable identifier.'
    );
  }

  // D. If principal is inactive, fail closed
  if (principal.isActive !== true) {
    throw new MachineAuthorizationError(
      'MACHINE_INACTIVE',
      'Machine principal has been deactivated.'
    );
  }

  // E. If principal lacks FETCH_PENDING_REVIEW_TASKS, fail closed
  if (!principal.capabilities || !principal.capabilities.includes(PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS)) {
    throw new MachineAuthorizationError(
      'MACHINE_CAPABILITY_DENIED',
      'Machine principal is not authorized for pending task delivery.'
    );
  }

  // F. Return verified and authorized principal
  return principal;
}
