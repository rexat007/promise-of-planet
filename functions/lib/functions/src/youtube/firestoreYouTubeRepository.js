"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreYouTubeRepository = void 0;
const firestore_1 = require("firebase-admin/firestore");
class FirestoreYouTubeRepository {
    static COLLECTIONS = ['youtubeIntegration', 'youtubeImportCandidates'];
    get db() {
        return (0, firestore_1.getFirestore)();
    }
    async getConfiguration(id = 'youtube-primary') {
        const docSnap = await this.db.collection('youtubeIntegration').doc(id).get();
        if (!docSnap.exists)
            return null;
        return docSnap.data();
    }
    async saveConfiguration(config) {
        await this.db.collection('youtubeIntegration').doc(config.id).set(config);
        return config;
    }
    async getCandidate(id) {
        const docSnap = await this.db.collection('youtubeImportCandidates').doc(id).get();
        if (!docSnap.exists)
            return null;
        return docSnap.data();
    }
    async saveCandidate(candidate) {
        await this.db.collection('youtubeImportCandidates').doc(candidate.id).set(candidate);
        return candidate;
    }
    async listCandidates(filter) {
        let query = this.db.collection('youtubeImportCandidates');
        if (filter?.status) {
            query = query.where('status', '==', filter.status);
        }
        const snapshot = await query.get();
        return snapshot.docs.map(doc => doc.data());
    }
}
exports.FirestoreYouTubeRepository = FirestoreYouTubeRepository;
//# sourceMappingURL=firestoreYouTubeRepository.js.map