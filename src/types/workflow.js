"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowAction = exports.WorkflowState = void 0;
exports.WorkflowState = {
    Draft: 'Draft',
    InReview: 'InReview',
    ChangesRequested: 'ChangesRequested',
    Approved: 'Approved',
    Published: 'Published',
};
exports.WorkflowAction = {
    SubmitForReview: 'submit_for_review',
    RequestChanges: 'request_changes',
    Approve: 'approve',
    ReviseDraft: 'revise_draft',
    Publish: 'publish',
};
//# sourceMappingURL=workflow.js.map