"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoRelationList = void 0;
const react_1 = require("react");
const VideoEmbed_1 = require("./VideoEmbed");
const contentFormatters_1 = require("./contentFormatters");
const contentVisibility_1 = require("../../services/contentVisibility");
const VideoRelationList = ({ article, relations, videos, placement, currentLanguage = 'ar', className = '', }) => {
    const isArabic = currentLanguage === 'ar';
    // 1. Filter relations for this specific article and optional placement filter
    const targetRelations = relations.filter((rel) => {
        if (rel.contentId !== article.id)
            return false;
        if (placement && rel.placement !== placement)
            return false;
        return true;
    });
    // 2. Sort according to displayOrder (ascending)
    const sortedRelations = [...targetRelations].sort((a, b) => a.displayOrder - b.displayOrder);
    // 3. Filter items through the central Visibility Engine (contentVisibility.ts)
    // Ensures:
    // - relation.isActive === true
    // - article is published & approved
    // - video is published & approved & rights cleared & available
    // - video is NewsEligible or Featured (MediaHubOnly and Hidden are excluded)
    const eligibleItems = sortedRelations
        .map((relation) => {
        const video = videos.find((v) => v.id === relation.videoId);
        if (!video)
            return null;
        const visibilityCheck = (0, contentVisibility_1.isVideoVisibleInArticle)(article, video, relation, currentLanguage);
        if (!visibilityCheck.visible) {
            return null;
        }
        return { relation, video };
    })
        .filter((item) => item !== null);
    if (eligibleItems.length === 0) {
        return null;
    }
    return (<div className={`space-y-6 ${className}`} aria-label={isArabic ? 'المواد المرئية المرتبطة' : 'Related Media'}>
      {eligibleItems.map(({ relation, video }) => {
            const videoTitle = isArabic
                ? video.titleAr || video.titleEn || ''
                : video.titleEn || video.titleAr || '';
            return (<figure key={relation.id} className="flex flex-col rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 p-4">
            {/* Relation Header Tag */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span>{(0, contentFormatters_1.getRelationTypeLabel)(relation.relationType, isArabic)}</span>
              </span>

              {relation.isPrimary && (<span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                  {isArabic ? 'الفيديو الأساسي للتغطية' : 'Primary Media'}
                </span>)}
            </div>

            {/* Video Player Embed */}
            <VideoEmbed_1.VideoEmbed youtubeSource={video.youtubeSource} title={videoTitle} isArabic={isArabic}/>

            {/* Caption & Attribution */}
            {(relation.caption || videoTitle) && (<figcaption className="mt-3 text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                {relation.caption ? (<span>{relation.caption}</span>) : (<span className="font-medium text-gray-900 dark:text-gray-100">{videoTitle}</span>)}
                {video.youtubeSource.channelName && (<span className="block text-xs text-gray-400 mt-1">
                    {isArabic ? `المصدر: ${video.youtubeSource.channelName}` : `Source: ${video.youtubeSource.channelName}`}
                  </span>)}
              </figcaption>)}
          </figure>);
        })}
    </div>);
};
exports.VideoRelationList = VideoRelationList;
//# sourceMappingURL=VideoRelationList.js.map