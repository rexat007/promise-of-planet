import { runMediaFoundationVerification } from "../src/services/mediaFoundationTests";
const results = runMediaFoundationVerification();
const passed = results.filter(r => r.passed).length;
console.log(`${passed} / 51 assertions passed`);
if (passed === 51) process.exit(0);
else process.exit(1);
