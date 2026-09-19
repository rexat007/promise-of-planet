"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryYouTubeRepository = void 0;
class InMemoryYouTubeRepository {
    configs = {};
    candidates = {};
    clear() {
        this.configs = {};
        this.candidates = {};
    }
    async getConfiguration(id = 'youtube-primary') {
        return this.configs[id] ? { ...this.configs[id] } : null;
    }
    async saveConfiguration(config) {
        this.configs[config.id] = { ...config };
        return { ...config };
    }
    async getCandidate(id) {
        return this.candidates[id] ? { ...this.candidates[id] } : null;
    }
    async saveCandidate(candidate) {
        this.candidates[candidate.id] = { ...candidate };
        return { ...candidate };
    }
    async listCandidates(filter) {
        const all = Object.values(this.candidates).map(c => ({ ...c }));
        if (filter?.status) {
            return all.filter(c => c.status === filter.status);
        }
        return all;
    }
}
exports.InMemoryYouTubeRepository = InMemoryYouTubeRepository;
//# sourceMappingURL=inMemoryYouTubeRepository.js.map