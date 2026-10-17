"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPublicTrainingCenterUnitTests = exports.runBackendFoundationVerification = exports.runGlobalSettingsVerification = exports.runAccountAuthFoundationTestSuite = exports.runPublicTrainingConvergenceTests = exports.runMemberTrainingAccessTests = exports.runDurableEnrollmentTests = exports.runDurableTrainingCourseTests = void 0;
__exportStar(require("./contentLanguage"), exports);
__exportStar(require("./contentVisibility"), exports);
__exportStar(require("./systemReportsService"), exports);
__exportStar(require("./globalSettingsService"), exports);
__exportStar(require("./trainingCourseService"), exports);
__exportStar(require("./enrollmentService"), exports);
__exportStar(require("./memberTrainingAccessService"), exports);
var durableTrainingCourseTests_1 = require("./durableTrainingCourseTests");
Object.defineProperty(exports, "runDurableTrainingCourseTests", { enumerable: true, get: function () { return durableTrainingCourseTests_1.runDurableTrainingCourseTests; } });
var durableEnrollmentTests_1 = require("./durableEnrollmentTests");
Object.defineProperty(exports, "runDurableEnrollmentTests", { enumerable: true, get: function () { return durableEnrollmentTests_1.runDurableEnrollmentTests; } });
var memberTrainingAccessTests_1 = require("./memberTrainingAccessTests");
Object.defineProperty(exports, "runMemberTrainingAccessTests", { enumerable: true, get: function () { return memberTrainingAccessTests_1.runMemberTrainingAccessTests; } });
var publicTrainingConvergenceTests_1 = require("./publicTrainingConvergenceTests");
Object.defineProperty(exports, "runPublicTrainingConvergenceTests", { enumerable: true, get: function () { return publicTrainingConvergenceTests_1.runPublicTrainingConvergenceTests; } });
var accountAuthFoundationTests_1 = require("./accountAuthFoundationTests");
Object.defineProperty(exports, "runAccountAuthFoundationTestSuite", { enumerable: true, get: function () { return accountAuthFoundationTests_1.runAccountAuthFoundationTestSuite; } });
var verification_1 = require("./verification");
Object.defineProperty(exports, "runGlobalSettingsVerification", { enumerable: true, get: function () { return verification_1.runGlobalSettingsVerification; } });
var backendFoundationTests_1 = require("./backendFoundationTests");
Object.defineProperty(exports, "runBackendFoundationVerification", { enumerable: true, get: function () { return backendFoundationTests_1.runBackendFoundationVerification; } });
var publicTrainingCenterUnitTests_1 = require("./publicTrainingCenterUnitTests");
Object.defineProperty(exports, "runPublicTrainingCenterUnitTests", { enumerable: true, get: function () { return publicTrainingCenterUnitTests_1.runPublicTrainingCenterUnitTests; } });
//# sourceMappingURL=index.js.map