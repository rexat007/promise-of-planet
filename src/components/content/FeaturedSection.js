"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeaturedSection = void 0;
const react_1 = require("react");
const ReportCard_1 = require("./ReportCard");
const NewsCard_1 = require("./NewsCard");
const VideoCard_1 = require("./VideoCard");
const VideoRelationList_1 = require("./VideoRelationList");
const FeaturedSection = ({ featuredItems, currentLanguage, relations = [], allVideos = [], className = '', }) => {
    if (featuredItems.length === 0) {
        return null;
    }
    // Primary featured item (first item) gets spotlight display
    const primaryItem = featuredItems[0];
    const secondaryItems = featuredItems.slice(1);
    return (<div className={`space-y-8 ${className}`}>
      {/* Primary Spotlight Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className={secondaryItems.length > 0 ? 'lg:col-span-8' : 'lg:col-span-12'}>
          {primaryItem.contentType === 'Report' && (<div className="space-y-6">
              <ReportCard_1.ReportCard report={primaryItem} currentLanguage={currentLanguage} className="shadow-md border-emerald-600/30 dark:border-emerald-600/30 ring-1 ring-emerald-600/20"/>
              {/* If primary report has associated videos, display them seamlessly using Many-to-Many */}
              {relations.length > 0 && allVideos.length > 0 && (<div className="mt-4 bg-gray-50/80 dark:bg-gray-900/50 rounded-2xl p-4 sm:p-6 border border-gray-200 dark:border-gray-800">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 mb-4">
                    {currentLanguage === 'ar' ? 'التغطية المرئية المصاحبة للتحقيق' : 'Accompanying Visual Coverage'}
                  </h4>
                  <VideoRelationList_1.VideoRelationList article={primaryItem} relations={relations} videos={allVideos} currentLanguage={currentLanguage}/>
                </div>)}
            </div>)}

          {primaryItem.contentType === 'News' && (<NewsCard_1.NewsCard news={primaryItem} currentLanguage={currentLanguage} className="shadow-md border-emerald-600/30 dark:border-emerald-600/30 ring-1 ring-emerald-600/20"/>)}

          {primaryItem.contentType === 'Video' && (<VideoCard_1.VideoCard video={primaryItem} currentLanguage={currentLanguage} className="shadow-md border-emerald-600/30 dark:border-emerald-600/30 ring-1 ring-emerald-600/20"/>)}
        </div>

        {/* Secondary Featured Items */}
        {secondaryItems.length > 0 && (<div className="lg:col-span-4 flex flex-col gap-6">
            {secondaryItems.map((item) => {
                if (item.contentType === 'Report') {
                    return (<ReportCard_1.ReportCard key={item.id} report={item} currentLanguage={currentLanguage}/>);
                }
                if (item.contentType === 'News') {
                    return (<NewsCard_1.NewsCard key={item.id} news={item} currentLanguage={currentLanguage}/>);
                }
                if (item.contentType === 'Video') {
                    return (<VideoCard_1.VideoCard key={item.id} video={item} currentLanguage={currentLanguage}/>);
                }
                return null;
            })}
          </div>)}
      </div>
    </div>);
};
exports.FeaturedSection = FeaturedSection;
//# sourceMappingURL=FeaturedSection.js.map