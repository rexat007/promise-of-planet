import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NEWS_CATEGORIES } from '../../types/news';
import type { NewsItem } from '../../types/news';
import { INITIAL_MOCK_NEWS } from '../../data/mockNewsData';
import { WorkflowState } from '../../types/workflow';
import type { WorkflowTransitionConfig } from '../../types/workflow';
import type { AdminUser } from '../../types/admin';
import { WorkflowEngine } from '../../services/workflowEngine';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission } from '../../types/admin';
import { 
  Newspaper, 
  Search, 
  Filter, 
  Plus, 
  Edit3, 
  Eye, 
  X, 
  Save, 
  FileEdit, 
  FileSearch, 
  CheckCircle2, 
  Globe, 
  RotateCcw, 
  Clock, 
  Tag, 
  Link as LinkIcon, 
  MessageSquare, 
  ShieldAlert, 
  Check, 
  History,
  AlertCircle
} from 'lucide-react';

interface AdminNewsManagementProps {
  currentUser: AdminUser;
}

export function AdminNewsManagement({ currentUser }: AdminNewsManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // State
  const [newsList, setNewsList] = useState<NewsItem[]>(INITIAL_MOCK_NEWS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  
  // Modal state
  const [activeItem, setActiveItem] = useState<NewsItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaveSuccess, setIsSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'workflow'>('content');

  // Notification and error states
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-dismiss and animate success notification after 3 seconds within the single modal container
  useEffect(() => {
    if (isSaveSuccess) {
      const animFrame = requestAnimationFrame(() => {
        setNotificationVisible(true);
      });

      const dismissTimer = setTimeout(() => {
        setNotificationVisible(false);
        const cleanupTimer = setTimeout(() => {
          setIsSaveSuccess(false);
          setActiveItem(null);
          setIsCreating(false);
          setSuccessNotification(null);
        }, 300);
        return () => clearTimeout(cleanupTimer);
      }, 3000);

      return () => {
        cancelAnimationFrame(animFrame);
        clearTimeout(dismissTimer);
      };
    } else {
      setNotificationVisible(false);
    }
  }, [isSaveSuccess]);

  const handleCloseModal = () => {
    setNotificationVisible(false);
    setTimeout(() => {
      setIsSaveSuccess(false);
      setActiveItem(null);
      setIsCreating(false);
      setSuccessNotification(null);
    }, 200);
  };

  // Comment prompt state for transitions requiring comments (e.g., Request Changes)
  const [pendingTransition, setPendingTransition] = useState<WorkflowTransitionConfig | null>(null);
  const [transitionComment, setTransitionComment] = useState('');

  // Form state for editor
  const [editForm, setEditForm] = useState<Partial<NewsItem>>({});
  const [tagsInput, setTagsInput] = useState<string>('');
  const [sourcesInput, setSourcesInput] = useState<string>('');

  // Check user permission to create/edit
  const canCreate = AdminAccessService.hasPermission(currentUser, AdminPermission.Create);
  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit) || canCreate;

  // Filtered news items
  const filteredNews = newsList.filter(item => {
    const matchesSearch = 
      item.titleAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.titleEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summaryAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summaryEn.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatus === 'All' || item.workflowState === selectedStatus;
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  // Open item for editing/viewing
  const handleOpenItem = (item: NewsItem) => {
    setActiveItem(item);
    setEditForm({ ...item });
    setTagsInput(Array.isArray(item.tags) ? item.tags.join(', ') : '');
    setSourcesInput(Array.isArray(item.sources) ? item.sources.join(', ') : '');
    setIsCreating(false);
    setIsSaveSuccess(false);
    setSuccessNotification(null);
    setActiveTab('content');
    setErrorMessage(null);
  };

  // Start creating new article
  const handleStartCreate = () => {
    const newItem: NewsItem = {
      id: `news-sudan-${Date.now()}`,
      titleAr: '',
      titleEn: '',
      summaryAr: '',
      summaryEn: '',
      bodyAr: '',
      bodyEn: '',
      author: currentUser.name,
      category: NEWS_CATEGORIES[0].labelAr,
      tags: [],
      sources: [],
      workflowState: WorkflowState.Draft,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    };
    setActiveItem(newItem);
    setEditForm({ ...newItem });
    setTagsInput('');
    setSourcesInput('');
    setIsCreating(true);
    setIsSaveSuccess(false);
    setSuccessNotification(null);
    setActiveTab('content');
    setErrorMessage(null);
  };

  // Save article edits
  const handleSaveForm = () => {
    if (!editForm.titleAr?.trim()) {
      setErrorMessage(isAr ? 'يرجى كتابة عنوان المقال باللغة العربية' : 'Arabic title is required');
      return;
    }

    const parsedTags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const parsedSources = sourcesInput.split(',').map(s => s.trim()).filter(Boolean);

    if (isCreating) {
      const createdItem: NewsItem = {
        ...(editForm as NewsItem),
        tags: parsedTags,
        sources: parsedSources,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setNewsList([createdItem, ...newsList]);
    } else if (activeItem) {
      const updatedItem: NewsItem = {
        ...(editForm as NewsItem),
        tags: parsedTags,
        sources: parsedSources,
        updatedAt: new Date().toISOString(),
      };
      setNewsList(newsList.map(item => item.id === updatedItem.id ? updatedItem : item));
    }

    setErrorMessage(null);
    setSuccessNotification(
      isAr ? 'تم حفظ التعديلات بنجاح' : 'Article changes saved successfully'
    );
    setIsSaveSuccess(true);
  };

  // Execute workflow transition on activeItem
  const handleExecuteTransition = (config: WorkflowTransitionConfig, comment?: string) => {
    if (!activeItem) return;

    // Build adapter object for WorkflowEngine
    const adapterItem = {
      id: activeItem.id,
      titleAr: activeItem.titleAr,
      titleEn: activeItem.titleEn,
      contentType: 'News' as const,
      currentState: activeItem.workflowState,
      authorName: activeItem.author,
      createdAt: activeItem.createdAt,
      updatedAt: activeItem.updatedAt,
      category: activeItem.category,
      history: activeItem.history,
    };

    try {
      const resultAdapter = WorkflowEngine.executeTransition(
        adapterItem,
        config.toState,
        currentUser,
        comment
      );

      const updatedNewsItem: NewsItem = {
        ...activeItem,
        workflowState: resultAdapter.currentState,
        updatedAt: resultAdapter.updatedAt,
        history: resultAdapter.history,
      };

      setActiveItem(updatedNewsItem);
      setNewsList(newsList.map(n => n.id === updatedNewsItem.id ? updatedNewsItem : n));
      setPendingTransition(null);
      setTransitionComment('');
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || (isAr ? 'فشل تنفيذ عملية الانتقال' : 'Transition failed'));
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Draft:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 inline-flex items-center gap-1">
            <FileEdit className="w-3 h-3 text-gray-500" />
            <span>{isAr ? 'مسودة' : 'Draft'}</span>
          </span>
        );
      case WorkflowState.InReview:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/50 inline-flex items-center gap-1">
            <FileSearch className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span>{isAr ? 'قيد المراجعة' : 'In Review'}</span>
          </span>
        );
      case WorkflowState.ChangesRequested:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/50 inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            <span>{isAr ? 'تعديلات مطلوبة' : 'Changes Requested'}</span>
          </span>
        );
      case WorkflowState.Approved:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/50 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
            <span>{isAr ? 'معتمد' : 'Approved'}</span>
          </span>
        );
      case WorkflowState.Published:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/50 inline-flex items-center gap-1">
            <Globe className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>{isAr ? 'منشور' : 'Published'}</span>
          </span>
        );
      default:
        return null;
    }
  };

  // All 5 states for the visual stepper
  const lifecycleStates: { key: WorkflowState; labelAr: string; labelEn: string; icon: any }[] = [
    { key: WorkflowState.Draft, labelAr: 'مسودة', labelEn: 'Draft', icon: FileEdit },
    { key: WorkflowState.InReview, labelAr: 'قيد المراجعة', labelEn: 'In Review', icon: FileSearch },
    { key: WorkflowState.ChangesRequested, labelAr: 'تعديلات مطلوبة', labelEn: 'Changes Requested', icon: RotateCcw },
    { key: WorkflowState.Approved, labelAr: 'معتمد', labelEn: 'Approved', icon: CheckCircle2 },
    { key: WorkflowState.Published, labelAr: 'منشور للجمهور', labelEn: 'Published', icon: Globe },
  ];

  return (
    <div className="space-y-6" id="admin-news-management-view">
      {/* Top Header Banner */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 shrink-0">
            <Newspaper className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
              <span>{isAr ? 'إدارة الأخبار والتغطيات البيئية' : 'Environmental Newsroom Management'}</span>
              <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 rounded-md">
                {isAr ? 'نواة الأخبار' : 'Newsroom Core'}
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              {isAr 
                ? 'إدارة وتقييم المقالات الإخبارية، والتقارير الميدانية من الولايات، وتوجيهها خلال دورة الاعتماد والنشر.'
                : 'Manage news articles, regional environmental bulletins, and guide stories through the editorial workflow.'}
            </p>
          </div>
        </div>

        {canCreate && (
          <button
            onClick={handleStartCreate}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-sm inline-flex items-center justify-center gap-2 transition-all shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{isAr ? 'إضافة خبر بيئي جديد' : 'New News Article'}</span>
          </button>
        )}
      </div>

      {/* Filter and Search Toolbar */}
      <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 shadow-xs space-y-3 sm:space-y-0 sm:flex sm:items-center justify-between gap-3 w-full max-w-full min-w-0">
        {/* Search Input */}
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isAr ? 'البحث بالعنوان، الكاتب، أو المضمون...' : 'Search by title, author, or content...'}
            className="w-full ps-9 pe-4 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg text-xs sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 min-w-0">
            <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent text-xs font-semibold text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer truncate max-w-[140px]"
            >
              <option value="All">{isAr ? 'كافة الحالات' : 'All States'}</option>
              <option value={WorkflowState.Draft}>{isAr ? 'مسودة' : 'Draft'}</option>
              <option value={WorkflowState.InReview}>{isAr ? 'قيد المراجعة' : 'In Review'}</option>
              <option value={WorkflowState.ChangesRequested}>{isAr ? 'تعديلات مطلوبة' : 'Changes Requested'}</option>
              <option value={WorkflowState.Approved}>{isAr ? 'معتمد' : 'Approved'}</option>
              <option value={WorkflowState.Published}>{isAr ? 'منشور' : 'Published'}</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 min-w-0">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent text-xs font-semibold text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer truncate max-w-[140px]"
            >
              <option value="All">{isAr ? 'كافة التصنيفات' : 'All Categories'}</option>
              {NEWS_CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.labelAr}>
                  {isAr ? cat.labelAr : cat.labelEn}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* News Management View (< 1280px Compact Cards, >= 1280px Dense Table) */}
      <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xs w-full max-w-full min-w-0">
        {filteredNews.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-2">
            <Newspaper className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
            <p className="font-semibold text-sm">{isAr ? 'لا توجد أخبار تنطبق على محددات البحث' : 'No news articles match the selected filters'}</p>
          </div>
        ) : (
          <>
            {/* Compact Cards List (< 1280px) */}
            <div className="block xl:hidden divide-y divide-gray-100 dark:divide-gray-800 w-full max-w-full min-w-0">
              {filteredNews.map(item => (
                <div key={item.id} className="p-4 sm:p-5 space-y-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors w-full max-w-full min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-xs">
                      {item.category}
                    </span>
                    {renderStatusBadge(item.workflowState)}
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base leading-snug">
                      {isAr ? item.titleAr : (item.titleEn || item.titleAr)}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                      {isAr ? (item.titleEn || item.summaryAr) : item.summaryEn}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    <div>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{item.author}</span>
                      <span className="mx-2">•</span>
                      <span>{new Date(item.updatedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    </div>
                    <button
                      onClick={() => handleOpenItem(item)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isAr ? 'العرض والتحرير' : 'View & Edit'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Dense Desktop Table View (>= 1280px) */}
            <div className="hidden xl:block overflow-x-auto w-full max-w-full min-w-0">
              <table className="w-full text-start text-xs sm:text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 text-start">{isAr ? 'عنوان الخبر البيئي' : 'News Article Title'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'التصنيف' : 'Category'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'الكاتب' : 'Author'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'حالة الاعتماد' : 'Workflow Status'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'آخر تحديث' : 'Last Updated'}</th>
                    <th className="p-3.5 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredNews.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="p-3.5 max-w-xs sm:max-w-md">
                        <p className="font-bold text-gray-900 dark:text-white line-clamp-1">
                          {isAr ? item.titleAr : (item.titleEn || item.titleAr)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                          {isAr ? (item.titleEn || item.summaryAr) : item.summaryEn}
                        </p>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-xs">
                          {item.category}
                        </span>
                      </td>
                      <td className="p-3.5 whitespace-nowrap font-medium text-gray-700 dark:text-gray-300">
                        {item.author}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        {renderStatusBadge(item.workflowState)}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {new Date(item.updatedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-end">
                        <button
                          onClick={() => handleOpenItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isAr ? 'العرض والتحرير' : 'View & Edit'}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Editor & Workflow Modal Layer */}
      {activeItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto pop-motion-modal">
          {isSaveSuccess ? (
            /* SUCCESS CONFIRMATION CONTENT IN SAME OVERLAY */
            <div 
              className={`bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl max-w-md w-full p-6 sm:p-8 flex flex-col items-center text-center shadow-2xl transition-all duration-[var(--pop-duration-modal)] ease-[var(--pop-ease-out)] transform my-auto ${
                notificationVisible
                  ? 'opacity-100 scale-100 translate-y-0'
                  : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-100 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {isAr ? 'تم الحفظ بنجاح' : 'Successfully Saved'}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-6">
                {successNotification}
              </p>
              <button
                onClick={handleCloseModal}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs pop-motion-micro pop-hover-lift cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{isAr ? 'موافق' : 'OK'}</span>
              </button>
            </div>
          ) : (
            /* EDIT CONTENT IN SAME OVERLAY */
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto pop-motion-modal">
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-gray-800/40">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 shrink-0">
                    <Newspaper className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
                        {isCreating 
                          ? (isAr ? 'إنشاء مقال خبري جديد' : 'Create New News Article')
                          : (isAr ? activeItem.titleAr : (activeItem.titleEn || activeItem.titleAr))}
                      </h2>
                      {renderStatusBadge(activeItem.workflowState)}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {isAr ? `الكاتب: ${activeItem.author}` : `Author: ${activeItem.author}`}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleCloseModal}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

            {/* Error banner if present */}
            {errorMessage && (
              <div className="bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-900 px-5 py-3 flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Modal Tab Controls */}
            <div className="border-b border-gray-100 dark:border-gray-800 px-5 flex items-center gap-6 bg-white dark:bg-gray-900">
              <button
                onClick={() => setActiveTab('content')}
                className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'content'
                    ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Edit3 className="w-4 h-4" />
                <span>{isAr ? 'بيانات ومضمون الخبر' : 'Article Content & Fields'}</span>
              </button>

              <button
                onClick={() => setActiveTab('workflow')}
                className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'workflow'
                    ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <History className="w-4 h-4" />
                <span>{isAr ? 'دورة الاعتماد وسجل التغييرات' : 'Workflow & Audit History'}</span>
                {activeItem.history.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-extrabold">
                    {activeItem.history.length}
                  </span>
                )}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-6">
              {activeTab === 'content' ? (
                <div className="space-y-4">
                  {/* Arabic Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span>{isAr ? 'عنوان الخبر البيئي (بالعربية) *' : 'Arabic Article Title *'}</span>
                    </label>
                    <input
                      type="text"
                      dir="rtl"
                      value={editForm.titleAr || ''}
                      onChange={(e) => setEditForm({ ...editForm, titleAr: e.target.value })}
                      placeholder="عنوان المقال الخبري بالعربية..."
                      disabled={!canEdit}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* English Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span>{isAr ? 'عنوان الخبر (بالإنجليزية)' : 'English Article Title'}</span>
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editForm.titleEn || ''}
                      onChange={(e) => setEditForm({ ...editForm, titleEn: e.target.value })}
                      placeholder="Article title in English..."
                      disabled={!canEdit}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* Category & Author Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'التصنيف البيئي' : 'Category'}
                      </label>
                      <select
                        value={editForm.category || NEWS_CATEGORIES[0].labelAr}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        disabled={!canEdit}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 cursor-pointer"
                      >
                        {NEWS_CATEGORIES.map(cat => (
                          <option key={cat.id} value={cat.labelAr}>
                            {isAr ? cat.labelAr : cat.labelEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'اسم الكاتب / المحرر' : 'Author Name'}
                      </label>
                      <input
                        type="text"
                        value={editForm.author || ''}
                        onChange={(e) => setEditForm({ ...editForm, author: e.target.value })}
                        disabled={!canEdit}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {/* Arabic Summary */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'الموجز الخبري (بالعربية)' : 'Arabic Summary'}
                    </label>
                    <textarea
                      dir="rtl"
                      rows={2}
                      value={editForm.summaryAr || ''}
                      onChange={(e) => setEditForm({ ...editForm, summaryAr: e.target.value })}
                      placeholder="ملخص موجز لأبرز نقاط الخبر..."
                      disabled={!canEdit}
                      className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* English Summary */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'الموجز الخبري (بالإنجليزية)' : 'English Summary'}
                    </label>
                    <textarea
                      dir="ltr"
                      rows={2}
                      value={editForm.summaryEn || ''}
                      onChange={(e) => setEditForm({ ...editForm, summaryEn: e.target.value })}
                      placeholder="Brief article summary in English..."
                      disabled={!canEdit}
                      className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* Arabic Body */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'نص الخبر الكامل (بالعربية)' : 'Arabic Article Body'}
                    </label>
                    <textarea
                      dir="rtl"
                      rows={5}
                      value={editForm.bodyAr || ''}
                      onChange={(e) => setEditForm({ ...editForm, bodyAr: e.target.value })}
                      placeholder="المتن التفصيلي للمقال الخبري..."
                      disabled={!canEdit}
                      className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* English Body */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'نص الخبر الكامل (بالإنجليزية)' : 'English Article Body'}
                    </label>
                    <textarea
                      dir="ltr"
                      rows={4}
                      value={editForm.bodyEn || ''}
                      onChange={(e) => setEditForm({ ...editForm, bodyEn: e.target.value })}
                      placeholder="Full article body in English..."
                      disabled={!canEdit}
                      className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* Tags and Sources Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {/* Tags */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{isAr ? 'الوسوم (مفصولة بفاصلة)' : 'Tags (comma separated)'}</span>
                      </label>
                      <input
                        type="text"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        placeholder="النيل, طوارئ, زراعة"
                        disabled={!canEdit}
                        className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      />
                    </div>

                    {/* Sources */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                        <LinkIcon className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{isAr ? 'المصادر والجهات الرسمية' : 'Sources & References'}</span>
                      </label>
                      <input
                        type="text"
                        value={sourcesInput}
                        onChange={(e) => setSourcesInput(e.target.value)}
                        placeholder="وزارة الري, معهد علوم البحار"
                        disabled={!canEdit}
                        className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* WORKFLOW & AUDIT TRAIL TAB */
                <div className="space-y-6">
                  {/* Visual Lifecycle Stepper */}
                  <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-4 sm:p-5 rounded-2xl">
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-4">
                      {isAr ? 'مراحل خط الاعتماد الخبري' : 'News Editorial Pipeline'}
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                      {lifecycleStates.map((step) => {
                        const Icon = step.icon;
                        const isCurrent = activeItem.workflowState === step.key;
                        
                        return (
                          <div
                            key={step.key}
                            className={`p-3 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                              isCurrent
                                ? 'bg-emerald-500 text-white border-emerald-600 shadow-md ring-2 ring-emerald-400/40 dark:ring-emerald-500/50'
                                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            <Icon className={`w-4 h-4 mb-1.5 ${isCurrent ? 'text-white' : 'text-gray-400'}`} />
                            <span className="text-xs font-bold leading-tight">
                              {isAr ? step.labelAr : step.labelEn}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Authorized Workflow Transition Actions */}
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                        {isAr ? 'الإجراءات المتاحة لدورك الحالي:' : 'Permitted Actions for Your Role:'}
                      </h3>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-md">
                        {currentUser.role}
                      </span>
                    </div>

                    {/* Check authorized transitions */}
                    {(() => {
                      const authorizedTransitions = WorkflowEngine.getAuthorizedTransitions(
                        activeItem.workflowState,
                        currentUser
                      );

                      const validTransitions = WorkflowEngine.getValidTransitionsFromState(activeItem.workflowState);

                      if (validTransitions.length === 0) {
                        return (
                          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                            {isAr ? 'هذا المقال الخبري في حالته النهائية ولا يتطلب أي إجراءات إضافية.' : 'This article is in its terminal state.'}
                          </p>
                        );
                      }

                      return (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {validTransitions.map(config => {
                            const isAuthorized = authorizedTransitions.some(t => t.toState === config.toState);

                            return (
                              <button
                                key={config.toState}
                                disabled={!isAuthorized}
                                onClick={() => {
                                  if (config.requiresComment) {
                                    setPendingTransition(config);
                                    setTransitionComment('');
                                  } else {
                                    handleExecuteTransition(config);
                                  }
                                }}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                                  isAuthorized
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                                    : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600 cursor-not-allowed'
                                }`}
                              >
                                <span>{isAr ? config.labelAr : config.labelEn}</span>
                                {!isAuthorized && <ShieldAlert className="w-3.5 h-3.5 text-gray-400" />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Comment Prompt Drawer / Modal for Request Changes */}
                  {pendingTransition && (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 space-y-3">
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
                        <MessageSquare className="w-4 h-4" />
                        <span>{isAr ? 'يرجى تدوين ملاحظات التعديل المطلوب:' : 'Please provide change feedback notes:'}</span>
                      </div>

                      <textarea
                        rows={3}
                        value={transitionComment}
                        onChange={(e) => setTransitionComment(e.target.value)}
                        placeholder={isAr ? 'اكتب ملاحظات التدقيق والتحسينات المطلوبة...' : 'Enter feedback notes...'}
                        className="w-full p-3 text-xs bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />

                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPendingTransition(null)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-amber-100/50 dark:hover:bg-amber-900/40"
                        >
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button
                          disabled={!transitionComment.trim()}
                          onClick={() => handleExecuteTransition(pendingTransition, transitionComment)}
                          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                        >
                          {isAr ? 'تأكيد إرسال الملاحظات' : 'Confirm Feedback'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Audit Log / History */}
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl space-y-4">
                    <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-emerald-600" />
                      <span>{isAr ? 'سجل العمليات والقرارات السابقة' : 'Transition Audit History'}</span>
                    </h3>

                    {activeItem.history.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                        {isAr ? 'لا توجد انتقالات سابقة مسجلة على هذا الخبر.' : 'No audit history available.'}
                      </p>
                    ) : (
                      <div className="space-y-3 relative before:absolute before:start-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-gray-100 dark:before:bg-gray-800">
                        {activeItem.history.map(record => (
                          <div key={record.id} className="relative ps-8 space-y-1">
                            <div className="absolute start-1.5 top-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">
                              <Check className="w-2.5 h-2.5" />
                            </div>
                            <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                              <span className="font-bold text-gray-900 dark:text-white">
                                {record.actorName} <span className="text-gray-400 font-normal">({record.actorRole})</span>
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {new Date(record.timestamp).toLocaleString(isAr ? 'ar-SD' : 'en-US')}
                              </span>
                            </div>
                            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                              {record.fromState} ← {record.toState}
                            </p>
                            {record.comment && (
                              <p className="text-xs bg-gray-50 dark:bg-gray-800/60 p-2.5 rounded-lg text-gray-600 dark:text-gray-300 italic border border-gray-100 dark:border-gray-800 mt-1">
                                "{record.comment}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 flex items-center justify-between gap-3">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>

              {canEdit && activeTab === 'content' && (
                <button
                  onClick={handleSaveForm}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{isAr ? 'حفظ البيانات والتعديلات' : 'Save Changes'}</span>
                </button>
              )}
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
