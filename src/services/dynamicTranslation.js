"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicTranslationService = void 0;
/**
 * Default Null/Passthrough Provider (Provider Boundary Ready)
 * Used when no external machine translation API is configured.
 * Gracefully falls back to original source text.
 */
class NullTranslationProvider {
    name = 'NullPassthroughProvider';
    isConfigured = false;
    translate(request) {
        return request.text;
    }
}
/**
 * Dynamic Translation Service
 * Provider-independent architecture for translating arbitrary source content
 * (titles, bodies, location descriptions) without mutating canonical source records.
 */
class DynamicTranslationService {
    provider = new NullTranslationProvider();
    cache = new Map();
    setProvider(provider) {
        this.provider = provider;
    }
    getProviderStatus() {
        return {
            name: this.provider.name,
            isConfigured: this.provider.isConfigured,
        };
    }
    getCacheKey(text, sourceLang, targetLang) {
        return `${sourceLang}:${targetLang}:${text}`;
    }
    /**
     * Translates arbitrary content text based on source and target language.
     * Preserves source if sourceLanguage === targetLanguage or if provider is unconfigured.
     */
    translateText(text, sourceLang, targetLang, contentId) {
        if (!text || !text.trim())
            return text;
        // Same-language behavior
        if (!sourceLang || !targetLang || sourceLang.toLowerCase() === targetLang.toLowerCase()) {
            return text;
        }
        const cacheKey = this.getCacheKey(text, sourceLang, targetLang);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        // If provider is not configured, fall back gracefully to original source text
        if (!this.provider.isConfigured) {
            return text;
        }
        try {
            const translated = this.provider.translate({
                text,
                sourceLanguage: sourceLang,
                targetLanguage: targetLang,
                contentId,
            });
            if (typeof translated === 'string' && translated.trim()) {
                this.cache.set(cacheKey, translated);
                return translated;
            }
        }
        catch (error) {
            console.warn('Dynamic translation failed, falling back to source text:', error);
        }
        return text;
    }
    clearCache() {
        this.cache.clear();
    }
}
exports.dynamicTranslationService = new DynamicTranslationService();
//# sourceMappingURL=dynamicTranslation.js.map