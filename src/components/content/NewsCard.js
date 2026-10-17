"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsCard = void 0;
const react_1 = require("react");
const ContentCard_1 = require("./ContentCard");
const contentFormatters_1 = require("./contentFormatters");
const contentLanguage_1 = require("../../services/contentLanguage");
const NewsCard = ({ news, currentLanguage, onClick, className = '', }) => {
    const isArabic = currentLanguage === 'ar';
    const hasArabic = (0, contentLanguage_1.isArabicAvailableForArticle)(news);
    const hasEnglish = (0, contentLanguage_1.isEnglishAvailableForArticle)(news);
    // Resolve localized text without defaulting to empty text when requested lang is missing
    let title = '';
    let excerpt = '';
    if (isArabic) {
        title = hasArabic ? news.titleAr : (news.titleEn || news.titleAr);
        excerpt = hasArabic ? news.excerptAr : (news.excerptEn || news.excerptAr);
    }
    else {
        // English requested
        title = hasEnglish ? (news.titleEn || '') : news.titleAr;
        excerpt = hasEnglish ? (news.excerptEn || '') : news.excerptAr;
    }
    // Urgency badge if Urgent or Breaking
    let badge = null;
    if (news.urgencyLevel === 'Breaking') {
        badge = (<span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-red-600 text-white shadow-sm animate-pulse">
        {(0, contentFormatters_1.getUrgencyLabel)('Breaking', isArabic)}
      </span>);
    }
    else if (news.urgencyLevel === 'Urgent') {
        badge = (<span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500 text-white shadow-sm">
        {(0, contentFormatters_1.getUrgencyLabel)('Urgent', isArabic)}
      </span>);
    }
    return (<ContentCard_1.ContentCard contentType="News" title={title} excerpt={excerpt} category={news.category} publishedAt={news.publishedAt || news.createdAt} isArabic={isArabic} featuredImage={news.featuredImage} authorOrProducer={news.author} location={news.location} badge={badge} onClick={onClick} className={className}/>);
};
exports.NewsCard = NewsCard;
//# sourceMappingURL=NewsCard.js.map