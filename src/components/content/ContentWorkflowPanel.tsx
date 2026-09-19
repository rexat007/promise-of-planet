import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowState } from '../../types/workflow';
import type { 
  ContentWorkflowItem, 
  WorkflowTransitionConfig 
} from '../../types/workflow';
import type { AdminUser } from '../../types/admin';
import { WorkflowEngine } from '../../services/workflowEngine';
import { 
  FileEdit, 
  FileSearch, 
  CheckCircle2, 
  Globe, 
  RotateCcw, 
  ArrowRight, 
  ArrowLeft, 
  Clock, 
  User, 
  MessageSquare, 
  ShieldAlert, 
  Plus, 
  History,
  AlertCircle,
  Sparkles
} from 'lucide-react';

interface ContentWorkflowPanelProps {
  currentUser: AdminUser;
}

export function ContentWorkflowPanel({ currentUser }: ContentWorkflowPanelProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [items, setItems] = useState<ContentWorkflowItem[]>(() => WorkflowEngine.getSeedWorkflowItems());
  const [selectedItemId, setSelectedItemId] = useState<string>('item-101');
  const [activeFilterState, setActiveFilterState] = useState<string>('All');
  
  // State for request changes modal/comment box
  const [pendingCommentTransition, setPendingCommentTransition] = useState<{
    targetState: WorkflowState;
    config: WorkflowTransitionConfig;
  } | null>(null);
  const [commentText, setCommentText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeItem = items.find(i => i.id === selectedItemId) || items[0];

  // All 5 states in lifecycle sequence for visual progress bar
  const lifecycleStates: { key: WorkflowState; labelAr: string; labelEn: string; icon: any }[] = [
    { key: WorkflowState.Draft, labelAr: 'مسودة', labelEn: 'Draft', icon: FileEdit },
    { key: WorkflowState.InReview, labelAr: 'قيد المراجعة', labelEn: 'In Review', icon: FileSearch },
    { key: WorkflowState.ChangesRequested, labelAr: 'تعديلات مطلوبة', labelEn: 'Changes Requested', icon: RotateCcw },
    { key: WorkflowState.Approved, labelAr: 'معتمد', labelEn: 'Approved', icon: CheckCircle2 },
    { key: WorkflowState.Published, labelAr: 'منشور للجمهور', labelEn: 'Published', icon: Globe },
  ];

  // Filtered items list
  const filteredItems = items.filter(item => {
    if (activeFilterState === 'All') return true;
    return item.currentState === activeFilterState;
  });

  // Allowed transitions for current state according to state machine
  const validTransitionsForState = WorkflowEngine.getValidTransitionsFromState(activeItem.currentState);

  // Handle triggering a transition
  const handleInitiateTransition = (transition: WorkflowTransitionConfig) => {
    setErrorMessage(null);
    if (transition.requiresComment) {
      setPendingCommentTransition({ targetState: transition.toState, config: transition });
      setCommentText('');
    } else {
      try {
        const updated = WorkflowEngine.executeTransition(activeItem, transition.toState, currentUser);
        setItems(items.map(i => i.id === updated.id ? updated : i));
      } catch (err: any) {
        setErrorMessage(err.message || 'Transition failed.');
      }
    }
  };

  // Confirm transition with comment
  const handleConfirmCommentTransition = () => {
    if (!pendingCommentTransition) return;
    if (pendingCommentTransition.config.requiresComment && !commentText.trim()) {
      setErrorMessage(isAr ? 'يرجى إدخال سبب التعديل أو الملاحظات قبل الإرجاع.' : 'Please provide feedback/comments before requesting changes.');
      return;
    }

    try {
      const updated = WorkflowEngine.executeTransition(
        activeItem, 
        pendingCommentTransition.targetState, 
        currentUser, 
        commentText
      );
      setItems(items.map(i => i.id === updated.id ? updated : i));
      setPendingCommentTransition(null);
      setCommentText('');
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Transition failed.');
    }
  };

  // Create new draft item demo
  const handleCreateNewDraft = () => {
    const titleAr = prompt(isAr ? 'أدخل عنوان المسودة الجديدة:' : 'Enter new draft title:');
    if (titleAr) {
      const newItem: ContentWorkflowItem = {
        id: `item-${Date.now()}`,
        titleAr,
        titleEn: 'New Environmental Article Draft',
        contentType: 'News',
        currentState: WorkflowState.Draft,
        authorName: currentUser.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        category: 'General Ecological Update',
        history: [],
      };
      setItems([newItem, ...items]);
      setSelectedItemId(newItem.id);
    }
  };

  const formatTimestamp = (isoString: string) => {
    const d = new Date(isoString);
    return isAr 
      ? d.toLocaleDateString('ar-SD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getStateBadgeStyle = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Draft:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';
      case WorkflowState.InReview:
        return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/40';
      case WorkflowState.ChangesRequested:
        return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/40';
      case WorkflowState.Approved:
        return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/40';
      case WorkflowState.Published:
        return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40';
    }
  };

  return (
    <div className="space-y-6" id="content-workflow-engine-root">
      
      {/* 1. Header Banner & Actions */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400">
              {isAr ? 'محرك حوكمة ودورة حياة المحتوى' : 'Content Lifecycle Engine'}
            </span>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              {isAr ? 'نموذج الحالة الموحد' : 'Reusable State Machine'}
            </span>
          </div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">
            {isAr ? 'إدارة دورة حياة المحتوى والتأهيل للنشر' : 'Content Lifecycle & Workflow Controls'}
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 max-w-2xl mt-0.5">
            {isAr 
              ? 'نموذج حالات مستقل يعتمد قواعد انتقال صارمة ومحددة مع التحقق الفوري من صلاحيات الأدوار التسعة المعتمدة.'
              : 'Deterministic state machine establishing strict lifecycle transitions backed by the existing 9-role permission matrix.'}
          </p>
        </div>

        <button
          onClick={handleCreateNewDraft}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer shrink-0 self-start md:self-center"
          id="create-new-workflow-draft-btn"
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? 'إنشاء مسودة جديدة' : 'Create New Draft'}</span>
        </button>
      </div>

      {/* 2. Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Filterable Item List (1 Col) */}
        <div className="space-y-4" id="workflow-items-sidebar">
          <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <FileSearch className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? 'عناصر المحتوى' : 'Content Items'}</span>
              </h3>
              <span className="text-xs text-gray-400 font-semibold">{filteredItems.length}</span>
            </div>

            {/* Filter Chips */}
            <div className="flex flex-wrap gap-1" id="workflow-state-filters">
              {['All', WorkflowState.Draft, WorkflowState.InReview, WorkflowState.ChangesRequested, WorkflowState.Approved, WorkflowState.Published].map((st) => {
                const isActive = activeFilterState === st;
                return (
                  <button
                    key={st}
                    onClick={() => setActiveFilterState(st)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      isActive 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {st === 'All' ? (isAr ? 'الكل' : 'All') : st}
                  </button>
                );
              })}
            </div>

            {/* List of items */}
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1" id="workflow-items-list">
              {filteredItems.map((item) => {
                const isSelected = item.id === activeItem.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedItemId(item.id);
                      setErrorMessage(null);
                      setPendingCommentTransition(null);
                    }}
                    className={`w-full text-right sm:text-start p-3 rounded-xl border transition-all text-xs font-semibold cursor-pointer block ${
                      isSelected 
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 shadow-xs' 
                        : 'bg-white dark:bg-gray-900/50 border-gray-100 dark:border-gray-800/80 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200/50 dark:border-gray-700/50">
                        {item.contentType}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStateBadgeStyle(item.currentState)}`}>
                        {item.currentState}
                      </span>
                    </div>
                    <p className="font-bold text-gray-900 dark:text-white line-clamp-2 leading-snug">
                      {isAr ? item.titleAr : item.titleEn}
                    </p>
                    <div className="flex items-center justify-between gap-2 mt-2 text-[10px] text-gray-400">
                      <span>{item.authorName}</span>
                      <span>{formatTimestamp(item.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Active Item Lifecycle Viewer, Allowed Action Buttons & Audit Log (2 Cols) */}
        <div className="lg:col-span-2 space-y-6" id="workflow-active-workspace">
          
          {/* Active Item Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-6">
            
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50">
                    {activeItem.contentType}
                  </span>
                  <span className="text-xs text-gray-400 font-medium">
                    ID: {activeItem.id}
                  </span>
                  <span className="text-gray-300 dark:text-gray-700">•</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    {activeItem.category}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white leading-snug">
                  {isAr ? activeItem.titleAr : activeItem.titleEn}
                </h3>
                <div className="flex items-center gap-3 text-xs text-gray-400 pt-0.5">
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? `الكاتب/المؤلف: ${activeItem.authorName}` : `Author: ${activeItem.authorName}`}</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatTimestamp(activeItem.updatedAt)}</span>
                  </span>
                </div>
              </div>

              {/* Current state badge */}
              <div className="shrink-0">
                <span className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 shadow-xs ${getStateBadgeStyle(activeItem.currentState)}`}>
                  <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
                  <span>{activeItem.currentState}</span>
                </span>
              </div>
            </div>

            {/* Error Message Alert */}
            {errorMessage && (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl text-rose-800 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* 3. VISUAL LIFECYCLE PROGRESS PIPELINE */}
            <div className="space-y-2 pt-1" id="lifecycle-progress-pipeline">
              <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">
                {isAr ? 'مسار دورة الحياة الحالي:' : 'Current Lifecycle Pipeline:'}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" id="lifecycle-stepper-grid">
                {lifecycleStates.map((st) => {
                  const isCurrentState = activeItem.currentState === st.key;
                  const Icon = st.icon;
                  return (
                    <div 
                      key={st.key}
                      className={`p-2.5 rounded-xl border text-center flex flex-col items-center justify-center gap-1 transition-all ${
                        isCurrentState 
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm ring-2 ring-emerald-600/20' 
                          : 'bg-gray-50 dark:bg-gray-800/40 border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isCurrentState ? 'text-white' : 'text-gray-400'}`} />
                      <span className="text-[11px] font-bold leading-none">{isAr ? st.labelAr : st.labelEn}</span>
                      <span className="text-[9px] opacity-75 font-mono">{st.key}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4. PERMITTED ACTION CENTER (Dynamic transition triggers) */}
            <div className="bg-gray-50/80 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-800/80 rounded-xl p-4 sm:p-5 space-y-3" id="permitted-action-center">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-emerald-600" />
                    <span>{isAr ? 'الإجراءات والانتقالات المتاحة لدورك الحالي:' : 'Authorized Workflow Transitions:'}</span>
                  </h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr 
                      ? `الدور الحالي: [${currentUser.role}] — يتم عرض الإجراءات المسموح بها وفق مصفوفة الصلاحيات المعتمدة.`
                      : `Active Role: [${currentUser.role}] — Showing authorized transitions derived from current state & RBAC.`}
                  </p>
                </div>
              </div>

              {/* Action Buttons Grid */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {validTransitionsForState.length === 0 ? (
                  <div className="text-xs text-gray-400 italic p-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 w-full text-center">
                    {isAr ? 'المادة في حالة نهائية (منشورة للجمهور) — لا توجد انتقالات إضافية.' : 'Item is in Published state — no further state transitions permitted.'}
                  </div>
                ) : (
                  validTransitionsForState.map((tConfig) => {
                    const isAuthorized = WorkflowEngine.getAuthorizedTransitions(activeItem.currentState, currentUser)
                      .some(t => t.toState === tConfig.toState);

                    return (
                      <div key={tConfig.toState} className="flex flex-col gap-1">
                        <button
                          disabled={!isAuthorized}
                          onClick={() => handleInitiateTransition(tConfig)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                            isAuthorized
                              ? tConfig.toState === WorkflowState.Published
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : tConfig.toState === WorkflowState.Approved
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : tConfig.toState === WorkflowState.ChangesRequested
                                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                : 'bg-teal-600 hover:bg-teal-700 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border border-gray-200 dark:border-gray-700 cursor-not-allowed opacity-75'
                          }`}
                          title={!isAuthorized ? (isAr ? `يتطلب صلاحية: [${tConfig.requiredPermission}]` : `Requires permission: [${tConfig.requiredPermission}]`) : ''}
                        >
                          {isAr ? isAr ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                          <span>{isAr ? tConfig.labelAr : tConfig.labelEn}</span>
                          <span className="text-[10px] font-normal opacity-80">({tConfig.toState})</span>
                        </button>
                        {!isAuthorized && (
                          <span className="text-[9px] text-rose-500 font-semibold px-1">
                            {isAr ? `محظور للدور (${currentUser.role})` : `Restricted for (${currentUser.role})`}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 5. REQUEST CHANGES COMMENT MODAL / INLINE FORM */}
            {pendingCommentTransition && (
              <div className="p-4 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl space-y-3" id="changes-comment-form">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 text-xs font-bold">
                  <MessageSquare className="w-4 h-4" />
                  <span>{isAr ? 'إدخال ملاحظات التعديل والسبب:' : 'Provide Feedback & Transition Reason:'}</span>
                </div>
                <textarea
                  rows={3}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={isAr ? 'اكتب ملاحظات التعديل المطلوبة للكاتب هنا...' : 'Write requested changes & feedback for the author...'}
                  className="w-full p-2.5 bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-lg text-xs focus:outline-hidden focus:border-amber-500 text-gray-900 dark:text-white"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setPendingCommentTransition(null);
                      setErrorMessage(null);
                    }}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-200 cursor-pointer"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleConfirmCommentTransition}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                  >
                    {isAr ? 'تأكيد طلب التعديلات' : 'Confirm & Request Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* 6. AUDIT HISTORY TIMELINE (Audit Trail) */}
            <div className="space-y-3 pt-2" id="workflow-audit-history">
              <h4 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <History className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? 'سجل تتبع ومراجعة العمليات (Audit Trail)' : 'Workflow Transition History & Audit Log'}</span>
              </h4>

              {activeItem.history.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400 bg-gray-50 dark:bg-gray-950/40 rounded-xl border border-gray-100 dark:border-gray-800">
                  {isAr ? 'لم يتم تنفيذ أي انتقالات حالة على هذا العنصر بعد.' : 'No state transitions have been recorded for this item yet.'}
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {activeItem.history.map((record) => (
                    <div 
                      key={record.id}
                      className="p-3 bg-gray-50/60 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-800/80 rounded-xl text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-gray-500 dark:text-gray-400">
                        <span className="font-bold text-gray-800 dark:text-gray-200">
                          {record.actorName} <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">({record.actorRole})</span>
                        </span>
                        <span className="text-[10px] text-gray-400">{formatTimestamp(record.timestamp)}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 font-mono text-[11px] font-bold">
                        <span className="text-gray-500">{record.fromState}</span>
                        <span>→</span>
                        <span className="text-emerald-700 dark:text-emerald-400">{record.toState}</span>
                        <span className="text-gray-400 font-sans font-normal text-[10px]">({record.action})</span>
                      </div>

                      {record.comment && (
                        <div className="p-2 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/30 rounded-lg text-amber-900 dark:text-amber-300 text-[11px] flex items-start gap-1.5 mt-1">
                          <MessageSquare className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
                          <span className="italic">{record.comment}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
