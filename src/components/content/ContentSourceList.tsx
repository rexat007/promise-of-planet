import React from 'react';
import type { ContentSource } from '../../types';
import { getSourceTypeLabel, formatDate } from './contentFormatters';

export interface ContentSourceListProps {
  sources: ContentSource[];
  isArabic?: boolean;
  className?: string;
}

export const ContentSourceList: React.FC<ContentSourceListProps> = ({
  sources,
  isArabic = true,
  className = '',
}) => {
  if (!sources || sources.length === 0) {
    return null;
  }

  return (
    <section
      className={`rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 p-5 ${className}`}
      aria-label={isArabic ? 'المصادر والتوثيق' : 'Sources and Documentation'}
    >
      <div className="flex items-center gap-2 mb-4">
        <svg
          className="w-4 h-4 text-emerald-700 dark:text-emerald-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">
          {isArabic ? 'المصادر والتوثيق التحريري' : 'Editorial Sources & Evidence'}
        </h4>
        <span className="text-xs text-gray-400 font-mono">({sources.length})</span>
      </div>

      <ul className="divide-y divide-gray-200/70 dark:divide-gray-800/70">
        {sources.map((source) => {
          const accessedDate = formatDate(source.accessedAt, isArabic);

          return (
            <li key={source.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {source.sourceName}
                  </span>
                  {source.isPrimarySource && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                      {isArabic ? 'مصدر رئيسي' : 'Primary Source'}
                    </span>
                  )}
                </div>

                <span className="text-xs px-2 py-0.5 rounded bg-gray-200/70 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {getSourceTypeLabel(source.sourceType, isArabic)}
                </span>
              </div>

              {source.reliabilityNotes && (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                  {source.reliabilityNotes}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 mt-1">
                {accessedDate && (
                  <span>
                    {isArabic ? `تاريخ المراجعة: ${accessedDate}` : `Accessed: ${accessedDate}`}
                  </span>
                )}
                {source.sourceUrl && (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline font-medium"
                  >
                    <span>{isArabic ? 'رابط الوثيقة / المصدر' : 'View Source Link'}</span>
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
