"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isArabicAvailableForArticle = isArabicAvailableForArticle;
exports.isEnglishAvailableForArticle = isEnglishAvailableForArticle;
exports.isArabicAvailableForVideo = isArabicAvailableForVideo;
exports.isEnglishAvailableForVideo = isEnglishAvailableForVideo;
exports.getAvailableLanguagesForArticle = getAvailableLanguagesForArticle;
exports.getAvailableLanguagesForVideo = getAvailableLanguagesForVideo;
exports.isLanguageAvailable = isLanguageAvailable;
/**
 * Validates that a string is defined and has non-whitespace characters.
 */
function isValidString(val) {
    return typeof val === 'string' && val.trim().length > 0;
}
/**
 * Checks if Arabic content is fully populated for News or Report.
 * Rule: Requires titleAr, excerptAr, and contentAr.
 */
function isArabicAvailableForArticle(item) {
    return (isValidString(item.titleAr) &&
        isValidString(item.excerptAr) &&
        isValidString(item.contentAr));
}
/**
 * Checks if English content is fully populated for News or Report.
 * Rule: Requires titleEn, excerptEn, and contentEn.
 * Note: translationStatus === 'Completed' is NOT treated as a substitute.
 */
function isEnglishAvailableForArticle(item) {
    return (isValidString(item.titleEn) &&
        isValidString(item.excerptEn) &&
        isValidString(item.contentEn));
}
/**
 * Checks if Arabic content is fully populated for Video.
 * Rule: Requires titleAr, excerptAr, and editorialDescriptionAr.
 */
function isArabicAvailableForVideo(item) {
    return (isValidString(item.titleAr) &&
        isValidString(item.excerptAr) &&
        isValidString(item.editorialDescriptionAr));
}
/**
 * Checks if English content is fully populated for Video.
 * Rule: Requires titleEn, excerptEn, and editorialDescriptionEn.
 */
function isEnglishAvailableForVideo(item) {
    return (isValidString(item.titleEn) &&
        isValidString(item.excerptEn) &&
        isValidString(item.editorialDescriptionEn));
}
/**
 * Resolves the list of verified, actually available languages for an article (News or Report).
 * Evaluates real content fields, disregarding originalLanguage or translationStatus alone.
 */
function getAvailableLanguagesForArticle(item) {
    const languages = [];
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
function getAvailableLanguagesForVideo(item) {
    const languages = [];
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
function isLanguageAvailable(item, language) {
    if (item.contentType === 'Video') {
        return language === 'ar'
            ? isArabicAvailableForVideo(item)
            : isEnglishAvailableForVideo(item);
    }
    return language === 'ar'
        ? isArabicAvailableForArticle(item)
        : isEnglishAvailableForArticle(item);
}
//# sourceMappingURL=contentLanguage.js.map