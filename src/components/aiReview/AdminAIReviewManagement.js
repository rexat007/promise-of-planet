"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAIReviewManagement = void 0;
const react_1 = require("react");
const react_i18next_1 = require("react-i18next");
const lucide_react_1 = require("lucide-react");
const aiReview_1 = require("../../types/aiReview");
const aiReviewService_1 = require("../../services/aiReviewService");
const aiReviewFormatters_1 = require("./aiReviewFormatters");
const AIReviewInspectorModal_1 = require("./AIReviewInspectorModal");
const dynamicTranslation_1 = require("../../services/dynamicTranslation");
const AdminAIReviewManagement = ({ currentUser: _currentUser }) => {
    const { i18n } = (0, react_i18next_1.useTranslation)();
    const isAr = i18n.language === 'ar';
    const targetLang = isAr ? 'ar' : 'en';
    const [reviews] = (0, react_1.useState)(() => aiReviewService_1.AIReviewService.getAllReviews());
    // Filter States
    const [searchQuery, setSearchQuery] = (0, react_1.useState)('');
    const [selectedTargetType, setSelectedTargetType] = (0, react_1.useState)('ALL');
    const [selectedCategory, setSelectedCategory] = (0, react_1.useState)('ALL');
    const [selectedSeverity, setSelectedSeverity] = (0, react_1.useState)('ALL');
    const [selectedFreshness, setSelectedFreshness] = (0, react_1.useState)('ALL'); // 'ALL' | 'CURRENT' | 'STALE'
    const [selectedExecutionState, setSelectedExecutionState] = (0, react_1.useState)('ALL');
    // Modal State
    const [activeReview, setActiveReview] = (0, react_1.useState)(null);
    const [isModalOpen, setIsModalOpen] = (0, react_1.useState)(false);
    // Canonical Pipeline: Target Resolution & Freshness Evaluation
    const enrichedReviews = (0, react_1.useMemo)(() => {
        return reviews.map((rev) => {
            const resolvedTarget = (0, aiReviewFormatters_1.resolveReviewTarget)(rev.target.targetType, rev.target.targetId, isAr);
            const isStale = resolvedTarget.isAvailable
                ? aiReviewService_1.AIReviewService.isReviewStale(rev, resolvedTarget.sourceUpdatedAt)
                : false;
            // Compute highest severity in findings
            let highestSeverity = aiReview_1.AIReviewSeverity.Info;
            if (rev.findings.some(f => f.severity === aiReview_1.AIReviewSeverity.ReviewRecommended)) {
                highestSeverity = aiReview_1.AIReviewSeverity.ReviewRecommended;
            }
            else if (rev.findings.some(f => f.severity === aiReview_1.AIReviewSeverity.Warning)) {
                highestSeverity = aiReview_1.AIReviewSeverity.Warning;
            }
            return {
                artifact: rev,
                target: resolvedTarget,
                isStale,
                highestSeverity,
            };
        });
    }, [reviews, isAr]);
    // Filtered Reviews Computation
    const filteredReviews = (0, react_1.useMemo)(() => {
        return enrichedReviews.filter((item) => {
            const { artifact, target, isStale } = item;
            // 1. Search Query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchTitle = target.title.toLowerCase().includes(q);
                const matchTargetId = artifact.target.targetId.toLowerCase().includes(q);
                const matchFindings = artifact.findings.some(f => {
                    const msg = f.message.toLowerCase();
                    const translated = dynamicTranslation_1.dynamicTranslationService.translateText(f.message, f.sourceLanguage, targetLang, f.id).toLowerCase();
                    const field = f.affectedField?.toLowerCase() || '';
                    return msg.includes(q) || translated.includes(q) || field.includes(q);
                });
                if (!matchTitle && !matchTargetId && !matchFindings) {
                    return false;
                }
            }
            // 2. Target Type
            if (selectedTargetType !== 'ALL' && artifact.target.targetType !== selectedTargetType) {
                return false;
            }
            // 3. Execution State
            if (selectedExecutionState !== 'ALL' && artifact.executionState !== selectedExecutionState) {
                return false;
            }
            // 4. Freshness
            if (selectedFreshness === 'CURRENT' && isStale)
                return false;
            if (selectedFreshness === 'STALE' && !isStale)
                return false;
            // 5. Category
            if (selectedCategory !== 'ALL') {
                const hasCategory = artifact.findings.some(f => f.category === selectedCategory);
                if (!hasCategory)
                    return false;
            }
            // 6. Severity
            if (selectedSeverity !== 'ALL') {
                const hasSeverity = artifact.findings.some(f => f.severity === selectedSeverity);
                if (!hasSeverity)
                    return false;
            }
            return true;
        });
    }, [
        enrichedReviews,
        searchQuery,
        selectedTargetType,
        selectedExecutionState,
        selectedFreshness,
        selectedCategory,
        selectedSeverity,
        targetLang
    ]);
    // Metric counts
    const totalCount = reviews.length;
    const staleCount = enrichedReviews.filter(r => r.isStale).length;
    const currentCount = totalCount - staleCount;
    const getSeverityBadge = (sev) => {
        switch (sev) {
            case aiReview_1.AIReviewSeverity.ReviewRecommended:
                return (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <lucide_react_1.AlertTriangle className="w-3 h-3"/>
            {(0, aiReviewFormatters_1.getSeverityLabel)(sev, isAr)}
          </span>);
            case aiReview_1.AIReviewSeverity.Warning:
                return (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
            <lucide_react_1.AlertTriangle className="w-3 h-3"/>
            {(0, aiReviewFormatters_1.getSeverityLabel)(sev, isAr)}
          </span>);
            case aiReview_1.AIReviewSeverity.Info:
            default:
                return (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <lucide_react_1.Info className="w-3 h-3"/>
            {(0, aiReviewFormatters_1.getSeverityLabel)(sev, isAr)}
          </span>);
        }
    };
    return (<div className="space-y-6 w-full max-w-full min-w-0" id="ai-review-management">
      
      {/* 1. Header Banner: Authority & Simulation Notice */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                <lucide_react_1.Sparkles className="w-5 h-5"/>
              </span>
              <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                {isAr ? 'مركز تدقيق ومراجعة المحتوى بالذكاء الاصطناعي' : 'AI Content Auditor & Review Center'}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {isAr
            ? 'فحص استشاري متعدد النطاقات للمحتوى الإخباري، والوثائق، والمسارات التدريبية، وبلاغات المجتمع لدعم القرار التحريري البشري.'
            : 'Cross-domain advisory audits for news, documents, courses, and citizen submissions to assist human editorial oversight.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
              {isAr ? 'محاكي التدقيق التجريبي' : 'Simulation Demo Mode'}
            </span>
          </div>
        </div>

        {/* Advisory Authority Invariant Notice */}
        <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-xl flex items-start gap-3 text-xs text-emerald-900 dark:text-emerald-200">
          <lucide_react_1.ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"/>
          <div className="space-y-0.5">
            <p className="font-bold">
              {isAr ? 'مبدأ المرجعية البشرية التحريرية:' : 'Human Authority Principle:'}
            </p>
            <p className="text-emerald-800 dark:text-emerald-300">
              {isAr
            ? 'جميع تقارير الذكاء الاصطناعي استشارية بحتة ولا تملك سلطة اعتماد أو نشر أو رفض أو تغيير حالة المحتوى في أي مسار عمل.'
            : 'All AI review artifacts are advisory findings and hold no authority to approve, publish, reject, or modify domain workflow states.'}
            </p>
          </div>
        </div>

        {/* Metric Chips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{isAr ? 'إجمالي تقارير التدقيق' : 'Total Review Artifacts'}</span>
            <span className="text-base font-extrabold text-gray-900 dark:text-white">{totalCount}</span>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <lucide_react_1.CheckCircle2 className="w-3.5 h-3.5"/>
              <span>{isAr ? 'متطابقة مع المحتوى' : 'Current & Synced'}</span>
            </div>
            <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">{currentCount}</span>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
              <lucide_react_1.Clock className="w-3.5 h-3.5"/>
              <span>{isAr ? 'مراجعات قديمة (عُدّل المحتوى)' : 'Stale (Source Updated)'}</span>
            </div>
            <span className="text-base font-extrabold text-amber-700 dark:text-amber-400">{staleCount}</span>
          </div>
        </div>
      </div>

      {/* 2. Responsive Filters & Search Toolbar */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <lucide_react_1.Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 left-3.5 rtl:left-auto rtl:right-3.5 text-gray-400"/>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={isAr ? 'البحث بالعنوان، المعرف، نص الملاحظة، الحقل...' : 'Search title, target ID, finding text, field...'} className="w-full pl-10 pr-4 rtl:pl-4 rtl:pr-10 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 transition-all"/>
          </div>

          {/* Filter Reset Button if any filter active */}
          {(searchQuery || selectedTargetType !== 'ALL' || selectedCategory !== 'ALL' || selectedSeverity !== 'ALL' || selectedFreshness !== 'ALL' || selectedExecutionState !== 'ALL') && (<button onClick={() => {
                setSearchQuery('');
                setSelectedTargetType('ALL');
                setSelectedCategory('ALL');
                setSelectedSeverity('ALL');
                setSelectedFreshness('ALL');
                setSelectedExecutionState('ALL');
            }} className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer">
              <lucide_react_1.RefreshCw className="w-3.5 h-3.5"/>
              <span>{isAr ? 'إعادة ضبط التصفية' : 'Reset Filters'}</span>
            </button>)}
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-3 border-t border-gray-100 dark:border-gray-800">
          
          {/* Filter: Target Type */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1">
              {isAr ? 'نطاق المحتوى' : 'Domain Target'}
            </label>
            <select value={selectedTargetType} onChange={(e) => setSelectedTargetType(e.target.value)} className="w-full p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200 font-medium focus:outline-hidden cursor-pointer">
              <option value="ALL">{isAr ? 'كافة النطاقات' : 'All Domains'}</option>
              <option value={aiReview_1.AIReviewTargetType.News}>{(0, aiReviewFormatters_1.getTargetTypeLabel)(aiReview_1.AIReviewTargetType.News, isAr)}</option>
              <option value={aiReview_1.AIReviewTargetType.LibraryDocument}>{(0, aiReviewFormatters_1.getTargetTypeLabel)(aiReview_1.AIReviewTargetType.LibraryDocument, isAr)}</option>
              <option value={aiReview_1.AIReviewTargetType.TrainingCourse}>{(0, aiReviewFormatters_1.getTargetTypeLabel)(aiReview_1.AIReviewTargetType.TrainingCourse, isAr)}</option>
              <option value={aiReview_1.AIReviewTargetType.CitizenSubmission}>{(0, aiReviewFormatters_1.getTargetTypeLabel)(aiReview_1.AIReviewTargetType.CitizenSubmission, isAr)}</option>
            </select>
          </div>

          {/* Filter: Freshness */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1">
              {isAr ? 'حالة التزامن والجدة' : 'Freshness Sync'}
            </label>
            <select value={selectedFreshness} onChange={(e) => setSelectedFreshness(e.target.value)} className="w-full p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200 font-medium focus:outline-hidden cursor-pointer">
              <option value="ALL">{isAr ? 'كافة الحالات' : 'All Statuses'}</option>
              <option value="CURRENT">{isAr ? 'مراجعة حديثة ومتزامنة' : 'Current & Synced'}</option>
              <option value="STALE">{isAr ? 'مراجعة قديمة (عُدّل المحتوى)' : 'Stale (Source Updated)'}</option>
            </select>
          </div>

          {/* Filter: Severity */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1">
              {isAr ? 'مستوى الانتباه' : 'Severity Level'}
            </label>
            <select value={selectedSeverity} onChange={(e) => setSelectedSeverity(e.target.value)} className="w-full p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200 font-medium focus:outline-hidden cursor-pointer">
              <option value="ALL">{isAr ? 'كافة المستويات' : 'All Severities'}</option>
              <option value={aiReview_1.AIReviewSeverity.ReviewRecommended}>{(0, aiReviewFormatters_1.getSeverityLabel)(aiReview_1.AIReviewSeverity.ReviewRecommended, isAr)}</option>
              <option value={aiReview_1.AIReviewSeverity.Warning}>{(0, aiReviewFormatters_1.getSeverityLabel)(aiReview_1.AIReviewSeverity.Warning, isAr)}</option>
              <option value={aiReview_1.AIReviewSeverity.Info}>{(0, aiReviewFormatters_1.getSeverityLabel)(aiReview_1.AIReviewSeverity.Info, isAr)}</option>
            </select>
          </div>

          {/* Filter: Category */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1">
              {isAr ? 'تصنيف الملاحظة' : 'Finding Category'}
            </label>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200 font-medium focus:outline-hidden cursor-pointer">
              <option value="ALL">{isAr ? 'كافة التصنيفات' : 'All Categories'}</option>
              <option value={aiReview_1.AIReviewCategory.SourceReferenceQuality}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.SourceReferenceQuality, isAr)}</option>
              <option value={aiReview_1.AIReviewCategory.PossibleInconsistency}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.PossibleInconsistency, isAr)}</option>
              <option value={aiReview_1.AIReviewCategory.RightsConcern}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.RightsConcern, isAr)}</option>
              <option value={aiReview_1.AIReviewCategory.Completeness}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.Completeness, isAr)}</option>
              <option value={aiReview_1.AIReviewCategory.Clarity}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.Clarity, isAr)}</option>
              <option value={aiReview_1.AIReviewCategory.MetadataCompleteness}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.MetadataCompleteness, isAr)}</option>
              <option value={aiReview_1.AIReviewCategory.LanguagePresentation}>{(0, aiReviewFormatters_1.getCategoryLabel)(aiReview_1.AIReviewCategory.LanguagePresentation, isAr)}</option>
            </select>
          </div>

          {/* Filter: Execution State */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1">
              {isAr ? 'حالة المعالجة' : 'Execution State'}
            </label>
            <select value={selectedExecutionState} onChange={(e) => setSelectedExecutionState(e.target.value)} className="w-full p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200 font-medium focus:outline-hidden cursor-pointer">
              <option value="ALL">{isAr ? 'كافة الحالات' : 'All States'}</option>
              <option value={aiReview_1.AIReviewExecutionState.Completed}>{(0, aiReviewFormatters_1.getExecutionStateLabel)(aiReview_1.AIReviewExecutionState.Completed, isAr)}</option>
              <option value={aiReview_1.AIReviewExecutionState.Pending}>{(0, aiReviewFormatters_1.getExecutionStateLabel)(aiReview_1.AIReviewExecutionState.Pending, isAr)}</option>
              <option value={aiReview_1.AIReviewExecutionState.Failed}>{(0, aiReviewFormatters_1.getExecutionStateLabel)(aiReview_1.AIReviewExecutionState.Failed, isAr)}</option>
            </select>
          </div>

        </div>
      </div>

      {/* 3. Review Results Presentation */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden">
        
        {filteredReviews.length === 0 ? (<div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-3">
            <lucide_react_1.FileText className="w-10 h-10 mx-auto opacity-40"/>
            <p className="font-semibold text-sm">
              {isAr ? 'لا توجد تقارير تدقيق تطابق محددات البحث والتصفية' : 'No review artifacts match the selected filters'}
            </p>
          </div>) : (<>
            {/* A. Compact Cards Presentation (< 1280px) */}
            <div className="block xl:hidden divide-y divide-gray-100 dark:divide-gray-800 w-full max-w-full min-w-0">
              {filteredReviews.map(({ artifact, target, isStale, highestSeverity }) => {
                return (<div key={artifact.id} className="p-4 sm:p-5 space-y-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors w-full max-w-full min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs">
                          {(0, aiReviewFormatters_1.getTargetTypeLabel)(artifact.target.targetType, isAr)}
                        </span>
                        <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
                          {artifact.target.targetId}
                        </span>
                      </div>

                      {isStale ? (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                          <lucide_react_1.Clock className="w-3 h-3"/>
                          {isAr ? 'قديمة (محدث لاحقاً)' : 'Stale'}
                        </span>) : (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <lucide_react_1.FileCheck className="w-3 h-3"/>
                          {isAr ? 'حديثة ومتطابقة' : 'Synced'}
                        </span>)}
                    </div>

                    <div className="space-y-1">
                      <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base leading-snug">
                        {target.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          {isAr ? 'تاريخ التوليد:' : 'Generated:'} {new Date(artifact.generatedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US')}
                        </span>
                        <span>•</span>
                        <span>
                          {isAr ? 'الملاحظات:' : 'Findings:'} <strong className="text-gray-700 dark:text-gray-300">{artifact.findings.length}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
                      <div>
                        {getSeverityBadge(highestSeverity)}
                      </div>

                      <button onClick={() => {
                        setActiveReview(artifact);
                        setIsModalOpen(true);
                    }} className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer">
                        <lucide_react_1.Eye className="w-3.5 h-3.5"/>
                        <span>{isAr ? 'معاينة تقرير التدقيق' : 'Inspect Review'}</span>
                      </button>
                    </div>
                  </div>);
            })}
            </div>

            {/* B. Dense Desktop Table Presentation (>= 1280px) */}
            <div className="hidden xl:block overflow-x-auto w-full max-w-full min-w-0">
              <table className="w-full text-start text-xs sm:text-sm border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 text-start">{isAr ? 'المحتوى المستهدف' : 'Target Content'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'نطاق العمل' : 'Domain'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'تاريخ التدقيق' : 'Generated Date'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'حالة التنفيذ' : 'Execution'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'الملاحظات' : 'Findings'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'أعلى مستوى انتباه' : 'Attention Tier'}</th>
                    <th className="p-3.5 text-start">{isAr ? 'التزامن' : 'Freshness'}</th>
                    <th className="p-3.5 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredReviews.map(({ artifact, target, isStale, highestSeverity }) => {
                return (<tr key={artifact.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                        <td className="p-3.5 max-w-xs sm:max-w-md">
                          <p className="font-bold text-gray-900 dark:text-white line-clamp-1">
                            {target.title}
                          </p>
                          <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-0.5">
                            {artifact.target.targetId}
                          </p>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-xs">
                            {(0, aiReviewFormatters_1.getTargetTypeLabel)(artifact.target.targetType, isAr)}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                          {new Date(artifact.generatedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                            {(0, aiReviewFormatters_1.getExecutionStateLabel)(artifact.executionState, isAr)}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            {artifact.findings.length}
                          </span>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          {getSeverityBadge(highestSeverity)}
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
                          {isStale ? (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                              <lucide_react_1.Clock className="w-3 h-3"/>
                              {isAr ? 'قديمة' : 'Stale'}
                            </span>) : (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              <lucide_react_1.FileCheck className="w-3 h-3"/>
                              {isAr ? 'متطابقة' : 'Synced'}
                            </span>)}
                        </td>

                        <td className="p-3.5 whitespace-nowrap text-end">
                          <button onClick={() => {
                        setActiveReview(artifact);
                        setIsModalOpen(true);
                    }} className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer">
                            <lucide_react_1.Eye className="w-3.5 h-3.5"/>
                            <span>{isAr ? 'معاينة' : 'Inspect'}</span>
                          </button>
                        </td>
                      </tr>);
            })}
                </tbody>
              </table>
            </div>
          </>)}
      </div>

      {/* 4. Review Inspector Modal */}
      <AIReviewInspectorModal_1.AIReviewInspectorModal review={activeReview} isOpen={isModalOpen} onClose={() => {
            setIsModalOpen(false);
            setActiveReview(null);
        }} isAr={isAr}/>

    </div>);
};
exports.AdminAIReviewManagement = AdminAIReviewManagement;
//# sourceMappingURL=AdminAIReviewManagement.js.map