import { type VerifiedMachinePrincipal } from './machineAuthorizationBoundary';

export const PEIAMachineCredentialScheme = {
  OPAQUE_BEARER_V1: 'OPAQUE_BEARER_V1',
} as const;

export type PEIAMachineCredentialScheme = typeof PEIAMachineCredentialScheme[keyof typeof PEIAMachineCredentialScheme];

/**
 * Validated Opaque Machine Credential contract.
 * 
 * SECURITY RULES:
 * - Represents validated raw bearer secret material in transient server memory.
 * - MUST NEVER be logged, cached, or persisted on the server in plaintext.
 */
export interface ValidatedOpaqueMachineCredential {
  readonly scheme: typeof PEIAMachineCredentialScheme.OPAQUE_BEARER_V1;
  readonly rawCredential: string;
}

/**
 * Validated Machine Credential Digest contract.
 * Represents a SHA-256 hashed value stored for credential matching.
 */
export interface ValidatedMachineCredentialDigest {
  readonly algorithm: 'SHA-256';
  readonly value: string;
}

export class MachineCredentialContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MachineCredentialContractError';
    this.code = code;
  }
}

/**
 * Validates the raw bearer token format:
 * - Must be of type string.
 * - Must start with prefix 'peia_v1_'.
 * - Must be followed by exactly 43 Base64URL characters [A-Za-z0-9\-_].
 * - Must fail on padding '=', characters like '+' or '/', or any whitespace.
 */
export function validateOpaqueMachineCredential(input: unknown): ValidatedOpaqueMachineCredential {
  if (typeof input !== 'string') {
    throw new MachineCredentialContractError(
      'INVALID_MACHINE_CREDENTIAL_TYPE',
      'Opaque machine credential must be a string.'
    );
  }

  // Exact format matches 'peia_v1_' followed by exactly 43 Base64URL characters
  const pattern = /^peia_v1_[A-Za-z0-9\-_]{43}$/;
  if (!pattern.test(input)) {
    throw new MachineCredentialContractError(
      'INVALID_MACHINE_CREDENTIAL_FORMAT',
      'The provided machine credential does not conform to the canonical Opaque Bearer V1 format rules.'
    );
  }

  return {
    scheme: PEIAMachineCredentialScheme.OPAQUE_BEARER_V1,
    rawCredential: input,
  };
}

/**
 * Validates a machine credential digest representation.
 * - Algorithm must be SHA-256.
 * - Value must be exactly 64 lowercase hexadecimal characters.
 */
export function validateMachineCredentialDigest(input: unknown): ValidatedMachineCredentialDigest {
  if (typeof input !== 'string') {
    throw new MachineCredentialContractError(
      'INVALID_MACHINE_CREDENTIAL_TYPE',
      'Machine credential digest value must be a string.'
    );
  }

  const hexPattern = /^[a-f0-9]{64}$/;
  if (!hexPattern.test(input)) {
    throw new MachineCredentialContractError(
      'INVALID_MACHINE_CREDENTIAL_FORMAT',
      'Machine credential digest value must be exactly 64 lowercase hexadecimal characters.'
    );
  }

  return {
    algorithm: 'SHA-256',
    value: input,
  };
}

/**
 * Logical binding linking a securely hashed machine credential to its authorized machine principal.
 * Does not implement database operations directly.
 */
export interface MachineCredentialBinding {
  readonly credentialDigest: ValidatedMachineCredentialDigest;
  readonly principal: VerifiedMachinePrincipal;
}
