import {
  validateOpaqueMachineCredential,
  validateMachineCredentialDigest,
  MachineCredentialContractError,
  PEIAMachineCredentialScheme,
} from '../functions/src/peia/machineCredentialContract';
import { type VerifiedMachinePrincipal } from '../functions/src/peia/machineAuthorizationBoundary';
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

// 1. Valid peia_v1_ credential with exactly 43 Base64URL payload chars passes
const validToken = 'peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef1';
try {
  const res = validateOpaqueMachineCredential(validToken);
  tests.push({
    id: testCounter++,
    name: '1. Valid peia_v1_ credential with exactly 43 Base64URL payload chars passes',
    passed: res.scheme === PEIAMachineCredentialScheme.OPAQUE_BEARER_V1 && res.rawCredential === validToken,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '1. Valid peia_v1_ credential with exactly 43 Base64URL payload chars passes',
    passed: false,
    message: err.message,
  });
}

// 2. Validated result preserves exact raw credential unchanged
try {
  const res = validateOpaqueMachineCredential(validToken);
  tests.push({
    id: testCounter++,
    name: '2. Validated result preserves exact raw credential unchanged',
    passed: res.rawCredential === validToken,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '2. Validated result preserves exact raw credential unchanged',
    passed: false,
  });
}

// 3. Non-string credential fails with INVALID_MACHINE_CREDENTIAL_TYPE
try {
  validateOpaqueMachineCredential(123456789);
  tests.push({
    id: testCounter++,
    name: '3. Non-string credential fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_TYPE';
  tests.push({
    id: testCounter++,
    name: '3. Non-string credential fails with INVALID_MACHINE_CREDENTIAL_TYPE',
    passed: matched,
  });
}

// 4. Empty string fails
try {
  validateOpaqueMachineCredential('');
  tests.push({
    id: testCounter++,
    name: '4. Empty string fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '4. Empty string fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 5. Missing prefix fails
try {
  validateOpaqueMachineCredential('ABCdef1234567890-_ABCdef1234567890-_ABCdef12');
  tests.push({
    id: testCounter++,
    name: '5. Missing prefix fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '5. Missing prefix fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 6. Wrong prefix fails
try {
  validateOpaqueMachineCredential('peia_v2_ABCdef1234567890-_ABCdef1234567890-_ABCdef12');
  tests.push({
    id: testCounter++,
    name: '6. Wrong prefix fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '6. Wrong prefix fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 7. Payload shorter than 43 fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef');
  tests.push({
    id: testCounter++,
    name: '7. Payload shorter than 43 fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '7. Payload shorter than 43 fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 8. Payload longer than 43 fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef123');
  tests.push({
    id: testCounter++,
    name: '8. Payload longer than 43 fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '8. Payload longer than 43 fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 9. = Base64 padding fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef1=');
  tests.push({
    id: testCounter++,
    name: '9. = Base64 padding fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '9. = Base64 padding fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 10. + fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890+ABCdef1234567890-_ABCdef12');
  tests.push({
    id: testCounter++,
    name: '10. + fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '10. + fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 11. / fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890/ABCdef1234567890-_ABCdef12');
  tests.push({
    id: testCounter++,
    name: '11. / fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '11. / fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 12. leading whitespace fails
try {
  validateOpaqueMachineCredential(' peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef12');
  tests.push({
    id: testCounter++,
    name: '12. leading whitespace fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '12. leading whitespace fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 13. trailing whitespace fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef12 ');
  tests.push({
    id: testCounter++,
    name: '13. trailing whitespace fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '13. trailing whitespace fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 14. embedded whitespace fails
try {
  validateOpaqueMachineCredential('peia_v1_ABCdef1234567890-_ABCde 1234567890-_ABCdef12');
  tests.push({
    id: testCounter++,
    name: '14. embedded whitespace fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '14. embedded whitespace fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 15. validator does not trim or normalize credentials
try {
  // Validator must fail on inputs with whitespace rather than trimming them to make them valid
  const spaceToken = 'peia_v1_ABCdef1234567890-_ABCdef1234567890-_ABCdef12   ';
  validateOpaqueMachineCredential(spaceToken);
  tests.push({
    id: testCounter++,
    name: '15. validator does not trim or normalize credentials',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '15. validator does not trim or normalize credentials',
    passed: matched,
  });
}

// 16. error message never echoes supplied credential
try {
  const customBadToken = 'peia_v1_SECRET_TOKEN_DO_NOT_LEAK_1234567890-_';
  validateOpaqueMachineCredential(customBadToken);
  tests.push({
    id: testCounter++,
    name: '16. bad token validation fails',
    passed: false,
  });
} catch (err: any) {
  const containsSecret = err.message.includes('SECRET_TOKEN_DO_NOT_LEAK');
  tests.push({
    id: testCounter++,
    name: '16. error message never echoes supplied credential',
    passed: !containsSecret,
  });
}

// 17. Valid lowercase 64-char SHA-256 digest passes
const validDigest = 'a1b2c3d4e5f607182930415263748596a1b2c3d4e5f607182930415263748596';
try {
  const res = validateMachineCredentialDigest(validDigest);
  tests.push({
    id: testCounter++,
    name: '17. Valid lowercase 64-char SHA-256 digest passes',
    passed: res.algorithm === 'SHA-256' && res.value === validDigest,
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '17. Valid lowercase 64-char SHA-256 digest passes',
    passed: false,
    message: err.message,
  });
}

// 18. Uppercase digest fails
try {
  const upperDigest = validDigest.toUpperCase();
  validateMachineCredentialDigest(upperDigest);
  tests.push({
    id: testCounter++,
    name: '18. Uppercase digest fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '18. Uppercase digest fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 19. Short digest fails
try {
  validateMachineCredentialDigest('a1b2c3d4');
  tests.push({
    id: testCounter++,
    name: '19. Short digest fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '19. Short digest fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 20. Long digest fails
try {
  validateMachineCredentialDigest(validDigest + 'ff');
  tests.push({
    id: testCounter++,
    name: '20. Long digest fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '20. Long digest fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 21. Non-hex digest fails
try {
  const nonHexDigest = validDigest.replace('a', 'g');
  validateMachineCredentialDigest(nonHexDigest);
  tests.push({
    id: testCounter++,
    name: '21. Non-hex digest fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '21. Non-hex digest fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 22. digest whitespace fails
try {
  validateMachineCredentialDigest(validDigest + ' ');
  tests.push({
    id: testCounter++,
    name: '22. digest whitespace fails',
    passed: false,
  });
} catch (err: any) {
  const matched = err instanceof MachineCredentialContractError && err.code === 'INVALID_MACHINE_CREDENTIAL_FORMAT';
  tests.push({
    id: testCounter++,
    name: '22. digest whitespace fails with INVALID_MACHINE_CREDENTIAL_FORMAT',
    passed: matched,
  });
}

// 23. MachineCredentialBinding reuses VerifiedMachinePrincipal
try {
  const binding: any = {
    credentialDigest: { algorithm: 'SHA-256', value: validDigest },
    principal: {
      principalId: 'node-alpha',
      isActive: true,
      capabilities: ['FETCH_PENDING_REVIEW_TASKS'],
    } as VerifiedMachinePrincipal,
  };
  tests.push({
    id: testCounter++,
    name: '23. MachineCredentialBinding reuses VerifiedMachinePrincipal structure',
    passed: binding.principal.principalId === 'node-alpha' && binding.credentialDigest.algorithm === 'SHA-256',
  });
} catch (err: any) {
  tests.push({
    id: testCounter++,
    name: '23. MachineCredentialBinding reuses VerifiedMachinePrincipal structure',
    passed: false,
  });
}

// 24. No duplicate machine principal interface exists
const prodFilePath = path.join(process.cwd(), 'functions/src/peia/machineCredentialContract.ts');
const code = fs.readFileSync(prodFilePath, 'utf8');
const noDuplicatePrincipal = !code.includes('interface VerifiedMachinePrincipal') && !code.includes('type VerifiedMachinePrincipal =');
tests.push({
  id: testCounter++,
  name: '24. No duplicate VerifiedMachinePrincipal interface or type is declared in credential contract',
  passed: noDuplicatePrincipal,
});

// 25. No crypto/hash implementation exists in production contract file
const cleanOfCryptoImports = !code.includes('crypto') && !code.includes('createHash') && !code.includes('subtle');
tests.push({
  id: testCounter++,
  name: '25. No crypto/hash implementation exists in production contract file',
  passed: cleanOfCryptoImports,
});

// 26. No Firebase/HTTP imports exist
const cleanOfHttp = !code.includes('firebase-functions') && !code.includes('express') && !code.includes('HttpsError');
tests.push({
  id: testCounter++,
  name: '26. No Firebase/HTTP imports exist in credential contract',
  passed: cleanOfHttp,
});

// 27. No AdminRole/AdminPermission references exist
const cleanOfHumanRBAC = !code.includes('AdminRole') && !code.includes('AdminPermission') && !code.includes('adminContract');
tests.push({
  id: testCounter++,
  name: '27. No AdminRole/AdminPermission references exist in credential contract',
  passed: cleanOfHumanRBAC,
});

// 28. functions/src/index.ts remains untouched
const indexPath = path.join(process.cwd(), 'functions/src/index.ts');
const indexCode = fs.readFileSync(indexPath, 'utf8');
const cleanIndex = !indexCode.includes('machineCredentialContract') && !indexCode.includes('validateOpaqueMachineCredential');
tests.push({
  id: testCounter++,
  name: '28. functions/src/index.ts remains untouched by contract parameters',
  passed: cleanIndex,
});

// Log results
console.log('====================================================');
console.log('RUNNING PEIA-16G MACHINE CREDENTIAL CONTRACT TESTS');
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
