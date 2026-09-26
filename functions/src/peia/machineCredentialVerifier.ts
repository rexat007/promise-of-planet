import { createHash } from 'node:crypto';
import {
  type VerifiedMachinePrincipal,
  type MachineIdentityVerifier,
} from './machineAuthorizationBoundary';
import {
  validateOpaqueMachineCredential,
  validateMachineCredentialDigest,
  type ValidatedMachineCredentialDigest,
  type MachineCredentialBinding,
  MachineCredentialContractError,
} from './machineCredentialContract';

/**
 * Validates and hashes a raw opaque machine credential.
 * Calculates the SHA-256 hash over the entire credential string UTF-8 bytes.
 * Returns the validated contract representing the hashed secret.
 * 
 * SECURITY RULES:
 * - Raw credentials are never logged, echoed in error messages, or returned.
 */
export function hashOpaqueMachineCredential(input: unknown): ValidatedMachineCredentialDigest {
  // 1. Validate the raw token shape first
  const validated = validateOpaqueMachineCredential(input);

  // 2. Hash the entire exact rawCredential UTF-8 string with SHA-256
  const hashHex = createHash('sha256')
    .update(validated.rawCredential, 'utf8')
    .digest('hex');

  // 3. Pass generated lowercase hexadecimal value to digest validator
  return validateMachineCredentialDigest(hashHex);
}

/**
 * Storage-neutral database lookup abstraction for credential-to-principal bindings.
 */
export interface MachineCredentialBindingRepository {
  findByCredentialDigest(
    digest: ValidatedMachineCredentialDigest
  ): Promise<MachineCredentialBinding | null>;
}

/**
 * Concrete MachineIdentityVerifier implementation matching credentials with principals via secure hashing.
 */
export class OpaqueMachineIdentityVerifier implements MachineIdentityVerifier {
  constructor(
    private readonly repository: MachineCredentialBindingRepository
  ) {}

  /**
   * Verifies the incoming credential against the registered SHA-256 digests.
   * If the credential is of invalid format or type, returns null instead of throwing.
   * If repository lookup fails, the exception propagates.
   */
  async verify(input: unknown): Promise<VerifiedMachinePrincipal | null> {
    let digest: ValidatedMachineCredentialDigest;

    try {
      // A. Validate and hash incoming credential
      digest = hashOpaqueMachineCredential(input);
    } catch (err) {
      // B. Invalid raw format or type is a standard unauthenticated state (returns null)
      if (err instanceof MachineCredentialContractError) {
        return null;
      }
      throw err;
    }

    // C. Query repository using digest representation only (raw secret never sent)
    const binding = await this.repository.findByCredentialDigest(digest);
    if (!binding) {
      // D. Binding not found (returns null)
      return null;
    }

    // E. Verify the returned binding digest matches the queried digest exactly
    const algorithmMatch = binding.credentialDigest.algorithm === digest.algorithm;
    const valueMatch = binding.credentialDigest.value === digest.value;

    if (!algorithmMatch || !valueMatch) {
      // F. Mismatched database payload detected (fails closed, returns null)
      return null;
    }

    // G. Return the mapped principal
    return binding.principal;
  }
}
