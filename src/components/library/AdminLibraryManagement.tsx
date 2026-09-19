import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  BookOpen, 
  Search, 
  Plus, 
  ShieldCheck, 
  Building2, 
  FileText, 
  Clock, 
  AlertTriangle, 
  Edit3, 
  RefreshCw
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission } from '../../types/admin';
import { 
  LibraryDocumentType, 
  LibraryRightsStatus 
} from '../../types/library';
import type { 
  LibraryDocument, 
  LibraryOrganization, 
  LibrarySource 
} from '../../types/library';
import { 
  MOCK_LIBRARY_DOCUMENTS, 
  MOCK_ORGANIZATIONS, 
  MOCK_SOURCES 
} from '../../data/mockLibraryData';
import { LibraryDocumentEditorModal } from './LibraryDocumentEditorModal';

interface AdminLibraryManagementProps {
  currentUser: AdminUser;
}

export function AdminLibraryManagement({ currentUser }: AdminLibraryManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [documents, setDocuments] = useState<LibraryDocument[]>(MOCK_LIBRARY_DOCUMENTS);
  const [organizations] = useState<LibraryOrganization[]>(MOCK_ORGANIZATIONS);
  const [sources] = useState<LibrarySource[]>(MOCK_SOURCES);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedRights, setSelectedRights] = useState<string>('ALL');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('ALL');

  // Modal State
  const [activeModalDoc, setActiveModalDoc] = useState<LibraryDocument | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const canCreate = AdminAccessService.hasPermission(currentUser, AdminPermission.Create);

  // Filtered List Computation
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitleAr = doc.titleAr.toLowerCase().includes(q);
        const matchTitleEn = doc.titleEn.toLowerCase().includes(q);
        const matchOrg = doc.organizationId.toLowerCase().includes(q);
        const matchTopic = doc.topicsAr.some(t => t.toLowerCase().includes(q)) ||
                           doc.topicsEn.some(t => t.toLowerCase().includes(q));
        if (!matchTitleAr && !matchTitleEn && !matchOrg && !matchTopic) {
          return false;
        }
      }

      // Document Type
      if (selectedType !== 'ALL' && doc.documentType !== selectedType) {
        return false;
      }

      // Rights Status
      if (selectedRights !== 'ALL' && doc.rightsStatus !== selectedRights) {
        return false;
      }

      // Workflow State
      if (selectedWorkflow !== 'ALL' && doc.workflowState !== selectedWorkflow) {
        return false;
      }

      return true;
    });
  }, [documents, searchQuery, selectedType, selectedRights, selectedWorkflow]);

  const handleSaveDocument = (savedDoc: LibraryDocument) => {
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === savedDoc.id);
      if (exists) {
        return prev.map((d) => (d.id === savedDoc.id ? savedDoc : d));
      }
      return [savedDoc, ...prev];
    });
  };

  const handleCreateNew = () => {
    const newDoc: LibraryDocument = {
      id: `doc-${Date.now()}`,
      titleAr: 'وثيقة بيئية جديدة قيد التوصيف',
      titleEn: 'New Environmental Knowledge Document',
      originalTitle: '',
      documentType: LibraryDocumentType.Law,
      organizationId: organizations[0]?.id || 'org-1',
      sourceId: sources[0]?.id || 'src-1',
      geographyAr: 'إقليمي / وطني',
      geographyEn: 'Regional / National',
      publicationDate: new Date().toISOString().split('T')[0],
      language: 'ar',
      summaryAr: 'ملخص أولي للمادة المعرفية البيئية قيد الإدخال...',
      summaryEn: 'Initial summary of the environmental knowledge item under drafting...',
      topicsAr: ['بيئة', 'تشريعات'],
      topicsEn: ['Environment', 'Legislation'],
      environmentalDomains: ['LawAndPolicy'],
      rightsStatus: LibraryRightsStatus.Unknown,
      rightsNotesAr: 'قيد المراجعة الحقوقية والتثبت من قيود الملكية النشرية.',
      rightsNotesEn: 'Under rights audit and copyright verification.',
      workflowState: WorkflowState.Draft,
      workflowHistory: [],
      legalStatusDescriptionAr: 'بيان توثيقي أولي لم يستكمل التدقيق الميداني بعد.',
      legalStatusDescriptionEn: 'Initial descriptive metadata pending cataloging audit.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [
        {
          id: `ver-${Date.now()}`,
          documentId: `doc-${Date.now()}`,
          versionNumber: '1.0',
          publishedDate: new Date().toISOString().split('T')[0],
          changeDescriptionAr: 'إنشاء مسودة السجل المرجعي الأولية',
          changeDescriptionEn: 'Initial draft catalog entry created'
        }
      ]
    };
    setActiveModalDoc(newDoc);
    setIsModalOpen(true);
  };

  const getOrganizationName = (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) return orgId;
    return isAr ? org.nameAr : org.nameEn;
  };

  const getRightsBadge = (status: LibraryRightsStatus) => {
    switch (status) {
      case 'OpenPubliclyAvailable':
      case 'PermissionGranted':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 w-fit">
            <ShieldCheck className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
      case 'ReviewRequired':
      case 'PermissionRequired':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 w-fit">
            <AlertTriangle className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
      case 'Restricted':
      case 'NotRedistributable':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 flex items-center gap-1 w-fit">
            <ShieldCheck className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700 flex items-center gap-1 w-fit">
            <Clock className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
    }
  };

  const getWorkflowBadge = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Published:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            {isAr ? 'منشور للجمهور' : 'Published'}
          </span>
        );
      case WorkflowState.Approved:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            {isAr ? 'معتمد تحريرياً' : 'Approved'}
          </span>
        );
      case WorkflowState.InReview:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
            {isAr ? 'قيد المراجعة' : 'In Review'}
          </span>
        );
      case WorkflowState.ChangesRequested:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
            {isAr ? 'تعديلات مطلوبة' : 'Changes Requested'}
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700">
            {isAr ? 'مسودة إعداد' : 'Draft'}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Hero Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-emerald-950 text-white rounded-2xl p-6 sm:p-8 shadow-md relative overflow-hidden border border-emerald-800/60">
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-emerald-300">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                {isAr ? 'إدارة المكتبة البيئية والمعرفية' : 'Environmental Knowledge Library'}
              </h1>
              <p className="text-xs sm:text-sm text-emerald-100/90 max-w-2xl font-medium">
                {isAr 
                  ? 'مستودع موثق ومعتمد للتشريعات والاتفاقيات والتقارير البيئية، مفصل الأبعاد الحقوقية والتنظيمية.'
                  : 'Authenticated repository for environmental laws, treaties, policy papers, and institutional reports.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs sm:text-sm font-semibold">
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'إجمالي الوثائق' : 'Total Documents'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{documents.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'المؤسسات الموثقة' : 'Verified Bodies'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{organizations.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'قيد التدقيق الحقوقي' : 'Rights Audits'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
              {documents.filter(d => d.rightsStatus === 'ReviewRequired' || d.rightsStatus === 'PermissionRequired').length}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'قيد المراجعة التحريرية' : 'Pending Review'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
              {documents.filter(d => d.workflowState === WorkflowState.InReview).length}
            </p>
          </div>
        </div>
      </div>

      {/* Safety Principle Banner */}
      <div className="p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 text-amber-900 dark:text-amber-200 flex items-start gap-3 text-xs sm:text-sm">
        <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="font-extrabold">
            {isAr ? 'مبدأ الاستقلالية الحقوقية والتوصيف القانوني في "وعد الكوكب"' : 'Promise of Planet Independent Rights & Legal Principle'}
          </h3>
          <p className="leading-relaxed text-xs opacity-90">
            {isAr 
              ? 'تدار حالات الاعتماد التحريري (Workflow) بشكل مستقل تماماً عن حالات الترخيص الحقوقي (Rights Status). لا تعتبر الوثائق المعتمدة صحفياً مبرأة الذمة حقوقياً لإعادة التوزيع إلا إذا كانت حالتها صريحة بـ (Permission Granted) أو (Open Publicly Available).'
              : 'Editorial Approval is strictly decoupled from Rights Clearance. Documents approved in workflow are NOT automatically cleared for redistribution without explicit rights clearance.'}
          </p>
        </div>
      </div>

      {/* Search & Multi-filter Controls */}
      <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 w-full max-w-full min-w-0">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between w-full min-w-0">
          {/* Search bar */}
          <div className="relative w-full sm:max-w-md min-w-0">
            <Search className="absolute right-3.5 rtl:right-3.5 ltr:left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={isAr ? 'بحث في العنوان، الموضوع، أو الجهة المسؤولة...' : 'Search by title, topic, or organization...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-3 rtl:pl-3 ltr:pl-10 pr-10 rtl:pr-10 ltr:pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>

          {/* Add Document Action */}
          {canCreate && (
            <button
              onClick={handleCreateNew}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>{isAr ? 'إضافة وثيقة معرفية جديدة' : 'Add Knowledge Document'}</span>
            </button>
          )}
        </div>

        {/* Filters dropdown row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800/80 text-xs w-full min-w-0">
          {/* Document Type Filter */}
          <div>
            <label className="block font-bold mb-1 text-gray-600 dark:text-gray-400">
              {isAr ? 'تصفية بنوع الوثيقة:' : 'Filter by Document Type:'}
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
            >
              <option value="ALL">{isAr ? 'جميع أنواع الوثائق' : 'All Document Types'}</option>
              {Object.values(LibraryDocumentType).map((dt) => (
                <option key={dt} value={dt}>
                  {dt}
                </option>
              ))}
            </select>
          </div>

          {/* Rights Status Filter */}
          <div>
            <label className="block font-bold mb-1 text-gray-600 dark:text-gray-400">
              {isAr ? 'تصفية بالوضع الحقوقي:' : 'Filter by Rights Status:'}
            </label>
            <select
              value={selectedRights}
              onChange={(e) => setSelectedRights(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
            >
              <option value="ALL">{isAr ? 'جميع حالات الحقوق' : 'All Rights States'}</option>
              {Object.values(LibraryRightsStatus).map((rs) => (
                <option key={rs} value={rs}>
                  {rs}
                </option>
              ))}
            </select>
          </div>

          {/* Workflow State Filter */}
          <div>
            <label className="block font-bold mb-1 text-gray-600 dark:text-gray-400">
              {isAr ? 'تصفية بحالة الاعتماد:' : 'Filter by Workflow State:'}
            </label>
            <select
              value={selectedWorkflow}
              onChange={(e) => setSelectedWorkflow(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
            >
              <option value="ALL">{isAr ? 'جميع حالات الاعتماد' : 'All Workflow States'}</option>
              {Object.values(WorkflowState).map((ws) => (
                <option key={ws} value={ws}>
                  {ws}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Documents Table / Directory List */}
      <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden w-full max-w-full min-w-0">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex justify-between items-center text-xs font-bold text-gray-700 dark:text-gray-300 w-full min-w-0">
          <span>
            {isAr ? `نتائج البحث والتوثيق (${filteredDocuments.length})` : `Catalog Results (${filteredDocuments.length})`}
          </span>
          {(searchQuery || selectedType !== 'ALL' || selectedRights !== 'ALL' || selectedWorkflow !== 'ALL') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedType('ALL');
                setSelectedRights('ALL');
                setSelectedWorkflow('ALL');
              }}
              className="text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              <span>{isAr ? 'إعادة ضبط الفلاتر' : 'Reset Filters'}</span>
            </button>
          )}
        </div>

        {filteredDocuments.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-3">
            <BookOpen className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-700" />
            <p className="font-bold text-sm">
              {isAr ? 'لم يتم العثور على وثائق بيئية تطابق شروط التصفية.' : 'No knowledge documents matched your filter parameters.'}
            </p>
          </div>
        ) : (
          <>
            {/* Compact Cards List (< 1024px) */}
            <div className="block lg:hidden divide-y divide-gray-100 dark:divide-gray-800 w-full max-w-full min-w-0">
              {filteredDocuments.map((doc) => (
                <div key={doc.id} className="p-4 sm:p-5 space-y-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors w-full max-w-full min-w-0">
                  {/* Document Identity */}
                  <div className="space-y-1.5">
                    <h4 className="font-extrabold text-gray-900 dark:text-gray-100 text-sm leading-snug">
                      {isAr ? doc.titleAr : doc.titleEn}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                      {isAr ? doc.summaryAr : doc.summaryEn}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                        📍 {isAr ? doc.geographyAr : doc.geographyEn}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                        🗓️ {doc.publicationDate}
                      </span>
                    </div>
                  </div>

                  {/* Type & Entity */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      {doc.documentType}
                    </span>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      🏛️ {getOrganizationName(doc.organizationId)}
                    </span>
                  </div>

                  {/* Rights & Workflow Status */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 block mb-0.5">{isAr ? 'الوضع الحقوقي' : 'Rights Status'}</span>
                      {getRightsBadge(doc.rightsStatus)}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 block mb-0.5">{isAr ? 'حالة التحرير' : 'Editorial Workflow'}</span>
                      {getWorkflowBadge(doc.workflowState)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 flex items-center justify-end">
                    <button
                      onClick={() => {
                        setActiveModalDoc(doc);
                        setIsModalOpen(true);
                      }}
                      className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gray-100 hover:bg-emerald-100 dark:bg-gray-800 dark:hover:bg-emerald-950/60 text-gray-800 dark:text-gray-200 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-xs transition-all border border-gray-200 dark:border-gray-700 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{isAr ? 'عرض وتعديل الوثيقة' : 'View / Edit Document'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View (>= 1024px) */}
            <div className="hidden lg:block overflow-x-auto w-full max-w-full min-w-0">
              <table className="w-full text-right rtl:text-right ltr:text-left text-xs sm:text-sm">
                <thead className="bg-gray-50/80 dark:bg-gray-950/80 text-gray-500 dark:text-gray-400 font-extrabold uppercase border-b border-gray-100 dark:border-gray-800">
                  <tr>
                    <th className="p-3.5 sm:p-4">{isAr ? 'عنوان الوثيقة البيئية' : 'Document Title'}</th>
                    <th className="p-3.5 sm:p-4">{isAr ? 'النوع والمؤسسة' : 'Type & Entity'}</th>
                    <th className="p-3.5 sm:p-4">{isAr ? 'الوضع الحقوقي' : 'Rights Status'}</th>
                    <th className="p-3.5 sm:p-4">{isAr ? 'حالة التحرير' : 'Editorial Workflow'}</th>
                    <th className="p-3.5 sm:p-4 text-center">{isAr ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium text-gray-800 dark:text-gray-200">
                  {filteredDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors">
                      {/* Title & Metadata */}
                      <td className="p-3.5 sm:p-4 max-w-xs sm:max-w-md">
                        <div className="space-y-1">
                          <p className="font-extrabold text-gray-900 dark:text-gray-100 text-xs sm:text-sm leading-snug">
                            {isAr ? doc.titleAr : doc.titleEn}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1">
                            {isAr ? doc.summaryAr : doc.summaryEn}
                          </p>
                          <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                              📍 {isAr ? doc.geographyAr : doc.geographyEn}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                              🗓️ {doc.publicationDate}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Type & Entity */}
                      <td className="p-3.5 sm:p-4 whitespace-nowrap">
                        <div className="space-y-1">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 inline-block">
                            {doc.documentType}
                          </span>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[160px]">
                            {getOrganizationName(doc.organizationId)}
                          </p>
                        </div>
                      </td>

                      {/* Rights Status */}
                      <td className="p-3.5 sm:p-4 whitespace-nowrap">
                        {getRightsBadge(doc.rightsStatus)}
                      </td>

                      {/* Editorial Workflow State */}
                      <td className="p-3.5 sm:p-4 whitespace-nowrap">
                        {getWorkflowBadge(doc.workflowState)}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 sm:p-4 whitespace-nowrap text-center">
                        <button
                          onClick={() => {
                            setActiveModalDoc(doc);
                            setIsModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-emerald-100 dark:bg-gray-800 dark:hover:bg-emerald-950/60 text-gray-800 dark:text-gray-200 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-xs transition-all border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>{isAr ? 'عرض وتعديل' : 'View / Edit'}</span>
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

      {/* Editor & Detail Modal */}
      <LibraryDocumentEditorModal
        document={activeModalDoc}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveDocument}
        organizations={organizations}
        sources={sources}
        currentUser={currentUser}
      />
    </div>
  );
}
