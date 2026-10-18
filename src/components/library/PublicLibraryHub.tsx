import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  BookOpen, 
  Search, 
  Download, 
  Sparkles, 
  Calendar, 
  Building2, 
  ExternalLink, 
  X, 
  ChevronRight, 
  Copy, 
  Check, 
  RefreshCw
} from 'lucide-react';
import { LibraryDocumentType, LibraryRightsStatus } from '../../types/library';
import type { PublicLibraryDocument } from '../../types/library';
import { PublicLibraryClient } from '../../services/publicLibraryClient';
import { Container } from '../layout/Container';

export function PublicLibraryHub() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [documents, setDocuments] = useState<PublicLibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [selectedRights] = useState<string>('ALL');

  // Selected Document Inspector State
  const [selectedDoc, setSelectedDoc] = useState<PublicLibraryDocument | null>(null);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    async function loadPublishedLibrary() {
      setLoading(true);
      setApiError(null);
      try {
        const published = await PublicLibraryClient.listPublishedDocuments();
        setDocuments(published);
      } catch (err: any) {
        console.error('Failed to load published library documents:', err);
        setApiError(
          isAr
            ? 'تعذر الاتصال بخدمة المكتبة الرقمية في الخادم الآمن. يرجى التأكد من نشر وظائف النظام أو المحاولة لاحقاً.'
            : 'Unable to connect to the secure digital library service. Please ensure backend functions are deployed or try again later.'
        );
        setDocuments([]);
      } finally {
        setLoading(false);
      }
    }
    loadPublishedLibrary();
  }, [isAr]);

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle =
          doc.titleAr.toLowerCase().includes(q) ||
          doc.titleEn.toLowerCase().includes(q) ||
          Boolean(doc.originalTitle && doc.originalTitle.toLowerCase().includes(q));
        const matchSummary = doc.summaryAr.toLowerCase().includes(q) || doc.summaryEn.toLowerCase().includes(q);
        const matchTopic =
          doc.topicsAr.some(t => t.toLowerCase().includes(q)) ||
          doc.topicsEn.some(t => t.toLowerCase().includes(q)) ||
          doc.environmentalDomains.some(d => d.toLowerCase().includes(q));
        const matchProvenance =
          doc.organizationId.toLowerCase().includes(q) ||
          doc.sourceId.toLowerCase().includes(q);
        const matchGeo = doc.geographyAr.toLowerCase().includes(q) || doc.geographyEn.toLowerCase().includes(q);
        if (!matchTitle && !matchSummary && !matchTopic && !matchProvenance && !matchGeo) return false;
      }

      if (selectedType !== 'ALL' && doc.documentType !== selectedType) {
        return false;
      }

      if (selectedDomain !== 'ALL' && !doc.environmentalDomains.includes(selectedDomain)) {
        return false;
      }

      if (selectedRights !== 'ALL' && doc.rightsStatus !== selectedRights) {
        return false;
      }

      return true;
    });
  }, [documents, searchQuery, selectedType, selectedDomain, selectedRights]);

  const handleSelectDoc = (doc: PublicLibraryDocument) => {
    setSelectedDoc(doc);
    setAiSummary('');
    setAiError(null);
  };

  const getLegalStatusDescription = (doc: PublicLibraryDocument): string | undefined => {
    const primary = isAr ? doc.legalStatusDescriptionAr : doc.legalStatusDescriptionEn;
    const fallback = isAr ? doc.legalStatusDescriptionEn : doc.legalStatusDescriptionAr;
    const resolved = primary?.trim() || fallback?.trim();
    return resolved && resolved.length > 0 ? resolved : undefined;
  };

  const isDownloadPermitted = (doc: PublicLibraryDocument) => {
    return (
      doc.rightsStatus === LibraryRightsStatus.OpenPubliclyAvailable ||
      doc.rightsStatus === LibraryRightsStatus.PermissionGranted
    );
  };

  const isValidPublicHttpUrl = (rawUrl?: string): string | undefined => {
    if (typeof rawUrl !== 'string') return undefined;
    const trimmed = rawUrl.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = new URL(trimmed);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
        return undefined;
      }
      return trimmed;
    } catch {
      return undefined;
    }
  };

  const getVerifiedReferenceUrl = (doc: PublicLibraryDocument): string | undefined => {
    if (!isDownloadPermitted(doc)) return undefined;
    for (const v of doc.versions || []) {
      const safeUrl = isValidPublicHttpUrl(v.referenceUrl);
      if (safeUrl) return safeUrl;
    }
    return undefined;
  };

  const handleGenerateAiSummary = async () => {
    if (!selectedDoc) return;
    setAiLoading(true);
    setAiError(null);
    try {
      setAiError(
        isAr
          ? 'توليد الملخصات الآلية متاح حصرياً عبر الخدمة السحابية الآمنة للمنصة. الملخص التحريري المعتمد أدناه هو المرجع الرسمي الموثق.'
          : 'Automated AI summarization is available exclusively via the platform\'s secure cloud service. The approved editorial summary below is the official verified reference.'
      );
    } catch (err: any) {
      setAiError(err?.message || 'Failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleTranslateSummary = async () => {
    if (!selectedDoc) return;
    setAiLoading(true);
    setAiError(null);
    try {
      setAiError(
        isAr
          ? 'الترجمة الآلية الفورية تتطلب استدعاءً آمناً من الخادم. الوثائق منشورة بنسختيها العربية والإنجليزية الرسمية.'
          : 'Real-time neural translation requires secure server invocation. Documents are published with official parallel Arabic and English records.'
      );
    } catch (err: any) {
      setAiError(err?.message || 'Translation failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const verifiedReferenceUrl = selectedDoc ? getVerifiedReferenceUrl(selectedDoc) : undefined;
  const selectedLegalStatus = selectedDoc ? getLegalStatusDescription(selectedDoc) : undefined;

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 py-10 sm:py-16" dir={isAr ? 'rtl' : 'ltr'}>
      <Container className="max-w-7xl">
        {/* Header Hero Section */}
        <div className="bg-[#050B14] text-white rounded-3xl p-8 sm:p-12 mb-10 relative overflow-hidden shadow-xl border border-emerald-950">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_60%)] pointer-events-none" />
          <div className="relative z-10 max-w-3xl space-y-4">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-800/80 text-emerald-200 border border-emerald-700/50">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {isAr ? 'مرصد التشريعات والوثائق البيئية' : 'Environmental Policy & Document Observatory'}
            </span>
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
              {isAr ? 'المكتبة البيئية والمواثيق المعرفية' : 'Environmental Library & Knowledge Observatory'}
            </h1>
            <p className="text-sm sm:text-base text-gray-300 leading-relaxed font-medium">
              {isAr
                ? 'مستودع مرجعي موثق للتشريعات البيئية، الاتفاقيات الدولية، دراسات الحالة وأوراق السياسات في السودان والمنطقة العربية وأفريقيا.'
                : 'A verified reference repository for environmental legislation, international treaties, case studies, and policy papers in Sudan, the Arab region, and Africa.'}
            </p>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200/80 dark:border-gray-800 mb-8 space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-grow">
              <Search className="absolute top-3.5 left-3.5 right-3.5 rtl:right-3.5 rtl:left-auto text-gray-400 w-5 h-5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? 'ابحث في العناوين، الملخصات، أو المواضيع البيئية...' : 'Search titles, summaries, or environmental topics...'}
                className="w-full py-3 pl-11 pr-4 rtl:pr-11 rtl:pl-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                aria-label={isAr ? 'نوع الوثيقة' : 'Document Type'}
                className="py-3 px-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs sm:text-sm font-bold focus:outline-none focus:border-emerald-600 cursor-pointer"
              >
                <option value="ALL">{isAr ? 'جميع أنواع الوثائق' : 'All Document Types'}</option>
                {Object.values(LibraryDocumentType).map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </select>

              <select
                value={selectedDomain}
                onChange={(e) => setSelectedDomain(e.target.value)}
                aria-label={isAr ? 'المجال البيئي' : 'Environmental Domain'}
                className="py-3 px-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs sm:text-sm font-bold focus:outline-none focus:border-emerald-600 cursor-pointer"
              >
                <option value="ALL">{isAr ? 'جميع المجالات البيئية' : 'All Environmental Domains'}</option>
                <option value="WasteManagement">Waste Management</option>
                <option value="PollutionControl">Pollution Control</option>
                <option value="LawAndPolicy">Law & Policy</option>
                <option value="Biodiversity">Biodiversity</option>
                <option value="Climate">Climate</option>
                <option value="Water">Water Resources</option>
              </select>
            </div>
          </div>
        </div>

        {/* Documents Grid & Detail Split Layout */}
        <div className={`grid grid-cols-1 ${selectedDoc ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} gap-8 items-start`}>
          {/* Main Document Catalog Grid */}
          <div className={`${selectedDoc ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
            <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                {isAr ? `الوثائق المتاحة (${filteredDocuments.length})` : `Available Documents (${filteredDocuments.length})`}
              </h2>
            </div>

            {loading ? (
              <div className="p-12 text-center text-gray-500 font-medium">
                {isAr ? 'جاري تحميل الوثائق البيئية...' : 'Loading environmental documents...'}
              </div>
            ) : apiError ? (
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-8 text-center space-y-3">
                <BookOpen className="w-10 h-10 text-amber-600 mx-auto" />
                <h3 className="text-base font-bold text-amber-900 dark:text-amber-200">
                  {isAr ? 'حالة النظام' : 'System Notice'}
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-300 max-w-md mx-auto leading-relaxed">
                  {apiError}
                </p>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-12 text-center border border-gray-200 dark:border-gray-800 space-y-3">
                <BookOpen className="w-12 h-12 text-gray-400 mx-auto" />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {isAr ? 'لا توجد وثائق تطابق بحثك' : 'No documents match your criteria'}
                </h3>
                <p className="text-xs text-gray-500">
                  {isAr ? 'جرب تغيير كلمات البحث أو إلغاء تفعيل بعض المرشحات.' : 'Try adjusting your search terms or filters.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {filteredDocuments.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleSelectDoc(doc)}
                      className={`bg-white dark:bg-gray-900 rounded-2xl p-6 border transition-all cursor-pointer flex flex-col justify-between shadow-xs hover:shadow-md ${
                        isSelected
                          ? 'border-emerald-600 ring-2 ring-emerald-600/20'
                          : 'border-gray-200/80 dark:border-gray-800 hover:border-emerald-400'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                            {doc.documentType}
                          </span>
                          <span className="text-xs text-gray-500 font-medium">
                            {doc.publicationDate}
                          </span>
                        </div>
                        <h3 className="text-base font-extrabold text-gray-900 dark:text-white leading-snug">
                          {isAr ? doc.titleAr : doc.titleEn}
                        </h3>
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
                          {isAr ? doc.summaryAr : doc.summaryEn}
                        </p>
                      </div>

                      <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs font-semibold text-gray-500">
                        <span className="truncate max-w-[180px]">
                          {doc.organizationId}
                        </span>
                        <button
                          type="button"
                          className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 font-bold"
                        >
                          <span>{isAr ? 'معاينة التفاصيل' : 'Inspect Details'}</span>
                          <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Document Inspector Sidebar (Rendered only when a document is selected) */}
          {selectedDoc && (
            <div className="lg:col-span-1">
              <div className="sticky top-24 bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-xl border border-gray-200/80 dark:border-gray-800 space-y-6">
                <div className="flex items-start justify-between gap-3 pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-block px-2.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-bold text-[10px]">
                        {selectedDoc.documentType}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-semibold text-[10px] uppercase">
                        {selectedDoc.language}
                      </span>
                    </div>
                    <h2 className="text-lg font-extrabold text-gray-900 dark:text-white leading-snug">
                      {isAr ? selectedDoc.titleAr : selectedDoc.titleEn}
                    </h2>
                    {selectedDoc.originalTitle && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                        {selectedDoc.originalTitle}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDoc(null)}
                    className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4 text-xs">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-bold">{selectedDoc.organizationId}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{selectedDoc.publicationDate} · {isAr ? selectedDoc.geographyAr : selectedDoc.geographyEn}</span>
                  </div>
                </div>

                {/* Editorial Summary */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    {isAr ? 'الملخص التحريري المعتمد' : 'Approved Editorial Summary'}
                  </h4>
                  <p className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl leading-relaxed">
                    {isAr ? selectedDoc.summaryAr : selectedDoc.summaryEn}
                  </p>
                </div>

                {/* Descriptive Legal Status */}
                {selectedLegalStatus && (
                  <div className="space-y-1.5 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <h4 className="text-xs font-bold text-gray-900 dark:text-white">
                      {isAr ? 'الوضع القانوني التوثيقي' : 'Descriptive Legal Status'}
                    </h4>
                    <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                      {selectedLegalStatus}
                    </p>
                  </div>
                )}

                {/* AI Summary / Translation Section */}
                <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      <Sparkles className="w-4 h-4" />
                      <span>{isAr ? 'مساعد التحليل الذكي (Gemini)' : 'AI Advisory Analysis (Gemini)'}</span>
                    </h4>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleGenerateAiSummary}
                        disabled={aiLoading}
                        className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 cursor-pointer disabled:opacity-50 text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${aiLoading ? 'animate-spin' : ''}`} />
                        <span>{isAr ? 'توليد ملخص' : 'AI Summary'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleTranslateSummary}
                        disabled={aiLoading}
                        className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer text-[11px] font-bold"
                      >
                        {isAr ? 'ترجمة' : 'Translate'}
                      </button>
                    </div>
                  </div>

                  {aiError && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-[11px] text-amber-800 dark:text-amber-300">
                      {aiError}
                    </div>
                  )}

                  {aiSummary && (
                    <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                      <p className="font-semibold text-emerald-900 dark:text-emerald-300 mb-1">
                        {isAr ? 'نتيجة التحليل الذكي المقترح:' : 'Proposed AI Advisory Analysis:'}
                      </p>
                      {aiSummary}
                    </div>
                  )}
                </div>

                {/* Topics & Domains */}
                <div className="space-y-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <h4 className="text-xs font-bold text-gray-900 dark:text-white">
                    {isAr ? 'المواضيع والمجالات البيئية' : 'Topics & Environmental Domains'}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDoc.environmentalDomains.map((domain, i) => (
                      <span key={`dom-${i}`} className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                        {domain}
                      </span>
                    ))}
                    {(isAr ? selectedDoc.topicsAr : selectedDoc.topicsEn).map((topic, i) => (
                      <span key={`top-${i}`} className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[11px] font-medium">
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Version History */}
                {selectedDoc.versions && selectedDoc.versions.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <h4 className="text-xs font-bold text-gray-900 dark:text-white">
                      {isAr ? 'سجل الإصدارات المعتمدة' : 'Approved Version History'}
                    </h4>
                    <div className="space-y-1.5">
                      {selectedDoc.versions.map((ver) => (
                        <div key={ver.id} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-[11px] flex items-center justify-between gap-2">
                          <span className="font-bold text-emerald-700 dark:text-emerald-400">
                            v{ver.versionNumber}
                          </span>
                          <span className="text-gray-600 dark:text-gray-300 truncate">
                            {isAr ? ver.changeDescriptionAr : ver.changeDescriptionEn}
                          </span>
                          <span className="text-gray-400 shrink-0">{ver.publishedDate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Provenance & Rights */}
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 font-medium">{isAr ? 'حالة الحقوق:' : 'Rights Status:'}</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">{selectedDoc.rightsStatus}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="text-gray-500 font-medium shrink-0">{isAr ? 'معرّف الجهة المسؤولة:' : 'Organization ID:'}</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300 truncate">{selectedDoc.organizationId}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="text-gray-500 font-medium shrink-0">{isAr ? 'معرّف المصدر التوثيقي:' : 'Source Registry ID:'}</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300 truncate">{selectedDoc.sourceId}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    {!isDownloadPermitted(selectedDoc) ? (
                      <div className="col-span-2 py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs font-bold text-center">
                        {isAr ? 'الوثيقة مقيدة أو تتطلب إذناً خاصاً لإعادة التوزيع' : 'Restricted document — Permission required for redistribution'}
                      </div>
                    ) : verifiedReferenceUrl ? (
                      <a
                        href={verifiedReferenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="col-span-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center justify-center gap-2 transition-colors shadow-sm"
                      >
                        <Download className="w-4 h-4" />
                        <span>{isAr ? 'فتح أو تحميل الوثيقة الأصلية' : 'Open / Download Original Document'}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <div className="col-span-2 py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-semibold text-center">
                        {isAr ? 'سجل مرجعي موثق — لا يتوفر رابط ملف خارجي مباشر لهذه النسخة' : 'Verified reference record — No direct external file link attached to this version'}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.href);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="col-span-2 py-2 px-3 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'نسخ الرابط' : 'Copy Link')}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}


