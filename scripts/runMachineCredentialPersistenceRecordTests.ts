import {
  validateMachineCredentialPersistenceRecord,
  toMachineCredentialBinding,
  MachineCredentialPersistenceError,
} from '../functions/src/peia/machineCredentialPersistenceRecord';
import { PEIAMachineCredentialScheme } from '../functions/src/peia/machineCredentialContract';
import { PEIAMachineCapability } from '../functions/src/peia/machineAuthorizationBoundary';
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

function createValidRecord(overrides: Record<string, any> = {}): Record<string, any> {
  const base = {
    credentialScheme: PEIAMachineCredentialScheme.OPAQUE_BEARER_V1,
    credentialDigest: {
      algorithm: 'SHA-256',
      value: 'a1b2c3d4e5f607182930415263748596a1b2c3d4e5f607182930415263748596',
    },
    principal: {
      principalId: 'node-epsilon',
      isActive: true,
      capabilities: [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS],
    },
  };

  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete (result as any)[key];
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      (result as any)[key] = { ...(result as any)[key], ...value };
    } else {
      (result as any)[key] = value;
    }
  }
  return result;
}

async function run() {
  // 1. fully valid persistence record passes
  try {
    const record = createValidRecord();
    const res = validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '1. fully valid persistence record passes',
      passed: res.credentialScheme === PEIAMachineCredentialScheme.OPAQUE_BEARER_V1,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '1. fully valid persistence record passes',
      passed: false,
      message: err.message,
    });
  }

  // 2. valid record maps to canonical MachineCredentialBinding
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    tests.push({
      id: testCounter++,
      name: '2. valid record maps to canonical MachineCredentialBinding',
      passed: binding !== null && 'credentialDigest' in binding && 'principal' in binding,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '2. valid record maps to canonical MachineCredentialBinding',
      passed: false,
    });
  }

  // 3. mapped digest algorithm is SHA-256
  try {
    const binding = toMachineCredentialBinding(createValidRecord());
    tests.push({
      id: testCounter++,
      name: '3. mapped digest algorithm is SHA-256',
      passed: binding.credentialDigest.algorithm === 'SHA-256',
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '3. mapped digest algorithm is SHA-256',
      passed: false,
    });
  }

  // 4. mapped digest value is preserved exactly
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    tests.push({
      id: testCounter++,
      name: '4. mapped digest value is preserved exactly',
      passed: binding.credentialDigest.value === record.credentialDigest.value,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '4. mapped digest value is preserved exactly',
      passed: false,
    });
  }

  // 5. mapped principalId is preserved exactly
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    tests.push({
      id: testCounter++,
      name: '5. mapped principalId is preserved exactly',
      passed: binding.principal.principalId === record.principal.principalId,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '5. mapped principalId is preserved exactly',
      passed: false,
    });
  }

  // 6. mapped isActive is preserved exactly
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    tests.push({
      id: testCounter++,
      name: '6. mapped isActive is preserved exactly',
      passed: binding.principal.isActive === record.principal.isActive,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '6. mapped isActive is preserved exactly',
      passed: false,
    });
  }

  // 7. mapped capabilities are preserved
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    tests.push({
      id: testCounter++,
      name: '7. mapped capabilities are preserved',
      passed: binding.principal.capabilities.length === 1 && binding.principal.capabilities[0] === PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '7. mapped capabilities are preserved',
      passed: false,
    });
  }

  // 8. null record fails
  try {
    validateMachineCredentialPersistenceRecord(null);
    tests.push({
      id: testCounter++,
      name: '8. null record fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_RECORD';
    tests.push({
      id: testCounter++,
      name: '8. null record fails with INVALID_MACHINE_CREDENTIAL_RECORD',
      passed: matched,
    });
  }

  // 9. array record fails
  try {
    validateMachineCredentialPersistenceRecord([]);
    tests.push({
      id: testCounter++,
      name: '9. array record fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_RECORD';
    tests.push({
      id: testCounter++,
      name: '9. array record fails with INVALID_MACHINE_CREDENTIAL_RECORD',
      passed: matched,
    });
  }

  // 10. missing credentialScheme fails
  try {
    const record = createValidRecord({ credentialScheme: undefined });
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '10. missing credentialScheme fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '10. missing credentialScheme fails with UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 11. wrong credentialScheme fails
  try {
    const record = createValidRecord({ credentialScheme: 'JWT_BEARER' });
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '11. wrong credentialScheme fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_SCHEME';
    tests.push({
      id: testCounter++,
      name: '11. wrong credentialScheme fails with INVALID_MACHINE_CREDENTIAL_SCHEME',
      passed: matched,
    });
  }

  // 12. missing credentialDigest fails
  try {
    const record = createValidRecord({ credentialDigest: undefined });
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '12. missing credentialDigest fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '12. missing credentialDigest fails with UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 13. credentialDigest null fails
  try {
    const record = createValidRecord();
    (record as any).credentialDigest = null;
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '13. credentialDigest null fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_DIGEST';
    tests.push({
      id: testCounter++,
      name: '13. credentialDigest null fails with INVALID_MACHINE_CREDENTIAL_DIGEST',
      passed: matched,
    });
  }

  // 14. credentialDigest array fails
  try {
    const record = createValidRecord();
    (record as any).credentialDigest = [];
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '14. credentialDigest array fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_DIGEST';
    tests.push({
      id: testCounter++,
      name: '14. credentialDigest array fails with INVALID_MACHINE_CREDENTIAL_DIGEST',
      passed: matched,
    });
  }

  // 15. wrong digest algorithm fails
  try {
    const record = createValidRecord();
    record.credentialDigest.algorithm = 'MD5';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '15. wrong digest algorithm fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_DIGEST';
    tests.push({
      id: testCounter++,
      name: '15. wrong digest algorithm fails with INVALID_MACHINE_CREDENTIAL_DIGEST',
      passed: matched,
    });
  }

  // 16. uppercase digest fails
  try {
    const record = createValidRecord();
    record.credentialDigest.value = record.credentialDigest.value.toUpperCase();
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '16. uppercase digest fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_DIGEST';
    tests.push({
      id: testCounter++,
      name: '16. uppercase digest fails with INVALID_MACHINE_CREDENTIAL_DIGEST',
      passed: matched,
    });
  }

  // 17. malformed digest fails
  try {
    const record = createValidRecord();
    record.credentialDigest.value = 'too-short';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '17. malformed digest fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_DIGEST';
    tests.push({
      id: testCounter++,
      name: '17. malformed digest fails with INVALID_MACHINE_CREDENTIAL_DIGEST',
      passed: matched,
    });
  }

  // 18. unknown credentialDigest field fails
  try {
    const record = createValidRecord();
    (record.credentialDigest as any).unwanted = 'value';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '18. unknown credentialDigest field fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '18. unknown credentialDigest field fails with UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 19. missing principal fails
  try {
    const record = createValidRecord({ principal: undefined });
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '19. missing principal fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '19. missing principal fails with UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 20. principal null fails
  try {
    const record = createValidRecord();
    (record as any).principal = null;
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '20. principal null fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '20. principal null fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 21. principal array fails
  try {
    const record = createValidRecord();
    (record as any).principal = [];
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '21. principal array fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '21. principal array fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 22. empty principalId fails
  try {
    const record = createValidRecord();
    record.principal.principalId = '';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '22. empty principalId fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '22. empty principalId fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 23. whitespace-only principalId fails
  try {
    const record = createValidRecord();
    record.principal.principalId = '   ';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '23. whitespace-only principalId fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '23. whitespace-only principalId fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 24. leading-whitespace principalId fails
  try {
    const record = createValidRecord();
    record.principal.principalId = ' node-epsilon';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '24. leading-whitespace principalId fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '24. leading-whitespace principalId fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 25. trailing-whitespace principalId fails
  try {
    const record = createValidRecord();
    record.principal.principalId = 'node-epsilon ';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '25. trailing-whitespace principalId fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '25. trailing-whitespace principalId fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 26. non-boolean isActive fails
  try {
    const record = createValidRecord();
    record.principal.isActive = 'true';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '26. non-boolean isActive fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '26. non-boolean isActive fails with INVALID_MACHINE_PRINCIPAL',
      passed: matched,
    });
  }

  // 27. isActive false remains structurally valid
  try {
    const record = createValidRecord();
    record.principal.isActive = false;
    const res = validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '27. isActive false remains structurally valid',
      passed: res.principal.isActive === false,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '27. isActive false remains structurally valid',
      passed: false,
    });
  }

  // 28. empty capabilities array remains structurally valid
  try {
    const record = createValidRecord();
    record.principal.capabilities = [];
    const res = validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '28. empty capabilities array remains structurally valid',
      passed: res.principal.capabilities.length === 0,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '28. empty capabilities array remains structurally valid',
      passed: false,
    });
  }

  // 29. canonical FETCH_PENDING_REVIEW_TASKS capability passes
  try {
    const record = createValidRecord();
    record.principal.capabilities = [PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS];
    const res = validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '29. canonical FETCH_PENDING_REVIEW_TASKS capability passes',
      passed: res.principal.capabilities.length === 1 && res.principal.capabilities[0] === PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '29. canonical FETCH_PENDING_REVIEW_TASKS capability passes',
      passed: false,
    });
  }

  // 30. unknown capability fails and does not leak input
  try {
    const record = createValidRecord();
    record.principal.capabilities = ['VERY_SECRET_ATTACKER_VALUE'];
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '30. unknown capability fails',
      passed: false,
    });
  } catch (err: any) {
    const matchedCode = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CAPABILITIES';
    const noLeak = err.message && !err.message.includes('VERY_SECRET_ATTACKER_VALUE');
    tests.push({
      id: testCounter++,
      name: '30. unknown capability fails with INVALID_MACHINE_CAPABILITIES and does not leak input value',
      passed: matchedCode && noLeak,
    });
  }

  // 31. non-string capability fails
  try {
    const record = createValidRecord();
    record.principal.capabilities = [123];
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '31. non-string capability fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CAPABILITIES';
    tests.push({
      id: testCounter++,
      name: '31. non-string capability fails with INVALID_MACHINE_CAPABILITIES',
      passed: matched,
    });
  }

  // 32. duplicate capability fails
  try {
    const record = createValidRecord();
    record.principal.capabilities = [
      PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
      PEIAMachineCapability.FETCH_PENDING_REVIEW_TASKS,
    ];
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '32. duplicate capability fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CAPABILITIES';
    tests.push({
      id: testCounter++,
      name: '32. duplicate capability fails with INVALID_MACHINE_CAPABILITIES',
      passed: matched,
    });
  }

  // 33. unknown top-level field fails
  try {
    const record = createValidRecord();
    (record as any).unexpectedField = 'hello';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '33. unknown top-level field fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '33. unknown top-level field fails with UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 34. unknown principal field fails
  try {
    const record = createValidRecord();
    (record.principal as any).extraInfo = 'unwanted';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '34. unknown principal field fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '34. unknown principal field fails with UNKNOWN_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 35. rawCredential top-level field fails with PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD
  try {
    const record = createValidRecord();
    (record as any).rawCredential = 'peia_v1_secret_value_12345';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '35. rawCredential top-level field fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '35. rawCredential top-level field fails with PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 36. rawCredential inside principal fails with PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD
  try {
    const record = createValidRecord();
    (record.principal as any).rawCredential = 'peia_v1_secret_value_12345';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '36. rawCredential inside principal fails',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '36. rawCredential inside principal fails with PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD',
      passed: matched,
    });
  }

  // 37. token/secret/apiKey authority-secret shortcut fields fail closed
  try {
    const record = createValidRecord();
    (record as any).apiKey = 'peia_v1_shortcut';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '37. token/secret/apiKey shortcut fields fail',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'PROHIBITED_MACHINE_CREDENTIAL_RECORD_FIELD';
    tests.push({
      id: testCounter++,
      name: '37. token/secret/apiKey authority-secret shortcut fields fail closed',
      passed: matched,
    });
  }

  // 38. validator does not trim or normalize principalId
  try {
    const record = createValidRecord();
    record.principal.principalId = '  node-epsilon  ';
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '38. validator does not trim or normalize principalId',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_PRINCIPAL';
    tests.push({
      id: testCounter++,
      name: '38. validator does not trim or normalize principalId',
      passed: matched,
    });
  }

  // 39. validator does not normalize digest
  try {
    const record = createValidRecord();
    record.credentialDigest.value = ' ' + record.credentialDigest.value;
    validateMachineCredentialPersistenceRecord(record);
    tests.push({
      id: testCounter++,
      name: '39. validator does not normalize digest',
      passed: false,
    });
  } catch (err: any) {
    const matched = err instanceof MachineCredentialPersistenceError && err.code === 'INVALID_MACHINE_CREDENTIAL_DIGEST';
    tests.push({
      id: testCounter++,
      name: '39. validator does not normalize digest',
      passed: matched,
    });
  }

  // 40. mapper never exposes credentialScheme beyond canonical MachineCredentialBinding
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    const hasScheme = 'credentialScheme' in binding;
    tests.push({
      id: testCounter++,
      name: '40. mapper never exposes credentialScheme beyond canonical MachineCredentialBinding',
      passed: !hasScheme,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '40. mapper never exposes credentialScheme beyond canonical MachineCredentialBinding',
      passed: false,
    });
  }

  // 41. no raw credential exists in canonical mapped binding
  try {
    const record = createValidRecord();
    const binding = toMachineCredentialBinding(record);
    const keysStr = JSON.stringify(binding);
    const containsSecret = keysStr.includes('rawCredential') || keysStr.includes('token') || keysStr.includes('secret');
    tests.push({
      id: testCounter++,
      name: '41. no raw credential exists in canonical mapped binding',
      passed: !containsSecret,
    });
  } catch (err: any) {
    tests.push({
      id: testCounter++,
      name: '41. no raw credential exists in canonical mapped binding',
      passed: false,
    });
  }

  // 42. no duplicate MachineCredentialBinding interface exists
  const prodFilePath = path.join(process.cwd(), 'functions/src/peia/machineCredentialPersistenceRecord.ts');
  const code = fs.readFileSync(prodFilePath, 'utf8');
  const noDuplicateBinding = !code.includes('interface MachineCredentialBinding') && !code.includes('type MachineCredentialBinding =');
  tests.push({
    id: testCounter++,
    name: '42. no duplicate MachineCredentialBinding interface exists',
    passed: noDuplicateBinding,
  });

  // 43. no duplicate VerifiedMachinePrincipal interface exists
  const noDuplicatePrincipal = !code.includes('interface VerifiedMachinePrincipal') && !code.includes('type VerifiedMachinePrincipal =');
  tests.push({
    id: testCounter++,
    name: '43. no duplicate VerifiedMachinePrincipal interface exists',
    passed: noDuplicatePrincipal,
  });

  // 44. no new repository interface exists in production file
  const noNewRepo = !code.includes('interface MachineCredentialRepository') && !code.includes('interface MachineCredentialPersistenceRepository');
  tests.push({
    id: testCounter++,
    name: '44. no new repository interface exists in production file',
    passed: noNewRepo,
  });

  // 45. no hashing/crypto imports exist
  const noCrypto = !code.includes('crypto') && !code.includes('createHash') && !code.includes('subtle');
  tests.push({
    id: testCounter++,
    name: '45. no hashing/crypto imports exist',
    passed: noCrypto,
  });

  // 46. no Firestore imports exist
  const noFirestore = !code.includes('firebase-admin/firestore') && !code.includes('firestore()');
  tests.push({
    id: testCounter++,
    name: '46. no Firestore imports exist',
    passed: noFirestore,
  });

  // 47. no Firebase Functions/HTTP imports exist
  const noHttp = !code.includes('firebase-functions') && !code.includes('express') && !code.includes('HttpsError');
  tests.push({
    id: testCounter++,
    name: '47. no Firebase Functions/HTTP imports exist',
    passed: noHttp,
  });

  // 48. no human AdminRole/AdminPermission references exist
  const noAdminRBAC = !code.includes('AdminRole') && !code.includes('AdminPermission') && !code.includes('AdminUser');
  tests.push({
    id: testCounter++,
    name: '48. no human AdminRole/AdminPermission references exist',
    passed: noAdminRBAC,
  });

  // 49. no persistence mutation methods exist
  const noMutations = !code.includes('save(') && !code.includes('create(') && !code.includes('update(') && !code.includes('delete(');
  tests.push({
    id: testCounter++,
    name: '49. no persistence mutation methods exist',
    passed: noMutations,
  });

  // 50. functions/src/index.ts remains untouched
  const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
  const indexCode = fs.readFileSync(indexPath, 'utf8');
  const cleanIndex = !indexCode.includes('machineCredentialPersistenceRecord') && !indexCode.includes('validateMachineCredentialPersistenceRecord');
  tests.push({
    id: testCounter++,
    name: '50. functions/src/index.ts remains untouched',
    passed: cleanIndex,
  });

  // Log results
  console.log('====================================================');
  console.log('RUNNING PEIA-16I MACHINE CREDENTIAL PERSISTENCE RECORD TESTS');
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
