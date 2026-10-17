"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryAdminClient = void 0;
const functions_1 = require("firebase/functions");
const firebase_1 = require("./firebase");
function getFunctionsInstance() {
    if (!firebase_1.isFirebaseConfigured || !firebase_1.app) {
        throw new Error('BACKEND_UNCONFIGURED: Firebase backend is not configured in client environment.');
    }
    if (!firebase_1.auth?.currentUser) {
        throw new Error('UNAUTHENTICATED: Authentication required. Library management requires an authenticated Admin user session.');
    }
    return (0, functions_1.getFunctions)(firebase_1.app);
}
exports.LibraryAdminClient = {
    isBackendAvailable() {
        return firebase_1.isFirebaseConfigured && !!firebase_1.app;
    },
    isAuthenticated() {
        return !!(firebase_1.isFirebaseConfigured && firebase_1.auth?.currentUser);
    },
    async listAll() {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'listAll' });
        return res.data?.documents ?? [];
    },
    async getById(id) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'getById', id });
        return res.data?.document ?? null;
    },
    async create(input) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'create', input });
        return res.data.document;
    },
    async updateMetadata(id, updates) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'updateMetadata', id, updates });
        return res.data.document;
    },
    async updateRights(id, rightsStatus, notesAr, notesEn) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'updateRights', id, rightsStatus, notesAr, notesEn });
        return res.data.document;
    },
    async transitionWorkflow(id, targetState, comment) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'transitionWorkflow', id, targetState, comment });
        return res.data.document;
    },
    async addVersion(id, versionInput) {
        const fns = getFunctionsInstance();
        const callable = (0, functions_1.httpsCallable)(fns, 'manageLibraryDocuments');
        const res = await callable({ action: 'addVersion', id, versionInput });
        return res.data.document;
    },
};
//# sourceMappingURL=libraryAdminClient.js.map