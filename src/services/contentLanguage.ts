import type { Language, News, Report, Video } from '../types';

/**
 * Validates that a string is defined and has non-whitespace characters.
 */
function isValidString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Checks if Arabic content is fully populated for News or Report.
 * Rule: Requires titleAr, excerptAr, and contentAr.
 */
export function isArabicAvailableForArticle(item: News | Report): boolean {
  return (
    isValidString(item.titleAr) &&
    isValidString(item.excerptAr) &&
    isValidString(item.contentAr)
  );
}

/**
 * Checks if English content is fully populated for News or Report.
 * Rule: Requires titleEn, excerptEn, and contentEn.
 * Note: translationStatus === 'Completed' is NOT treated as a substitute.
 */
export function isEnglishAvailableForArticle(item: News | Report): boolean {
  return (
    isValidString(item.titleEn) &&
    isValidString(item.excerptEn) &&
    isValidString(item.contentEn)
  );
}

/**
 * Checks if Arabic content is fully populated for Video.
 * Rule: Requires titleAr, excerptAr, and editorialDescriptionAr.
 */
export function isArabicAvailableForVideo(item: Video): boolean {
  return (
    isValidString(item.titleAr) &&
    isValidString(item.excerptAr) &&
    isValidString(item.editorialDescriptionAr)
  );
}

/**
 * Checks if English content is fully populated for Video.
 * Rule: Requires titleEn, excerptEn, and editorialDescriptionEn.
 */
export function isEnglishAvailableForVideo(item: Video): boolean {
  return (
    isValidString(item.titleEn) &&
    isValidString(item.excerptEn) &&
    isValidString(item.editorialDescriptionEn)
  );
}

/**
 * Resolves the list of verified, actually available languages for an article (News or Report).
 * Evaluates real content fields, disregarding originalLanguage or translationStatus alone.
 */
export function getAvailableLanguagesForArticle(item: News | Report): Language[] {
  const languages: Language[] = [];
  if (isArabicAvailableForArticle(item)) {
    languages.push('ar');
  }
  if (isEnglishAvailableForArticle(item)) {
    languages.push('en');
  }
  return languages;
}

/**
 * Resolves the list of verified, actually available languages for a Video.
 * Evaluates real editorial fields, disregarding originalLanguage or translationStatus alone.
 */
export function getAvailableLanguagesForVideo(item: Video): Language[] {
  const languages: Language[] = [];
  if (isArabicAvailableForVideo(item)) {
    languages.push('ar');
  }
  if (isEnglishAvailableForVideo(item)) {
    languages.push('en');
  }
  return languages;
}

/**
 * Unified check to verify if a content item (News, Report, or Video)
 * is legitimately available in the specified target language.
 */
export function isLanguageAvailable(
  item: News | Report | Video,
  language: Language
): boolean {
  if (item.contentType === 'Video') {
    return language === 'ar'
      ? isArabicAvailableForVideo(item)
      : isEnglishAvailableForVideo(item);
  }
  return language === 'ar'
    ? isArabicAvailableForArticle(item)
    : isEnglishAvailableForArticle(item);
}
