export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  contentId?: string;
}

export interface TranslationProvider {
  name: string;
  isConfigured: boolean;
  translate(request: TranslationRequest): Promise<string> | string;
}

/**
 * Default Null/Passthrough Provider (Provider Boundary Ready)
 * Used when no external machine translation API is configured.
 * Gracefully falls back to original source text.
 */
class NullTranslationProvider implements TranslationProvider {
  name = 'NullPassthroughProvider';
  isConfigured = false;

  translate(request: TranslationRequest): string {
    return request.text;
  }
}

/**
 * Dynamic Translation Service
 * Provider-independent architecture for translating arbitrary source content
 * (titles, bodies, location descriptions) without mutating canonical source records.
 */
class DynamicTranslationService {
  private provider: TranslationProvider = new NullTranslationProvider();
  private cache = new Map<string, string>();

  public setProvider(provider: TranslationProvider) {
    this.provider = provider;
  }

  public getProviderStatus() {
    return {
      name: this.provider.name,
      isConfigured: this.provider.isConfigured,
    };
  }

  private getCacheKey(text: string, sourceLang: string, targetLang: string): string {
    return `${sourceLang}:${targetLang}:${text}`;
  }

  /**
   * Translates arbitrary content text based on source and target language.
   * Preserves source if sourceLanguage === targetLanguage or if provider is unconfigured.
   */
  public translateText(text: string, sourceLang: string, targetLang: string, contentId?: string): string {
    if (!text || !text.trim()) return text;
    
    // Same-language behavior
    if (!sourceLang || !targetLang || sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return text;
    }

    const cacheKey = this.getCacheKey(text, sourceLang, targetLang);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
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
    } catch (error) {
      console.warn('Dynamic translation failed, falling back to source text:', error);
    }

    return text;
  }

  public clearCache() {
    this.cache.clear();
  }
}

export const dynamicTranslationService = new DynamicTranslationService();
