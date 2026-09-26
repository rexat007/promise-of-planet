import {
  PEIAMachineCredentialScheme,
  validateMachineCredentialDigest,
  type ValidatedMachineCredentialDigest,
  type MachineCredentialBinding,
} from './machineCredentialContract';
import {
  PEIAMachineCapability,
  type VerifiedMachinePrincipal,
} from './machineAuthorizationBoundary';

export interface MachineCredentialPersistenceRecord {
  readonly credentialScheme: typeof PEIAMachineCredentialScheme.OPAQUE_BEARER_V1;
  readonly credentialDigest: {
    readonly algorithm: 'SHA-256';
    readonly value: string;
  };
  readonly principal: {
    readonly principalId: string;
    readonly isActive: boolean;
    readonly capabilities: readonly PEIAMachineCapability[];
  };
}

export class MachineCredentialPersistenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MachineCredentialPersistenceError';
    this.code = code;
  }
}

// Prohibited secret/bypass keywords for recursive checking
const PROHIBITED_KEYWORDS = new Set([
  'rawcredential',
  'credential',
  'token',
  'secret',
  'machinetoken',
  'apikey',
  'password',
  'serviceaccount',
  'adminrole',
  'role',
  'permission',
]);

const OTHER_DISALLOWED_KEYWORDS = new Set([
  'email',
  'name',
  'devicename',
  'metadata',
  'createdat',
  'updatedat',
  'lastusedat',
  'expiresat',
  'revokedat',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkProhibitedAndUnknownFields(
  obj: Record<string, unknown>,
  allowedKeys: Set<string>,
  contextName: string
): void {
  for (const key of Object.keys(obj)) {
    const keyLower = key.toLowerCase();
    if (PROHIBITED_KEYWORDS.has(keyLower)) {
      throw new MachineCredentialPersistenceError(
        'PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD',
        `Prohibited field "${key}" detected in context ${contextName}.`
      );
    }
    if (OTHER_DISALLOWED_KEYWORDS.has(keyLower)) {
      throw new MachineCredentialPersistenceError(
        'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
        `Disallowed metadata/shortcut field "${key}" detected in context ${contextName}.`
      );
    }
    if (!allowedKeys.has(key)) {
      throw new MachineCredentialPersistenceError(
        'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
        `Unknown field "${key}" detected in context ${contextName}.`
      );
    }
  }
}

/**
 * Validates the raw persistence record format strictly.
 * Fail-closed if any unexpected or prohibited field is present, or if any types/schemas are wrong.
 */
export function validateMachineCredentialPersistenceRecord(
  input: unknown
): MachineCredentialPersistenceRecord {
  if (!isPlainObject(input)) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_CREDENTIAL_RECORD',
      'Persistence record must be a non-null plain object.'
    );
  }

  // 1. Check top-level keys
  const topLevelKeys = new Set(['credentialScheme', 'credentialDigest', 'principal']);
  checkProhibitedAndUnknownFields(input as Record<string, unknown>, topLevelKeys, 'top-level record');

  // Ensure all required fields exist
  const keys = Object.keys(input as Record<string, unknown>);
  if (!keys.includes('credentialScheme') || !keys.includes('credentialDigest') || !keys.includes('principal')) {
    throw new MachineCredentialPersistenceError(
      'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      'Missing one or more required top-level fields on the persistence record.'
    );
  }

  const { credentialScheme, credentialDigest, principal } = input as any;

  // 2. Validate credentialScheme
  if (credentialScheme !== PEIAMachineCredentialScheme.OPAQUE_BEARER_V1) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_CREDENTIAL_SCHEME',
      'Credential scheme must be exactly OPAQUE_BEARER_V1.'
    );
  }

  // 3. Validate credentialDigest
  if (!isPlainObject(credentialDigest)) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_CREDENTIAL_DIGEST',
      'credentialDigest must be a non-null plain object.'
    );
  }

  const digestKeys = new Set(['algorithm', 'value']);
  checkProhibitedAndUnknownFields(credentialDigest, digestKeys, 'credentialDigest');

  if (credentialDigest.algorithm !== 'SHA-256') {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_CREDENTIAL_DIGEST',
      'Digest algorithm must be exactly SHA-256.'
    );
  }

  // Delegate hex and format validation to canonical validateMachineCredentialDigest
  try {
    validateMachineCredentialDigest(credentialDigest.value);
  } catch (err) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_CREDENTIAL_DIGEST',
      'The digest value failed canonical validation checks.'
    );
  }

  // 4. Validate principal
  if (!isPlainObject(principal)) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_PRINCIPAL',
      'principal must be a non-null plain object.'
    );
  }

  const principalKeys = new Set(['principalId', 'isActive', 'capabilities']);
  checkProhibitedAndUnknownFields(principal, principalKeys, 'principal');

  // principalId checks
  const principalId = principal.principalId;
  if (typeof principalId !== 'string') {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_PRINCIPAL',
      'principalId must be a string.'
    );
  }
  if (principalId.trim().length === 0) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_PRINCIPAL',
      'principalId cannot be empty or whitespace-only.'
    );
  }
  if (principalId !== principalId.trim()) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_PRINCIPAL',
      'principalId must not contain leading or trailing whitespace.'
    );
  }

  // isActive checks (must be strict boolean, no coercion)
  const isActive = principal.isActive;
  if (typeof isActive !== 'boolean') {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_PRINCIPAL',
      'isActive must be a strict boolean (true/false).'
    );
  }

  // capabilities checks
  const capabilities = principal.capabilities;
  if (!Array.isArray(capabilities)) {
    throw new MachineCredentialPersistenceError(
      'INVALID_MACHINE_CAPABILITIES',
      'capabilities must be an array.'
    );
  }

  const seenCaps = new Set<string>();
  const validCapabilities = new Set<string>([PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS]);

  for (const cap of capabilities) {
    if (typeof cap !== 'string') {
      throw new MachineCredentialPersistenceError(
        'INVALID_MACHINE_CAPABILITIES',
        'Capability array items must be strings.'
      );
    }
    if (!validCapabilities.has(cap)) {
      throw new MachineCredentialPersistenceError(
        'INVALID_MACHINE_CAPABILITIES',
        'Persisted machine capability is not recognized.'
      );
    }
    if (seenCaps.has(cap)) {
      throw new MachineCredentialPersistenceError(
        'INVALID_MACHINE_CAPABILITIES',
        'Duplicate capability detected.'
      );
    }
    seenCaps.add(cap);
  }

  return {
    credentialScheme,
    credentialDigest: {
      algorithm: credentialDigest.algorithm,
      value: credentialDigest.value,
    },
    principal: {
      principalId,
      isActive,
      capabilities: capabilities as readonly PEIAMachineCapability[],
    },
  };
}

/**
 * Maps the raw validated persistence record to the standard MachineCredentialBinding format.
 */
export function toMachineCredentialBinding(input: unknown): MachineCredentialBinding {
  // 1. Perform full structural and prohibited checks first
  const record = validateMachineCredentialPersistenceRecord(input);

  // 2. Perform second-stage canonical digest builder to construct correct type
  const credentialDigest = validateMachineCredentialDigest(record.credentialDigest.value);

  // 3. Return canonical binding mapping
  return {
    credentialDigest,
    principal: {
      principalId: record.principal.principalId,
      isActive: record.principal.isActive,
      capabilities: record.principal.capabilities,
    },
  };
}
