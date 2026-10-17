"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AITaskStatus = exports.AITaskType = void 0;
/**
 * Task family restricted strictly to advisory-only content auditing.
 */
exports.AITaskType = {
    CONTENT_REVIEW: 'CONTENT_REVIEW',
};
/**
 * Platform-side task lifecycle states.
 * CRITICAL BOUNDARY: Cancellation and retries remain deferred.
 */
exports.AITaskStatus = {
    Pending: 'Pending',
    Completed: 'Completed',
    Failed: 'Failed',
};
//# sourceMappingURL=aiTask.js.map