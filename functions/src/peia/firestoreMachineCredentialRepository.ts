import {
  type ValidatedMachineCredentialDigest,
  type MachineCredentialBinding,
  validateMachineCredentialDigest,
} from './machineCredentialContract';
import { type MachineCredentialBindingRepository } from './machineCredentialVerifier';
import { toMachineCredentialBinding } from './machineCredentialPersistenceRecord';

export const PEIA_MACHINE_CREDENTIAL_COLLECTION = 'peiaMachineCredentials';

export interface FirestoreDocumentSnapshotReader {
  readonly exists: boolean;
  data(): unknown;
}

export interface FirestoreDocumentReader {
  get(): Promise<FirestoreDocumentSnapshotReader>;
}

export interface FirestoreCollectionReader {
  doc(documentId: string): FirestoreDocumentReader;
}

export interface FirestoreReadDatabase {
  collection(collectionName: string): FirestoreCollectionReader;
}

export class FirestoreMachineCredentialRepositoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FirestoreMachineCredentialRepositoryError';
    this.code = code;
  }
}

export class FirestoreMachineCredentialBindingRepository
  implements MachineCredentialBindingRepository
{
  constructor(private readonly db: FirestoreReadDatabase) {}

  async findByCredentialDigest(
    digest: ValidatedMachineCredentialDigest
  ): Promise<MachineCredentialBinding | null> {
    // A. Validate algorithm
    if (digest.algorithm !== 'SHA-256') {
      throw new FirestoreMachineCredentialRepositoryError(
        'INVALID_CREDENTIAL_DIGEST',
        'Repository only supports SHA-256 algorithm.'
      );
    }

    // B. Validate value using canonical validator
    let canonicalDigest: ValidatedMachineCredentialDigest;
    try {
      canonicalDigest = validateMachineCredentialDigest(digest.value);
    } catch (err) {
      throw new FirestoreMachineCredentialRepositoryError(
        'INVALID_CREDENTIAL_DIGEST',
        'The provided digest value is invalid.'
      );
    }

    // C. Confirm match
    if (canonicalDigest.value !== digest.value) {
      throw new FirestoreMachineCredentialRepositoryError(
        'INVALID_CREDENTIAL_DIGEST',
        'The provided digest value is invalid.'
      );
    }

    // D. Use validated value for lookup
    const snapshot = await this.db
      .collection(PEIA_MACHINE_CREDENTIAL_COLLECTION)
      .doc(canonicalDigest.value)
      .get();

    // F. Not found
    if (snapshot.exists !== true) {
      return null;
    }

    // G/H. Retrieve data
    const data = snapshot.data();
    if (data === undefined || data === null) {
      throw new FirestoreMachineCredentialRepositoryError(
        'MACHINE_CREDENTIAL_RECORD_MISSING_DATA',
        'Record exists but contains no data.'
      );
    }

    // I. Map
    let binding: MachineCredentialBinding;
    try {
      binding = toMachineCredentialBinding(data);
    } catch (err) {
      throw new FirestoreMachineCredentialRepositoryError(
        'MACHINE_CREDENTIAL_RECORD_INVALID',
        'Stored record is malformed.'
      );
    }

    // J/K. Integrity check
    if (
      binding.credentialDigest.algorithm !== digest.algorithm ||
      binding.credentialDigest.value !== digest.value
    ) {
      throw new FirestoreMachineCredentialRepositoryError(
        'MACHINE_CREDENTIAL_DIGEST_MISMATCH',
        'Stored record digest does not match requested digest.'
      );
    }

    // L. Return
    return binding;
  }
}
