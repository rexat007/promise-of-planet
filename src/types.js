"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_CATEGORY_DEFINITIONS = exports.CANONICAL_CATEGORIES = exports.CANONICAL_VISIBILITY_DECISIONS = exports.CANONICAL_RIGHTS_STATUSES = void 0;
exports.isCanonicalRightsStatus = isCanonicalRightsStatus;
exports.isCanonicalVisibilityDecision = isCanonicalVisibilityDecision;
exports.isCanonicalCategory = isCanonicalCategory;
exports.isCanonicalPlaylist = isCanonicalPlaylist;
/**
 * Intellectual property and media rights status.
 */
exports.CANONICAL_RIGHTS_STATUSES = [
    'NotStarted',
    'InReview',
    'Cleared',
    'NeedsChanges',
    'Rejected',
];
function isCanonicalRightsStatus(value) {
    return typeof value === 'string' && exports.CANONICAL_RIGHTS_STATUSES.includes(value);
}
/**
 * Editorial visibility scope decisions for videos.
 */
exports.CANONICAL_VISIBILITY_DECISIONS = [
    'Hidden',
    'MediaHubOnly',
    'NewsEligible',
    'Featured',
];
function isCanonicalVisibilityDecision(value) {
    return typeof value === 'string' && exports.CANONICAL_VISIBILITY_DECISIONS.includes(value);
}
/**
 * Approved core environmental categories for Promise of Planet.
 */
exports.CANONICAL_CATEGORIES = [
    'Climate',
    'Water',
    'Biodiversity',
    'Pollution',
    'Energy',
    'Agriculture',
    'EnvironmentalPolicy',
];
function isCanonicalCategory(value) {
    return typeof value === 'string' && exports.CANONICAL_CATEGORIES.includes(value);
}
exports.CANONICAL_CATEGORY_DEFINITIONS = [
    { value: 'Climate', labelAr: 'المناخ', labelEn: 'Climate' },
    { value: 'Water', labelAr: 'المياه', labelEn: 'Water' },
    { value: 'Biodiversity', labelAr: 'التنوع الحيوي', labelEn: 'Biodiversity' },
    { value: 'Pollution', labelAr: 'التلوث', labelEn: 'Pollution' },
    { value: 'Energy', labelAr: 'الطاقة', labelEn: 'Energy' },
    { value: 'Agriculture', labelAr: 'الزراعة', labelEn: 'Agriculture' },
    { value: 'EnvironmentalPolicy', labelAr: 'السياسات البيئية', labelEn: 'Environmental Policy' },
];
function isCanonicalPlaylist(value) {
    if (!value || typeof value !== 'object')
        return false;
    const p = value;
    return (typeof p.id === 'string' &&
        typeof p.titleAr === 'string' &&
        Array.isArray(p.videoIds));
}
__exportStar(require("./types/youtube"), exports);
//# sourceMappingURL=types.js.map