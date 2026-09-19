import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Users, 
  Search, 
  FileText, 
  Eye
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import type { CitizenSubmission } from '../../types/community';
import { SubmissionStatus } from '../../types/community';
import { MOCK_CITIZEN_SUBMISSIONS } from '../../data/mockCommunityData';
import { CitizenSubmissionReviewModal } from './CitizenSubmissionReviewModal';
import { getCommunityCategoryLabel } from '../content/contentFormatters';
import { dynamicTranslationService } from '../../services/dynamicTranslation';

interface AdminCommunityManagementProps {
  currentUser: AdminUser;
}

export function AdminCommunityManagement({ currentUser }: AdminCommunityManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const targetLang = isAr ? 'ar' : 'en';

  const [submissions, setSubmissions] = useState<CitizenSubmission[]>(MOCK_CITIZEN_SUBMISSIONS);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('ALL');

  // Modal State
  const [activeSubmission, setActiveSubmission] = useState<CitizenSubmission | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Unique Categories from mock data
  const categories = useMemo(() => {
    const set = new Set(submissions.map(s => s.category));
    return Array.from(set);
  }, [submissions]);

  // Filtered Submissions Computation
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((sub) => {
      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = sub.title.toLowerCase().includes(q);
        const matchBody = sub.body.toLowerCase().includes(q);
        const matchContributor = sub.contributorName.toLowerCase().includes(q);
        const matchLocation = sub.locationDescription?.toLowerCase().includes(q) || false;
        if (!matchTitle && !matchBody && !matchContributor && !matchLocation) {
          return false;
        }
      }

      // Status
      if (selectedStatus !== 'ALL' && sub.status !== selectedStatus) {
        return false;
      }

      // Category
      if (selectedCategory !== 'ALL' && sub.category !== selectedCategory) {
        return false;
      }

      // Language
      if (selectedLanguage !== 'ALL' && sub.sourceLanguage !== selectedLanguage) {
        return false;
      }

      return true;
    });
  }, [submissions, searchQuery, selectedStatus, selectedCategory, selectedLanguage]);

  const handleUpdateSubmission = (updated: CitizenSubmission) => {
    setSubmissions(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const getStatusBadge = (status: SubmissionStatus) => {
    switch (status) {
      case SubmissionStatus.Received:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            {isAr ? 'مستلم جديد' : 'Received'}
          </span>
        );
      case SubmissionStatus.UnderReview:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            {isAr ? 'قيد المراجعة' : 'Under Review'}
          </span>
        );
      case SubmissionStatus.AcceptedForEditorial:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            {isAr ? 'مقبول للتحرير' : 'Accepted for Editorial'}
          </span>
        );
      case SubmissionStatus.Rejected:
        return (
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            {isAr ? 'مرفوض' : 'Rejected'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6" id="admin-community-management">
      
      {/* Header & Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
              <Users className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
              {isAr ? 'إدارة مشاركات صحافة المواطن والمجتمع' : 'Citizen Journalism & Community Submissions'}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            {isAr 
              ? 'مراجعة بلاغات التقارير البيئية الميدانية، وتدقيق الوثائق، وتوجيه المساهمات نحو المسار التحريري المناسب.'
              : 'Review field environmental reports submitted by citizens, inspect evidence, and manage editorial routing.'}
          </p>
        </div>
        
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs">
            {isAr ? `الإجمالي: ${filteredSubmissions.length}` : `Total: ${filteredSubmissions.length}`}
          </span>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-4 rounded-2xl shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث في العنوان، النص، أو المبلغ...' : 'Search title, body, contributor...'}
              className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 text-xs sm:text-sm text-gray-900 dark:text-white font-medium focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="ALL">{isAr ? 'جميع الحالات' : 'All Statuses'}</option>
            <option value={SubmissionStatus.Received}>{isAr ? 'مستلم جديد' : 'Received'}</option>
            <option value={SubmissionStatus.UnderReview}>{isAr ? 'قيد المراجعة' : 'Under Review'}</option>
            <option value={SubmissionStatus.AcceptedForEditorial}>{isAr ? 'مقبول للتحرير' : 'Accepted for Editorial'}</option>
            <option value={SubmissionStatus.Rejected}>{isAr ? 'مرفوض' : 'Rejected'}</option>
          </select>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 text-xs sm:text-sm text-gray-900 dark:text-white font-medium focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="ALL">{isAr ? 'جميع التصنيفات البيئية' : 'All Categories'}</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{getCommunityCategoryLabel(cat, isAr)}</option>
            ))}
          </select>

          {/* Language Filter */}
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 text-xs sm:text-sm text-gray-900 dark:text-white font-medium focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="ALL">{isAr ? 'جميع اللغات' : 'All Languages'}</option>
            <option value="ar">العربية (Arabic)</option>
            <option value="en">الإنجليزية (English)</option>
          </select>

        </div>
      </div>

      {/* Submissions Management Presentation (<1280px Compact Cards, >=1280px Dense Table) */}
      <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xs w-full max-w-full min-w-0">
        {filteredSubmissions.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-2">
            <FileText className="w-8 h-8 mx-auto opacity-40" />
            <p className="font-semibold text-sm">{isAr ? 'لا توجد بلاغات مطابقة لمحددات البحث' : 'No citizen submissions match the selected filters'}</p>
          </div>
        ) : (
          <>
            {/* Compact Cards Presentation (< 1280px) */}
            <div className="block xl:hidden divide-y divide-gray-100 dark:divide-gray-800 w-full max-w-full min-w-0">
              {filteredSubmissions.map((sub) => {
                const displayTitle = dynamicTranslationService.translateText(sub.title, sub.sourceLanguage, targetLang, sub.id);
                const displayBody = dynamicTranslationService.translateText(sub.body, sub.sourceLanguage, targetLang, sub.id);
                return (
                <div key={sub.id} className="p-4 sm:p-5 space-y-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors w-full max-w-full min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-xs">
                      {getCommunityCategoryLabel(sub.category, isAr)}
                    </span>
                    {getStatusBadge(sub.status)}
                  </div>

                  <div className="space-y-1">
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base leading-snug">
                      {displayTitle}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                      {displayBody}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    <div>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{sub.contributorName}</span>
                      <span className="mx-2">•</span>
                      <span>{new Date(sub.submittedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US')}</span>
                    </div>

                    <button
                      onClick={() => {
                        setActiveSubmission(sub);
                        setIsModalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isAr ? 'مراجعة وتدقيق' : 'Review & Moderate'}</span>
                    </button>
                  </div>
                </div>
              );
              })}
            </div>

            {/* Dense Desktop Table Presentation (>= 1280px) */}
            <div className="hidden xl:block overflow-x-auto w-full max-w-full min-w-0">
              <table className="w-full text-start text-xs sm:text-sm border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 text-start">{isAr ? 'عنوان البلاغ البيئي' : 'Submission Title'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'المبلغ / المساهم' : 'Contributor'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'التصنيف' : 'Category'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'حالة الإشراف' : 'Moderation Status'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'تاريخ الاستلام' : 'Submitted Date'}</th>
                    <th className="p-3.5 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredSubmissions.map((sub) => {
                    const displayTitle = dynamicTranslationService.translateText(sub.title, sub.sourceLanguage, targetLang, sub.id);
                    const displayBody = dynamicTranslationService.translateText(sub.body, sub.sourceLanguage, targetLang, sub.id);
                    return (
                    <tr key={sub.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="p-3.5 max-w-xs sm:max-w-md">
                        <p className="font-bold text-gray-900 dark:text-white line-clamp-1">
                          {displayTitle}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                          {displayBody}
                        </p>
                      </td>
                      <td className="p-3.5 whitespace-nowrap font-semibold text-gray-800 dark:text-gray-200">
                        {sub.contributorName}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-xs">
                          {getCommunityCategoryLabel(sub.category, isAr)}
                        </span>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        {getStatusBadge(sub.status)}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {new Date(sub.submittedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-end">
                        <button
                          onClick={() => {
                            setActiveSubmission(sub);
                            setIsModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isAr ? 'مراجعة وتدقيق' : 'Review & Moderate'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Review Modal */}
      <CitizenSubmissionReviewModal
        submission={activeSubmission}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setActiveSubmission(null);
        }}
        onUpdate={handleUpdateSubmission}
        currentUser={currentUser}
        isAr={isAr}
      />

    </div>
  );
}
