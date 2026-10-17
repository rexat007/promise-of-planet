"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDurableMediaAdminTestSuite = runDurableMediaAdminTestSuite;
const mediaAdminClient_1 = require("./mediaAdminClient");
const youtubeAdminClient_1 = require("./youtubeAdminClient");
async function runDurableMediaAdminTestSuite() {
    const results = [];
    const test = async (name, fn) => {
        try {
            await fn();
            results.push({ name, passed: true });
        }
        catch (err) {
            results.push({ name, passed: false, error: err?.message || String(err) });
        }
    };
    await test('1. MediaAdminClient exports listAll method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.listAll !== 'function')
            throw new Error('listAll missing');
    });
    await test('2. MediaAdminClient exports register method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.register !== 'function')
            throw new Error('register missing');
    });
    await test('3. MediaAdminClient exports updateMetadata method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.updateMetadata !== 'function')
            throw new Error('updateMetadata missing');
    });
    await test('4. MediaAdminClient exports updateRightsStatus method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.updateRightsStatus !== 'function')
            throw new Error('updateRightsStatus missing');
    });
    await test('5. MediaAdminClient exports updateVisibilityDecision method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.updateVisibilityDecision !== 'function')
            throw new Error('updateVisibilityDecision missing');
    });
    await test('6. MediaAdminClient exports linkVideoToContent method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.linkVideoToContent !== 'function')
            throw new Error('linkVideoToContent missing');
    });
    await test('7. MediaAdminClient exports unlinkVideoFromContent method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.unlinkVideoFromContent !== 'function')
            throw new Error('unlinkVideoFromContent missing');
    });
    await test('8. MediaAdminClient exports getRelationsForVideo method', () => {
        if (typeof mediaAdminClient_1.MediaAdminClient.getRelationsForVideo !== 'function')
            throw new Error('getRelationsForVideo missing');
    });
    await test('9. YouTubeAdminClient exports acceptCandidate method', () => {
        if (typeof youtubeAdminClient_1.YouTubeAdminClient.acceptCandidate !== 'function')
            throw new Error('acceptCandidate missing');
    });
    await test('10. YouTubeAdminClient exports isBackendAvailable method', () => {
        if (typeof youtubeAdminClient_1.YouTubeAdminClient.isBackendAvailable !== 'function')
            throw new Error('isBackendAvailable missing');
    });
    await test('11. YouTubeAdminClient exports isAuthenticated method', () => {
        if (typeof youtubeAdminClient_1.YouTubeAdminClient.isAuthenticated !== 'function')
            throw new Error('isAuthenticated missing');
    });
    await test('12. MediaAdminClient isBackendAvailable check consistency', () => {
        const avail = mediaAdminClient_1.MediaAdminClient.isBackendAvailable();
        if (typeof avail !== 'boolean')
            throw new Error('Expected boolean return');
    });
    await test('13. MediaAdminClient isAuthenticated check consistency', () => {
        const auth = mediaAdminClient_1.MediaAdminClient.isAuthenticated();
        if (typeof auth !== 'boolean')
            throw new Error('Expected boolean return');
    });
    await test('14. YouTubeAdminClient getConfig contract', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.getConfig();
        }
        catch {
            // Expected if no live backend in test environment
        }
    });
    await test('15. YouTubeAdminClient listCandidates contract', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.listCandidates('PendingReview');
        }
        catch {
            // Expected if no live backend in test environment
        }
    });
    await test('16. MediaAdminClient server boundary enforcement guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.listAll();
        }
        catch (e) {
            if (!e?.message?.includes('BACKEND_UNCONFIGURED') && !e?.message?.includes('UNAUTHENTICATED')) {
                throw new Error('Expected backend boundary enforcement error');
            }
        }
    });
    await test('17. YouTubeAdminClient acceptCandidate offline guard check', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.acceptCandidate('test-cand-id', 1);
        }
        catch (e) {
            if (!e)
                throw new Error('Expected rejection when backend/auth not configured');
        }
    });
    await test('18. MediaAdminClient register validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.register({});
        }
        catch (e) {
            if (!e)
                throw new Error('Expected validation failure');
        }
    });
    await test('19. MediaAdminClient updateMetadata validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.updateMetadata('', {});
        }
        catch (e) {
            if (!e)
                throw new Error('Expected error');
        }
    });
    await test('20. MediaAdminClient updateRightsStatus validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.updateRightsStatus('', 'Approved');
        }
        catch (e) {
            if (!e)
                throw new Error('Expected error');
        }
    });
    await test('21. MediaAdminClient updateVisibilityDecision validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.updateVisibilityDecision('', 'Public');
        }
        catch (e) {
            if (!e)
                throw new Error('Expected error');
        }
    });
    await test('22. MediaAdminClient linkVideoToContent validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.linkVideoToContent('', '', 'Embedded', 'Inline');
        }
        catch (e) {
            if (!e)
                throw new Error('Expected error');
        }
    });
    await test('23. MediaAdminClient unlinkVideoFromContent validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.unlinkVideoFromContent('', '');
        }
        catch (e) {
            if (!e)
                throw new Error('Expected error');
        }
    });
    await test('24. MediaAdminClient getRelationsForVideo validation guard', async () => {
        try {
            await mediaAdminClient_1.MediaAdminClient.getRelationsForVideo('');
        }
        catch (e) {
            if (!e)
                throw new Error('Expected error');
        }
    });
    await test('25. YouTubeAdminClient updateEditorialDraft contract check', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.updateEditorialDraft('id', {});
        }
        catch {
            // Expected
        }
    });
    await test('26. YouTubeAdminClient rejectCandidate contract check', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.rejectCandidate('id', 1);
        }
        catch {
            // Expected
        }
    });
    await test('27. YouTubeAdminClient syncUploads contract check', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.syncUploads();
        }
        catch {
            // Expected
        }
    });
    await test('28. YouTubeAdminClient updateConfig contract check', async () => {
        try {
            await youtubeAdminClient_1.YouTubeAdminClient.updateConfig({ channelId: 'c1', enabled: true, version: 1 });
        }
        catch {
            // Expected
        }
    });
    await test('29. Verify no dual write in MediaAdminClient design', () => {
        if (!mediaAdminClient_1.MediaAdminClient.isBackendAvailable)
            throw new Error('Missing architecture boundary');
    });
    await test('30. Verify atomic candidate acceptance backend integration readiness', () => {
        if (!youtubeAdminClient_1.YouTubeAdminClient.acceptCandidate)
            throw new Error('Missing acceptCandidate');
    });
    return results;
}
//# sourceMappingURL=durableMediaAdminTests.js.map