import React from 'react';
import type { News, Report, Video, ContentVideoRelation } from '../../types';
import { ReportCard } from './ReportCard';
import { NewsCard } from './NewsCard';
import { VideoCard } from './VideoCard';
import { VideoRelationList } from './VideoRelationList';

export interface FeaturedSectionProps {
  featuredItems: (News | Report | Video)[];
  currentLanguage: 'ar' | 'en';
  relations?: ContentVideoRelation[];
  allVideos?: Video[];
  className?: string;
}

export const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  featuredItems,
  currentLanguage,
  relations = [],
  allVideos = [],
  className = '',
}) => {
  if (featuredItems.length === 0) {
    return null;
  }

  // Primary featured item (first item) gets spotlight display
  const primaryItem = featuredItems[0];
  const secondaryItems = featuredItems.slice(1);

  return (
    <div className={`space-y-8 ${className}`}>
      {/* Primary Spotlight Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className={secondaryItems.length > 0 ? 'lg:col-span-8' : 'lg:col-span-12'}>
          {primaryItem.contentType === 'Report' && (
            <div className="space-y-6">
              <ReportCard
                report={primaryItem as Report}
                currentLanguage={currentLanguage}
                className="shadow-md border-emerald-600/30 dark:border-emerald-600/30 ring-1 ring-emerald-600/20"
              />
              {/* If primary report has associated videos, display them seamlessly using Many-to-Many */}
              {relations.length > 0 && allVideos.length > 0 && (
                <div className="mt-4 bg-gray-50/80 dark:bg-gray-900/50 rounded-2xl p-4 sm:p-6 border border-gray-200 dark:border-gray-800">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 mb-4">
                    {currentLanguage === 'ar' ? 'التغطية المرئية المصاحبة للتحقيق' : 'Accompanying Visual Coverage'}
                  </h4>
                  <VideoRelationList
                    article={primaryItem as Report}
                    relations={relations}
                    videos={allVideos}
                    currentLanguage={currentLanguage}
                  />
                </div>
              )}
            </div>
          )}

          {primaryItem.contentType === 'News' && (
            <NewsCard
              news={primaryItem as News}
              currentLanguage={currentLanguage}
              className="shadow-md border-emerald-600/30 dark:border-emerald-600/30 ring-1 ring-emerald-600/20"
            />
          )}

          {primaryItem.contentType === 'Video' && (
            <VideoCard
              video={primaryItem as Video}
              currentLanguage={currentLanguage}
              className="shadow-md border-emerald-600/30 dark:border-emerald-600/30 ring-1 ring-emerald-600/20"
            />
          )}
        </div>

        {/* Secondary Featured Items */}
        {secondaryItems.length > 0 && (
          <div className="lg:col-span-4 flex flex-col gap-6">
            {secondaryItems.map((item) => {
              if (item.contentType === 'Report') {
                return (
                  <ReportCard
                    key={item.id}
                    report={item as Report}
                    currentLanguage={currentLanguage}
                  />
                );
              }
              if (item.contentType === 'News') {
                return (
                  <NewsCard
                    key={item.id}
                    news={item as News}
                    currentLanguage={currentLanguage}
                  />
                );
              }
              if (item.contentType === 'Video') {
                return (
                  <VideoCard
                    key={item.id}
                    video={item as Video}
                    currentLanguage={currentLanguage}
                  />
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
};
